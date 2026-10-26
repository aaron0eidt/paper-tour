import { clamp, msPerWord, runTimeline, voiceRate } from './narrator';
import type { NarrationHandle, Narrator, SpeakCallbacks, SpeakRequest } from './narrator';

/** Timer-based narration (~165 words per minute divided by the rate). Used when muted or without TTS. */
export class SilentNarrator implements Narrator {
  readonly name = 'silent';

  speak(req: SpeakRequest, cb: SpeakCallbacks): NarrationHandle {
    let last = -1;
    let over = false;
    const run = (rate: number, from: number) =>
      runTimeline(
        from,
        req.words.length,
        msPerWord(clamp(voiceRate({ ...req, rate }), 0.25, 8)),
        (i) => {
          if (i > last) cb.onWord((last = i));
        },
        () => {
          over = true;
          cb.onEnd();
        },
      );
    let stop = run(req.rate, 0);
    return {
      cancel: () => {
        over = true;
        stop();
      },
      // The rest of the step is re-timed from the current word.
      setRate: (rate) => {
        if (over) return;
        stop();
        stop = run(rate, Math.max(0, last));
      },
    };
  }
}
