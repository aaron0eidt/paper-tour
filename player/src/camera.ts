// Camera over the stage: a view is the stage point at the viewport center plus a scale
// (screen px per stage unit). Framing math is pure; the Camera class animates between views.

import { DEFAULT_ZOOM_PADDING } from './types';
import type { BBox, CameraAction } from './types';
import { stageRect } from './layout';
import type { Layout, PageBox } from './layout';
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

export const MAX_ZOOM = 4;
export const MAX_USER_ZOOM = 6;
export const MIN_ZOOM = 0.1;
const DURATION_MS = 700;
const SETTLE_MS = 160;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Reading zoom: the page width fits the viewport width minus margins. */
export function readingScale(pageWidth: number, vp: Viewport): number {
  const margin = clamp(vp.width * 0.04, 16, 56);
  return clamp((vp.width - 2 * margin) / pageWidth, MIN_ZOOM, MAX_ZOOM);
}

function clampAxis(c: number, s: number, viewSize: number, docSize: number): number {
  const half = viewSize / (2 * s);
  if (2 * half >= docSize) return docSize / 2;
  return clamp(c, half, docSize - half);
}

/** Keep the view inside the document (centered on an axis where the document is smaller). */
export function clampView(v: View, layout: Layout, vp: Viewport): View {
  return { s: v.s, cx: clampAxis(v.cx, v.s, vp.width, layout.width), cy: clampAxis(v.cy, v.s, vp.height, layout.height) };
}

/** Reading zoom with the target vertically centered; tall targets are aligned to the top instead. */
export function focusView(rect: BBox, page: PageBox, layout: Layout, vp: Viewport): View {
  const s = readingScale(page.width, vp);
  const viewH = vp.height / s;
  const h = rect[3] - rect[1];
  const cy = h > viewH * 0.8 ? rect[1] - viewH * 0.06 + viewH / 2 : (rect[1] + rect[3]) / 2;
  return clampView({ cx: page.x + page.width / 2, cy, s }, layout, vp);
}

/** Refit the visible page when a side panel changes the available width. The
 * current vertical reading anchor survives; an old manual/detail zoom does not.
 */
export function fitWidthView(view: View, layout: Layout, vp: Viewport): View {
  const distance = (page: PageBox) => Math.max(page.y - view.cy, view.cy - page.y - page.height, 0);
  const page = layout.pages.reduce<PageBox | undefined>((nearest, candidate) =>
    !nearest || distance(candidate) < distance(nearest) ? candidate : nearest, undefined);
  if (!page) return clampView(view, layout, vp);
  return clampView({ cx: page.x + page.width / 2, cy: view.cy, s: readingScale(page.width, vp) }, layout, vp);
}

/** Fit the rect plus padding (a fraction of its size on each side) into the viewport. */
export function zoomView(rect: BBox, padding: number, layout: Layout, vp: Viewport): View {
  const w = Math.max(1, rect[2] - rect[0]);
  const h = Math.max(1, rect[3] - rect[1]);
  const s = Math.min(vp.width / (w * (1 + 2 * padding)), vp.height / (h * (1 + 2 * padding)));
  return clampView({ cx: (rect[0] + rect[2]) / 2, cy: (rect[1] + rect[3]) / 2, s: clamp(s, MIN_ZOOM, MAX_ZOOM) }, layout, vp);
}

/** Top of the first page at reading zoom. */
export function initialView(layout: Layout, vp: Viewport): View {
  const p = layout.pages[0];
  if (!p) return { cx: layout.width / 2, cy: layout.height / 2, s: 1 };
  return focusView([p.x, p.y, p.x + p.width, p.y + p.height], p, layout, vp);
}

export function cameraView(action: CameraAction, resolver: Resolver, layout: Layout, vp: Viewport, options: { fitWidth?: boolean } = {}): View | null {
  const groups = action.type === 'zoom' ? resolver.resolveTarget(action.target, action.region) : resolver.resolve(action.target);
  const target = groups && stageRect(layout, groups);
  const page = target && layout.pages[target.page - 1];
  // A target on a page the layout does not have cannot be framed.
  if (!target || !page) return null;
  // Text focus keeps the page legible in context. Deliberate zoom commands can
  // inspect detail, except while a side explanation needs the full paper width.
  if (action.type === 'focus' || options.fitWidth) return focusView(target.rect, page, layout, vp);
  return zoomView(target.rect, action.padding ?? DEFAULT_ZOOM_PADDING, layout, vp);
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

  jumpTo(view: View): void {
    this.stop();
    this.view = clampView(view, this.layout, this.vp);
    this.notify(false);
  }

  animateTo(view: View, duration = DURATION_MS): void {
    this.userMoved = false;
    const to = clampView(view, this.layout, this.vp);
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
    this.anim = { from: current, to: clampView(view, this.layout, this.vp), start: now,
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
    this.view = clampView(view, this.layout, this.vp);
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
