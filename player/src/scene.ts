// Turns the engine's active overlays into geometry: SVG shapes per page (in page points) and
// screen-space items (notes, box and pen labels) anchored to stage rects.

import { DEFAULT_COLOR } from './types';
import type { ArrowAction, BBox, CameraAction, Color, NoteAction } from './types';
import { stageRect, toStage } from './layout';
import type { Layout } from './layout';
import type { OverlayEntry } from './engine';
import { unionRect } from './resolve';
import type { Resolver } from './resolve';

export const BOX_PAD = 2;
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
  /** The other of those two sides, for a label that does not fit on screen at the first. */
  labelAlt: PenSide;
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
  leaving?: boolean;
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
  leaving?: boolean;
}

export type PenShape = PenArrowShape | PenCircleShape;

export interface PageShapes {
  markers: { key: string; rects: BBox[]; color: Color; leaving?: boolean }[];
  underlines: { key: string; rects: BBox[]; color: Color; leaving?: boolean }[];
  boxes: { key: string; rect: BBox; color: Color; leaving?: boolean }[];
  /** Spotlight holes on this page. */
  holes: BBox[];
  /** A gentle reading veil inferred from the active narration focus. */
  readingSpotlight?: boolean;
  /** Arrows and circles, drawn above the spotlight. */
  pens: PenShape[];
}

export interface SceneNote {
  key: string;
  text: string;
  side: NonNullable<NoteAction['side']>;
  /** Anchor in stage coordinates. */
  rect: BBox;
  leaving?: boolean;
}

export interface SceneLabel {
  key: string;
  text: string;
  color: Color;
  /** A box label's box; for a pen label the bounds of its mark. In stage coordinates. */
  rect: BBox;
  /**
   * Pen labels only: the stage point the label hangs from, the side of it the label sits on, and
   * for an arrow the side it takes when it does not fit there.
   */
  pin?: { x: number; y: number; side: PenLabelSide; alt?: PenSide };
  /** Parent visual in stage coordinates: optional labels must stay outside it. */
  area?: BBox;
  leaving?: boolean;
}

export interface Scene {
  pages: Map<number, PageShapes>;
  /** Any spotlight active: every page dims except the holes. */
  spotlight: boolean;
  /** Every spotlight shown is leaving. */
  spotlightLeaving?: boolean;
  notes: SceneNote[];
  labels: SceneLabel[];
  /** PDF content in stage coordinates, kept clear by measured screen labels. */
  obstacles: BBox[];
}

const pad = (r: BBox, d: number): BBox => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
const overlaps = (a: BBox, b: BBox) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/** At most two PDF points of clearance, reduced next to an actual neighbouring
 * source/component. Containing figures and text inside the target are not neighbours. */
export function paddedBox(region: BBox, neighbours: BBox[]): BBox {
  let left = BOX_PAD, top = BOX_PAD, right = BOX_PAD, bottom = BOX_PAD;
  const [x0, y0, x1, y1] = region;
  for (const other of neighbours) {
    if (overlaps(region, other)) continue;
    if (other[1] < y1 + BOX_PAD && other[3] > y0 - BOX_PAD) {
      if (other[2] <= x0) left = Math.min(left, (x0 - other[2]) / 2);
      if (other[0] >= x1) right = Math.min(right, (other[0] - x1) / 2);
    }
    if (other[0] < x1 + BOX_PAD && other[2] > x0 - BOX_PAD) {
      if (other[3] <= y0) top = Math.min(top, (y0 - other[3]) / 2);
      if (other[1] >= y1) bottom = Math.min(bottom, (other[1] - y1) / 2);
    }
  }
  return [x0 - left, y0 - top, x1 + right, y1 + bottom];
}

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
/** About how far a label reaches past its tail, in page points, when checking for other marks there. */
const LABEL_ROOM = 16;

/**
 * Where an arrow comes from and how long it is. `area` is the figure or text column the target
 * sits in, and `reach(len)` the room an arrow of that length needs. With auto, sides that keep
 * the arrow within the area's surroundings (the camera's frame) come first, at full length before
 * shortened, and in each group sides whose tail stays clear of the marks in `avoid`; then the side
 * whose tail sits least deep inside the area, so the tail and its label sit at its edge rather
 * than over its content; then the most room on the page, where room beyond what the arrow needs
 * counts the same; ties go left, right, top, bottom. An explicit side that does not fit on the
 * page gives way to the opposite side, if that fits.
 */
function fitArrow(
  region: BBox,
  page: BBox,
  area: BBox | null,
  from: PenSide | 'auto',
  want: number,
  reach: (len: number) => number,
  avoid: BBox[] = [],
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
    // Room in the area's surroundings for at least the shortest arrow, so it stays in view.
    const near = inFrame[side] >= reach(ARROW_MIN);
    const room = near ? inFrame[side] : onPage[side];
    // The longest arrow that fits: reach is linear in the length.
    const len = clamp((room - reach(0)) / (reach(1) - reach(0)), ARROW_MIN, want);
    const depth = inArea ? Math.max(0, inArea[side] - reach(len)) : 0;
    const fits = near || onPage[side] >= reach(ARROW_MIN);
    // Where the tail (and the label just beyond it) would land, near enough: straight out from the target.
    const [ox, oy] = OUTWARD[side];
    const out = reach(len) + LABEL_ROOM;
    const x = ox ? (ox < 0 ? region[0] : region[2]) + ox * out : (region[0] + region[2]) / 2;
    const y = oy ? (oy < 0 ? region[1] : region[3]) + oy * out : (region[1] + region[3]) / 2;
    const clear = !avoid.some((r) => x > r[0] && x < r[2] && y > r[1] && y < r[3]);
    return { side, len, box: near && frame ? frame : page, framed, near, depth, fits, clear };
  };

  if (from !== 'auto') {
    const given = fit(from);
    const other = fit(OPPOSITE[from]);
    return given.fits || !other.fits ? given : other;
  }
  const all = SIDE_ORDER.map(fit);
  const pick = (ok: (f: (typeof all)[number]) => boolean) => all.filter(ok);
  // Staying near the area (in the camera's frame) matters most, then keeping off other marks,
  // then a full-length arrow.
  const pool = [
    pick((f) => f.clear && f.framed),
    pick((f) => f.clear && f.near),
    pick((f) => f.framed),
    pick((f) => f.near),
    pick((f) => f.clear && f.fits),
    pick((f) => f.fits),
    all,
  ].find((p) => p.length)!;
  const pageRoom = (f: (typeof all)[number]) => Math.min(onPage[f.side], reach(want));
  return pool.reduce((best, f) => {
    const deeper = Math.round(f.depth) - Math.round(best.depth);
    if (deeper) return deeper < 0 ? f : best;
    return pageRoom(f) > pageRoom(best) ? f : best;
  });
}

/**
 * An arrow pointing at `region` (page points) from outside it, its tail on the page and near the
 * edge of `area`, the figure or text column the target sits in, and when it can, away from the
 * marks already drawn there (`avoid`). The shaft comes in at a slight angle and bends so that it
 * meets the target nearly head-on.
 */
export function penArrow(
  key: string,
  color: Color,
  region: BBox,
  page: BBox,
  area: BBox | null,
  from: ArrowAction['from'] = 'auto',
  avoid: BBox[] = [],
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
  const { side, len, box, depth } = fitArrow(region, page, area, from ?? 'auto', want, reach, avoid);

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
  const lean: PenSide = ox ? (tail[1] < tip[1] ? 'top' : 'bottom') : tail[0] < tip[0] ? 'left' : 'right';
  const labelSide = depth < DEEP_TAIL ? side : lean;

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
    labelAlt: labelSide === side ? lean : side,
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

/** A straight segment crossing a rectangle, including its border. */
function crossesRect(a: Point, b: Point, rect: BBox): boolean {
  let lo = 0, hi = 1;
  for (const axis of [0, 1] as const) {
    const delta = b[axis] - a[axis];
    if (Math.abs(delta) < 1e-8) {
      if (a[axis] < rect[axis] || a[axis] > rect[axis + 2]) return false;
    } else {
      const t0 = (rect[axis] - a[axis]) / delta;
      const t1 = (rect[axis + 2] - a[axis]) / delta;
      lo = Math.max(lo, Math.min(t0, t1));
      hi = Math.min(hi, Math.max(t0, t1));
      if (lo > hi) return false;
    }
  }
  return true;
}

/** A leader from outside a figure, never through known printed content. The
 * finite set of short, straight routes is intentional: an elaborate detour can
 * suggest an extra connection in the source diagram. No clear route means an
 * outline is safer. `from` is a preference, never an override of collisions. */
export function externalArrow(
  key: string,
  color: Color,
  region: BBox,
  page: BBox,
  area: BBox,
  obstacles: BBox[] = [],
  from: ArrowAction['from'] = 'auto',
): PenArrowShape | null {
  const sides = from && from !== 'auto' ? [from, ...SIDE_ORDER.filter(side => side !== from)] : SIDE_ORDER;
  const candidates: { arrow: PenArrowShape; score: number }[] = [];
  const maxLength = Math.max(ARROW_MAX, 0.7 * Math.min(area[2] - area[0], area[3] - area[1]));
  for (const side of sides) {
    const base = penArrow(key, color, region, page, null, side);
    if (base.side !== side) continue;
    const [ox, oy] = OUTWARD[side];
    // Text extraction is not a map of the diagram's lines. Only cross a small
    // boundary corridor; a central component gets an outline even when the
    // surrounding raster artwork has no extracted text to flag as an obstacle.
    const penetration = Math.max(0, side === 'left' ? base.tip[0] - area[0] : side === 'right' ? area[2] - base.tip[0]
      : side === 'top' ? base.tip[1] - area[1] : area[3] - base.tip[1]);
    if (penetration > Math.min(18, 0.1 * Math.min(area[2] - area[0], area[3] - area[1]))) continue;
    for (const lean of [0, -12, 12]) {
      const tail: Point = [
        ox < 0 ? Math.min(area[0] - 12, base.tip[0] - ARROW_MIN) : ox > 0 ? Math.max(area[2] + 12, base.tip[0] + ARROW_MIN) : base.tip[0] + lean,
        oy < 0 ? Math.min(area[1] - 12, base.tip[1] - ARROW_MIN) : oy > 0 ? Math.max(area[3] + 12, base.tip[1] + ARROW_MIN) : base.tip[1] + lean,
      ];
      if (tail[0] < page[0] + PEN_EDGE || tail[0] > page[2] - PEN_EDGE || tail[1] < page[1] + PEN_EDGE || tail[1] > page[3] - PEN_EDGE) continue;
      const len = Math.hypot(tail[0] - base.tip[0], tail[1] - base.tip[1]);
      if (len > maxLength || obstacles.some(rect => crossesRect(tail, base.tip, pad(rect, 2)))) continue;
      // A zero-bend quadratic retains the existing SVG draw animation without
      // wandering into nearby labels. Head wings remain behind the target gap.
      const middle: Point = [(tail[0] + base.tip[0]) / 2, (tail[1] + base.tip[1]) / 2];
      const head = { fit: Math.min(12, HEAD_FIT * len), max: Math.min(17, HEAD_MAX * len) };
      const angle = Math.atan2(base.tip[1] - tail[1], base.tip[0] - tail[0]);
      const wings = base.wings.map(path => {
        const [, , x, y] = (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
        return [base.tip[0] + head.max * (x * Math.cos(angle) - y * Math.sin(angle)),
          base.tip[1] + head.max * (x * Math.sin(angle) + y * Math.cos(angle))] as Point;
      });
      if (wings.some(end => obstacles.some(rect => crossesRect(base.tip, end, pad(rect, 2))))) continue;
      const arrow: PenArrowShape = {
        ...base, tail, labelSide: side, labelAlt: side,
        d: `M${pt(tail)}Q${pt(middle)} ${pt(base.tip)}`,
        angle: round(Math.atan2(base.tip[1] - tail[1], base.tip[0] - tail[0]) / DEG),
        head,
        bounds: [Math.min(tail[0], base.tip[0]) - head.max, Math.min(tail[1], base.tip[1]) - head.max,
          Math.max(tail[0], base.tip[0]) + head.max, Math.max(tail[1], base.tip[1]) + head.max],
      };
      candidates.push({ arrow, score: len + Math.abs(lean) * 0.2 + (side === from ? -8 : 0) });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates[0]?.arrow ?? null;
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
  const offset = 1.3 + 0.7 * rand(); // how far outside its start the end passes, in page points
  const w2 = 0.008 + 0.006 * rand();
  const p2 = 2 * Math.PI * rand();
  const w3 = 0.003 + 0.004 * rand();
  const p3 = 2 * Math.PI * rand();

  const a = Math.max(4, (region[2] - region[0]) / 2 + CIRCLE_PAD);
  const b = Math.max(4, (region[3] - region[1]) / 2 + CIRCLE_PAD);
  const mean = Math.sqrt(a * b);
  // How flat (or tall) the target is: 0 for a square up to 1 from about 5:1 on.
  const flat = clamp((Math.max(a, b) / Math.min(a, b) - 1.6) / 3, 0, 1);
  // Large and flat targets get a squarer loop, so it hugs them rather than bulging into the
  // lines of text above and below an equation or a sentence.
  const k = Math.min(0.1, 0.1 * clamp((mean - 25) / 120, 0, 1) + 0.08 * flat);
  // A flat target gets a loop that clears its long sides less than its ends (and a tall one the
  // other way round): around a line or an equation the white space lies at the ends.
  const split = 0.5 + 0.35 * flat;
  const ka = (a / mean) ** split;
  const kb = (b / mean) ** split;
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
  const sweep = 2 * Math.PI + (14 + 10 * lap) * DEG * clamp(Math.sqrt(40 / Math.sqrt(rx * ry)), 0.5, 1);

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

/** Existing source geometry only: no model or image-based guesses. */
function printedRects(resolver: Resolver): { page: number; rect: BBox }[] {
  const doc = resolver.doc;
  if (!doc) return [];
  const sentenceBlocks = new Set(doc.sentences.filter(sentence => sentence.rects.length).map(sentence => sentence.block));
  return [
    ...doc.sentences.flatMap(sentence => sentence.rects.map(rect => ({ page: sentence.page, rect }))),
    ...doc.blocks.filter(block => block.text.trim() && !sentenceBlocks.has(block.id)).map(block => ({ page: block.page, rect: block.bbox })),
  ];
}

function visualArea(resolver: Resolver, target: string): BBox | null {
  const doc = resolver.doc;
  const group = resolver.resolve(target)?.[0];
  if (!doc || !group) return null;
  const rect = unionRect(group.rects);
  const contains = (outer: BBox) => rect[0] >= outer[0] - 1 && rect[1] >= outer[1] - 1 && rect[2] <= outer[2] + 1 && rect[3] <= outer[3] + 1;
  const matches = doc.figures.filter(figure => figure.page === group.page &&
    (figure.id === target || figure.panels.some(panel => panel.id === target) || contains(figure.bbox)));
  matches.sort((a, b) => (a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1]) - (b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1]));
  return matches[0]?.bbox ?? null;
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

export function buildScene(overlays: OverlayEntry[], resolver: Resolver, layout: Layout, readingFocus?: CameraAction | null): Scene {
  const content = printedRects(resolver);
  const occupied = [...content, ...(resolver.doc?.figures ?? []).map(figure => ({ page: figure.page, rect: figure.bbox })),
    ...(resolver.doc?.equations ?? []).map(equation => ({ page: equation.page, rect: equation.bbox }))];
  const scene: Scene = { pages: new Map(), spotlight: false, notes: [], labels: [],
    obstacles: occupied.filter(item => layout.pages[item.page - 1]).map(item => toStage(layout, item.page, item.rect)) };

  const isTextTarget = (target: string) => ['sentence', 'block', 'section', 'exercise'].includes(resolver.kind(target) ?? '');
  const page = (n: number) => {
    let shapes = scene.pages.get(n);
    if (!shapes) scene.pages.set(n, (shapes = { markers: [], underlines: [], boxes: [], holes: [], pens: [] }));
    return shapes;
  };

  // Measured authoring publishes canonical figure regions. Keep nearby authored
  // components separate; border clearance must not turn them into a union box.
  const boxNeighbors = [...occupied, ...(resolver.doc?.figures ?? []).flatMap(figure =>
    figure.panels.map(panel => ({ page: figure.page, rect: panel.bbox })))];
  for (const { action } of overlays) {
    if (action.type !== 'box') continue;
    for (const group of resolver.resolveTarget(action.target, action.region) ?? [])
      boxNeighbors.push({ page: group.page, rect: unionRect(group.rects) });
  }

  // A mark of a step that has ended is leaving: it fades out while the camera moves on.
  let spotlights = 0;
  let leavingSpotlights = 0;
  for (const { key, action: a, leaving } of overlays) {
    const fade = leaving ? { leaving: true } : {};
    switch (a.type) {
      case 'highlight': {
        const color = a.color ?? DEFAULT_COLOR;
        const list = a.style === 'underline' ? 'underlines' : 'markers';
        a.targets.forEach((t, i) => {
          for (const g of resolver.resolve(t, { lines: true }) ?? []) {
            page(g.page)[list].push({ key: `${key}.${i}.${g.page}`, rects: g.rects, color, ...fade });
          }
        });
        break;
      }
      case 'box': {
        const groups = resolver.resolveTarget(a.target, a.region);
        const color = a.color ?? DEFAULT_COLOR;
        const g = groups?.[0];
        if (!g) break;
        const area = visualArea(resolver, a.target);
        const local = paddedBox(unionRect(g.rects), boxNeighbors.filter(item => item.page === g.page).map(item => item.rect));
        const rect = toStage(layout, g.page, local);
        page(g.page).boxes.push({ key, rect: local, color, ...fade });
        if (a.label) scene.labels.push({ key, text: a.label, color, rect, ...fade, ...(area ? { area: toStage(layout, g.page, area) } : {}) });
        break;
      }
      case 'spotlight': {
        // Ordinary prose stays readable as a whole page. Old text spotlights
        // become precise line highlights, ignoring guessed regions that can
        // slice through letters. Deliberate visual spotlights remain unchanged.
        if (isTextTarget(a.target)) {
          for (const g of resolver.resolve(a.target, { lines: true }) ?? [])
            page(g.page).markers.push({ key: `${key}.${g.page}`, rects: g.rects, color: DEFAULT_COLOR, ...fade });
          break;
        }
        for (const g of resolver.resolveTarget(a.target, a.region) ?? []) {
          scene.spotlight = true;
          spotlights++;
          if (leaving) leavingSpotlights++;
          page(g.page).holes.push(pad(unionRect(g.rects), SPOT_PAD));
        }
        break;
      }
      case 'note': {
        const groups = resolver.resolveTarget(a.anchor, a.region);
        const target = groups && stageRect(layout, groups);
        if (target) scene.notes.push({ key, text: a.text, side: a.side ?? 'auto', rect: target.rect, ...fade });
        break;
      }
      case 'arrow':
      case 'circle': {
        const g = resolver.resolveTarget(a.target, a.region)?.[0];
        const box = g && layout.pages[g.page - 1];
        if (!g || !box) break;
        const color = a.color ?? DEFAULT_COLOR;
        const region = unionRect(g.rects);
        const shapes = page(g.page);
        const sheet: BBox = [0, 0, box.width, box.height];
        // An arrow keeps its tail and label off the marks drawn before it on the page.
        const drawn = [...shapes.pens.map((p) => p.bounds), ...shapes.boxes.map((b) => b.rect)];
        const area = visualArea(resolver, a.target);
        const obstacles = content.filter(item => item.page === g.page).map(item => item.rect).concat(drawn);
        const arrow = a.type === 'arrow' && area ? externalArrow(key, color, region, sheet, area, obstacles, a.from) : null;
        // Preserve the authored shape. Legacy guesses need regeneration against measured
        // targets; the player must not disguise them as a different whole-figure outline.
        const pen = a.type === 'arrow'
          ? arrow ?? penArrow(key, color, region, sheet, area ?? areaOf(resolver, a.target, box.height), a.from, drawn)
          : penCircle(key, color, region);
        shapes.pens.push(leaving ? { ...pen, leaving: true } : pen);
        if (a.label) {
          const [x, y] = pen.kind === 'arrow' ? pen.tail : pen.labelAt;
          const [sx, sy] = toStage(layout, g.page, [x, y, x, y]);
          const pin =
            pen.kind === 'arrow' ? { side: pen.labelSide, alt: pen.labelAlt } : { side: 'upper-right' as const };
          const rect = toStage(layout, g.page, pen.bounds);
          scene.labels.push({ key, text: a.label, color, rect, pin: { x: sx, y: sy, ...pin }, ...fade, ...(area ? { area: toStage(layout, g.page, area) } : {}) });
        }
        break;
      }
    }
  }
  if (spotlights && spotlights === leavingSpotlights) scene.spotlightLeaving = true;
  // Visual orientation may use a gentle veil before a spoken mark appears.
  // Text reading uses its authored line highlights without automatically dimming.
  const readingKind = readingFocus && resolver.kind(readingFocus.target);
  const visualFocus = readingFocus?.type === 'zoom' && !isTextTarget(readingFocus.target) &&
    (['figure', 'panel', 'equation'].includes(readingKind ?? '') || !!readingFocus.region);
  if (!scene.spotlight && readingFocus && visualFocus) {
    const groups = resolver.resolveTarget(readingFocus.target, readingFocus.type === 'zoom' ? readingFocus.region : undefined);
    const marked = groups?.some(group => {
      const shapes = scene.pages.get(group.page);
      return shapes && (shapes.markers.length || shapes.underlines.length || shapes.boxes.length || shapes.pens.length);
    });
    // Orient with a light veil first. Once a spoken highlight or pen mark appears,
    // it becomes the primary emphasis and the automatic veil retires. Authored
    // spotlights remain explicit choices, rather than receiving a second effect.
    if (groups?.length && !marked) {
      scene.spotlight = true;
      for (const box of layout.pages) page(box.n).readingSpotlight = true;
      for (const group of groups) page(group.page).holes.push(pad(unionRect(group.rects), SPOT_PAD + 3));
    }
  }
  for (const shapes of scene.pages.values()) {
    if (shapes.holes.length > 1) shapes.holes = mergeHoles(shapes.holes);
  }
  return scene;
}
