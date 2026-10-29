import test from 'node:test';
import assert from 'node:assert/strict';
import { BOARD_KINDS, boardPart, boardPartIds, boardParts, checkBoard, type BoardKind } from '../src/harness/board';

// One authored payload per tool exercises dispatch, source checking and focus wiring together.
const inputs = {
  formula: {
    latex: 'y=2x',
    terms: [
      { latex: 'y', label: 'output' },
      { latex: '2x', label: 'double input' },
    ],
  },
  flow: {
    nodes: [
      { id: 'node-3', label: 'Input' },
      { id: 'node-1', label: 'Transform' },
      { id: 'node-2', label: 'Result' },
    ],
    edges: [
      { from: 'node-3', to: 'node-1' },
      { from: 'node-1', to: 'node-2' },
    ],
  },
  bars: {
    bars: [
      { label: 'Before', value: -2 },
      { label: 'After', value: 4 },
    ],
  },
  plot: { x: [-1, 1], y: [0, 1], curves: [{ expression: 'x^2', label: 'square' }] },
  scene: { objects: [{ id: 'components', type: 'matrix', x: 0.2, y: 0.3, w: 0.6, h: 0.4, values: [[2, 4]] }] },
  heatmap: {
    rows: ['first', 'second'],
    cols: ['left', 'right'],
    values: [
      [1, 3],
      [2, 2.5],
    ],
    source: 'illustrative',
  },
  scatter: {
    x_label: 'cost (hours)',
    y_label: 'score',
    points: [
      { label: 'cheap', x: 1, y: 40 },
      { label: 'fair', x: 4, y: 58 },
      { label: 'pricey', x: 9, y: 70 },
    ],
    source: 'illustrative',
  },
  shapes: {
    terms: [
      { kind: 'matrix', name: 'A', rows: 'm', cols: 'k' },
      { kind: 'op', op: 'times' },
      { kind: 'matrix', name: 'B', rows: 'k', cols: 'n' },
    ],
  },
  timeline: {
    unit: 'month',
    source: 'illustrative',
    anchor: { label: 'Start' },
    events: [
      { label: 'Notice allowed', after: 'Start', offset: 3 },
      { label: 'Earliest exit', after: 'Notice allowed', offset: 3 },
    ],
    spans: [{ label: 'Notice runs', from: 'Notice allowed', to: 'Earliest exit', role: 'notice' }],
  },
  distribution: {
    x_label: 'waiting time (min)',
    source: 'illustrative',
    dists: [
      { family: 'exponential', label: 'One counter', mean: 8 },
      { family: 'exponential', label: 'Two counters', mean: 4 },
    ],
    region: { from: 10 },
  },
} satisfies Record<BoardKind, unknown>;

test('each registered visualization dispatches to its own validator and offers usable focus IDs', () => {
  for (const kind of BOARD_KINDS) {
    const checked = checkBoard(kind, inputs[kind], 'Before -2; after 4; components 2 and 4.');
    assert.deepEqual(checked.problems, [], kind);
    assert.ok(checked.item, kind);
    assert.equal(checked.item.kind, kind);
    const resolved = boardPartIds(kind)
      .map((id) => boardPart(checked.item!, id))
      .filter((index) => index >= 0);
    assert.deepEqual(
      [...resolved].sort((a, b) => a - b),
      Array.from({ length: boardParts(checked.item) }, (_, i) => i),
      kind,
    );
    assert.equal(boardPart(checked.item, 'not-a-part'), -1, kind);
  }
});

test('a plot, a timeline and a distribution offer their parts in the order the board lights them', () => {
  const plot = checkBoard('plot', {
    x: [0, 20],
    y: [0, 400],
    curves: [
      { expression: 'x*x', label: 'square' },
      { expression: '10*x', label: 'line' },
    ],
    marks: [{ type: 'crossing', curve: 1, other: 2, nth: 2 }],
  }).item!;
  assert.deepEqual(boardPartIds('plot'), ['curve-1', 'curve-2', 'curve-3', 'mark-1', 'mark-2', 'mark-3', 'mark-4']);
  assert.equal(boardPart(plot, 'curve-2'), 1);
  assert.equal(boardPart(plot, 'mark-1'), 2);
  assert.equal(boardPart(plot, 'mark-2'), -1, 'a mark that was not asked for is not a part');
  const timeline = checkBoard('timeline', inputs.timeline).item!;
  assert.deepEqual(
    [boardPart(timeline, 'event-2'), boardPart(timeline, 'span-1'), boardPart(timeline, 'span-2')],
    [1, 2, -1],
    'the events come first, then the spans',
  );
  const distribution = checkBoard('distribution', inputs.distribution).item!;
  assert.deepEqual(
    ['dist-1', 'dist-2', 'region'].map((id) => boardPart(distribution, id)),
    [0, 1, 2],
  );
  const single = checkBoard('distribution', { ...inputs.distribution, dists: [inputs.distribution.dists[0]] }).item!;
  assert.equal(boardPart(single, 'dist-2'), -1);
  assert.equal(boardPart(single, 'region'), 1);
});

test('flow focus follows actual displayed node order rather than numeric ID order', () => {
  const { item } = checkBoard('flow', inputs.flow);
  assert.ok(item);
  assert.equal(boardPart(item, 'node-3'), 0);
  assert.equal(boardPart(item, 'node-1'), 1);
  assert.equal(boardPart(item, 'node-2'), 2);
});

test('the newer kinds dispatch with the evidence, so document values must be printed and illustrative ones need not be', () => {
  const printed = 'Table 2: tiny 3 and 28, small 9 and 21, large 40 and 15. Weights 0.9 0.1 0.2 0.8.';
  const document = {
    heatmap: {
      ...inputs.heatmap,
      values: [
        [0.9, 0.1],
        [0.2, 0.8],
      ],
      source: 'document',
    },
    scatter: {
      ...inputs.scatter,
      points: [
        { label: 'tiny', x: 3, y: 28 },
        { label: 'small', x: 9, y: 21 },
        { label: 'large', x: 40, y: 15 },
      ],
      source: 'document',
    },
  };
  for (const kind of ['heatmap', 'scatter'] as const) {
    assert.deepEqual(checkBoard(kind, document[kind], printed).problems, [], kind);
    assert.ok(checkBoard(kind, document[kind], printed).item, kind);
    const invented = checkBoard(kind, document[kind], 'Table 2 prints nothing useful.');
    assert.equal(invented.item, null, kind);
    assert.match(invented.problems.join(' '), /not printed in the evidence/, kind);
    assert.ok(checkBoard(kind, { ...document[kind], source: 'illustrative' }, '').item, kind);
  }
});

test('a shapes board whose matrix name KaTeX cannot render is refused', () => {
  const broken = { terms: inputs.shapes.terms.map((term, i) => (i === 0 ? { ...term, name: '\\frac{' } : term)) };
  const { item, problems } = checkBoard('shapes', broken);
  assert.equal(item, null);
  assert.match(problems.join(' '), /term 1: the name "\\frac\{" cannot be rendered as LaTeX/);
});
