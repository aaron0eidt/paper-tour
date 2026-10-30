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
  // An omission recorded before its cause was kept says only that it happened, never a cause it does not know.
  assert.equal(generationChecklist(events, 'generating').items[1].detail, 'Skipped; the reason was not recorded');
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

test('every step left out or cut down says why, in the words of its real cause', () => {
  const rows = (...events: GenerationEvent[]) =>
    generationChecklist(
      [
        e('0', 'plan.ready', {
          beats: ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, kind: 'formula', label: `Step ${id}` })),
        }),
        ...events,
      ],
      'generating',
    ).items.map((row) => row.detail);
  assert.deepEqual(rows(), [undefined, undefined, undefined, undefined, undefined]);
  assert.deepEqual(
    rows(
      e('1', 'beat.omitted', { beat: 'a', code: 'slow', because: 'example' }),
      e('2', 'beat.completed', { beat: 'a', outcome: 'omitted', code: 'slow' }),
      e('3', 'beat.fallback', { beat: 'b', code: 'invalid' }),
      e('4', 'beat.completed', { beat: 'b', outcome: 'fallback', code: 'invalid' }),
      e('5', 'beat.omitted', { beat: 'c', code: 'repeats' }),
      e('6', 'beat.degraded', {
        beat: 'd',
        dropped: ['example', 'board'],
        causes: { example: 'slow', board: 'checks' },
      }),
      e('7', 'beat.completed', { beat: 'd', outcome: 'degraded' }),
      e('8', 'board.duplicate', { dropped: [{ step: 'e' }] }),
    ),
    [
      'Its worked example took too long to write, so the step was left out.',
      'Its explanation came back unusable, so a short summary stands in.',
      'This step would have repeated earlier content, so it was left out.',
      'Its worked example took too long to write, so it was left out. Its visual did not pass the checks, so it was left out.',
      'Its visual would have repeated earlier content, so it was left out.',
    ],
  );
  // Nobody is told the step repeated earlier content when it was the time, or the other way round.
  for (const code of ['slow', 'checks', 'invalid', 'unavailable'])
    assert.doesNotMatch(rows(e('1', 'beat.omitted', { beat: 'a', code }))[0]!, /repeated/, code);
  assert.doesNotMatch(rows(e('1', 'beat.omitted', { beat: 'a', code: 'repeats' }))[0]!, /too long/);
});

test('the dock keeps the cause of a loss and nothing the checks said', () => {
  const kept = checklistEvent(
    e('1', 'beat.degraded', {
      beat: 'a',
      dropped: ['board'],
      causes: { board: 'checks' },
      problems: ['bars: bar 1: 97 does not appear in the evidence'],
    }),
  )!;
  // As the dock stores it: undefined fields are not part of what is kept.
  const plain = (event: GenerationEvent | null) => JSON.parse(JSON.stringify(event!.data));
  assert.deepEqual(plain(kept), { beat: 'a', dropped: ['board'], causes: { board: 'checks' } });
  assert.doesNotMatch(JSON.stringify(kept), /evidence/);
  assert.deepEqual(checklistEvent(kept), kept);
  assert.deepEqual(
    plain(checklistEvent(e('2', 'board.duplicate', { dropped: [{ step: 'b', kind: 'bars', repeats: 'a' }] }))),
    {
      dropped: [{ step: 'b' }],
    },
  );
  assert.deepEqual(
    plain(checklistEvent(e('3', 'beat.omitted', { beat: 'c', code: 'slow', because: 'example', private: 'x' }))),
    {
      beat: 'c',
      code: 'slow',
      because: 'example',
    },
  );
});

test('a retried run describes only itself: a loss of the first attempt is not told of a step the retry wrote', () => {
  const events = [
    e('r1', 'run.started'),
    plan,
    e('2', 'beat.omitted', { beat: 'a', code: 'unavailable' }),
    e('3', 'beat.completed', { beat: 'a', outcome: 'omitted', code: 'unavailable' }),
    e('r2', 'run.started'),
    { ...plan, id: '5' },
    e('6', 'beat.completed', { beat: 'a', outcome: 'directed' }),
    e('7', 'beat.fallback', { beat: 'b', code: 'slow' }),
    e('8', 'beat.completed', { beat: 'b', outcome: 'fallback', code: 'slow' }),
  ];
  const rows = generationChecklist(events, 'ready').items.map((row) => row.detail);
  assert.equal(rows[0], undefined, 'step a was written by the second run');
  assert.equal(rows[1], 'Its explanation took too long to write, so a short summary stands in.');
  // The first run alone still says what it lost.
  assert.equal(
    generationChecklist(events.slice(0, 4), 'generating').items[0].detail,
    'This step could not be written because the model was not available, so it was left out.',
  );
});
