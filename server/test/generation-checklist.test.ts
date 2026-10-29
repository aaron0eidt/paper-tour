import test from 'node:test';
import assert from 'node:assert/strict';
import { checklistEvent, generationChecklist } from '../../shared/generationChecklist';
import type { GenerationEvent } from '../../shared/activity';
const e = (id: string, type: string, data: Record<string, unknown> = {}): GenerationEvent => ({
  id,
  type,
  data,
  at: '2026-10-28T16:00:00Z',
});
const plan = e('1', 'plan.ready', {
  beats: [
    { id: 'a', kind: 'idea', label: 'Attention replaces recurrence' },
    { id: 'b', kind: 'figure', target: 'fig1' },
  ],
});

test('planned order is stable while parallel beats finish in a different order', () => {
  const events = [
    plan,
    e('2', 'beat.started', { beat: 'a' }),
    e('3', 'beat.started', { beat: 'b' }),
    e('4', 'beat.completed', { beat: 'b', outcome: 'directed' }),
  ];
  const checklist = generationChecklist(events, 'generating');
  assert.deepEqual(
    checklist.items.map((row) => [row.id, row.state]),
    [
      ['a', 'active'],
      ['b', 'done'],
    ],
  );
  assert.equal(checklist.items[0].label, 'Attention replaces recurrence');
  assert.equal(checklist.finished, 1);
  assert.equal(checklist.phases.find((p) => p.id === 'plan')?.state, 'done');
  assert.equal(checklist.phases.find((p) => p.id === 'publish')?.state, 'pending');
});

test('model calls and legacy publication never invent per-beat completion', () => {
  const events = [
    plan,
    e('2', 'model.started', { callId: 'm', name: 'beat_direction' }),
    e('3', 'model.completed', { callId: 'm' }),
  ];
  assert.equal(generationChecklist(events, 'generating').finished, 0);
  assert.equal(generationChecklist(events, 'generating').tracked, false);
  assert.deepEqual(
    generationChecklist(events, 'ready').items.map((row) => row.state),
    ['unknown', 'unknown'],
  );
  assert.ok(generationChecklist(events, 'ready').phases.every((row) => row.state === 'done'));
});

test('failures, explicit omissions and retries retain distinct outcomes', () => {
  const events = [
    plan,
    e('2', 'beat.started', { beat: 'a' }),
    e('3', 'beat.failed', { beat: 'a' }),
    e('4', 'beat.completed', { beat: 'b', outcome: 'omitted' }),
  ];
  assert.equal(generationChecklist(events, 'generating').items[0].state, 'failed');
  assert.match(generationChecklist(events, 'generating').items[1].detail!, /Skipped/);
  events.push(e('5', 'beat.started', { beat: 'a' }));
  assert.equal(generationChecklist(events, 'generating').items[0].state, 'active');
});

test('dock event filter retains no model prompt, output or streamed text', () => {
  assert.equal(checklistEvent(e('1', 'model.delta', { delta: 'private text' })), null);
  assert.deepEqual(
    checklistEvent(
      e('2', 'model.started', { callId: 'm', name: 'paper_card', messages: ['large private prompt'], tools: [{}] }),
    )?.data,
    { callId: 'm', name: 'paper_card' },
  );
  assert.deepEqual(checklistEvent(e('3', 'model.completed', { callId: 'm', output: { plan: 'private' } }))?.data, {
    callId: 'm',
    name: undefined,
  });
});

test('a new run on the same generation clears old plan, publication and tracked completion', () => {
  const events = [
    plan,
    e('2', 'beat.started', { beat: 'a' }),
    e('3', 'beat.completed', { beat: 'a', outcome: 'directed' }),
    e('4', 'run.completed'),
  ];
  events.push(e('5', 'run.started', { model: 'model' }), e('6', 'step.started', { stage: 'preparing' }));
  const retry = generationChecklist(events, 'generating');
  assert.deepEqual(retry.items, []);
  assert.equal(retry.planned, 0);
  assert.equal(retry.finished, 0);
  assert.equal(retry.tracked, false);
  assert.equal(retry.phases[0].state, 'active');
  assert.ok(retry.phases.slice(1).every((row) => row.state === 'pending'));
  events.push(e('7', 'plan.ready', { beats: [{ id: 'a', kind: 'idea', label: 'New attempt' }] }));
  assert.equal(generationChecklist(events, 'generating').items[0].state, 'pending');
  assert.equal(generationChecklist(events, 'ready').items[0].state, 'unknown');
  assert.ok(checklistEvent(e('8', 'run.started')));
});

test('durable tools expose a real chapter plan and saved progress without retaining raw tool payloads', () => {
  const events = [
    e('1', 'tool.completed', {
      name: 'set_tour_plan',
      output: {
        plan: [
          { id: 'method', title: 'The method' },
          { id: 'results', title: 'Results' },
        ],
        private: 'discard',
      },
    }),
    e('2', 'tool.started', {
      name: 'upsert_tour_chapter',
      arguments: { chapter: { id: 'method', title: 'The method', steps: [{ say: 'private narration' }] } },
    }),
    e('3', 'tool.completed', { name: 'upsert_tour_chapter', output: { chapterId: 'method', savedSteps: 3 } }),
  ];
  const compact = events.flatMap((event) => checklistEvent(event) ?? []);
  assert.doesNotMatch(JSON.stringify(compact), /private|narration/);
  const actual = generationChecklist(compact, 'generating');
  assert.equal(actual.planned, 2);
  assert.equal(actual.finished, 1);
  assert.equal(actual.items[0].label, 'The method');
  assert.equal(actual.items[0].state, 'done');
  assert.equal(actual.items[1].state, 'pending');
  assert.deepEqual(checklistEvent(compact[0]), compact[0], 'Compact data must survive the dock filtering it again');
});
