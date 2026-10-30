// Progressive tours in the reader. While a tour is written, the server offers the leading steps that are finished
// (TourPartialView, shared/contracts.ts); the reader plays them and the rest joins as it is written. What the reader
// holds, how each poll updates it and how it is described to the learner. Pure, so it can be tested without a network.

import type { TourGenerationStatus, TourPartialView } from '../../shared/contracts';
import { checkTour } from './validate';
import type { Doc, Tour } from './types';

/** How often a running generation is asked for its next steps. */
export const POLL_MS = 1500;

/** The generation is still at work: it has not finished, failed or been stopped. */
export function isRunning(status: TourGenerationStatus | null | undefined): boolean {
  return status === 'queued' || status === 'generating';
}

/**
 * The generation's status as the reader shows it. While the generation runs, the poll's is the freshest (it knows the
 * stage a manifest refresh has not caught up with). The poll stops when the generation does, and the manifest goes on:
 * once either says it is no longer running, the manifest's word stands.
 */
export function currentStatus(
  manifest: TourGenerationStatus | null | undefined,
  polled: TourGenerationStatus | null,
): TourGenerationStatus | null {
  if (manifest && (!isRunning(polled) || !isRunning(manifest))) return manifest;
  return polled ?? manifest ?? null;
}

/** The partial tour the reader holds: the first steps of one attempt of one generation. */
export interface HeldPartial {
  generationId: string;
  /** One run of the generator; after a retry it changes and the steps may differ. */
  attempt: string;
  /** The server's count, sent back with the attempt so an unchanged partial is not sent again. */
  ready: number;
  /** The whole tour's step count, an estimate that never falls below what is held. */
  planned: number;
  tour: Tour;
}

export function countSteps(tour: Tour): number {
  return tour.chapters.reduce((n, chapter) => n + chapter.steps.length, 0);
}

/** What plays, for growsInPlace: a saved tour by its id, or a tour still being written by its generation. */
export function tourSourceKey(savedId: string | null | undefined, saved: boolean, generationId: string | null | undefined): string {
  return saved ? `tour:${savedId ?? 'local'}` : `generation:${generationId ?? 'local'}`;
}

/**
 * Whether the tour that arrives grows the one that plays (TourEngine.extend) instead of replacing it: the same source
 * again, or a tour being written arriving as the tour it was saved as. A saved tour the learner picked always replaces
 * what plays. Step IDs cannot decide it: claim-based tours of one document share IDs such as idea-1 and method-1.
 */
export function growsInPlace(held: { key: string; partial: boolean } | null, key: string, picked: boolean): boolean {
  return !!held && !picked && (held.key === key || (held.partial && key.startsWith('tour:')));
}

/** The request for a generation's partial tour; a client that holds one of it asks only for what is new. */
export function partialPath(documentId: string, generationId: string, held: HeldPartial | null): string {
  const base = `/api/documents/${encodeURIComponent(documentId)}/generations/${encodeURIComponent(generationId)}/partial`;
  return held && held.generationId === generationId ? `${base}?after=${held.ready}&attempt=${held.attempt}` : base;
}

/**
 * What the reader holds after a poll. A longer partial of the same attempt replaces the held one, another attempt or
 * generation replaces it whatever it holds (its steps may differ), and a poll that carries only counts, or nothing newer,
 * leaves it as it is. The same object comes back when nothing changed, so that nothing re-renders.
 */
export function acceptPartial(held: HeldPartial | null, view: TourPartialView): HeldPartial | null {
  const same = !!held && held.generationId === view.generationId && held.attempt === view.attempt;
  if (!view.tour || !view.attempt) {
    // Counts only: the plan may change as steps are finished.
    if (held && same && view.planned > held.planned) return { ...held, planned: view.planned };
    return held;
  }
  if (same && view.ready <= held!.ready) return held;
  return {
    generationId: view.generationId,
    attempt: view.attempt,
    ready: view.ready,
    planned: Math.max(view.planned, view.ready, countSteps(view.tour)),
    tour: view.tour,
  };
}

/**
 * A held partial the player can play, or null when it cannot be: another document's tour or one the player rejects. Its
 * steps carry no recorded audio: a partial is spoken by the browser's voice, like any tour without audio.
 */
export function playablePartial(held: HeldPartial | null, doc: Doc | null): Tour | null {
  const tour = held?.tour;
  if (!tour || !doc || checkTour(tour).length) return null;
  if (tour.doc_sha256 && tour.doc_sha256 !== doc.source.sha256) return null;
  return {
    ...tour,
    chapters: tour.chapters.map((chapter) => ({
      ...chapter,
      steps: chapter.steps.map(({ audio: _audio, ...step }) => step),
    })),
  };
}

/**
 * Where a growing tour stands, for the learner. `writing`: more steps are coming. `retrying`: an attempt failed and
 * another is queued; the held steps stay playable. `stopped`: no more will come, and `reason` says why.
 */
export interface Growth {
  /** Steps the learner can play now. */
  steps: number;
  /** The whole tour's step count, an estimate. */
  planned: number;
  phase: 'writing' | 'retrying' | 'stopped';
  reason?: 'failed' | 'cancelled' | 'paused';
}

export function growthOf(held: HeldPartial | null, status: TourGenerationStatus | null): Growth | null {
  if (!held) return null;
  const steps = countSteps(held.tour);
  const planned = Math.max(held.planned, steps);
  switch (status) {
    case 'queued':
      return { steps, planned, phase: 'retrying' };
    case 'failed':
    case 'needs_configuration':
      return { steps, planned, phase: 'stopped', reason: 'failed' };
    case 'cancelled':
      return { steps, planned, phase: 'stopped', reason: 'cancelled' };
    case 'paused':
      return { steps, planned, phase: 'stopped', reason: 'paused' };
    // `ready` is the moment before the finished tour is loaded: still on its way.
    default:
      return { steps, planned, phase: 'writing' };
  }
}

/**
 * The growth as the learner should see it. What can be played is what the reader holds, and after a retry that has not
 * yet written as far as the attempt before it did, that is more than the new attempt's steps: the counts shown must
 * agree with the list of steps. The same object comes back when nothing changes.
 */
export function withPlayableSteps(growth: Growth | null, playable: number): Growth | null {
  return growth && playable > growth.steps ? { ...growth, steps: playable } : growth;
}

/** What the timeline and the sidebar say while the tour waits for its next step. */
export function writingLabel(growth: Pick<Growth, 'phase'> | null | undefined): string {
  return growth?.phase === 'retrying' ? 'Writing the tour again' : 'Writing the next step';
}

/** A tour that stopped growing, in the learner's words: what happened (`label` is its short form) and what they have. */
export function stoppedCopy(growth: Growth): { label: string; title: string; detail: string } {
  const have = growth.steps === 1 ? 'the first step' : `the first ${growth.steps} steps`;
  switch (growth.reason) {
    case 'cancelled':
      return {
        label: 'Stopped',
        title: 'Tour creation was stopped',
        detail: `You have ${have}. Create the tour again to get the rest.`,
      };
    case 'paused':
      return {
        label: 'Paused',
        title: 'Tour creation is paused',
        detail: `You have ${have}. Resume it from Activity to get the rest.`,
      };
    default:
      return {
        label: 'Stopped early',
        title: 'The tour stopped early',
        detail: `Writing it was interrupted. You have ${have}; use Retry tour above to write the rest.`,
      };
  }
}
