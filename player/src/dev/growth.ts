// Development only (the demo reader, `?paper=NAME&grow=5`): a stand-in for the server's partial tours, so a tour that
// grows can be watched without generating one. The tour in the paper's folder is handed out a few steps at a time, the
// way the endpoint hands out the leading steps of a tour being written, and the whole tour arrives at the end.
//
//   grow=SECONDS        seconds between one new step and the next (a bare `grow` means 6)
//   growFrom=N          steps ready at the start (default 2)
//   growStop=N[:KIND]   the generation stops after N steps, as `failed` (default) or `cancelled`
//   growRestart=N[:new] when N steps are ready the attempt starts again, from the first steps, with the same ids (or,
//                       with `new`, with other ids: the tour was written differently)

import type { TourGenerationStatus, TourPartialView } from '../../../shared/contracts';
import type { PartialSource } from '../library/usePartialTour';
import { countSteps } from '../partialTour';
import type { Tour } from '../types';

export interface GrowthPlan {
  first: number;
  every: number;
  stop?: { after: number; status: 'failed' | 'cancelled' };
  restart?: { at: number; renamed: boolean };
}

export function readGrowthPlan(query: URLSearchParams): GrowthPlan | null {
  if (!query.has('grow')) return null;
  const whole = (key: string) => {
    const value = Number(query.get(key));
    return query.get(key) && Number.isInteger(value) && value >= 1 ? value : null;
  };
  const seconds = Number(query.get('grow'));
  const [after, kind] = (query.get('growStop') ?? '').split(':');
  const stopAfter = Number(after);
  const [restartAt, restartKind] = (query.get('growRestart') ?? '').split(':');
  const restart = Number(restartAt);
  return {
    first: whole('growFrom') ?? 2,
    every: Number.isFinite(seconds) && seconds > 0 ? Math.min(60, seconds) : 6,
    ...(Number.isInteger(stopAfter) && stopAfter >= 1
      ? { stop: { after: stopAfter, status: kind === 'cancelled' ? ('cancelled' as const) : ('failed' as const) } }
      : {}),
    ...(Number.isInteger(restart) && restart >= 1 ? { restart: { at: restart, renamed: restartKind === 'new' } } : {}),
  };
}

/** The tour of its first `count` steps, without the chapters that have none yet. */
export function leadingSteps(tour: Tour, count: number): Tour {
  let left = count;
  const chapters = tour.chapters
    .map((chapter) => {
      const steps = chapter.steps.slice(0, Math.max(0, left));
      left -= steps.length;
      return { ...chapter, steps };
    })
    .filter((chapter) => chapter.steps.length);
  return { ...tour, chapters };
}

/** The tour with other step ids, as one written differently has. */
function renamedIf(renamed: boolean, tour: Tour): Tour {
  if (!renamed) return tour;
  return {
    ...tour,
    chapters: tour.chapters.map((chapter) => ({ ...chapter, steps: chapter.steps.map((step) => ({ ...step, id: `${step.id}~2` })) })),
  };
}

/** The server's answer at one moment of a simulated generation, for what the client holds (the endpoint's rules). */
export function simulatedView(
  tour: Tour,
  plan: GrowthPlan,
  elapsedMs: number,
  held: { ready: number; attempt: string } | null,
): TourPartialView {
  const total = countSteps(tour);
  const grown = plan.first + Math.floor(elapsedMs / (plan.every * 1000));
  const restarted = !!plan.restart && grown >= plan.restart.at;
  let ready = Math.min(total, restarted ? plan.first + grown - plan.restart!.at : grown);
  let status: TourGenerationStatus = 'generating';
  if (plan.stop) {
    // The steps up to the stop are handed out first; the generation stops when the next one would have come.
    if (ready > plan.stop.after) status = plan.stop.status;
    ready = Math.min(ready, plan.stop.after);
  } else if (ready >= total) status = 'ready';
  const view = { generationId: 'simulated', stage: 'writing' as const };
  if (status !== 'generating')
    return { ...view, status, tourId: status === 'ready' ? 'simulated-tour' : null, attempt: null, ready: 0, planned: 0, tour: null };
  const attempt = restarted ? 'attempt-2' : 'attempt-1';
  const same = held?.attempt === attempt && held.ready >= ready;
  return {
    ...view,
    status,
    tourId: null,
    attempt,
    ready,
    planned: total,
    tour: same ? null : renamedIf(restarted && plan.restart!.renamed, leadingSteps(tour, ready)),
  };
}

export function simulatedSource(tour: Tour, plan: GrowthPlan, now: () => number = Date.now): PartialSource {
  const start = now();
  return { key: 'simulated', fetch: async (held) => simulatedView(tour, plan, now() - start, held) };
}
