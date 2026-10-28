import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc, SceneItem, Tour } from '../../shared/paper';
import { checkBoard } from '../src/harness/board';
import { checkExample } from '../src/harness/example';
import { beatStep, boardProblems, tourProblems } from '../src/harness/assemble';
import { beatTargets, cleanDirection, directionSchema } from '../src/harness/direct';
import { answerProviderSchema, answerSchema, buildAnswer, retrieve } from '../src/harness/ask';
import { SCENE_SCHEMA } from '../../shared/scene';
import type { Beat } from '../src/harness/beats';

const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'p.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  blocks: [
    {
      id: 'b1',
      type: 'paragraph',
      page: 1,
      bbox: [0, 0, 400, 100],
      text: 'An illustrative transformation.',
      sentences: ['p1.s1'],
    },
  ],
  sentences: [
    { id: 'p1.s1', page: 1, block: 'b1', text: 'The operation doubles the input.', rects: [[0, 0, 400, 20]] },
  ],
  figures: [],
  equations: [],
};

test('Q&A tool schema stays within the provider nesting limit without mutating canonical validation', () => {
  const depth = (node: any): number => {
    if (!node || typeof node !== 'object') return 0;
    const children = [...Object.values(node.properties ?? {}), ...(node.items ? [node.items] : [])];
    return (node.type === 'object' || node.type === 'array' ? 1 : 0) + Math.max(0, ...children.map(depth));
  };
  const before = JSON.stringify(SCENE_SCHEMA);
  const wire = answerProviderSchema(SCENE_SCHEMA);
  assert.equal(JSON.stringify(SCENE_SCHEMA), before);
  assert.ok('items' in SCENE_SCHEMA.properties.objects.items.properties.values);
  assert.equal('items' in wire.properties.objects.items.properties.values, false);
  assert.ok(depth(answerSchema(retrieve(doc, { question: 'Explain the operation' }))) <= 10);
  assert.match(checkBoard('scene', { kind: 'scene', objects: [{
    id: 'bad', type: 'matrix', x: 0.1, y: 0.1, w: 0.7, h: 0.7, values: [['unsafe']],
  }] }).problems.join(' '), /numeric|finite|matrix/i);
});
const scene = (value: number, x: number): SceneItem => ({
  kind: 'scene',
  title: 'Illustrative scalar transformation',
  objects: [
    { id: 'quantity', type: 'matrix', x, y: 0.35, w: 0.2, h: 0.25, values: [[value]], color: 'blue' },
    { id: 'operation', type: 'math', x: 0.45, y: 0.35, w: 0.2, h: 0.25, text: '\\times 2', color: 'orange' },
  ],
});
const say =
  'In this illustrative scalar example the starting value is 2. The operation doubles it, so the result becomes 4 while the quantity moves across the board.';
const example = () => ({
  assumptions: 'Illustrative scalar input with a fixed multiplier.',
  inputs: [{ label: 'Input', value: 2 }],
  calculations: [{ expression: '2*2', result: 4 }],
  frames: [
    { anchor: 'starting value is', scene: scene(2, 0.1) },
    { anchor: 'result becomes', scene: scene(4, 0.75) },
  ],
});
const tour = (steps: Tour['chapters'][number]['steps']): Tour => ({
  schema: 'paper-tour/tour@0.1',
  title: 'Scene',
  paper: 'p',
  chapters: [{ id: 'c', title: 'Mechanism', steps }],
});

test('native scenes validate source numeric provenance, math and foreground layout', () => {
  for (const value of [null, false, 'invalid', []])
    assert.ok(
      checkBoard('scene', value).problems.length,
      'present malformed scenes cannot silently become omitted boards',
    );
  assert.deepEqual(checkBoard('scene', scene(2, 0.1), 'The input is 2.').problems, []);
  assert.match(checkBoard('scene', scene(9, 0.1), 'The input is 2.').problems.join(' '), /needs quoted evidence/);
  const overlap = scene(2, 0.45);
  assert.match(checkBoard('scene', overlap, '2').problems.join(' '), /overlap/);
  const bad = scene(2, 0.1);
  bad.objects[1].text = '\\unknownMathCommand{2}';
  assert.ok(checkBoard('scene', bad, '2').problems.length);
});

test('scene example authoring preserves stable objects, checked values, motion and object focus', () => {
  assert.deepEqual(checkExample(example(), say).problems, []);
  const beat: Beat = { id: 'method-1', kind: 'method', arc: 'method', point: 'Double the input.', evidence: ['p1.s1'] };
  const targets = beatTargets(beat, doc);
  assert.ok('scene' in directionSchema(beat, targets).properties);
  assert.ok(targets.parts?.includes('object-1'));
  const direction = cleanDirection(
    {
      plan: 'Show a transformed value.',
      say,
      example: example(),
      cues: [
        { action: 'board_focus', target: 'object-1', anchor: 'starting value is', label: '' },
        { action: 'board_focus', target: 'object-1', anchor: 'result becomes', label: '' },
      ],
    },
    beat,
    targets,
  )!;
  assert.deepEqual(direction.exampleProblems, []);
  const step = beatStep(beat, targets, direction, doc, new Set());
  const frames = step.actions.flatMap((a) => (a.type === 'board' && a.item.kind === 'scene' ? [a.item] : []));
  assert.deepEqual(
    frames.map((f) => [f.objects[0].id, f.objects[0].x, f.objects[0].values]),
    [
      ['quantity', 0.1, [[2]]],
      ['quantity', 0.75, [[4]]],
    ],
  );
  assert.equal(step.actions.filter((a) => a.type === 'board_focus').length, 2);
  assert.deepEqual(tourProblems(tour([step]), doc), []);
  assert.deepEqual(boardProblems(tour([step])), []);
});

test('Q&A uses the same scene frame contract and rejects malformed scenes before conversion', () => {
  const retrieval = retrieve(doc, { question: 'How is the input doubled?' });
  const schema: any = answerSchema(retrieval);
  assert.ok('scene' in schema.properties.steps.items.properties.board.properties);
  const context = {
    doc,
    retrieval,
    documentId: 'p',
    question: 'How is the input doubled?',
    history: [],
    evidence: 'The input is2.',
  };
  const answer = buildAnswer(
    { plan: 'Show the operation.', answerable: 'yes', steps: [{ say, cues: [], example: example() }], followups: [] },
    context,
  )!;
  assert.equal(answer.steps[0].actions.filter((a) => a.type === 'board' && a.item.kind === 'scene').length, 2);
  assert.equal(
    buildAnswer(
      {
        steps: [
          {
            say: 'The operation transforms the input into the resulting value.',
            cues: [],
            board: { kind: 'scene', scene: scene(999, 0.1) },
          },
        ],
      },
      context,
    ),
    null,
  );
});

test('publication checks board focus against the board active at its narrated time', () => {
  const first = {
    kind: 'flow' as const,
    nodes: [
      { id: 'a', label: 'Input' },
      { id: 'b', label: 'Transform' },
      { id: 'c', label: 'Output' },
    ],
    edges: [
      ['a', 'b'],
      ['b', 'c'],
    ] as [string, string][],
  };
  const last = {
    kind: 'formula' as const,
    latex: '2+2=4',
    terms: [
      { latex: '2+2', label: 'Operation' },
      { latex: '4', label: 'Result' },
    ],
  };
  const value = tour([
    {
      id: 'timed',
      say: 'The first state explains the input and operation before the resulting value appears.',
      actions: [
        { type: 'board', item: first },
        { type: 'board', item: last, at_word: 10 },
        { type: 'board_focus', part: 2, at_word: 3 },
        { type: 'board_focus', part: 1, at_word: 11 },
      ],
    },
  ]);
  assert.deepEqual(boardProblems(value), []);
  value.chapters[0].steps[0].actions.push({ type: 'board_focus', part: 2, at_word: 12 });
  assert.match(boardProblems(value).join(' '), /no board part/);
});

test('colored prose does not qualify as a visual explanation', () => {
  const result = checkBoard('scene', {kind:'scene', objects:[
    {id:'summary',type:'text',x:0.05,y:0.2,w:0.9,h:0.3,text:'Rows contain methods and columns contain metrics.'},
  ]});
  assert.equal(result.item, null);
  assert.match(result.problems.join(' '), /colored prose/);
});
