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
