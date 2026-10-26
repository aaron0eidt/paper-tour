// Stage layout: pages stacked vertically. Stage units are PDF points, so a page's doc.json
// coordinates only need the page's offset to become stage coordinates.

import { unionRect } from './resolve';
import type { BBox } from './types';
import type { PageRects, PageSize } from './resolve';

export const PAGE_GAP = 28;
export const DOC_MARGIN = 32;

export interface PageBox {
  n: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Layout {
  pages: PageBox[];
  width: number;
  height: number;
}

export function layoutPages(sizes: PageSize[]): Layout {
  const maxW = Math.max(1, ...sizes.map((s) => s.width));
  let y = DOC_MARGIN;
  const pages = sizes.map((s, i) => {
    const box = { n: i + 1, x: DOC_MARGIN + (maxW - s.width) / 2, y, width: s.width, height: s.height };
    y += s.height + PAGE_GAP;
    return box;
  });
  return { pages, width: maxW + 2 * DOC_MARGIN, height: y - PAGE_GAP + DOC_MARGIN };
}

export function toStage(layout: Layout, page: number, r: BBox): BBox {
  const p = layout.pages[page - 1];
  if (!p) return r;
  return [p.x + r[0], p.y + r[1], p.x + r[2], p.y + r[3]];
}

/** Union in stage coordinates of the first page group (targets live on one page). */
export function stageRect(layout: Layout, groups: PageRects[]): { page: number; rect: BBox } | null {
  const g = groups[0];
  if (!g || !g.rects.length) return null;
  return { page: g.page, rect: unionRect(g.rects.map((r) => toStage(layout, g.page, r))) };
}
