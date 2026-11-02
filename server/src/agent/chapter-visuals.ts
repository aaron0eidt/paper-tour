import { AGENT_VERSION } from './instructions';
import { createHash } from 'node:crypto';
import type { BoardItem } from '../../../shared/paper';
import type { DraftStep, TourDraft } from '../muse/schema';
import { isAuthoredVisual, type AuthoredVisual } from '../visuals/inspect';
import { executeTool, type RunState, type ToolScope } from './tools';

type Chapter = TourDraft['chapters'][number];
export type ChapterVisualReviewer = (item: AuthoredVisual, step: DraftStep) => Promise<BoardItem>;
/** A review is invalidated by any change in paper, analysis, explanation, evidence or executable inputs. */
export function visualAuditHash(
  scope: Pick<ToolScope, 'analysisId' | 'doc'>,
  step: DraftStep,
  item: BoardItem,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        version: AGENT_VERSION + '/authored@1',
        analysis: scope.analysisId,
        sourceHash: scope.doc.source.sha256,
        source: step.source,
        evidence: step.evidence,
        say: step.say,
        item,
      }),
    )
    .digest('hex');
}
export function authoredChapterAudits(scope: Pick<ToolScope, 'analysisId' | 'doc'>, chapter: Chapter): string[] {
  return chapter.steps.flatMap((step) =>
    step.actions.flatMap((action) =>
      action.type === 'board' && isAuthoredVisual(action.item) ? [visualAuditHash(scope, step, action.item)] : [],
    ),
  );
}
export function reviewedAudits(results: readonly { result?: unknown }[]): Set<string> {
  const hashes = new Set<string>();
  for (const row of results) {
    const output = (row.result as { output?: unknown })?.output;
    if (!Array.isArray(output)) continue;
    for (const part of output) {
      if (part?.type !== 'input_text' || typeof part.text !== 'string') continue;
      try {
        const value = JSON.parse(part.text);
        if (!value.error && Array.isArray(value.reviewedVisuals))
          for (const hash of value.reviewedVisuals)
            if (typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)) hashes.add(hash);
      } catch {
        /* Non-JSON historical diagnostics are not proof of review. */
      }
    }
  }
  return hashes;
}
export function assertReviewedState(
  scope: Pick<ToolScope, 'analysisId' | 'doc'>,
  state: RunState,
  audits: ReadonlySet<string>,
): void {
  const missing = Object.values(state.chapters).filter((chapter) =>
    authoredChapterAudits(scope, chapter).some((hash) => !audits.has(hash)),
  );
  if (missing.length)
    throw new Error(
      `Authored visuals in saved chapters ${missing.map((chapter) => chapter.id).join(', ')} have not completed rendered inspection. Resubmit those complete chapters with upsert_tour_chapter to inspect and repair them, then call finish_tour again. Your saved work is preserved.`,
    );
}
/** Preflight uses only pure domain transitions. The runner invokes paid review outside its write transaction. */
export async function prepareReviewedChapter(
  scope: ToolScope,
  state: RunState,
  raw: unknown,
  review: ChapterVisualReviewer,
  known: ReadonlySet<string> = new Set(),
) {
  let args = raw;
  if (raw && typeof raw === 'object' && typeof (raw as { chapter?: unknown }).chapter === 'string') {
    try {
      args = { ...raw, chapter: JSON.parse((raw as { chapter: string }).chapter) };
    } catch {
      throw new Error('chapter must be a JSON object with id, title and steps; the supplied JSON string is malformed.');
    }
  }
  const prepared = await executeTool(scope, state, 'upsert_tour_chapter', args);
  const id = (args as { chapter: Chapter }).chapter.id;
  const chapter = structuredClone(prepared.state.chapters[id]);
  for (const step of chapter.steps)
    for (const action of step.actions) {
      if (
        action.type !== 'board' ||
        !isAuthoredVisual(action.item) ||
        known.has(visualAuditHash(scope, step, action.item))
      )
        continue;
      action.item = await review(action.item, step);
      if (!isAuthoredVisual(action.item))
        throw new Error('A visual repair must preserve an authored visual rather than substitute an unreviewed board.');
    }
  const normalized = { chapter };
  // Repair may change code/data, never source identity or narration; repeat domain checks before taking a row lock.
  const checked = await executeTool(scope, state, 'upsert_tour_chapter', normalized);
  return {
    args: { chapter: checked.state.chapters[id] },
    audits: authoredChapterAudits(scope, checked.state.chapters[id]),
  };
}
