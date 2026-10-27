import type { Doc } from '../../../shared/paper';
export const MAX_TOUR_STEPS = 96;
export const MAX_CONTENT_PAGES = 60;

/** Source-derived size/coverage goals, shared by the writer prompt and validation. */
export function walkthroughGoals(doc: Doc) {
  const prose = new Set(doc.blocks.filter((b) => b.type === 'paragraph').map((b) => b.id));
  const sentences = doc.sentences.filter((s) => prose.has(s.block) && s.text.trim().split(/\s+/).length >= 5);
  const pages = [
    ...new Set([
      ...(sentences.length ? sentences.map((s) => s.page) : doc.pages.map((p) => p.n)),
      ...doc.figures.map((f) => f.page),
      ...doc.pages.filter((p) => !doc.blocks.some((b) => b.page === p.n && b.type !== 'header_footer')).map((p) => p.n),
    ]),
  ].sort((a, b) => a - b);
  const minimumSteps = Math.max(
    pages.length,
    Math.min(64, Math.max(1, Math.min(4, sentences.length), Math.ceil(sentences.length / 6))),
  );
  const targetSteps = Math.max(
    pages.length,
    Math.min(
      88,
      Math.max(minimumSteps, Math.min(6, sentences.length), Math.ceil(sentences.length / 4), pages.length * 2),
    ),
  );
  const minimumDistinctHighlights = Math.min(sentences.length, Math.ceil(minimumSteps * 0.75));
  return {
    minimumSteps,
    targetSteps,
    minimumDistinctHighlights,
    requiredPages: pages,
    proseSentenceIds: sentences.map((s) => s.id),
  };
}

/** Text uses the extractor's reading order, rather than geometry that interleaves columns. */
export function textReadingOrder(doc: Doc): Map<string, number> {
  const result = new Map<string, number>();
  doc.blocks.forEach((block, index) => {
    if (block.type === 'equation') return; // Equations are visual detours on the current page.
    result.set(block.id, index * 10_000);
    block.sentences.forEach((id, offset) => result.set(id, index * 10_000 + offset + 1));
  });
  for (const section of doc.sections) {
    const order = result.get(section.block);
    if (order !== undefined) result.set(section.id, order);
  }
  return result;
}
