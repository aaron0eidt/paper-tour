import type { Doc } from '../../../shared/paper';
import { indexElements } from '../elements';
import { textReadingOrder, walkthroughGoals } from './planning';
import { TourValidationError, type DraftStep, type TourDraft } from './schema';

/** Fill gaps in an otherwise valid walk without rewriting or reordering existing explanations. */
export function mergeCoverageSteps(draft: TourDraft, steps: DraftStep[], doc: Doc): TourDraft {
  const pages = new Map(indexElements(doc).map((element) => [element.id, element.page]));
  const covered = new Set(draft.chapters.flatMap((c) => c.steps.map((s) => pages.get(s.source))));
  const missing = new Set(walkthroughGoals(doc).requiredPages.filter((page) => !covered.has(page)));
  if (!draft.chapters.length || !steps.length || steps.some((s) => !missing.has(pages.get(s.source)!)))
    throw new TourValidationError(['Coverage repair must reference only the missing content pages.']);
  const order = textReadingOrder(doc);
  const sorted = [...steps].sort((a, b) => pages.get(a.source)! - pages.get(b.source)! ||
    (order.get(a.source) ?? Number.MAX_SAFE_INTEGER) - (order.get(b.source) ?? Number.MAX_SAFE_INTEGER));
  const result = structuredClone(draft);
  for (const step of sorted) {
    const page = pages.get(step.source)!;
    let inserted = false;
    for (const chapter of result.chapters) {
      const at = chapter.steps.findIndex((s) => pages.get(s.source)! > page);
      if (at !== -1) { chapter.steps.splice(at, 0, structuredClone(step)); inserted = true; break; }
    }
    if (!inserted) result.chapters.at(-1)!.steps.push(structuredClone(step));
  }
  return result;
}
