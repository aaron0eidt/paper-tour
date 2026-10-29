import test from 'node:test';
import assert from 'node:assert/strict';
import { generationDiagnostics } from '../../shared/generationDiagnostics';
import type { GenerationEvent } from '../../shared/activity';
const e = (id: string, type: string, second: number, data: Record<string, unknown>): GenerationEvent => ({
  id,
  type,
  data,
  at: new Date(Date.UTC(2026, 9, 28, 16, 0, second)).toISOString(),
});

test('timings count completed calls once and derive missing tool duration from journal timestamps', () => {
  const done = e('4', 'model.completed', 20, { callId: 'm', durationMs: 20000 });
  const d = generationDiagnostics([
    e('1', 'model.started', 0, { callId: 'm', name: 'paper_agent' }),
    e('2', 'model.delta', 3, { callId: 'm', delta: 'Checking' }),
    e('3', 'model.usage', 5, { callId: 'm', durationMs: 5000 }),
    done,
    done,
    e('5', 'tool.started', 20, { callId: 't', name: 'upsert_tour_chapter' }),
    e('6', 'tool.completed', 22, { callId: 't', output: { error: ['bad reference'] } }),
    e('7', 'model.started', 22, { callId: 'pending' }),
  ]);
  assert.equal(d.modelCalls, 2);
  assert.equal(d.toolCalls, 1);
  assert.equal(d.modelMs, 20000);
  assert.equal(d.toolMs, 2000);
  assert.equal(d.failedCalls, 1);
  assert.equal(d.medianFirstOutputMs, 3000);
  assert.equal(d.slowest[0].callId, 'm');
  assert.match(d.explanation, /model requests/);
});

test('precise server phases and first-output timing take precedence over stream arrival', () => {
  const d = generationDiagnostics([
    e('1', 'model.started', 0, { callId: 'm' }),
    e('2', 'model.delta', 8, { callId: 'm', delta: 'Checking' }),
    e('3', 'model.completed', 20, {
      callId: 'm',
      durationMs: 20000,
      timing: { preparationMs: 2000, inferenceMs: 18000, firstOutputMs: 5000 },
    }),
  ]);
  assert.equal(d.medianFirstOutputMs, 5000);
  assert.deepEqual(
    d.phases.map((p) => p.durationMs),
    [2000, 18000],
  );
  assert.equal(generationDiagnostics([]).medianFirstOutputMs, undefined);
});

test('published presentation counts use the latest event and remain absent for legacy tours', () => {
  assert.equal(generationDiagnostics([]).direction, undefined);
  const d = generationDiagnostics([
    e('1', 'tour.direction', 1, { steps: 2, words: 50, actions: { focus: 2, zoom: 0 } }),
    e('2', 'tour.direction', 2, {
      steps: 4,
      words: 120,
      actions: { focus: 4, zoom: 0, spotlight: 2, highlight: 6, invalid: -1, unknown: '3' },
    }),
  ]);
  assert.deepEqual(d.direction, {
    steps: 4,
    words: 120,
    actions: [
      { name: 'focus', count: 4 },
      { name: 'zoom', count: 0 },
      { name: 'spotlight', count: 2 },
      { name: 'highlight', count: 6 },
    ],
  });
});

test('parallel model durations are summed separately from elapsed wall time', () => {
  const events = [
    e('1', 'model.started', 0, { callId: 'a' }),
    e('2', 'model.started', 0, { callId: 'b' }),
    e('3', 'model.completed', 20, { callId: 'a', durationMs: 20000 }),
    e('4', 'model.completed', 30, { callId: 'b', durationMs: 30000 }),
  ];
  assert.equal(generationDiagnostics(events, 'completed').modelMs, 50000);
  assert.equal(generationDiagnostics(events, 'completed').elapsedMs, 30000);
  assert.equal(generationDiagnostics(events, 'generating', Date.parse(e('5', 'unused', 40, {}).at)).elapsedMs, 40000);
  assert.equal(generationDiagnostics(events, 'paused', Date.parse(e('5', 'unused', 50, {}).at)).elapsedMs, 30000);
  assert.equal(generationDiagnostics([], 'queued').elapsedMs, undefined);
});
