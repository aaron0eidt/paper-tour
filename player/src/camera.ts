// Camera over the stage: a view is the stage point at the viewport center plus a scale
// (screen px per stage unit). Framing math is pure; the Camera class animates between views.

import { DEFAULT_ZOOM_PADDING } from './types';
import type { BBox, CameraAction, Region } from './types';
import { stageRect, toStage } from './layout';
import type { Layout, PageBox } from './layout';
import { unionRect } from './resolve';
import type { Resolver } from './resolve';

export interface View {
  cx: number;
  cy: number;
  s: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** What floats over the viewport (the ask dock), in viewport pixels from each edge. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

/** Another thing a camera move should keep in frame while it holds: a target, or a region of one. */
export interface AlsoTarget {
  target: string;
  region?: Region;
}

export const MAX_ZOOM = 4;
export const MAX_USER_ZOOM = 6;
export const MIN_ZOOM = 0.1;
const DURATION_MS = 700;
const SHORT_HOP_MS = 320;
const SETTLE_MS = 160;

/** Where the page's width does not give the type this size on screen, the camera zooms in to it (as far as the column fits). */
export const READ_TEXT_PX = 12.5;
/** Marks kept in frame never shrink the type below this. */
export const MIN_TEXT_PX = 11;
/** Whatever floats over the stage may take at most this share of either side. */
const MAX_INSET_SHARE = 0.4;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** How long a flight between two views takes: from the DURATION_MS floor, up to it with distance and zoom change. */
export function flightDuration(from: View, to: View, vp: Viewport): number {
  const scale = Math.min(from.s, to.s);
  const travel = Math.hypot((to.cx - from.cx) * scale, (to.cy - from.cy) * scale) / Math.max(vp.width, vp.height);
  const zoom = Math.abs(Math.log(to.s / from.s));
  return Math.round(clamp(SHORT_HOP_MS + (DURATION_MS - SHORT_HOP_MS) * (travel + zoom), SHORT_HOP_MS, DURATION_MS));
}

/** The viewport without what floats over it, and where its centre lies relative to the viewport's. */
export interface FreeArea extends Viewport {
  dx: number;
  dy: number;
}

export function freeArea(vp: Viewport, insets: Insets = NO_INSETS): FreeArea {
  const axis = (a: number, b: number, size: number): [number, number] => {
    const limit = size * MAX_INSET_SHARE;
    const lo = clamp(a, 0, limit);
    const hi = clamp(b, 0, limit);
    return [lo, hi];
  };
  const [left, right] = axis(insets.left, insets.right, vp.width);
  const [top, bottom] = axis(insets.top, insets.bottom, vp.height);
  return { width: vp.width - left - right, height: vp.height - top - bottom, dx: (left - right) / 2, dy: (top - bottom) / 2 };
}

/** The margin left on each side of a page or column that fills the viewport's width. */
const sideMargin = (width: number) => clamp(width * 0.04, 16, 56);

/** Reading zoom: the page width fits the viewport width minus margins. */
export function readingScale(pageWidth: number, vp: Viewport): number {
  return clamp((vp.width - 2 * sideMargin(vp.width)) / pageWidth, MIN_ZOOM, MAX_ZOOM);
}

function clampAxis(c: number, s: number, viewSize: number, docSize: number): number {
  const half = viewSize / (2 * s);
  if (2 * half >= docSize) return docSize / 2;
  return clamp(c, half, docSize - half);
}

/**
 * Keep the view inside the document (centered on an axis where the document is smaller). The
 * document may scroll until its edge meets the free area's edge, so its last lines can rise
 * above what floats over the viewport.
 */
export function clampView(v: View, layout: Layout, vp: Viewport, insets: Insets = NO_INSETS): View {
  const free = freeArea(vp, insets);
  const cx = clampAxis(v.cx + free.dx / v.s, v.s, free.width, layout.width);
  const cy = clampAxis(v.cy + free.dy / v.s, v.s, free.height, layout.height);
  return { s: v.s, cx: cx - free.dx / v.s, cy: cy - free.dy / v.s };
}

/** A view that has `point` (stage units) at the centre of the free area, clamped to the document. */
function viewAt(point: { x: number; y: number }, s: number, layout: Layout, vp: Viewport, insets: Insets): View {
  const free = freeArea(vp, insets);
  return clampView({ cx: point.x - free.dx / s, cy: point.y - free.dy / s, s }, layout, vp, insets);
}

/** What shapes a frame besides the target itself. All of it is optional. */
export interface FrameOptions {
  /** What floats over the viewport: the target is framed in what is left. */
  insets?: Insets;
  /** A text line's height in page points, from which a stage too small for the page's type zooms in. */
  lineHeight?: number;
  /** The text column the target sits in, as a range of stage x. */
  column?: [number, number];
  /** Other marks shown while this frame holds, in stage coordinates on the same page. */
  also?: BBox[];
}

const union = (rects: BBox[]): BBox => unionRect(rects);

/**
 * Reading zoom with the target centred in the free area; tall targets are aligned to the top
 * instead. Where fitting the page's width would make its type smaller than READ_TEXT_PX, the view
 * zooms in to that size (as far as the text column still fits across) and centres on the column.
 * Marks that appear later in the same frame are kept in view when that keeps the type legible
 * (MIN_TEXT_PX); otherwise the first target alone is framed.
 */
export function focusView(rect: BBox, page: PageBox, layout: Layout, vp: Viewport, opts: FrameOptions = {}): View {
  const insets = opts.insets ?? NO_INSETS;
  const free = freeArea(vp, insets);
  const fit = readingScale(page.width, free);
  const lh = opts.lineHeight;
  let s = fit;
  if (lh && lh > 0 && fit * lh < READ_TEXT_PX) {
    const column = opts.column ?? [rect[0], rect[2]];
    const across = (free.width - 2 * sideMargin(free.width)) / Math.max(1, column[1] - column[0]);
    s = clamp(READ_TEXT_PX / lh, fit, Math.max(fit, across));
  }
  const zoomed = s > fit + 1e-6;
  let box = rect;
  if (opts.also?.length) {
    const all = union([rect, ...opts.also]);
    const margin = sideMargin(free.width);
    const hold = Math.min((free.width - 2 * margin) / Math.max(1, all[2] - all[0]), (free.height - 2 * margin) / Math.max(1, all[3] - all[1]));
    // Zooming in never gives up legibility for the later marks; at page width they only steer the centre.
    const floor = zoomed ? Math.max(fit, lh ? MIN_TEXT_PX / lh : fit) : fit;
    if (zoomed ? hold >= floor : (all[3] - all[1]) * s <= free.height * 0.92) {
      box = all;
      if (zoomed) s = Math.min(s, hold);
    }
  }
  const viewH = free.height / s;
  const h = box[3] - box[1];
  const y = h > viewH * 0.8 ? box[1] - viewH * 0.06 + viewH / 2 : (box[1] + box[3]) / 2;
  const columnBox = opts.column ? union([[opts.column[0], 0, opts.column[1], 1], box]) : box;
  const x = s > fit + 1e-6 ? (columnBox[0] + columnBox[2]) / 2 : page.x + page.width / 2;
  return viewAt({ x, y }, s, layout, vp, insets);
}

/**
 * Refit the visible page when a side panel changes the available width. The
 * current vertical reading anchor survives; an old manual/detail zoom does not.
 */
export function fitWidthView(view: View, layout: Layout, vp: Viewport, insets: Insets = NO_INSETS): View {
  const distance = (page: PageBox) => Math.max(page.y - view.cy, view.cy - page.y - page.height, 0);
  const page = layout.pages.reduce<PageBox | undefined>((nearest, candidate) =>
    !nearest || distance(candidate) < distance(nearest) ? candidate : nearest, undefined);
  if (!page) return clampView(view, layout, vp, insets);
  const free = freeArea(vp, insets);
  const s = readingScale(page.width, free);
  return clampView({ cx: page.x + page.width / 2 - free.dx / s, cy: view.cy, s }, layout, vp, insets);
}

/**
 * Fit the rect plus padding (a fraction of its size on each side) into the free area. Other marks
 * that appear in the same frame come along when that costs at most a third of the zoom.
 */
export function zoomView(rect: BBox, padding: number, layout: Layout, vp: Viewport, opts: FrameOptions = {}): View {
  const insets = opts.insets ?? NO_INSETS;
  const free = freeArea(vp, insets);
  const fitTo = (r: BBox) => {
    const w = Math.max(1, r[2] - r[0]);
    const h = Math.max(1, r[3] - r[1]);
    return clamp(Math.min(free.width / (w * (1 + 2 * padding)), free.height / (h * (1 + 2 * padding))), MIN_ZOOM, MAX_ZOOM);
  };
  let box = rect;
  let s = fitTo(rect);
  if (opts.also?.length) {
    const all = union([rect, ...opts.also]);
    const sAll = fitTo(all);
    if (sAll >= s * 0.7) {
      box = all;
      s = sAll;
    }
  }
  return viewAt({ x: (box[0] + box[2]) / 2, y: (box[1] + box[3]) / 2 }, s, layout, vp, insets);
}

/**
 * The view that brings a rect (stage units) wholly into the free area, kept clear of what floats over the viewport:
 * panned the least, or zoomed out as far as it takes where it does not fit. null when it is already in view.
 */
export function revealView(rect: BBox, view: View, layout: Layout, vp: Viewport, insets: Insets = NO_INSETS, margin = 14): View | null {
  const free = freeArea(vp, insets);
  const near = { left: vp.width / 2 + free.dx - free.width / 2 + margin, top: vp.height / 2 + free.dy - free.height / 2 + margin };
  const far = { right: near.left + free.width - 2 * margin, bottom: near.top + free.height - 2 * margin };
  const w = Math.max(1, rect[2] - rect[0]);
  const h = Math.max(1, rect[3] - rect[1]);
  const room = { width: far.right - near.left, height: far.bottom - near.top };
  if (room.width <= 0 || room.height <= 0) return null;
  if (w * view.s > room.width || h * view.s > room.height) {
    const s = clamp(Math.min(room.width / w, room.height / h), MIN_ZOOM, view.s);
    return viewAt({ x: (rect[0] + rect[2]) / 2, y: (rect[1] + rect[3]) / 2 }, s, layout, vp, insets);
  }
  const shown = project(rect, view, vp);
  const shift = (a: number, b: number, lo: number, hi: number) => (a < lo ? a - lo : b > hi ? b - hi : 0);
  const dx = shift(shown.left, shown.right, near.left, far.right);
  const dy = shift(shown.top, shown.bottom, near.top, far.bottom);
  if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return null;
  return clampView({ cx: view.cx + dx / view.s, cy: view.cy + dy / view.s, s: view.s }, layout, vp, insets);
}

/**
 * A slide shown whole: the page fits the free area with a small margin, and centres in it. Slides are read as they are
 * printed, so a deck never zooms to a text column the way a paper does.
 */
export function slideView(page: PageBox, layout: Layout, vp: Viewport, insets: Insets = NO_INSETS): View {
  const free = freeArea(vp, insets);
  const margin = clamp(Math.min(free.width, free.height) * 0.025, 6, 24);
  const s = clamp(Math.min((free.width - 2 * margin) / page.width, (free.height - 2 * margin) / page.height), MIN_ZOOM, MAX_ZOOM);
  return viewAt({ x: page.x + page.width / 2, y: page.y + page.height / 2 }, s, layout, vp, insets);
}

/** Top of the first page at reading zoom. */
export function initialView(layout: Layout, vp: Viewport, insets: Insets = NO_INSETS): View {
  const p = layout.pages[0];
  if (!p) return { cx: layout.width / 2, cy: layout.height / 2, s: 1 };
  return focusView([p.x, p.y, p.x + p.width, p.y + p.height], p, layout, vp, { insets });
}

const medianHeight = (rects: BBox[]) => {
  const heights = rects.map((r) => r[3] - r[1]).sort((a, b) => a - b);
  return heights[Math.floor(heights.length / 2)];
};

/** A camera move's view, and the stage rect it is meant to show (the target and the marks kept with it). */
export interface Frame {
  view: View;
  rect: BBox;
  /** The page the target is on. */
  page: number;
}

export interface CameraOptions {
  /** A side explanation needs the full paper width. */
  fitWidth?: boolean;
  /** What floats over the viewport: targets are framed in what is left. */
  insets?: Insets;
  /** The other marks shown while the move holds. */
  also?: AlsoTarget[];
  /** A deck: a focus shows the whole slide, and a zoom still goes into it even beside the board. */
  slide?: boolean;
}

export function frameFor(action: CameraAction, resolver: Resolver, layout: Layout, vp: Viewport, options: CameraOptions = {}): Frame | null {
  const groups = action.type === 'zoom' ? resolver.resolveTarget(action.target, action.region) : resolver.resolve(action.target);
  const target = groups && stageRect(layout, groups);
  const page = target && layout.pages[target.page - 1];
  // A target on a page the layout does not have cannot be framed.
  if (!target || !page) return null;
  const also: BBox[] = [];
  for (const other of options.also ?? []) {
    const group = resolver.resolveTarget(other.target, other.region, { lines: true })?.find((g) => g.page === target.page);
    if (group) also.push(toStage(layout, group.page, unionRect(group.rects)));
  }
  // The type's size and the column it runs in decide how far a small stage zooms in to stay legible.
  const text = action.type === 'focus' && ['sentence', 'block', 'section'].includes(resolver.kind(action.target) ?? '');
  const lines = text ? resolver.resolve(action.target, { lines: true })?.[0]?.rects : undefined;
  const column = text ? resolver.columnOf(action.target) : null;
  const opts: FrameOptions = {
    insets: options.insets,
    also,
    ...(lines?.length ? { lineHeight: medianHeight(lines) } : {}),
    ...(column ? { column: [page.x + column[0], page.x + column[1]] as [number, number] } : {}),
  };
  const rect = also.length ? union([target.rect, ...also]) : target.rect;
  // A slide is framed whole, and the whole slide is what the card above it must not cover.
  if (options.slide && action.type === 'focus')
    return { view: slideView(page, layout, vp, options.insets), rect: [page.x, page.y, page.x + page.width, page.y + page.height], page: target.page };
  // Text focus keeps the page legible in context. Deliberate zoom commands can
  // inspect detail, except while a side explanation needs the full paper width.
  const view =
    action.type === 'focus' || (options.fitWidth && !options.slide)
      ? focusView(target.rect, page, layout, vp, opts)
      : zoomView(target.rect, action.padding ?? DEFAULT_ZOOM_PADDING, layout, vp, opts);
  return { view, rect, page: target.page };
}

export function cameraView(action: CameraAction, resolver: Resolver, layout: Layout, vp: Viewport, options: CameraOptions = {}): View | null {
  return frameFor(action, resolver, layout, vp, options)?.view ?? null;
}

/** Stage rect to viewport-relative screen pixels. */
export function project(r: BBox, v: View, vp: Viewport): ScreenRect {
  const x = (sx: number) => (sx - v.cx) * v.s + vp.width / 2;
  const y = (sy: number) => (sy - v.cy) * v.s + vp.height / 2;
  return { left: x(r[0]), top: y(r[1]), right: x(r[2]), bottom: y(r[3]) };
}

/** Viewport pixels back to the same stage coordinates used by PDF overlays. */
export function unproject(x: number, y: number, v: View, vp: Viewport): [number, number] {
  return [v.cx + (x - vp.width / 2) / v.s, v.cy + (y - vp.height / 2) / v.s];
}

export function transformOf(v: View, vp: Viewport): string {
  const tx = vp.width / 2 - v.cx * v.s;
  const ty = vp.height / 2 - v.cy * v.s;
  return `translate(${tx}px, ${ty}px) scale(${v.s})`;
}

type Listener = (view: View, moving: boolean) => void;

export class Camera {
  /** Set by wheel pan/zoom, cleared by the next camera action. */
  userMoved = false;

  private view: View = { cx: 0, cy: 0, s: 1 };
  private vp: Viewport = { width: 1, height: 1 };
  private layout: Layout = { pages: [], width: 1, height: 1 };
  private floating: Insets = NO_INSETS;
  private anim: { from: View; to: View; start: number; duration: number; velocity?: View } | null = null;
  private raf = 0;
  private settleTimer: ReturnType<typeof setTimeout> | undefined;
  private listeners = new Set<Listener>();

  getView = (): View => this.view;

  /** Where the camera is heading: the end of the running animation, else the current view. */
  get targetView(): View {
    return this.anim?.to ?? this.view;
  }

  get viewport(): Viewport {
    return this.vp;
  }

  /** What floats over the viewport now (the ask dock). */
  get insets(): Insets {
    return this.floating;
  }

  /** The viewport without what floats over it. */
  get free(): FreeArea {
    return freeArea(this.vp, this.floating);
  }

  get moving(): boolean {
    return this.anim !== null || this.settleTimer !== undefined;
  }

  /** A camera flight (animateTo) is under way; false during wheel or drag input. */
  get animating(): boolean {
    return this.anim !== null;
  }

  subscribe = (fn: Listener): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };

  /** A cancelled narration must not remain subscribed to a camera flight. */
  whenSettled(signal: AbortSignal): Promise<void> {
    if (signal.aborted || !this.moving) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        unsubscribe();
        signal.removeEventListener('abort', done);
        resolve();
      };
      const unsubscribe = this.subscribe((_view, moving) => {
        if (!moving) done();
      });
      signal.addEventListener('abort', done, { once: true });
    });
  }

  setLayout(layout: Layout): void {
    this.layout = layout;
  }

  setViewport(vp: Viewport): void {
    this.vp = { width: Math.max(1, vp.width), height: Math.max(1, vp.height) };
  }

  /** Tell the camera what floats over the viewport; false when nothing changed. */
  setInsets(insets: Insets): boolean {
    const same = (['top', 'right', 'bottom', 'left'] as const).every((side) => Math.abs(insets[side] - this.floating[side]) < 0.5);
    if (same) return false;
    this.floating = { ...insets };
    return true;
  }

  jumpTo(view: View): void {
    this.stop();
    this.view = clampView(view, this.layout, this.vp, this.floating);
    this.notify(false);
  }

  /** Fly to a view. Without a duration, a short hop is quick and a long flight takes its time. */
  animateTo(view: View, duration?: number): void {
    this.userMoved = false;
    const to = clampView(view, this.layout, this.vp, this.floating);
    duration ??= flightDuration(this.view, to, this.vp);
    const alreadyFramed =
      Math.abs(to.cx - this.view.cx) * to.s < 0.5 &&
      Math.abs(to.cy - this.view.cy) * to.s < 0.5 &&
      Math.abs(to.s / this.view.s - 1) < 0.001;
    if (alreadyFramed || duration <= 0 || prefersReducedMotion()) return this.jumpTo(to);
    this.stop();
    this.anim = { from: this.view, to, start: performance.now(), duration };
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Reframe a resize without restarting the flight: preserve position, velocity and its original deadline. */
  retargetTo(view: View): void {
    const a = this.anim;
    if (!a) return this.jumpTo(view);
    const now = performance.now();
    const sample = (time: number) => this.sample(a, time);
    const before = sample(now - 1), current = sample(now);
    const velocity = { cx: current.cx - before.cx, cy: current.cy - before.cy, s: Math.log(current.s / before.s) };
    this.view = current;
    this.anim = { from: current, to: clampView(view, this.layout, this.vp, this.floating), start: now,
      duration: Math.max(80, a.start + a.duration - now), velocity };
  }

  private sample(a: NonNullable<Camera['anim']>, now: number): View {
    const t = clamp((now - a.start) / a.duration, 0, 1);
    if (!a.velocity) {
      const e = easeInOutCubic(t);
      return { cx: lerp(a.from.cx, a.to.cx, e), cy: lerp(a.from.cy, a.to.cy, e), s: a.from.s * Math.pow(a.to.s / a.from.s, e) };
    }
    const h0 = 2*t*t*t - 3*t*t + 1, h1 = t*t*t - 2*t*t + t, h2 = -2*t*t*t + 3*t*t;
    const value = (from: number, to: number, v: number) => h0*from + h1*a.duration*v + h2*to;
    return { cx: value(a.from.cx, a.to.cx, a.velocity.cx), cy: value(a.from.cy, a.to.cy, a.velocity.cy),
      s: Math.exp(value(Math.log(a.from.s), Math.log(a.to.s), a.velocity.s)) };
  }

  panBy(dx: number, dy: number): void {
    const v = this.view;
    this.userInput({ cx: v.cx + dx / v.s, cy: v.cy + dy / v.s, s: v.s });
  }

  /** Zoom by `factor` keeping the stage point under viewport position (sx, sy) fixed. */
  zoomAt(factor: number, sx: number, sy: number): void {
    const v = this.view;
    const s = clamp(v.s * factor, MIN_ZOOM, MAX_USER_ZOOM);
    const ox = sx - this.vp.width / 2;
    const oy = sy - this.vp.height / 2;
    this.userInput({ cx: v.cx + ox / v.s - ox / s, cy: v.cy + oy / v.s - oy / s, s });
  }

  destroy(): void {
    this.stop();
    this.listeners.clear();
  }

  private userInput(view: View): void {
    this.stop();
    this.userMoved = true;
    this.view = clampView(view, this.layout, this.vp, this.floating);
    this.notify(true);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = undefined;
      this.notify(false);
    }, SETTLE_MS);
  }

  private stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.anim = null;
    clearTimeout(this.settleTimer);
    this.settleTimer = undefined;
  }

  private frame = (now: number) => {
    this.raf = 0;
    const a = this.anim;
    if (!a) return;
    const t = Math.min(1, (now - a.start) / a.duration);
    if (t >= 1) {
      this.anim = null;
      this.view = a.to;
      this.notify(false);
      return;
    }
    // Scale interpolates geometrically so zooming feels even.
    this.view = this.sample(a, now);
    this.notify(true);
    this.raf = requestAnimationFrame(this.frame);
  };

  private notify(moving: boolean): void {
    for (const l of [...this.listeners]) l(this.view, moving);
  }
}
