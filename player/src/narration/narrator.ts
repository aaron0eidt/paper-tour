import type { StepAudio, Voice } from '../types';

/** What the engine asks a narrator to say for one step. */
export interface SpeakRequest {
  text: string;
  /** `text` split on whitespace; word indexes refer to this list. */
  words: string[];
  speaker: string;
  voice?: Voice;
  /** Speed multiplier from the UI and the URL; voice.rate is applied on top by the narrator. */
  rate: number;
  audio?: StepAudio;
}

export interface SpeakCallbacks {
  /** Narration has reached word `index` (monotonic, may skip words). */
  onWord(index: number): void;
  /** Narration finished. Called exactly once unless the handle was cancelled first. */
  onEnd(): void;
}

export interface NarrationHandle {
  /** Stop speaking. No callback fires after cancel() returns. */
  cancel(): void;
  /** Change the speed of the narration in progress (same meaning as SpeakRequest.rate). */
  setRate?(rate: number): void;
}

/**
 * A narrator must never stall: on any internal error it falls back to time-based word
 * progress and still calls onEnd.
 */
export interface Narrator {
  readonly name: string;
  speak(req: SpeakRequest, cb: SpeakCallbacks): NarrationHandle;
}

export const WORDS_PER_MINUTE = 165;

export function msPerWord(rate: number): number {
  return 60000 / (WORDS_PER_MINUTE * rate);
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export function voiceRate(req: SpeakRequest): number {
  return req.rate * (req.voice?.rate ?? 1);
}

/**
 * Emit words `from`..`count - 1` on a uniform clock, then onEnd. Shared by the silent narrator
 * and by the fallbacks of the other narrators. Returns a cancel function.
 */
export function runTimeline(
  from: number,
  count: number,
  perWordMs: number,
  onWord: (i: number) => void,
  onEnd: () => void,
): () => void {
  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let next = from;
  const start = Date.now();

  const tick = () => {
    if (cancelled) return;
    const elapsed = Date.now() - start;
    while (next < count && (next - from) * perWordMs <= elapsed) {
      onWord(next++);
      if (cancelled) return;
    }
    const endAt = (count - from) * perWordMs;
    if (next >= count && elapsed >= endAt) {
      cancelled = true;
      onEnd();
      return;
    }
    const due = next < count ? (next - from) * perWordMs : endAt;
    timer = setTimeout(tick, Math.max(0, due - elapsed));
  };
  timer = setTimeout(tick, 0);

  return () => {
    cancelled = true;
    clearTimeout(timer);
  };
}
