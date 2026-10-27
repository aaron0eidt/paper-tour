import test from 'node:test';
import assert from 'node:assert/strict';
import { indexElements } from '../src/elements';
import type { Doc } from '../../shared/paper';
export function sampleDoc(): Doc {
  return {
    schema: 'paper-tour/doc@0.1',
    source: {
      file: 'paper.pdf',
      sha256: 'a'.repeat(64),
      num_pages: 1,
      generator: 'test',
    },
    pages: [{ n: 1, width: 600, height: 800 }],
    sections: [{ id: 'sec-method', title: 'Method', level: 1, page: 1, block: 'p1.b1' }],
    blocks: [
      {
        id: 'p1.b1',
        page: 1,
        type: 'paragraph',
        bbox: [10, 10, 100, 40],
        text: 'Attention weights explain the figure.',
        sentences: ['p1.s1'],
      },
    ],
    sentences: [
      {
        id: 'p1.s1',
        page: 1,
        block: 'p1.b1',
        text: 'Attention weights explain the figure.',
        rects: [
          [10, 10, 100, 20],
          [10, 25, 80, 40],
        ],
      },
    ],
    figures: [
      {
        id: 'fig1',
        kind: 'figure',
        number: '1',
        page: 1,
        bbox: [10, 50, 200, 200],
        caption: 'Attention matrix',
        caption_block: 'p1.b1',
        image: 'figures/fig1.png',
        panels: [{ id: 'fig1.a', bbox: [10, 50, 100, 200] }],
        referenced_by: ['p1.s1'],
      },
    ],
    equations: [],
  };
}
test('the index preserves element IDs, geometry and figure relationships', () => {
  const elements = indexElements(sampleDoc());
  assert.equal(elements.length, 6);
  assert.deepEqual(elements.find((e) => e.id === 'p1.s1')?.bbox, [10, 10, 100, 40]);
  assert.deepEqual(elements.find((e) => e.id === 'fig1')?.data.referenced_by, ['p1.s1']);
  assert.equal(elements.find((e) => e.id === 'fig1.a')?.data.figure, 'fig1');
});
test('duplicate IDs are rejected before a publication transaction', () => {
  const doc = sampleDoc();
  doc.sections[0].id = 'p1.b1';
  assert.throws(() => indexElements(doc), /Duplicate/);
});
