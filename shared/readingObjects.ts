import type { BBox, Doc, DocBlock } from './paper';
import type { ReadingObject } from './reading';
import { sourceOrder } from './readingOrder';
import { tableTextBlocks } from './tableTargets';
import { readingProcedures } from './readingProcedures';

const normalized = (text: string) => text.normalize('NFKC').replace(/\u00ad/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
const union = (boxes: BBox[]): BBox => [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
  Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
const inside = (a: BBox, b: BBox) => a[0] >= b[0] - 1 && a[1] >= b[1] - 1 && a[2] <= b[2] + 1 && a[3] <= b[3] + 1;

/** Prefer ingestion's explicit caption link; legacy captions need an unambiguous same-page text match. */
function captions(doc: Doc): Map<string, string[]> {
  const result = new Map(doc.figures.map((f) => [f.id, f.caption_block && doc.blocks.some((b) => b.id === f.caption_block) ? [f.caption_block] : []]));
  const linked = new Set([...result.values()].flat());
  for (const block of doc.blocks) {
    if (block.type !== 'caption' || linked.has(block.id) || !normalized(block.text)) continue;
    const matches = doc.figures.filter((f) => f.page === block.page && normalized(f.caption).includes(normalized(block.text)));
    if (matches.length === 1) result.get(matches[0].id)!.push(block.id);
  }
  return result;
}

/** OCR may split a displayed expression into sums, indices, cases and words such as "otherwise". */
function equations(doc: Doc, excluded: Set<string>): ReadingObject[] {
  const seeds = new Set(doc.equations.flatMap((e) => e.block ? [e.block] : []));
  const order = sourceOrder(doc);
  const blocks = [...doc.blocks].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const math = (b: DocBlock) => !excluded.has(b.id) && (b.type === 'equation' || seeds.has(b.id));
  const result: ReadingObject[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const first = blocks[i];
    if (!math(first)) continue;
    const heights = doc.sentences.filter((s) => s.page === first.page).flatMap((s) => s.rects.map((r) => r[3] - r[1])).filter((h) => h > 0).sort((a, b) => a - b);
    const line = heights[Math.floor(heights.length / 2)] ?? Math.max(1, first.bbox[3] - first.bbox[1]);
    const group = [first];
    let box = first.bbox;
    while (i + 1 < blocks.length) {
      const next = blocks[i + 1];
      if (next.page !== first.page || next.section !== first.section || excluded.has(next.id)) break;
      const dx = Math.max(0, next.bbox[0] - box[2], box[0] - next.bbox[2]);
      const dy = Math.max(0, next.bbox[1] - box[3], box[1] - next.bbox[3]);
      const fragment = next.type === 'paragraph' && inside(next.bbox, box);
      if (!(math(next) && dx <= 2 * line && dy <= 2 * line) && !fragment) break;
      group.push(next); box = union([box, next.bbox]); i++;
    }
    result.push({ id: group.length === 1 ? first.id : `reading-math:${first.id}`, kind: 'equation', page: first.page,
      bbox: box, blocks: group.map((b) => b.id) });
  }
  return result;
}

/** One reading per source visual, including its caption and complete displayed mathematical expression. */
export function readingObjects(doc: Doc): ReadingObject[] {
  const captionBlocks = captions(doc);
  const visuals: ReadingObject[] = doc.figures.map((figure) => ({
    id: figure.id, kind: figure.kind, page: figure.page, bbox: figure.bbox,
    blocks: figure.kind === 'table' ? tableTextBlocks(doc, figure).map((b) => b.id) : doc.blocks.filter((b) =>
      b.type === 'figure_text' && b.page === figure.page && inside(b.bbox, figure.bbox)).map((b) => b.id),
    captionBlocks: captionBlocks.get(figure.id),
  }));
  const covered = new Set(visuals.flatMap((v) => [...v.blocks, ...(v.captionBlocks ?? [])]));
  const standaloneTables: ReadingObject[] = doc.blocks.filter((b) => b.type === 'table_text' && !covered.has(b.id))
    .map((b) => ({ id: b.id, kind: 'table', page: b.page, bbox: b.bbox, blocks: [b.id] }));
  const procedures = readingProcedures(doc, new Set([...covered, ...standaloneTables.flatMap((o) => o.blocks)]));
  const structured = new Set([...covered, ...procedures.flatMap((o) => o.blocks)]);
  return [...visuals, ...standaloneTables, ...procedures, ...equations(doc, structured)];
}
