import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateExpression as run,
  parseExpression as parse,
  formatNumber,
  plotProblems,
  plotSegments,
  resolveMarks,
  PLOT_BOARD_SCHEMA,
  PLOT_SCHEMA,
  type PlotItem,
} from '../../shared/plot';
import { checkBoard, boardParts, boardSchema } from '../src/harness/board';
import { groundedProblems } from '../src/harness/visual-rules';
import { readFileSync } from 'node:fs';
import { checkBoardItem } from '../../player/src/board';
import Ajv from 'ajv/dist/2020.js';
import { beatTargets, cleanDirection, directionSchema } from '../src/harness/direct';
import type { Beat } from '../src/harness/beats';
import type { Doc } from '../../shared/paper';
const plot: PlotItem = {
  kind: 'plot',
  x: [-4, 4],
  y: [-1, 2],
  curves: [{ expression: 'sigmoid(a*x)', label: '\\sigma(ax)' }],
  parameter: { from: 0.5, to: 2 },
};
test('safe grammar has standard precedence, stable nonlinear functions and a parameter', () => {
  assert.equal(run(parse('-2^2 + 3*4'), 0), 8);
  assert.equal(run(parse('2^3^2'), 0), 512);
  assert.equal(run(parse('a*x^2'), 3, 2), 18);
  assert.equal(run(parse('sigmoid(1000)'), 0), 1);
  assert.equal(run(parse('softmax(1000,1000)'), 0), 0.5);
  assert.equal(run(parse('relu(-2)+sqrt(4)+log(e)'), 0), 3);
});
test('rejects executable and unbounded syntax before rendering or server publication', () => {
  for (const expr of [
    'globalThis.alert(1)',
    'constructor.constructor(1)',
    'x=1',
    'x;1',
    '[x]',
    'x[0]',
    'Math.sin(x)',
    '1e999',
    'sin(x,1)',
    'softmax(x)',
    'unknown(x)',
    '('.repeat(30) + 'x' + ')'.repeat(30),
    'x+'.repeat(100) + 'x',
  ])
    assert.throws(() => parse(expr), Error, expr);
  assert(Number.isNaN(run(parse('1/0'), 0)));
  assert(Number.isNaN(run(parse('sqrt(-1)'), 0)));
});
test('one shared validator protects player and server; canonical schema accepts valid plots', () => {
  assert.deepEqual(plotProblems(plot), []);
  assert(new Ajv({ strict: false }).compile(PLOT_SCHEMA)(plot));
  assert.equal(checkBoard('plot', plot).item?.kind, 'plot');
  assert.equal(boardParts(plot), 1);
  assert.equal(checkBoardItem(plot, 'test', () => {})?.kind, 'plot');
  for (const invalid of [
    { ...plot, x: [0, 0] },
    { ...plot, curves: [{ expression: 'x.__proto__', label: 'bad' }] },
    { ...plot, parameter: { from: Infinity, to: 1 } },
  ]) {
    assert(plotProblems(invalid).length);
    assert.equal(checkBoard('plot', invalid).item, null);
    assert.equal(
      checkBoardItem(invalid, 'test', () => {}),
      null,
    );
  }
});
test('curve sampling never joins across poles or emits nonfinite coordinates', () => {
  const p = { ...plot, x: [-1, 1] as [number, number], y: [-10, 10] as [number, number] };
  const segments = plotSegments(parse('1/x'), p);
  assert(segments.length >= 2);
  assert(segments.flat().every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  assert(segments.every((s) => s.every(([x]) => x < 0) || s.every(([x]) => x > 0)));
});

test('a formula writer can choose a plot without also having to redraw the formula', () => {
  const beat: Beat = {
    id: 'formula',
    kind: 'formula',
    arc: 'method',
    point: 'Explain the function',
    evidence: [],
    board: 'formula',
  };
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
    pages: [{ n: 1, width: 600, height: 800 }],
    blocks: [],
    sentences: [],
    sections: [],
    figures: [],
    equations: [],
  };
  const targets = beatTargets(beat, doc);
  const value = {
    plan: 'Show behaviour',
    plot,
    say: 'As the input grows, the output moves toward one. The parameter controls how steeply it changes near the middle, rather than changing its endpoints.',
    cues: [{ action: 'board_focus', target: 'curve-1', label: '', anchor: 'As the input grows' }],
  };
  assert(new Ajv({ strict: false }).compile(directionSchema(beat, targets))(value));
  assert.equal(cleanDirection(value, beat, targets)?.board?.kind, 'plot');
  assert.deepEqual(
    cleanDirection(value, beat, targets)?.cues.map((c) => c.target),
    ['curve-1'],
  );
});

// ------------------------------------------------------------------- plot v2

const cost = (change: Record<string, unknown> = {}) => ({
  kind: 'plot' as const,
  x: [0, 20] as [number, number],
  y: [0, 400] as [number, number],
  curves: [
    { expression: 'x*x', label: 'n^2' },
    { expression: '10*x', label: '10n' },
  ],
  ...change,
});
const parabola = (marks: unknown[]) => ({
  kind: 'plot' as const,
  x: [-1, 5] as [number, number],
  y: [-2, 8] as [number, number],
  curves: [{ expression: 'x^2 - 4*x + 3', label: 'e(g)' }],
  marks,
});
const problemsOf = (item: unknown) => plotProblems(item).join(' | ');
const near = (actual: number, expected: number, tolerance = 1e-6) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ~= ${expected}`);

test('marks are found by the code: where two curves cross, a root, the lowest point and a value at a stated x', () => {
  const crossing = resolveMarks(cost({ marks: [{ type: 'crossing', curve: 1, other: 2, nth: 2 }] }) as PlotItem);
  assert.deepEqual(crossing.problems, []);
  near(crossing.marks[0].x, 10);
  near(crossing.marks[0].y, 100);
  const first = resolveMarks(cost({ marks: [{ type: 'crossing', curve: 1, other: 2 }] }) as PlotItem).marks[0];
  assert.deepEqual([first.x, first.y], [0, 0], 'a crossing at the left edge counts as the first');
  const { marks } = resolveMarks(
    parabola([
      { type: 'root', curve: 1 },
      { type: 'root', curve: 1, nth: 2, label: 'zero' },
      { type: 'extremum', curve: 1, which: 'min' },
      { type: 'value', curve: 1, at: 4 },
    ]) as PlotItem,
  );
  assert.deepEqual(
    marks.map((m) => [m.type, Number(m.x.toFixed(5)), Number(m.y.toFixed(5))]),
    [
      ['root', 1, 0],
      ['root', 3, 0],
      ['extremum', 2, -1],
      ['value', 4, 3],
    ],
  );
  assert.equal(marks[1].label, 'zero');
  near(
    resolveMarks({
      ...cost(),
      curves: [{ expression: 'sin(x)', label: 's' }],
      x: [-4, 4],
      y: [-2, 2],
      marks: [{ type: 'extremum', curve: 1, which: 'max' }],
    } as PlotItem).marks[0].x,
    Math.PI / 2,
    1e-6,
  );
});

test('a mark that does not exist is a problem worded for the model, never a guessed position', () => {
  assert.match(
    problemsOf(parabola([{ type: 'root', curve: 1, nth: 3 }])),
    /mark 1: curve 1 has only 2 roots .* over x = −1 to 5/,
  );
  assert.match(problemsOf(cost({ marks: [{ type: 'crossing', curve: 1, other: 2, nth: 3 }] })), /cross only 2 times/);
  assert.match(
    problemsOf({
      ...cost({
        curves: [
          { expression: 'x+1', label: 'a' },
          { expression: 'x+2', label: 'b' },
        ],
      }),
      marks: [{ type: 'crossing', curve: 1, other: 2 }],
    }),
    /do not cross/,
  );
  assert.match(
    problemsOf(cost({ x: [0, 5], marks: [{ type: 'extremum', curve: 2, which: 'max' }] })),
    /no interior maximum/,
  );
  assert.match(
    problemsOf(cost({ y: [0, 50], marks: [{ type: 'value', curve: 1, at: 20 }] })),
    /outside the y range 0 to 50/,
  );
  // 1/x flips sign at its pole, which is not a root.
  assert.match(
    problemsOf({
      kind: 'plot',
      x: [-1, 1],
      y: [-10, 10],
      curves: [{ expression: '1/x', label: 'p' }],
      marks: [{ type: 'root', curve: 1 }],
    }),
    /no roots/,
  );
  assert.match(
    problemsOf({ ...parabola([{ type: 'value', curve: 1, at: 99 }]) }),
    /a value needs "at", an x inside the x range/,
  );
});

test('mark requests are checked before they are searched', () => {
  assert.match(
    problemsOf(cost({ marks: [{ type: 'peak', curve: 1 }] })),
    /mark 1: type must be root, extremum, crossing, value/,
  );
  assert.match(problemsOf(cost({ marks: [{ type: 'root', curve: 4 }] })), /curve must be a whole number from 1 to 2/);
  assert.match(
    problemsOf(cost({ marks: [{ type: 'crossing', curve: 1 }] })),
    /a crossing needs "other", a different curve/,
  );
  assert.match(
    problemsOf(cost({ marks: [{ type: 'crossing', curve: 1, other: 1 }] })),
    /a crossing needs "other", a different curve/,
  );
  assert.match(problemsOf(cost({ marks: [{ type: 'extremum', curve: 1 }] })), /an extremum needs which, max or min/);
  assert.match(
    problemsOf(cost({ marks: [{ type: 'root', curve: 1, nth: 9 }] })),
    /nth must be a whole number from 1 to 5/,
  );
  assert.match(
    problemsOf(cost({ marks: [{ type: 'root', curve: 1, label: 'x'.repeat(25) }] })),
    /the label must be at most 24 characters/,
  );
  assert.match(
    problemsOf(cost({ marks: Array.from({ length: 5 }, () => ({ type: 'root', curve: 1 })) })),
    /give at most 4 marks/,
  );
});

test('with a parameter sweep a mark must exist at both ends and in the middle, so it never vanishes mid-sweep', () => {
  const sweep = (to: number) => ({
    kind: 'plot' as const,
    x: [0, 5] as [number, number],
    y: [-5, 5] as [number, number],
    curves: [{ expression: 'x - a', label: 'x-a' }],
    parameter: { from: 1, to },
    marks: [{ type: 'root', curve: 1 }],
  });
  assert.deepEqual(plotProblems(sweep(3)), []);
  assert.match(problemsOf(sweep(9)), /has no roots .* \(checked at a = 1, 5, 9\)/);
  near(resolveMarks(sweep(3) as PlotItem, 2).marks[0].x, 2);
  near(resolveMarks(sweep(3) as PlotItem, 3).marks[0].x, 3);
});

test('a log axis needs a range above zero, samples evenly in ratio and never draws a value it cannot show', () => {
  assert.match(problemsOf(cost({ x_scale: 'log' })), /x_scale: a log axis needs a range above zero, not 0 to 20/);
  assert.match(problemsOf(cost({ y_scale: 'log' })), /y_scale: a log axis needs a range above zero/);
  assert.match(problemsOf(cost({ x_scale: 'sqrt' })), /x_scale: use linear or log/);
  const loglog = {
    ...cost({ x: [1, 1000], y: [0.5, 20000], curves: [{ expression: '0.5*x^1.5', label: 't' }] }),
    x_scale: 'log',
    y_scale: 'log',
  } as PlotItem;
  assert.deepEqual(plotProblems(loglog), []);
  const [segment] = plotSegments(parse('0.5*x^1.5'), loglog, 1, 60);
  const ratios = segment.slice(1).map(([x], i) => x / segment[i][0]);
  near(Math.max(...ratios), Math.min(...ratios), 1e-9);
  assert.equal(
    plotSegments(parse('x-5'), { ...loglog, x: [1, 10], y: [0.1, 10] } as PlotItem, 1, 60).every((s) =>
      s.every(([, y]) => y > 0),
    ),
    true,
  );
  assert.match(problemsOf({ ...loglog, marks: [{ type: 'root', curve: 1 }] }), /no roots|log y axis cannot show/);
});

test('a log axis may span powers of ten far beyond a linear one: counts of operations and rates', () => {
  const scaling = (change: Record<string, unknown> = {}) =>
    cost({
      x: [1e18, 1e24],
      y: [1, 100],
      x_scale: 'log',
      curves: [{ expression: '100/(x/10^18)^0.2', label: 'loss' }],
      ...change,
    });
  assert.deepEqual(plotProblems(scaling()), []);
  assert.deepEqual(plotProblems(scaling({ x: [1e-9, 1e-7] })), [], 'tiny ranges are measured in ratio');
  assert.deepEqual(plotProblems(scaling({ x: [1e-30, 1e30] })), []);
  assert.deepEqual(plotProblems(scaling({ x: [1e18, 1e24], y: [1e-9, 1e-3], y_scale: 'log' })), []);
  // A linear axis keeps its limits, and a log one its own: finite, increasing, above zero, within 1e30.
  assert.match(problemsOf(scaling({ x_scale: 'linear' })), /finite increasing ranges within ±1000000/);
  assert.match(problemsOf(scaling({ x: [1, 1e31] })), /finite increasing ranges/);
  assert.match(problemsOf(scaling({ x: [1e18, 1e18 * 1.00001] })), /finite increasing ranges/);
  assert.match(problemsOf(scaling({ x: [1e24, 1e18] })), /finite increasing ranges/);
  assert.match(problemsOf(scaling({ x: [0, 1e24] })), /x_scale: a log axis needs a range above zero, not 0 to 1e\+24/);
  // Measured points of such a plot are checked against the axes as ever.
  assert.deepEqual(plotProblems(scaling({ points: [{ x: 2.3e19, y: 25.16 }] })), []);
  assert.match(problemsOf(scaling({ points: [{ x: 2.3e25, y: 25.16 }] })), /point 1 .* lies outside the axes/);
  const [segment] = plotSegments(parse('100/(x/10^18)^0.2'), scaling() as PlotItem, 1, 60);
  const ratios = segment.slice(1).map(([x], i) => x / segment[i][0]);
  near(Math.max(...ratios), Math.min(...ratios), 1e-9);
  // The contracts agree: the board's schema leaves the range to the code (the provider fails a schema with a limit of
  // 1e30) and the canonical tour schema takes it; a plot inside a scene keeps its linear limits.
  assert.equal(PLOT_BOARD_SCHEMA.properties.x.items.maximum, undefined);
  assert.equal(PLOT_SCHEMA.properties.x.items.maximum, 1e6);
  const canonical = JSON.parse(readFileSync(new URL('../../schema/tour.schema.json', import.meta.url), 'utf8'));
  const board = canonical.$defs.boardItem.oneOf.find((item: any) => item.properties.kind?.const === 'plot');
  assert.equal(new Ajv({ strict: false }).compile(board)(scaling()), true);
  assert.equal(new Ajv({ strict: false }).compile(board)(scaling({ x: [1, 1e31] })), false);
  assert.equal(new Ajv({ strict: false }).compile(PLOT_BOARD_SCHEMA)(scaling()), true);
});

test("measured points sit inside the axes and are always the document's own numbers", () => {
  const points = [
    { x: 5, y: 25 },
    { x: 10, y: 100, label: 'run 2' },
    { x: 20, y: 400 },
  ];
  assert.deepEqual(plotProblems(cost({ points })), []);
  assert.match(
    problemsOf(cost({ points: [{ x: 50, y: 10 }] })),
    /point 1 \(50, 10\) lies outside the axes; widen the x range/,
  );
  assert.match(problemsOf(cost({ points: [{ x: 5, y: 'a' }] })), /point 1: x and y must both be finite numbers/);
  assert.match(problemsOf(cost({ points: Array.from({ length: 9 }, (_, i) => ({ x: i, y: i })) })), /at most 8 points/);
  const printed = 'Measured: 5 requests took 25 steps, 10 took 100 and 20 took 400.';
  assert.deepEqual(checkBoard('plot', cost({ points }), printed).problems, []);
  const invented = checkBoard('plot', cost({ points }), 'Measured: 5 requests took 25 steps.');
  assert.equal(invented.item, null);
  assert.match(
    invented.problems.join(' '),
    /points: not printed in the evidence: point 2 x = 10; point 2 y = 100; point 3 x = 20 \(and 1 more\).*a measurement, never an invented one/,
  );
  assert.equal(
    checkBoard('plot', cost({ points, source: 'illustrative' }), '').item,
    null,
    'illustrative does not excuse a point',
  );
});

test("a plot is illustrative unless it says the expression is the document's own, and then its constants are printed", () => {
  const own = parabola([]);
  assert.ok(checkBoard('plot', own, '').item, 'illustrative by default needs no evidence');
  assert.ok(checkBoard('plot', { ...own, source: 'document' }, 'The error is e = g squared minus 4 g plus 3.').item);
  const refused = checkBoard('plot', { ...own, source: 'document' }, 'The error follows a parabola.');
  assert.equal(refused.item, null);
  assert.match(
    refused.problems.join(' '),
    /source: not printed in the evidence: curve 1 constant = 4; curve 1 constant = 3.*set source to illustrative/,
  );
  assert.match(problemsOf({ ...own, source: 'measured' }), /source: use document or illustrative/);
});

test('two straight lines that cross are a fact worth plotting; without a mark they are still refused', () => {
  const lines = cost({
    curves: [
      { expression: '3*x', label: 'a' },
      { expression: '60-x', label: 'b' },
    ],
  });
  const bare = checkBoard('plot', lines).item!;
  assert.match(groundedProblems(bare, { results: false }).join(' '), /every curve is a straight line/);
  const marked = checkBoard('plot', { ...lines, marks: [{ type: 'crossing', curve: 1, other: 2 }] }).item!;
  assert.deepEqual(groundedProblems(marked, { results: false }), []);
});

test('the plot board schema adds log axes, marks and points, while a plot inside a scene stays curves alone', () => {
  assert.equal(boardSchema('plot'), PLOT_BOARD_SCHEMA);
  assert.doesNotMatch(JSON.stringify(PLOT_BOARD_SCHEMA), /\$ref|oneOf|anyOf|allOf/);
  const item = {
    ...cost({
      x: [1, 30],
      marks: [{ type: 'crossing', curve: 1, other: 2, label: 'break-even' }],
      points: [{ x: 10, y: 100 }],
      x_scale: 'log',
      source: 'illustrative',
    }),
  };
  const ajv = new Ajv({ strict: false });
  assert.equal(ajv.compile(PLOT_BOARD_SCHEMA)(item), true);
  assert.equal(ajv.compile(PLOT_BOARD_SCHEMA)({ ...item, marks: [{ type: 'root' }] }), false, 'a mark names its curve');
  assert.equal(ajv.compile(PLOT_SCHEMA)(item), false, 'a scene plot has no marks, points or log axes');
  assert.equal(ajv.compile(PLOT_SCHEMA)(plot), true);
  const saved = JSON.parse(readFileSync(new URL('../../schema/tour.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv({ strict: false }).compile(saved);
  const tour = {
    schema: 'paper-tour/tour@0.1',
    title: 'Plot',
    paper: 'test',
    chapters: [{ id: 'c', title: 'C', steps: [{ id: 's', say: 'Look.', actions: [{ type: 'board', item }] }] }],
  };
  assert.equal(validate(tour), true, JSON.stringify(validate.errors?.slice(0, 3)));
  assert.equal(
    validate({
      ...tour,
      chapters: [
        {
          ...tour.chapters[0],
          steps: [
            {
              ...tour.chapters[0].steps[0],
              actions: [{ type: 'board', item: { ...item, marks: [{ type: 'crossing' }] } }],
            },
          ],
        },
      ],
    }),
    false,
  );
});

test('numbers on a plot are printed with three digits and powers of ten at the extremes', () => {
  assert.equal(formatNumber(10), '10');
  assert.equal(formatNumber(3.14159), '3.14');
  assert.equal(formatNumber(-1), '−1');
  assert.equal(formatNumber(1234567), '1.23×10⁶');
  assert.equal(formatNumber(0.00012), '1.2×10⁻⁴');
  assert.equal(formatNumber(0), '0');
});
