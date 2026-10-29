import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import { HEATMAP_SCHEMA, evaluateHeatmap, heatmapProblems, rowSoftmax, type HeatmapItem } from '../../shared/heatmap';
import { SCATTER_SCHEMA, scatterProblems, scatterSeries } from '../../shared/scatter';
import { SHAPES_SCHEMA, shapesProblems, shapesRunning, type ShapesOpTerm, type ShapesTerm } from '../../shared/shapes';
import {
  BOARD_KINDS,
  LEGACY_BOARD_KINDS,
  boardPart,
  boardPartIds,
  boardParts,
  boardSchema,
  checkBoard,
} from '../src/harness/board';

const heatmap = () => ({
  rows: ['first', 'second', 'third'],
  cols: ['left', 'middle', 'right'],
  values: [
    [0.5, 0.3, 0.2],
    [0.1, 0.8, 0.1],
    [0.2, 0.2, 0.6],
  ],
  source: 'illustrative',
});
const scatter = () => ({
  x_label: 'cost (hours)',
  y_label: 'accuracy (%)',
  better: 'up-left',
  points: [
    { label: 'small', x: 1, y: 60 },
    { label: 'medium', x: 10, y: 75 },
    { label: 'large', x: 100, y: 80 },
  ],
  source: 'document',
});
/** Text printing every value of the scatter fixture, as a paper's table would. */
const SCATTER_EVIDENCE = 'Training for 1, 10 and 100 hours reached 60, 75 and 80 percent accuracy.';
const m = (name: string, rows: string, cols: string): ShapesTerm => ({ kind: 'matrix', name, rows, cols });
const op = (which: ShapesOpTerm['op'], label?: string): ShapesTerm => ({
  kind: 'op',
  op: which,
  ...(label ? { label } : {}),
});
const shapes = (...terms: ShapesTerm[]) => ({ terms });

/** Problems of a heatmap with some fields changed. */
const heatmapWith = (change: Record<string, unknown>) => heatmapProblems({ kind: 'heatmap', ...heatmap(), ...change });
const scatterWith = (change: Record<string, unknown>) => scatterProblems({ kind: 'scatter', ...scatter(), ...change });
const has = (problems: string[], pattern: RegExp) =>
  assert.ok(
    problems.some((p) => pattern.test(p)),
    problems.join(' | '),
  );

test('a valid heatmap becomes its canonical item, with its row labels as focus parts', () => {
  const { item, problems } = checkBoard('heatmap', { ...heatmap(), title: '  Who looks at whom ', unit: '%' });
  assert.deepEqual(problems, []);
  assert.deepEqual(item, { kind: 'heatmap', title: 'Who looks at whom', ...heatmap(), unit: '%' });
  assert.equal(boardParts(item!), 3);
  assert.equal(boardPart(item!, 'row-3'), 2);
  assert.equal(boardPart(item!, 'row-4'), -1);
});

test('heatmap problems tell the model what to change', () => {
  has(heatmapWith({ rows: Array.from({ length: 12 }, (_, i) => `r${i}`) }), /^rows: give 2 to 10 labels, not 12$/);
  has(heatmapWith({ cols: ['one'] }), /^cols: give 2 to 10 labels, not 1$/);
  has(heatmapWith({ rows: ['a', 'a', 'b'] }), /rows: the label "a" is used twice/);
  has(heatmapWith({ rows: ['a', 'b', 'a label of seventeen'] }), /longer than 16 characters/);
  has(heatmapWith({ values: [[1, 2, 3]] }), /values: give 3 rows of numbers, one per row label, not 1/);
  has(
    heatmapWith({
      values: [
        [1, 2],
        [1, 2],
        [1, 2],
      ],
    }),
    /values: row 1 needs 3 numbers/,
  );
  has(
    heatmapWith({
      values: [
        [1, 2, 3],
        [1, 2, 3],
        [1, 2, 2e6],
      ],
    }),
    /values: row 3, column 3 must be a number/,
  );
  has(heatmapWith({ values: undefined }), /values: give 3 rows of numbers/);
  has(
    heatmapWith({
      values: [
        [1, 1, 1],
        [1, 1, 1],
        [1, 1, 1],
      ],
    }),
    /every visible cell is the same/,
  );
  has(heatmapWith({ source: 'measured' }), /source: use document, illustrative, formula/);
  has(heatmapWith({ title: 'x'.repeat(61) }), /title: use at most 60 characters/);
  has(heatmapWith({ scale: 'log' }), /scale: use sequential or diverging/);
});

test('a formula heatmap needs an expression and only a formula takes one', () => {
  has(heatmapWith({ source: 'formula', values: undefined }), /expression: source formula needs an expression/);
  has(heatmapWith({ expression: 'x*a' }), /expression: only source formula takes an expression/);
  has(heatmapWith({ source: 'document', expression: 'x*a' }), /only source formula takes an expression/);
  has(heatmapWith({ source: 'formula', values: undefined, expression: 'x*a(' }), /^expression: /);
  has(
    heatmapWith({ source: 'formula', values: undefined, expression: 'process(x)' }),
    /Unknown variable, function or token; use x/,
  );
  assert.deepEqual(heatmapWith({ source: 'formula', values: undefined, expression: 'x*a' }), []);
});

test('expressions are evaluated into values: x is the column number and a the row number, both from 1', () => {
  assert.deepEqual(evaluateHeatmap('x*a', 2, 3), [
    [1, 2, 3],
    [2, 4, 6],
  ]);
  assert.deepEqual(evaluateHeatmap('x - a', 2, 2), [
    [0, 1],
    [-1, 0],
  ]);
  assert.throws(() => evaluateHeatmap('1/(x-2)', 2, 3), /not a finite number at column 2, row 1 \(x=2, a=1\)/);
  assert.throws(() => evaluateHeatmap('10^x*a', 2, 8), /keep every value within/);
  const sweep = { ...heatmap(), source: 'formula', expression: ' x/a ', values: [[9]] };
  const { item, problems } = checkBoard('heatmap', sweep);
  assert.deepEqual(problems, []);
  const grid = (item as HeatmapItem).values;
  assert.deepEqual(grid[1], [0.5, 1, 1.5]);
  assert.equal((item as HeatmapItem).expression, 'x/a');
  has(checkBoard('heatmap', { ...sweep, expression: '1/(x-2)' }).problems, /^expression: it is not a finite number/);
});

test('normalize, mask and links have their own conditions', () => {
  const square = { rows: ['a', 'b', 'c'], cols: ['a', 'b', 'c'] };
  const notSquare = {
    rows: ['a', 'b'],
    values: [
      [1, 2, 3],
      [3, 2, 1],
    ],
  };
  has(
    heatmapWith({ ...notSquare, mask: 'upper' }),
    /^mask: upper needs a square grid with as many rows as columns, not 2 rows and 3/,
  );
  assert.deepEqual(heatmapWith({ mask: 'upper' }), []);
  const flat = [
    [2, 2, 2],
    [5, 5, 5],
    [1, 1, 1],
  ];
  has(heatmapWith({ normalize: 'rows', values: flat }), /^normalize: every row holds equal scores/);
  // Under a mask only the visible cells count: the first row sees one cell and the others still differ.
  assert.deepEqual(heatmapWith({ ...square, normalize: 'rows', mask: 'upper' }), []);
  has(
    heatmapWith({ ...square, normalize: 'rows', mask: 'upper', values: flat }),
    /^normalize: every row holds equal scores/,
  );
  const wide = Array.from({ length: 9 }, (_, i) => `c${i}`);
  const values = [wide.map((_, i) => i), wide.map((_, i) => 9 - i)];
  has(
    heatmapWith({ rows: ['a', 'b'], cols: wide, values, view: 'links' }),
    /^view: links needs at most 8 columns, not 9/,
  );
  assert.deepEqual(
    heatmapWith({ rows: ['a', 'b'], cols: wide.slice(0, 8), values: values.map((r) => r.slice(0, 8)), view: 'links' }),
    [],
  );
});

test('row softmax turns each row into weights that sum to one, stable for large scores', () => {
  const weights = rowSoftmax([
    [1, 2, 3],
    [0, 0, 0],
    [-5, 5, 0],
  ]);
  for (const row of weights) assert.ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(weights[0][2] > weights[0][1] && weights[0][1] > weights[0][0]);
  assert.deepEqual(weights[1], [1 / 3, 1 / 3, 1 / 3]);
  const large = rowSoftmax([[1000, 1000, 1001]]);
  assert.ok(large[0].every(Number.isFinite));
  assert.ok(Math.abs(large[0].reduce((a, b) => a + b, 0) - 1) < 1e-12);
  assert.ok(Math.abs(large[0][0] - large[0][1]) < 1e-15);
  assert.ok(rowSoftmax([[-1000, -1001]])[0].every((w) => w > 0));
  // Masked cells weigh nothing, and the rest still sum to one.
  const causal = rowSoftmax(
    [
      [3, 9, 9],
      [1, 1, 9],
      [0, 0, 0],
    ],
    'upper',
  );
  assert.deepEqual(causal[0], [1, 0, 0]);
  assert.deepEqual(causal[1], [0.5, 0.5, 0]);
  assert.ok(Math.abs(causal[2][0] - 1 / 3) < 1e-12);
});

test('a valid scatter becomes its canonical item with its points as focus parts', () => {
  const { item, problems } = checkBoard('scatter', { ...scatter(), x_log: true, y_log: false }, SCATTER_EVIDENCE);
  assert.deepEqual(problems, []);
  assert.deepEqual(item, { kind: 'scatter', ...scatter(), x_log: true });
  assert.equal(boardParts(item!), 3);
  assert.equal(boardPart(item!, 'point-2'), 1);
  assert.deepEqual(scatterSeries([{ series: 'a' }, {}, { series: 'b' }, { series: 'a' }]), ['a', 'b']);
});

test('scatter problems name the point or axis to fix', () => {
  has(scatterWith({ points: [{ label: 'only', x: 1, y: 2 }] }), /^points: give 3 to 10 points, not 1$/);
  // Two points are a comparison, which bars show better.
  has(
    scatterWith({
      points: [
        { label: 'a', x: 1, y: 2 },
        { label: 'b', x: 2, y: 3 },
      ],
    }),
    /^points: give 3 to 10 points, not 2$/,
  );
  has(scatterWith({ points: Array.from({ length: 11 }, (_, i) => ({ label: `p${i}`, x: i, y: i })) }), /not 11/);
  has(scatterWith({ x_label: '' }), /^x_label: give plain words with the unit, 1 to 40 characters/);
  has(scatterWith({ y_label: 'y'.repeat(41) }), /^y_label: /);
  has(scatterWith({ better: 'middle' }), /^better: use up-left/);
  has(scatterWith({ source: 'guess' }), /^source: use document or illustrative/);
  has(
    scatterWith({
      points: [
        { label: 'a', x: 1, y: 1 },
        { label: 'a', x: 2, y: 2 },
        { label: 'c', x: 3, y: 3 },
      ],
    }),
    /point 2: the label "a" is used twice/,
  );
  has(
    scatterWith({
      points: [
        { label: 'x'.repeat(25), x: 1, y: 1 },
        { label: 'b', x: 2, y: 2 },
        { label: 'c', x: 3, y: 3 },
      ],
    }),
    /longer than 24 characters/,
  );
  has(
    scatterWith({
      points: [
        { label: 'a', x: 1, y: NaN },
        { label: 'b', x: 2, y: 2 },
        { label: 'c', x: 3, y: 3 },
      ],
    }),
    /point 1: x and y must both be finite/,
  );
  has(
    scatterWith({
      x_log: true,
      points: [
        { label: 'zero', x: 0, y: 1 },
        { label: 'b', x: 2, y: 2 },
        { label: 'c', x: 3, y: 3 },
      ],
    }),
    /x_log: .*"zero" has x = 0/,
  );
  assert.deepEqual(scatterWith({ y_log: true }), []);
  has(
    scatterWith({
      points: [
        { label: 'a', x: 5, y: 1 },
        { label: 'b', x: 5, y: 2 },
        { label: 'c', x: 5, y: 3 },
      ],
    }),
    /every point has the same x/,
  );
  const series = ['one', 'two', 'three', 'four'].map((name, i) => ({ label: name, x: i, y: i * 2, series: name }));
  has(scatterWith({ points: series }), /^points: use at most 3 different series, not 4/);
  assert.deepEqual(scatterWith({ points: series.slice(0, 3) }), []);
});

test('shapes: a product with matching inner dimensions gives the outer ones', () => {
  const terms = [m('A', 'n', 'd_k'), op('times'), m('B^T', 'd_k', 'n'), op('equals'), m('C', 'n', 'n')];
  assert.deepEqual(shapesProblems({ kind: 'shapes', ...shapes(...terms) }), []);
  assert.deepEqual(shapesRunning(terms), [
    { rows: 'n', cols: 'd_k' },
    { rows: 'n', cols: 'd_k' },
    { rows: 'n', cols: 'n' },
    { rows: 'n', cols: 'n' },
    { rows: 'n', cols: 'n' },
  ]);
  const { item, problems } = checkBoard('shapes', { ...shapes(...terms), title: ' Pairwise scores ' });
  assert.deepEqual(problems, []);
  assert.deepEqual(item, { kind: 'shapes', title: 'Pairwise scores', terms });
  // One focus part per matrix.
  assert.equal(boardParts(item!), 3);
  assert.equal(boardPart(item!, 'matrix-3'), 2);
});

test('shapes: dimension mismatches name the term and both sizes', () => {
  const times = shapesProblems({ kind: 'shapes', ...shapes(m('A', 'n', 'd_k'), op('times'), m('B', 'n', 'd_k')) });
  assert.deepEqual(times, [
    'term 3: times needs the columns of the left side (d_k) to equal the rows of this matrix (n); fix a dimension or the order',
  ]);
  has(
    shapesProblems({ kind: 'shapes', ...shapes(m('A', 'n', 'd'), op('plus'), m('B', 'd', 'n')) }),
    /^term 3: plus needs equal shapes, but the left side is n x d and this matrix is d x n$/,
  );
  has(
    shapesProblems({ kind: 'shapes', ...shapes(m('A', 'n', 'd'), op('hadamard'), m('B', 'n', 'm')) }),
    /^term 3: hadamard needs equal shapes/,
  );
  has(
    shapesProblems({
      kind: 'shapes',
      ...shapes(m('A', 'n', 'k'), op('times'), m('B', 'k', 'm'), op('equals'), m('C', 'n', 'k')),
    }),
    /^term 5: after equals this matrix must have the computed shape n x m, not n x k$/,
  );
  has(
    shapesProblems({ kind: 'shapes', ...shapes(m('S', 'n', 'n'), op('apply', 'softmax'), m('P', 'n', '1')) }),
    /^term 3: apply keeps the shape n x n/,
  );
  // The running result, not just the neighbour, is what the next product multiplies.
  assert.deepEqual(
    shapesProblems({
      kind: 'shapes',
      ...shapes(
        m('A', 'n', 'k'),
        op('times'),
        m('B', 'k', 'm'),
        op('times'),
        m('C', 'm', 'p'),
        op('equals'),
        m('D', 'n', 'p'),
      ),
    }),
    [],
  );
  // Softmax keeps the shape, so a weighted sum of values continues from there.
  const attention = [
    m('S', 'n', 'n'),
    op('apply', 'softmax'),
    m('P', 'n', 'n'),
    op('times'),
    m('V', 'n', 'd_v'),
    op('equals'),
    m('O', 'n', 'd_v'),
  ];
  assert.deepEqual(shapesProblems({ kind: 'shapes', ...shapes(...attention) }), []);
  assert.deepEqual(shapesRunning(attention).at(-1), { rows: 'n', cols: 'd_v' });
});

test('shapes: structure and spelling problems', () => {
  const ok = [m('A', 'n', 'k'), op('times'), m('B', 'k', 'm')];
  has(shapesProblems({ kind: 'shapes', terms: ok.slice(0, 2) }), /^terms: give 3 to 9 terms/);
  has(shapesProblems({ kind: 'shapes', terms: [...ok, op('equals')] }), /end with a matrix/);
  has(
    shapesProblems({ kind: 'shapes', terms: [ok[0], ok[2], ok[1]] }),
    /^term 2: this place needs an operator \(kind op\); alternate matrix, operator, matrix$/,
  );
  has(
    shapesProblems({ kind: 'shapes', terms: [m('A'.repeat(41), 'n', 'k'), ok[1], ok[2]] }),
    /term 1: name must be 1 to 40/,
  );
  has(
    shapesProblems({ kind: 'shapes', terms: [m('A', 'much too long', 'k'), ok[1], ok[2]] }),
    /term 1: rows must be 1 to 8/,
  );
  has(
    shapesProblems({ kind: 'shapes', terms: [ok[0], { kind: 'op', op: 'divide' }, ok[2]] }),
    /term 2: op must be one of/,
  );
  has(shapesProblems({ kind: 'shapes', terms: [ok[0], op('apply'), m('B', 'n', 'k')] }), /term 2: apply needs a label/);
  has(
    shapesProblems({ kind: 'shapes', terms: [ok[0], op('apply', 'a function name that is long'), m('B', 'n', 'k')] }),
    /term 2: label must be at most 16 characters/,
  );
  const ten = Array.from({ length: 11 }, (_, i) => (i % 2 ? op('plus') : m('A', 'n', 'n')));
  has(
    shapesProblems({ kind: 'shapes', terms: ten }),
    /^terms: give 3 to 9 terms alternating matrix, operator, matrix, not 11/,
  );
  // Numbers as dimensions are fine, as are plain numeric sizes.
  assert.deepEqual(
    shapesProblems({
      kind: 'shapes',
      terms: [m('W', '64', '512'), op('times'), { kind: 'matrix', name: 'x', rows: 512, cols: '1' }],
    }),
    [],
  );
});

test('every new board offers its focus IDs, and questions and example frames keep the older kinds', () => {
  assert.deepEqual(
    boardPartIds('heatmap'),
    Array.from({ length: 10 }, (_, i) => `row-${i + 1}`),
  );
  assert.deepEqual(
    boardPartIds('scatter'),
    Array.from({ length: 10 }, (_, i) => `point-${i + 1}`),
  );
  assert.deepEqual(
    boardPartIds('shapes'),
    Array.from({ length: 5 }, (_, i) => `matrix-${i + 1}`),
  );
  assert.deepEqual([...LEGACY_BOARD_KINDS], ['formula', 'flow', 'bars', 'plot', 'scene']);
  for (const kind of ['heatmap', 'scatter', 'shapes'] as const) assert.ok(BOARD_KINDS.includes(kind), kind);
});

test('an empty board of a new kind means no board, and a broken one reports problems', () => {
  assert.deepEqual(checkBoard('heatmap', { rows: [], cols: [], values: [] }), { item: null, problems: [] });
  assert.deepEqual(checkBoard('scatter', { points: [] }), { item: null, problems: [] });
  assert.deepEqual(checkBoard('shapes', { terms: [] }), { item: null, problems: [] });
  for (const kind of ['heatmap', 'scatter', 'shapes'] as const) {
    assert.deepEqual(checkBoard(kind, 'text').item, null);
    assert.ok(checkBoard(kind, 'text').problems.length, kind);
  }
  assert.equal(checkBoard('heatmap', { ...heatmap(), rows: ['a'] }).item, null);
});

test('provider schemas are flat JSON Schema and accept the valid items', () => {
  const ajv = new Ajv2020({ strict: false });
  const valid = {
    heatmap: heatmap(),
    scatter: scatter(),
    shapes: shapes(m('A', 'n', 'k'), op('times'), m('B', 'k', 'm'), op('apply', 'softmax'), m('C', 'n', 'm')),
  };
  for (const [kind, schema] of [
    ['heatmap', HEATMAP_SCHEMA],
    ['scatter', SCATTER_SCHEMA],
    ['shapes', SHAPES_SCHEMA],
  ] as const) {
    assert.equal(boardSchema(kind), schema);
    assert.doesNotMatch(JSON.stringify(schema), /\$ref|oneOf|anyOf|allOf/, kind);
    assert.equal(schema.additionalProperties, false);
    const validate = ajv.compile(schema);
    const item = { kind, ...valid[kind] };
    assert.equal(validate(item), true, `${kind} ${JSON.stringify(validate.errors)}`);
    assert.equal(validate({ ...item, extra: 1 }), false, kind);
  }
  const validate = ajv.compile(HEATMAP_SCHEMA);
  assert.equal(
    validate({ kind: 'heatmap', rows: ['a', 'b'], cols: ['c', 'd'], source: 'formula', expression: 'x*a' }),
    true,
  );
  assert.equal(validate({ ...heatmap(), kind: 'heatmap', rows: ['a'] }), false);
});

test('the saved-tour schema accepts the checked items of the new kinds and rejects broken ones', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schema/tour.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const tour = (item: unknown) => ({
    schema: 'paper-tour/tour@0.1',
    title: 'Boards',
    paper: 'test',
    chapters: [{ id: 'c', title: 'C', steps: [{ id: 's', say: 'Look at this.', actions: [{ type: 'board', item }] }] }],
  });
  const items = [
    checkBoard('heatmap', { ...heatmap(), normalize: 'rows', view: 'links', scale: 'sequential' }).item,
    checkBoard('heatmap', { ...heatmap(), source: 'formula', expression: 'x/a', values: undefined }).item,
    checkBoard(
      'scatter',
      { ...scatter(), x_log: true, points: scatter().points.map((p) => ({ ...p, series: 'run' })) },
      SCATTER_EVIDENCE,
    ).item,
    checkBoard('shapes', shapes(m('A', 'n', 'k'), op('times'), m('B', 'k', 'm'), op('equals'), m('C', 'n', 'm'))).item,
  ];
  for (const item of items) {
    assert.ok(item);
    assert.equal(validate(tour(item)), true, `${item.kind} ${JSON.stringify(validate.errors?.slice(0, 3))}`);
  }
  assert.equal(validate(tour({ kind: 'heatmap', rows: ['a', 'b'], cols: ['c', 'd'], source: 'illustrative' })), false);
  assert.equal(validate(tour({ kind: 'scatter', x_label: 'x', y_label: 'y', points: [], source: 'document' })), false);
  assert.equal(
    validate(
      tour({ kind: 'shapes', terms: [{ kind: 'matrix', name: 'A', cols: 'k' }, op('times'), m('B', 'k', 'm')] }),
    ),
    false,
  );
});
