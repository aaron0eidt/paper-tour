import { materializeTour } from '../muse/schema';
import type { TourPartial } from '../tour-partial';
import { assertReviewedState } from './chapter-visuals';
import type { RunState, ToolScope } from './tools';

/** Publish only the contiguous, validated beginning of the agent's own teaching plan. */
export function agentPartial(state: RunState, scope: ToolScope, audits: ReadonlySet<string>): TourPartial | null {
  const plan: RunState['plan'] = [];
  for (const chapter of state.plan) {
    if (!state.chapters[chapter.id]) break;
    plan.push(chapter);
  }
  if (!plan.length) return null;
  const chapters = Object.fromEntries(plan.map(({ id }) => [id, state.chapters[id]]));
  assertReviewedState(scope, { ...state, plan, chapters }, audits);
  const { tour } = materializeTour(
    { title: state.title, chapters: plan.map(({ id }) => chapters[id]) },
    scope.doc,
    scope.documentId,
    scope.language,
    true,
  );
  const ready = tour.chapters.reduce((count, chapter) => count + chapter.steps.length, 0);
  return { tour, ready, planned: Math.max(ready, Math.ceil((ready * state.plan.length) / plan.length)) };
}
