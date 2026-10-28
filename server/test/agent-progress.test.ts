import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProgress } from '../src/agent/progress';
import type { RunState } from '../src/agent/tools';
const state = (): RunState => ({ plan: [], chapters: {}, observations: {}, presented: {}, delivered: {} });
const call = (query = 'same', id = 'call') => ({
  type: 'function_call',
  name: 'search_paper',
  call_id: id,
  arguments: JSON.stringify({ query }),
});
test('repeated ineffective calls pause; independent new searches remain allowed', () => {
  let before = state();
  for (let i = 0; i < 3; i++) {
    const next = checkProgress(before, before, [call()], new Set());
    assert.equal(next.repeated.length, i === 2 ? 1 : 0);
    before = { ...before, loopWatch: next.counts };
  }
  assert.deepEqual(checkProgress(before, before, [call('new evidence')], new Set()).repeated, []);
});
test('saved evidence, chapters and newly presented images reset repeat detection', () => {
  const before = { ...state(), loopWatch: { 'rejected:record_visual_observations': 2 } };
  for (const after of [
    { ...before, observations: { page1: { description: 'real evidence' } } },
    { ...before, presented: { page1: 'hash' } },
    { ...before, plan: [{ id: 'one', title: 'One' }] },
  ])
    assert.deepEqual(checkProgress(before, after, [], new Set()), { counts: {}, repeated: [] });
});
test('rejected argument variants count as the same ineffective action; duplicates within one turn count once', () => {
  const before = { ...state(), loopWatch: { 'rejected:search_paper': 2 } };
  const result = checkProgress(before, before, [call('variant', 'a'), call('other', 'b')], new Set(['a', 'b']));
  assert.deepEqual(result.repeated, ['search_paper']);
  assert.equal(result.counts['rejected:search_paper'], 3);
});
test('empty assistant responses cannot loop indefinitely', () => {
  const before = { ...state(), loopWatch: { no_actions: 2 } };
  assert.equal(checkProgress(before, before, [], new Set()).repeated.length, 1);
});
