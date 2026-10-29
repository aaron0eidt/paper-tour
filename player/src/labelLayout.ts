import type { ScreenRect, Viewport } from './camera';

export type LabelSide = 'right' | 'left' | 'top' | 'bottom';
export interface MeasuredLabel {
  w: number;
  h: number;
  maxWidth: number;
}
export interface LabelAnchor {
  key: string;
  rect: ScreenRect;
  /** A containing figure stays clear even when the mark points at a small part of it. */
  area?: ScreenRect;
  pin?: { x: number; y: number; side: LabelSide | 'upper-right'; alt?: LabelSide };
  side?: LabelSide | 'auto';
  sizes: MeasuredLabel[];
}
export interface LabelPlacement extends ScreenRect {
  maxWidth: number;
  side: LabelSide;
}

const EDGE = 10;
const GAP = 8;
const CLEARANCE = 4;
const SIDES: LabelSide[] = ['top', 'right', 'bottom', 'left'];
const clamp = (n: number, lo: number, hi: number) => Math.min(Math.max(n, lo), Math.max(lo, hi));

export function rectsOverlap(a: ScreenRect, b: ScreenRect, gap = 0): boolean {
  return a.left < b.right + gap && a.right > b.left - gap && a.top < b.bottom + gap && a.bottom > b.top - gap;
}

function distance(a: ScreenRect, b: ScreenRect): number {
  return Math.hypot(Math.max(a.left - b.right, b.left - a.right, 0), Math.max(a.top - b.bottom, b.top - a.bottom, 0));
}

/** Actual DOM measurements at these widths let long chips wrap into a free margin. */
export function labelWidths(viewportWidth: number, note = false): number[] {
  const available = Math.max(1, viewportWidth - 2 * EDGE);
  return [...new Set((note ? [300, 240, 180, 140] : [220, 176, 132, 96]).map((w) => Math.min(w, available)))];
}

function candidates(item: LabelAnchor, size: MeasuredLabel, vp: Viewport, occupied: ScreenRect[]): LabelPlacement[] {
  const a = item.area ?? item.rect;
  const { w, h, maxWidth } = size;
  const cx = (a.left + a.right) / 2;
  const cy = (a.top + a.bottom) / 2;
  const result: LabelPlacement[] = [];
  const add = (left: number, top: number, side: LabelSide) => result.push({ left, top, right: left + w, bottom: top + h, maxWidth, side });

  // Start beside the pen's real tail; never draw a new leader across the document.
  if (item.pin) {
    const { x, y, side, alt } = item.pin;
    for (const s of [side, alt].filter(Boolean)) {
      if (s === 'upper-right') add(x + GAP, y - GAP - h, 'top');
      else if (s === 'left') add(x - GAP - w, y - h / 2, 'left');
      else if (s === 'right') add(x + GAP, y - h / 2, 'right');
      else if (s === 'top') add(x - w / 2, y - GAP - h, 'top');
      else if (s === 'bottom') add(x - w / 2, y + GAP, 'bottom');
    }
  }

  // Search the adjacent free strips. Obstacle edges expose real gaps between columns,
  // captions, nearby labels and the floating input, without a page-specific grid.
  for (const side of SIDES) {
    const horizontal = side === 'top' || side === 'bottom';
    const fixed = side === 'top' ? a.top - GAP - h : side === 'bottom' ? a.bottom + GAP
      : side === 'left' ? a.left - GAP - w : a.right + GAP;
    const length = horizontal ? w : h;
    const start = horizontal ? a.left : a.top;
    const end = horizontal ? a.right : a.bottom;
    const extent = horizontal ? vp.width : vp.height;
    const preferred = horizontal ? item.pin?.x ?? cx : item.pin?.y ?? cy;
    const along = [preferred - length / 2, start, end - length];
    const strip = horizontal
      ? { left: start - length, right: end + length, top: fixed, bottom: fixed + h }
      : { left: fixed, right: fixed + w, top: start - length, bottom: end + length };
    for (const obstacle of occupied) {
      if (!rectsOverlap(strip, obstacle, CLEARANCE)) continue;
      along.push(horizontal ? obstacle.left - GAP - w : obstacle.top - GAP - h,
        horizontal ? obstacle.right + GAP : obstacle.bottom + GAP);
    }
    for (const raw of along) {
      const value = clamp(raw, EDGE, extent - length - EDGE);
      // Stay next to the source. A distant viewport corner would be an unanchored caption.
      if (value + length < start - GAP || value > end + GAP) continue;
      add(horizontal ? value : fixed, horizontal ? fixed : value, side);
    }
  }
  return result;
}

/**
 * Labels share one layout, so every accepted chip becomes an obstacle for the next.
 * A missing result is intentional: optional annotation text must not obscure the paper.
 * Geometry is in viewport pixels; measured sizes stay readable at every PDF zoom.
 */
export function layoutLabels(items: LabelAnchor[], obstacles: ScreenRect[], vp: Viewport): Map<string, LabelPlacement> {
  const placed = new Map<string, LabelPlacement>();
  const viewport = { left: 0, top: 0, right: vp.width, bottom: vp.height };
  const occupied = obstacles.filter((r) => rectsOverlap(r, viewport, GAP));
  // Protect both the source and the actual mark. An external arrow can extend beyond
  // its containing figure, and its own chip must never cover the shaft or arrowhead.
  for (const item of items) {
    occupied.push(item.rect);
    if (item.area) occupied.push(item.area);
  }
  for (const item of items) {
    if (!rectsOverlap(item.rect, viewport)) continue;
    const area = item.area ?? item.rect;
    const preferred = item.side !== 'auto' && item.side ? item.side
      : item.pin?.side === 'upper-right' ? 'top' : item.pin?.side ?? 'top';
    const target = item.pin ? { left: item.pin.x, right: item.pin.x, top: item.pin.y, bottom: item.pin.y } : area;
    let best: { position: LabelPlacement; score: number } | null = null;
    for (const [variant, size] of item.sizes.entries()) {
      if (size.w <= 0 || size.h <= 0 || size.w > vp.width - 2 * EDGE || size.h > vp.height - 2 * EDGE) continue;
      for (const position of candidates(item, size, vp, occupied)) {
        if (position.left < EDGE || position.top < EDGE || position.right > vp.width - EDGE || position.bottom > vp.height - EDGE) continue;
        if (occupied.some((r) => rectsOverlap(position, r, CLEARANCE))) continue;
        const near = distance(position, target);
        // A pen label without a short visual association is less helpful than the pen alone.
        if (item.pin && near > 96) continue;
        const score = near + variant * 12 + (position.side === preferred ? 0 : 18)
          + Math.abs((position.left + position.right) / 2 - (target.left + target.right) / 2) * 0.02
          + Math.abs((position.top + position.bottom) / 2 - (target.top + target.bottom) / 2) * 0.02;
        if (!best || score < best.score) best = { position, score };
      }
    }
    if (best) {
      placed.set(item.key, best.position);
      occupied.push(best.position);
    }
  }
  return placed;
}
