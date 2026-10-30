// Scatter and shapes board tests: nice axes, label placement, the better mark and build timelines; dimension lengths,
// the plan (contractions and results), layout in one row and wrapped, and timelines. Run with `npm test` (esbuild
// bundles this file for Node, no test framework needed).

import katex from 'katex';
import { canonicalDistribution } from '../../shared/distribution';
import type { DistributionItem } from '../../shared/distribution';
import type { PlotItem } from '../../shared/plot';
import { canonicalScatter } from '../../shared/scatter';
import type { ScatterItem } from '../../shared/scatter';
import { canonicalTimeline } from '../../shared/timeline';
import type { ShapesItem } from '../../shared/shapes';
import type { ScreenRect } from '../src/camera';
import {
  DISTRIBUTION_INK,
  MORPH_MS,
  areaPath,
  columnPath,
  barsAt,
  curveAt,
  distributionDescription,
  distributionDuration,
  distributionLayout,
  liveProbability,
  liveSummary,
  mixInk,
  morphEase,
  percentText,
  quantity,
  regionPath,
  regionStart,
  regionText,
  stageWanted,
} from '../src/distribution';
import { rectsOverlap } from '../src/labelLayout';
import { PLOT_TIME, markStart, plotDescription, plotDuration, plotGeometry, pointStart } from '../src/plotView';
import {
  TIMELINE_TIME,
  dateText,
  distanceText,
  positionText,
  relax,
  timelineArrival,
  timelineDescription,
  timelineDuration,
  timelineGeometry,
} from '../src/timeline';
import {
  SCATTER_TIME,
  axisFraction,
  logTickLabel,
  ramp,
  scatterArrival,
  scatterAxis,
  scatterDescription,
  scatterDuration,
  scatterGeometry,
  scatterReadout,
  segmentStart,
  tickLabel,
  valueText,
} from '../src/scatter';
import type { ScatterGeometry } from '../src/scatter';
import {
  SHAPES_TIME,
  dimensionLengths,
  dimensionTex,
  ghostStart,
  lightStart,
  plainTex,
  shapesDescription,
  shapesDuration,
  shapesLayout,
  shapesPlan,
  termArrival,
} from '../src/shapes';

const results: string[] = [];
let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    results.push(`  ok    ${name}`);
  } catch (error) {
    failures++;
    results.push(`  FAIL  ${name}\n        ${(error as Error).message}`);
  }
}
function eq(actual: unknown, expected: unknown, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}
function ok(condition: boolean, what = 'condition does not hold') {
  if (!condition) throw new Error(what);
}

// About 7px a character, like a 13px label.
const measure = (text: string) => text.length * 7;
const fonts = {
  tick: (t: string) => t.length * 6.2,
  label: (t: string) => t.length * 7,
  title: (t: string) => t.length * 6.5,
};

// ------------------------------------------------------------------ scatter

test('a linear axis lands on 1, 2 or 5 times a power of ten, evenly, inside its domain', () => {
  for (const [values, length] of [
    [[0.2, 0.93], 300],
    [[61.2, 80.2], 260],
    [[3, 4200], 400],
    [[-12, 7], 280],
    [[0.0012, 0.0049], 320],
  ] as [number[], number][]) {
    const axis = scatterAxis(values, false, length, 62);
    const ticks = axis.ticks.map((t) => t.value);
    ok(
      ticks.length >= 2 && ticks.length <= Math.max(3, Math.floor(length / 62) + 1),
      `${values}: ${ticks.length} ticks`,
    );
    ok(
      ticks.every((v) => v >= axis.lo - 1e-9 && v <= axis.hi + 1e-9),
      `${values}: ticks inside the domain`,
    );
    const step = ticks[1] - ticks[0];
    ok(
      ticks.every((v, i) => i === 0 || Math.abs(v - ticks[i - 1] - step) < step * 1e-6),
      `${values}: even steps`,
    );
    const lead = step / 10 ** Math.floor(Math.log10(step) + 1e-9);
    ok(
      [1, 2, 5].some((m) => Math.abs(lead - m) < 1e-6),
      `${values}: step ${step} is 1, 2 or 5 times a power of ten`,
    );
    ok(Math.min(...values) > axis.lo && Math.max(...values) < axis.hi, `${values}: room around the data`);
  }
});

test('an axis whose data starts near zero is drawn from zero, one that starts far from it is not', () => {
  const near = scatterAxis([10, 100], false, 300, 62);
  eq(near.lo, 0, 'from zero');
  eq(near.ticks[0].value, 0, 'zero is a tick');
  const far = scatterAxis([50, 100], false, 300, 62);
  ok(far.lo > 0 && far.lo < 50, 'starts just below the data');
  const none = scatterAxis([0, 5], false, 300, 62);
  ok(none.lo < 0, 'a point at zero is not on the axis');
});

test('tick labels: grouped digits, k and M past ten thousand, a true minus, decimals from the step', () => {
  eq(tickLabel(0.5, 0.5), '0.5');
  eq(tickLabel(0.25, 0.05), '0.25');
  eq(tickLabel(2500, 500), '2,500');
  eq(tickLabel(15000, 5000), '15k');
  eq(tickLabel(10500, 500), '10.5k');
  eq(tickLabel(2.5e6, 5e5), '2.5M');
  eq(tickLabel(-5, 5), '−5');
  eq(tickLabel(0, 20), '0');
});

test('log tick labels read as 0.01, 1, 1k, 20M, and as powers of ten at the extremes', () => {
  eq([1, 10, 0.01, 0.5, 20, 1000, 5e5, 2e6, 3e9].map(logTickLabel), [
    '1',
    '10',
    '0.01',
    '0.5',
    '20',
    '1k',
    '500k',
    '2M',
    '3B',
  ]);
  eq(logTickLabel(1e-4), '10⁻⁴');
  eq(logTickLabel(1e18), '10¹⁸');
  eq(logTickLabel(5e17), '5×10¹⁷');
});

test('a log axis labels decades, with unlabelled marks between them', () => {
  const axis = scatterAxis([3, 9e5], true, 400, 62);
  eq(
    axis.ticks.map((t) => t.label),
    ['10', '100', '1k', '10k', '100k', '1M'],
  );
  ok(
    axis.minor.length > 0 && axis.minor.every((v) => !axis.ticks.some((t) => t.value === v)),
    'minor marks between decades',
  );
  ok(
    axis.minor.every((v) => v > axis.lo && v < axis.hi),
    'minor marks inside the domain',
  );
});

test('a log axis with little room labels every other power of ten, and one under a decade labels 2 and 5', () => {
  const narrow = scatterAxis([3, 9e5], true, 190, 62);
  eq(
    narrow.ticks.map((t) => t.label),
    ['100', '10k', '1M'],
  );
  const short = scatterAxis([20, 60], true, 240, 62);
  eq(
    short.ticks.map((t) => t.label),
    ['20', '50'],
  );
  const tight = scatterAxis([20, 60], true, 400, 62);
  eq(
    tight.ticks.map((t) => t.label),
    ['20', '30', '40', '50', '60'],
  );
});

test('a value sits at 0 at the start of its axis and 1 at the end, in order, on either scale', () => {
  for (const log of [false, true]) {
    const axis = scatterAxis([2, 700], log, 300, 62);
    ok(
      Math.abs(axisFraction(axis, axis.lo)) < 1e-9 && Math.abs(axisFraction(axis, axis.hi) - 1) < 1e-9,
      `ends (${log})`,
    );
    ok(
      axisFraction(axis, 2) > 0 && axisFraction(axis, 700) < 1 && axisFraction(axis, 2) < axisFraction(axis, 700),
      `order (${log})`,
    );
  }
  const axis = scatterAxis([1, 1000], true, 300, 62);
  ok(
    Math.abs(axisFraction(axis, 10) - axisFraction(axis, 1)) -
      Math.abs(axisFraction(axis, 100) - axisFraction(axis, 10)) <
      1e-9,
    'decades equal',
  );
});

test('a linear axis past a thousand trillion or under a thousandth labels powers of ten, as a whole', () => {
  const labels = (values: number[]) => scatterAxis(values, false, 300, 62).ticks.map((t) => t.label);
  const powers = (list: string[]) => list.every((label) => label === '0' || /^(?:[\d.]+×)?10⁻?[⁰¹²³⁴⁵⁶⁷⁸⁹]+$/.test(label));
  for (const values of [[9.6e18, 2.3e19, 4e19], [0, 2e19], [1.2e15, 2e15], [5e-5, 8e-4], [0, 8e-4], [-4e-4, 6e-4]])
    ok(powers(labels(values)), `${values}: ${labels(values).join(' | ')}`);
  eq(labels([0, 2e19]).at(-1), '2×10¹⁹');
  eq(labels([0, 2e19]).at(0), '0', 'zero stays 0');
  ok(labels([-3e18, 2e18]).some((label) => label === '−10¹⁸' || label.startsWith('−')), labels([-3e18, 2e18]).join(' | '));
  // One style per axis: the largest tick decides, so a mix like "0.0000 | 5×10⁻⁴ | 0.0010" never appears.
  for (const values of [[0, 0.0012], [0, 0.0015], [0, 1e-3], [0, 0.5], [0, 5e14], [0, 9e14], [100, 5e5]])
    ok(!labels(values).some((label) => label.includes('10') && /[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(label)), `${values}: ${labels(values).join(' | ')}`);
  eq(labels([0, 0.0012]), ['0.0000', '0.0005', '0.0010'], 'unchanged from before powers of ten');
  eq(labels([0, 5e14]), ['0', '200T', '400T'], 'a value the units spell out keeps its unit');
  // Neighbouring ticks never share a label, however narrow the axis is relative to its values.
  for (const values of [[1e15, 1.0001e15], [2.5e19, 2.5001e19], [1e-5, 1.00004e-5]]) {
    const list = labels(values);
    ok(list.length >= 2 && new Set(list).size === list.length, `${values}: ${list.join(' | ')}`);
  }
  // tickLabel itself is the plain label: the powers of ten are chosen for an axis, not a value.
  eq(tickLabel(0.002, 0.001), '0.002');
  eq(tickLabel(5e14, 1e14), '500T');
});

test('a scatter of a document\'s costs in FLOPs is drawn on a log axis with powers of ten for labels', () => {
  const flops: ScatterItem = canonicalScatter({
    kind: 'scatter',
    x_label: 'Training cost (FLOPs)',
    y_label: 'BLEU EN-DE',
    better: 'up-left',
    source: 'document',
    points: [
      { label: 'ConvS2S', x: 9.6e18, y: 25.16 },
      { label: 'MoE', x: 2e19, y: 26.03 },
      { label: 'GNMT + RL', x: 2.3e19, y: 24.6 },
      { label: 'Transformer (base)', x: 3.3e18, y: 27.3 },
      { label: 'ConvS2S Ensemble', x: 7.7e19, y: 26.36 },
    ],
  });
  eq(flops.x_log, true, 'the axis is chosen in code, not left to the model');
  eq(flops.y_log, undefined, 'BLEU stays linear');
  const g = scatterGeometry(flops, { width: 438, height: 400 }, fonts);
  ok(g.xTicks.length >= 2 && g.xTicks.every((t) => t.label.includes('10') && /[⁰¹²³⁴⁵⁶⁷⁸⁹]/.test(t.label)), g.xTicks.map((t) => t.label).join(' '));
  ok(g.points.every((p) => p.x >= g.plot.left && p.x <= g.plot.right), 'points inside the plot');
  const order = [...flops.points].map((p, i) => [p.x, g.points[i].x]).sort((a, b) => a[0] - b[0]);
  ok(order.every((v, i) => i === 0 || v[1] > order[i - 1][1]), 'larger cost sits further right');
  const readout = scatterReadout(g, 0, flops, fonts.tick);
  eq(readout.x.text, '9.6×10¹⁸', 'the badge of the focused point reads as printed');
});

test('values within a decade stay on a linear axis, which prints powers of ten rather than a log axis of one tick', () => {
  const narrow = (xs: number[]) =>
    canonicalScatter({
      kind: 'scatter',
      x_label: 'x',
      y_label: 'y',
      source: 'document',
      points: xs.map((x, i) => ({ label: `p${i}`, x, y: 10 + i })),
    });
  for (const xs of [[1e20, 1.2e20, 1.5e20], [3e-4, 5e-4, 8e-4], [9.6e18, 2.3e19, 3.3e19]]) {
    const item = narrow(xs);
    eq(item.x_log, undefined, xs.join(', '));
    for (const width of [343, 438]) {
      const g = scatterGeometry(item, { width, height: 400 }, fonts);
      ok(g.xTicks.length >= 2 && g.xTicks.every((t) => /^(?:[\d.]+×)?10⁻?[⁰¹²³⁴⁵⁶⁷⁸⁹]+$/.test(t.label)), `${xs} at ${width}: ${g.xTicks.map((t) => t.label).join(' ')}`);
      ok(new Set(g.xTicks.map((t) => t.label)).size === g.xTicks.length, 'distinct labels');
    }
  }
  eq(narrow([1e19, 1e20]).x_log, true, 'a decade or more of such values is a log axis');
});

test('badge values print exactly, or as a few digits of a power of ten when huge or tiny', () => {
  eq(valueText(74.3), '74.3');
  eq(valueText(12345), '12,345');
  eq(valueText(4e21), '4×10²¹');
  eq(valueText(0.00012), '1.2×10⁻⁴');
});

const tradeoff: ScatterItem = {
  kind: 'scatter',
  title: 'Quality against cost',
  x_label: 'Inference cost (ms per image)',
  y_label: 'Top-1 accuracy (%)',
  better: 'up-left',
  source: 'document',
  points: [
    { label: 'Tiny', x: 8, y: 61.2, series: 'Convolutional' },
    { label: 'Small', x: 14, y: 68.9, series: 'Convolutional' },
    { label: 'Base', x: 31, y: 74.3, series: 'Convolutional' },
    { label: 'Large', x: 78, y: 78.1, series: 'Convolutional' },
    { label: 'Mixer-S', x: 11, y: 64.5, series: 'Hybrid' },
    { label: 'Mixer-B', x: 26, y: 71, series: 'Hybrid' },
    { label: 'Mixer-L', x: 60, y: 76.8, series: 'Hybrid' },
    { label: 'Mixer-H', x: 140, y: 80.2, series: 'Hybrid' },
  ],
};
const labelRect = (p: ScatterGeometry['points'][number]): ScreenRect => ({
  left: p.label.left,
  top: p.label.top,
  right: p.label.left + p.label.width,
  bottom: p.label.top + p.label.height,
});
const dotRect = (p: ScatterGeometry['points'][number], r = 5): ScreenRect => ({
  left: p.x - r,
  top: p.y - r,
  right: p.x + r,
  bottom: p.y + r,
});
const inside = (r: ScreenRect, box: ScreenRect) =>
  r.left >= box.left - 0.01 && r.top >= box.top - 0.01 && r.right <= box.right + 0.01 && r.bottom <= box.bottom + 0.01;

/** Every label lies inside the plot, clear of every dot and of the other labels. */
function assertClean(g: ScatterGeometry) {
  for (const p of g.points) {
    ok(inside(dotRect(p), g.plot), `point ${p.index} is inside the plot`);
    ok(inside(labelRect(p), g.plot), `label ${p.index} stays inside the plot, clear of the axes`);
    ok(p.label.clear, `label ${p.index} found a clear spot`);
    for (const q of g.points) {
      if (q.index !== p.index) ok(!rectsOverlap(labelRect(p), dotRect(q)), `label ${p.index} covers point ${q.index}`);
      if (q.index > p.index) ok(!rectsOverlap(labelRect(p), labelRect(q)), `labels ${p.index} and ${q.index} overlap`);
    }
    ok(!rectsOverlap(labelRect(p), dotRect(p, 8)), `label ${p.index} covers its own point`);
  }
}

test('labels sit beside their points: inside the plot, clear of every point, of each other and of the axes', () => {
  for (const width of [420, 340, 300]) assertClean(scatterGeometry(tradeoff, { width, height: 520 }, fonts));
});

test('labels stay clean on a log axis with series and in a crowded corner', () => {
  const log: ScatterItem = {
    kind: 'scatter',
    x_label: 'Training compute (FLOPs)',
    y_label: 'Validation loss',
    x_log: true,
    better: 'down-right',
    source: 'illustrative',
    points: [
      { label: '10M params', x: 3e17, y: 3.9 },
      { label: '100M params', x: 2e18, y: 3.2 },
      { label: '1B params', x: 9e19, y: 2.7 },
      { label: '10B params', x: 4e21, y: 2.35 },
      { label: '100B params', x: 8e22, y: 2.1 },
    ],
  };
  assertClean(scatterGeometry(log, { width: 380, height: 520 }, fonts));
  const crowded: ScatterItem = {
    ...tradeoff,
    points: tradeoff.points.map((p, i) => ({ ...p, x: 20 + i * 3, y: 70 + (i % 3) })),
  };
  const g = scatterGeometry(crowded, { width: 380, height: 520 }, fonts);
  for (const p of g.points)
    ok(inside(labelRect(p), { left: 0, top: 0, right: g.width, bottom: g.height }), `label ${p.index} stays in view`);
});

test('every point gets a label, even when the labels are too many to keep clear', () => {
  const dense: ScatterItem = {
    kind: 'scatter',
    x_label: 'Precision',
    y_label: 'Recall',
    source: 'document',
    points: Array.from({ length: 10 }, (_, i) => ({
      label: `Result number ${i + 1}`,
      x: 0.5 + (i % 4) * 0.01,
      y: 0.6 + (i % 5) * 0.01,
    })),
  };
  const g = scatterGeometry(dense, { width: 260, height: 300 }, fonts);
  eq(g.points.length, 10);
  for (const p of g.points) {
    ok(p.label.lines.length >= 1 && p.label.width > 0, `label ${p.index} exists`);
    ok(inside(labelRect(p), g.plot), `label ${p.index} stays inside the plot`);
  }
});

test('the plot has the room the labels need: a minimum height, a cap in proportion to its width', () => {
  const tall = scatterGeometry(tradeoff, { width: 380, height: 2000 }, fonts);
  ok(tall.height <= 380 * 1.15 + 0.01, 'capped by its width');
  const short = scatterGeometry(tradeoff, { width: 380, height: 40 }, fonts);
  ok(short.plot.bottom - short.plot.top >= 130, 'never shorter than the minimum plot');
  const long = scatterGeometry(
    { ...tradeoff, y_label: 'A rather long description of the quantity (units)' },
    { width: 220, height: 400 },
    fonts,
  );
  eq(long.yTitle.lines.length, 2, 'a long axis title wraps to two lines');
  ok(long.plot.top >= 4 + 2 * 15, 'and the plot starts below it');
});

test('points of a series are joined in x order, each segment between neighbours', () => {
  const g = scatterGeometry(tradeoff, { width: 400, height: 500 }, fonts);
  eq(g.series, ['Convolutional', 'Hybrid']);
  eq(g.segments.length, 6);
  const conv = g.segments.filter((s) => s.series === 0).map((s) => [s.from, s.to]);
  eq(conv, [
    [0, 1],
    [1, 2],
    [2, 3],
  ]);
  for (const s of g.segments) ok(g.points[s.from].x < g.points[s.to].x, 'drawn left to right');
  const shuffled: ScatterItem = {
    ...tradeoff,
    points: [tradeoff.points[3], tradeoff.points[0], tradeoff.points[2], tradeoff.points[1]],
  };
  const sg = scatterGeometry(shuffled, { width: 400, height: 500 }, fonts);
  eq(
    sg.segments.map((s) => [s.from, s.to]),
    [
      [1, 3],
      [3, 2],
      [2, 0],
    ],
    'x order, not listed order',
  );
  const none = scatterGeometry(
    { ...tradeoff, points: tradeoff.points.map(({ series: _, ...p }) => p) },
    { width: 400, height: 500 },
    fonts,
  );
  eq(none.segments.length, 0, 'no series, no lines');
});

test('the better corner gets a wash toward it and a mark clear of points and labels', () => {
  for (const better of ['up-left', 'up-right', 'down-left', 'down-right'] as const) {
    const g = scatterGeometry({ ...tradeoff, better }, { width: 400, height: 500 }, fonts);
    ok(!!g.better && !!g.wash, `${better}: mark and wash`);
    const mark = g.better!.rect;
    ok(inside(mark, g.plot), `${better}: the mark is inside the plot`);
    if (g.better!.text) {
      for (const p of g.points) {
        ok(!rectsOverlap(mark, dotRect(p)), `${better}: the mark covers point ${p.index}`);
        ok(!rectsOverlap(mark, labelRect(p)), `${better}: the mark covers label ${p.index}`);
      }
    }
    const best = {
      x: better.endsWith('right') ? g.plot.right : g.plot.left,
      y: better.startsWith('up') ? g.plot.top : g.plot.bottom,
    };
    eq([g.wash!.x2, g.wash!.y2], [best.x, best.y], `${better}: the wash ends in its corner`);
  }
  const plain = scatterGeometry({ ...tradeoff, better: undefined }, { width: 400, height: 500 }, fonts);
  ok(plain.better === null && plain.wash === null, 'no better, no mark');
});

test('the better mark steps aside for a point in its corner, or shrinks to its arrow', () => {
  const corner: ScatterItem = {
    ...tradeoff,
    points: [
      { label: 'A', x: 1, y: 1 },
      { label: 'B', x: 5, y: 9 },
      { label: 'Best', x: 10, y: 10 },
      { label: 'C', x: 9, y: 2 },
    ],
  };
  const g = scatterGeometry({ ...corner, better: 'up-right' }, { width: 400, height: 500 }, fonts);
  const mark = g.better!;
  if (mark.text) for (const p of g.points) ok(!rectsOverlap(mark.rect, dotRect(p)), 'the mark keeps off the points');
  else ok(mark.rect.right - mark.rect.left <= 10, 'only the arrow');
});

test('the readout shows the focused point on both axes, inside the drawing, and hides the tick labels it covers', () => {
  const g = scatterGeometry(tradeoff, { width: 380, height: 480 }, fonts);
  for (let i = 0; i < tradeoff.points.length; i++) {
    const r = scatterReadout(g, i, tradeoff, fonts.tick);
    ok(r.x.rect.left >= 0 && r.x.rect.right <= g.width, `x badge ${i} inside`);
    ok(r.y.rect.left >= 0 && r.y.rect.right <= g.plot.left, `y badge ${i} left of the axis`);
    eq([r.x.text, r.y.text], [String(tradeoff.points[i].x), String(tradeoff.points[i].y)], `values ${i}`);
    for (const t of r.hideX)
      ok(
        Math.abs(g.xTicks[t].at - (r.x.rect.left + r.x.rect.right) / 2) < (r.x.rect.right - r.x.rect.left) / 2 + 30,
        'hides only near ticks',
      );
  }
  // No tick label that stays visible is covered by a badge; a point right on a tick hides that tick's label.
  for (let i = 0; i < tradeoff.points.length; i++) {
    const r = scatterReadout(g, i, tradeoff, fonts.tick);
    g.xTicks.forEach((t, k) => {
      const half = fonts.tick(t.label) / 2;
      const label = { left: t.at - half, top: g.plot.bottom + 8, right: t.at + half, bottom: g.plot.bottom + 22 };
      ok(r.hideX.includes(k) || !rectsOverlap(label, r.x.rect), `point ${i}: x tick ${t.label} is covered`);
    });
  }
  const onTick: ScatterItem = {
    ...tradeoff,
    points: [...tradeoff.points.slice(0, 7), { label: 'On a tick', x: 60, y: 70 }],
  };
  const gt = scatterGeometry(onTick, { width: 380, height: 480 }, fonts);
  const hidden = scatterReadout(gt, 7, onTick, fonts.tick);
  ok(
    hidden.hideX.length > 0 && hidden.hideX.length < gt.xTicks.length,
    'the tick under the badge gives way, the others stay',
  );
});

test('the left margin makes room for the widest tick label and the widest badge', () => {
  const wide: ScatterItem = { ...tradeoff, points: tradeoff.points.map((p) => ({ ...p, y: p.y * 1000 + 0.123 })) };
  const g = scatterGeometry(wide, { width: 400, height: 500 }, fonts);
  for (let i = 0; i < wide.points.length; i++) {
    const r = scatterReadout(g, i, wide, fonts.tick);
    ok(r.y.rect.left >= 0, `badge ${i} does not leave the drawing`);
  }
});

test('the scatter builds axes first, then points one after another with their labels, lines as both ends arrive', () => {
  const n = tradeoff.points.length;
  for (let i = 1; i < n; i++) ok(scatterArrival(i) > scatterArrival(i - 1), 'points arrive in order');
  ok(scatterArrival(0) >= SCATTER_TIME.axes * 0.9, 'after the axes');
  const g = scatterGeometry(tradeoff, { width: 400, height: 500 }, fonts);
  for (const s of g.segments)
    ok(segmentStart(s) > scatterArrival(Math.max(s.from, s.to)), 'a line starts once its later point is in');
  ok(scatterDuration(n) > scatterArrival(n - 1) + SCATTER_TIME.grow, 'ends after the last point has grown');
  eq([ramp(0, 100, 200), ramp(200, 100, 200), ramp(500, 100, 200)], [0, 0.5, 1]);
});

test('a scatter reads as a sentence for screen readers', () => {
  const text = scatterDescription(tradeoff);
  ok(
    text.includes('Top-1 accuracy (%) against Inference cost (ms per image)') && text.includes('Base (31, 74.3)'),
    text,
  );
  ok(text.includes('better is up and left'), text);
  const flops = { ...tradeoff, points: [{ label: 'Big', x: 2.3e19, y: 28.4 }, { label: 'Base', x: 3.3e18, y: 27.3 }, { label: 'Tiny', x: 1e-5, y: 5 }] };
  const huge = scatterDescription(flops);
  ok(huge.includes('Big (2.3×10¹⁹, 28.4)') && huge.includes('Base (3.3×10¹⁸, 27.3)') && huge.includes('Tiny (1×10⁻⁵, 5)'), huge);
});

// ------------------------------------------------------------------- shapes

const m = (name: string, rows: string, cols: string) => ({ kind: 'matrix' as const, name, rows, cols });
const op = (o: 'times' | 'plus' | 'hadamard' | 'equals' | 'apply', label?: string) => ({
  kind: 'op' as const,
  op: o,
  ...(label ? { label } : {}),
});
const product: ShapesItem = {
  kind: 'shapes',
  title: 'Pairwise scores',
  terms: [m('Q', 'n', 'd_k'), op('times'), m('K^T', 'd_k', 'n'), op('equals'), m('S', 'n', 'n')],
};
const chain: ShapesItem = {
  kind: 'shapes',
  terms: [
    m('S', 'n', 'n'),
    op('apply', 'softmax'),
    m('P', 'n', 'n'),
    op('times'),
    m('V', 'n', 'd_v'),
    op('equals'),
    m('O', 'n', 'd_v'),
  ],
};
const factors: ShapesItem = {
  kind: 'shapes',
  terms: [
    m('X', 'n', 'd_model'),
    op('times'),
    m('W', 'd_model', 'd_k'),
    op('times'),
    m('U^T', 'd_k', 'p'),
    op('equals'),
    m('Z', 'n', 'p'),
  ],
};
const layer: ShapesItem = {
  kind: 'shapes',
  terms: [
    m('W_1', '512', '2048'),
    op('times'),
    m('x', '2048', '1'),
    op('plus'),
    m('b', '512', '1'),
    op('equals'),
    m('y', '512', '1'),
  ],
};

test('one symbol has one length everywhere, different dimensions differ, and nothing is tiny or huge', () => {
  const lengths = dimensionLengths([
    { rows: 'n', cols: 'd_k' },
    { rows: 'd_k', cols: 'n' },
    { rows: 'n', cols: 'n' },
    { rows: 'm', cols: '1' },
  ]);
  eq(lengths.get('1'), 0.16, 'a vector is thin');
  const symbols = ['n', 'd_k', 'm'].map((d) => lengths.get(d)!);
  ok(
    symbols.every((v) => v >= 0.46 && v <= 1),
    'within the limits',
  );
  ok(new Set(symbols).size === 3, 'distinct symbols have distinct lengths');
  const sorted = [...symbols].sort((a, b) => a - b);
  ok(
    sorted.every((v, i) => i === 0 || v - sorted[i - 1] >= 0.07),
    'and visibly different',
  );
});

test('numbers keep their order on a log scale within the limits, and many dimensions still all differ', () => {
  const lengths = dimensionLengths([
    { rows: '64', cols: '512' },
    { rows: '2048', cols: '64' },
  ]);
  const [a, b, c] = ['64', '512', '2048'].map((d) => lengths.get(d)!);
  ok(a < b && b < c, 'ordered');
  ok(a >= 0.46 - 1e-9 && c <= 1 + 1e-9, 'within the limits');
  eq([a, c], [0.46, 1], 'smallest and largest take the limits');
  const lone = dimensionLengths([{ rows: '8', cols: '8' }]);
  ok(Math.abs(lone.get('8')! - 0.73) < 1e-9, 'one number sits in the middle');
  const many = dimensionLengths(Array.from({ length: 5 }, (_, i) => ({ rows: `a${i}`, cols: `b${i}` })));
  const all = [...many.entries()].filter(([k]) => k !== '1').map(([, v]) => v);
  ok(all.length === 10 && new Set(all.map((v) => v.toFixed(4))).size === 10, 'ten dimensions, ten lengths');
  ok(
    all.every((v) => v >= 0.46 - 1e-9 && v <= 1 + 1e-9),
    'all within the limits',
  );
});

test('dimension labels: symbols as they are, words and long subscripts upright, numbers as plain text', () => {
  eq(dimensionTex('n'), 'n');
  eq(dimensionTex('d_k'), 'd_k');
  eq(dimensionTex('d_model'), 'd_{\\mathrm{model}}');
  eq(dimensionTex('seq'), '\\mathrm{seq}');
  eq(dimensionTex('64'), null);
  for (const dim of ['n', 'd_k', 'd_model', 'seq', '\\alpha'])
    katex.renderToString(dimensionTex(dim)!, { throwOnError: true, strict: 'ignore' });
  eq(plainTex('\\mathbf{W}^{Q}_i'), 'WQi');
  eq(plainTex('K^\\top'), 'KT');
});

test('the plan draws results at the computed shape and finds each product’s contracted dimension', () => {
  const plan = shapesPlan(product)!;
  eq(
    plan.matrices.map((x) => [x.name, x.shape.rows, x.shape.cols, x.result]),
    [
      ['Q', 'n', 'd_k', false],
      ['K^T', 'd_k', 'n', false],
      ['S', 'n', 'n', true],
    ],
  );
  eq(
    plan.contractions.map((c) => [c.op, c.left, c.right, c.dim, c.color, c.result]),
    [[1, 0, 1, 'd_k', 'orange', 2]],
  );
  // A result whose stated shape is wrong is still drawn as computed.
  const wrong = shapesPlan({ ...product, terms: [...product.terms.slice(0, 4), m('S', 'q', 'q')] })!;
  eq([wrong.matrices[2].shape.rows, wrong.matrices[2].shape.cols], ['n', 'n']);
});

test('apply keeps the shape, a chain of products has one contraction each with its own colour', () => {
  const plan = shapesPlan(chain)!;
  eq(
    plan.matrices.map((x) => x.result),
    [false, true, false, true],
  );
  eq(
    plan.contractions.map((c) => [c.left, c.right, c.dim, c.result]),
    [[1, 2, 'n', 3]],
  );
  const three = shapesPlan(factors)!;
  eq(
    three.contractions.map((c) => [c.dim, c.color, c.left, c.right, c.result]),
    [
      ['d_model', 'orange', 0, 1, 3],
      ['d_k', 'pink', 1, 2, 3],
    ],
  );
  eq(
    shapesPlan(layer)!.contractions.map((c) => c.dim),
    ['2048'],
  );
});

test('terms that do not alternate matrix, operator, matrix have no plan', () => {
  eq(shapesPlan({ kind: 'shapes', terms: [m('A', 'n', 'd'), op('times')] }), null);
  eq(shapesPlan({ kind: 'shapes', terms: [m('A', 'n', 'd'), m('B', 'd', 'm'), m('C', 'n', 'm')] }), null);
});

/** Every block, operator and spilling label of the layout lies in the stage; no two blocks of a row overlap. */
function assertFits(item: ShapesItem, width: number) {
  const layout = shapesLayout(shapesPlan(item)!, width, measure);
  ok(layout.width <= width + 0.01 || layout.unit <= 44, `width ${layout.width} fits ${width}`);
  const rects = (): ScreenRect[] =>
    layout.blocks.map((b) => ({ left: b.x, top: b.y, right: b.x + b.w, bottom: b.y + b.h }));
  rects().forEach((r, i) => {
    ok(
      r.left >= 0 && r.right <= layout.width + 0.01 && r.top >= 0 && r.bottom <= layout.height + 0.01,
      `block ${i} inside the stage`,
    );
    rects().forEach((o, j) => j > i && ok(!rectsOverlap(r, o), `blocks ${i} and ${j} overlap`));
  });
  for (const o of layout.ops) {
    ok(o.x >= 0 && o.x + o.w <= layout.width + 0.01, 'operator inside the stage');
    rects().forEach((r, i) =>
      ok(
        !rectsOverlap({ left: o.x, top: o.cy - 10, right: o.x + o.w, bottom: o.cy + 10 }, r),
        `operator ${o.term} over block ${i}`,
      ),
    );
  }
  return layout;
}

test('a product stands in one row, left to right, with blocks sized by their dimensions', () => {
  const layout = assertFits(product, 392);
  eq(layout.rows, 1);
  const [q, k, s] = layout.blocks;
  ok(q.x < k.x && k.x < s.x, 'in term order');
  ok(Math.abs(q.y + q.h / 2 - (k.y + k.h / 2)) < 0.01, 'on one centre line');
  ok(
    layout.ops.length === 2 && layout.ops[0].x >= q.x + q.w && layout.ops[0].x + layout.ops[0].w <= k.x,
    'the operator sits between the blocks',
  );
  // The same symbol is the same length: Q's rows (n), the result's rows and columns, K^T's columns.
  for (const side of [q.h, k.w, s.h, s.w]) ok(Math.abs(side - q.h) < 0.01, 'n is n everywhere');
  ok(Math.abs(q.w - k.h) < 0.01 && Math.abs(q.w - q.h) > 5, 'd_k is d_k everywhere, and not n');
  ok(layout.unit <= 120 && layout.unit >= 64, `unit ${layout.unit} within limits`);
  eq([q.rows, q.cols, s.rows, s.cols], ['n', 'd_k', 'n', 'n']);
});

test('a wide board does not blow the blocks up, a narrow one wraps after an operator instead of shrinking them', () => {
  const wide = assertFits(product, 900);
  ok(wide.unit === 120, 'capped at the largest unit');
  for (const width of [392, 330, 280, 240]) {
    const layout = assertFits(chain, width);
    ok(layout.rows === 1 ? layout.unit >= 64 : layout.unit >= 44, `${width}: unit ${layout.unit}`);
  }
  const narrow = shapesLayout(shapesPlan(chain)!, 300, measure);
  ok(narrow.rows > 1, 'wrapped');
  const rowsOf = new Set(narrow.blocks.map((b) => b.y));
  ok(rowsOf.size > 1, 'blocks on different rows');
  // Wrapping breaks after an operator: every row but the last ends with one.
  const lastOfRow = [...rowsOf]
    .slice(0, -1)
    .map((y) => Math.max(...narrow.blocks.filter((b) => b.y === y).map((b) => b.x + b.w)));
  for (const edge of lastOfRow)
    ok(
      narrow.ops.some((o) => Math.abs(o.x - edge) < 0.01),
      'a row ends with an operator',
    );
  eq(narrow.ops.length, 3, 'every operator is drawn');
});

test('long chains and numeric dimensions fit too, and a vector carries its name beneath it', () => {
  for (const width of [450, 360, 300]) {
    assertFits(factors, width);
    assertFits(layer, width);
  }
  const l = shapesLayout(shapesPlan(layer)!, 330, measure);
  const [w1, x, b, y] = l.blocks;
  ok(l.unit < 100 && x.w < 16, `a vector is thin (${x.w} px at unit ${l.unit})`);
  ok(
    !w1.nameBelow && x.nameBelow && b.nameBelow && y.nameBelow,
    'only the vectors, too thin for a name, carry it below',
  );
  ok(x.h > 50 && x.h > 3 * x.w, 'a vector is as tall as its dimension');
  ok(w1.w > w1.h, '2048 is longer than 512');
  ok(y.ghostY > y.y + y.h, 'the ghost goes below the result');
  const roomy = shapesLayout(shapesPlan(layer)!, 450, measure);
  ok(roomy.blocks[1].w > 16 && !roomy.blocks[1].nameBelow, 'with room, a short name fits inside a vector');
});

test('the layout reserves room under a result for the dimensions that were summed out', () => {
  const plain = shapesLayout(shapesPlan({ ...product, terms: product.terms.slice(0, 3) })!, 392, measure);
  const full = shapesLayout(shapesPlan(product)!, 392, measure);
  ok(full.height > plain.height, 'taller when a result carries a ghost');
});

test('a shapes board reads as a sentence for screen readers', () => {
  eq(
    shapesDescription(product),
    'Pairwise scores: Q (n by d_k) times KT (d_k by n) equals S (n by n); dk is summed over',
  );
  ok(shapesDescription(chain).includes('through softmax to give P (n by n)'), shapesDescription(chain));
});

test('the shapes build left to right, a product lights up after its right operand, the result shows what is gone', () => {
  const plan = shapesPlan(factors)!;
  for (let i = 1; i < factors.terms.length; i++) ok(termArrival(i) > termArrival(i - 1), 'terms arrive in order');
  for (const c of plan.contractions) {
    ok(lightStart(c) > termArrival(c.op + 1), 'lights after the right operand has landed');
    ok(ghostStart(c)! > termArrival(c.result! * 2), 'the ghost follows the result');
  }
  const end = shapesDuration(plan);
  ok(end >= termArrival(factors.terms.length - 1) + SHAPES_TIME.grow, 'ends after the last matrix');
  ok(end >= Math.max(...plan.contractions.map((c) => ghostStart(c)! + SHAPES_TIME.ghost)), 'and after the last ghost');
  eq(ghostStart({ result: null }), null, 'no result, no ghost');
});

// ----------------------------------------------------------------- timeline

const timelineFonts = { tick: (t: string) => t.length * 6.2, label: (t: string) => t.length * 7, chip: (t: string) => t.length * 6.4 };
const lease = () =>
  canonicalTimeline({
    kind: 'timeline',
    title: 'Earliest exit',
    unit: 'month',
    source: 'document',
    anchor: { label: 'Lease starts' },
    events: [
      { label: 'Notice allowed', after: 'Lease starts', offset: 3 },
      { label: 'Earliest exit', after: 'Notice allowed', offset: 3 },
      { label: 'Fixed term ends', after: 'Lease starts', offset: 12 },
    ],
    spans: [
      { label: 'Too early to serve', from: 'Lease starts', to: 'Notice allowed', role: 'wait' },
      { label: 'Notice runs', from: 'Notice allowed', to: 'Earliest exit', role: 'notice' },
      { label: 'Fixed term', from: 'Lease starts', to: 'Fixed term ends', role: 'term' },
    ],
  });

test('labels are spread to a pitch apart in the order of what they name, moving as little as they can', () => {
  eq(relax([10, 100, 200], 38), [10, 100, 200], 'labels with room stay where they are');
  const crowded = relax([100, 102, 104, 300], 38);
  ok(crowded.every((y, i) => i === 0 || y - crowded[i - 1] >= 38 - 1e-9), 'at least a pitch apart');
  ok(Math.abs(crowded.slice(0, 3).reduce((a, b) => a + b, 0) / 3 - 102) < 1e-9, 'the crowd stays centred on where it was');
  eq(crowded[3], 300, 'a far label is left alone');
  eq(relax([], 38), []);
});

test('a distance or a position reads as the document would write it', () => {
  const month = { unit: 'month' as const };
  eq(distanceText(month, 91.3125), '3 months');
  eq(distanceText({ unit: 'day' }, 28), '28 days');
  eq(distanceText({ unit: 'week' }, 14), '2 weeks');
  eq(distanceText({ unit: 'step' }, 3), '3 steps');
  eq(distanceText(month, 89), '3 months', 'a calendar quarter is not 91.3 days');
  eq(positionText(month, 182.625), 'month 6');
  eq(positionText({ unit: 'day' }, 14), 'day 14');
  eq(positionText({ unit: 'day' }, -28), '28 days before');
  eq(positionText(month, 0), 'start');
  eq(positionText({ unit: 'step' }, 3), 'step 3');
  eq(dateText('2022-01-31', 89, 'day', 'en-GB'), '30 Apr 2022');
  eq(dateText('2022-01-31', 89, 'month', 'en-GB'), 'Apr 2022');
  eq(dateText('2022-01-31', 400, 'year', 'en-GB'), '2023');
  eq(dateText('2022-01-31', 89, 'day', 'en-GB', false), '30 Apr');
});

test('the timeline puts every part inside the board, labels clear of each other and spans in lanes that do not overlap', () => {
  for (const width of [330, 438, 640]) {
    const item = lease();
    const g = timelineGeometry(item, { width, height: 600 }, timelineFonts);
    eq(g.rows.length, 7, 'the anchor, three events and three spans');
    eq(g.rows.filter((r) => r.kind === 'event').map((r) => r.part), [0, 1, 2]);
    eq(g.rows.filter((r) => r.kind === 'span').map((r) => r.part), [3, 4, 5]);
    const labels = [...g.rows].sort((a, b) => a.labelY - b.labelY);
    for (let i = 1; i < labels.length; i++) ok(labels[i].labelY - labels[i - 1].labelY >= 38 - 1e-6, `${width}: labels ${i - 1} and ${i} keep a pitch`);
    for (const row of g.rows) {
      ok(row.labelY >= 0 && row.labelY + 19 <= g.height, `${width}: ${row.name} stays inside the height`);
      ok(g.labelX + timelineFonts.label(row.name) <= g.width + 1, `${width}: ${row.name} fits the width`);
    }
    for (const t of g.ticks) ok(t.at >= g.top - 1e-6 && t.at <= g.bottom + 1e-6, `${width}: tick ${t.label} is on the axis`);
    const spans = g.rows.filter((r) => r.kind === 'span');
    for (const a of spans) for (const b of spans) if (a !== b && a.lane === b.lane) ok(a.y1 <= b.y0 + 1e-6 || b.y1 <= a.y0 + 1e-6, `${width}: spans share a lane without overlapping`);
    ok(spans.find((r) => r.name === 'Fixed term')!.lane !== spans.find((r) => r.name === 'Too early to serve')!.lane, 'overlapping spans take other lanes');
    const exit = g.rows.find((r) => r.name === 'Earliest exit')!;
    const start = g.rows.find((r) => r.kind === 'anchor')!;
    ok(exit.y > start.y, 'later is further down the axis');
    eq(exit.chip, 'month 6', 'the computed position, not the model\'s words');
  }
});

test('a dated timeline ticks and labels in dates, a step axis needs no second reading, a short board scrolls', () => {
  const dated = canonicalTimeline({
    kind: 'timeline',
    unit: 'year',
    source: 'illustrative',
    anchor: { label: 'Start', date: '2026-03-01' },
    events: [
      { label: 'Review', after: 'Start', offset: 2 },
      { label: 'End', after: 'Start', offset: 5, deadline: true },
    ],
  });
  const g = timelineGeometry(dated, { width: 400, height: 500 }, timelineFonts);
  ok(g.unitTitle === null, 'a dated board names no unit: the ticks are dates');
  ok(g.ticks.every((t) => /^\d{4}$/.test(t.label)), g.ticks.map((t) => t.label).join(','));
  ok(g.rows.find((r) => r.name === 'End')!.deadline, 'a deadline is kept');
  const steps = canonicalTimeline({ kind: 'timeline', unit: 'step', source: 'illustrative', events: [{ label: 'One', at: 1 }, { label: 'Two', at: 2 }, { label: 'Three', at: 3 }] });
  const sg = timelineGeometry(steps, { width: 400, height: 500 }, timelineFonts);
  ok(sg.rows.every((r) => r.chip === ''), 'the tick already says the step');
  ok(sg.ticks.every((t) => Number.isInteger(t.position)), 'steps are whole numbers');
  eq(sg.ticks.map((t) => t.label), ['1', '2', '3'], 'from the first step used to the last, with no zero');
  const short = timelineGeometry(lease(), { width: 330, height: 120 }, timelineFonts);
  ok(short.height > 120, 'a board too short for its labels grows and scrolls rather than overlapping');
  const [a, b] = [timelineGeometry(lease(), { width: 330, height: 700 }, timelineFonts), timelineGeometry(lease(), { width: 330, height: 700 }, timelineFonts)];
  eq(a, b, 'the layout is a pure function of the item and the room');
});

test('the timeline builds down its axis, one part after another, and reads as a sentence', () => {
  for (let i = 1; i < 7; i++) ok(timelineArrival(i) > timelineArrival(i - 1), 'rows arrive in order');
  ok(timelineDuration(7) >= timelineArrival(6) + TIMELINE_TIME.bar, 'the build ends after the last bar');
  ok(timelineDuration(7) > timelineDuration(3));
  const text = timelineDescription(lease());
  ok(text.startsWith('Earliest exit: from Lease starts; '), text);
  ok(text.includes('Earliest exit, month 6') && text.includes('period Notice runs, 3 months'), text);
});

// -------------------------------------------------------------- distribution

const bell = (): DistributionItem =>
  canonicalDistribution({
    kind: 'distribution',
    x_label: 'reaction time (ms)',
    source: 'document',
    dists: [
      { family: 'normal', label: 'Baseline', mean: 250, sd: 30 },
      { family: 'normal', label: 'After training', mean: 230, sd: 20 },
    ],
    region: { from: 300 },
  });
const calls = (): DistributionItem =>
  canonicalDistribution({
    kind: 'distribution',
    x_label: 'calls in a minute',
    source: 'document',
    dists: [
      { family: 'poisson', label: 'Before', mean: 4 },
      { family: 'poisson', label: 'After', mean: 6 },
    ],
    region: { from: 9 },
  });
const survey = (): DistributionItem =>
  canonicalDistribution({
    kind: 'distribution',
    x_label: 'option',
    source: 'document',
    dists: [
      { family: 'counts', label: 'Before', categories: ['A', 'B', 'C'], counts: [18, 54, 48] },
      { family: 'counts', label: 'After', categories: ['A', 'B', 'C'], counts: [30, 42, 48] },
    ],
  });
const distFonts = { tick: (t: string) => t.length * 6.2, title: (t: string) => t.length * 6.5 };

test('chances read as percentages with three digits, and a tail keeps its two', () => {
  eq(percentText(0.0477904), '4.78%');
  eq(percentText(0.159), '15.9%');
  eq(percentText(0.5), '50%');
  eq(percentText(0.0002326), '0.023%');
  eq(percentText(1e-8), '<0.0001%');
  eq(percentText(0.99999), '>99.9%');
  eq(percentText(0.0123), '1.23%');
  eq(quantity(1234.5), '1230');
  eq(quantity(-0.5), '−0.5');
  eq(regionText({ from: 300, probabilities: [] }), 'P(X ≥ 300)');
  eq(regionText({ to: 5, probabilities: [] }), 'P(X ≤ 5)');
  eq(regionText({ from: 5, to: 8, probabilities: [] }), 'P(5 ≤ X ≤ 8)');
});

test('the morph follows the cues: dist-1 and dist-2 choose their own state, the region keeps the current one, silence morphs past the middle', () => {
  const item = bell();
  eq([stageWanted(item, 0, 0.9), stageWanted(item, 1, 0.1)], [0, 1]);
  eq(stageWanted(item, 2, 0.9), null, 'the region does not say which state');
  eq([stageWanted(item, null, 0.2), stageWanted(item, null, 0.45), stageWanted(item, null, 1)], [0, 1, 1]);
  eq(stageWanted({ ...item, dists: [item.dists[0]] }, null, 1), 0, 'one distribution has nothing to morph to');
  eq([morphEase(0), morphEase(0.5), morphEase(1)], [0, 0.5, 1]);
  ok(morphEase(0.25) < 0.25 && morphEase(0.75) > 0.75, 'a shape settles slowly at both ends');
  ok(MORPH_MS > 600 && MORPH_MS < 2000, 'a morph is slow enough to follow');
  eq([mixInk(0), mixInk(1)], DISTRIBUTION_INK, 'the colour runs from the first ink to the second');
  ok(/^#[0-9a-f]{6}$/.test(mixInk(0.5)), mixInk(0.5));
});

test('the readouts are the shared computation at the state on show: the tail counts down and the spread narrows', () => {
  const item = bell();
  const [before, after] = item.region!.probabilities;
  ok(Math.abs(liveProbability(item, 0) - before) < 1e-5 && Math.abs(liveProbability(item, 1) - after) < 1e-5, 'both ends are the stored chances');
  const middle = liveProbability(item, 0.5);
  ok(middle < before && middle > after, 'it counts down in between');
  eq(liveSummary(item, 0.5), { mean: 240, sd: 25 });
  eq(liveSummary(item, 1), { mean: 230, sd: 20 });
  eq(liveSummary(survey(), 0.5), null, 'categories have no mean');
  eq(liveProbability(survey(), 0.5), 0);
  const single = { ...item, dists: [item.dists[0]] };
  ok(Math.abs(liveProbability(single, 1) - before) < 1e-6, 'a single distribution does not morph');
});

test('a continuous layout keeps its curve and its region between the axis and the top, from the left edge to the right', () => {
  const item = bell();
  const layout = distributionLayout(item, { width: 400, height: 300 }, distFonts);
  ok(!layout.discrete && !layout.counts);
  ok(layout.plot.left < layout.plot.right && layout.plot.top < layout.plot.bottom);
  for (const t of layout.ticks) ok(t.at >= layout.plot.left - 1e-6 && t.at <= layout.plot.right + 1e-6, `tick ${t.label}`);
  for (const state of [0, 0.5, 1]) {
    const line = curveAt(item, layout, state);
    ok(line.every(([x, y]) => x >= layout.plot.left - 0.1 && x <= layout.plot.right + 0.1 && y <= layout.plot.bottom + 0.1 && y >= layout.plot.top), `state ${state} stays inside`);
    ok(Math.min(...line.map(([, y]) => y)) >= layout.plot.top, 'the scale holds the tallest state');
  }
  const narrow = curveAt(item, layout, 1);
  const wide = curveAt(item, layout, 0);
  ok(Math.min(...narrow.map(([, y]) => y)) < Math.min(...wide.map(([, y]) => y)), 'narrowing makes the curve taller');
  eq(curveAt(item, layout, 1, 0).every(([, y]) => y === layout.plot.bottom), true, 'before it rises the curve lies on the axis');
  const region = regionPath(item, layout, 0);
  ok(region.startsWith('M') && region.endsWith('Z'));
  const xs = [...region.matchAll(/[ML](-?[\d.]+) /g)].map((m) => Number(m[1]));
  ok(Math.min(...xs) >= layout.x(300) - 0.1 && Math.max(...xs) <= layout.plot.right + 0.1, 'the region starts at its bound and runs to the end of the axis');
  eq(regionPath({ ...item, region: undefined }, layout, 0), '');
  ok(areaPath([[0, 5], [10, 2]], 20) === 'M0 20L0 5L10 2L10 20Z');
});

test('a discrete layout puts each whole number in its slot, with its bar clear of the next', () => {
  const item = calls();
  const layout = distributionLayout(item, { width: 400, height: 300 }, distFonts);
  ok(layout.discrete && !layout.counts);
  const bars = barsAt(item, layout, 1);
  ok(bars.length >= 10 && bars[0].value === 0, 'from zero');
  for (let i = 1; i < bars.length; i++) ok(bars[i].x >= bars[i - 1].x + bars[i - 1].width - 1e-6, 'bars do not overlap');
  eq(bars.filter((b) => b.inRegion).map((b) => b.value).slice(0, 2), [9, 10], 'the region is from nine up');
  ok(bars.every((b) => b.top <= layout.plot.bottom + 1e-6 && b.top >= layout.plot.top), 'inside the plot');
  ok(bars[6].chance > bars[6 + 0].chance - 1e-12);
  ok(columnPath(bars[4], layout.plot.bottom).startsWith('M'));
  eq(columnPath({ ...bars[4], top: layout.plot.bottom }, layout.plot.bottom), '', 'a bar without height is not drawn');
  const [first, second] = [barsAt(item, layout, 0), barsAt(item, layout, 1)];
  ok(second[6].chance > first[6].chance && second[2].chance < first[2].chance, 'the mass moves right');
});

test('counts are categories under their bars, and a distribution reads as a sentence', () => {
  const item = survey();
  const layout = distributionLayout(item, { width: 400, height: 300 }, distFonts);
  ok(layout.counts && layout.discrete);
  eq(layout.categories.map((c) => c.lines.join(' ')), ['A', 'B', 'C']);
  eq(layout.ticks.length, 0, 'the categories take the place of ticks');
  const bars = barsAt(item, layout, 0);
  eq(bars.map((b) => Math.round(b.chance * 100)), [15, 45, 40]);
  ok(Math.abs(bars.reduce((sum, b) => sum + b.chance, 0) - 1) < 1e-9, 'shares add up to one');
  eq(distributionDescription(bell()), 'reaction time (ms), Baseline to After training; P(X ≥ 300) is 4.78% then 0.023%'.replace(/^/, 'Distribution: '));
});

test('the distribution builds the first shape, then the region, and takes longer with one', () => {
  const item = bell();
  ok(distributionDuration(item) > regionStart(), 'the build ends after the region starts');
  ok(distributionDuration(item) > distributionDuration({ ...item, region: undefined }) - 1, 'a region is part of the build');
});

// --------------------------------------------------------------------- plot

const plotFonts = { tick: (t: string) => t.length * 6.2, label: (t: string) => t.length * 7, coords: (t: string) => t.length * 6.4 };
const costPlot = (change: Partial<PlotItem> = {}): PlotItem => ({
  kind: 'plot',
  title: 'Steps against requests',
  x: [1, 30],
  y: [0, 600],
  curves: [
    { expression: 'x^2', label: 'n^2' },
    { expression: '10*x', label: '10n' },
  ],
  marks: [
    { type: 'crossing', curve: 1, other: 2, label: 'break-even' },
    { type: 'value', curve: 1, at: 20 },
  ],
  points: [{ x: 5, y: 25 }, { x: 20, y: 400, label: 'run 3' }],
  ...change,
});

test('the plot puts the marks the code found on their curves, with labels inside the plot and clear of each other', () => {
  for (const width of [330, 438, 640]) {
    const item = costPlot();
    const g = plotGeometry(item, { width, height: 400 }, 1, plotFonts);
    eq(g.paths.length, 2);
    eq(g.marks.map((m) => [m.mark.index, m.mark.type]), [[0, 'crossing'], [1, 'value']]);
    const [cross, value] = g.marks;
    ok(Math.abs(cross.x - g.x(10)) < 0.2 && Math.abs(cross.y - g.y(100)) < 0.2, 'the crossing is at (10, 100)');
    ok(Math.abs(value.x - g.x(20)) < 0.2 && Math.abs(value.y - g.y(400)) < 0.2, 'the value is at (20, 400)');
    eq(cross.coords, '(10, 100)');
    eq(value.name, 'value', 'a mark without a label is named by what it is');
    for (const m of g.marks) {
      ok(m.rect.left >= g.plot.left && m.rect.right <= g.plot.right + 4 && m.rect.top >= g.plot.top - 4 && m.rect.bottom <= g.plot.bottom, `${width}: ${m.name} stays inside the plot`);
      ok(!(m.x > m.rect.left - 6 && m.x < m.rect.right + 6 && m.y > m.rect.top - 6 && m.y < m.rect.bottom + 6), `${width}: ${m.name} does not sit on its own dot`);
    }
    ok(!rectsOverlap(cross.rect, value.rect, 0), `${width}: labels clear of each other`);
    eq(g.points.length, 2);
    ok(g.points.every((p) => p.x >= g.plot.left && p.x <= g.plot.right && p.y >= g.plot.top && p.y <= g.plot.bottom), 'points inside');
    ok(g.xTicks.every((t) => t.at >= g.plot.left - 1e-6 && t.at <= g.plot.right + 1e-6), 'ticks inside the range');
  }
});

test('a log axis ticks on decades, a linear one that spans zero draws its zero line, and a plot with no marks keeps its probe', () => {
  const loglog = costPlot({ x: [1, 1000], y: [0.5, 20000], curves: [{ expression: '0.5*x^1.5', label: 't' }], marks: [{ type: 'value', curve: 1, at: 100 }], points: undefined, x_scale: 'log', y_scale: 'log' });
  const g = plotGeometry(loglog, { width: 438, height: 400 }, 1, plotFonts);
  eq(g.xTicks.map((t) => t.label), ['1', '10', '100', '1k']);
  ok(g.xTicks.every((t, i) => i === 0 || Math.abs((t.at - g.xTicks[i - 1].at) - (g.xTicks[1].at - g.xTicks[0].at)) < 0.5), 'decades are evenly spaced');
  eq(g.zero, { x: null, y: null }, 'a log axis has no zero');
  const parabola: PlotItem = { kind: 'plot', x: [-1, 5], y: [-2, 8], curves: [{ expression: 'x^2-4*x+3', label: 'e' }], marks: [{ type: 'root', curve: 1 }] };
  const p = plotGeometry(parabola, { width: 438, height: 400 }, 1, plotFonts);
  ok(p.zero.y !== null && Math.abs(p.zero.y - p.y(0)) < 1e-9 && p.zero.x !== null, 'zero lines');
  eq(p.marks.length, 1);
  const bare = plotGeometry({ ...parabola, marks: undefined }, { width: 438, height: 400 }, 1, plotFonts);
  eq(bare.marks, []);
});

test('a log axis over powers of ten of a plot is labelled like the scatter\'s', () => {
  const scaling: PlotItem = {
    kind: 'plot',
    x: [1e18, 1e24],
    y: [1, 100],
    x_scale: 'log',
    curves: [{ expression: '100/(x/10^18)^0.2', label: 'loss' }],
  };
  const g = plotGeometry(scaling, { width: 438, height: 400 }, 1, plotFonts);
  ok(g.xTicks.length >= 2 && g.xTicks.every((t) => /^10[¹²][⁰¹²³⁴⁵⁶⁷⁸⁹]$/.test(t.label)), g.xTicks.map((t) => t.label).join(' '));
  ok(g.xTicks.every((t) => t.at >= g.plot.left - 1e-6 && t.at <= g.plot.right + 1e-6), 'ticks inside the range');
});

test('a sweep moves the marks with the parameter, and one that has gone is not drawn', () => {
  const sweep: PlotItem = { kind: 'plot', x: [0, 5], y: [-5, 5], curves: [{ expression: 'x - a', label: 'x-a' }], parameter: { from: 1, to: 3 }, marks: [{ type: 'root', curve: 1 }] };
  const at = (a: number) => plotGeometry(sweep, { width: 400, height: 300 }, a, plotFonts);
  ok(Math.abs(at(1).marks[0].x - at(1).x(1)) < 0.2 && Math.abs(at(3).marks[0].x - at(3).x(3)) < 0.2);
  eq(at(9).marks, [], 'past the sweep the root leaves the range');
});

test('the plot builds its curves, then its points, then its marks, and describes itself', () => {
  const item = costPlot();
  ok(pointStart(item, 0) > PLOT_TIME.axes && markStart(item, 0) > pointStart(item, 1), 'curves, points, marks');
  ok(markStart(item, 1) > markStart(item, 0));
  ok(plotDuration(item) >= markStart(item, 1) + PLOT_TIME.mark, 'the build ends after the last mark');
  ok(plotDuration({ ...item, marks: undefined, points: undefined }) < plotDuration(item));
  const text = plotDescription(item, 1);
  ok(text.includes('break-even at x 10, y 100') && text.includes('measured points') && text.includes('run 3 (20, 400)'), text);
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} visuals tests passed`);
