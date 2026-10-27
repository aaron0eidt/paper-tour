import { clamp, msPerWord, runTimeline, voiceRate } from './narrator';
import type { NarrationHandle, Narrator, SpeakCallbacks, SpeakRequest } from './narrator';
import { loadVoices, pickVoice } from './voices';
export { pickVoice } from './voices';

// Chrome cuts long utterances off (~15 s for some voices), so a step is spoken as a series of
// sentence-sized utterances while word indexes stay global across them.
const MAX_CHUNK_CHARS = 180;
// An utterance that has not started by then is treated as failed (e.g. speech blocked or broken).
const START_TIMEOUT_MS = 4000;

interface Chunk {
  text: string;
  /** Global index of the chunk's first word. */
  start: number;
  count: number;
  /** Character offset of each word inside `text`. */
  offsets: number[];
}

export function chunkWords(words: string[]): Chunk[] {
  const chunks: Chunk[] = [];
  let cur: string[] = [];
  let start = 0;
  let length = 0;

  const flush = () => {
    if (!cur.length) return;
    const offsets: number[] = [];
    let pos = 0;
    for (const w of cur) {
      offsets.push(pos);
      pos += w.length + 1;
    }
    chunks.push({ text: cur.join(' '), start, count: cur.length, offsets });
    start += cur.length;
    cur = [];
    length = 0;
  };

  for (const w of words) {
    if (cur.length && length + 1 + w.length > MAX_CHUNK_CHARS) flush();
    length += (cur.length ? 1 : 0) + w.length;
    cur.push(w);
    if (/[.!?]["')\]]*$/.test(w) || (length > 120 && /[;:,]$/.test(w))) flush();
  }
  flush();
  return chunks;
}

function wordAtChar(chunk: Chunk, charIndex: number): number {
  let i = 0;
  while (i + 1 < chunk.count && chunk.offsets[i + 1] <= charIndex) i++;
  return i;
}

// Failures that mean speech does not work here at all (when no utterance has ever started).
const FATAL = new Set(['speech did not start', 'not-allowed', 'synthesis-unavailable']);

let lastCancelAt = 0;

export class WebSpeechNarrator implements Narrator {
  readonly name = 'speech';
  /**
   * False once speech has failed in a way that means it does not work in this browser (and has
   * never worked in this narrator); the router then uses timed narration without trying again.
   */
  available = true;
  private worked = false;

  constructor(private readonly selectedVoiceId = '') {}

  speak(req: SpeakRequest, cb: SpeakCallbacks): NarrationHandle {
    const synth = window.speechSynthesis;
    const chunks = chunkWords(req.words);
    const n = req.words.length;
    const rateFor = (r: number) => clamp(voiceRate({ ...req, rate: r }), 0.5, 2);
    let rate = rateFor(req.rate);
    let perWord = msPerWord(rate);
    // Keep strong references: Chrome can garbage-collect an utterance and never fire `end`.
    const utterances: SpeechSynthesisUtterance[] = [];

    let cancelled = false;
    let finished = false;
    let last = -1;
    let estimateTimer: ReturnType<typeof setTimeout> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let startTimer: ReturnType<typeof setTimeout> | undefined;
    let stopFallback: (() => void) | undefined;

    const detach = () => {
      clearTimeout(estimateTimer);
      clearTimeout(watchdog);
      clearTimeout(startTimer);
      for (const u of utterances) u.onstart = u.onend = u.onerror = u.onboundary = null;
    };
    const emit = (i: number) => {
      if (cancelled || finished || i <= last) return;
      last = Math.min(i, n - 1);
      cb.onWord(last);
    };
    const finish = () => {
      if (cancelled || finished) return;
      emit(n - 1);
      finished = true;
      detach();
      cb.onEnd();
    };
    // On any speech failure, finish the remaining words on a timer so the tour keeps going.
    const fallback = (reason: unknown) => {
      if (cancelled || finished || stopFallback) return;
      if (!this.worked && FATAL.has(String(reason))) {
        this.available = false;
        console.warn('[speech] speech does not work here, using timed narration from now on (toggle mute to retry):', reason);
      } else {
        console.warn('[speech] falling back to timed narration:', reason);
      }
      detach();
      if (synth.speaking || synth.pending) synth.cancel();
      stopFallback = runTimeline(last + 1, n, perWord, emit, finish);
    };

    const speakChunk = (i: number, voice?: SpeechSynthesisVoice) => {
      if (cancelled || finished || stopFallback) return;
      if (i >= chunks.length) return finish();
      const chunk = chunks[i];
      const u = new SpeechSynthesisUtterance(chunk.text);
      utterances.push(u);
      if (voice) u.voice = voice;
      u.lang = voice?.lang ?? req.voice?.lang ?? '';
      // An utterance keeps the speed it was spoken with; a speed change applies from the next chunk.
      u.rate = rate;
      const per = perWord;
      if (req.voice?.pitch !== undefined) u.pitch = req.voice.pitch;

      let boundarySeen = false;
      u.onstart = () => {
        this.worked = true;
        clearTimeout(watchdog);
        watchdog = setTimeout(() => fallback('utterance stalled'), chunk.count * per * 3 + 4000);
        emit(chunk.start);
        // Estimate progress from elapsed time until the voice proves it sends word boundaries.
        const startedAt = Date.now();
        const tick = () => {
          if (cancelled || boundarySeen) return;
          const local = Math.floor((Date.now() - startedAt) / per);
          emit(chunk.start + Math.min(local, chunk.count - 1));
          estimateTimer = setTimeout(tick, 100);
        };
        estimateTimer = setTimeout(tick, 100);
      };
      u.onboundary = (e) => {
        if (e.name && e.name !== 'word') return;
        boundarySeen = true;
        emit(chunk.start + wordAtChar(chunk, e.charIndex));
      };
      u.onend = () => {
        clearTimeout(estimateTimer);
        clearTimeout(watchdog);
        emit(chunk.start + chunk.count - 1);
        speakChunk(i + 1, voice);
      };
      u.onerror = (e) => fallback(e.error);

      clearTimeout(watchdog);
      watchdog = setTimeout(() => fallback('speech did not start'), START_TIMEOUT_MS);
      synth.speak(u);
    };

    loadVoices().then((voices) => {
      if (cancelled) return;
      const voice = pickVoice(voices, req.voice, this.selectedVoiceId);
      // Speaking right after cancel() is sometimes dropped by Chrome; give it a moment.
      if (synth.speaking || synth.pending) {
        synth.cancel();
        lastCancelAt = Date.now();
      }
      if (synth.paused) synth.resume();
      const settle = Math.max(0, lastCancelAt + 100 - Date.now());
      startTimer = setTimeout(() => speakChunk(0, voice), settle);
    }, fallback);

    return {
      cancel() {
        if (cancelled) return;
        cancelled = true;
        stopFallback?.();
        detach();
        if (!finished) {
          synth.cancel();
          lastCancelAt = Date.now();
        }
      },
      setRate(r) {
        if (cancelled || finished) return;
        rate = rateFor(r);
        perWord = msPerWord(rate);
        // Timed fallback: re-time the remaining words from the current one.
        if (stopFallback) {
          stopFallback();
          stopFallback = runTimeline(Math.max(0, last), n, perWord, emit, finish);
        }
      },
    };
  }
}
