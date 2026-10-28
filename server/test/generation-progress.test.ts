import test from 'node:test';
import assert from 'node:assert/strict';
import type { GenerationEvent } from '../../shared/activity';
import { generationProgress } from '../../shared/generationProgress';
const event = (id: string, type: string, data: Record<string, unknown> = {}): GenerationEvent => ({
  id,
  type,
  data,
  at: '2026-10-28T16:00:00Z',
});

test('current step follows the active call rather than the selected historical row', () => {
  const events = [
    event('1', 'model.started', { callId: 'm1', name: 'paper_context' }),
    event('2', 'model.completed', { callId: 'm1' }),
    event('3', 'tool.started', { callId: 't1', name: 'view_visuals', arguments: { ids: ['page2', 'fig1'] } }),
  ];
  const progress = generationProgress(events, 'running');
  assert.equal(progress.title, 'Opening pages and figures');
  assert.match(progress.detail, /page2, fig1/);
  events.push(
    event('4', 'tool.completed', { callId: 't1', name: 'view_visuals', output: { sources: [] } }),
    event('5', 'model.started', { callId: 'm2', name: 'paper_agent' }),
  );
  assert.equal(generationProgress(events, 'running').title, 'Interpreting the opened pages and figures');
});

test('reloaded context and repeated visual requests are reported without claiming duplicate image delivery', () => {
  const events = [
    event('1', 'tool.started', { callId: 't1', name: 'view_visuals', arguments: { ids: ['page1', 'page2'] } }),
    event('2', 'context.reset', { reason: 'provider_history_unavailable' }),
    event('3', 'model.started', { callId: 'root2', name: 'paper_context' }),
    event('4', 'tool.started', { callId: 't2', name: 'view_visuals', arguments: { ids: ['page1'] } }),
  ];
  const progress = generationProgress(events, 'running');
  assert.match(progress.warnings.join(' '), /1 context reload/);
  assert.match(progress.warnings.join(' '), /3 visual source requests for 2 distinct sources/);
});

test('only successful saves count; rewriting a chapter replaces its step count', () => {
  const events = [
    event('1', 'tool.completed', { name: 'record_visual_observations', output: { error: 'invalid arguments' } }),
    event('2', 'tool.completed', { name: 'record_visual_observations', output: { recorded: ['page1', 'page2'] } }),
    event('3', 'tool.completed', { name: 'record_visual_observations', output: { recorded: ['page1'] } }),
    event('4', 'tool.completed', { name: 'upsert_tour_chapter', output: { chapterId: 'c1', savedSteps: 3 } }),
    event('5', 'tool.completed', { name: 'upsert_tour_chapter', output: { chapterId: 'c1', savedSteps: 5 } }),
  ];
  const progress = generationProgress(events, 'running');
  assert.equal(progress.observations, 2);
  assert.equal(progress.chapters, 1);
  assert.equal(progress.steps, 5);
  assert.match(progress.warnings.join(' '), /1 rejected/);
});

test('terminal and paused states override unfinished calls and stop their timers', () => {
  const events = [event('1', 'model.started', { callId: 'm1', name: 'paper_agent' })];
  assert.equal(generationProgress(events, 'paused').title, 'Tour generation paused');
  assert.equal(generationProgress(events, 'completed').title, 'Tour saved');
  assert.equal(generationProgress(events, 'completed').since, null);
  assert.equal(generationProgress([], 'queued').title, 'Waiting for the next action');
});

test('harness progress distinguishes drafts from published steps and reports parallel calls', () => {
  const events = [
    event('1', 'model.started', { callId: 'a', name: 'beat_direction' }),
    event('2', 'model.started', { callId: 'b', name: 'beat_direction' }),
  ];
  assert.match(generationProgress(events, 'generating').detail, /2 model requests/);
  events.push(event('3', 'model.completed', { callId: 'a', output: { say: 'Narration draft', plan: 'private' } }));
  assert.equal(generationProgress(events, 'generating').drafts, 1);
  assert.equal(generationProgress(events, 'generating').steps, 0);
  events.push(event('4', 'tour.direction', { steps: 12, words: 300, actions: { zoom: 12 } }));
  assert.equal(generationProgress(events, 'ready').steps, 12);
});
