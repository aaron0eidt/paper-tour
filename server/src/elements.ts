import type { Doc, BBox } from '../../shared/paper';
import type { IndexedElement } from '../../shared/contracts';
const json = (value: object) => value as Record<string, unknown>;
const bounds = (rs: BBox[]): BBox | null =>
  rs.length
    ? [
        Math.min(...rs.map((r) => r[0])),
        Math.min(...rs.map((r) => r[1])),
        Math.max(...rs.map((r) => r[2])),
        Math.max(...rs.map((r) => r[3])),
      ]
    : null;
/** A rebuildable projection; the published doc JSON remains the source of truth. */
export function indexElements(doc: Doc): IndexedElement[] {
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  const result: IndexedElement[] = [];
  for (const p of doc.pages)
    result.push({
      id: `page${p.n}`,
      kind: 'page',
      page: p.n,
      text: `Page ${p.n}`,
      bbox: [0, 0, p.width, p.height],
      data: json(p),
    });
  for (const s of doc.sections)
    result.push({
      id: s.id,
      kind: 'section',
      page: s.page,
      text: s.title,
      bbox: blocks.get(s.block)?.bbox ?? null,
      data: json(s),
    });
  for (const b of doc.blocks)
    result.push({
      id: b.id,
      kind: 'block',
      page: b.page,
      text: b.text,
      bbox: b.bbox,
      data: json(b),
    });
  for (const s of doc.sentences)
    result.push({
      id: s.id,
      kind: 'sentence',
      page: s.page,
      text: s.text,
      bbox: bounds(s.rects),
      data: json(s),
    });
  for (const f of doc.figures) {
    result.push({
      id: f.id,
      kind: f.kind,
      page: f.page,
      text: f.caption,
      bbox: f.bbox,
      data: json(f),
    });
    for (const p of f.panels)
      result.push({
        id: p.id,
        kind: 'panel',
        page: f.page,
        text: p.label ?? p.id,
        bbox: p.bbox,
        data: { ...p, figure: f.id },
      });
  }
  for (const e of doc.equations)
    result.push({
      id: e.id,
      kind: 'equation',
      page: e.page,
      text: e.text,
      bbox: e.bbox,
      data: json(e),
    });
  if (new Set(result.map((e) => e.id)).size !== result.length) throw new Error('Duplicate element IDs in analysis.');
  return result;
}
