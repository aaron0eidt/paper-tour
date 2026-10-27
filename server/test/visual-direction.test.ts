import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ROOT } from '../src/config';
import { validateVisualDirection, visualFrame, checkComponents } from '../src/muse/visual-direction';
import { materializeTour, type TourDraft } from '../src/muse/schema';
import type { Doc, Tour, Region } from '../../shared/paper';
const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'x.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  blocks: [
    {
      id: 'p1.b1',
      page: 1,
      bbox: [0, 0, 80, 20],
      type: 'paragraph',
      text: 'Two stages are connected by an arrow.',
      sentences: ['p1.s1'],
    },
  ],
  sentences: [
    { id: 'p1.s1', page: 1, block: 'p1.b1', text: 'Two stages are connected by an arrow.', rects: [[0, 0, 80, 20]] },
  ],
  equations: [],
  figures: [
    {
      id: 'fig1',
      kind: 'figure',
      page: 1,
      number: '1',
      bbox: [100, 100, 300, 300],
      caption: 'Two stages',
      image: 'fig1.png',
      panels: [
        { id: 'fig1.a', bbox: [100, 100, 180, 300] },
        { id: 'fig1.b', bbox: [220, 100, 300, 300] },
      ],
      referenced_by: ['p1.s1'],
    },
  ],
};
const left: Region = [0, 0, 0.4, 1],
  right: Region = [0.6, 0, 1, 1];
const observations = {
  fig1: {
    readable: true,
    components: [
      { label: 'Input', region: left },
      { label: 'Output', region: right },
    ],
  },
};
function draft(): TourDraft {
  return {
    title: 'Stages',
    chapters: [
      {
        id: 'stages',
        title: 'Stages',
        steps: [
          {
            id: 'input',
            source: 'fig1',
            evidence: ['fig1', 'p1.s1'],
            say: 'First locate the input stage on the left.',
            actions: [
              { type: 'zoom', target: 'fig1' },
              { type: 'box', target: 'fig1', region: left, label: 'Input', at_word: 3 },
              { type: 'highlight', targets: ['p1.s1'], at_word: 3 },
            ],
          },
          {
            id: 'output',
            source: 'fig1',
            evidence: ['fig1'],
            say: 'Then follow the connection to the output on the right.',
            actions: [
              { type: 'zoom', target: 'fig1' },
              { type: 'spotlight', target: 'fig1', region: right, at_word: 6 },
            ],
          },
        ],
      },
    ],
  };
}
test('a whole-figure box cannot claim to identify one component', () => {
  const d = draft();
  d.chapters[0].steps[0].actions = [
    { type: 'zoom', target: 'fig1' },
    { type: 'box', target: 'fig1', label: 'Encoder stack' },
  ];
  assert.throws(
    () => validateVisualDirection(d, doc, observations, true),
    (error) => JSON.stringify((error as any).problems).includes('Encoder stack'),
  );
});
test('multi-part diagrams need separate explanations, component regions and spoken-word timing', () => {
  assert.doesNotThrow(() => validateVisualDirection(draft(), doc, observations));
  const coarse = draft();
  coarse.chapters[0].steps = coarse.chapters[0].steps.slice(0, 1);
  assert.throws(
    () => validateVisualDirection(coarse, doc, observations),
    (e) => JSON.stringify((e as any).problems).includes('Output'),
  );
  const untimed = draft();
  untimed.chapters[0].steps.flatMap((s) => s.actions).forEach((a) => (a.at_word = 0));
  assert.throws(
    () => validateVisualDirection(untimed, doc, observations),
    (e) => JSON.stringify((e as any).problems).includes('at_word'),
  );
});
test('existing panel IDs keep their coordinate frame when the source is their containing figure', () => {
  const d = draft();
  d.chapters[0].steps[0].actions[0] = { type: 'zoom', target: 'fig1.a', region: [0.1, 0.1, 0.8, 0.9] };
  const result = materializeTour(d, doc, 'test', 'en-US');
  assert.deepEqual(result.tour.chapters[0].steps[0].actions[0], {
    type: 'zoom',
    target: 'fig1.a',
    region: [0.1, 0.1, 0.8, 0.9],
  });
  assert.deepEqual(visualFrame(doc, 'fig1').panels, [
    { id: 'fig1.a', region: left },
    { id: 'fig1.b', region: right },
  ]);
  assert.throws(() => checkComponents([{ label: 'Invalid', region: [0.8, 0.8, 0.2, 0.2] }]), /positive area/);
});
test('the original handcrafted MVP figure direction remains the quality reference', () => {
  const original = JSON.parse(readFileSync(resolve(ROOT, 'demo/attention/tour.json'), 'utf8')) as Tour;
  const steps = original.chapters.flatMap((c) => c.steps);
  const annotations = steps
    .flatMap((s) => s.actions)
    .filter((a) => a.type === 'box' && a.target === 'fig1' && a.label && a.region);
  const components = annotations.map((a) => ({
    label: a.type === 'box' ? a.label! : '',
    region: 'region' in a ? a.region! : left,
  }));
  const reference: TourDraft = {
    title: original.title,
    chapters: original.chapters.map((c) => ({
      ...c,
      steps: c.steps.map((s) => ({ ...s, source: 'fig1', evidence: ['fig1'] })),
    })),
  };
  assert.doesNotThrow(() =>
    validateVisualDirection(
      reference,
      { ...doc, figures: [{ ...doc.figures[0], panels: [] }] },
      { fig1: { readable: true, components } },
    ),
  );
  assert(steps.flatMap((s) => s.actions).filter((a) => (a.at_word ?? 0) > 0).length > 80);
});

test('a prose anchor cannot silently change a visual camera coordinate frame', () => {
  const d = draft();
  d.chapters[0].steps[0].source = 'p1.s1';
  assert.throws(
    () => validateVisualDirection(d, doc, observations, true),
    (error) => JSON.stringify((error as any).problems).includes('coordinate frame'),
  );
});
