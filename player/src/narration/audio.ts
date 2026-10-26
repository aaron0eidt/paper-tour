import { clamp, msPerWord, runTimeline } from './narrator';
import type { NarrationHandle, Narrator, SpeakCallbacks, SpeakRequest } from './narrator';

/** Plays a step's pre-rendered `audio`; word progress from word_times_ms or a uniform estimate. */
export class AudioNarrator implements Narrator {
  readonly name = 'audio';
  private baseUrl: string;

  /** `baseUrl` is the paper folder; audio.src is relative to it. */
  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  speak(req: SpeakRequest, cb: SpeakCallbacks): NarrationHandle {
    const n = req.words.length;
    const rate = clamp(req.rate, 0.5, 4);
    const el = new Audio(new URL(req.audio!.src, new URL(this.baseUrl, location.href)).href);
    el.playbackRate = rate;

    let done = false;
    let last = -1;
    let poll: ReturnType<typeof setInterval> | undefined;
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let stopFallback: (() => void) | undefined;

    const cleanup = () => {
      clearInterval(poll);
      clearTimeout(watchdog);
      el.onended = el.onerror = null;
      el.pause();
      el.removeAttribute('src');
      el.load();
    };
    const emit = (i: number) => {
      if (!done && i > last) {
        last = i;
        cb.onWord(i);
      }
    };
    const finish = () => {
      if (done) return;
      emit(n - 1);
      done = true;
      cleanup();
      cb.onEnd();
    };
    const fallback = (reason: unknown) => {
      if (done || stopFallback) return;
      console.warn('[audio] falling back to timed narration:', reason);
      cleanup();
      stopFallback = runTimeline(last + 1, n, msPerWord(rate), emit, finish);
    };

    // Start time of each word in ms of audio time.
    const wordTimes = (): number[] => {
      const given = req.audio!.word_times_ms;
      if (given && given.length === n) return given;
      const total = req.audio!.duration_ms ?? (Number.isFinite(el.duration) ? el.duration * 1000 : n * msPerWord(1));
      return req.words.map((_, i) => (i * total) / n);
    };

    el.onended = finish;
    el.onerror = () => fallback(el.error?.message || 'audio error');
    el.play().then(
      () => {
        if (done || stopFallback) return;
        poll = setInterval(() => {
          const t = el.currentTime * 1000;
          const times = wordTimes();
          let i = last;
          while (i + 1 < n && times[i + 1] <= t) i++;
          emit(i);
        }, 50);
      },
      fallback,
    );
    const expected = (req.audio!.duration_ms ?? n * msPerWord(1)) / rate;
    watchdog = setTimeout(() => fallback('audio did not finish in time'), expected * 2 + 5000);

    return {
      cancel() {
        if (done) return;
        done = true;
        stopFallback?.();
        cleanup();
      },
      setRate(r) {
        if (!done && !stopFallback) el.playbackRate = clamp(r, 0.5, 4);
      },
    };
  }
}
