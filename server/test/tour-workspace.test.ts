import test from 'node:test';
import assert from 'node:assert/strict';
import { generationWorkspace, workKey, type GenerationWorkspace } from '../src/ai/workspace';
import { recordedCalls } from '../src/ai/recorded-calls';
import { MuseClient } from '../src/muse/client';
import { directionSchema, beatTargets } from '../src/harness/direct';
import { visualRepairSchema, visualRepairTask, mergeVisualRepair } from '../src/harness/direction-repair';
import { doc } from './plan-fixture';
import type { Beat } from '../src/harness/beats';
import type { TourGenerationInput } from '../src/tour-generator';

const beat: Beat = { id: 'mechanism', kind: 'formula', arc: 'method', point: 'Teach the mechanism', evidence: [] };

test('selected authored visuals are required and visual repairs cannot rewrite narration', () => {
  const visual = { visual: 'program' as const, flexible: true, idea: 'Demonstrate a change', data: 'Illustrative' };
  const schema = directionSchema(beat, beatTargets(beat, doc, visual), true, visual);
  assert.ok(schema.required.includes('program'));
  const repair = visualRepairSchema(schema);
  assert.ok(repair.required.includes('program'));
  assert.ok(!Object.hasOwn(repair.properties, 'say'));
  const draft = { say: 'Saved explanation', plan: 'Saved point', example: { old: true } };
  assert.deepEqual(mergeVisualRepair(draft, { program: { code: 'new' }, cues: [], say: 'overwrite' }), {
    program: { code: 'new' },
    cues: [],
    say: 'Saved explanation',
    plan: 'Saved point',
  });
  const task = visualRepairTask([], draft, ['Missing code']);
  assert.match(JSON.stringify(task), /repair_visual_only/);
  assert.match(JSON.stringify(task), /Missing code/);
});

test('a planned native visual permits a complete example instead of an empty response', () => {
  const visual = { visual: 'flow' as const, flexible: true, idea: 'Demonstrate a merge', data: 'Illustrative' };
  const schema = directionSchema(beat, beatTargets(beat, doc, visual), true, visual);
  assert.deepEqual(schema.anyOf, [{ required: ['flow'] }, { required: ['example'] }]);
});

test('generation journal workspace loads latest work within the requested generation', async () => {
  const calls: unknown[][] = [];
  const db = {
    query: async (_sql: string, values: unknown[]) => {
      calls.push(values);
      return { rows: [{ value: { status: 'draft', raw: { say: 'Keep me' }, problems: ['Missing board'] } }] };
    },
  } as any;
  const events: unknown[] = [];
  const workspace = generationWorkspace(db, 'generation-a', async (type, data) => {
    events.push({ type, data });
  });
  assert.deepEqual(await workspace.load('key'), {
    status: 'draft',
    raw: { say: 'Keep me' },
    problems: ['Missing board'],
  });
  assert.deepEqual(calls, [['generation-a', 'key']]);
  await workspace.save('key', { status: 'ready' });
  assert.deepEqual(events, [{ type: 'workspace.saved', data: { key: 'key', value: { status: 'ready' } } }]);
});

test('provider work survives a reconstructed caller without charging or dispatching it again', async () => {
  const store = new Map<string, unknown>();
  const workspace: GenerationWorkspace = {
    load: async (key) => store.get(key),
    save: async (key, value) => {
      store.set(key, structuredClone(value));
    },
  };
  let dispatches = 0;
  const client = {
    complete: async () => {
      dispatches++;
      return {
        value: { say: 'Saved draft' },
        requestId: 'first',
        usage: { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      };
    },
  } as unknown as MuseClient;
  const events: string[] = [];
  const input: TourGenerationInput = {
    documentId: 'doc',
    analysisId: 'analysis',
    doc,
    images: [],
    workspace,
    onEvent: async (type) => {
      events.push(type);
    },
  };
  const request = (version: string) =>
    recordedCalls(client, input, 'model', version).call([], 'plan', {}, 6000, 'low', new AbortController().signal);
  await request('v1');
  const reused = await request('v1');
  assert.equal(dispatches, 1);
  assert.equal(reused.usage.totalTokens, 0);
  assert.deepEqual(reused.value, { say: 'Saved draft' });
  assert.ok(events.includes('workspace.reused'));
  await request('v2');
  assert.equal(dispatches, 2, 'Changed instructions must invalidate saved work');
  assert.notEqual(workKey({ model: 'a' }), workKey({ model: 'b' }));
});
