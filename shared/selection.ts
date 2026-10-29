import type { BBox, Doc } from './paper';

/** Coordinates in the displayed PDF page, normalized to its width and height. */
export interface RegionSelection {
  page: number;
  rect: BBox;
}

export class SelectionError extends Error {
  name = 'SelectionError';
}

export function validateSelection(raw: unknown, doc: Doc): RegionSelection {
  const value = raw as Partial<RegionSelection> | null;
  if (!value || typeof value !== 'object' || !Number.isInteger(value.page) ||
      !doc.pages.some(p => p.n === value.page) || value.page! < 1 || value.page! > doc.source.num_pages)
    throw new SelectionError('Select a page that belongs to this document.');
  const r = value.rect;
  if (!Array.isArray(r) || r.length !== 4 || !r.every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1) ||
      r[0] >= r[2] || r[1] >= r[3])
    throw new SelectionError('Select a non-empty rectangle within the PDF page.');
  return { page: value.page!, rect: [...r] as BBox };
}

/** Existing source IDs only. The crop itself is context, never an authored target. */
export function selectedSourceIds(doc: Doc, raw: RegionSelection): string[] {
  const selection = validateSelection(raw, doc);
  const page = doc.pages.find(p => p.n === selection.page)!;
  const [x0, y0, x1, y1] = selection.rect;
  const box: BBox = [x0 * page.width, y0 * page.height, x1 * page.width, y1 * page.height];
  const intersects = ([a, b, c, d]: BBox) => a < box[2] && c > box[0] && b < box[3] && d > box[1];
  const ids = [
    ...doc.sentences.filter(s => s.page === selection.page && s.rects.some(intersects)).map(s => s.id),
    ...doc.blocks.filter(b => b.page === selection.page && intersects(b.bbox)).map(b => b.id),
    ...doc.figures.filter(f => f.page === selection.page).flatMap(f => [
      ...(intersects(f.bbox) ? [f.id] : []), ...f.panels.filter(p => intersects(p.bbox)).map(p => p.id),
    ]),
    ...doc.equations.filter(e => e.page === selection.page && intersects(e.bbox)).map(e => e.id),
  ];
  return [...new Set(ids)];
}
