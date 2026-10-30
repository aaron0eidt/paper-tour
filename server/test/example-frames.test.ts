import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, BoardItem, Step } from '../../shared/paper';
import { HarnessTourGenerator } from './harness-fixture';
import { card, direct, doc, input, planFor, provider, settings, type Request } from './plan-fixture';
import { exampleSay, numericalExample } from './example-fixture';
import { planBeats, type Beat } from '../src/harness/beats';
import { LEGACY_BOARD_KINDS } from '../src/harness/board';
import { beatBrief, beatTargets, directionSchema } from '../src/harness/direct';
import { checkExample, EXAMPLE_SCHEMA, exampleSchema } from '../src/harness/example';
import {
  allocateFrames,
  exampleKinds,
  exampleRules,
  type StepVisual,
  type VisualPlan,
} from '../src/harness/visual-plan';

// Worked-example frames count toward the tour's kind limits and its diversity: the plan allots each step that may carry
// an example the kinds its frames may use, so that a tour never gets five bars boards from examples nobody planned.

const beats = planBeats(card, doc, 'standard');
const beat = (id: string): Beat => beats.find((b) => b.id === id)!;
const visual = (kind: StepVisual['visual']): StepVisual => ({
  visual: kind,
  idea: kind === 'none' ? '' : 'Show it.',
  data: '',
});
const planOf = (picks: Record<string, StepVisual['visual']>): VisualPlan =>
  new Map(beats.map((b) => [b.id, visual(picks[b.id] ?? 'none')]));
const frames = (plan: VisualPlan, id: string) => plan.get(id)!.frames;
const detail = { ...beat('formula-1'), detail: true } satisfies Beat;

test('a step planned as a formula never gets the kinds the plan has used up for its frames', () => {
  const plan = allocateFrames(planOf({ 'method-1': 'bars', 'formula-1': 'formula', 'result-1': 'scene' }), beats);
  // bars and scene are used once each (their limit), so the formula step's frames may not take them.
  assert.deepEqual(frames(plan, 'formula-1'), ['formula', 'plot', 'flow']);
  // The step planned as bars shows its example in bars, with formula cards where the formula limit has room; the
  // formula step has taken the other formula card.
  assert.deepEqual(frames(plan, 'method-1'), ['bars', 'formula']);
  assert.deepEqual(frames(plan, 'result-1'), ['scene']);
  // A step without a visual, or planned as a relationship, has no example and so no frames.
  for (const id of ['problem-1', 'idea-1', 'figure-1', 'limitation-1', 'takeaway-1'])
    assert.equal(frames(plan, id), undefined, id);
  const relation = allocateFrames(planOf({ 'method-1': 'heatmap', 'formula-1': 'plot', 'result-1': 'shapes' }), beats);
  for (const id of ['method-1', 'formula-1', 'result-1']) assert.equal(frames(relation, id), undefined, id);
});

test('the formula limit holds for frames too: two formula steps leave no formula cards for the others', () => {
  const plan = allocateFrames(
    planOf({ 'method-1': 'bars', 'formula-1': 'formula', 'result-1': 'formula', 'limitation-1': 'flow' }),
    beats,
  );
  assert.ok(!frames(plan, 'method-1')!.includes('formula'));
  assert.ok(!frames(plan, 'limitation-1')!.includes('formula'));
  assert.ok(frames(plan, 'formula-1')!.includes('formula'));
});

test('the room that is left goes to one step each, so that two steps never take the same kind', () => {
  const plan = allocateFrames(planOf({ 'formula-1': 'formula', 'result-1': 'formula' }), beats);
  const first = frames(plan, 'formula-1')!.filter((kind) => kind !== 'formula');
  const second = frames(plan, 'result-1')!.filter((kind) => kind !== 'formula');
  assert.ok(first.length && second.length);
  const room: Record<string, number> = { plot: 2, scene: 1, flow: 1, bars: 1 };
  for (const kind of new Set([...first, ...second])) {
    const taken = [...first, ...second].filter((k) => k === kind).length;
    assert.ok(taken <= room[kind], `${kind} taken ${taken} times`);
  }
  // A formula detail that must show an example, planned without a visual, is allotted frames like any other.
  const required = allocateFrames(
    new Map(beats.map((b) => [b.id, visual('none')])).set('formula-1', visual('none')),
    beats.map((b) => (b.id === 'formula-1' ? detail : b)),
  );
  assert.deepEqual(frames(required, 'formula-1'), ['formula', 'plot', 'scene', 'flow', 'bars']);
});

test('an example that finds no free kind is not refused one', () => {
  const crowded = planOf({ 'method-1': 'bars', 'formula-1': 'formula', 'result-1': 'scene', 'limitation-1': 'flow' });
  crowded.set('figure-1', visual('plot'));
  crowded.set('idea-1', visual('plot'));
  const plan = allocateFrames(crowded, beats);
  const own = frames(plan, 'formula-1')!;
  assert.ok(own.some((kind) => kind !== 'formula'));
});

test('the frames of a step are the kinds it was allotted, or every legacy kind without a plan', () => {
  assert.deepEqual(exampleKinds(), LEGACY_BOARD_KINDS);
  assert.deepEqual(exampleKinds(visual('flow')), LEGACY_BOARD_KINDS);
  assert.deepEqual(exampleKinds({ ...visual('formula'), frames: ['formula', 'plot'] }), ['formula', 'plot']);
  assert.deepEqual(exampleRules(beat('formula-1'), { ...visual('formula'), frames: ['formula', 'plot'] }), {
    offered: true,
    required: false,
  });
});

test('the example schema offers only the allotted kinds, and the default schema all of them', () => {
  const kindsOf = (schema: any) =>
    Object.keys(schema.properties.frames.items.properties)
      .filter((name) => name !== 'anchor')
      .sort();
  assert.deepEqual(kindsOf(EXAMPLE_SCHEMA), [...LEGACY_BOARD_KINDS].sort());
  assert.deepEqual(kindsOf(exampleSchema(['formula', 'plot'])), ['formula', 'plot']);
  const v: StepVisual = { ...visual('formula'), frames: ['formula', 'scene'] };
  const schema: any = directionSchema(beat('formula-1'), beatTargets(beat('formula-1'), doc, v), true, v);
  assert.deepEqual(kindsOf(schema.properties.example), ['formula', 'scene']);
});

test('a frame of a kind the step was not allotted is sent back with the kinds it may use', () => {
  const flow = checkExample(numericalExample(), exampleSay, false, ['flow', 'formula']);
  assert.deepEqual(flow.problems, []);
  const refused = checkExample(numericalExample(), exampleSay, false, ['formula', 'plot']);
  assert.ok(!refused.example);
  assert.match(
    refused.problems.join(' '),
    /Example frame 1 is a flow, which this step's frames may not use; use formula, plot\./,
  );
  // Without kinds, as in a question, nothing changes.
  assert.deepEqual(checkExample(numericalExample(), exampleSay).problems, []);
});

test("the brief names the kinds a step's frames may use, only for a step that may carry an example", () => {
  const v: StepVisual = { ...visual('formula'), frames: ['formula', 'plot', 'flow'] };
  const text = beatBrief(beat('formula-1'), doc, beatTargets(beat('formula-1'), doc, v), v);
  assert.match(text, /WORKED EXAMPLE FRAMES MAY USE ONLY: formula, plot, flow\./);
  const plain = beatBrief(
    beat('formula-1'),
    doc,
    beatTargets(beat('formula-1'), doc, visual('formula')),
    visual('formula'),
  );
  assert.doesNotMatch(plain, /WORKED EXAMPLE FRAMES MAY USE ONLY/);
});

// ---------------------------------------------------------------------------------------------------- a whole tour

const kindsOfStep = (step: Step) =>
  step.actions.filter((a): a is Extract<Action, { type: 'board' }> => a.type === 'board').map((a) => a.item.kind);
const barsFrames = () => ({
  assumptions: 'Illustrative scalar input; add the same input to itself.',
  inputs: [{ label: 'Input', value: 2 }],
  calculations: [{ expression: '2+2', result: 4 }],
  frames: [
    {
      anchor: 'the input is',
      bars: { title: 'Illustrative input', unit: 'units', bars: [{ label: 'Input', value: 2 }] },
    },
    {
      anchor: 'Adding the input twice',
      bars: {
        title: 'Illustrative result',
        unit: 'units',
        bars: [
          { label: 'Input', value: 2 },
          { label: 'Output', value: 4 },
        ],
      },
    },
  ],
});

test('an example whose frames take a kind another step has planned is corrected, and the plan counts its frames', async () => {
  const requests: Request[] = [];
  const events: { type: string; data: Record<string, any> }[] = [];
  let formulaAsks = 0;
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider((request) => {
      requests.push(request);
      if (request.name === 'paper_card') return card;
      if (['visual_plan', 'opening_visual'].includes(request.name))
        return planFor(request, (id) =>
          id === 'method-1'
            ? { visual: 'bars', idea: 'Show the readings of the probes.', data: 'illustrative' }
            : id === 'formula-1'
              ? { visual: 'formula', idea: 'Show how the saving is computed.', data: 'illustrative' }
              : 'none',
        );
      if (request.task.includes('STEP KIND: formula')) {
        formulaAsks++;
        return direct(request, exampleSay, { example: formulaAsks === 1 ? barsFrames() : numericalExample() });
      }
      return direct(request, 'The probes tell each valve when its patch of soil is dry, so watering follows the need.');
    }),
  ).generate({
    ...input,
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  // The plan allotted the formula step the kinds that are left: bars is taken by the step planned as bars.
  const formula = requests.filter((r) => r.name === 'beat_direction' && r.task.includes('STEP KIND: formula'));
  assert.equal(formula.length, 2);
  assert.match(formula[0].task, /WORKED EXAMPLE FRAMES MAY USE ONLY: formula, plot, scene, flow\./);
  const frameKinds = (r: Request) =>
    Object.keys((r.schema as any).properties.example.properties.frames.items.properties);
  assert.ok(!frameKinds(formula[0]).includes('bars'));
  // The first answer used bars; its correction names the kinds, and the second answer is kept.
  const failed = events.find((e) => e.type === 'validation.failed' && e.data.beat === 'formula-1');
  assert.match(String(failed?.data.problems), /Example frame 1 is a bars, which this step's frames may not use/);
  const step = (tour.chapters.flatMap((c) => c.steps) as Step[]).find((s) => s.id === 'formula-1')!;
  assert.deepEqual(
    kindsOfStep(step).filter((kind) => kind === 'bars'),
    [],
  );
  assert.ok(kindsOfStep(step).includes('flow'));
  assert.deepEqual(metadata.degraded, []);
  // Across the tour every kind is within its limit, frames included.
  const kinds = tour.chapters.flatMap((c) => c.steps).flatMap(kindsOfStep) as BoardItem['kind'][];
  assert.ok(kinds.filter((kind) => kind === 'bars').length <= 1);
});
