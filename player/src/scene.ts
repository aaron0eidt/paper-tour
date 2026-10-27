// Turns the engine's active overlays into geometry: SVG shapes per page (in page points) and
// screen-space items (notes, box and pen labels) anchored to stage rects.

import { DEFAULT_COLOR } from './types';
import type { ArrowAction, BBox, Color, NoteAction } from './types';
import { stageRect, toStage } from './layout';
import type { Layout } from './layout';
import type { OverlayEntry } from './engine';
import { unionRect } from './resolve';
import type { Resolver } from './resolve';

export const BOX_PAD = 3;
export const SPOT_PAD = 5;

export type PenSide = 'left' | 'right' | 'top' | 'bottom';
/** Where a pen label sits: beside the point it hangs from (an arrow's tail), or up and right of a circle. */
export type PenLabelSide = PenSide | 'upper-right';
type Point = [number, number];

/** A hand-drawn arrow. Its head is sized on screen (pen.css), so it stays crisp and in proportion at every zoom. */
export interface PenArrowShape {
  kind: 'arrow';
  key: string;
  color: Color;
  /** The side of the target the arrow comes from. */
  side: PenSide;
  /**
   * Where the label goes around the tail: beyond it, on the side the arrow comes from, unless the
   * tail lies deep inside a figure or text column; then above or below it, where the tail leans,
   * so the label covers less of it.
   */
  labelSide: PenSide;
  tail: Point;
  tip: Point;
  /** The shaft, a gentle curve from the tail to the tip, in page points. */
  d: string;
  /** Direction of the head in degrees (0 points right, y grows down). */
  angle: number;
  /** The head's two strokes for a head of length 1, from a tip at the origin pointing right. */
  wings: [string, string];
  /**
   * Head length in page points that suits the shaft, and the most it may be. pen.css keeps the
   * head between a minimum and maximum size on screen, then caps it here (when zoomed far out).
   */
  head: { fit: number; max: number };
  bounds: BBox;
}

/** A hand-drawn loop around the target: once around and a little past its start. */
export interface PenCircleShape {
  kind: 'circle';
  key: string;
  color: Color;
  /** The loop in page points. */
  d: string;
  /** The loop's upper-right point, where its label goes. */
  labelAt: Point;
  bounds: BBox;
}

export type PenShape = PenArrowShape | PenCircleShape;

export interface PageShapes {
  markers: { key: string; rects: BBox[]; color: Color }[];
  underlines: { key: string; rects: BBox[]; color: Color }[];
  boxes: { key: string; rect: BBox; color: Color }[];
  /** Spotlight holes on this page. */
  holes: BBox[];
  /** Arrows and circles, drawn above the spotlight. */
  pens: PenShape[];
}

export interface SceneNote {
  key: string;
  text: string;
  side: NonNullable<NoteAction['side']>;
  /** Anchor in stage coordinates. */
  rect: BBox;
}

export interface SceneLabel {
  key: string;
  text: string;
  color: Color;
  /** A box label's box; for a pen label the bounds of its mark. In stage coordinates. */
  rect: BBox;
  /** Pen labels only: the stage point the label hangs from and the side of it the label sits on. */
  pin?: { x: number; y: number; side: PenLabelSide };
}

export interface Scene {
  pages: Map<number, PageShapes>;
  /** Any spotlight active: every page dims except the holes. */
  spotlight: boolean;
  notes: SceneNote[];
  labels: SceneLabel[];
}

const pad = (r: BBox, d: number): BBox => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
const overlaps = (a: BBox, b: BBox) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * The spotlight is one even-odd path, where two overlapping holes would cancel out and dim their
 * overlap. Overlapping holes are therefore merged into their bounding rect (exact for nested ones,
 * such as a panel inside its figure or a sentence inside its paragraph).
 */
export function mergeHoles(holes: BBox[]): BBox[] {
  const out: BBox[] = [];
  for (const hole of holes) {
    let r = hole;
    for (let i = 0; i < out.length; ) {
      if (overlaps(out[i], r)) {
        r = unionRect([out[i], r]);
        out.splice(i, 1);
        i = 0; // the grown rect may now overlap one that was checked already
      } else i++;
    }
    out.push(r);
  }
  return out;
}

// -------------------------------------------------------------------- pen

const DEG = Math.PI / 180;
/** Between an arrow's tip and its target, in page points. */
export const ARROW_GAP = 4;
export const ARROW_MIN = 22;
export const ARROW_MAX = 60;
/** An arrow's tail stays this far inside the page, or the surroundings of its area, it is drawn on. */
const PEN_EDGE = 6;
/** Head length as a share of the shaft: what suits it, and the most it may be. */
const HEAD_FIT = 0.2;
const HEAD_MAX = 0.42;
export const CIRCLE_PAD = 3;
/** Largest radial wobble of a circle; its radii grow to make up for it, so it never cuts the target. */
const WOBBLE = 0.022;

const SIDE_ORDER: PenSide[] = ['left', 'right', 'top', 'bottom'];
const OPPOSITE: Record<PenSide, PenSide> = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
const OUTWARD: Record<PenSide, Point> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(lo, hi), Math.max(lo, v));
const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
const pt = ([x, y]: Point) => `${round(x)},${round(y)}`;

/**
 * Pseudo-random numbers in [0, 1) seeded by a string (FNV-1a into mulberry32). Pen marks take
 * their irregularity from their overlay key, so a mark looks the same on every render.
 */
export function penRandom(key: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  let s = h >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const roomAround = (r: BBox, c: BBox): Record<PenSide, number> => ({
  left: r[0] - c[0],
  right: c[2] - r[2],
  top: r[1] - c[1],
  bottom: c[3] - r[3],
});

/** How far around its area an arrow may reach: a zoom on a figure (padding 0.12) still shows it. */
const AREA_MARGIN = 0.1;

interface ArrowFit {
  side: PenSide;
  len: number;
  /** What the tail stays inside: the area's surroundings or the page. */
  box: BBox;
  /** How far inside the area the tail lies, from its edge; 0 at or outside it. */
  depth: number;
}

/** A tail deeper than this inside its area gets its label above or below it rather than beyond it. */
const DEEP_TAIL = 12;

/**
 * Where an arrow comes from and how long it is. `area` is the figure or text column the target
 * sits in, and `reach(len)` the room an arrow of that length needs. With auto, sides that keep
 * the arrow within the area's surroundings come first; then the side whose tail sits least deep
 * inside the area, so the tail and its label sit at its edge rather than over its content; then
 * the most room on the page, where room beyond what the arrow needs counts the same; ties go
 * left, right, top, bottom. An explicit side that does not fit on the page gives way to the
 * opposite side, if that fits.
 */
function fitArrow(
  region: BBox,
  page: BBox,
  area: BBox | null,
  from: PenSide | 'auto',
  want: number,
  reach: (len: number) => number,
): ArrowFit {
  const frame: BBox | null = area && [
    Math.max(page[0], area[0] - AREA_MARGIN * (area[2] - area[0])),
    Math.max(page[1], area[1] - AREA_MARGIN * (area[3] - area[1])),
    Math.min(page[2], area[2] + AREA_MARGIN * (area[2] - area[0])),
    Math.min(page[3], area[3] + AREA_MARGIN * (area[3] - area[1])),
  ];
  const onPage = roomAround(region, page);
  const inFrame = frame ? roomAround(region, frame) : onPage;
  const inArea = area ? roomAround(region, area) : null;
  const shortest = Math.max(ARROW_MIN, 0.75 * want);
  const fit = (side: PenSide) => {
    const framed = inFrame[side] >= reach(shortest);
    const room = framed ? inFrame[side] : onPage[side];
    // The longest arrow that fits: reach is linear in the length.
    const len = clamp((room - reach(0)) / (reach(1) - reach(0)), ARROW_MIN, want);
    const depth = inArea ? Math.max(0, inArea[side] - reach(len)) : 0;
    const fits = framed || onPage[side] >= reach(ARROW_MIN);
    return { side, len, box: framed && frame ? frame : page, framed, depth, fits };
  };

  if (from !== 'auto') {
    const given = fit(from);
    const other = fit(OPPOSITE[from]);
    return given.fits || !other.fits ? given : other;
  }
  const all = SIDE_ORDER.map(fit);
  const framed = all.filter((f) => f.framed);
  const fitting = all.filter((f) => f.fits);
  const pool = framed.length ? framed : fitting.length ? fitting : all;
  const pageRoom = (f: (typeof all)[number]) => Math.min(onPage[f.side], reach(want));
  return pool.reduce((best, f) => {
    const deeper = Math.round(f.depth) - Math.round(best.depth);
    if (deeper) return deeper < 0 ? f : best;
    return pageRoom(f) > pageRoom(best) ? f : best;
  });
}

/**
 * An arrow pointing at `region` (page points) from outside it, its tail on the page and near the
 * edge of `area`, the figure or text column the target sits in. The shaft comes in at a slight
 * angle and bends so that it meets the target nearly head-on.
 */
export function penArrow(
  key: string,
  color: Color,
  region: BBox,
  page: BBox,
  area: BBox | null,
  from: ArrowAction['from'] = 'auto',
): PenArrowShape {
  const rand = penRandom(key);
  const slant = (16 + 8 * rand()) * DEG;
  const bend = 0.1 + 0.06 * rand();
  const flip = rand() < 0.5;
  const uneven = [rand(), rand(), rand(), rand()];

  const w = Math.max(1, region[2] - region[0]);
  const h = Math.max(1, region[3] - region[1]);
  const want = clamp(0.45 * Math.sqrt(w * h), 34, ARROW_MAX);
  // The room an arrow of length len needs: the gap, its run along the side, and the edge margin.
  const reach = (len: number) => ARROW_GAP + len * Math.cos(slant) + PEN_EDGE;
  const { side, len, box, depth } = fitArrow(region, page, area, from ?? 'auto', want, reach);

  const [ox, oy] = OUTWARD[side];
  const cx = (region[0] + region[2]) / 2;
  const cy = (region[1] + region[3]) / 2;
  const tip: Point = [
    round(side === 'left' ? region[0] - ARROW_GAP : side === 'right' ? region[2] + ARROW_GAP : cx),
    round(side === 'top' ? region[1] - ARROW_GAP : side === 'bottom' ? region[3] + ARROW_GAP : cy),
  ];
  // The tail leans off the straight line: from above for side arrows (like a note written over
  // the target), to either side for vertical ones; whichever keeps it inside its box.
  const across: Point[] = ox ? [[0, -1], [0, 1]] : flip ? [[-1, 0], [1, 0]] : [[1, 0], [-1, 0]];
  const tailFor = ([px, py]: Point): Point => [
    round(tip[0] + (ox * Math.cos(slant) + px * Math.sin(slant)) * len),
    round(tip[1] + (oy * Math.cos(slant) + py * Math.sin(slant)) * len),
  ];
  const inside = ([x, y]: Point) =>
    x >= box[0] + PEN_EDGE && x <= box[2] - PEN_EDGE && y >= box[1] + PEN_EDGE && y <= box[3] - PEN_EDGE;
  const tail = tailFor(across.find((p) => inside(tailFor(p))) ?? across[0]);
  const labelSide: PenSide =
    depth < DEEP_TAIL ? side : ox ? (tail[1] < tip[1] ? 'top' : 'bottom') : tail[0] < tip[0] ? 'left' : 'right';

  // Bow the shaft to the side that turns its end towards the target.
  const mid: Point = [(tail[0] + tip[0]) / 2, (tail[1] + tip[1]) / 2];
  const chord = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]);
  const normal: Point = [-(tip[1] - tail[1]) / chord, (tip[0] - tail[0]) / chord];
  const facing = ([x, y]: Point) => (-(tip[0] - x) * ox - (tip[1] - y) * oy) / Math.hypot(tip[0] - x, tip[1] - y);
  const control = ([1, -1] as const)
    .map((s): Point => [mid[0] + normal[0] * bend * len * s, mid[1] + normal[1] * bend * len * s])
    .reduce((best, c) => (facing(c) > facing(best) ? c : best));
  const angle = Math.atan2(tip[1] - control[1], tip[0] - control[0]) / DEG;

  // A slightly uneven head, like one drawn by hand.
  const wing = (spread: number, length: number, sign: number) =>
    `M0,0L${round(-length * Math.cos(spread * DEG), 3)},${round(sign * length * Math.sin(spread * DEG), 3)}`;
  const wings: [string, string] = [
    wing(25 + 4 * uneven[0], 0.95 + 0.1 * uneven[1], -1),
    wing(25 + 4 * uneven[2], 0.95 + 0.1 * uneven[3], 1),
  ];
  const headRoom = HEAD_MAX * len;
  const xs = [tail[0], control[0], tip[0]];
  const ys = [tail[1], control[1], tip[1]];
  return {
    kind: 'arrow',
    key,
    color,
    side,
    labelSide,
    tail,
    tip,
    d: `M${pt(tail)}Q${pt(control)} ${pt(tip)}`,
    angle: round(angle),
    wings,
    head: { fit: round(HEAD_FIT * len), max: round(HEAD_MAX * len) },
    bounds: [
      Math.min(...xs) - headRoom,
      Math.min(...ys) - headRoom,
      Math.max(...xs) + headRoom,
      Math.max(...ys) + headRoom,
    ],
  };
}

/**
 * A loop around `region` (page points): a slightly irregular ellipse, drawn counter-clockwise
 * from about eleven o'clock, once around and a little past its start, its end running just wide
 * of the start like one confident pen stroke. It is the smallest such loop around the padded
 * region, so a wide target gets a flat loop, and large targets get a squarer one that hugs them
 * instead of ballooning out of the frame.
 */
export function penCircle(key: string, color: Color, region: BBox): PenCircleShape {
  const rand = penRandom(key);
  const start = (-115 + 20 * (rand() - 0.5)) * DEG;
  const lap = rand();
  const offset = 2 + rand(); // how far outside its start the end passes, in page points
  const w2 = 0.008 + 0.006 * rand();
  const p2 = 2 * Math.PI * rand();
  const w3 = 0.003 + 0.004 * rand();
  const p3 = 2 * Math.PI * rand();

  const a = Math.max(4, (region[2] - region[0]) / 2 + CIRCLE_PAD);
  const b = Math.max(4, (region[3] - region[1]) / 2 + CIRCLE_PAD);
  const mean = Math.sqrt(a * b);
  const k = 0.07 * clamp((mean - 25) / 120, 0, 1);
  // A flat target gets a loop that clears its long sides less than its ends (and a tall one the
  // other way round): around a line or an equation the white space lies at the ends.
  const ka = Math.sqrt(a / mean);
  const kb = Math.sqrt(b / mean);
  // An ellipse with a touch of third harmonic (k), which squares it off; convex for k < 1/9.
  const shape = (t: number): Point => [Math.cos(t) - k * Math.cos(3 * t), Math.sin(t) + k * Math.sin(3 * t)];
  const slopeOf = (t: number): Point => [-Math.sin(t) + 3 * k * Math.sin(3 * t), Math.cos(t) + 3 * k * Math.cos(3 * t)];
  // Is the corner (a, b) inside the loop that reaches a + d·ka and b + d·kb on the axes? Its x
  // falls from its maximum to 0 over t in [0, π/2], so find where it passes a and compare y there.
  const encloses = (d: number) => {
    const rx = (a + d * ka) / (1 - k);
    let lo = 0;
    let hi = Math.PI / 2;
    for (let i = 0; i < 32; i++) {
      const t = (lo + hi) / 2;
      if (rx * shape(t)[0] > a) lo = t;
      else hi = t;
    }
    return ((b + d * kb) / (1 - k)) * shape(lo)[1] >= b;
  };
  let lo = 0;
  let hi = 4 * Math.max(a, b);
  for (let i = 0; i < 40; i++) {
    const d = (lo + hi) / 2;
    if (encloses(d)) hi = d;
    else lo = d;
  }
  // Grown so that the wobble below never cuts into the padded region.
  const rx = (a + hi * ka) / (1 - k) / (1 - WOBBLE);
  const ry = (b + hi * kb) / (1 - k) / (1 - WOBBLE);
  const cx = (region[0] + region[2]) / 2;
  const cy = (region[1] + region[3]) / 2;
  // Big loops overlap their start by a smaller angle, so the doubled stretch stays short.
  const sweep = 2 * Math.PI + (18 + 14 * lap) * DEG * clamp(Math.sqrt(40 / Math.sqrt(rx * ry)), 0.5, 1);

  // s runs from 0 to 1 along the stroke. Late in the lap the stroke eases outwards along its
  // normal, passing `offset` outside its start.
  const at = (s: number): Point => {
    const t = start - sweep * s;
    const f = 1 + w2 * Math.sin(2 * t + p2) + w3 * Math.sin(3 * t + p3);
    const [ux, uy] = shape(t);
    const [tx, ty] = slopeOf(t);
    const n = Math.hypot(rx * tx, ry * ty) || 1;
    // The normal facing away from the centre.
    const sign = ry * ty * ux * rx - rx * tx * uy * ry >= 0 ? 1 : -1;
    const u = (s * sweep) / (2 * Math.PI);
    const out = offset * Math.max(0, (u - 0.7) / 0.3) ** 2;
    return [
      cx + rx * f * ux + ((sign * ry * ty) / n) * out,
      cy + ry * f * uy - ((sign * rx * tx) / n) * out,
    ];
  };
  const SEGMENTS = 16;
  const EPS = 1e-4;
  const velocity = (s: number): Point => {
    const [x0, y0] = at(s - EPS);
    const [x1, y1] = at(s + EPS);
    return [(x1 - x0) / (2 * EPS), (y1 - y0) / (2 * EPS)];
  };
  // Cubic Béziers through points on the curve, with handles along its tangents.
  let d = `M${pt(at(0))}`;
  const handle = 1 / (3 * SEGMENTS);
  for (let i = 0; i < SEGMENTS; i++) {
    const p0 = at(i / SEGMENTS);
    const p1 = at((i + 1) / SEGMENTS);
    const v0 = velocity(i / SEGMENTS);
    const v1 = velocity((i + 1) / SEGMENTS);
    const c0: Point = [p0[0] + v0[0] * handle, p0[1] + v0[1] * handle];
    const c1: Point = [p1[0] - v1[0] * handle, p1[1] - v1[1] * handle];
    d += `C${pt(c0)} ${pt(c1)} ${pt(p1)}`;
  }
  const corner = Math.SQRT1_2 * (1 + k);
  const ex = rx * (1 + WOBBLE) + 2 * offset;
  const ey = ry * (1 + WOBBLE) + 2 * offset;
  return {
    kind: 'circle',
    key,
    color,
    d,
    labelAt: [cx + rx * corner, cy - ry * corner],
    bounds: [cx - ex, cy - ey, cx + ex, cy + ey],
  };
}

/**
 * The area an arrow at `target` should start at the edge of: the figure (or table) for a figure
 * or panel; for text, its block's column over the page's height, so arrows come in from the
 * margins rather than over neighbouring text.
 */
function areaOf(resolver: Resolver, target: string, pageHeight: number): BBox | null {
  const doc = resolver.doc;
  const kind = resolver.kind(target);
  if (!doc) return null;
  if (kind === 'figure' || kind === 'panel') {
    const figure = kind === 'figure' ? target : doc.figures.find((f) => f.panels.some((p) => p.id === target))?.id;
    const g = figure ? resolver.resolve(figure)?.[0] : undefined;
    return g ? unionRect(g.rects) : null;
  }
  const blockId =
    kind === 'sentence'
      ? doc.sentences.find((s) => s.id === target)?.block
      : kind === 'section'
        ? doc.sections.find((s) => s.id === target)?.block
        : kind === 'equation'
          ? doc.equations.find((e) => e.id === target)?.block
          : kind === 'block'
            ? target
            : undefined;
  const block = blockId ? doc.blocks.find((b) => b.id === blockId) : undefined;
  return block ? [block.bbox[0], 0, block.bbox[2], pageHeight] : null;
}

export function buildScene(overlays: OverlayEntry[], resolver: Resolver, layout: Layout): Scene {
  const scene: Scene = { pages: new Map(), spotlight: false, notes: [], labels: [] };
  const page = (n: number) => {
    let shapes = scene.pages.get(n);
    if (!shapes) scene.pages.set(n, (shapes = { markers: [], underlines: [], boxes: [], holes: [], pens: [] }));
    return shapes;
  };

  for (const { key, action: a } of overlays) {
    switch (a.type) {
      case 'highlight': {
        const color = a.color ?? DEFAULT_COLOR;
        const list = a.style === 'underline' ? 'underlines' : 'markers';
        a.targets.forEach((t, i) => {
          for (const g of resolver.resolve(t, { lines: true }) ?? []) {
            page(g.page)[list].push({ key: `${key}.${i}.${g.page}`, rects: g.rects, color });
          }
        });
        break;
      }
      case 'box': {
        const groups = resolver.resolveTarget(a.target, a.region);
        const color = a.color ?? DEFAULT_COLOR;
        const g = groups?.[0];
        if (!g) break;
        const rect = pad(stageRect(layout, [g])!.rect, BOX_PAD);
        const local = pad(unionRect(g.rects), BOX_PAD);
        page(g.page).boxes.push({ key, rect: local, color });
        if (a.label) scene.labels.push({ key, text: a.label, color, rect });
        break;
      }
      case 'spotlight': {
        scene.spotlight = true;
        for (const g of resolver.resolveTarget(a.target, a.region) ?? []) {
          page(g.page).holes.push(pad(unionRect(g.rects), SPOT_PAD));
        }
        break;
      }
      case 'note': {
        const groups = resolver.resolveTarget(a.anchor, a.region);
        const target = groups && stageRect(layout, groups);
        if (target) scene.notes.push({ key, text: a.text, side: a.side ?? 'auto', rect: target.rect });
        break;
      }
      case 'arrow':
      case 'circle': {
        const g = resolver.resolveTarget(a.target, a.region)?.[0];
        const box = g && layout.pages[g.page - 1];
        if (!g || !box) break;
        const color = a.color ?? DEFAULT_COLOR;
        const region = unionRect(g.rects);
        const area = a.type === 'arrow' ? areaOf(resolver, a.target, box.height) : null;
        const pen =
          a.type === 'arrow'
            ? penArrow(key, color, region, [0, 0, box.width, box.height], area, a.from)
            : penCircle(key, color, region);
        page(g.page).pens.push(pen);
        if (a.label) {
          const [x, y] = pen.kind === 'arrow' ? pen.tail : pen.labelAt;
          const [sx, sy] = toStage(layout, g.page, [x, y, x, y]);
          const side = pen.kind === 'arrow' ? pen.labelSide : 'upper-right';
          const rect = toStage(layout, g.page, pen.bounds);
          scene.labels.push({ key, text: a.label, color, rect, pin: { x: sx, y: sy, side } });
        }
        break;
      }
    }
  }
  for (const shapes of scene.pages.values()) {
    if (shapes.holes.length > 1) shapes.holes = mergeHoles(shapes.holes);
  }
  return scene;
}
