import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc, Region } from '../../shared/paper';
import { beatBrief, beatTargets, cleanDirection, directionSchema } from '../src/harness/direct';
import { beatStep } from '../src/harness/assemble';
import type { Beat } from '../src/harness/beats';
import { answerSchema, askContext, buildAnswer, retrieve, type AnswerContext } from '../src/harness/ask';
import { exactBounds, figureFrameText, figureTextTargets, groundedVisualMark } from '../src/harness/visual-grounding';
import type { MeasuredTarget } from '../src/harness/visual-grounding';

const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  sentences: [],
  equations: [],
  blocks: [
    { id: 'p1.b1', page: 1, type: 'figure_text', bbox: [140, 230, 200, 250], text: 'Mixer', sentences: [] },
    { id: 'outside', page: 1, type: 'figure_text', bbox: [0, 100, 90, 120], text: 'Other drawing', sentences: [] },
    { id: 'caption', page: 1, type: 'caption', bbox: [100, 200, 200, 220], text: 'Figure caption', sentences: [] },
    {
      id: 'crossing',
      page: 1,
      type: 'figure_text',
      bbox: [80, 230, 150, 250],
      text: 'Crosses crop edge',
      sentences: [],
    },
  ],
  figures: [
    {
      id: 'fig1',
      kind: 'figure',
      number: '1',
      page: 1,
      bbox: [100, 200, 500, 600],
      caption: 'A signal pipeline.',
      image: 'figures/fig1.png',
      panels: [{ id: 'fig1.a', bbox: [100, 200, 300, 600], label: 'Left stages' }],
      referenced_by: [],
    },
  ],
};
const beat: Beat = {
  id: 'figure-1',
  kind: 'figure',
  arc: 'method',
  target: 'fig1',
  point: 'Explain how the mixer combines inputs.',
  evidence: [],
};
const say = 'The mixer combines the two input signals before the result reaches the next stage.';
const bounds: Region = [0.11, 0.08, 0.28, 0.16];
const cue = { action: 'arrow', target: 'fig1', region: 'whole', bounds, label: '', anchor: 'mixer combines' };
const raw = (cues: unknown[]) => ({ plan: 'Explain the visible mixer.', say, cues });
const seenTargets = () => ({ ...beatTargets(beat, doc), imaged: 'fig1' });

test('exact visual bounds reject malformed or out-of-frame coordinates without clamping', () => {
  assert.deepEqual(exactBounds(bounds), bounds);
  for (const value of [
    [0, 0, 0, 1],
    [0.8, 0, 0.2, 1],
    [-0.1, 0, 1, 1],
    [0, 0, 1.1, 1],
    [0, 0, Infinity, 1],
    [0, 0, NaN, 1],
    [0, 0, 1],
    ['0', 0, 1, 1],
    null,
  ])
    assert.equal(exactBounds(value), undefined);
});

test('the image frame exposes panel coordinates and only detected text inside the actual crop', () => {
  assert.deepEqual(
    figureTextTargets(doc, doc.figures[0]).map((b) => b.id),
    ['p1.b1'],
  );
  assert.deepEqual(seenTargets().visuals, ['fig1', 'fig1.a', 'p1.b1']);
  const frame = figureFrameText(doc, doc.figures[0]);
  assert.match(frame, /\[fig1.a\].*\[0,0,0.5,1\]/);
  assert.match(frame, /\[p1.b1\].*\[0.1,0.075,0.25,0.125\]/);
  assert.doesNotMatch(frame, /\[outside\]|\[caption\]|\[crossing\]/);
  assert.match(beatBrief(beat, doc, seenTargets()), /Cue bounds are relative to the chosen TARGET/);
  assert.equal(
    (directionSchema(beat, seenTargets()).properties.cues.items.properties as { bounds?: { type: string } }).bounds
      ?.type,
    'array',
  );
  assert.equal(
    (directionSchema(beat, beatTargets(beat, doc)).properties.cues.items.properties as { bounds?: unknown }).bounds,
    undefined,
  );
});

test('tour authoring preserves precise bounds and old regions, while unseen fine marks require correction', () => {
  const targets = seenTargets();
  const direction = cleanDirection(raw([cue]), beat, targets)!;
  const step = beatStep(beat, targets, direction, doc);
  assert.deepEqual(
    step.actions.find((a) => a.type === 'arrow'),
    { type: 'arrow', target: 'fig1', region: bounds, color: 'blue', at_word: 1 },
  );
  const old = cleanDirection(raw([{ ...cue, bounds: undefined, region: 'top-left' }]), beat, targets)!;
  assert.deepEqual(
    beatStep(beat, targets, old, doc).actions.find((a) => a.type === 'arrow'),
    { type: 'arrow', target: 'fig1', region: [0, 0, 0.4, 0.4], color: 'blue', at_word: 1 },
  );
  for (const testTargets of [beatTargets(beat, doc), { ...targets, imaged: 'another-figure' }]) {
    const unseen = cleanDirection(raw([cue]), beat, testTargets)!;
    assert.ok(unseen.visualProblems?.length);
    assert.throws(() => beatStep(beat, testTargets, unseen, doc), /attached figure/);
  }
  assert.deepEqual(groundedVisualMark(doc, 'fig1.a', 'circle', undefined, 'Look here', 'fig1'), {
    action: 'circle',
    label: 'Look here',
  });
  assert.deepEqual(groundedVisualMark(doc, 'p1.b1', 'arrow', undefined, 'Mixer', 'fig1'), {
    action: 'arrow',
    label: '',
  });
});

test('invalid bounds and missing spoken anchors cannot create guessed figure arrows', () => {
  const targets = seenTargets();
  const bad = cleanDirection(raw([{ ...cue, bounds: [0.8, 0.1, 0.2, 0.4], region: 'top-left' }]), beat, targets)!;
  assert.throws(() => beatStep(beat, targets, bad, doc), /bounds must/);
  const absent = cleanDirection(raw([{ ...cue, anchor: 'words never spoken' }]), beat, targets)!;
  assert.ok(beatStep(beat, targets, absent, doc).actions.every((a) => a.type !== 'arrow'));
});

test('Q&A offers and maps the same detected targets and exact crop coordinates', () => {
  const request = { question: 'Explain the mixer.', figureId: 'fig1' };
  const retrieval = retrieve(doc, request);
  assert.ok(retrieval.visuals.includes('p1.b1'));
  const context: AnswerContext = {
    doc,
    retrieval,
    documentId: 'test',
    question: request.question,
    history: [],
    evidence: '',
    imaged: 'fig1',
  };
  const value = {
    answerable: 'yes',
    steps: [raw([{ ...cue, target: 'p1.b1', bounds: [0, 0, 1, 1], label: 'Mixer' }])],
    followups: [],
  };
  const answer = buildAnswer(value, context)!;
  assert.deepEqual(
    answer.steps[0].actions.find((a) => a.type === 'arrow'),
    { type: 'arrow', target: 'p1.b1', region: [0, 0, 1, 1], color: 'pink', at_word: 1 },
  );
  assert.deepEqual(answer.steps[0].actions[0], { type: 'zoom', target: 'fig1' });
  assert.equal(buildAnswer(value, { ...context, imaged: undefined }), null);
  const schema = JSON.parse(JSON.stringify(answerSchema(retrieval, ['whole', 'left'])));
  assert.equal(schema.properties.steps.items.properties.cues.items.properties.bounds.type, 'array');
  const prompt = askContext(request, retrieval, doc, undefined, {
    targetId: 'fig1',
    kind: 'figure',
    page: 1,
    label: 'Figure 1',
    dataUrl: 'data:image/png;base64,AA==',
  });
  assert.match(prompt, /\[p1.b1\] "Mixer"/);
});

test('measured groups publish separate exact boxes, including the fourth mark, without changing document IDs', () => {
  const measured: MeasuredTarget[] = Array.from({ length: 4 }, (_, index) => ({
    id: `measured:fig1:${index + 1}`,
    target: 'fig1',
    kind: 'component',
    label: `Stage ${index + 1}`,
    region: [0.1, index * 0.2, 0.4, index * 0.2 + 0.1],
  }));
  const targets = { ...seenTargets(), measured };
  const schema = JSON.parse(JSON.stringify(directionSchema(beat, targets)));
  assert.deepEqual(schema.properties.cues.items.properties.action.enum, ['box', 'board_focus']);
  assert.equal(schema.properties.cues.items.properties.bounds, undefined);
  const before = JSON.stringify(doc);
  const group = {
    action: 'box',
    target: 'fig1',
    members: measured.map((t) => t.id),
    label: '',
    anchor: 'mixer combines',
  };
  const direction = cleanDirection(raw([group]), beat, targets)!;
  assert.deepEqual(direction.visualProblems, []);
  const boxes = beatStep(beat, targets, direction, doc).actions.filter((a) => a.type === 'box');
  assert.equal(boxes.length, 4);
  assert.deepEqual(
    boxes.map((b) => b.region),
    measured.map((t) => t.region),
  );
  assert.ok(boxes.every((b) => b.target === 'fig1'));
  assert.equal(JSON.stringify(doc), before);
  for (const bad of [
    { ...cue, action: 'box' },
    { ...group, members: ['measured:fig1:missing'] },
    { ...group, action: 'circle' },
  ])
    assert.ok(
      cleanDirection(raw([bad]), beat, targets)?.visualProblems?.length,
      'invalid geometry requests correction instead of substitution',
    );
  const retrieval = { ...retrieve(doc, { question: 'Explain the stages.', figureId: 'fig1' }), measured };
  const context: AnswerContext = {
    doc,
    retrieval,
    documentId: 'test',
    question: 'Explain the stages.',
    history: [],
    evidence: '',
    imaged: 'fig1',
  };
  const answer = buildAnswer({ answerable: 'yes', steps: [raw([group])], followups: [] }, context)!;
  assert.deepEqual(
    answer.steps[0].actions.filter((a) => a.type === 'box').map((b) => b.region),
    measured.map((t) => t.region),
  );
});
