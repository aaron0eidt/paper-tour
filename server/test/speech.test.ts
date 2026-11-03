import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { DEFAULT_SPEECH_PREFERENCES } from '../../shared/speech';
import { SpeechProviders, alignedWordTimes, wavDurationMs } from '../src/speech/providers';
import type { SpeechConfig } from '../src/speech/config';
import { SpeechService, speechPreferences } from '../src/speech/service';
import { speechRoutes } from '../src/speech/routes';
import { Database } from '../src/db';

function wav() {
  const buffer = Buffer.alloc(2044);
  buffer.write('RIFF');
  buffer.writeUInt32LE(buffer.length - 8, 4);
  buffer.write('WAVEfmt ', 8);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(1000, 24);
  buffer.writeUInt32LE(2000, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(2000, 40);
  return buffer;
}
const config: SpeechConfig = {
  openaiKey: 'test-server-openai-key',
  elevenlabsKey: '',
  cacheDir: '',
  timeoutMs: 2000,
};

test('retired GPU settings cannot silently select any API; native Browser stays the default', () => {
  assert.equal(speechPreferences({}).provider, 'browser');
  assert.throws(
    () => speechPreferences({ provider: 'local' }),
    (error: any) => error.code === 'speech_settings_invalid',
  );
  const normalized = speechPreferences({ provider: 'browser', precompute: false, connections: { local: {} } });
  assert(!('precompute' in normalized));
  assert(!('local' in normalized.connections));
});
test('voice favorites accept unique bounded IDs without changing default connections', () => {
  const normalized = speechPreferences({ voiceOrder: { siri: ['native.siri.one', 'native.siri.two'] } });
  assert.deepEqual(normalized.voiceOrder, { siri: ['native.siri.one', 'native.siri.two'] });
  assert.deepEqual(normalized.connections, DEFAULT_SPEECH_PREFERENCES.connections);
  for (const voiceOrder of [{ siri: ['same', 'same'] }, { siri: [42] }, { siri: [''] }, { siri: ['a'.repeat(201)] }, { siri: new Array(513).fill('a') }, { unknown: ['a'] }, []])
    assert.throws(() => speechPreferences({ voiceOrder }), (error: any) => error.code === 'speech_settings_invalid');
});
test('preview and ranking routes require authentication and reject credential overrides', async () => {
  const calls: object[] = [];
  const speech = { preview: async (owner: string, input: object) => { calls.push({ owner, input }); return { ok: true }; },
    rankVoices: async (owner: string, provider: string, voices: string[]) => { calls.push({ owner, provider, voices }); return { ok: true }; },
  } as unknown as SpeechService;
  const api = Fastify({ ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });
  api.addHook('preHandler', async (request, reply) => { if (request.headers.authorization !== 'Bearer test-owner') reply.code(401).send({ error: 'unauthorized' }); });
  speechRoutes(api, speech, () => 'authenticated-owner');
  const input = { provider: 'siri', voice: 'native.siri.one', text: 'One shared sample.', language: 'en-US', version: randomUUID() };
  const headers = { authorization: 'Bearer test-owner' };
  try {
    assert.equal((await api.inject({ method: 'POST', url: '/speech/preview', payload: input })).statusCode, 401);
    assert.equal((await api.inject({ method: 'POST', url: '/speech/preview', headers, payload: { ...input, provider: 'browser' } })).statusCode, 400);
    assert.equal((await api.inject({ method: 'POST', url: '/speech/preview', headers, payload: { ...input, apiKey: 'arbitrary-key' } })).statusCode, 400);
    assert.equal((await api.inject({ method: 'POST', url: '/speech/preview', headers, payload: { ...input, text: 'x'.repeat(601) } })).statusCode, 400);
    assert.equal((await api.inject({ method: 'POST', url: '/speech/preview', headers, payload: input })).statusCode, 200);
    assert.deepEqual(calls[0], { owner: 'authenticated-owner', input });
    assert.equal((await api.inject({ method: 'PUT', url: '/speech/voice-order/siri', payload: { voices: [] } })).statusCode, 401);
    assert.equal((await api.inject({ method: 'PUT', url: '/speech/voice-order/siri', headers, payload: { voices: ['a', 'a'] } })).statusCode, 400);
    assert.equal((await api.inject({ method: 'PUT', url: '/speech/voice-order/siri', headers, payload: { voices: ['b', 'a'] } })).statusCode, 200);
    assert.deepEqual(calls[1], { owner: 'authenticated-owner', provider: 'siri', voices: ['b', 'a'] });
  } finally { await api.close(); }
});
test('alignment must preserve all original characters and have monotonic times', () => {
  const text = 'Für uns.',
    alignment = { characters: [...text], character_start_times_seconds: [...text].map((_, i) => i / 10) };
  assert.deepEqual(alignedWordTimes(text, alignment), [0, 400]);
  assert.equal(alignedWordTimes('For us.', alignment), undefined);
  assert.equal(
    alignedWordTimes(text, { ...alignment, character_start_times_seconds: [1, 0, 0, 0, 0, 0, 0, 0] }),
    undefined,
  );
  assert.equal(wavDurationMs(wav()), 1000);
});
test('missing credentials and provider errors cannot switch providers or echo response bodies', async () => {
  let calls = 0;
  const provider = new SpeechProviders(config, async () => {
    calls++;
    return new Response('private-key-and-paper-text', { status: 401 });
  });
  const input = {
    provider: 'openai' as const,
    text: 'Some words.',
    language: 'en-US',
    model: 'gpt-4o-mini-tts',
    voice: 'cedar',
    apiKey: '',
  };
  await assert.rejects(provider.synthesize(input), (error: any) => error.code === 'speech_not_configured');
  assert.equal(calls, 0);
  await assert.rejects(
    provider.synthesize({ ...input, apiKey: 'test-secret' }),
    (error: any) => error.code === 'speech_provider_error' && !error.message.includes('private'),
  );
  assert.equal(calls, 1);
});
test('scoped ElevenLabs TTS keys do not require voice-catalog access', async () => {
  const scoped = new SpeechProviders(config, async () =>
    Response.json({ detail: { status: 'missing_permissions' } }, { status: 401 }),
  );
  await scoped.verifyKey('elevenlabs', 'scoped-test-key');
  const invalid = new SpeechProviders(config, async () =>
    Response.json({ detail: { status: 'invalid_api_key' } }, { status: 401 }),
  );
  await assert.rejects(
    invalid.verifyKey('elevenlabs', 'invalid-test-key'),
    (error: any) => error.code === 'speech_key_not_verified',
  );
});
test('normalized or rewritten provider alignment is labeled estimated', async () => {
  const providers = new SpeechProviders(config, async () =>
    Response.json({
      audio_base64: wav().toString('base64'),
      alignment: { characters: ['rewritten'], character_start_times_seconds: [0] },
    }),
  );
  const audio = await providers.synthesize({
    provider: 'elevenlabs',
    text: 'Original words.',
    language: 'de-DE',
    model: 'eleven_multilingual_v2',
    voice: 'JBFqnCBsd6RMkjVDRZzb',
    apiKey: 'test-secret',
  });
  assert.equal(audio.timing, 'estimated');
  assert.equal(audio.wordTimesMs, undefined);
});

test(
  'Vault isolation, authenticated routes, owner/version caches and key deletion',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = new Database(process.env.TEST_DATABASE_URL!),
      owner = randomUUID(),
      other = randomUUID();
    const folder = await mkdtemp(join(tmpdir(), 'speech-test-')),
      personalKey = `test-personal-key-${randomUUID()}`;
    let syntheses = 0;
    const seenKeys: string[] = [];
    const transport: typeof fetch = async (url, init) => {
      const path = String(url);
      if (path.endsWith('/voices'))
        return Response.json({ detail: { status: 'missing_permissions' } }, { status: 401 });
      syntheses++;
      seenKeys.push(new Headers(init?.headers).get('xi-api-key') ?? '');
      await new Promise((resolve) => setTimeout(resolve, 10));
      return path.includes('elevenlabs')
        ? Response.json({ audio_base64: wav().toString('base64') })
        : new Response(wav());
    };
    const speech = new SpeechService(db, { ...config, cacheDir: folder, elevenlabsKey: 'test-server-key' }, transport),
      api = Fastify();
    api.addHook('preHandler', async (request, reply) => {
      if (request.headers.authorization !== 'Bearer test-owner') reply.code(401).send({ error: 'unauthorized' });
    });
    speechRoutes(api, speech, () => owner);
    try {
      await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [
        owner,
        `${owner}@example.test`,
        other,
        `${other}@example.test`,
      ]);
      assert.equal((await api.inject({ url: '/speech/settings' })).statusCode, 401);
      assert.equal(
        (await api.inject({ url: '/speech/settings', headers: { authorization: 'Bearer test-owner' } })).statusCode,
        200,
      );
      const selected = structuredClone(DEFAULT_SPEECH_PREFERENCES);
      selected.provider = 'openai';
      const settings = await speech.update(owner, selected),
        input = { text: 'Original paper words.', language: 'en-US', version: settings.version };
      const pair = await Promise.all([speech.synthesize(owner, input), speech.synthesize(owner, input)]);
      assert.equal(syntheses, 1);
      assert.equal(pair[0].audioBase64, pair[1].audioBase64);
      assert.equal((await speech.synthesize(owner, input)).cached, true);
      assert.equal(syntheses, 1);
      const foreign = await speech.update(other, selected);
      await speech.synthesize(other, { ...input, version: foreign.version });
      assert.equal(syntheses, 2);
      const changed = await speech.update(owner, selected);
      await assert.rejects(speech.synthesize(owner, input), (error: any) => error.code === 'speech_settings_changed');
      await speech.synthesize(owner, { ...input, version: changed.version });
      assert.equal(syntheses, 3);
      const updated = await speech.saveKey(owner, 'elevenlabs', personalKey);
      assert(!JSON.stringify(updated).includes(personalKey));
      const row = (
        await db.query(
          'select c.secret_id,v.secret,v.decrypted_secret from speech_credentials c join vault.decrypted_secrets v on v.id=c.secret_id where c.owner_id=$1',
          [owner],
        )
      ).rows[0];
      assert.equal(row.decrypted_secret, personalKey);
      assert.notEqual(row.secret, personalKey);
      for (const sql of ['select * from speech_credentials', 'select decrypted_secret from vault.decrypted_secrets'])
        await assert.rejects(
          db.transaction(async (tx) => {
            await tx.query('set local role authenticated');
            await tx.query(sql);
          }),
          (error: any) => error.code === '42501',
        );
      const cloud = updated.preferences;
      cloud.provider = 'elevenlabs';
      const cloudSettings = await speech.update(owner, cloud);
      await speech.synthesize(owner, { ...input, version: cloudSettings.version });
      assert.equal(seenKeys.at(-1), personalKey);
      const removed = await speech.removeKey(owner, 'elevenlabs');
      assert.equal((await db.query('select id from vault.secrets where id=$1', [row.secret_id])).rowCount, 0);
      await assert.rejects(
        speech.synthesize(owner, { ...input, version: removed.version }),
        (error: any) => error.code === 'speech_not_configured',
      );
      assert.equal(seenKeys.at(-1), personalKey);
      const ranked = await speech.rankVoices(owner, 'siri', ['native.siri.two', 'native.siri.one']);
      assert.equal(ranked.version, removed.version, 'ranking must preserve the audio cache version');
      assert.deepEqual(ranked.preferences.connections, removed.preferences.connections);
      assert.equal(ranked.preferences.provider, removed.preferences.provider);
      assert.deepEqual((await speech.get(owner)).preferences.voiceOrder?.siri, ['native.siri.two', 'native.siri.one']);
      assert.equal((await speech.get(other)).preferences.voiceOrder?.siri, undefined, 'ranking belongs to its account');
      const sample = { ...input, version: ranked.version, provider: 'openai' as const, voice: 'coral' };
      const heard = await speech.preview(owner, sample);
      assert.equal(heard.voice, 'coral');
      assert.equal(heard.provider, 'openai');
      assert.equal((await speech.preview(owner, sample)).cached, true, 'replaying a sample shares the private voice cache');
      assert.deepEqual((await speech.get(owner)).preferences, ranked.preferences, 'a preview never changes playback selection or rankings');
      await assert.rejects(speech.preview(owner, { ...sample, voice: 'unknown' }), (error: any) => error.code === 'speech_settings_invalid');
      await assert.rejects(speech.preview(other, sample), (error: any) => error.code === 'speech_settings_changed');
      for (const dir of await readdir(folder))
        for (const file of await readdir(join(folder, dir)))
          assert(!(await readFile(join(folder, dir, file), 'utf8')).includes(personalKey));
    } finally {
      await api.close();
      await db.query('delete from auth.users where id=any($1::uuid[])', [[owner, other]]);
      await db.close();
      await rm(folder, { recursive: true, force: true });
    }
  },
);
