import test from 'node:test';
import assert from 'node:assert/strict';
import { generationTimeline } from '../../shared/generationTimeline';
import type { GenerationEvent } from '../../shared/activity';
const e = (id: string, type: string, data: Record<string, unknown> = {}): GenerationEvent => ({
  id,
  type,
  data,
  at: '2026-10-28T16:00:00Z',
});
test('assistant text streams incrementally and is replaced by the completed public message', () => {
  const events = [
    e('1', 'model.started', { callId: 'a' }),
    e('2', 'model.delta', { callId: 'a', delta: 'I am checking ' }),
  ];
  assert.equal(generationTimeline(events)[0].text, 'I am checking');
  events.push(e('3', 'model.delta', { callId: 'a', delta: 'Figure 2.' }));
  assert.equal(generationTimeline(events)[0].text, 'I am checking Figure 2.');
  events.push(
    e('4', 'model.completed', {
      callId: 'a',
      output: [
        { type: 'reasoning', text: 'hidden' },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Figure checked.' }] },
      ],
    }),
  );
  assert.equal(generationTimeline(events)[0].text, 'Figure checked.');
  assert.equal(generationTimeline(events)[0].state, 'done');
});
test('structured model output stays out of speech bubbles; tool results become readable status', () => {
  const rows = generationTimeline([
    e('1', 'model.started', { callId: 'a' }),
    e('2', 'model.delta', { callId: 'a', delta: '{"chapters":[' }),
    e('3', 'tool.started', {
      callId: 'b',
      name: 'upsert_tour_chapter',
      arguments: { chapter: { title: 'Main idea' } },
    }),
    e('4', 'tool.completed', { callId: 'b', output: { savedSteps: 4 } }),
  ]);
  assert.equal(rows[0].text, '');
  assert.equal(rows[1].title, 'Save a chapter');
  assert.equal(rows[1].detail, '4 tour steps saved');
});
test('context reset ends abandoned entries and long technical errors are not shown as JSON', () => {
  const rows = generationTimeline([
    e('1', 'model.started', { callId: 'a' }),
    e('2', 'context.reset'),
    e('3', 'tool.started', { callId: 'b', name: 'record_visual_observations' }),
    e('4', 'tool.completed', { callId: 'b', output: { error: 'Invalid required property description' } }),
  ]);
  assert.equal(rows[0].state, 'failed');
  assert.equal(rows[1].state, 'failed');
  assert.equal(rows[1].detail, 'The visual descriptions need to be completed.');
});

test('replayed deltas are deduplicated and structured finals do not hide useful commentary', () => {
  const delta = e('2', 'model.delta', { callId: 'a', delta: 'Checking sources.' });
  const rows = generationTimeline([
    e('1', 'model.started', { callId: 'a' }),
    delta,
    delta,
    e('3', 'model.completed', {
      callId: 'a',
      output: [
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Checking sources.' }] },
        { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: '{"chapters":[]}' }] },
      ],
    }),
  ]);
  assert.equal(rows[0].text, 'Checking sources.');
});

test('tool preparation is readable before arguments finish streaming', () => {
  const rows = generationTimeline([
    e('1', 'model.started', { callId: 'a' }),
    e('2', 'model.tool.started', { callId: 'a', toolCallId: 't', name: 'upsert_tour_chapter' }),
  ]);
  assert.equal(rows[0].detail, 'Preparing: Save a chapter');
  assert.equal(rows[0].state, 'running');
});

test('harness entries show public narration and honest call labels without exposing plan fields', () => {
  const rows = generationTimeline([
    e('1', 'model.started', { callId: 'a', name: 'paper_card' }),
    e('2', 'model.completed', { callId: 'a', output: { plan: 'private planning', title: 'Document' } }),
    e('3', 'model.started', { callId: 'b', name: 'beat_direction' }),
    e('4', 'model.completed', {
      callId: 'b',
      output: { plan: 'private planning', say: 'Look at the encoder tower.', cues: [] },
    }),
  ]);
  assert.equal(rows[0].title, 'Understand the document');
  assert.equal(rows[0].text, '');
  assert.equal(rows[1].kind, 'model');
  assert.equal(rows[1].title, 'Write narration and visual cues');
  assert.equal(rows[1].text, 'Look at the encoder tower.');
  assert.match(rows[1].detail, /draft/);
});

test('the claims and the opening visual calls have readable labels', () => {
  const rows = generationTimeline([
    e('1', 'model.started', { callId: 'a', name: 'claims' }),
    e('2', 'model.started', { callId: 'b', name: 'opening_visual' }),
  ]);
  assert.deepEqual(
    rows.map((row) => row.title),
    ['Find the main claims', 'Plan the first visual'],
  );
});

test('parallel writing calls use their actual planned explanation labels', () => {
  const entries = generationTimeline([
    {
      id: '1',
      type: 'model.started',
      at: '2026-10-29T00:00:00Z',
      data: { callId: 'm1', name: 'beat_direction', task: { id: 'formula', label: 'Why the scaling term matters' } },
    },
  ]);
  assert.equal(entries[0].title, 'Why the scaling term matters');
});

test('narration snapshots update in place without mixing raw JSON or parallel calls', () => {
  const events = [
    e('1', 'model.started', { callId: 'a', name: 'beat_direction' }),
    e('2', 'model.started', { callId: 'b', name: 'beat_direction' }),
    e('3', 'model.delta', { callId: 'a', delta: '{"plan":"private","say":"The curve' }),
    e('4', 'model.narration', { callId: 'a', text: 'The curve' }),
    e('5', 'model.delta', { callId: 'a', delta: ' bends.","cues":[]}' }),
    e('6', 'model.narration', { callId: 'b', text: 'The matrix transforms.' }),
    e('7', 'model.narration', { callId: 'a', text: 'The curve bends.' }),
  ];
  const rows = generationTimeline([...events, events[6]]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].text, 'The curve bends.');
  assert.equal(rows[1].text, 'The matrix transforms.');
  assert.equal(rows[0].state, 'running');
  assert.match(rows[0].detail, /validation follows/);
  events.push(e('8', 'model.failed', { callId: 'a' }));
  assert.equal(generationTimeline(events)[0].state, 'failed');
});
