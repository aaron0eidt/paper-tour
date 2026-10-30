import type { Voice } from '../types';

const normalizeLanguage = (lang: string) => lang.toLowerCase().replace(/_/g, '-');

export function voiceId(voice: SpeechSynthesisVoice): string {
  return voice.voiceURI || `${voice.name}:${voice.lang}`;
}

export function isGoogleVoice(voice: SpeechSynthesisVoice): boolean {
  return /^google(?:\s|$)/i.test(voice.name);
}

// macOS lists its joke and sound-effect voices beside the real ones; a tutor never narrates with them.
const NOVELTY = new Set([
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos', 'deranged', 'good news', 'hysterical', 'jester',
  'organ', 'pipe organ', 'superstar', 'trinoids', 'whisper', 'wobble', 'zarvox',
]);

export function isNoveltyVoice(voice: SpeechSynthesisVoice): boolean {
  return NOVELTY.has(voice.name.trim().toLowerCase());
}

export function browserSpeech(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

export function readVoices(synth: SpeechSynthesis | null = browserSpeech()): SpeechSynthesisVoice[] {
  if (!synth) return [];
  try {
    const unique = new Map<string, SpeechSynthesisVoice>();
    for (const voice of synth.getVoices()) if (!isNoveltyVoice(voice)) unique.set(voiceId(voice), voice);
    return [...unique.values()];
  } catch { return []; }
}

/** Prefer an available Google voice in the requested language over legacy demo voice hints. */
export function pickVoice(voices: SpeechSynthesisVoice[], want?: Voice, selectedVoiceId = ''): SpeechSynthesisVoice | undefined {
  const explicit = selectedVoiceId ? voices.find((voice) => voiceId(voice) === selectedVoiceId) : undefined;
  if (explicit) return explicit;
  if (!voices.length) return undefined;
  const lang = normalizeLanguage(want?.lang || voices.find((voice) => voice.default)?.lang || (typeof navigator === 'undefined' ? 'en-US' : navigator.language));
  const base = lang.split('-')[0];
  const pool = voices.filter((voice) => normalizeLanguage(voice.lang).split('-')[0] === base);
  if (!pool.length) return undefined;
  const hint = want?.name_hint?.toLowerCase();
  const score = (voice: SpeechSynthesisVoice) =>
    (isGoogleVoice(voice) ? 1000 : 0) +
    (normalizeLanguage(voice.lang) === lang ? 200 : 0) +
    (/\b(natural|neural|premium|enhanced)\b/i.test(voice.name) ? 80 : 0) +
    (hint && voice.name.toLowerCase().includes(hint) ? 30 : 0) +
    (voice.default ? 10 : 0);
  return [...pool].sort((a, b) => score(b) - score(a))[0];
}

/** Keep listening after the initial wait: Chrome may announce additional voices later. */
export function watchVoices(onChange: (voices: SpeechSynthesisVoice[], loading: boolean) => void, synth: SpeechSynthesis | null = browserSpeech(), waitMs = 2000): () => void {
  if (!synth) { onChange([], false); return () => {}; }
  let stopped = false;
  let timedOut = false;
  let poll: ReturnType<typeof setInterval> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const publish = () => {
    if (stopped) return;
    const voices = readVoices(synth);
    onChange(voices, !voices.length && !timedOut);
    if (voices.length || timedOut) clearInterval(poll);
  };
  synth.addEventListener('voiceschanged', publish);
  poll = setInterval(publish, 150);
  timeout = setTimeout(() => { timedOut = true; publish(); }, waitMs);
  publish();
  return () => {
    stopped = true;
    clearInterval(poll); clearTimeout(timeout);
    synth.removeEventListener('voiceschanged', publish);
  };
}

const initialized = new WeakSet<SpeechSynthesis>();

/** Wait once for initial voices; always query again so later voices are never cached out. */
export function loadVoices(synth: SpeechSynthesis | null = browserSpeech(), waitMs = 2000): Promise<SpeechSynthesisVoice[]> {
  const voices = readVoices(synth);
  if (voices.length || !synth || initialized.has(synth)) return Promise.resolve(voices);
  return new Promise((resolve) => {
    let stop = () => {};
    // watchVoices publishes synchronously once, so cleanup is deferred to a microtask.
    stop = watchVoices((available, loading) => {
      if (available.length || !loading) { queueMicrotask(() => { stop(); initialized.add(synth); resolve(available); }); }
    }, synth, waitMs);
  });
}
