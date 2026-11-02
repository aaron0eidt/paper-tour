import test from 'node:test';
import assert from 'node:assert/strict';
import { authorVisualPlan } from '../src/harness/visual-author';
import { cleanVisualPlan, visualPlanSchema } from '../src/harness/visual-plan';
import { ProcessingError } from '../src/errors';
import type { Beat } from '../src/harness/beats';
import { card, doc } from './plan-fixture';

const beats: Beat[] = Array.from({ length: 37 }, (_, i) => ({
  id: `concept-${i}`,
  kind: 'method',
  arc: 'method',
  point: `Distinct mechanism ${i}`,
  evidence: ['p1.s3'],
}));
const requested = (schema: object): string[] =>
  (schema as ReturnType<typeof visualPlanSchema>).properties.beats.items.properties.beat.enum;
const reply = (ids: string[]) => ({
  plan: 'Choose each construction for the actual source-grounded mechanism.',
  beats: ids.map((beat) => ({
    beat,
    visual: 'program',
    idea: `Show a changing intermediate value for ${beat}`,
    data: 'Illustrative input from the cited mechanism.',
  })),
});
const base = () => ({
  doc,
  card,
  beats,
  settled: new Map(),
  sheet: false,
  language: 'en',
  prefix: [],
  signal: new AbortController().signal,
  retryable: (error: unknown) => error instanceof ProcessingError,
});

test('output-sized planning batches retain every explanation and its full-tour context', async () => {
  const calls: number[] = [];
  const plan = await authorVisualPlan({
    ...base(),
    call: async (messages, schema) => {
      const ids = requested(schema);
      calls.push(ids.length);
      assert.ok(JSON.stringify(messages).includes('concept-36'), 'Every batch sees the entire tour.');
      if (ids.length > 9) throw new ProcessingError('muse_output_truncated', 'Provider output budget exhausted.');
      return { value: reply(ids) };
    },
  });
  assert.equal(calls[0], 37);
  assert.equal(plan.size, 37);
  for (const beat of beats) assert.equal(plan.get(beat.id)?.visual, 'program');
});

test('a partial visual plan is repaired rather than silently filling missing beats with none', async () => {
  let calls = 0;
  const plan = await authorVisualPlan({
    ...base(),
    beats: beats.slice(0, 2),
    call: async (messages, schema) => {
      const ids = requested(schema);
      if (++calls === 1) return { value: reply(ids.slice(0, 1)) };
      assert.match(JSON.stringify(messages), /Missing visual decision: concept-1/);
      return { value: reply(ids) };
    },
  });
  assert.equal(calls, 2);
  assert.equal(plan.size, 2);
});

test('persistent invalid planning fails without publishing substitute visual decisions', async () => {
  let calls = 0;
  await assert.rejects(
    authorVisualPlan({
      ...base(),
      call: async () => {
        calls++;
        return { value: reply([]) };
      },
    }),
    (error: unknown) => error instanceof ProcessingError && error.code === 'invalid_visual_plan',
  );
  assert.equal(calls, 2);
});

test('cancelling batched planning stops before any further requests', async () => {
  const stop = new AbortController();
  let calls = 0;
  await assert.rejects(
    authorVisualPlan({
      ...base(),
      signal: stop.signal,
      call: async () => {
        calls++;
        stop.abort(new Error('Reader cancelled'));
        throw stop.signal.reason;
      },
    }),
    /Reader cancelled/,
  );
  assert.equal(calls, 1);
});

test('adaptive visual briefs preserve all required data rather than truncating to a word quota', () => {
  const explanation = Array.from({ length: 110 }, (_, i) => `source-value-${i}`).join(' ');
  const raw = reply([beats[0].id]);
  raw.beats[0].idea = explanation;
  raw.beats[0].data = explanation;
  const checked = cleanVisualPlan(raw, [beats[0]], { adaptive: true });
  assert.equal(checked.plan?.get(beats[0].id)?.data, explanation);
  assert.equal(checked.plan?.get(beats[0].id)?.idea, explanation);
  const schema = visualPlanSchema([beats[0]], { adaptive: true });
  assert.ok(!('maxLength' in schema.properties.beats.items.properties.data));
});

test('a late valid visual response cannot publish after cancellation', async () => {
  const stop = new AbortController();
  await assert.rejects(
    authorVisualPlan({
      ...base(),
      signal: stop.signal,
      call: async (_messages, schema) => {
        stop.abort(new Error('Reader cancelled'));
        return { value: reply(requested(schema)) };
      },
    }),
    /Reader cancelled/,
  );
});
