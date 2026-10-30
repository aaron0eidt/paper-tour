import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_TOUR_PROFILES, profileSnapshot } from '../../shared/tourProfiles';
import { generationPace, PACE } from '../src/harness/pace';
import { HarnessTourGenerator } from './harness-fixture';
import { card, input, provider, settings } from './plan-fixture';

test('adaptive explanations receive the full request budget and never an elapsed step deadline', () => {
  const original = { ...PACE, callMs: () => 1, stepMs: 1, repairMs: 1 };
  const adaptive = generationPace(original, 240_000, true);
  for (const name of ['paper_card', 'teaching_plan', 'visual_plan', 'beat_direction', 'exercise_solution'])
    assert.equal(adaptive.callMs(name, 'medium'), 240_000);
  assert.equal(adaptive.stepMs, Infinity);
  assert.equal(adaptive.repairMs, 240_000);
  assert.deepEqual(adaptive.outages, original.outages);
  assert.equal(generationPace(original, 240_000, false), original);
});

test('understanding can span multiple network budgets, reasons at medium and remains externally cancellable', async () => {
  const stop = new AbortController();
  let cards = 0;
  const requests: string[] = [];
  const efforts: unknown[] = [];
  const transport = provider(async (request) => {
    requests.push(request.name);
    if (request.name === 'paper_card') {
      await new Promise((resolve) => setTimeout(resolve, 140));
      return ++cards === 1 ? {} : card;
    }
    stop.abort(new DOMException('Reader cancelled after understanding', 'AbortError'));
    throw stop.signal.reason;
  });
  const generator = new HarnessTourGenerator(
    { ...settings, timeoutMs: 220 },
    'standard',
    transport,
    undefined,
    undefined,
    { ...PACE, callMs: () => 1, stepMs: 1, repairMs: 1 },
  );
  const started = Date.now();
  await assert.rejects(
    generator.generate(
      {
        ...input,
        profile: profileSnapshot(BUILTIN_TOUR_PROFILES[0]),
        onEvent: async (type, data) => {
          if (type === 'model.started' && data.name === 'paper_card') efforts.push(data.reasoningEffort);
        },
      },
      undefined,
      stop.signal,
    ),
    () => stop.signal.aborted,
  );
  assert.equal(cards, 2);
  assert.deepEqual(efforts, ['medium', 'medium']);
  assert.ok(Date.now() - started >= 250);
  assert.ok(!requests.includes('claims'));
  assert.ok(!requests.includes('opening_visual'));
});
