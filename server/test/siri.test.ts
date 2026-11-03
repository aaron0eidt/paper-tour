import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Fastify from 'fastify';
import { SiriRuntime, siriWordTimes } from '../src/speech/siri';
import type { SiriCommand } from '../src/speech/siri-install';
import { siriRoutes } from '../src/speech/siri-routes';
import { HttpError } from '../src/errors';

const machine = { platform: 'darwin', arch: 'arm64' };
const catalog = [
  { assetKey: 'en-US:natural:male:Aaron:premium:5030', name: 'Aaron', language: 'en-US', engine: 'siri', generation: 'legacy' },
  { assetKey: 'de-DE:natural:female:Helena:premium:5005', name: 'Helena', language: 'de-DE', engine: 'siri', generation: 'legacy' },
  { assetKey: 'en-US:fmvoice:male:aaron:premium:0', name: 'aaron', language: 'en-US', engine: 'siri', generation: 'expressive' },
];
async function fixture() {
  const folder = await mkdtemp(join(tmpdir(), 'siri-setup-test-'));
  let helper = false, builds = 0, failure = '', block = false, scope = 'available';
  const installed = new Set<string>([catalog[2].assetKey]);
  const downloads: string[] = [], texts: string[] = [];
  const run: SiriCommand = async (_file, args, options) => {
    options?.signal?.throwIfAborted();
    if (args[0] === '--version') {
      if (!helper) throw Object.assign(new Error('Missing'), { code: 'ENOENT' });
      return { stdout: '2.0.0', stderr: '' };
    }
    if (args[0] === 'doctor') return { stdout: JSON.stringify({ probe: { succeeded: true, nonSilent: true } }), stderr: '' };
    if (args[0] === 'capabilities') return { stdout: JSON.stringify({ voices: [{ readiness: 'verified' }] }), stderr: '' };
    if (args.includes('--available')) return { stdout: JSON.stringify({ catalogScope: scope, voices: catalog.map((v) => ({ ...v, installed: installed.has(v.assetKey) })) }), stderr: '' };
    if (args.includes('--install')) {
      const id = args[args.indexOf('--install') + 1];
      downloads.push(id);
      if (block) await new Promise<void>((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true }));
      if (failure === id) throw new Error('Download failed');
      installed.add(id);
      return { stdout: JSON.stringify({ state: 'installed' }), stderr: '' };
    }
    if (args[0] === 'synthesize') {
      texts.push(await readFile(args[args.indexOf('--input-file') + 1], 'utf8'));
      const wav = Buffer.alloc(256); wav.write('RIFF'); wav.write('WAVE', 8);
      await writeFile(args[args.indexOf('--output') + 1], wav);
      const expressive = args[args.indexOf('--generation') + 1] === 'expressive';
      return { stdout: JSON.stringify({ audio: { nonSilent: true, durationSeconds: 1 }, timingsSupported: !expressive,
        timings: [{ start: 0, utf16Location: 0, utf16Length: texts.at(-1)!.length }] }), stderr: '' };
    }
    throw new Error(`Unexpected command ${args[0]}`);
  };
  const config = { dataDir: folder, allowInstall: true, autoSetup: true };
  const install = async () => { helper = true; builds++; return '/managed/siri-tts'; };
  const make = () => new SiriRuntime(config, run, install, machine);
  return { folder, make, run, installed, downloads, texts,
    get builds() { return builds; }, set failure(value: string) { failure = value; }, set block(value: boolean) { block = value; }, set scope(value: string) { scope = value; } };
}

test('a fresh install builds once, downloads every missing catalog voice and resumes without duplicate downloads', async () => {
  const f = await fixture();
  try {
    const siri = f.make();
    assert.equal(siri.start().running, true);
    await siri.settled();
    assert.equal(siri.snapshot().phase, 'ready');
    assert.equal(siri.snapshot().installed, catalog.length);
    assert.equal(f.builds, 1);
    assert.deepEqual(new Set(f.downloads), new Set(catalog.slice(0, 2).map((v) => v.assetKey)));
    assert.equal(JSON.parse(await readFile(join(f.folder, 'setup.json'), 'utf8')).running, false);
    const restarted = f.make();
    restarted.start(); await restarted.settled();
    assert.equal(restarted.snapshot().phase, 'ready');
    assert.equal(f.builds, 1);
    assert.equal(f.downloads.length, 2);
  } finally { await rm(f.folder, { recursive: true, force: true }); }
});

test('one failed download stays visible, existing voices work, and Retry only requests missing voices', async () => {
  const f = await fixture();
  try {
    f.failure = catalog[1].assetKey;
    const siri = f.make(); siri.start(); await siri.settled();
    assert.equal(siri.snapshot().phase, 'partial');
    assert.equal(siri.snapshot().failures.length, 1);
    const audio = await siri.synthesize('Exact original words.', 'en-US', catalog[0].assetKey);
    assert.equal(audio.provider, 'siri');
    assert.equal(audio.timing, 'provider');
    f.failure = '';
    siri.start(); await siri.settled();
    assert.equal(siri.snapshot().phase, 'ready');
    assert.equal(f.downloads.filter((id) => id === catalog[0].assetKey).length, 1);
    assert.equal(f.downloads.filter((id) => id === catalog[1].assetKey).length, 2);
  } finally { await rm(f.folder, { recursive: true, force: true }); }
});

test('pause stops requesting more voices and preserves a resumable state', async () => {
  const f = await fixture();
  try {
    f.block = true;
    const siri = f.make(); siri.start();
    while (!f.downloads.length) await new Promise((resolve) => setTimeout(resolve, 1));
    siri.pause(); await siri.settled();
    assert.equal(siri.snapshot().phase, 'paused');
    assert.equal(f.downloads.length, 1);
    f.block = false;
    siri.start(); await siri.settled();
    assert.equal(siri.snapshot().phase, 'ready');
  } finally { await rm(f.folder, { recursive: true, force: true }); }
});

test('an installed-only catalog never claims that all downloadable voices are installed', async () => {
  const f = await fixture();
  try {
    f.scope = 'installed-fallback';
    const siri = f.make(); siri.start(); await siri.settled();
    assert.equal(siri.snapshot().catalogComplete, false);
    assert.equal(siri.snapshot().phase, 'partial');
    assert.match(siri.snapshot().message, /could not be verified/);
  } finally { await rm(f.folder, { recursive: true, force: true }); }
});

test('Siri preserves literal input via files; expressive timing is labeled estimated', async () => {
  const f = await fixture();
  try {
    const siri = f.make(); siri.start(); await siri.settled();
    const input = 'Für 😀 $(never-run) `unchanged`';
    const legacy = await siri.synthesize(input, 'en-US', catalog[0].assetKey);
    const expressive = await siri.synthesize(input, 'en-US', catalog[2].assetKey);
    assert.deepEqual(f.texts, [input, input]);
    assert.equal(legacy.timing, 'provider');
    assert.equal(expressive.timing, 'estimated');
    assert.equal(expressive.wordTimesMs, undefined);
    await assert.rejects(siri.synthesize(input, 'en-US', '--arbitrary-flag'), (error: unknown) => (error as HttpError).code === 'siri_voice_missing');
  } finally { await rm(f.folder, { recursive: true, force: true }); }
});

test('unsupported systems never run an installer', async () => {
  let calls = 0;
  const siri = new SiriRuntime({ dataDir: '/unused', allowInstall: true, autoSetup: true }, async () => { calls++; throw new Error(); }, undefined, { platform: 'linux', arch: 'x64' });
  assert.equal((await siri.status()).supported, false);
  assert.throws(() => siri.start(), (error: unknown) => (error as HttpError).status === 403);
  assert.equal(calls, 0);
});

test('UTF-16 native timings match repeated words and interpolate missing events', () => {
  assert.deepEqual(siriWordTimes('😀 one one', [
    { start: 0, utf16Location: 0, utf16Length: 2 }, { start: 0.6, utf16Location: 7, utf16Length: 3 }, null,
  ], 1000), [0, 300, 600]);
  assert.equal(siriWordTimes('one', [{ start: -1, utf16Location: 0, utf16Length: 3 }], 1000), undefined);
});

test('local demo cannot install from remote hosts or origins and cannot invoke cloud providers', async () => {
  const f = await fixture();
  const app = Fastify({ ajv: { customOptions: { coerceTypes: false, removeAdditional: false } } });
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof HttpError ? error.status : (error as { statusCode?: number }).statusCode ?? 500).send({ error: 'failed' }));
  siriRoutes(app, f.make(), ['http://localhost:5175'], true);
  try {
    for (const options of [{ remoteAddress: '192.0.2.1' }, { headers: { host: 'evil.example' } }, { headers: { origin: 'https://evil.example' } }]) {
      assert.equal((await app.inject({ url: '/speech/siri', ...options })).statusCode, 404);
    }
    const local = await app.inject('/speech/settings');
    assert.equal(local.statusCode, 200);
    assert.equal(local.json().providers.elevenlabs.appKeyAvailable, false);
    assert.equal((await app.inject({ url: '/speech/synthesize', method: 'POST', payload: { provider: 'openai' } })).statusCode, 400);
  } finally { await app.close(); await rm(f.folder, { recursive: true, force: true }); }
});
