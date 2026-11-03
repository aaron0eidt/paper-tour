let failures = 0;
async function test(name: string, run: () => void | Promise<void>) {
  try {
    await run();
    console.log(`ok ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}`, error);
  }
}
function assert(value: unknown): asserts value {
  if (!value) throw new Error('Assertion failed');
}
function equal(actual: unknown, expected: unknown) {
  if (actual !== expected) throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
}
function deepEqual(actual: unknown, expected: unknown) {
  equal(JSON.stringify(actual), JSON.stringify(expected));
}
import { DEFAULT_SPEECH_PREFERENCES, type SpeechAudio, type SpeechSettings } from '../../shared/speech';
import { audioChunks, ProviderNarrator, SpeechAudioCache } from '../src/narration/remote';
import { TourEngine } from '../src/engine';
import type { SpeakCallbacks } from '../src/narration/narrator';
import type { Tour } from '../src/types';
const audio: SpeechAudio = {
  audioBase64: 'UklGRg==',
  mimeType: 'audio/wav',
  durationMs: 1000,
  wordTimesMs: [0, 250, 650],
  timing: 'provider',
  provider: 'local',
  model: 'qwen3-tts-0.6b',
  voice: 'Ryan',
  cached: false,
};
function settings(provider: 'local' | 'elevenlabs' = 'local'): SpeechSettings {
  return {
    version: 'one',
    preferences: { ...structuredClone(DEFAULT_SPEECH_PREFERENCES), provider },
    providers: {} as SpeechSettings['providers'],
  };
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
class TestAudio extends EventTarget {
  static instances: TestAudio[] = [];
  playbackRate = 1;
  currentTime = 0;
  duration = 1;
  readyState = 0;
  playing = false;
  onloadedmetadata: (() => void) | null = null;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(readonly src: string) {
    super();
    TestAudio.instances.push(this);
  }
  ready() {
    this.readyState = 1;
    this.onloadedmetadata?.();
  }
  play() {
    this.playing = true;
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }
  pause() {
    this.playing = false;
  }
  removeAttribute() {}
  load() {}
}
Object.defineProperty(globalThis, 'Audio', { configurable: true, value: TestAudio });
const request = {
  text: 'one two three',
  words: ['one', 'two', 'three'],
  speaker: 'host',
  voice: { rate: 1.2, lang: 'en-US' },
  rate: 1,
};

await test('long source passages are split without truncating, reordering or changing any word', () => {
  const words = Array.from({ length: 2000 }, (_, i) => `source${i}${i % 20 === 19 ? '.' : ''}`);
  const chunks = audioChunks(words);
  assert(chunks.every((chunk) => chunk.text.length <= 600));
  deepEqual(
    chunks.flatMap((chunk) => chunk.text.split(' ')),
    words,
  );
  assert(
    chunks.every(
      (chunk, index) => chunk.start === chunks.slice(0, index).reduce((n, previous) => n + previous.count, 0),
    ),
  );
});
await test('pending and cached audio are shared while version/language changes produce distinct requests', async () => {
  let calls = 0;
  const cache = new SpeechAudioCache(async () => {
    calls++;
    await tick();
    return audio;
  });
  const input = { text: 'Original words', language: 'en-US', version: 'one' };
  await Promise.all([cache.get(input), cache.get(input)]);
  await cache.get(input);
  equal(calls, 1);
  await cache.get({ ...input, language: 'de-DE' });
  await cache.get({ ...input, version: 'two' });
  equal(calls, 3);
});
await test('cancelling during real-provider preparation prevents all later audio and callbacks', async () => {
  let resolve: (value: SpeechAudio) => void = () => {};
  const waiting = new Promise<SpeechAudio>((done) => {
    resolve = done;
  });
  const narrator = new ProviderNarrator(settings(), new SpeechAudioCache(async () => waiting));
  const before = TestAudio.instances.length;
  let words = 0,
    ends = 0,
    errors = 0;
  const handle = narrator.speak(request, {
    onWord() {
      words++;
    },
    onEnd() {
      ends++;
    },
    onError() {
      errors++;
    },
  });
  handle.cancel();
  resolve(audio);
  await tick();
  equal(TestAudio.instances.length, before);
  deepEqual([words, ends, errors], [0, 0, 0]);
});
await test('seek uses returned timestamps; live speed changes and resume reuse cached audio', async () => {
  let calls = 0;
  const narrator = new ProviderNarrator(
    settings(),
    new SpeechAudioCache(async () => {
      calls++;
      return audio;
    }),
  );
  const words: number[] = [];
  const cb = {
    onWord(word: number) {
      words.push(word);
    },
    onEnd() {},
  };
  const handle = narrator.speak({ ...request, startWord: 1 }, cb);
  await tick();
  const element = TestAudio.instances.at(-1)!;
  element.ready();
  await tick();
  equal(element.currentTime, 0.25);
  equal(element.playbackRate, 1.2);
  deepEqual(words, [1]);
  handle.setRate?.(1.5);
  assert(Math.abs(element.playbackRate - 1.8) < 0.00001);
  handle.cancel();
  equal(element.playing, false);
  const resumed = narrator.speak({ ...request, startWord: 2 }, cb);
  await tick();
  const next = TestAudio.instances.at(-1)!;
  next.ready();
  await tick();
  equal(next.currentTime, 0.65);
  equal(calls, 1);
  resumed.cancel();
});
await test('cloud lookahead requires explicit opt-in and provider failures pause the engine visibly', async () => {
  let calls = 0;
  const prefs = settings('elevenlabs');
  const cache = new SpeechAudioCache(async () => {
    calls++;
    return audio;
  });
  const narrator = new ProviderNarrator(prefs, cache);
  await narrator.preload(request);
  equal(calls, 0);
  prefs.preferences.precompute = true;
  await narrator.preload(request);
  equal(calls, 1);
  const tour: Tour = {
    schema: 'paper-tour/tour@0.1',
    paper: 'test',
    title: 'Test',
    chapters: [
      {
        id: 'c',
        title: 'C',
        steps: [
          { id: 's', say: 'one two three', actions: [] },
          { id: 'next', say: 'four', actions: [] },
        ],
      },
    ],
  };
  let callbacks: SpeakCallbacks | undefined;
  const engine = new TourEngine(tour, {
    narrator: {
      name: 'provider',
      speak(_req, cb) {
        callbacks = cb;
        return { cancel() {} };
      },
    },
  });
  engine.play();
  callbacks!.onWord(1);
  callbacks!.onError!(new Error('Provider quota exhausted.'));
  equal(engine.getState().status, 'paused');
  equal(engine.getState().speechError, 'Provider quota exhausted.');
  equal(engine.getState().index, 0);
  callbacks!.onEnd();
  equal(engine.getState().status, 'paused');
  equal(engine.getState().index, 0);
});

await test('prepared German readings retain their language through the shared tour/answer engine', async () => {
  const tour: Tour = {
    schema: 'paper-tour/tour@0.1',
    paper: 'test',
    title: 'Test',
    chapters: [{ id: 'c', title: 'C', steps: [{ id: 's', say: 'Ein deutscher Satz.', actions: [] }] }],
  };
  let language: string | undefined;
  const engine = new TourEngine(tour, {
    prepareNarration: async () => ({ say: 'Ein deutscher Satz.', language: 'de-DE' }),
    narrator: {
      name: 'provider',
      speak(req) {
        language = req.voice?.lang;
        return { cancel() {} };
      },
    },
  });
  engine.play();
  await tick();
  equal(language, 'de-DE');
  engine.pause();
});

await test('failed lookahead is not retried by word updates; foreground playback can retry', async () => {
  let calls = 0;
  const narrator = new ProviderNarrator(
    settings(),
    new SpeechAudioCache(async () => {
      calls++;
      throw new Error('Provider unavailable');
    }),
  );
  await narrator.preload(request).catch(() => {});
  await narrator.preload(request);
  await narrator.preload(request);
  equal(calls, 1);
  let errors = 0;
  const handle = narrator.speak(request, {
    onWord() {},
    onEnd() {},
    onError() {
      errors++;
    },
  });
  await tick();
  equal(calls, 2);
  equal(errors, 1);
  handle.cancel();
});

if (failures) throw new Error(`${failures} speech tests failed`);
