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
import { companionPlacement } from '../src/activity/placement';
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

test('expanding a composer keeps the sphere stationary when there is room beside it', () => {
  const frame = { left: 0, right: 1000, top: 0, bottom: 800, width: 1000 };
  const composer = { left: 200, right: 800, top: 720, bottom: 780, width: 600 };
  const folded = companionPlacement(frame, composer, 80, 18, 14, false);
  const expanded = companionPlacement(frame, { ...composer, top: 600 }, 80, 18, 14, false);
  assert.equal(expanded.bottom, folded.bottom);
  assert.equal(expanded.right, folded.right);
  assert.equal(expanded.beside, true);
  // The bubble clears the tray even though the sphere itself does not move.
  assert.equal(frame.bottom - expanded.bottom - 80 - expanded.bubbleGap, 586);
});
test('narrow layouts stack above the composer and short layouts keep the popup inside the reader', () => {
  const frame = { left: 0, right: 400, top: 100, bottom: 800, width: 400 };
  const composer = { left: 12, right: 388, top: 680, bottom: 788, width: 376 };
  const placement = companionPlacement(frame, composer, 60, 16, 14, false);
  assert.equal(placement.beside, false);
  assert.equal(placement.bottom, 134);
  assert.equal(placement.width + placement.right <= frame.width, true);
  const shortFrame = { ...frame, bottom: 300 };
  const short = companionPlacement(shortFrame, { ...composer, top: 130, bottom: 288 }, 60, 16, 14, false);
  assert.equal(short.sheet, true);
  assert.equal(shortFrame.bottom - short.bottom - 60 + short.sheetTop, 114);
  assert.equal(short.sheetRoom, 172);
});
test('artwork keeps the character in its own footer rather than following the question tray', () => {
  const frame = { left: 200, right: 1200, top: 100, bottom: 900, width: 1000 };
  const composer = { left: 220, right: 800, top: 500, bottom: 550, width: 580 };
  const placement = companionPlacement(frame, composer, 82, 14, 14, true);
  assert.equal(placement.bottom, 14);
  assert.equal(placement.bubbleGap, 14);
  assert.equal(placement.beside, true);
});
