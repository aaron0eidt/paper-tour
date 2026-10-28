import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc, Step } from '../../shared/paper';
import { insightStep, printedAt, readsSource } from '../src/harness/insight';

const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  equations: [],
  blocks: ['Encoder stack', 'Weighted sum', 'Output'].map((text, i) => ({
    id: `p1.b${i}`,
    page: 1,
    type: 'paragraph',
    text,
    bbox: [10, 100 + i * 40, 80, 120 + i * 40],
    sentences: [],
  })),
  sentences: [
    {
      id: 'p1.s1',
      page: 1,
      block: 'p1.b0',
      text: 'The encoder transforms each input into a contextual representation which the decoder can use to generate an output sequence.',
      rects: [[10, 10, 100, 20]],
    },
  ],
  figures: [
    {
      id: 'fig1',
      kind: 'figure',
      number: '1',
      page: 1,
      bbox: [0, 90, 300, 300],
      caption: 'A toy network',
      image: 'figures/f.png',
      panels: [],
      referenced_by: [],
    },
  ],
};
test('pen labels and a redundant flow are removed but the pointing mark and informative labels survive', () => {
  const step: Step = {
    id: 'a',
    say: 'A contextual representation lets later stages consider the whole sequence.',
    actions: [
      { type: 'zoom', target: 'fig1' },
      { type: 'arrow', target: 'fig1', label: 'Encoder stack' },
      { type: 'circle', target: 'fig1', label: 'Shares context' },
      {
        type: 'board',
        item: {
          kind: 'flow',
          nodes: ['Encoder stack', 'Weighted sum', 'Output'].map((label, i) => ({ id: String(i), label })),
          edges: [
            ['0', '1'],
            ['1', '2'],
          ],
        },
      },
      { type: 'board_focus', part: 0 },
    ],
  };
  const result = insightStep(step, doc);
  assert.equal('label' in result.actions[1], false);
  assert.equal((result.actions[2] as { label: string }).label, 'Shares context');
  assert.equal(
    result.actions.some((a) => a.type === 'board' || a.type === 'board_focus'),
    false,
  );
  assert.equal(step.actions.length, 5, 'does not mutate authored input');
});
test('regions do not pick up labels from an unrelated part of a figure', () => {
  assert.match(printedAt(doc, 'fig1', [0, 0, 1, 0.25]), /Encoder stack/);
  assert.doesNotMatch(printedAt(doc, 'fig1', [0, 0, 1, 0.25]), /Output/);
});
test('detects reading the source with punctuation changes while keeping a real explanation', () => {
  assert.equal(readsSource(doc.sentences[0].text.replace('encoder', 'ENCODER'), doc), true);
  assert.equal(
    readsSource(
      'Context removes ambiguity: a word can acquire a different representation depending on the words around it, rather than always keeping one fixed meaning.',
      doc,
    ),
    false,
  );
});
