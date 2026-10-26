// Which canvases the stage renders for a camera view: a resolution for each whole-page canvas and,
// at high zoom, a sharper canvas for the visible part of a page. Pure, so it can be tested.

import type { Camera, View, Viewport } from './camera';
import type { Layout } from './layout';
import type { BBox } from './types';

/** A sharper canvas for part of the page (in page points), drawn over the whole-page canvas. */
export interface Detail {
  rect: BBox;
  scale: number;
}

export interface Plan {
  /** Device pixels per point for each page's canvas; 0 = not rendered. */
  scales: number[];
  details: (Detail | null)[];
}

// Canvas resolution steps (device pixels per point) and a per-canvas memory cap (~64 MB).
const SCALE_STEPS = [0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12];
const MAX_CANVAS_PIXELS = 4096 * 4096;
// A detail canvas covers the visible part of a page plus this fraction of it on each side.
const DETAIL_MARGIN = 0.2;
// Below this gain over the whole-page canvas a detail canvas is not worth rendering.
const DETAIL_MIN_GAIN = 1.2;

const quantize = (s: number) => SCALE_STEPS.find((step) => step >= s) ?? SCALE_STEPS[SCALE_STEPS.length - 1];

/**
 * Decide each page's canvas scale for a view. Visible pages match the zoom; pages within one
 * viewport of the screen get a modest scale; the rest are released. With `keep` (during a camera
 * flight) nothing is released or downgraded, pages are only added or sharpened.
 */
export function planScales(layout: Layout, view: View, vpHeight: number, prev: number[], keep: boolean, dpr: number): number[] {
  const top = view.cy - vpHeight / (2 * view.s);
  const bottom = view.cy + vpHeight / (2 * view.s);
  const span = bottom - top;
  const want = quantize(view.s * dpr);
  return layout.pages.map((p, i) => {
    const cur = prev[i] ?? 0;
    const visible = p.y < bottom && p.y + p.height > top;
    const near = p.y < bottom + span && p.y + p.height > top - span;
    const cap = Math.sqrt(MAX_CANVAS_PIXELS / (p.width * p.height));
    const nearScale = Math.min(want, cap, quantize(1.5 * dpr));
    const target = visible ? Math.min(want, cap) : near ? nearScale : 0;
    if (keep) return Math.max(cur, target);
    if (visible) return target > cur || target < cur / 2 ? target : cur;
    if (near) return cur >= nearScale && cur <= nearScale * 2 ? cur : nearScale;
    return 0;
  });
}

/**
 * Whole-page canvases are capped in size, so at high zoom they are softer than the screen.
 * Visible pages then get a second, sharp canvas for just the part on screen. Regions are whole
 * points and scales whole numbers, so the region canvas lines up with the page pixel-exactly.
 */
export function planDetails(layout: Layout, view: View, vp: Viewport, scales: number[], prev: (Detail | null)[], dpr: number): (Detail | null)[] {
  const want = quantize(view.s * dpr);
  const hw = vp.width / (2 * view.s);
  const hh = vp.height / (2 * view.s);
  return layout.pages.map((p, i) => {
    const base = scales[i] ?? 0;
    if (base <= 0 || want < base * DETAIL_MIN_GAIN) return null;
    // The visible part of the page, in page points.
    const seen: BBox = [
      Math.max(0, view.cx - hw - p.x),
      Math.max(0, view.cy - hh - p.y),
      Math.min(p.width, view.cx + hw - p.x),
      Math.min(p.height, view.cy + hh - p.y),
    ];
    if (seen[2] <= seen[0] || seen[3] <= seen[1]) return null;
    const old = prev[i];
    if (old && old.scale === want && old.rect[0] <= seen[0] && old.rect[1] <= seen[1] && old.rect[2] >= seen[2] && old.rect[3] >= seen[3]) {
      return old;
    }
    const mx = (seen[2] - seen[0]) * DETAIL_MARGIN;
    const my = (seen[3] - seen[1]) * DETAIL_MARGIN;
    const rect: BBox = [
      Math.floor(Math.max(0, seen[0] - mx)),
      Math.floor(Math.max(0, seen[1] - my)),
      Math.ceil(Math.min(p.width, seen[2] + mx)),
      Math.ceil(Math.min(p.height, seen[3] + my)),
    ];
    const scale = Math.min(want, Math.floor(Math.sqrt(MAX_CANVAS_PIXELS / ((rect[2] - rect[0]) * (rect[3] - rect[1])))));
    return scale >= base * DETAIL_MIN_GAIN ? { rect, scale } : null;
  });
}

/**
 * The plan after a camera notification (returns `prev` itself when nothing changes). During a
 * camera flight it renders for where the camera is going and keeps what it has. A wheel or drag
 * has no destination, so pages it scrolls past are released as usual instead of piling up.
 */
export function nextPlan(prev: Plan, layout: Layout, camera: Camera, view: View, moving: boolean, dpr: number): Plan {
  const flying = moving && camera.animating;
  const planView = moving ? camera.targetView : view;
  const next = planScales(layout, planView, camera.viewport.height, prev.scales, flying, dpr);
  const scales = next.length === prev.scales.length && next.every((s, i) => s === prev.scales[i]) ? prev.scales : next;
  // Detail canvases are planned once the camera settles; meanwhile the old ones stay.
  const details = moving ? prev.details : planDetails(layout, view, camera.viewport, scales, prev.details, dpr);
  const same = details.length === prev.details.length && details.every((d, i) => d === prev.details[i]);
  return scales === prev.scales && same ? prev : { scales, details: same ? prev.details : details };
}
