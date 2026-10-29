import type { Tour } from './paper';
/** Recorded output characteristics, not a subjective quality score. */
export function tourDirection(tour: Tour) {
  const steps = tour.chapters.flatMap((chapter) => chapter.steps);
  const actions: Record<string, number> = {};
  for (const step of steps) for (const action of step.actions) actions[action.type] = (actions[action.type] ?? 0) + 1;
  return {
    steps: steps.length,
    words: steps.reduce((n, step) => n + step.say.trim().split(/\s+/).filter(Boolean).length, 0),
    actions,
  };
}
