import type { TourGenerationSummary } from '../../../shared/contracts';

export function isTourGenerationActive(generation?: TourGenerationSummary | null): boolean {
  return generation?.status === 'queued' || generation?.status === 'generating';
}

export interface TourGenerationCopy {
  title: string;
  detail: string;
  kind: 'pending' | 'ready' | 'failed' | 'unavailable' | 'idle';
  action: 'Create tour' | 'Retry tour' | null;
}

/** Shared reader/library copy. Provider diagnostics stay out of the reading interface. */
export function tourGenerationCopy(generation?: TourGenerationSummary | null): TourGenerationCopy {
  if (!generation)
    return {
      title: 'Create a guided tour',
      detail: 'Explore the paper with explanations, highlights and figures.',
      kind: 'idle',
      action: 'Create tour',
    };
  switch (generation.status) {
    case 'needs_configuration':
      return {
        title: 'Tour creation is not configured yet.',
        detail: 'You can keep reading this PDF.',
        kind: 'unavailable',
        action: 'Retry tour',
      };
    case 'paused':
      return {
        title: 'Tour generation paused',
        detail: generation.error ?? 'Resume from the Activity panel.',
        kind: 'pending',
        action: null,
      };
    case 'cancelled':
      return {
        title: 'Tour generation cancelled',
        detail: 'Saved tours are kept.',
        kind: 'idle',
        action: 'Create tour',
      };
    case 'failed':
      return {
        title: 'Tour creation interrupted',
        detail: 'Your PDF is still available. Retry to create its tour.',
        kind: 'failed',
        action: 'Retry tour',
      };
    case 'ready':
      return { title: 'Tour ready', detail: 'Saved with this paper.', kind: 'ready', action: null };
    case 'queued':
      return {
        title: 'Tour queued',
        detail: 'You can read the paper while its tour is prepared.',
        kind: 'pending',
        action: null,
      };
    case 'generating': {
      switch (generation.stage) {
        case 'preparing':
          return {
            title: 'Reading the paper',
            detail: 'Finding the main ideas and their supporting passages.',
            kind: 'pending',
            action: null,
          };
        case 'images': {
          const total = Math.max(0, Math.floor(generation.imagesTotal));
          const done = Math.min(total, Math.max(0, Math.floor(generation.imagesDone)));
          return {
            title: 'Reading the paper and figures',
            detail: total ? `${done} of ${total} images reviewed.` : 'Examining the paper’s figures and tables.',
            kind: 'pending',
            action: null,
          };
        }
        case 'writing':
          return {
            title: 'Writing your guided tour',
            detail: 'Connecting explanations to passages and figures.',
            kind: 'pending',
            action: null,
          };
        case 'validating':
          return {
            title: 'Checking your tour',
            detail: 'Checking the passages and figures used in the explanation.',
            kind: 'pending',
            action: null,
          };
      }
    }
  }
}
