import { ProcessingError } from '../errors';
import type { Effort } from './calls';

// How long the tour writer lets things take (notes/ROADMAP.md, "no waiting"). A learner is waiting for the first step,
// and a tour is written in parallel, so one slow call or one step that keeps failing its board holds up everything
// after it. The limits come from the calls measured in real runs: a step took 7.5 s at the median, 21 s at the 90th
// percentile and 59 s at the 99th; a single call at low reasoning effort took at most 25 s, one at medium effort 41 s.

/** The time limits of a generation; tests replace them to make a slow call cheap to provoke. */
export interface Pace {
  /** Longest one call of this name may run, in milliseconds, before it is given up on. */
  callMs: (name: string, effort: Effort) => number;
  /**
   * What one step may spend on repairing its board, worked example or pen marks. Past it, a step that has a usable
   * narration stops asking and takes the degrade rung (degrade.ts): it keeps the narration and loses what failed. A step
   * that has none is not held to it: it is asked again, for less each time (callMs falls with the effort), three tries
   * at least and a few more when its lighter try, and a repair of that, come late.
   */
  stepMs: number;
  /** The least time a repair call gets, however little is left of the step's time. */
  repairMs: number;
  /**
   * The waits before a call the provider could not take (a 5xx or a 429) is sent again, one per retry. Its outages come
   * in bursts of several seconds, which the callers' own quick retries all fell into: 9 steps of 10 tours in one burst.
   */
  outages: readonly number[];
}

const SECONDS: Record<string, number> = {
  paper_card: 40,
  claims: 60,
  tour_plan: 45,
  deck_plan: 45,
  visual_plan: 50,
  opening_visual: 20,
  exercise_solution: 75,
  exercise_visual: 45,
  quick_check: 30,
};

// A step asked again after a call outlived its time reasons a rung less each time, so its limit falls with it: 45 s at
// medium effort and above, 30 s below (generator.ts, the lean tries).
export const PACE: Pace = {
  callMs: (name, effort) =>
    (name === 'beat_direction' ? (effort === 'medium' || effort === 'high' ? 45 : 30) : (SECONDS[name] ?? 60)) * 1000,
  stepMs: 40_000,
  repairMs: 15_000,
  outages: [2_000, 4_000, 8_000],
};

/**
 * Runs a model call, waiting out a provider that could not take it (a transient error: a 5xx or a 429) with the given
 * waits, one per retry, while `again` allows. Any other failure, and the last transient one, goes to the caller.
 */
export async function outlasting<T>(
  signal: AbortSignal,
  waits: readonly number[],
  run: () => Promise<T>,
  again: () => boolean = () => true,
): Promise<T> {
  for (let retry = 0; ; retry++) {
    try {
      return await run();
    } catch (error) {
      const wait = waits[retry];
      if (!(error instanceof ProcessingError) || !error.transient || wait === undefined || signal.aborted || !again())
        throw error;
      await waitOut(signal, wait);
      signal.throwIfAborted();
    }
  }
}

/** Waits the given time, or less when the generation is cancelled meanwhile. */
function waitOut(signal: AbortSignal, ms: number): Promise<void> {
  return new Promise((done) => {
    if (signal.aborted) return done();
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    function finish() {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      done();
    }
  });
}

/**
 * Runs a model call with a time limit. A call that outlives it fails with `muse_slow`, a fault of the model like an
 * invalid answer: the writers retry it at once, where a provider error waits first. Cancelling the generation is not slow.
 */
export async function limited<T>(
  signal: AbortSignal,
  ms: number,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timer = AbortSignal.timeout(ms);
  try {
    return await run(AbortSignal.any([signal, timer]));
  } catch (error) {
    if (timer.aborted && !signal.aborted)
      throw new ProcessingError('muse_slow', `The model took longer than ${Math.round(ms / 1000)} s.`);
    throw error;
  }
}
