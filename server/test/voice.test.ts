import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeWav, validWav } from '../../shared/voice';
import { transcribe } from '../src/muse/transcribe';
import type { MuseConfig } from '../src/config';
const config: MuseConfig = {
  apiKey: 'synthetic-test-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'de-DE',
  timeoutMs: 1000,
};
const audio = encodeWav(new Float32Array(4800).fill(0.1), 48000);
test('browser WAV conversion preserves long recordings and rejects malformed formats', () => {
  assert(validWav(audio));
  assert.equal(audio.length, 3244);
  const long = encodeWav(new Float32Array(16000 * 61), 16000);
  assert.equal(long.length, 44 + 16000 * 61 * 2);
  assert(validWav(long));
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
  await assert.rejects(() => transcribe(config, new Uint8Array(44), fake), /valid mono/);
  await assert.rejects(() => transcribe({ ...config, apiKey: '' }, audio, fake), /Meta connection/);
  assert.equal(calls, 0);
  await assert.rejects(
    () => transcribe(config, audio, fake),
    (e: Error) => !e.message.includes('sensitive') && e.message.includes('not accepted'),
  );
  await assert.rejects(() => transcribe(config, audio, async () => Response.json({ transcript: '' })), /No speech/);
});

test('transcription preserves long text and only uses caller cancellation', async () => {
  const controller = new AbortController();
  const transcript = 'Eine ausführliche Frage. '.repeat(1200).trim();
  const result = await transcribe(config, audio, async (_url, init) => {
    assert.equal(init?.signal, controller.signal);
    return Response.json({ transcript });
  }, controller.signal);
  assert.equal(result.transcript, transcript);
});
