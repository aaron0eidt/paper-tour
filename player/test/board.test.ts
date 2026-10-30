// Board tests: item checks, flow layout and geometry, term wrapping, bars and easing. Run with
// `npm test` (esbuild bundles this file for Node, no test framework needed).

import katex from 'katex';
import {
  BOARD_INK,
  BOARD_PALETTE,
  barClip,
  barFrameSource,
  boardFrameColors,
  continuousBoardFrame,
  interpolateBars,
  plotCursor,
  sourceTag,
  barPath,
  barsLayout,
  barStandsOut,
  barsUnit,
  checkBoardItem,
  cubicBezier,
  decimalsOf,
  fitText,
  flowGeometry,
  flowLayout,
  formatValue,
  termColor,
  wrapLabel,
  wrapTerms,
} from '../src/board';
import type { BarsItem, FlowItem } from '../src/board';
import {
  HEATMAP_TIMING,
  cellLook,
  contrast,
  gridLayout,
  heatmapDomain,
  heatmapAlt,
  heatmapEnd,
  heatmapInk,
  heatmapLegend,
  heatmapLevel,
  heatmapModel,
  heatmapPlaces,
  heatmapRamp,
  heatmapRgb,
  heatmapText,
  labelBlock,
  linkLook,
  linksLayout,
  luminance,
  morphProgress,
  rowMorph,
  rowShown,
} from '../src/heatmap';
import type { HeatmapItem } from '../../shared/heatmap';
import type { BoardItem } from '../src/types';
import type { SceneItem } from '../../shared/scene';
import { sceneMatrixText } from '../../shared/scene';
import { interpolateScene, projectSceneObject, sceneArrow, sceneInk, sceneNumber, sceneObjects, sceneTransitionAllowed } from '../src/sceneBoard';

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

const warnings: string[] = [];
const warn = (message: string) => void warnings.push(message);
// About 7px a character, like a 13px label.
const measure = (text: string) => text.length * 7;
// The parse check the board uses, with KaTeX itself.
const parses = (latex: string) => {
  try {
    katex.renderToString(latex, {
      displayMode: true,
      throwOnError: true,
      strict: 'ignore',
      trust: (context) => context.command === '\\htmlClass',
    });
    return true;
  } catch {
    return false;
  }
};
const chain = (n: number): FlowItem => ({
  kind: 'flow',
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Step ${i}` })),
  edges: Array.from({ length: n - 1 }, (_, i): [string, string] => [`n${i}`, `n${i + 1}`]),
});
const bleu: BarsItem = {
  kind: 'bars',
  unit: 'BLEU',
  higher_is_better: true,
  bars: [
    { label: 'Transformer (big)', value: 28.4 },
    { label: 'Transformer (base)', value: 27.3 },
    { label: 'ConvS2S', value: 25.16 },
  ],
};

// ------------------------------------------------------------------- checks

test('a formula keeps the terms that are part of it, with valid colours only', () => {
  const item = checkBoardItem(
    {
      kind: 'formula',
      title: 'Sum',
      latex: 'a + b',
      terms: [
        { latex: 'a', label: 'first', color: 'blue' },
        { latex: 'c', label: 'not in the formula' },
        { latex: 'b', label: 'second', color: 'purple' },
        'junk',
      ],
    },
    'step "s"',
    warn,
  );
  eq(item, {
    kind: 'formula',
    title: 'Sum',
    latex: 'a + b',
    terms: [
      { latex: 'a', label: 'first', color: 'blue' },
      { latex: 'b', label: 'second' },
    ],
  });
});

test('items that cannot be drawn are skipped with a warning', () => {
  warnings.length = 0;
  eq(checkBoardItem({ kind: 'formula', latex: '  ', terms: [] }, 'step "s"', warn), null, 'empty formula');
  eq(checkBoardItem({ kind: 'flow', nodes: [{ id: 'a', label: 'A' }], edges: [] }, 'step "s"', warn), null, 'one box');
  const oneBar = { kind: 'bars', bars: [{ label: 'x', value: 1 }, { label: 'y', value: Number.NaN }] };
  eq(checkBoardItem(oneBar, 'step "s"', warn), null, 'one number');
  eq(checkBoardItem({ kind: 'video' }, 'step "s"', warn), null, 'unknown kind');
  eq(checkBoardItem(null, 'step "s"', warn), null, 'missing');
  eq(warnings.length, 5, 'warnings');
  ok(warnings[3].includes('"video"') && warnings[3].includes('step "s"'), 'names the kind and the step');
});

test('a flow drops boxes without labels, edges to unknown boxes and self-loops', () => {
  const item = checkBoardItem(
    {
      kind: 'flow',
      nodes: [{ id: 'a', label: 'A', color: 'green' }, { id: 'b', label: 'B' }, { id: 'c', label: ' ' }],
      edges: [['a', 'b'], ['a', 'a'], ['b', 'c'], ['a'], 'x'],
    },
    'here',
    warn,
  );
  eq(item, { kind: 'flow', nodes: [{ id: 'a', label: 'A', color: 'green' }, { id: 'b', label: 'B' }], edges: [['a', 'b']] });
});

test('bars keep their unit and direction and drop values that are not numbers', () => {
  const item = checkBoardItem(
    { kind: 'bars', unit: '%', higher_is_better: false, bars: [{ label: 'a', value: 2 }, { label: 'b', value: '3' }, { label: 'c', value: 1 }] },
    'here',
    warn,
  );
  eq(item, { kind: 'bars', unit: '%', higher_is_better: false, bars: [{ label: 'a', value: 2 }, { label: 'c', value: 1 }] });
});

test('term colours: their own, else the palette in order, cycling past its end', () => {
  eq(termColor({ latex: 'x', label: 'x', color: 'pink' }, 0), 'pink');
  eq([0, 1, 5].map((i) => termColor({ latex: 'x', label: 'x' }, i)), ['blue', 'orange', 'blue']);
  eq(BOARD_PALETTE.every((c) => /^#[0-9a-f]{6}$/.test(BOARD_INK[c])), true, 'an ink for every colour');
});

// ------------------------------------------------------------------- flows

test('flow columns: one right of the furthest predecessor, rows in listed order', () => {
  eq(flowLayout(chain(3)), [[0, 0], [1, 0], [2, 0]], 'chain');
  const branch: FlowItem = { kind: 'flow', nodes: chain(3).nodes, edges: [['n0', 'n1'], ['n0', 'n2']] };
  eq(flowLayout(branch), [[0, 0], [1, 0], [1, 1]], 'branch');
  const cycle: FlowItem = { kind: 'flow', nodes: chain(2).nodes, edges: [['n0', 'n1'], ['n1', 'n0']] };
  eq(flowLayout(cycle), [[0, 0], [1, 0]], 'the cycle is cut');
});

test('a flow runs down a tall board and across a wide one', () => {
  const tall = flowGeometry(chain(6), { width: 380, height: 700 }, measure);
  eq([tall.vertical, tall.scale], [true, 1], 'tall');
  ok(tall.nodes.every((n, i) => i === 0 || (n.y > tall.nodes[i - 1].y && n.x === tall.nodes[0].x)), 'stacked');
  const wide = flowGeometry(chain(4), { width: 900, height: 220 }, measure);
  eq([wide.vertical, wide.scale], [false, 1], 'wide');
  ok(wide.nodes.every((n, i) => i === 0 || n.x > wide.nodes[i - 1].x), 'in a row');
  for (const g of [tall, wide]) {
    ok(g.nodes.every((n) => n.x >= 0 && n.y >= 0 && n.x + n.w <= g.width && n.y + n.h <= g.height), 'inside');
    ok(g.edges.length === g.nodes.length - 1 && g.edges.every((e) => e.d.startsWith('M') && e.head.includes('L')), 'edges');
  }
});

test('a flow that does not fit is scaled down, never up, and never below readable', () => {
  // A fork, which cannot wind into rows like a chain.
  const fork: FlowItem = { kind: 'flow', nodes: chain(4).nodes, edges: [['n0', 'n1'], ['n1', 'n2'], ['n1', 'n3']] };
  const g = flowGeometry(fork, { width: 200, height: 160 }, measure);
  ok(g.scale < 1 && g.scale >= 0.8, `scale ${g.scale}`);
  ok(g.width * g.scale <= 200.01 && g.height * g.scale <= 160.01, 'fits');
  eq(flowGeometry(chain(10), { width: 200, height: 200 }, measure).scale, 0.8, 'scrolls instead');
  eq(flowGeometry(chain(2), { width: 1000, height: 1000 }, measure).scale, 1, 'never up');
});

test('a chain too long for a short, wide board winds into rows instead of shrinking', () => {
  const g = flowGeometry(chain(6), { width: 390, height: 200 }, measure);
  eq(g.scale, 1, 'no shrinking');
  const rows = [...new Set(g.nodes.map((n) => n.y))];
  eq(rows.length, 2, 'two rows');
  const [top, bottom] = [g.nodes.slice(0, 3), g.nodes.slice(3)];
  ok(top.every((n, i) => i === 0 || n.x > top[i - 1].x), 'the first row runs left to right');
  ok(bottom.every((n, i) => i === 0 || n.x < bottom[i - 1].x), 'the second runs back');
  eq(bottom[0].x, top[2].x, 'the turn goes straight down');
  ok(g.nodes.every((n) => n.x >= 0 && n.y >= 0 && n.x + n.w <= g.width && n.y + n.h <= g.height), 'inside');
  ok(g.width <= 390 && g.height <= 200, 'fits');
  // Its arrows: along the first row, down at the turn, and back along the second.
  const heads = g.edges.map((e) => e.head.match(/-?\d+(\.\d+)?/g)!.map(Number));
  const dir = (h: number[]) => (h[2] > h[0] && h[2] > h[4] ? 'right' : h[2] < h[0] && h[2] < h[4] ? 'left' : 'down');
  eq(heads.map(dir), ['right', 'right', 'down', 'left', 'left']);
  // A board that fits the chain either way keeps it straight, and so does a branching flow.
  eq(flowGeometry(chain(6), { width: 380, height: 700 }, measure).nodes.every((n, _, all) => n.x === all[0].x), true);
  const edges = [['n0', 'n1'], ['n0', 'n2'], ['n1', 'n3'], ['n3', 'n4'], ['n4', 'n5']] as [string, string][];
  const branch: FlowItem = { kind: 'flow', nodes: chain(6).nodes, edges };
  ok(new Set(flowGeometry(branch, { width: 390, height: 200 }, measure).nodes.map((n) => n.y)).size !== 2, 'not wound');
});

test('a back edge loops beside the boxes instead of through them', () => {
  const item: FlowItem = { kind: 'flow', nodes: chain(3).nodes, edges: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n0']] };
  const g = flowGeometry(item, { width: 380, height: 600 }, measure);
  const back = g.edges[2];
  const xs = back.d.match(/-?\d+(\.\d+)?/g)!.map(Number).filter((_, i) => i % 2 === 0);
  ok(Math.max(...xs) > g.nodes[0].x + g.nodes[0].w + 10, 'loops to the right');
  ok(Math.max(...xs) <= g.width, 'within the drawing');
});

/** Points along a path of M, C and L commands. */
function trace(d: string): [number, number][] {
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const pts: [number, number][] = [];
  let [x, y] = [n[0], n[1]];
  let i = 2;
  for (const c of d.replace(/[^MCL]/g, '').slice(1)) {
    if (c === 'L') {
      pts.push([(x = n[i]), (y = n[i + 1])]);
      i += 2;
      continue;
    }
    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      const u = 1 - t;
      const b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      const at = (p0: number, k: number) => b[0] * p0 + b[1] * n[i + k] + b[2] * n[i + k + 2] + b[3] * n[i + k + 4];
      pts.push([at(x, 0), at(y, 1)]);
    }
    [x, y] = [n[i + 4], n[i + 5]];
    i += 6;
  }
  return pts;
}

test('a loop back passes outside every box on its way, also in a wider rank', () => {
  // A training loop: the model feeds the loss and the predictions side by side, and the
  // gradients loop back to the model past both.
  const item: FlowItem = {
    kind: 'flow',
    nodes: ['data', 'model', 'loss', 'grad', 'pred'].map((id) => ({ id, label: id })),
    edges: [['data', 'model'], ['model', 'loss'], ['loss', 'grad'], ['grad', 'model'], ['model', 'pred']],
  };
  for (const box of [{ width: 380, height: 640 }, { width: 900, height: 240 }]) {
    const g = flowGeometry(item, box, measure);
    const back = trace(g.edges[3].d).slice(3, -3); // its middle, clear of the ends at its boxes
    const hits = g.nodes.filter((n) => back.some(([x, y]) => x > n.x && x < n.x + n.w && y > n.y && y < n.y + n.h));
    eq(hits.length, 0, `${g.vertical ? 'down' : 'across'}: boxes crossed`);
    ok(back.every(([x, y]) => x <= g.width && y <= g.height), 'within the drawing');
  }
  // Listed against the flow, two boxes share a rank: the arrow goes straight across.
  const twin: FlowItem = { kind: 'flow', nodes: chain(2).nodes, edges: [['n1', 'n0']] };
  const g = flowGeometry(twin, { width: 380, height: 640 }, measure);
  ok(/^M[\d. ]+L[\d. ]+$/.test(g.edges[0].d), `straight: ${g.edges[0].d}`);
});

test('labels wrap by words and end in an ellipsis when they run out of lines', () => {
  eq(wrapLabel('Linear + softmax', 200, measure), ['Linear + softmax']);
  eq(wrapLabel('Multi-head attention block', 100, measure), ['Multi-head', 'attention', 'block']);
  const long = wrapLabel('one two three four five six seven', 40, measure, 2);
  eq(long.length, 2, 'two lines');
  ok(long[1].endsWith('…') && measure(long[1]) <= 40, `ellipsis: ${long[1]}`);
  // A cut label keeps as much as fits with its ellipsis: 'Transform…' is exactly 70px here.
  eq([fitText('ByteNet', 100, measure), fitText('Transformer (big)', 70, measure)], ['ByteNet', 'Transform…']);
  eq(fitText('Transformer (big)', 69, measure), 'Transfor…', 'one pixel less, one letter less');
});

// ----------------------------------------------------------------- formulas

const wrap = (latex: string, ...terms: string[]) =>
  wrapTerms(
    latex,
    terms.map((t) => ({ latex: t, label: t })),
    parses,
  );
const cls = (i: number, body: string) => `\\htmlClass{pt-term pt-term-${i}}{${body}}`;

test('each term wraps its first occurrence, and the result renders', () => {
  const out = wrap('\\frac{QK^{T}}{\\sqrt{d_k}}', 'QK^{T}', '\\sqrt{d_k}');
  eq(out.latex, `\\frac{${cls(0, 'QK^{T}')}}{${cls(1, '\\sqrt{d_k}')}}`);
  eq(out.placed, [true, true]);
  ok(parses(out.latex), 'renders');
});

test('a term takes a free occurrence before one inside an earlier term', () => {
  const out = wrap('f(Q, K, V) = g(Q)V', 'Q, K, V', 'V');
  eq(out.latex, `f(${cls(0, 'Q, K, V')}) = g(Q)${cls(1, 'V')}`);
});

test('a term nests inside an earlier one when it has no free occurrence', () => {
  const out = wrap('\\sqrt{d_k}', '\\sqrt{d_k}', 'd_k');
  eq(out.latex, cls(0, `\\sqrt{${cls(1, 'd_k')}}`));
  ok(parses(out.latex), 'renders');
});

test('occurrences inside a command name are not terms', () => {
  eq(wrap('\\alpha + a', 'a').latex, `\\alpha + ${cls(0, 'a')}`);
  eq(wrap('\\alpha', 'a').placed, [false], 'no occurrence between tokens');
});

test('a wrap that crosses a term or breaks the formula is left out', () => {
  eq(wrap('abc', 'ab', 'bc').placed, [true, false], 'crossing');
  const split = wrap('\\left(x\\right)', '\\left(x');
  eq([split.latex, split.placed], ['\\left(x\\right)', [false]], 'unbalanced');
});

// --------------------------------------------------------------------- bars

// A tour shows a few chosen rows: marking the largest as the best can contradict the document (a stronger row left out).
test('size never singles a bar out; the bar the narration is on does', () => {
  eq(bleu.bars.map((_, i) => barStandsOut(null, i)), [true, true, true], 'alike before any focus, largest included');
  eq(bleu.bars.map((_, i) => barStandsOut(2, i)), [false, false, true], 'the focused bar, though the smallest');
});

test('the unit chip says which way is better, in the notation papers use', () => {
  eq(barsUnit(bleu), { text: 'BLEU ↑', label: 'BLEU, higher is better' });
  eq(barsUnit({ ...bleu, unit: 'PPL', higher_is_better: false }), { text: 'PPL ↓', label: 'PPL, lower is better' });
  eq(barsUnit({ ...bleu, higher_is_better: undefined }), { text: 'BLEU', label: 'BLEU' }, 'no direction, no arrow');
  eq(barsUnit({ ...bleu, unit: '%' }), { text: '% ↑', label: '%, higher is better' }, 'percent beside its arrow');
  eq(barsUnit({ ...bleu, unit: '%', higher_is_better: undefined }), null, 'percent alone is on every value already');
  eq(barsUnit({ ...bleu, unit: undefined }), { text: 'higher is better', label: 'higher is better' }, 'no unit');
  eq(barsUnit({ ...bleu, unit: undefined, higher_is_better: undefined }), null, 'nothing to say');
});

test('values print with the places they were reported with', () => {
  eq([28.4, 25.16, 24, 1.234567, 1e-7].map(decimalsOf), [1, 2, 0, 4, 4]);
  eq(formatValue(25.16, 2), '25.16');
  eq(formatValue(1234.5, 1), '1,234.5');
  eq(formatValue(-0, 1), '0.0', 'no negative zero');
  eq(formatValue(-0.0001, 1), '-1e-4', 'tiny nonzero values remain visible');
  eq(formatValue(1.23456e-7, 4), '1.23e-7', 'scientific labels keep useful precision');
  eq([0.7310585786, 0.2689414214].map(value => formatValue(value, decimalsOf(value))), ['0.731', '0.269'], 'calculated examples do not expose long floating point tails');
  eq(formatValue(0.1234, decimalsOf(0.1234)), '0.1234', 'short reported paper precision is retained');
  eq(formatValue(12.5, 1, '%'), '12.5%');
  eq(formatValue(12.5, 1, 'BLEU'), '12.5', 'other units are shown once, not per value');
  eq(formatValue(2.3e19, decimalsOf(2.3e19)), '2.3×10¹⁹', 'a count of operations is a power of ten, not twenty digits');
  eq(formatValue(-4e15, 0), '-4×10¹⁵');
  eq(formatValue(123456789012, 0), '123,456,789,012', 'billions keep their digits');
  eq(formatValue(1.2345e20, decimalsOf(1.2345e20)), '1.2345×10²⁰', 'a power of ten keeps the digits it was reported with');
  eq(formatValue(2e19, decimalsOf(2e19)), '2×10¹⁹');
  eq(formatValue(9.6e18, decimalsOf(9.6e18)), '9.6×10¹⁸');
  eq(formatValue(1.23456e21, decimalsOf(1.23456e21)), '1.2346×10²¹', 'at most 4 places, as a decimal prints');
  eq(formatValue(1.23456789e21, decimalsOf(1.23456789e21)), '1.235×10²¹', 'a long tail needs only 3');
  eq(formatValue(9.99996e20, decimalsOf(9.99996e20)), '1.0000×10²¹', 'a mantissa that rounds up to 10 moves the exponent');
  eq(formatValue(9.99999e19, 0, undefined, 9.99999e19), '1.0000×10²⁰');
  eq(formatValue(9.99996e20 * 0.5, 0, undefined, 9.99996e20), '0.5000×10²¹', 'and so does every step on the way there');
});

test('a count up to a power of ten keeps that form all the way, counting its mantissa', () => {
  const shown = [0.01, 0.1, 0.4, 0.7, 1].map((progress) => formatValue(2.3e19 * progress, 0, undefined, 2.3e19));
  eq(shown, ['0', '0.2×10¹⁹', '0.9×10¹⁹', '1.6×10¹⁹', '2.3×10¹⁹']);
  eq(formatValue(0, 0, undefined, 2.3e19), '0', 'nothing yet is 0');
  eq(formatValue(-2.3e19 * 0.4, 0, undefined, -2.3e19), '-0.9×10¹⁹');
  eq(formatValue(5e14 * 0.5, 0, undefined, 5e14), '250,000,000,000,000', 'under a thousand trillion it counts in digits');
});

test('bars share a zero line; labels go above them on a narrow board', () => {
  const labels = bleu.bars.map((b) => measure(b.label));
  const values = [40, 32, 36];
  const narrow = barsLayout(bleu, 340, labels, values);
  const wide = barsLayout(bleu, 800, labels, values);
  eq([narrow.labelsAbove, wide.labelsAbove], [true, false]);
  for (const l of [narrow, wide]) {
    ok(l.rows.every((r) => r.x0 === l.zeroX && r.x1 > r.x0), 'from the zero line');
    const spare = l.width - (l.rows[0].x1 + 8 + values[0]);
    ok(spare >= 1 && spare <= 3, `the longest bar leaves room for its value, and a little more (${spare})`);
    ok(l.rows[1].x1 < l.rows[0].x1 && l.rows[2].x1 < l.rows[1].x1, 'ordered by value');
  }
});

test('a bar has a rounded tip away from zero and a square base on it', () => {
  eq(barPath(0, 100, 10, true), 'M0 10H96A4 4 0 0 1 100 14V18A4 4 0 0 1 96 22H0Z', 'tip on the right');
  eq(barPath(20, 100, 10, false), 'M100 10H24A4 4 0 0 0 20 14V18A4 4 0 0 0 24 22H100Z', 'tip on the left');
  ok(barPath(0, 3, 0, true).includes('A1.5 1.5'), 'a short bar rounds less');
  eq(barPath(5, 5, 0, true), '', 'no length, no bar');
  eq(barClip(0.25, true), 'inset(0 75.00% 0 0 round 0 4px 4px 0)');
  eq(barClip(2, false), 'inset(0 0 0 0.00% round 4px 0 0 4px)', 'clamped');
});

test('on a short board the rows close up, but never tighter than they can be read', () => {
  const labels = bleu.bars.map((b) => measure(b.label));
  const values = [40, 32, 36];
  for (const width of [340, 800]) {
    const roomy = barsLayout(bleu, width, labels, values);
    const short = barsLayout(bleu, width, labels, values, roomy.height - 12);
    const tiny = barsLayout(bleu, width, labels, values, 40);
    ok(short.height <= roomy.height - 12 + 0.01, `${width}: fits the shorter board (${short.height})`);
    const pitch = (l: typeof roomy) => l.rows[1].y - l.rows[0].y;
    ok(pitch(tiny) >= (roomy.labelsAbove ? 40 : 26) && pitch(tiny) < pitch(short), `${width}: a floor on the pitch`);
    eq(barsLayout(bleu, width, labels, values, 2000).height, roomy.height, `${width}: never looser than roomy`);
  }
});

test('negative bars grow left of zero with their values before the tip', () => {
  const item: BarsItem = { kind: 'bars', bars: [{ label: 'gain', value: 2 }, { label: 'loss', value: -1 }] };
  const l = barsLayout(item, 600, [30, 30], [20, 24]);
  const [gain, loss] = l.rows;
  eq([gain.x0, loss.x1], [l.zeroX, l.zeroX], 'both start at zero');
  eq([loss.valueAnchor, gain.valueAnchor], ['end', 'start']);
  ok(loss.x0 < l.zeroX && loss.valueX < loss.x0, 'left of zero');
});

test('only forward frames of the same quantities and units morph their values', () => {
  const previous = { key: '3:1', item: bleu };
  const next: BarsItem = { ...bleu, bars: bleu.bars.map(bar => ({ ...bar, value: bar.value / 2 })) };
  eq(barFrameSource(previous, { key: '3:5', item: next }), bleu, 'same spoken step preserves the numerical source');
  eq(barFrameSource(previous, { key: '4:1', item: next }), null, 'another step starts independently');
  eq(barFrameSource(previous, { key: '3:0', item: next }), null, 'backward seek does not interpolate from a future value');
  eq(barFrameSource(previous, { key: '3:5', item: { ...next, unit: 'probability' } }), null, 'different units never share a scale');
  eq(barFrameSource({ ...previous, item: { ...bleu, unit: undefined } }, { key: '3:5', item: { ...next, unit: undefined } }), null, 'missing units cannot establish equivalent quantities');
  eq(barFrameSource(previous, { key: '3:5', item: { ...next, bars: [...next.bars].reverse() } }), null, 'different quantity order is not silently reinterpreted');
});

test('worked formula and flow frames retain semantic objects without replaying the whole board', () => {
  const formula: BoardItem = { kind: 'formula', latex: 'x + 1 = y', terms: [{ latex: 'x', label: 'Input' }, { latex: 'y', label: 'Output' }] };
  const numeric: BoardItem = { kind: 'formula', latex: '2 + 1 = 3', terms: [{ latex: '3', label: 'Output' }, { latex: '2', label: 'Input' }] };
  const previous = { key: '2:0', item: formula }, next = { key: '2:4', item: numeric };
  ok(continuousBoardFrame(previous, next), 'substitution continues the same explanation');
  const colored = boardFrameColors(previous, next);
  ok(colored.kind === 'formula', 'still a formula');
  if (colored.kind === 'formula') eq(colored.terms.map(term => term.color), ['orange', 'blue'], 'the role keeps its colour after term reordering');
  eq(numeric.terms.map(term => term.color), [undefined, undefined], 'authored input is not mutated');
  const explicit = boardFrameColors(previous, { ...next, item: { ...numeric, terms: [{ latex: '3', label: 'Output', color: 'green' }] } });
  if (explicit.kind === 'formula') eq(explicit.terms[0].color, 'green', 'authored colour remains authoritative');
  eq(continuousBoardFrame(next, previous), false, 'backward seek is not an object transformation');
  eq(continuousBoardFrame(previous, { ...next, key: '3:0' }), false, 'new step does not inherit presentation state');
  const flow: FlowItem = { kind: 'flow', nodes: [{ id: 'input', label: 'Input x', color: 'blue' }, { id: 'output', label: 'Result', color: 'green' }], edges: [['input', 'output']] };
  const updated: FlowItem = { ...flow, nodes: [{ id: 'input', label: 'Input 2' }, { id: 'output', label: 'Result 3' }] };
  ok(continuousBoardFrame({ ...previous, item: flow }, { ...next, item: updated }), 'stable process IDs update in place');
  const flowColors = boardFrameColors({ ...previous, item: flow }, { ...next, item: updated });
  if (flowColors.kind === 'flow') eq(flowColors.nodes.map(node => node.color), ['blue', 'green']);
  eq(continuousBoardFrame({ ...previous, item: flow }, { ...next, item: { ...updated, edges: [['output', 'input']] } }), false, 'changed process order is a different diagram');
});

test('numerical frames interpolate from the previous value, including negative values', () => {
  const from: BarsItem = { kind: 'bars', unit: 'units', bars: [{ label: 'A', value: 10 }, { label: 'B', value: -2 }] };
  const to: BarsItem = { ...from, bars: [{ label: 'A', value: 4 }, { label: 'B', value: 2 }] };
  eq(interpolateBars(from, to, 0).bars.map(bar => bar.value), [10, -2], 'never restart from zero');
  eq(interpolateBars(from, to, 0.5).bars.map(bar => bar.value), [7, 0], 'intermediate state is an actual numerical interpolation');
  eq(interpolateBars(from, to, 1).bars.map(bar => bar.value), [4, 2], 'final authored values remain exact');
  const domain = [-2, 10, 4, 2];
  const before = barsLayout(from, 600, [20, 20], [40, 40], 200, domain);
  const after = barsLayout(to, 600, [20, 20], [40, 40], 200, domain);
  eq(before.zeroX, after.zeroX, 'axis does not jump as values cross zero');
  ok(Math.abs((after.rows[0].x1 - after.zeroX) / (before.rows[0].x1 - before.zeroX) - 0.4) < 0.001, '4 remains forty percent of10 on the shared scale');
});

test('plot cursor follows narrated progress and changes only one independent variable', () => {
  const item = { kind: 'plot' as const, x: [-2, 6] as [number, number], y: [0, 36] as [number, number], curves: [{ expression: 'x*x', label: 'Output' }] };
  eq([0, 0.5, 1].map(progress => plotCursor(item, progress)), [{ x: -2, a: 1 }, { x: 2, a: 1 }, { x: 6, a: 1 }]);
  const parameter = { ...item, parameter: { from: 1, to: 5 } };
  eq([0, 0.5, 1].map(progress => plotCursor(parameter, progress)), [{ x: 2, a: 1 }, { x: 2, a: 3 }, { x: 2, a: 5 }], 'parameter sweep holds the input fixed');
  eq(plotCursor(item, -2), plotCursor(item, 0), 'clamped start');
  eq(plotCursor(item, 4), plotCursor(item, 1), 'clamped end');
});

test('native scene objects keep identity, coordinates, and actual numeric values between states', () => {
  const start: SceneItem = { kind: 'scene', objects: [
    { id: 'matrix', type: 'matrix', x: .1, y: .2, w: .2, h: .3, color: 'blue', values: [[1, 2], [3, 4]] },
    { id: 'vector', type: 'vector', x: .5, y: .5, w: .2, h: -.2, color: 'orange' },
  ] };
  const end: SceneItem = { kind: 'scene', objects: [
    { ...start.objects[1], w: -.2, h: .3 },
    { ...start.objects[0], x: .5, values: [[3, 6], [7, 8]] },
  ] };
  const before = JSON.stringify(start);
  const middle = interpolateScene(sceneObjects(start), end, .5);
  eq(middle.find(object => object.id === 'matrix')?.values, [[2, 4], [5, 6]], 'numbers change with the same matrix object');
  ok(Math.abs(middle.find(object => object.id === 'matrix')!.x - .3) < 1e-10, 'geometry transforms rather than remounts');
  eq(middle.find(object => object.id === 'vector')?.w, 0, 'the same vector rotates through its intermediate direction');
  eq(interpolateScene(sceneObjects(start), end, 1).map(object => object.values), end.objects.map(object => object.values), 'target values stay exact after animation');
  eq(JSON.stringify(start), before, 'source states remain immutable');
  eq(sceneInk({ ...start.objects[0], color: undefined }), sceneInk({ ...end.objects[1], color: undefined }), 'default semantic ink follows ID, not array order');
  const arriving: SceneItem = { kind: 'scene', objects: [{ id: 'result', type: 'text', x: .2, y: .2, w: .5, h: .2, text: 'Result' }] };
  const fading = interpolateScene(sceneObjects(start), arriving, .25);
  eq(fading.map(object => object.opacity), [.25, .75, .75], 'added and removed objects have distinct identities');
  eq(sceneNumber(.7310585786), '0.731', 'matrix labels avoid raw floating point tails');
  eq([1234,999999,.1234].map(sceneMatrixText), ['1234','999999','0.1234'], 'final reported values stay exact');
  eq(sceneMatrixText(.7310585786), '≈0.731', 'any rounded matrix value is explicitly approximate');
});

test('scene vectors use signed endpoints and share the plotted data coordinate system', () => {
  const item: SceneItem = { kind: 'scene', objects: [
    { id: 'plane', type: 'plot', x: .1, y: .2, w: .8, h: .6, background: true,
      plot: { kind: 'plot', x: [-2, 2], y: [-3, 3], curves: [{ expression: 'x', label: 'f' }] } },
    { id: 'vector', type: 'vector', plotId: 'plane', x: 0, y: 0, w: 2, h: 3 },
    { id: 'point', type: 'circle', plotId: 'plane', x: -.5, y: -1, w: 1, h: 2 },
  ] };
  const vector = projectSceneObject(item.objects[1], item.objects);
  ok(Math.abs(vector.x - .532) < 1e-9 && Math.abs(vector.y - .464) < 1e-9, 'origin maps to the exact inner axes, including plot margins');
  ok(Math.abs(vector.x + vector.w - .868) < 1e-9 && Math.abs(vector.y + vector.h - .224) < 1e-9, 'positive data y points upward to the plotted endpoint');
  const circle = projectSceneObject(item.objects[2], item.objects);
  ok(circle.w > 0 && circle.h > 0 && circle.y < vector.y, 'bound circle uses screen bounds despite inverted y');
  const arrow = sceneArrow({ x: .5, y: .5, w: -.3, h: -.2 });
  ok(arrow.line.startsWith('M300,200L120,120'), 'negative deltas remain negative, not an unsigned bounding box');
  eq(sceneArrow({ x: .5, y: .5, w: 0, h: 0 }), { line: '', head: '' }, 'a zero vector has no fabricated direction');
  const changed: SceneItem = { kind: 'scene', objects: [
    { ...item.objects[0], plot: { ...item.objects[0].plot!, x: [0, 1], y: [0, 1] } },
    { ...item.objects[1], w: .5, h: .5 },
    { ...item.objects[2], x: .1, y: .1, w: .1, h: .1 },
  ] };
  eq(sceneTransitionAllowed(item.objects, changed), false, 'changing coordinate domains is not treated as a numeric transform');
  eq(interpolateScene(sceneObjects(item), changed, .5), sceneObjects(changed), 'domain changes show the exact valid target state, never an out-of-domain intermediate vector');
  const rebound: SceneItem = { kind: 'scene', objects: item.objects.map(object => object.id === 'vector' ? { ...object, plotId: undefined, x: .2, y: .2, w: .1, h: .1 } : object) };
  eq(sceneTransitionAllowed(item.objects, rebound), false, 'data-space and canvas-space values are never mixed');
});

// ----------------------------------------------------- heatmap, scatter, shapes

const sensors: HeatmapItem = {
  kind: 'heatmap',
  rows: ['soil', 'air', 'water', 'light'],
  cols: ['soil', 'air', 'water', 'light'],
  values: [
    [1, 0.62, 0.35, -0.1],
    [0.62, 1, 0.48, 0.05],
    [0.35, 0.48, 1, 0.3],
    [-0.1, 0.05, 0.3, 1],
  ],
  source: 'illustrative',
};
const scores = (mask?: 'upper'): HeatmapItem => ({
  kind: 'heatmap',
  rows: ['a', 'b', 'c'],
  cols: ['x', 'y', 'z'],
  values: [
    [2, 1, 0],
    [0, 3, 1],
    [1, 1, 4],
  ],
  source: 'illustrative',
  normalize: 'rows',
  ...(mask ? { mask } : {}),
});

test('a heatmap, scatter or shapes item is checked with the shared rules and kept in its clean form', () => {
  warnings.length = 0;
  const formula = checkBoardItem(
    { kind: 'heatmap', rows: ['a', 'b'], cols: ['x', 'y', 'z'], expression: ' x * a ', source: 'formula', extra: 1 },
    'step "s"',
    warn,
  );
  eq(formula, { kind: 'heatmap', rows: ['a', 'b'], cols: ['x', 'y', 'z'], values: [[1, 2, 3], [2, 4, 6]], expression: 'x * a', source: 'formula' }, 'values computed');
  const scatter = checkBoardItem(
    { kind: 'scatter', x_label: 'cost ($)', y_label: 'yield (%)', source: 'document', points: [{ label: 'A', x: 1, y: 2 }, { label: 'B', x: 3, y: 5 }, { label: 'C', x: 6, y: 7 }] },
    'step "s"',
    warn,
  );
  eq((scatter as { points: unknown[] }).points.length, 3, 'scatter points');
  const shapes = checkBoardItem(
    {
      kind: 'shapes',
      terms: [
        { kind: 'matrix', name: 'A', rows: 'm', cols: 'k' },
        { kind: 'op', op: 'times' },
        { kind: 'matrix', name: 'B', rows: 'k', cols: 'n' },
        { kind: 'op', op: 'equals' },
        { kind: 'matrix', name: 'C', rows: 'm', cols: 'n' },
      ],
    },
    'step "s"',
    warn,
  );
  eq((shapes as { terms: unknown[] }).terms.length, 5, 'shapes terms');
  eq(warnings.length, 0, 'no warnings');
});

test('invalid heatmap, scatter and shapes items are skipped with the reason', () => {
  warnings.length = 0;
  const ragged = { kind: 'heatmap', rows: ['a', 'b'], cols: ['x', 'y'], values: [[1, 2], [3]], source: 'illustrative' };
  eq(checkBoardItem(ragged, 'step "s"', warn), null, 'ragged grid');
  const lone = { kind: 'scatter', x_label: 'x', y_label: 'y', source: 'illustrative', points: [{ label: 'A', x: 1, y: 2 }] };
  eq(checkBoardItem(lone, 'step "s"', warn), null, 'one point');
  const clash = {
    kind: 'shapes',
    terms: [
      { kind: 'matrix', name: 'A', rows: 'm', cols: 'k' },
      { kind: 'op', op: 'times' },
      { kind: 'matrix', name: 'B', rows: 'j', cols: 'n' },
    ],
  };
  eq(checkBoardItem(clash, 'step "s"', warn), null, 'dimensions that do not agree');
  eq(warnings.length, 3, 'one warning each');
  ok(warnings[0].includes('row 2') && warnings[0].includes('step "s"'), 'says where the grid is ragged');
  ok(warnings[1].includes('points'), 'names the points');
  ok(warnings[2].includes('times'), 'names the operator');
});

test('the source tag marks invented and computed values, never the paper\'s', () => {
  eq(sourceTag(sensors)?.text, 'illustrative', 'illustrative');
  eq(sourceTag({ ...sensors, source: 'formula' })?.text, 'from the formula', 'formula');
  eq(sourceTag({ ...sensors, source: 'document' }), null, 'document');
  eq(sourceTag(bleu), null, 'bars have none');
});

test('the colour scale rises in lightness, stays readable under its text, and runs warm below zero', () => {
  const levels = Array.from({ length: 101 }, (_, i) => i / 100);
  const lights = levels.map((t) => luminance(heatmapRgb(t, false)));
  ok(lights.every((v, i) => i === 0 || v >= lights[i - 1]), 'sequential lightness rises');
  const warm = levels.map((t) => luminance(heatmapRgb(-t, true)));
  ok(warm.every((v, i) => i === 0 || v >= warm[i - 1]), 'negative side rises too');
  eq(heatmapRgb(0, true), heatmapRgb(0, false), 'both sides start at the same neutral');
  const [r, , b] = heatmapRgb(-0.75, true);
  const [r2, , b2] = heatmapRgb(0.75, true);
  ok(r > b && b2 > r2, 'negative is warm, positive is cool');
  for (const diverging of [false, true])
    for (const t of levels.map((v) => (diverging ? 2 * v - 1 : v))) {
      const fill = heatmapRgb(t, diverging);
      ok(contrast(luminance(fill), luminance(heatmapInk(fill))) >= 4, `text on level ${t} reads at 4:1 or better`);
    }
  ok(heatmapRamp(false).startsWith('linear-gradient(90deg, rgb(24 29 43) 0%') && heatmapRamp(true).includes('50%'), 'legend gradient');
});

test('the domain anchors weights at zero, spreads a narrow band, centres signed values and skips masked cells', () => {
  eq(heatmapDomain([[0.1, 0.5], [0.9, 0.3]], false), [0, 0.9], 'low values start at zero');
  eq(heatmapDomain([[0.8, 0.85], [0.9, 0.95]], false), [0.8, 0.95], 'a narrow band spreads');
  eq(heatmapDomain([[-2, 1], [0.5, 0]], true), [-2, 2], 'symmetric around zero');
  eq(heatmapDomain([[1, 99], [3, 4]], false, 'upper'), [0, 4], 'masked cells do not count');
  eq(heatmapDomain([[5, 5], [5, 5]], false), [5, 6], 'a flat grid still has a span');
  eq(heatmapLevel(1, [0, 4], false), 0.25, 'sequential level');
  eq(heatmapLevel(-1, [-2, 2], true), -0.5, 'diverging level');
  eq(heatmapLevel(9, [0, 4], false), 1, 'clamped');
});

test('cell text keeps few places, never prints a small value as zero and carries the unit', () => {
  eq(heatmapPlaces([[1, 2], [3, 4]]), 0, 'integers');
  eq(heatmapPlaces([[0.123456, 2]]), 2, 'at most two places');
  eq(heatmapPlaces([[1, 99.5], [3, 4]], 'upper'), 0, 'masked cells are not measured');
  eq(heatmapText(0.5, 2), '0.50', 'fixed places');
  eq(heatmapText(0.001, 2), '~0', 'small but not zero');
  eq(heatmapText(0, 2), '0.00', 'zero is zero');
  eq(heatmapText(-0.004, 2, '%'), '~0%', 'small with a unit');
  eq(heatmapText(12.5, 1, '%'), '12.5%', 'percent');
  eq(heatmapText(-0.35, 2), '-0.35', 'negative');
  eq(heatmapLegend(heatmapModel(scores()).raw), { low: '0', high: '4' }, 'legend trims places');
  eq(heatmapLegend(heatmapModel(sensors).raw), { low: '-0.1', high: '1' }, 'a sequential scale starts at the lowest signed value');
  eq(heatmapLegend(heatmapModel({ ...sensors, scale: 'diverging' }).raw), { low: '-1', high: '1' }, 'diverging legend');
  eq(heatmapLegend(heatmapModel(scores()).raw, 'score'), { low: '0', high: '4 score' }, 'unit follows the high end');
  eq(heatmapLegend(heatmapModel(scores()).raw, '%'), { low: '0%', high: '4%' }, 'percent stays on both');
});

test('normalizing turns scores into weights: colour and text move from the first state to the second', () => {
  const model = heatmapModel(scores());
  ok(model.weights !== null, 'weights exist');
  for (const row of model.weights!.values) ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'a row sums to one');
  const before = cellLook(model, 1, 1, 0);
  const after = cellLook(model, 1, 1, 1);
  eq([before.rawOpacity, before.weightOpacity], [1, 0], 'scores show first');
  eq([after.rawOpacity, after.weightOpacity], [0, 1], 'weights show last');
  eq(before.rawText, '3', 'raw text');
  eq(after.weightText, '0.84', 'weight text');
  ok(before.fill !== after.fill, 'the colour moves');
  const mid = cellLook(model, 1, 1, 0.5);
  eq([mid.rawOpacity, mid.weightOpacity], [0, 0], 'the numbers pass the midpoint blank, never as meaningless in-between values');
  eq(cellLook(heatmapModel(sensors), 0, 1, 1).weightOpacity, 0, 'no weights without normalize');
});

test('masked cells weigh zero and do not set the scale', () => {
  const model = heatmapModel(scores('upper'));
  eq(model.weights!.values[0], [1, 0, 0], 'the first row sees only itself');
  ok(Math.abs(model.weights!.values[2].reduce((a, b) => a + b, 0) - 1) < 1e-9, 'the last row still sums to one');
  eq(model.raw.domain[1], 4, 'raw domain ignores the masked 1 and 0 above the diagonal');
  eq(heatmapAlt(scores('upper')).includes('a: x 1.00'), true, 'the alt text has the weights');
  ok(!heatmapAlt(scores('upper')).includes('a: x 1.00, y'), 'and leaves masked cells out');
});

test('links weigh by value, follow the scores into the weights and run warm for negative scores', () => {
  const model = heatmapModel(scores());
  const first = linkLook(model, 0, 0, 0);
  const last = linkLook(model, 0, 0, 1);
  // Score 2 of a 0-4 span; its weight is 0.665 of a span that ends at the grid's largest weight, 0.910.
  ok(first.strength === 0.5 && Math.abs(last.strength - 0.731) < 0.005, 'strength follows scores, then weights');
  eq(linkLook(model, 0, 2, 0).strength, 0, 'the lowest score has no strength');
  const signed = heatmapModel({ ...sensors, scale: 'diverging' });
  eq(linkLook(signed, 0, 3, 0), { strength: 0.1, negative: true }, 'a negative score is drawn by size, in the warm colour');
  eq(linkLook(signed, 0, 1, 0).negative, false, 'a positive one is not');
});

test('the build: rows arrive in order, the morph waits for the grid, and the end is at the last row', () => {
  const { first, every, pause } = HEATMAP_TIMING;
  eq(rowShown(0, 0), 0, 'nothing at the start');
  ok(rowShown(first + 300, 0) > rowShown(first + 300, 3), 'earlier rows are further along');
  eq(rowShown(heatmapEnd(4, false), 3), 1, 'all rows in at the end');
  const gridDone = first + 3 * every + HEATMAP_TIMING.fade;
  eq(heatmapEnd(4, false), gridDone, 'no morph: the grid is the end');
  eq(rowMorph(gridDone + pause - 1, 0, 4), 0, 'the morph has not started');
  ok(rowMorph(gridDone + pause + 300, 0, 4) > rowMorph(gridDone + pause + 300, 3, 4), 'rows turn one after another');
  eq(rowMorph(heatmapEnd(4, true), 3, 4), 1, 'the last row has turned at the end');
  ok(heatmapEnd(4, true) > gridDone + pause && heatmapEnd(4, true) - gridDone - pause < 1100, 'about a second of morph');
  eq([morphProgress(0, 4), morphProgress(heatmapEnd(4, true), 4)], [0, 1], 'overall progress spans 0 to 1');
});

test('labels stay on one line, then wrap to two, then turn to read upward', () => {
  eq(labelBlock(['ab', 'cde'], 40, measure).mode, 'flat', 'short labels');
  const wrapped = labelBlock(['red wine', 'dry'], 40, measure);
  eq([wrapped.mode, wrapped.lines], ['wrap', [['red', 'wine'], ['dry']]], 'words wrap');
  const turned = labelBlock(['fermentation', 'dry'], 40, measure);
  eq(turned.mode, 'rotated', 'a word that cannot fit turns');
  ok(turned.height <= 92 + 4, 'a turned label is cut to a bounded height');
  const long = labelBlock(['a very long label indeed that goes on', 'b'], 20, measure);
  ok(long.lines[0][0].endsWith('…') && measure(long.lines[0][0]) <= 92, 'a very long label ends in an ellipsis');
});

test('a grid fills the width up to 64px cells, keeps its cells from turning into strips, and fits the height', () => {
  const wide = gridLayout(sensors, { width: 600, height: 400 }, measure, 28);
  ok(wide.cw <= 64 && wide.ch <= wide.cw, 'cells are at most 64px and never taller than wide');
  ok(wide.width <= 600 && wide.height <= 400, 'fits a roomy board');
  ok(wide.values, 'values print on big cells');
  const short = gridLayout(sensors, { width: 600, height: 150 }, measure, 28);
  ok(short.cw <= (150 - short.cols.height) / sensors.rows.length / 0.62 + 1, 'cells narrow to keep their shape on a short board');
  const tight = gridLayout(sensors, { width: 300, height: 70 }, measure, 28);
  ok(tight.ch >= 14 && tight.height > 70, 'a grid that cannot fit keeps readable cells and scrolls');
  ok(!tight.values || tight.cw >= 28 + 8, 'values print only where they fit');
  const narrow = gridLayout(sensors, { width: 160, height: 400 }, measure, 28);
  ok(!narrow.values && narrow.width <= 160, 'small cells print no values');
  const sums = gridLayout(scores(), { width: 400, height: 300 }, measure, 28);
  ok(sums.sumX !== null && sums.sumX >= sums.x0 + 3 * sums.cw, 'a normalized grid reserves a column for the sums');
  eq(gridLayout(sensors, { width: 400, height: 300 }, measure, 28).sumX, null, 'and others do not');
});

test('long column labels turn instead of overlapping', () => {
  const item: HeatmapItem = { ...sensors, cols: ['temperature', 'humidity', 'pressure', 'luminosity'] };
  const layout = gridLayout(item, { width: 280, height: 300 }, measure, 28);
  eq(layout.cols.mode, 'rotated', 'rotated');
  ok(layout.y0 > 60, 'the header makes room for them');
});

test('links: curves join each row to its columns, skip masked cells and stay inside the board', () => {
  const layout = linksLayout(scores('upper'), { width: 360, height: 320 }, measure, 28);
  eq(layout.curves.map((row) => row.map(Boolean)), [[true, false, false], [true, true, false], [true, true, true]], 'masked cells have no curve');
  ok(layout.curves[2][0].startsWith(`M${layout.bottomX[2]} ${layout.bottomY} `), 'a curve starts at its row dot');
  ok(layout.curves[2][0].endsWith(`${layout.topX[0]} ${layout.topY}`), 'and ends at its column dot');
  ok(layout.topX.every((x) => x > 0 && x < 360) && layout.bottomX.every((x) => x > 0 && x < 360), 'tokens are inside');
  ok(layout.bottomY - layout.topY >= 84 && layout.height <= 320, 'room for curves, within the board');
  ok(layout.valueY !== null, 'values fit under the column tokens');
  eq(linksLayout(scores(), { width: 120, height: 320 }, measure, 28).valueY, null, 'narrow slots print no values');
  const uneven = linksLayout({ ...scores(), rows: ['a', 'b', 'c', 'd'], values: [...scores().values, [1, 2, 3]] }, { width: 360, height: 320 }, measure, 28);
  ok(uneven.bottomX.length === 4 && uneven.topX.length === 3, 'rows and columns spread on their own');
});

// ------------------------------------------------------------------- easing

test('cubic-bezier matches CSS: linear, ease and the board ease-out', () => {
  const linear = cubicBezier(0, 0, 1, 1);
  eq([0, 0.25, 0.5, 1].map((t) => Math.round(linear(t) * 1000) / 1000), [0, 0.25, 0.5, 1], 'linear');
  ok(Math.abs(cubicBezier(0.25, 0.1, 0.25, 1)(0.5) - 0.8024) < 0.001, 'ease at the midpoint');
  const out = cubicBezier(0.22, 1, 0.36, 1);
  const samples = Array.from({ length: 21 }, (_, i) => out(i / 20));
  ok(samples.every((v, i) => i === 0 || v >= samples[i - 1]), 'monotonic');
  ok(samples[0] === 0 && samples[20] === 1 && samples[10] > 0.85, 'quick to start, soft to land');
});

test('a timeline and a distribution are checked and resolved with the shared code, so a saved tour cannot disagree with the server', () => {
  warnings.length = 0;
  const lease = {
    kind: 'timeline',
    unit: 'month',
    source: 'illustrative',
    anchor: { label: 'Start' },
    events: [
      { label: 'Notice allowed', after: 'Start', offset: 3 },
      { label: 'Earliest exit', after: 'Notice allowed', offset: 3 },
    ],
    spans: [{ label: 'Notice runs', from: 'Notice allowed', to: 'Earliest exit', role: 'notice' }],
  };
  const timeline = checkBoardItem(lease, 'step "s"', warn);
  ok(timeline?.kind === 'timeline', 'a valid timeline is kept');
  eq(timeline?.kind === 'timeline' && timeline.events.map((e) => e.position), [91.3125, 182.625], 'positions are computed, not taken from the file');
  eq(checkBoardItem({ ...lease, events: [{ label: 'A', after: 'B', offset: 1 }, { label: 'B', after: 'A', offset: 1 }] }, 'step "s"', warn), null, 'a cycle is skipped');
  ok(warnings.at(-1)!.includes('each measured from another'), warnings.at(-1) ?? '');
  const bell = {
    kind: 'distribution',
    x_label: 'reaction time (ms)',
    source: 'illustrative',
    dists: [
      { family: 'normal', label: 'Before', mean: 250, sd: 30 },
      { family: 'normal', label: 'After', mean: 230, sd: 20 },
    ],
    region: { from: 300 },
  };
  const distribution = checkBoardItem(bell, 'step "s"', warn);
  ok(distribution?.kind === 'distribution' && distribution.region!.probabilities.length === 2, 'the region\'s chances are computed');
  eq(checkBoardItem({ ...bell, dists: [bell.dists[0], { family: 'binomial', label: 'x', n: 5, p: 0.5 }] }, 'step "s"', warn), null, 'discrete and continuous cannot share an axis');
  eq(sourceTag(timeline!)?.text, 'illustrative');
  eq(sourceTag(distribution!)?.text, 'illustrative');
  eq(sourceTag({ ...bell, source: 'document' } as never), null, 'a document\'s own numbers carry no tag');
});

test('a plot keeps its marks and points, and one whose mark cannot be found is skipped', () => {
  warnings.length = 0;
  const plot = {
    kind: 'plot',
    x: [0, 20],
    y: [0, 400],
    curves: [{ expression: 'x*x', label: 'n^2' }, { expression: '10*x', label: '10n' }],
    marks: [{ type: 'crossing', curve: 1, other: 2, nth: 2 }],
    points: [{ x: 5, y: 25 }],
  };
  const kept = checkBoardItem(plot, 'step "s"', warn);
  ok(kept?.kind === 'plot' && kept.marks?.length === 1 && kept.points?.length === 1, 'marks and points are kept');
  eq(checkBoardItem({ ...plot, marks: [{ type: 'root', curve: 1, nth: 4 }] }, 'step "s"', warn), null);
  ok(warnings.at(-1)!.includes('has only'), warnings.at(-1) ?? '');
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} board tests passed`);
