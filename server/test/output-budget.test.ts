import test from 'node:test';
import assert from 'node:assert/strict';
import { withGrowingOutputBudget } from '../src/ai/output-budget';
import { ProcessingError } from '../src/errors';

const truncated = () => new ProcessingError('muse_output_truncated', 'Output exhausted');

test('truncation increases the budget repeatedly without discarding the task', async () => {
  const budgets: number[] = [];
  const result = await withGrowingOutputBudget(6000, undefined, async (tokens) => {
    budgets.push(tokens);
    if (tokens < 48000) throw truncated();
    return { problems: [] };
  });
  assert.deepEqual(budgets, [6000, 12000, 24000, 48000]);
  assert.deepEqual(result, { problems: [] });
});

test('cancellation stops budget growth even if a provider reports truncation', async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    withGrowingOutputBudget(12000, controller.signal, async () => {
      calls++;
      controller.abort();
      throw truncated();
    }),
    { name: 'AbortError' },
  );
  assert.equal(calls, 1);
});

test('provider limits and other errors propagate without a repeated request', async () => {
  const error = new ProcessingError('muse_invalid_request', 'Provider output limit exceeded');
  let calls = 0;
  await assert.rejects(
    withGrowingOutputBudget(6000, undefined, async () => {
      calls++;
      throw error;
    }),
    (received) => received === error,
  );
  assert.equal(calls, 1);
});
