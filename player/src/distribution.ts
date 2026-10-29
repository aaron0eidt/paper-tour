// The distribution board: the axis and scale, the curve or bars of the distribution part-way through its morph, the
// shaded region and the readouts. Pure, so it can be tested; rendering is in components/DistributionBoard.tsx. The
// densities and probabilities come from shared/distribution.ts, the same code the server checked the item with.

import {
  distributionPeak,
  distributionRange,
  isDiscrete,
  morphDensity,
  morphProbability,
  morphSpec,
  summary,
} from '../../shared/distribution';
import type { DistributionItem, DistributionSpec } from '../../shared/distribution';
import { BOARD_INK, wrapLabel } from './board';
import type { Measure } from './board';
import type { ScreenRect } from './camera';
import { ramp, scatterAxis } from './scatter';

export { ramp };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10) / 10;
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** The two distributions' colours: the first, and where it morphs to. */
export const DISTRIBUTION_INK = [BOARD_INK.blue, BOARD_INK.orange];

/** The colour part-way between the two inks, as a hex colour. */
export function mixInk(t: number): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(1 + 2 * at, 3 + 2 * at), 16);
  const [a, b] = DISTRIBUTION_INK;
  return `#${[0, 1, 2]
    .map((c) =>
      Math.round(lerp(channel(a, c), channel(b, c), clamp(t, 0, 1)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

// ------------------------------------------------------------------- words

/** A chance as a percentage with three digits (two for a tail below a tenth of a percent), ">99.9%" at the top end. */
export function percentText(p: number): string {
  if (p < 1e-6) return '<0.0001%';
  if (p > 0.9995) return '>99.9%';
  const percent = p * 100;
  if (percent < 0.1) return `${Number(percent.toPrecision(2))}%`;
  const digits = percent >= 10 ? 1 : percent >= 1 ? 2 : 3;
  return `${Number(percent.toFixed(digits)).toString()}%`;
}

/** A number on a readout: three significant digits. */
export const quantity = (v: number) => String(Number(v.toPrecision(3))).replace('-', '−');

/** The range whose chance is read, as a probability statement: P(X ≥ 130), P(5 ≤ X ≤ 8). */
export function regionText(region: NonNullable<DistributionItem['region']>): string {
  const { from, to } = region;
  if (from !== undefined && to !== undefined) return `P(${quantity(from)} ≤ X ≤ ${quantity(to)})`;
  return from !== undefined ? `P(X ≥ ${quantity(from)})` : `P(X ≤ ${quantity(to!)})`;
}

/** What the screen reader hears. */
export function distributionDescription(item: DistributionItem): string {
  const specs = item.dists.map((d) => d.label).join(' to ');
  const region = item.region
    ? `; ${regionText(item.region)} is ${item.region.probabilities.map(percentText).join(' then ')}`
    : '';
  return `${item.title ?? 'Distribution'}: ${item.x_label}, ${specs}${region}`;
}

// ------------------------------------------------------------------- morph

/** How long the board takes to morph from the first distribution to the second, in ms. */
export const MORPH_MS = 1100;

/**
 * The state the board should be morphing towards: 0 for the first distribution, 1 for the second; null when the
 * narration has said nothing about it. dist-1 and dist-2 choose their own; with no cue yet the board morphs when the
 * narration is past its middle, so a step whose cue was left out still ends on the second distribution.
 */
export function stageWanted(item: DistributionItem, focus: number | null, progress: number): 0 | 1 | null {
  if (item.dists.length < 2) return 0;
  if (focus !== null && focus < item.dists.length) return focus === 0 ? 0 : 1;
  if (focus !== null) return null;
  return progress >= 0.45 ? 1 : 0;
}

/** Eases a morph: slow at both ends, so a shape settles. */
export const morphEase = (t: number) => t * t * (3 - 2 * t);

/** The distribution on show at morph state t (0 to 1), as its mean and spread, for the readouts. */
export function liveSummary(item: DistributionItem, t: number): { mean: number; sd: number } | null {
  const [a, b] = [item.dists[0], item.dists[item.dists.length - 1]];
  const mix = a === b ? a : morphSpec(a, b, t);
  if (mix) return summary(mix);
  const [sa, sb] = [summary(a), summary(b)];
  return sa && sb ? { mean: lerp(sa.mean, sb.mean, t), sd: lerp(sa.sd, sb.sd, t) } : null;
}

/** The chance of the region under the distribution on show at t. */
export function liveProbability(item: DistributionItem, t: number): number {
  const { region } = item;
  const [a, b] = [item.dists[0], item.dists[item.dists.length - 1]];
  return region
    ? a === b
      ? morphProbability(a, a, 0, region.from, region.to)
      : morphProbability(a, b, t, region.from, region.to)
    : 0;
}

// ----------------------------------------------------------------- layout

export interface DistributionFonts {
  tick: Measure;
  title: Measure;
}

export interface DistributionTick {
  value: number;
  label: string;
  at: number;
}

export interface DistributionLayout {
  width: number;
  height: number;
  plot: ScreenRect;
  /** The ends of the axis, in the quantity's own units. */
  lo: number;
  hi: number;
  /** The height of the plot, in density (or chance), so a narrowing shows as growing taller. */
  peak: number;
  discrete: boolean;
  counts: boolean;
  ticks: DistributionTick[];
  /** Category names under their bars, wrapped. */
  categories: { lines: string[]; at: number }[];
  /** Px per whole number (a discrete axis) and the width of a bar. */
  step: number;
  bar: number;
  xTitle: { text: string; x: number; y: number };
  x: (value: number) => number;
  y: (density: number) => number;
}

const TICK_ROW = 26;
const CATEGORY_LINE = 14;
const TOP = 22;

/** Where the axis, the scale and the ticks go in a board of `box` px. */
export function distributionLayout(
  item: DistributionItem,
  box: { width: number; height: number },
  fonts: DistributionFonts,
): DistributionLayout {
  const width = Math.max(1, Math.floor(box.width));
  const [a] = item.dists;
  const discrete = isDiscrete(a);
  const counts = a.family === 'counts';
  const [first, last] = distributionRange(item);
  // A discrete axis puts each whole number in the middle of its slot.
  const [lo, hi] = discrete ? [first - 0.5, last + 0.5] : [first, last];
  const left = 8;
  const right = width - 10;
  const slots = discrete ? last - first + 1 : 1;
  const step = discrete ? (right - left) / slots : 0;
  const names = counts
    ? a.categories!.map((name, i) => ({
        lines: wrapLabel(name, Math.max(24, step - 4), fonts.tick, 2),
        at: left + step * (i + 0.5),
      }))
    : [];
  const below = counts ? Math.max(...names.map((n) => n.lines.length)) * CATEGORY_LINE + 12 : TICK_ROW;
  const xTitleHeight = 18;
  const height = Math.max(Math.floor(Math.min(box.height, width * 0.62)), TOP + below + xTitleHeight + 110);
  const plot: ScreenRect = { left, top: TOP, right, bottom: height - below - xTitleHeight };
  const peak = distributionPeak(item) * 1.06;
  const x = (value: number) => round(plot.left + ((value - lo) / (hi - lo)) * (plot.right - plot.left));
  const y = (density: number) => round(plot.bottom - (density / peak) * (plot.bottom - plot.top));

  let ticks: DistributionTick[] = [];
  if (!counts) {
    const axis = scatterAxis([first, last], false, plot.right - plot.left, discrete ? 36 : 64);
    ticks = axis.ticks
      .filter((t) => t.value >= lo - 1e-9 && t.value <= hi + 1e-9 && (!discrete || Number.isInteger(t.value)))
      .map((t) => ({ ...t, at: x(t.value) }));
    // A short discrete axis labels every whole number.
    if (discrete && slots <= 12)
      ticks = Array.from({ length: slots }, (_, i) => ({
        value: first + i,
        label: String(first + i),
        at: x(first + i),
      }));
  }
  return {
    width,
    height,
    plot,
    lo,
    hi,
    peak,
    discrete,
    counts,
    ticks,
    categories: names,
    step,
    bar: discrete ? Math.max(3, step * (slots > 14 ? 0.78 : 0.62)) : 0,
    xTitle: { text: item.x_label, x: plot.right, y: height - 6 },
    x,
    y,
  };
}

// ------------------------------------------------------------------ shapes

/** Samples of a continuous curve: enough for a smooth stroke at any width. */
const SAMPLES = 220;

/** The curve at morph state t, `grow` (0 to 1) of the way up from the baseline. */
export function curveAt(item: DistributionItem, layout: DistributionLayout, t: number, grow = 1): [number, number][] {
  const [a, b] = [item.dists[0], item.dists[item.dists.length - 1]];
  const { lo, hi, plot } = layout;
  return Array.from({ length: SAMPLES + 1 }, (_, i) => {
    const value = lo + ((hi - lo) * i) / SAMPLES;
    const d = a === b ? morphDensity(a, a, 0, value) : morphDensity(a, b, t, value);
    return [layout.x(value), round(plot.bottom - (plot.bottom - layout.y(d)) * grow)];
  });
}

/** A closed shape under a curve, from the baseline up to it and back, as an SVG path. */
export function areaPath(points: [number, number][], baseline: number): string {
  if (!points.length) return '';
  const [first, last] = [points[0], points[points.length - 1]];
  return `M${first[0]} ${baseline}${points.map(([px, py]) => `L${px} ${py}`).join('')}L${last[0]} ${baseline}Z`;
}

/** An open stroke along a curve, as an SVG path. */
export const linePath = (points: [number, number][]) =>
  points.map(([px, py], i) => `${i ? 'L' : 'M'}${px} ${py}`).join('');

/**
 * The part of the area under the curve that lies in the region, as an SVG path: the curve between the bounds with
 * walls down to the baseline at both. A bound past the axis stops at the axis.
 */
export function regionPath(item: DistributionItem, layout: DistributionLayout, t: number, grow = 1): string {
  const { region } = item;
  if (!region) return '';
  const [a, b] = [item.dists[0], item.dists[item.dists.length - 1]];
  const from = clamp(region.from ?? layout.lo, layout.lo, layout.hi);
  const to = clamp(region.to ?? layout.hi, layout.lo, layout.hi);
  if (to <= from) return '';
  const density = (value: number) => (a === b ? morphDensity(a, a, 0, value) : morphDensity(a, b, t, value));
  const top = (value: number) => round(layout.plot.bottom - (layout.plot.bottom - layout.y(density(value))) * grow);
  const inside = curveAt(item, layout, t, grow).filter(([px]) => px > layout.x(from) && px < layout.x(to));
  const points: [number, number][] = [[layout.x(from), top(from)], ...inside, [layout.x(to), top(to)]];
  return areaPath(points, layout.plot.bottom);
}

export interface BarShape {
  value: number;
  /** Left edge and width in px, and the top in px at morph state t. */
  x: number;
  width: number;
  top: number;
  /** The chance it stands for at t. */
  chance: number;
  inRegion: boolean;
}

/** The bars of a discrete distribution at morph state t, `grow` of the way up from the baseline. */
export function barsAt(item: DistributionItem, layout: DistributionLayout, t: number, grow = 1): BarShape[] {
  const [a, b] = [item.dists[0], item.dists[item.dists.length - 1]];
  const [first, last] = [Math.round(layout.lo + 0.5), Math.round(layout.hi - 0.5)];
  return Array.from({ length: last - first + 1 }, (_, i) => {
    const value = first + i;
    const chance = a === b ? morphDensity(a, a, 0, value) : morphDensity(a, b, t, value);
    const region = item.region;
    return {
      value,
      x: round(layout.x(value) - layout.bar / 2),
      width: layout.bar,
      top: round(layout.plot.bottom - (layout.plot.bottom - layout.y(chance)) * grow),
      chance,
      inRegion: !!region && value >= (region.from ?? -Infinity) && value <= (region.to ?? Infinity),
    };
  });
}

/** A bar with a rounded top and a square base, as an SVG path; empty when it has no height. */
export function columnPath(bar: BarShape, baseline: number): string {
  const h = baseline - bar.top;
  if (h < 0.5) return '';
  const r = Math.min(4, bar.width / 2, h);
  const [x0, x1] = [bar.x, bar.x + bar.width];
  return `M${x0} ${baseline}V${round(bar.top + r)}Q${x0} ${bar.top} ${round(x0 + r)} ${bar.top}H${round(x1 - r)}Q${x1} ${bar.top} ${x1} ${round(bar.top + r)}V${baseline}Z`;
}

// ---------------------------------------------------------------- timeline

/** Milliseconds: the axis arrives, the first distribution rises, then the region sweeps in. */
export const DISTRIBUTION_TIME = { axes: 380, rise: 1000, region: 700 };

/** When the region starts to sweep in. */
export const regionStart = () => DISTRIBUTION_TIME.axes + DISTRIBUTION_TIME.rise * 0.7;

/** How long the build takes, in ms. */
export const distributionDuration = (item: DistributionItem) =>
  Math.max(
    DISTRIBUTION_TIME.axes + DISTRIBUTION_TIME.rise,
    item.region ? regionStart() + DISTRIBUTION_TIME.region : 0,
  ) + 200;

/** The spec nearest morph state t, for the legend. */
export const nearestSpec = (item: DistributionItem, t: number): DistributionSpec =>
  item.dists[t >= 0.5 ? item.dists.length - 1 : 0];
