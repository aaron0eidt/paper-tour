import type { Doc, DocFigure, Region } from './paper';

/** Table extraction can merge several rows into one block. Such a target is
 * suitable for a quiet outline, never a pointer to its arbitrary centre. */
export function isTableTarget(doc: Doc, target: string): boolean {
  const block = doc.blocks.find((b) => b.id === target);
  const sentence = doc.sentences.find((s) => s.id === target);
  if (
    block?.type === 'table_text' ||
    (sentence && doc.blocks.some((b) => b.id === sentence.block && b.type === 'table_text'))
  )
    return true;
  const figure = doc.figures.find((f) => f.id === target);
  if (figure?.kind === 'table') return true;
  for (const table of doc.figures.filter((f) => f.kind === 'table')) {
    if (table.panels.some((p) => p.id === target)) return true;
    const panel = doc.figures
      .flatMap((f) => f.panels.map((p) => ({ ...p, page: f.page })))
      .find((p) => p.id === target);
    const element = block ?? sentence ?? figure ?? panel ?? doc.equations.find((e) => e.id === target);
    if (!element || element.page !== table.page) continue;
    const rects = 'rects' in element ? element.rects : [element.bbox];
    if (
      rects.length &&
      rects.every(
        ([a, b, c, d]) =>
          a >= table.bbox[0] - 1 && b >= table.bbox[1] - 1 && c <= table.bbox[2] + 1 && d <= table.bbox[3] + 1,
      )
    )
      return true;
  }
  return false;
}

/** Extracted table text is a grounded target, unlike an estimated image third. */
export function tableTextBlocks(doc: Doc, table: DocFigure) {
  const [x0, y0, x1, y1] = table.bbox;
  return doc.blocks.filter((block) => {
    const [a, b, c, d] = block.bbox;
    return (
      block.page === table.page &&
      block.type === 'table_text' &&
      (a + c) / 2 >= x0 &&
      (a + c) / 2 <= x1 &&
      (b + d) / 2 >= y0 &&
      (b + d) / 2 <= y1
    );
  });
}

/** A wide row selection must not cut through a printed row. This can detect a
 * bad old annotation, but cannot infer which row the narration really intended. */
export function clipsTableRow(doc: Doc, target: string, region: Region): boolean {
  const table = doc.figures.find((figure) => figure.id === target && figure.kind === 'table');
  if (!table || region[2] - region[0] < 0.75) return false;
  const [, y0, , y1] = table.bbox;
  const boundaries = [y0 + region[1] * (y1 - y0), y0 + region[3] * (y1 - y0)];
  return tableTextBlocks(doc, table).some((block) => {
    if (block.bbox[2] - block.bbox[0] < (table.bbox[2] - table.bbox[0]) * 0.25) return false;
    const inset = Math.min(1, (block.bbox[3] - block.bbox[1]) * 0.15);
    return boundaries.some((y) => y > block.bbox[1] + inset && y < block.bbox[3] - inset);
  });
}

/** A table's cells as extracted, one line per text block: the table_text blocks centred inside its box on its page. */
export function tableLines(doc: Doc, table: DocFigure): string[] {
  return tableTextBlocks(doc, table)
    .map((b) => b.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 60);
}
