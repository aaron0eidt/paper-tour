import test from 'node:test';
import assert from 'node:assert/strict';
import { workflowDirective } from '../src/agent/workflow';
import type { RunState } from '../src/agent/tools';
test('workflow advances from batched inspection to missing chapters and publication', () => {
  const state: RunState = { plan: [], chapters: {}, observations: {}, presented: {}, delivered: {} };
  assert.match(workflowDirective(state, ['page1']), /Inspect missing/);
  assert.match(workflowDirective(state, ['page1'], ['page1']), /already viewed/);
  state.delivered!.page1 = 'hash';
  assert.match(workflowDirective(state, ['page1']), /already viewed/);
  state.observations.page1 = { description: 'Source', readable: true };
  assert.match(workflowDirective(state, ['page1']), /Set a concise chapter plan/);
  state.plan = [
    { id: 'a', title: 'A' },
    { id: 'b', title: 'B' },
  ];
  state.chapters.a = { id: 'a', title: 'A', steps: [] };
  assert.match(workflowDirective(state, ['page1']), /Next chapters: b: B/);
  state.chapters.b = { id: 'b', title: 'B', steps: [] };
  assert.match(workflowDirective(state, ['page1']), /Call finish_tour now/);
});
