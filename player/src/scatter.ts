// The scatter board: nice axes, where the labels go, the better corner and the build timeline. Pure, so it can be
// tested; rendering is in components/ScatterBoard.tsx.

import { scatterSeries } from '../../shared/scatter';
import type { ScatterItem } from '../../shared/scatter';
import { decimalsOf, formatValue, wrapLabel } from './board';
import type { Measure } from './board';
import type { ScreenRect } from './camera';
import { layoutLabels, rectsOverlap } from './labelLayout';
import type { LabelAnchor, MeasuredLabel } from './labelLayout';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10) / 10;
const log10 = Math.log10;

/** Progress 0..1 of something that starts at `start` ms and takes `length` ms. */
export const ramp = (elapsed: number, start: number, length: number) => clamp((elapsed - start) / length, 0, 1);

// --------------------------------------------------------------------- axes

/** One labelled mark on an axis. */
export interface AxisTick {
  value: number;
  label: string;
}

export interface ScatterAxis {
  /** The values at the start and end of the axis. */
  lo: number;
  hi: number;
  log: boolean;
  ticks: AxisTick[];
  /** Unlabelled marks between the decades of a log axis. */
  minor: number[];
}

// Room left around the data, as a share of its span; a span that starts near zero is drawn from zero.
const PAD = 0.08;
const ZERO_NEAR = 0.35;
const MINUS = '−';
const UNITS: [number, string][] = [
  [1e12, 'T'],
  [1e9, 'B'],
  [1e6, 'M'],
  [1e3, 'k'],
];
const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** Where a value lies along the axis: 0 at its start, 1 at its end. */
export function axisFraction(axis: ScatterAxis, value: number): number {
  return axis.log
    ? (log10(value) - log10(axis.lo)) / (log10(axis.hi) - log10(axis.lo))
    : (value - axis.lo) / (axis.hi - axis.lo);
}

/** The step 1, 2 or 5 times a power of ten that is at least `raw`. */
function niceStep(raw: number): number {
  const exp = Math.floor(log10(raw));
  const f = raw / 10 ** exp;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * 10 ** exp;
}

/** A number on an axis: grouped digits, or k, M, B and T from ten thousand up; `step` sets the decimals. */
export function tickLabel(value: number, step: number): string {
  const abs = Math.abs(value);
  const exp = Math.floor(log10(step) + 1e-9);
  const unit = abs >= 1e4 ? UNITS.find(([size]) => abs >= size) : undefined;
  const places = Math.max(0, (unit ? Math.round(log10(unit[0])) : 0) - exp);
  const text = (unit ? abs / unit[0] : abs).toLocaleString('en-US', {
    minimumFractionDigits: places,
    maximumFractionDigits: places,
  });
  return `${value < 0 ? MINUS : ''}${text}${unit?.[1] ?? ''}`;
}

const power = (exp: number) =>
  `10${exp < 0 ? '⁻' : ''}${[...String(Math.abs(exp))].map((digit) => SUPERSCRIPT[Number(digit)]).join('')}`;

/** A value on a log axis: 0.01, 1, 10, 1k, 20M; powers of ten below a thousandth or past a trillion as 10 to the n. */
export function logTickLabel(value: number): string {
  const exp = Math.floor(log10(value) + 1e-9);
  const lead = Math.round(value / 10 ** exp);
  if (exp < -3 || exp >= 15) return lead === 1 ? power(exp) : `${lead}×${power(exp)}`;
  if (exp < 3) {
    const places = Math.max(0, -exp);
    return value.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
  }
  const [size, suffix] = UNITS.find(([unit]) => unit <= 10 ** exp)!;
  return `${lead * 10 ** (exp - Math.round(log10(size)))}${suffix}`;
}

/** The next smaller step of 1, 2 or 5 times a power of ten: 5 gives 2, 2 gives 1, 1 gives 0.5 of the power below. */
function finerStep(step: number): number {
  const exp = Math.floor(log10(step) + 1e-9);
  const lead = Math.round(step / 10 ** exp);
  return lead === 5 ? 2 * 10 ** exp : lead === 2 ? 10 ** exp : 5 * 10 ** (exp - 1);
}

/** Ticks on 1, 2 or 5 times a power of ten, about `room`; a step leaving fewer than three gives way to a finer one. */
function linearTicks(lo: number, hi: number, room: number): AxisTick[] {
  let step = niceStep((hi - lo) / room);
  if (!(step > 0) || !Number.isFinite(step)) return [];
  const count = (at: number) => Math.floor(hi / at + 1e-9) - Math.ceil(lo / at - 1e-9) + 1;
  for (let i = 0; i < 4 && count(step) < 3 && count(finerStep(step)) <= Math.max(3, room + 1); i++)
    step = finerStep(step);
  const places = Math.max(0, -Math.floor(log10(step) + 1e-9));
  const ticks: AxisTick[] = [];
  for (let i = Math.ceil(lo / step - 1e-9); i * step <= hi + step * 1e-9; i++) {
    const value = Number((i * step).toFixed(places));
    ticks.push({ value, label: tickLabel(value, step) });
  }
  return ticks;
}

// A log axis labels every multiple of its decades, then 1, 2 and 5, then only the decades, as the room allows.
const LOG_LEADS = [[1, 2, 3, 4, 5, 6, 7, 8, 9], [1, 2, 5], [1]];

/** The values of the given leading digits across the domain, optionally only at every `stride`-th power of ten. */
function logValues(lo: number, hi: number, leads: number[], stride = 1): number[] {
  const values: number[] = [];
  for (let exp = Math.floor(log10(lo)); exp <= Math.min(Math.ceil(log10(hi)), 330); exp++) {
    if (((exp % stride) + stride) % stride) continue;
    for (const lead of leads) {
      const value = Number((lead * 10 ** exp).toPrecision(12));
      if (value >= lo * (1 - 1e-9) && value <= hi * (1 + 1e-9)) values.push(value);
    }
  }
  return values;
}

function logTicks(lo: number, hi: number, room: number): { ticks: number[]; minor: number[] } {
  const sets = LOG_LEADS.map((leads) => logValues(lo, hi, leads));
  const roomy = sets.findIndex((ticks) => ticks.length >= 2 && ticks.length <= room);
  const fewer = sets.findIndex((ticks) => ticks.length >= 1 && ticks.length <= room);
  const pick = roomy >= 0 ? roomy : fewer;
  if (pick >= 0) {
    const decades = pick === sets.length - 1 && log10(hi / lo) <= 8;
    return {
      ticks: sets[pick],
      minor: decades ? logValues(lo, hi, [2, 3, 4, 5, 6, 7, 8, 9]) : [],
    };
  }
  // More decades than labels: every second, third, ... power of ten.
  const stride = Math.ceil(sets[sets.length - 1].length / Math.max(1, room));
  return { ticks: logValues(lo, hi, [1], stride), minor: [] };
}

/**
 * An axis for the values, drawn over `length` px with about one label per `spacing` px. A linear axis keeps a little
 * room around the data and lands its ticks on 1, 2 or 5 times a power of ten; a log axis labels decades (with 2 and 5,
 * or every multiple, when it spans few).
 */
export function scatterAxis(values: number[], log: boolean, length: number, spacing: number): ScatterAxis {
  const room = Math.max(2, Math.floor(length / spacing));
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (log) {
    const pad = Math.max((log10(max) - log10(min)) * PAD, 0.04);
    const lo = 10 ** (log10(min) - pad);
    const hi = 10 ** (log10(max) + pad);
    const { ticks, minor } = logTicks(lo, hi, room);
    return { lo, hi, log, ticks: ticks.map((value) => ({ value, label: logTickLabel(value) })), minor };
  }
  const span = max - min || Math.abs(max) || 1;
  const pad = span * PAD;
  const lo = min >= 0 && min < span * ZERO_NEAR ? Math.min(0, min - pad) : min - pad;
  const hi = max <= 0 && -max < span * ZERO_NEAR ? Math.max(0, max + pad) : max + pad;
  return { lo, hi, log, ticks: linearTicks(lo, hi, room), minor: [] };
}

// ----------------------------------------------------------------- geometry

/** The fonts the board draws in: tick labels, point labels (at their boldest) and axis titles. */
export interface ScatterFonts {
  tick: Measure;
  label: Measure;
  title: Measure;
}

export interface ScatterTick {
  value: number;
  label: string;
  /** Where the mark sits: x for the horizontal axis, y for the vertical one, in px. */
  at: number;
}

export interface ScatterLabel {
  lines: string[];
  left: number;
  top: number;
  width: number;
  height: number;
  /** Where the text starts and the edge it hangs from: a label left of its point hangs from its right edge. */
  x: number;
  anchor: 'start' | 'end';
  /** False when the labels around were too many for a clear spot, and this one overlaps a little. */
  clear: boolean;
  /** The whole label fits on one line in the drawing though `lines` wrapped or cut it: the focused point shows it. */
  whole: boolean;
}

export interface ScatterPoint {
  index: number;
  x: number;
  y: number;
  /** Which series (index into ScatterGeometry.series) or null. */
  series: number | null;
  label: ScatterLabel;
}

/** A line between two points of a series that are neighbours in x. */
export interface ScatterSegment {
  series: number;
  from: number;
  to: number;
  d: string;
}

/** The "better" mark: a small arrow toward the corner, with the word beside it when there is room. */
export interface BetterMark {
  rect: ScreenRect;
  arrow: string;
  text: { x: number; y: number; anchor: 'start' | 'end' } | null;
}

export interface ScatterGeometry {
  width: number;
  height: number;
  plot: ScreenRect;
  xAxis: ScatterAxis;
  yAxis: ScatterAxis;
  xTicks: ScatterTick[];
  yTicks: ScatterTick[];
  /** Px positions of the unlabelled marks of a log axis. */
  xMinor: number[];
  yMinor: number[];
  xTitle: { lines: string[]; x: number; y: number };
  yTitle: { lines: string[]; x: number; y: number };
  series: string[];
  points: ScatterPoint[];
  segments: ScatterSegment[];
  better: BetterMark | null;
  /** The better wash: a gradient from the worst corner (x1, y1) to the best (x2, y2). */
  wash: { x1: number; y1: number; x2: number; y2: number } | null;
}

/** The radius of a point at rest; the board scales the dot up while it is the one in focus. */
export const SCATTER_DOT = { rest: 5 };
export const SCATTER_LINE = 15;
const TITLE_LINE = 15;
const TITLE_TOP = 4;
// Below the plot: the row of tick labels, then the axis title.
const TICK_ROW = 28;
// The plot is never shorter than this, and never taller than this share of its width.
const PLOT_MIN = 130;
const ASPECT = 1.15;
const LABEL_GAP = 8;
// Labels keep this far from the centre of every point (the dot is 5 px, and 8 while it is in focus).
const KEEP = 6;
// A label is tried at one line, wrapped to two, and cut short; a narrow plot uses the later ones.
const WRAP_SHARE = 0.62;
const SHORT_LABEL = 84;

function labelSizes(label: string, measure: Measure): { lines: string[]; w: number; h: number }[] {
  const full = Math.ceil(measure(label));
  const sizes = [{ lines: [label], w: full, h: SCATTER_LINE }];
  const wrapped = wrapLabel(label, Math.max(56, full * WRAP_SHARE), measure, 2);
  if (wrapped.length > 1)
    sizes.push({ lines: wrapped, w: Math.ceil(Math.max(...wrapped.map(measure))), h: wrapped.length * SCATTER_LINE });
  if (full > SHORT_LABEL) {
    const short = wrapLabel(label, SHORT_LABEL, measure, 1);
    sizes.push({ lines: short, w: Math.ceil(measure(short[0])), h: SCATTER_LINE });
  }
  return sizes;
}

const area = (a: ScreenRect, b: ScreenRect) =>
  Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) *
  Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));

/** Small rects along a line, so labels keep off a series line the way they keep off a point. */
function lineRects(ax: number, ay: number, bx: number, by: number): ScreenRect[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 10));
  return Array.from({ length: steps + 1 }, (_, i) => {
    const x = ax + ((bx - ax) * i) / steps;
    const y = ay + ((by - ay) * i) / steps;
    return { left: x - 1, top: y - 1, right: x + 1, bottom: y + 1 };
  });
}

/** The corner mark: the first spot clear of `taken` (the corner, then along either edge), else the arrow alone. */
function betterMark(
  corner: NonNullable<ScatterItem['better']>,
  plot: ScreenRect,
  measure: Measure,
  taken: ScreenRect[],
): BetterMark {
  const up = corner.startsWith('up');
  const right = corner.endsWith('right');
  const arrowW = 10;
  const textW = Math.ceil(measure('better') * 1.1);
  const fullW = arrowW + 5 + textW;
  const h = 14;
  const inset = 8;
  const [cx, cy] = [right ? plot.right : plot.left, up ? plot.top : plot.bottom];
  const spot = (alongX: number, alongY: number, w: number): ScreenRect => {
    const left = right ? cx - inset - alongX - w : cx + inset + alongX;
    const top = up ? cy + inset + alongY : cy - inset - alongY - h;
    return { left, top, right: left + w, bottom: top + h };
  };
  const spots = [
    spot(0, 0, fullW),
    spot(fullW + 10, 0, fullW),
    spot(0, h + 10, fullW),
    spot(2 * (fullW + 10), 0, fullW),
    spot(0, 2 * (h + 10), fullW),
  ];
  const free = spots.find((rect) => !taken.some((other) => rectsOverlap(rect, other, 3)));
  const rect = free ?? spot(0, 0, arrowW);
  // The arrow points toward the corner, at the end of the mark nearest to it.
  const sx = right ? 1 : -1;
  const sy = up ? -1 : 1;
  const mx = right ? rect.right - arrowW / 2 : rect.left + arrowW / 2;
  const my = (rect.top + rect.bottom) / 2;
  const [tx, ty, hx, hy] = [mx - sx * 4, my - sy * 4, mx + sx * 4, my + sy * 4];
  const at = (x: number, y: number) => `${round(x)} ${round(y)}`;
  const arrow = `M${at(tx, ty)}L${at(hx, hy)}M${at(hx - sx * 5, hy)}L${at(hx, hy)}L${at(hx, hy - sy * 5)}`;
  return {
    rect,
    arrow,
    text: free
      ? { x: right ? rect.right - arrowW - 5 : rect.left + arrowW + 5, y: my, anchor: right ? 'end' : 'start' }
      : null,
  };
}

/**
 * Where everything goes in a plot of `box` px: the plot's margins (room for the tick labels and the axis titles, which
 * sit above the left axis and below the bottom one, so the plot keeps its width), the axes, the points, their labels
 * and the better mark. Labels go through layoutLabels, with every point, the series lines and the plot's edges kept
 * clear; a label that finds no clear spot goes where it overlaps least.
 */
export function scatterGeometry(
  item: ScatterItem,
  box: { width: number; height: number },
  fonts: ScatterFonts,
): ScatterGeometry {
  const width = Math.max(1, Math.floor(box.width));
  const yTitle = wrapLabel(item.y_label, width - 4, fonts.title, 2);
  const xTitle = wrapLabel(item.x_label, width - 4, fonts.title, 2);
  const top = TITLE_TOP + yTitle.length * TITLE_LINE + 10;
  const bottom = TICK_ROW + xTitle.length * TITLE_LINE + 2;
  const height = Math.max(Math.min(box.height, width * ASPECT), top + bottom + PLOT_MIN);
  const points = item.points;
  const yAxis = scatterAxis(
    points.map((p) => p.y),
    !!item.y_log,
    height - top - bottom,
    40,
  );
  // Room for the tick labels, and for the badge that shows a point's value over them (not past a third of the width).
  const badge = Math.max(...points.map((p) => badgeWidth(p.y, fonts.tick)));
  const left = Math.min(
    Math.max(Math.ceil(Math.max(...yAxis.ticks.map((t) => fonts.tick(t.label)), 0)) + 12, badge + 8),
    width * 0.3,
  );
  const roughRight = 14;
  const xAxis = scatterAxis(
    points.map((p) => p.x),
    !!item.x_log,
    width - left - roughRight,
    62,
  );
  const right = Math.max(roughRight, Math.ceil(Math.max(...xAxis.ticks.map((t) => fonts.tick(t.label)), 0) / 2) + 2);
  const plot: ScreenRect = { left, top, right: width - right, bottom: height - bottom };
  const [w, h] = [plot.right - plot.left, plot.bottom - plot.top];
  const px = (value: number) => round(plot.left + axisFraction(xAxis, value) * w);
  const py = (value: number) => round(plot.bottom - axisFraction(yAxis, value) * h);

  const series = scatterSeries(points);
  const placed = points.map((p, index) => ({
    index,
    x: px(p.x),
    y: py(p.y),
    series: p.series ? series.indexOf(p.series) : null,
  }));

  // A series is joined in x order; the point drawn last decides when a segment appears (see the timeline).
  const segments: ScatterSegment[] = series.flatMap((_, s) => {
    const own = placed.filter((p) => p.series === s).sort((a, b) => a.x - b.x || a.y - b.y);
    return own
      .slice(1)
      .map((p, i) => ({ series: s, from: own[i].index, to: p.index, d: `M${own[i].x} ${own[i].y}L${p.x} ${p.y}` }));
  });

  // Labels are placed in plot coordinates, so the plot's own edge keeps them clear of the axes.
  const dots: ScreenRect[] = placed.map((p) => ({
    left: p.x - plot.left - KEEP,
    top: p.y - plot.top - KEEP,
    right: p.x - plot.left + KEEP,
    bottom: p.y - plot.top + KEEP,
  }));
  const sizes = points.map((p) => labelSizes(p.label, fonts.label));
  const anchors: LabelAnchor[] = placed.map((_, i) => ({
    key: String(i),
    rect: dots[i],
    // Labels hang to the right, and to the left of the points in the right of the plot.
    side: placed[i].x > (plot.left + plot.right) / 2 + (plot.right - plot.left) * 0.15 ? 'left' : 'right',
    sizes: sizes[i].map((s): MeasuredLabel => ({ w: s.w, h: s.h, maxWidth: s.w })),
  }));
  // Labels of crowded points first: they have the fewest choices.
  const nearest = (i: number) =>
    Math.min(
      ...placed.filter((_, j) => j !== i).map((q) => Math.hypot(q.x - placed[i].x, q.y - placed[i].y)),
      Infinity,
    );
  const order = anchors.map((_, i) => i).sort((a, b) => nearest(a) - nearest(b));
  const vp = { width: w, height: h };
  const onLines = segments.flatMap((s) => {
    const [a, b] = [placed[s.from], placed[s.to]];
    return lineRects(a.x - plot.left, a.y - plot.top, b.x - plot.left, b.y - plot.top);
  });
  const spots = new Map<string, ScreenRect & { size: number }>();
  const settle = (list: LabelAnchor[], obstacles: ScreenRect[]) => {
    const found = layoutLabels(list, [...obstacles, ...[...spots.values()]], vp);
    for (const anchor of list) {
      const spot = found.get(anchor.key);
      if (!spot) continue;
      const i = Number(anchor.key);
      const size = sizes[i].findIndex(
        (s) => Math.abs(s.w - (spot.right - spot.left)) < 0.5 && Math.abs(s.h - (spot.bottom - spot.top)) < 0.5,
      );
      spots.set(anchor.key, {
        left: spot.left,
        top: spot.top,
        right: spot.right,
        bottom: spot.bottom,
        size: Math.max(0, size),
      });
    }
  };
  const ordered = order.map((i) => anchors[i]);
  settle(ordered, onLines);
  // Without the series lines in the way, for the labels that found no spot.
  settle(
    ordered.filter((a) => !spots.has(a.key)),
    dots,
  );
  const clear = new Set(spots.keys());
  // What is left goes where it overlaps least, around its point.
  for (const i of order) {
    if (spots.has(String(i))) continue;
    const size = sizes[i].length - 1;
    const { w: lw, h: lh } = sizes[i][size];
    const rect = dots[i];
    const around: [number, number][] = [
      [rect.right + LABEL_GAP, (rect.top + rect.bottom) / 2 - lh / 2],
      [rect.left - LABEL_GAP - lw, (rect.top + rect.bottom) / 2 - lh / 2],
      [(rect.left + rect.right) / 2 - lw / 2, rect.top - LABEL_GAP - lh],
      [(rect.left + rect.right) / 2 - lw / 2, rect.bottom + LABEL_GAP],
      [rect.right, rect.top - lh],
      [rect.left - lw, rect.top - lh],
      [rect.right, rect.bottom],
      [rect.left - lw, rect.bottom],
    ];
    const used = [...dots, ...[...spots.values()], ...onLines];
    let best: { rect: ScreenRect; cost: number } | null = null;
    for (const [x, y] of around) {
      const candidate = { left: clamp(x, 2, w - lw - 2), top: clamp(y, 2, h - lh - 2), right: 0, bottom: 0 };
      candidate.right = candidate.left + lw;
      candidate.bottom = candidate.top + lh;
      const cost = used.reduce((sum, other) => sum + area(candidate, other), 0);
      if (!best || cost < best.cost) best = { rect: candidate, cost };
    }
    spots.set(String(i), { ...best!.rect, size });
  }

  const scatterPoints: ScatterPoint[] = placed.map((p) => {
    const spot = spots.get(String(p.index))!;
    const lines = sizes[p.index][spot.size].lines;
    const [left, topY] = [spot.left + plot.left, spot.top + plot.top];
    const hangs = spot.right + plot.left <= p.x - KEEP + 1;
    const wholeWidth = Math.ceil(fonts.label(points[p.index].label));
    const shortened = lines.length > 1 || lines[0] !== points[p.index].label;
    return {
      ...p,
      label: {
        lines,
        left,
        top: topY,
        width: spot.right - spot.left,
        height: spot.bottom - spot.top,
        x: hangs ? spot.right + plot.left : left,
        anchor: hangs ? 'end' : 'start',
        clear: clear.has(String(p.index)),
        whole: shortened && (hangs ? spot.right + plot.left - wholeWidth >= 0 : left + wholeWidth <= width),
      },
    };
  });

  const taken: ScreenRect[] = [
    ...scatterPoints.map((p) => ({ left: p.x - KEEP, top: p.y - KEEP, right: p.x + KEEP, bottom: p.y + KEEP })),
    ...scatterPoints.map((p) => ({
      left: p.label.left,
      top: p.label.top,
      right: p.label.left + p.label.width,
      bottom: p.label.top + p.label.height,
    })),
  ];
  const corner = item.better;
  const best = corner
    ? { x: corner.endsWith('right') ? plot.right : plot.left, y: corner.startsWith('up') ? plot.top : plot.bottom }
    : null;
  return {
    width,
    height,
    plot,
    xAxis,
    yAxis,
    xTicks: xAxis.ticks.map((t) => ({ ...t, at: px(t.value) })),
    yTicks: yAxis.ticks.map((t) => ({ ...t, at: py(t.value) })),
    xMinor: xAxis.minor.map(px),
    yMinor: yAxis.minor.map(py),
    xTitle: { lines: xTitle, x: plot.right, y: plot.bottom + TICK_ROW + TITLE_LINE / 2 - 2 },
    yTitle: { lines: yTitle, x: 0, y: TITLE_TOP + TITLE_LINE / 2 },
    series,
    points: scatterPoints,
    segments,
    better: corner ? betterMark(corner, plot, fonts.tick, taken) : null,
    wash: best
      ? { x1: plot.left + plot.right - best.x, y1: plot.top + plot.bottom - best.y, x2: best.x, y2: best.y }
      : null,
  };
}

/** A value as a badge prints it: the exact figure, or three digits of a power of ten when it is huge or tiny. */
export function valueText(v: number): string {
  const abs = Math.abs(v);
  if (v === 0 || (abs >= 1e-3 && abs < 1e9)) return formatValue(v, decimalsOf(v));
  const exp = Math.floor(log10(abs) + 1e-9);
  const digits = Number((abs / 10 ** exp).toPrecision(3));
  return `${v < 0 ? MINUS : ''}${digits}\u00d7${power(exp)}`;
}
const badgeWidth = (v: number, measure: Measure) => Math.ceil(measure(valueText(v)) * 1.1) + 12;

/** What the reader sees of the point in focus: its two values in badges on the axes, over the ticks they cover. */
export interface ScatterReadout {
  x: { text: string; rect: ScreenRect };
  y: { text: string; rect: ScreenRect };
  /** Indexes of the tick labels the badges hide. */
  hideX: number[];
  hideY: number[];
}

export function scatterReadout(
  geometry: ScatterGeometry,
  index: number,
  item: ScatterItem,
  measure: Measure,
): ScatterReadout {
  const { plot, points, xTicks, yTicks } = geometry;
  const [p, value] = [points[index], item.points[index]];
  const [xt, yt] = [valueText(value.x), valueText(value.y)];
  const [xw, yw] = [badgeWidth(value.x, measure), badgeWidth(value.y, measure)];
  const yc = clamp(p.y, plot.top, plot.bottom);
  // The badges stay inside the drawing, where the board's body would not clip them.
  const xl = clamp(p.x - xw / 2, 0, Math.max(0, geometry.width - xw));
  const yl = Math.max(0, plot.left - 6 - yw);
  const x = { text: xt, rect: { left: xl, top: plot.bottom + 6, right: xl + xw, bottom: plot.bottom + 24 } };
  const y = { text: yt, rect: { left: yl, top: yc - 9, right: yl + yw, bottom: yc + 9 } };
  const hideX = xTicks.flatMap((t, i) => {
    const half = measure(t.label) / 2;
    return rectsOverlap(
      { left: t.at - half, top: plot.bottom + 8, right: t.at + half, bottom: plot.bottom + 22 },
      x.rect,
      2,
    )
      ? [i]
      : [];
  });
  const hideY = yTicks.flatMap((t, i) =>
    rectsOverlap(
      { left: plot.left - 8 - measure(t.label), top: t.at - 7, right: plot.left - 8, bottom: t.at + 7 },
      y.rect,
      2,
    )
      ? [i]
      : [],
  );
  return { x, y, hideX, hideY };
}

// ----------------------------------------------------------------- timeline

/** Milliseconds: the axes and the wash arrive, then the points one by one, each with its label just behind it. */
export const SCATTER_TIME = { axes: 380, first: 420, every: 240, grow: 560, label: 160, line: 480 };

/** When point `index` starts arriving. */
export const scatterArrival = (index: number) => SCATTER_TIME.first + index * SCATTER_TIME.every;

/** When a segment starts drawing: as soon as the later of its two points has arrived. */
export const segmentStart = (segment: Pick<ScatterSegment, 'from' | 'to'>) =>
  scatterArrival(Math.max(segment.from, segment.to)) + 100;

/** How long the build takes, in ms. */
export const scatterDuration = (count: number) =>
  scatterArrival(count - 1) + SCATTER_TIME.grow + SCATTER_TIME.label + 200;

/** A description of the plot for screen readers. */
export function scatterDescription(item: ScatterItem): string {
  const points = item.points.map((p) => `${p.label} (${p.x}, ${p.y})`).join('; ');
  const better = item.better ? `; better is ${item.better.replace('-', ' and ')}` : '';
  return `${item.title ?? 'Scatter plot'}: ${item.y_label} against ${item.x_label}: ${points}${better}`;
}
