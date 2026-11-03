function test(name: string, run: () => void) {
  run();
  console.log(`  ok    ${name}`);
}
const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Values differ');
  },
};
import { activityEvents } from '../src/components/activityEvents';
import type { GenerationEvent } from '../../shared/activity';
import type { ActivityRun } from '../../shared/agentActivity';
import { companionPresence, currentActivity, spokenSentence } from '../src/activity/presence';
const event = (id: string, type: string): GenerationEvent => ({ id, type, at: '2026-10-30T00:00:00Z', data: {} });

test('current attempt excludes older failed drafts without deleting their history', () => {
  const events = [
    event('1', 'run.started'),
    event('2', 'model.failed'),
    event('3', 'run.failed'),
    event('4', 'run.started'),
    event('5', 'model.completed'),
  ];
  assert.deepEqual(
    activityEvents(events).map((e) => e.id),
    ['4', '5'],
  );
  assert.equal(activityEvents(events, true), events);
  assert.equal(events.length, 5);
});
test('legacy journals and a newly started attempt retain their available events', () => {
  const legacy = [event('1', 'model.started')];
  assert.equal(activityEvents(legacy), legacy);
  assert.deepEqual(activityEvents([]), []);
  assert.deepEqual(
    activityEvents([...legacy, event('2', 'run.started')]).map((e) => e.id),
    ['2'],
  );
});

const run = (id: string, kind: ActivityRun['kind'], status: ActivityRun['status'], startedAt: string): ActivityRun => ({
  id,
  kind,
  status,
  startedAt,
  updatedAt: startedAt,
  title: id,
  operations: [],
  controllable: true,
});
test('the companion follows the current mode instead of leaking a more recent reading status into a tour', () => {
  const tour = run('tour', 'tour', 'completed', '2026-11-01T12:00:00Z');
  const reading = run('reading', 'reading', 'paused', '2026-11-03T12:00:00Z');
  assert.equal(currentActivity([reading, tour], 'tour')?.id, 'tour');
  assert.equal(currentActivity([reading, tour], 'reading')?.id, 'reading');
  assert.equal(currentActivity([reading], 'tour'), undefined);
  const answer = run('answer', 'answer', 'running', '2026-11-03T12:01:00Z');
  assert.equal(currentActivity([reading, tour, answer], 'reading')?.id, 'answer');
});
test('the companion shows the sentence at the actual narrated word and stays silent during a seek', () => {
  const playback = {
    playing: true,
    speaking: true,
    canPlay: true,
    page: 3,
    words: ['First', 'sentence.', 'Now', 'the', 'second', 'one.'],
    word: 4,
  };
  assert.deepEqual(spokenSentence(playback), { words: ['Now', 'the', 'second', 'one.'], current: 2 });
  assert.equal(spokenSentence({ ...playback, speaking: false }), undefined);
  assert.equal(spokenSentence({ ...playback, word: -1 }), undefined);
  assert.deepEqual(spokenSentence({ ...playback, word: 1 }), { words: ['First', 'sentence.'], current: 1 });
});
test('preparation state cannot label actual speech as paused or failed', () => {
  const playback = { playing: true, speaking: true, canPlay: true, page: 3, words: ['Ready.'], word: 0 };
  const paused = run('reading', 'reading', 'paused', '2026-11-03T12:00:00Z');
  assert.equal(companionPresence(paused, 'reading', playback).mood, 'speaking');
  assert.equal(companionPresence({ ...paused, status: 'failed' }, 'reading', playback).mood, 'speaking');
  assert.equal(companionPresence(paused, 'reading', { ...playback, speaking: false }).mood, 'paused');
  assert.equal(companionPresence(paused, 'reading', { ...playback, speaking: false }, true).mood, 'working');
});
