// Board tests: item checks, flow layout and geometry, term wrapping, bars and easing. Run with
// `npm test` (esbuild bundles this file for Node, no test framework needed).

import katex from 'katex';
import {
  BOARD_INK,
  BOARD_PALETTE,
  barClip,
  barPath,
  barsLayout,
  bestBar,
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
  eq(checkBoardItem({ kind: 'plot' }, 'step "s"', warn), null, 'unknown kind');
  eq(checkBoardItem(null, 'step "s"', warn), null, 'missing');
  eq(warnings.length, 5, 'warnings');
  ok(warnings[3].includes('"plot"') && warnings[3].includes('step "s"'), 'names the kind and the step');
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

test('the best bar follows the direction, and there is none without one', () => {
  eq(bestBar(bleu), 0, 'highest');
  eq(bestBar({ ...bleu, higher_is_better: false }), 2, 'lowest');
  eq(bestBar({ ...bleu, higher_is_better: undefined }), null, 'none');
  eq(bestBar({ kind: 'bars', higher_is_better: true, bars: [{ label: 'a', value: 1 }, { label: 'b', value: 1 }] }), 0, 'tie');
});

test('values print with the places they were reported with', () => {
  eq([28.4, 25.16, 24, 1.234567, 1e-7].map(decimalsOf), [1, 2, 0, 4, 4]);
  eq(formatValue(25.16, 2), '25.16');
  eq(formatValue(1234.5, 1), '1,234.5');
  eq(formatValue(-0.0001, 1), '0.0', 'no negative zero');
  eq(formatValue(12.5, 1, '%'), '12.5%');
  eq(formatValue(12.5, 1, 'BLEU'), '12.5', 'other units are shown once, not per value');
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

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} board tests passed`);
