// The plot board: the axes (linear or log), the curves at the current parameter, the marks the code found on them and
// the measured points over them, with labels that keep clear of each other. Pure, so it can be tested; rendering is in
// components/Plot.tsx. What a mark is, where it lies and how a curve is sampled comes from shared/plot.ts, the same code
// the server checked the plot with.

import {
  evaluateExpression,
  formatNumber,
  markName,
  parseExpression,
  plotLog,
  plotSegments,
  resolveMarks,
} from '../../shared/plot';
import type { PlotItem, ResolvedMark } from '../../shared/plot';
import type { Measure } from './board';
import type { ScreenRect } from './camera';
import { rectsOverlap } from './labelLayout';
import { ramp, scatterAxis } from './scatter';

export { ramp };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10) / 10;

export interface PlotTick {
  value: number;
  label: string;
  at: number;
}

export interface PlacedMark {
  mark: ResolvedMark;
  x: number;
  y: number;
  /** The label pill: what the mark is and its coordinates. */
  name: string;
  coords: string;
  rect: ScreenRect;
}

export interface PlotGeometry {
  width: number;
  height: number;
  plot: ScreenRect;
  xTicks: PlotTick[];
  yTicks: PlotTick[];
  /** Px positions of the unlabelled marks between the decades of a log axis. */
  xMinor: number[];
  yMinor: number[];
  x: (value: number) => number;
  y: (value: number) => number;
  /** Where the value zero lies on a linear axis that spans it, in px; null otherwise. */
  zero: { x: number | null; y: number | null };
  /** One SVG path per curve at the current parameter. */
  paths: string[];
  marks: PlacedMark[];
  points: { x: number; y: number; label: string; labelLeft: number }[];
}

export interface PlotFonts {
  tick: Measure;
  label: Measure;
  coords: Measure;
}

const LEFT_MIN = 30;
const TOP = 14;
const BOTTOM = 26;
const RIGHT = 14;
const ASPECT = 0.68;
const PLOT_MIN = 150;

/** Ticks of one axis over exactly the plot's range: scatter's nice (and log) ticks, kept to those inside it. */
function axisTicks(range: [number, number], log: boolean, length: number, spacing: number) {
  const axis = scatterAxis(range, log, length, spacing);
  const inside = (v: number) => v >= range[0] * (1 - 1e-9) - 1e-12 && v <= range[1] * (1 + 1e-9) + 1e-12;
  const ticks = axis.ticks.filter((t) => inside(t.value));
  return {
    ticks: ticks.length >= 2 ? ticks : range.map((value) => ({ value, label: formatNumber(value) })),
    minor: axis.minor.filter(inside),
  };
}

/**
 * Where everything goes in a plot of `box` px with the parameter at `a`: the axes with their ticks, the curves as paths,
 * the marks the code found (each with its label placed clear of the others, the curves' points and the plot's edges)
 * and the measured points.
 */
export function plotGeometry(
  item: PlotItem,
  box: { width: number; height: number },
  a: number,
  fonts: PlotFonts,
): PlotGeometry {
  const width = Math.max(1, Math.floor(box.width));
  const height = Math.max(Math.floor(Math.min(box.height, width * ASPECT)), PLOT_MIN);
  const [logX, logY] = [plotLog(item, 'x'), plotLog(item, 'y')];
  const yAxis = axisTicks(item.y, logY, height - TOP - BOTTOM, 40);
  const left = clamp(
    Math.ceil(Math.max(0, ...yAxis.ticks.map((t) => fonts.tick(t.label)))) + 14,
    LEFT_MIN,
    width * 0.3,
  );
  const plot: ScreenRect = { left, top: TOP, right: width - RIGHT, bottom: height - BOTTOM };
  const xAxis = axisTicks(item.x, logX, plot.right - plot.left, 62);
  const fraction = (v: number, [lo, hi]: [number, number], log: boolean) =>
    log ? (Math.log10(v) - Math.log10(lo)) / (Math.log10(hi) - Math.log10(lo)) : (v - lo) / (hi - lo);
  const x = (v: number) => round(plot.left + fraction(v, item.x, logX) * (plot.right - plot.left));
  const y = (v: number) => round(plot.bottom - fraction(v, item.y, logY) * (plot.bottom - plot.top));

  const paths = item.curves.map((curve) =>
    plotSegments(parseExpression(curve.expression), item, a)
      .map((segment) => segment.map(([px, py], i) => `${i ? 'L' : 'M'}${x(px)} ${y(py)}`).join(''))
      .join(''),
  );

  // Marks: a label beside each dot, above it where there is room, kept inside the plot and clear of the other labels.
  const found = resolveMarks(item, a).marks;
  const dots = found.map((mark) => ({ x: x(mark.x), y: y(mark.y) }));
  const taken: ScreenRect[] = dots.map((d) => ({ left: d.x - 8, top: d.y - 8, right: d.x + 8, bottom: d.y + 8 }));
  const marks = found.map((mark, i): PlacedMark => {
    const name = mark.label ?? markName(item.marks![mark.index]);
    const coords = `(${formatNumber(mark.x)}, ${formatNumber(mark.y)})`;
    const w = Math.ceil(Math.max(fonts.label(name), fonts.coords(coords))) + 18;
    const h = 34;
    const [dx, dy] = [dots[i].x, dots[i].y];
    const options: [number, number][] = [
      [dx + 10, dy - 10 - h],
      [dx - 10 - w, dy - 10 - h],
      [dx + 10, dy + 10],
      [dx - 10 - w, dy + 10],
      [dx + 12, dy - h / 2],
      [dx - 12 - w, dy - h / 2],
    ];
    const fits = ([l, t]: [number, number]) =>
      l >= plot.left && t >= plot.top - 4 && l + w <= plot.right + 4 && t + h <= plot.bottom;
    const rectAt = ([l, t]: [number, number]): ScreenRect => ({ left: l, top: t, right: l + w, bottom: t + h });
    const others = taken.filter((_, k) => k !== i);
    const pick =
      options.find((o) => fits(o) && !others.some((other) => rectsOverlap(rectAt(o), other, 3))) ??
      options.find(fits) ??
      ([clamp(options[0][0], plot.left, plot.right - w), clamp(options[0][1], plot.top - 4, plot.bottom - h)] as [
        number,
        number,
      ]);
    const rect = rectAt(pick);
    taken[i] = rect;
    return { mark, x: dx, y: dy, name, coords, rect };
  });

  const points = (item.points ?? []).map((point) => {
    const label = point.label ?? '';
    const px = x(point.x);
    const hangsLeft = px + 10 + fonts.label(label) > width - 2;
    return { x: px, y: y(point.y), label, labelLeft: hangsLeft ? px - 10 : px + 10 };
  });

  return {
    width,
    height,
    plot,
    xTicks: xAxis.ticks.map((t) => ({ ...t, at: x(t.value) })),
    yTicks: yAxis.ticks.map((t) => ({ ...t, at: y(t.value) })),
    xMinor: xAxis.minor.map(x),
    yMinor: yAxis.minor.map(y),
    x,
    y,
    zero: {
      x: !logX && item.x[0] < 0 && item.x[1] > 0 ? x(0) : null,
      y: !logY && item.y[0] < 0 && item.y[1] > 0 ? y(0) : null,
    },
    paths,
    marks,
    points,
  };
}

/** What a curve is at the probe's x: its value, or NaN where it is not defined. */
export function curveValues(item: PlotItem, x: number, a: number): number[] {
  return item.curves.map((curve) => evaluateExpression(parseExpression(curve.expression), x, a));
}

// ---------------------------------------------------------------- timeline

/** Milliseconds: the axes arrive, the curves draw one after another, then the points and the marks drop in. */
export const PLOT_TIME = { axes: 360, curve: 950, every: 140, point: 320, mark: 560, markEvery: 280 };

/** When curve `i` starts to draw. */
export const curveStart = (i: number) => PLOT_TIME.axes + i * PLOT_TIME.every;
const afterCurves = (item: PlotItem) => curveStart(item.curves.length - 1) + PLOT_TIME.curve * 0.8;
/** When point `i` starts to arrive, and when mark `i` does. */
export const pointStart = (item: PlotItem, i: number) => afterCurves(item) + i * 90;
export const markStart = (item: PlotItem, i: number) =>
  afterCurves(item) + (item.points?.length ? 90 * item.points.length : 0) + i * PLOT_TIME.markEvery;

/** How long the build takes, in ms. */
export const plotDuration = (item: PlotItem) =>
  Math.max(
    curveStart(item.curves.length - 1) + PLOT_TIME.curve,
    item.points?.length ? pointStart(item, item.points.length - 1) + PLOT_TIME.point : 0,
    item.marks?.length ? markStart(item, item.marks.length - 1) + PLOT_TIME.mark : 0,
  ) + 200;

/** A description of the plot for screen readers: the curves, the marks the code found and the measured points. */
export function plotDescription(item: PlotItem, a: number): string {
  const marks = resolveMarks(item, a).marks.map(
    (mark) =>
      `${mark.label ?? markName(item.marks![mark.index])} at x ${formatNumber(mark.x)}, y ${formatNumber(mark.y)}`,
  );
  const points = (item.points ?? []).map(
    (p) => `${p.label ? `${p.label} ` : ''}(${formatNumber(p.x)}, ${formatNumber(p.y)})`,
  );
  return [
    item.title ?? 'Function plot',
    ...item.curves.map((c) => c.label),
    ...marks,
    ...(points.length ? [`measured points ${points.join(', ')}`] : []),
  ].join('; ');
}
