import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc, DocBlock } from '../../shared/paper';
import { readingObjects, readingUnits } from '../../shared/reading';
import { readingObject, readingExplanationQuestion, prepareReadingPassage } from '../src/reading-speech';

const block = (id: string, text: string, top: number, type: DocBlock['type'] = 'paragraph'): DocBlock =>
  ({ id, text, type, page: 1, bbox: [40, top, 400, top + 12], sentences: [] });
const document = (blocks: DocBlock[]): Doc => ({ schema: 'paper-tour/doc@0.1',
  source: { file: 'test.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }], blocks, sentences: [], sections: [], figures: [], equations: [] });
const algorithm = [
  block('title', 'Procedure 2: Adaptive search', 40, 'heading'),
  block('input', 'Input: initial state z, tolerance epsilon.', 54),
  block('body', '1. Set z = 0; while error > epsilon do', 68),
  block('update', '2. Update z = z + delta;', 82, 'equation'),
  block('end', 'end', 96),
  block('output', 'Output: final state z', 110),
];

test('a complete procedure replaces its prose, embedded formula and closing/output lines with one explanation', async () => {
  const after = block('after', 'The following result uses the final state.', 140);
  const doc = document([...algorithm, after]);
  const objects = readingObjects(doc);
  assert.equal(objects.length, 1);
  assert.deepEqual(objects[0], { id: 'reading-procedure:title', kind: 'procedure', page: 1,
    bbox: [40, 40, 400, 122], blocks: algorithm.map((b) => b.id) });
  assert.deepEqual(readingUnits(doc).map((u) => u.id), ['reading-procedure:title', 'after']);
  assert.equal(readingObject(doc, objects[0].id).kind, 'procedure');
  await assert.rejects(prepareReadingPassage({ doc, targetId: objects[0].id, language: 'en-US',
    client: { complete: async () => { throw new Error('Must use the visual explanation route'); } } }), /explanation workflow/);
  assert.match(readingExplanationQuestion('procedure', objects[0].id), /Do not read code punctuation/);
});

test('unlabelled code and numbered calculations are recognized from control flow and assignments', () => {
  for (const text of [
    'def accumulate(values): total = 0; for v in values: total = total + v; return total',
    'Input: state x. for each observation do x = x + delta; end Output: x',
    '1. Set a = 0; 2. Compute b = a + 1;',
    'Algorithm 2: θ = θ + δ;',
  ]) assert.equal(readingObjects(document([block('code', text, 40)]))[0]?.kind, 'procedure');
});

test('algorithm mentions, headings and ordinary mathematical prose retain their original reading contract', () => {
  for (const text of [
    'Algorithm 1 describes the update method used in the experiment.',
    'Algorithm comparison',
    'For each expert, x = 1 and y = 2 denote the measured values.',
    'Input: the original document is provided by the user.',
    'First we describe the motivation. Second we compare the results.',
  ]) {
    const doc = document([block('prose', text, 40)]);
    assert.equal(readingObjects(doc).length, 0);
    assert.equal(readingUnits(doc)[0].object, undefined);
  }
});

test('grouping stops at another column, section, page, caption or following narrative', () => {
  const first = block('code', 'Input: x. for each item do x = x + 1; end', 40);
  const candidates: DocBlock[] = [
    { ...block('other', 'Output: y', 54), bbox: [420, 54, 560, 66] },
    { ...block('other', 'Output: y', 54), section: 'new' },
    { ...block('other', 'Output: y', 54), page: 2 },
    block('other', 'Output: y', 54, 'caption'),
    block('other', 'The next paragraph explains the result.', 54),
    block('other', 'Algorithm 3: Input: y. y = y + 1;', 54),
  ];
  for (const candidate of candidates) {
    const doc = document([first, candidate]);
    assert.deepEqual(readingObjects(doc)[0].blocks, ['code']);
  }
});

test('content already owned by a source table stays in that table explanation', () => {
  const doc = document([block('code', 'Input: x. for each item do x = x + 1; end', 40, 'table_text')]);
  doc.figures = [{ id: 'table', kind: 'table', page: 1, number: '1', bbox: [30, 30, 410, 70],
    caption: '', image: 'table.png', panels: [], referenced_by: [] }];
  assert.deepEqual(readingObjects(doc).map((o) => o.kind), ['table']);
});
