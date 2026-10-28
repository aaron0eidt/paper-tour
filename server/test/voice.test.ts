import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, validWav, VOICE_MAX_BYTES } from '../../shared/voice';
import { transcribe } from '../src/muse/transcribe';
import type { MuseConfig } from '../src/config';
import { createApp } from '../src/app';
import type { Library } from '../src/service';
const config: MuseConfig = {
  apiKey: 'synthetic-test-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'de-DE',
  timeoutMs: 1000,
};
const audio = encodeWav(new Float32Array(4800).fill(0.1), 48000);
test('browser WAV conversion is bounded and the server rejects malformed formats', () => {
  assert(validWav(audio));
  assert.equal(audio.length, 3244);
  assert.equal(encodeWav(new Float32Array(16000 * 31), 16000).length, VOICE_MAX_BYTES);
  assert(!validWav(audio.slice(0, 43)));
  const stereo = audio.slice();
  stereo[22] = 2;
  assert(!validWav(stereo));
  assert.throws(() => encodeWav(new Float32Array(2), 0));
});
test('fake transport verifies the official Muse Voice endpoint, multipart shape and transcript', async () => {
  let called = false;
  const fake: typeof fetch = async (url, init) => {
    called = true;
    assert.equal(url, 'https://api.meta.ai/v1/asr/transcribe');
    assert.equal(init?.redirect, 'error');
    const body = init?.body as FormData;
    const request = JSON.parse(await (body.get('request') as Blob).text());
    assert.deepEqual(request, { model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' });
    assert.equal((body.get('audio') as Blob).size, audio.length);
    return Response.json({ transcript: 'Warum ist das so?' });
  };
  assert.deepEqual(await transcribe(config, audio, fake), { transcript: 'Warum ist das so?' });
  assert(called);
});
test('no provider calls for invalid input or missing keys; errors never echo upstream secrets', async () => {
  let calls = 0;
  const fake: typeof fetch = async () => {
    calls++;
    return new Response('sensitive-provider-body', { status: 401 });
  };
  await assert.rejects(() => transcribe(config, new Uint8Array(44), fake), /Record up to/);
  await assert.rejects(() => transcribe({ ...config, apiKey: '' }, audio, fake), /Meta connection/);
  assert.equal(calls, 0);
  await assert.rejects(
    () => transcribe(config, audio, fake),
    (e: Error) => !e.message.includes('sensitive') && e.message.includes('not accepted'),
  );
  await assert.rejects(() => transcribe(config, audio, async () => Response.json({ transcript: '' })), /No speech/);
});
test('voice routes require authentication, validate document identity, limit the body and hide demos in production', async () => {
  const calls: string[] = [];
  const service = {
    transcribe: async (owner: string, id: string) => {
      calls.push(`${owner}:${id}`);
      return { transcript: 'Synthetic question' };
    },
  } as unknown as Library;
  const app = await createApp({
    service,
    authenticate: async (t) => (t === 'synthetic' ? 'owner' : null),
    demo: false,
  });
  const id = '11111111-1111-4111-8111-111111111111';
  try {
    const request = {
      method: 'POST' as const,
      url: `/api/documents/${id}/transcribe`,
      headers: { 'content-type': 'audio/wav' },
      payload: Buffer.from(audio),
    };
    assert.equal((await app.inject(request)).statusCode, 401);
    const good = await app.inject({ ...request, headers: { ...request.headers, authorization: 'Bearer synthetic' } });
    assert.equal(good.statusCode, 200);
    assert.equal(good.json().transcript, 'Synthetic question');
    assert.equal(calls.length, 1);
    assert.equal(
      (
        await app.inject({
          ...request,
          url: '/api/documents/not-an-id/transcribe',
          headers: { ...request.headers, authorization: 'Bearer synthetic' },
        })
      ).statusCode,
      400,
    );
    assert.equal((await app.inject({ ...request, payload: Buffer.alloc(VOICE_MAX_BYTES + 1) })).statusCode, 413);
    assert.equal((await app.inject({ ...request, url: '/api/demo/_fixture/transcribe' })).statusCode, 404);
  } finally {
    await app.close();
  }
});
