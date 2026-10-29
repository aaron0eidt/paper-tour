// Scatter and shapes board tests: nice axes, label placement, the better mark and build timelines; dimension lengths,
// the plan (contractions and results), layout in one row and wrapped, and timelines. Run with `npm test` (esbuild
// bundles this file for Node, no test framework needed).

import katex from 'katex';
import type { ScatterItem } from '../../shared/scatter';
import type { ShapesItem } from '../../shared/shapes';
import type { ScreenRect } from '../src/camera';
import { rectsOverlap } from '../src/labelLayout';
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
function ok(condition: boolean, what: string) {
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

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} visuals tests passed`);
