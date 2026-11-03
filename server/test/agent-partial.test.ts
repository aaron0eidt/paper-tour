import test from 'node:test';
import assert from 'node:assert/strict';
import { agentPartial } from '../src/agent/partial';
import type { RunState, ToolScope } from '../src/agent/tools';
import { materializeTour } from '../src/muse/schema';
import { doc } from './plan-fixture';
import { attention } from './fixtures/authored-visuals';

const scope = { doc, documentId: 'paper', analysisId: 'analysis', language: 'de-DE' } as ToolScope;
const chapter = (id: string, source: string): RunState['chapters'][string] => ({
  id,
  title: id,
  steps: [
    {
      id: `${id}-step`,
      source,
      evidence: [source],
      say: 'This explanation follows the cited source in the paper.',
      actions: [
        { type: 'focus', target: source },
        { type: 'highlight', targets: [source] },
      ],
    },
  ],
});
const state = (): RunState => ({
  title: 'An agent teaching plan',
  plan: [
    { id: 'first', title: 'First' },
    { id: 'second', title: 'Second' },
    { id: 'third', title: 'Third' },
  ],
  chapters: {},
  observations: {},
  presented: {},
});

test('agent partials publish the validated contiguous beginning, never an unfinished middle', () => {
  const run = state();
  assert.equal(agentPartial(run, scope, new Set()), null);
  run.chapters.second = chapter('second', 'p2.s1');
  assert.equal(agentPartial(run, scope, new Set()), null);
  run.chapters.first = chapter('first', 'p1.s1');
  const partial = agentPartial(run, scope, new Set())!;
  assert.deepEqual(
    partial.tour.chapters.map((c) => c.id),
    ['first', 'second'],
  );
  assert.equal(partial.ready, 2);
  assert.equal(partial.planned, 3);
  assert.equal(partial.tour.voices?.host.lang, 'de-DE');
  assert.equal(partial.tour.doc_sha256, doc.source.sha256);
  assert.deepEqual(
    run.plan.map((c) => c.id),
    ['first', 'second', 'third'],
  );
  assert.throws(
    () => materializeTour({ title: run.title, chapters: Object.values(run.chapters) }, doc, 'paper', 'de-DE'),
    /validation/,
    'final publication still requires full document coverage',
  );
});

test('agent partials keep document validation and authored visual review gates', () => {
  const run = state();
  run.chapters.first = chapter('first', 'unknown-source');
  assert.throws(() => agentPartial(run, scope, new Set()), /validation/);
  run.chapters.first = chapter('first', 'p1.s1');
  run.chapters.first.steps[0].actions.push({ type: 'board', item: attention });
  assert.throws(() => agentPartial(run, scope, new Set()), /not completed rendered inspection/);
});
