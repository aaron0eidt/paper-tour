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

test('flow focus follows actual displayed node order rather than numeric ID order', () => {
  const { item } = checkBoard('flow', inputs.flow);
  assert.ok(item);
  assert.equal(boardPart(item, 'node-3'), 0);
  assert.equal(boardPart(item, 'node-1'), 1);
  assert.equal(boardPart(item, 'node-2'), 2);
});
