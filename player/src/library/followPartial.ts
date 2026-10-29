import type { TourGenerationStatus, TourPartialView } from '../../../shared/contracts';
import { POLL_MS, acceptPartial, isRunning } from '../partialTour';
import type { HeldPartial } from '../partialTour';
import { ApiRequestError } from './client';

/** Where the leading steps of a tour come from: the server's endpoint, or a stand-in for it while testing. */
export interface PartialSource {
  /** What is followed; following starts over when it changes. */
  key: string;
  fetch(held: HeldPartial | null, signal: AbortSignal): Promise<TourPartialView>;
}

export interface PartialFollow {
  /** The latest leading steps of the tour, kept after the generation stops so that what played can go on playing. */
  held: HeldPartial | null;
  /** The generation's status as the last poll saw it; null before the first. */
  status: TourGenerationStatus | null;
}

/** Errors that no retry mends: the learner is signed out, the generation is gone, or this server has no partial tours. */
const FINAL = [401, 403, 404, 503];

const sleepFor = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const finish = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', finish);
      resolve();
    };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
  });

/**
 * Ask a generation for its leading steps until it is no longer running or `signal` aborts. Each poll sends what is
 * held (`held.current`, updated here), so the server answers with counts alone until there is something new. `report` is
 * called with what is held and the status after every answer; `settled` once, with the final status, when the generation
 * finished, failed or was stopped. A connection that comes and goes is asked again a little less often each time; an
 * error that no retry mends ends the poll quietly (the manifest still brings the finished tour).
 */
export async function followPartial(
  source: PartialSource,
  held: { current: HeldPartial | null },
  report: (follow: PartialFollow) => void,
  settled: (status: TourGenerationStatus) => void,
  signal: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void> = sleepFor,
): Promise<void> {
  let failures = 0;
  while (!signal.aborted) {
    let wait = POLL_MS;
    try {
      const view = await source.fetch(held.current, signal);
      if (signal.aborted) return;
      failures = 0;
      held.current = acceptPartial(held.current, view);
      report({ held: held.current, status: view.status });
      if (!isRunning(view.status)) return settled(view.status);
    } catch (error) {
      if (signal.aborted) return;
      if (error instanceof ApiRequestError && FINAL.includes(error.status)) return;
      wait = Math.min(8000, POLL_MS * 2 ** Math.min(++failures, 3));
    }
    await sleep(wait, signal);
  }
}
