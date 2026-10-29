import test from 'node:test';
import assert from 'node:assert/strict';
import { pool } from '../src/harness/calls';

test('pool stops queued work, waits for in-flight siblings and preserves the first failure', async () => {
  const original = new Error('original failure');
  const siblingFailure = new Error('sibling cancelled');
  let rejectFirst!: (error: unknown) => void;
  let releaseSibling!: () => void;
  const first = new Promise<void>((_, reject) => {
    rejectFirst = reject;
  });
  const sibling = new Promise<void>((resolve) => {
    releaseSibling = resolve;
  });
  const started: number[] = [];
  let settled = false;
  let notified: unknown;
  const result = pool(
    [0, 1, 2, 3],
    2,
    async (item) => {
      started.push(item);
      if (item === 0) await first;
      if (item === 1) {
        await sibling;
        throw siblingFailure;
      }
      return item;
    },
    (error) => {
      notified = error;
    },
  );
  const observed = result.then(
    () => {
      settled = true;
    },
    (error) => {
      settled = true;
      return error;
    },
  );
  assert.deepEqual(started, [0, 1]);
  rejectFirst(original);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(notified, original);
  assert.equal(settled, false);
  assert.deepEqual(started, [0, 1]);
  releaseSibling();
  assert.equal(await observed, original);
  assert.deepEqual(started, [0, 1]);
});

test('successful pool preserves input order despite different completion order', async () => {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const result = pool([0, 1, 2], 2, async (item) => {
    if (item === 0) await wait;
    if (item === 2) release();
    return item * 2;
  });
  assert.deepEqual(await result, [0, 2, 4]);
});
