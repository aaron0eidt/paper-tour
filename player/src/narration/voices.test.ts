import { loadVoices, pickVoice, readVoices, voiceId, watchVoices } from './voices';
import { WebSpeechNarrator } from './webSpeech';

const results: string[] = [];
let failures = 0;
async function test(name: string, fn: () => void | Promise<void>) {
  try { await fn(); results.push(`  ok    ${name}`); }
  catch (error) { failures++; results.push(`  FAIL  ${name}\n        ${(error as Error).message}`); }
}
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
function voice(name: string, lang = 'en-US', localService = true, isDefault = false): SpeechSynthesisVoice {
  return { name, lang, localService, default: isDefault, voiceURI: `${name}:${lang}` };
}
const samantha = voice('Samantha', 'en-US', true, true);
const daniel = voice('Daniel', 'en-GB');
const google = voice('Google US English', 'en-US', false);

class VoiceSource extends EventTarget {
  voices: SpeechSynthesisVoice[] = [];
  getVoices() { return this.voices; }
  controller() { return this as unknown as SpeechSynthesis; }
  changed() { this.dispatchEvent(new Event('voiceschanged')); }
}

await test('Google voice wins over local service and legacy per-speaker demo hints', () => {
  const voices = [samantha, daniel, google];
  equal(pickVoice(voices, { lang: 'en-US', name_hint: 'Samantha' })?.name, google.name);
  equal(pickVoice(voices, { lang: 'en-US', name_hint: 'Daniel' })?.name, google.name);
});

await test('automatic selection respects the paper language and normalizes locales', () => {
  const german = voice('Google Deutsch', 'de-DE', false);
  equal(pickVoice([german, samantha], { lang: 'en_US' })?.name, 'Samantha');
  equal(pickVoice([german, samantha], { lang: 'de-AT' })?.name, german.name);
  equal(pickVoice([german, samantha], { lang: 'fr-FR' }), undefined);
});

await test('exact Google locale wins; an explicit available voice overrides automatic mode', () => {
  const british = voice('Google UK English Female', 'en-GB', false);
  equal(pickVoice([british, samantha, google], { lang: 'en-US' })?.name, google.name);
  equal(pickVoice([samantha, daniel, google], { lang: 'en-US' }, voiceId(daniel))?.name, daniel.name);
  equal(pickVoice([samantha, google], { lang: 'en-US' }, 'not-installed')?.name, google.name);
});

await test('natural fallback is preferred when the requested language has no Google voice', () => {
  const natural = voice('Microsoft Jenny Online (Natural)', 'en-US', false);
  equal(pickVoice([samantha, natural], { lang: 'en-US' })?.name, natural.name);
});

await test('voice loading waits for a populated voiceschanged event and removes listeners', async () => {
  const source = new VoiceSource();
  const loading = loadVoices(source.controller(), 50);
  source.changed(); // An empty event must not permanently cache an empty list.
  source.voices = [google]; source.changed();
  equal((await loading).map((item) => item.name), [google.name]);
  equal(readVoices(source.controller()).length, 1);
});

await test('empty timeout is bounded, and voices that arrive later are still discovered', async () => {
  const source = new VoiceSource();
  equal(await loadVoices(source.controller(), 5), []);
  const observed: number[] = [];
  const stop = watchVoices((voices, loading) => { if (!loading) observed.push(voices.length); }, source.controller(), 5);
  await sleep(10);
  source.voices = [samantha, google]; source.changed();
  stop();
  source.voices = []; source.changed();
  equal(observed, [0, 2]);
  source.voices = [google];
  equal((await loadVoices(source.controller(), 5))[0].name, google.name);
});

await test('network voice without word boundaries retains timed word progress and cancellation', async () => {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalUtterance = Object.getOwnPropertyDescriptor(globalThis, 'SpeechSynthesisUtterance');
  const source = new VoiceSource();
  source.voices = [samantha, google];
  let utterance: SpeechSynthesisUtterance | null = null;
  const synth = Object.assign(source, {
    speaking: false, pending: false, paused: false,
    speak(value: SpeechSynthesisUtterance) {
      utterance = value;
      queueMicrotask(() => value.onstart?.(new Event('start') as SpeechSynthesisEvent));
    },
    cancel() {}, resume() {},
  });
  class Utterance {
    voice: SpeechSynthesisVoice | null = null;
    lang = ''; rate = 1;
    onstart: ((event: SpeechSynthesisEvent) => void) | null = null;
    onend: ((event: SpeechSynthesisEvent) => void) | null = null;
    onboundary: ((event: SpeechSynthesisEvent) => void) | null = null;
    onerror: ((event: SpeechSynthesisErrorEvent) => void) | null = null;
    constructor(readonly text: string) {}
  }
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { speechSynthesis: synth } });
  Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', { configurable: true, value: Utterance });
  try {
    const words: number[] = [];
    let ended = 0;
    const handle = new WebSpeechNarrator().speak({ text: 'one two three four', words: ['one', 'two', 'three', 'four'], speaker: 'host', voice: { lang: 'en-US', name_hint: 'Samantha' }, rate: 2 }, { onWord: (word) => words.push(word), onEnd: () => ended++ });
    await sleep(260);
    equal((utterance as SpeechSynthesisUtterance | null)?.voice?.name, google.name);
    equal(words[0], 0);
    equal(words.length > 1, true);
    equal(words.every((word, i) => word < 4 && (i === 0 || word > words[i - 1])), true);
    handle.cancel();
    const count = words.length;
    await sleep(220);
    equal([words.length, ended], [count, 0]);
  } finally {
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow); else Reflect.deleteProperty(globalThis, 'window');
    if (originalUtterance) Object.defineProperty(globalThis, 'SpeechSynthesisUtterance', originalUtterance); else Reflect.deleteProperty(globalThis, 'SpeechSynthesisUtterance');
  }
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} voice test(s) failed`);
console.log(`\nall ${results.length} voice tests passed`);
