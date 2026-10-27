import type { ReaderState } from '../../shared/contracts';
import type { Layout } from './layout';
import type { View, Viewport } from './camera';
import { initialView, MAX_USER_ZOOM, MIN_ZOOM } from './camera';

/** Store page-relative coordinates, so reopening survives a different viewport or page layout. */
export function positionFromView(layout: Layout, view: View): Pick<ReaderState, 'page' | 'pageOffset' | 'zoom'> {
  const page = layout.pages.find((p) => view.cy <= p.y + p.height) ?? layout.pages.at(-1);
  if (!page) return { page: 1, pageOffset: 0, zoom: null };
  return { page: page.n, pageOffset: Math.max(0, Math.min(1, (view.cy - page.y) / page.height)), zoom: view.s };
}

export function viewFromPosition(layout: Layout, viewport: Viewport, saved: ReaderState | null): View {
  if (!saved || !layout.pages.length) return initialView(layout, viewport);
  const page = layout.pages[Math.max(0, Math.min(layout.pages.length - 1, saved.page - 1))];
  const defaultView = initialView(layout, viewport);
  return {
    cx: page.x + page.width / 2,
    cy: page.y + Math.max(0, Math.min(1, saved.pageOffset)) * page.height,
    s:
      saved.zoom && Number.isFinite(saved.zoom)
        ? Math.max(MIN_ZOOM, Math.min(MAX_USER_ZOOM, saved.zoom))
        : defaultView.s,
  };
}
