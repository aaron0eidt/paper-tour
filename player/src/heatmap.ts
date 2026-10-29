// The heatmap board: the colour scale, the number text, the build timeline and the layout of a grid of values and of
// its links view. Pure, so it can be tested; rendering is in components/HeatmapBoard.tsx.

import { heatmapMasked, rowSoftmax } from '../../shared/heatmap';
import type { HeatmapItem } from '../../shared/heatmap';
import { EASE_OUT, cubicBezier, decimalsOf, fitText, formatValue, wrapLabel } from './board';
import type { Measure } from './board';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10) / 10;
const ease = cubicBezier(...EASE_OUT);

// ------------------------------------------------------------------- colour

export type Rgb = [number, number, number];
type Stop = [at: number, rgb: Rgb];

/** The sequential scale on the dark board: from a tile just above the board to pale ice, rising evenly in lightness. */
const SEQUENTIAL: Stop[] = [
  [0, [24, 29, 43]],
  [0.2, [31, 50, 98]],
  [0.4, [42, 80, 168]],
  [0.6, [63, 127, 230]],
  [0.8, [130, 177, 255]],
  [1, [214, 230, 255]],
];
/** The negative side of a diverging scale: the same start, through orange to pale peach. */
const WARM: Stop[] = [
  [0, [24, 29, 43]],
  [0.25, [74, 51, 40]],
  [0.5, [154, 86, 40]],
  [0.75, [240, 137, 63]],
  [1, [255, 224, 194]],
];

function along(stops: Stop[], position: number): Rgb {
  const x = clamp(position, 0, 1);
  const i = Math.max(
    1,
    stops.findIndex(([at]) => at >= x),
  );
  const [a, from] = stops[i - 1];
  const [b, to] = stops[i];
  const k = (x - a) / (b - a);
  return from.map((v, c) => Math.round(v + (to[c] - v) * k)) as Rgb;
}

/** The colour of a level: 0 to 1 on a sequential scale, -1 to 1 on a diverging one (negative values run warm). */
export function heatmapRgb(level: number, diverging: boolean): Rgb {
  return diverging && level < 0 ? along(WARM, -level) : along(SEQUENTIAL, Math.abs(level));
}

export const rgbCss = ([r, g, b]: Rgb) => `rgb(${r} ${g} ${b})`;
const mixRgb = (a: Rgb, b: Rgb, k: number): Rgb => a.map((v, i) => Math.round(v + (b[i] - v) * k)) as Rgb;

const channel = (v: number) => {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
/** WCAG relative luminance: 0 for black, 1 for white. */
export const luminance = ([r, g, b]: Rgb) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** WCAG contrast ratio of two luminances. */
export const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

const INK_LIGHT: Rgb = [244, 246, 251];
const INK_DARK: Rgb = [11, 13, 18];

/** The text colour that reads best on a cell of this colour: light on the dark end, dark on the pale end. */
export function heatmapInk(fill: Rgb): Rgb {
  const on = luminance(fill);
  return contrast(on, luminance(INK_LIGHT)) >= contrast(on, luminance(INK_DARK)) ? INK_LIGHT : INK_DARK;
}

/** A CSS gradient across the whole scale, for the legend. */
export function heatmapRamp(diverging: boolean): string {
  const stops = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    return `${rgbCss(heatmapRgb(diverging ? 2 * t - 1 : t, diverging))} ${Math.round(t * 100)}%`;
  });
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

// ------------------------------------------------------------------- values

/** One state of the grid: the scores as given, or the softmax weights they turn into. */
export interface HeatmapState {
  values: number[][];
  /** The lowest and highest value the colours span; a diverging scale is symmetric around zero. */
  domain: [number, number];
  diverging: boolean;
  /** Decimal places printed in a cell. */
  places: number;
}

export interface HeatmapModel {
  raw: HeatmapState;
  /** The row-wise softmax of the scores, when the item normalizes. Weights always run on the sequential scale. */
  weights: HeatmapState | null;
  mask?: 'upper';
  unit?: string;
}

const visible = (values: number[][], mask: HeatmapItem['mask']) =>
  values.flatMap((row, r) => row.filter((_, c) => !heatmapMasked(mask, r, c)));

/**
 * The values the colours span. Weights and counts start at zero, so a cell twice another looks it; scores that sit in
 * a narrow band spread over the whole scale instead.
 */
export function heatmapDomain(values: number[][], diverging: boolean, mask?: HeatmapItem['mask']): [number, number] {
  const shown = visible(values, mask);
  if (diverging) {
    const reach = Math.max(0, ...shown.map(Math.abs)) || 1;
    return [-reach, reach];
  }
  const [low, high] = [Math.min(...shown), Math.max(...shown)];
  const lo = low >= 0 && low <= high / 2 ? 0 : low;
  return [lo, high > lo ? high : lo + 1];
}

/** Where a value sits on its scale: 0 to 1, or -1 to 1 when diverging. */
export function heatmapLevel(value: number, [lo, hi]: [number, number], diverging: boolean): number {
  return diverging ? clamp(value / hi, -1, 1) : clamp((value - lo) / (hi - lo), 0, 1);
}

/** Decimal places for the cells: the most the values were given with, at most two, so a cell stays narrow. */
export function heatmapPlaces(values: number[][], mask?: HeatmapItem['mask']): number {
  return Math.min(2, Math.max(0, ...visible(values, mask).map(decimalsOf)));
}

/** A cell's text. A value that rounds to zero says "~0": it must not print as zero, nor as a long exponent. */
export function heatmapText(value: number, places: number, unit?: string): string {
  if (value !== 0 && Number(value.toFixed(places)) === 0) return unit === '%' ? '~0%' : '~0';
  return formatValue(value, places, unit);
}

export function heatmapModel(item: HeatmapItem): HeatmapModel {
  const state = (values: number[][], diverging: boolean): HeatmapState => ({
    values,
    domain: heatmapDomain(values, diverging, item.mask),
    diverging,
    places: heatmapPlaces(values, item.mask),
  });
  return {
    raw: state(item.values, item.scale === 'diverging'),
    weights: item.normalize ? { ...state(rowSoftmax(item.values, item.mask), false), places: 2 } : null,
    mask: item.mask,
    ...(item.unit ? { unit: item.unit } : {}),
  };
}

/** Every text a cell can print, for sizing the cells. */
export function heatmapTexts(model: HeatmapModel): string[] {
  const of = (state: HeatmapState, unit?: string) =>
    state.values.flatMap((row, r) =>
      row.flatMap((value, c) => (heatmapMasked(model.mask, r, c) ? [] : [heatmapText(value, state.places, unit)])),
    );
  return [...of(model.raw, model.unit), ...(model.weights ? of(model.weights) : [])];
}

/** The two ends of the legend, in the state shown. The unit follows the high end unless it is a percent sign. */
export function heatmapLegend(state: HeatmapState, unit?: string): { low: string; high: string } {
  const text = (value: number, suffix = '') => {
    const places = decimalsOf(Number(value.toFixed(state.places)));
    return `${heatmapText(value, places, unit)}${suffix}`;
  };
  return { low: text(state.domain[0]), high: text(state.domain[1], unit && unit !== '%' ? ` ${unit}` : '') };
}

export interface CellLook {
  /** The cell colour: the scores' colour, turning into the weights' colour with `morph`. */
  fill: string;
  ink: string;
  rawText: string;
  rawOpacity: number;
  weightText: string;
  weightOpacity: number;
}

const colorOf = (state: HeatmapState, value: number): Rgb =>
  heatmapRgb(heatmapLevel(value, state.domain, state.diverging), state.diverging);

/** How a cell looks when its row has turned `morph` (0 to 1) of the way from scores to weights. The printed scores fade
 * out and the weights fade in, so the numbers never pass through values that mean nothing. */
export function cellLook(model: HeatmapModel, r: number, c: number, morph: number): CellLook {
  const { raw, weights } = model;
  const from = colorOf(raw, raw.values[r][c]);
  const rgb = weights ? mixRgb(from, colorOf(weights, weights.values[r][c]), morph) : from;
  return {
    fill: rgbCss(rgb),
    ink: rgbCss(heatmapInk(rgb)),
    rawText: heatmapText(raw.values[r][c], raw.places, model.unit),
    rawOpacity: weights ? clamp(1 - morph / 0.4, 0, 1) : 1,
    weightText: weights ? heatmapText(weights.values[r][c], weights.places) : '',
    weightOpacity: weights ? clamp((morph - 0.6) / 0.4, 0, 1) : 0,
  };
}

/** How strongly a link between a row and a column is drawn: 0 to 1, following the scores into the weights. */
export function linkLook(
  model: HeatmapModel,
  r: number,
  c: number,
  morph: number,
): { strength: number; negative: boolean } {
  const { raw, weights } = model;
  const strength = (state: HeatmapState) => Math.abs(heatmapLevel(state.values[r][c], state.domain, state.diverging));
  const before = strength(raw);
  return {
    strength: weights ? before + (strength(weights) - before) * morph : before,
    negative: raw.diverging && raw.values[r][c] < 0 && (!weights || morph < 0.5),
  };
}

// ----------------------------------------------------------------- timeline

/** The build, in ms: rows fade in one after another; when normalizing, the scores then turn into weights row by row. */
export const HEATMAP_TIMING = { first: 220, every: 90, fade: 600, pause: 700, morph: 700, morphEvery: 50 } as const;

const gridEnd = (rows: number) => HEATMAP_TIMING.first + (rows - 1) * HEATMAP_TIMING.every + HEATMAP_TIMING.fade;
const morphStart = (rows: number) => gridEnd(rows) + HEATMAP_TIMING.pause;
const morphSpan = (rows: number) => (rows - 1) * HEATMAP_TIMING.morphEvery + HEATMAP_TIMING.morph;

/** When the build is complete. */
export function heatmapEnd(rows: number, normalize: boolean): number {
  return normalize ? morphStart(rows) + morphSpan(rows) : gridEnd(rows);
}

/** How far row `row` has faded in `elapsed` ms into the build: 0 to 1, eased. */
export function rowShown(elapsed: number, row: number): number {
  return ease(clamp((elapsed - HEATMAP_TIMING.first - row * HEATMAP_TIMING.every) / HEATMAP_TIMING.fade, 0, 1));
}

/** How far row `row` has turned from scores into weights: 0 to 1, eased. */
export function rowMorph(elapsed: number, row: number, rows: number): number {
  return ease(clamp((elapsed - morphStart(rows) - row * HEATMAP_TIMING.morphEvery) / HEATMAP_TIMING.morph, 0, 1));
}

/** The whole grid's progress through the morph: 0 until the first row starts, 1 once the last is done. */
export function morphProgress(elapsed: number, rows: number): number {
  return clamp((elapsed - morphStart(rows)) / morphSpan(rows), 0, 1);
}

// ------------------------------------------------------------------- labels

export type LabelMode = 'flat' | 'wrap' | 'rotated';

export interface LabelBlock {
  mode: LabelMode;
  /** Each label's lines: one when flat, up to two when wrapped, one (cut to fit) when rotated. */
  lines: string[][];
  /** The room the labels take at their edge, in px. */
  height: number;
}

/** Line height of the labels; they are drawn at 12px. */
export const LABEL_LINE = 14;
const ROTATED_MAX = 92;

/**
 * Labels for slots `room` px wide: on one line when every label fits, else wrapped to two lines when every word
 * fits, else turned to read upward (cut with an ellipsis past ROTATED_MAX px).
 */
export function labelBlock(labels: string[], room: number, measure: Measure): LabelBlock {
  if (labels.every((label) => measure(label) <= room))
    return { mode: 'flat', lines: labels.map((label) => [label]), height: LABEL_LINE + 2 };
  const wrapped = labels.map((label) => wrapLabel(label, room, measure, 2));
  if (wrapped.every((lines) => !lines.some((line) => line.endsWith('…'))))
    return { mode: 'wrap', lines: wrapped, height: Math.max(...wrapped.map((lines) => lines.length)) * LABEL_LINE + 2 };
  return {
    mode: 'rotated',
    lines: labels.map((label) => [fitText(label, ROTATED_MAX, measure)]),
    height: Math.ceil(Math.min(ROTATED_MAX, Math.max(...labels.map(measure)))) + 4,
  };
}

// --------------------------------------------------------------------- grid

export interface GridLayout {
  width: number;
  height: number;
  /** Cell size and the gap between cells. */
  cw: number;
  ch: number;
  gap: number;
  /** Top-left corner of the first cell. */
  x0: number;
  y0: number;
  /** Row labels, cut to fit, right-aligned at `labelX`. */
  rowLabels: string[];
  labelX: number;
  /** Column labels, above the cells. */
  cols: LabelBlock;
  /** Where the "sum" marks of a normalized grid sit, or null. */
  sumX: number | null;
  /** Whether the cells are big enough to print their values. */
  values: boolean;
}

const CELL = { gap: 2, minW: 14, maxW: 64, minH: 18, aspect: 0.62 };
const GRID_LABEL_GAP = 10;
const GRID_HEAD_GAP = 6;
const SUM_WIDTH = 30;
const VALUE_PAD = 8;
/** The focus ring reaches this far past the cells; the board's body clips what is outside it. */
const RING = 4;

/**
 * Where a grid goes in `box` px: cells as wide as the room allows (never wider than 64px, and never so wide that they
 * turn into strips), as tall as the height allows without outgrowing their width; a grid that cannot keep cells of
 * 14 by 18px at least is taller than the box, and the board scrolls. `valueWidth` is the widest text a cell prints.
 */
export function gridLayout(
  item: HeatmapItem,
  box: { width: number; height: number },
  measure: Measure,
  valueWidth: number,
): GridLayout {
  const [rows, cols] = [item.rows.length, item.cols.length];
  const { gap } = CELL;
  const rowRoom = Math.min(Math.max(...item.rows.map(measure)), box.width * 0.3);
  const labelW = Math.ceil(rowRoom) + GRID_LABEL_GAP;
  const sumW = (item.normalize ? SUM_WIDTH : 0) + RING;
  const head = (cw: number) => labelBlock(item.cols, cw + gap - 4, measure);
  const fitRow = (block: LabelBlock) => (box.height - block.height - GRID_HEAD_GAP + gap) / rows - gap;
  let cw = clamp((box.width - labelW - sumW + gap) / cols - gap, CELL.minW, CELL.maxW);
  cw = clamp(Math.min(cw, fitRow(head(cw)) / CELL.aspect), CELL.minW, CELL.maxW);
  const block = head(cw);
  const ch = clamp(fitRow(block), CELL.minH, cw);
  const across = cols * cw + (cols - 1) * gap;
  const y0 = block.height + GRID_HEAD_GAP;
  return {
    width: labelW + across + sumW,
    height: y0 + rows * ch + (rows - 1) * gap,
    cw,
    ch,
    gap,
    x0: labelW,
    y0,
    rowLabels: item.rows.map((label) => fitText(label, rowRoom, measure)),
    labelX: labelW - GRID_LABEL_GAP,
    cols: block,
    sumX: item.normalize ? labelW + across + RING + 4 : null,
    values: ch >= CELL.minH - 1 && cw >= valueWidth + VALUE_PAD,
  };
}

// -------------------------------------------------------------------- links

export interface LinksLayout {
  width: number;
  height: number;
  /** Centres of the column tokens (top) and row tokens (bottom). */
  topX: number[];
  bottomX: number[];
  /** Where the curves end: at the dots under the top labels and over the bottom ones. */
  topY: number;
  bottomY: number;
  /** Where the labels meet their dots' side. */
  topEdge: number;
  bottomEdge: number;
  top: LabelBlock;
  bottom: LabelBlock;
  /** Baseline row for the values of the focused row, under the top labels, or null when the slots are too narrow. */
  valueY: number | null;
  /** Per row, per column: the curve from the row's dot to the column's dot; empty where the cell is masked. */
  curves: string[][];
  /** The widest a curve is drawn. */
  maxStroke: number;
}

const LINKS = { pad: 12, dot: 8, valueRow: 18, minHeight: 84, maxHeight: 300, aspect: 0.8 };

/** The links view: columns as a row of tokens on top, rows as a row below, S-curves from the lower to the upper. */
export function linksLayout(
  item: HeatmapItem,
  box: { width: number; height: number },
  measure: Measure,
  valueWidth: number,
): LinksLayout {
  const [rows, cols] = [item.rows.length, item.cols.length];
  const inner = Math.max(0, box.width - 2 * LINKS.pad);
  const [topSlot, bottomSlot] = [inner / cols, inner / rows];
  const top = labelBlock(item.cols, topSlot - 4, measure);
  const bottom = labelBlock(item.rows, bottomSlot - 4, measure);
  const values = topSlot >= valueWidth + 6;
  const topEdge = top.height;
  const topY = topEdge + (values ? LINKS.valueRow : 0) + LINKS.dot;
  const room = box.height - topY - LINKS.dot - bottom.height;
  const reach = clamp(Math.min(room, inner * LINKS.aspect), LINKS.minHeight, LINKS.maxHeight);
  const bottomY = topY + reach;
  const topX = item.cols.map((_, c) => LINKS.pad + (c + 0.5) * topSlot);
  const bottomX = item.rows.map((_, r) => LINKS.pad + (r + 0.5) * bottomSlot);
  const middle = round((topY + bottomY) / 2);
  // From a row's dot up to a column's dot, leaving and arriving vertically.
  const curve = (from: number, to: number) =>
    `M${round(from)} ${round(bottomY)} C${round(from)} ${middle} ${round(to)} ${middle} ${round(to)} ${round(topY)}`;
  return {
    width: box.width,
    height: bottomY + LINKS.dot + bottom.height,
    topX,
    bottomX,
    topY,
    bottomY,
    topEdge,
    bottomEdge: bottomY + LINKS.dot,
    top,
    bottom,
    valueY: values ? topEdge + LINKS.valueRow / 2 + 2 : null,
    curves: item.rows.map((_, r) =>
      item.cols.map((_, c) => (heatmapMasked(item.mask, r, c) ? '' : curve(bottomX[r], topX[c]))),
    ),
    maxStroke: clamp(Math.min(topSlot, bottomSlot) * 0.42, 2.5, 6),
  };
}

// --------------------------------------------------------------------- text

/** The grid in words, for screen readers: each row's values by column, as the board ends up showing them. */
export function heatmapAlt(item: HeatmapItem): string {
  const model = heatmapModel(item);
  const state = model.weights ?? model.raw;
  const rows = item.rows.map((row, r) => {
    const cells = item.cols.flatMap((col, c) =>
      heatmapMasked(item.mask, r, c)
        ? []
        : [`${col} ${heatmapText(state.values[r][c], state.places, model.weights ? undefined : item.unit)}`],
    );
    return `${row}: ${cells.join(', ')}`;
  });
  const extra = [item.normalize ? 'each row sums to one' : '', item.mask ? 'cells above the diagonal are masked' : ''];
  return [
    `${item.title ?? 'Heatmap'}, ${item.rows.length} rows by ${item.cols.length} columns`,
    ...rows,
    ...extra.filter(Boolean),
  ].join('; ');
}
