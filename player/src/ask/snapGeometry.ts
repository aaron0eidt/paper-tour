// Snapping a learner's loose region to the object inside it: the coordinates and the morph, all pure.
// The server (server/src/snap.ts) answers in PDF points from the page's top-left; the reader's selections are
// fractions of the page (regionSelection.ts), so every crossing goes through this file.

import type { BBox } from '../types';
import type { RegionSelection } from './regionSelection';

export type Point = [number, number];

/** What the server found: the object's outline and its box, in PDF points from the page's top-left. */
export interface Snapped {
  polygon: Point[];
  bbox: BBox;
  confidence: number;
  ms: number;
}

/** A page's size in PDF points. */
export interface PageSize {
  width: number;
  height: number;
}

/** The request body for a region: the page and the drag's box in PDF points, as the server checks it. */
export interface SnapBody {
  page: number;
  box: BBox;
  analysisId?: string;
}

/** A drag smaller than this (PDF points) holds no object, and one over most of the page has nothing to snap to. */
export const MIN_SNAP_BOX = 12;
const MAX_PAGE_SHARE = 0.85;
const MAX_OUTLINE_POINTS = 2000;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const round = (n: number) => Math.round(n * 100) / 100;

/** The region's box in PDF points, inside the page. */
export function boxInPoints(selection: RegionSelection, page: PageSize): BBox {
  const [x0, y0, x1, y1] = selection.rect;
  return [
    round(clamp(x0 * page.width, 0, page.width)),
    round(clamp(y0 * page.height, 0, page.height)),
    round(clamp(x1 * page.width, 0, page.width)),
    round(clamp(y1 * page.height, 0, page.height)),
  ];
}

/** Whether a region is worth a snap: big enough to hold an object and not nearly the whole page. */
export function canSnap(selection: RegionSelection, page: PageSize): boolean {
  const [x0, y0, x1, y1] = boxInPoints(selection, page);
  const width = x1 - x0;
  const height = y1 - y0;
  return width >= MIN_SNAP_BOX && height >= MIN_SNAP_BOX && width * height <= MAX_PAGE_SHARE * page.width * page.height;
}

export function snapBody(selection: RegionSelection, page: PageSize, analysisId?: string): SnapBody {
  return { page: selection.page, box: boxInPoints(selection, page), ...(analysisId ? { analysisId } : {}) };
}

/** The object's box as a selection the question can carry: fractions of the page, never empty. */
export function regionFromSnap(snapped: Pick<Snapped, 'bbox'>, page: number, size: PageSize): RegionSelection | null {
  const [x0, y0, x1, y1] = snapped.bbox;
  const rect: BBox = [
    clamp(x0 / size.width, 0, 1),
    clamp(y0 / size.height, 0, 1),
    clamp(x1 / size.width, 0, 1),
    clamp(y1 / size.height, 0, 1),
  ];
  return rect[0] < rect[2] && rect[1] < rect[3] ? { page, rect } : null;
}

/**
 * The server's reply, checked: an object with an outline of at least three finite points and a box with
 * area. Points go inside the page. Anything else (ok false, a malformed body) is null, and the rectangle stays.
 */
export function parseSnapped(data: unknown, page: PageSize): Snapped | null {
  const reply = data as { ok?: unknown; polygon?: unknown; bbox?: unknown; confidence?: unknown; ms?: unknown } | null;
  if (!reply || typeof reply !== 'object' || reply.ok !== true) return null;
  const { polygon, bbox } = reply;
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > MAX_OUTLINE_POINTS) return null;
  const points: Point[] = [];
  for (const p of polygon) {
    if (!Array.isArray(p) || p.length !== 2 || !p.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
    points.push([clamp(p[0], 0, page.width), clamp(p[1], 0, page.height)]);
  }
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
  const box: BBox = [
    clamp(bbox[0], 0, page.width),
    clamp(bbox[1], 0, page.height),
    clamp(bbox[2], 0, page.width),
    clamp(bbox[3], 0, page.height),
  ];
  if (box[2] <= box[0] || box[3] <= box[1]) return null;
  return {
    polygon: points,
    bbox: box,
    confidence: typeof reply.confidence === 'number' ? reply.confidence : 0,
    ms: typeof reply.ms === 'number' ? reply.ms : 0,
  };
}

// ------------------------------------------------------------------------------------------ the morph

/** The corners of a box, clockwise from the top-left. */
export function boxPolygon([x0, y0, x1, y1]: BBox): Point[] {
  return [
    [x0, y0],
    [x1, y0],
    [x1, y1],
    [x0, y1],
  ];
}

/** Twice the area; positive when the points run clockwise on a screen (y down). */
export function signedArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    sum += x0 * y1 - x1 * y0;
  }
  return sum;
}

/** A closed outline as `n` points an equal distance apart along it, starting at its first point. */
export function resample(points: readonly Point[], n: number): Point[] {
  const edges: number[] = [];
  let length = 0;
  for (let i = 0; i < points.length; i++) {
    const [x0, y0] = points[i];
    const [x1, y1] = points[(i + 1) % points.length];
    const d = Math.hypot(x1 - x0, y1 - y0);
    edges.push(d);
    length += d;
  }
  if (!points.length || length === 0) return Array.from({ length: n }, () => [...(points[0] ?? [0, 0])] as Point);
  const out: Point[] = [];
  let edge = 0;
  let edgeStart = 0;
  for (let k = 0; k < n; k++) {
    const at = (k / n) * length;
    while (edge < points.length - 1 && edgeStart + edges[edge] < at) {
      edgeStart += edges[edge];
      edge++;
    }
    const [x0, y0] = points[edge];
    const [x1, y1] = points[(edge + 1) % points.length];
    const f = edges[edge] > 0 ? (at - edgeStart) / edges[edge] : 0;
    out.push([x0 + (x1 - x0) * f, y0 + (y1 - y0) * f]);
  }
  return out;
}

export const MORPH_POINTS = 96;

/**
 * The two outlines as point lists that morph into each other by moving each point in a straight line: both run
 * clockwise, have the same number of points, and the second starts where it lies nearest the first.
 */
export function pairOutlines(from: readonly Point[], to: readonly Point[], n = MORPH_POINTS): [Point[], Point[]] {
  const a = resample(signedArea(from) < 0 ? [...from].reverse() : from, n);
  const b = resample(signedArea(to) < 0 ? [...to].reverse() : to, n);
  let best = 0;
  let cost = Infinity;
  for (let shift = 0; shift < n; shift++) {
    let sum = 0;
    for (let i = 0; i < n && sum < cost; i++) {
      const [x0, y0] = a[i];
      const [x1, y1] = b[(i + shift) % n];
      sum += (x0 - x1) ** 2 + (y0 - y1) ** 2;
    }
    if (sum < cost) {
      cost = sum;
      best = shift;
    }
  }
  return [a, b.map((_, i) => b[(i + best) % n])];
}

export function mix(a: readonly Point[], b: readonly Point[], t: number): Point[] {
  return a.map(([x0, y0], i) => [x0 + (b[i][0] - x0) * t, y0 + (b[i][1] - y0) * t]);
}

/** An SVG path through the points, closed. */
export function outlinePath(points: readonly Point[]): string {
  return points.length ? `M${points.map(([x, y]) => `${round(x)} ${round(y)}`).join('L')}Z` : '';
}

/** How long the rectangle takes to become the outline. */
export const MORPH_MS = 650;
export const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
