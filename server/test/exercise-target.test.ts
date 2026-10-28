import test from 'node:test';
import assert from 'node:assert/strict';
import { Resolver } from '../../player/src/resolve';
import { indexElements } from '../src/elements';
import type { Doc } from '../../shared/paper';

test('exercise and nested part targets preserve original blocks across pages', () => {
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
    pages: [{ n: 1, width: 600, height: 800 }],
    sections: [],
    sentences: [],
    figures: [],
    equations: [],
    blocks: [{ id: 'p1.b1', page: 1, type: 'paragraph', text: 'Task', bbox: [10, 10, 100, 40], sentences: [] }],
  };
  doc.pages.push({ n: 2, width: 600, height: 800 });
  doc.source.num_pages = 2;
  doc.blocks.push({ ...doc.blocks[0], id: 'p2.b1', page: 2, sentences: [] });
  doc.exercises = [
    {
      id: 'ex1',
      number: '1',
      page: 1,
      block: 'p1.b1',
      blocks: ['p1.b1', 'p2.b1'],
      parts: [{ id: 'ex1.a', label: 'a', page: 2, blocks: ['p2.b1'] }],
    },
  ];
  const resolver = new Resolver(doc, doc.pages);
  assert.equal(resolver.kind('ex1.a'), 'exercise');
  assert.deepEqual(
    resolver.resolve('ex1')?.map((g) => g.page),
    [1, 2],
  );
  assert.equal(resolver.pageOf('ex1.a'), 2);
  assert.deepEqual(resolver.resolve('ex1.a')?.[0].rects, [doc.blocks[1].bbox]);
  assert.equal(indexElements(doc).find((e) => e.id === 'ex1.a')?.page, 2);
  assert.equal(new Resolver(doc, [doc.pages[0]]).resolve('ex1.a'), null);
});
