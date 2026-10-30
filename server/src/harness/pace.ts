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
   * narration stops asking and takes the degrade rung (degrade.ts): it keeps the narration and loses what failed.
   */
  stepMs: number;
  /** The least time a repair call gets, however little is left of the step's time. */
  repairMs: number;
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

export const PACE: Pace = {
  callMs: (name, effort) => (name === 'beat_direction' ? (effort === 'low' ? 30 : 45) : (SECONDS[name] ?? 60)) * 1000,
  stepMs: 40_000,
  repairMs: 15_000,
};

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
