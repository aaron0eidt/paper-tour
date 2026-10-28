import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateExpression as run,
  parseExpression as parse,
  plotProblems,
  plotSegments,
  PLOT_SCHEMA,
  type PlotItem,
} from '../../shared/plot';
import { checkBoard, boardParts } from '../src/harness/board';
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
