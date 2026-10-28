import type { PageBox } from '../layout';

import type { RegionSelection } from '../../../shared/selection';
export type { RegionSelection } from '../../../shared/selection';

/** Keep a drag on the page where it began, independent of the camera's pan and zoom. */
export function regionFromDrag(page: PageBox, start: readonly number[], end: readonly number[]): RegionSelection {
  const clamp = (n: number) => Math.max(0, Math.min(1, n));
  const x0 = clamp((Math.min(start[0], end[0]) - page.x) / page.width);
  const y0 = clamp((Math.min(start[1], end[1]) - page.y) / page.height);
  const x1 = clamp((Math.max(start[0], end[0]) - page.x) / page.width);
  const y1 = clamp((Math.max(start[1], end[1]) - page.y) / page.height);
  return { page: page.n, rect: [x0, y0, x1, y1] };
}

export function hasRegionArea(selection: RegionSelection, page: PageBox, scale: number): boolean {
  const [x0, y0, x1, y1] = selection.rect;
  return (x1 - x0) * page.width * scale >= 6 && (y1 - y0) * page.height * scale >= 6;
}
