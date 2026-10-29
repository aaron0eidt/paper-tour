import test from 'node:test';
import assert from 'node:assert/strict';
import { createToolRegistry, defineTool, wire } from '../src/agent/tools/registry';
import { paperTools } from '../src/agent/tools';
import type { RunState, ToolScope } from '../src/agent/tools';
import { createTourGenerator } from '../src/generation/writers';
import { HarnessTourGenerator } from '../src/harness/generator';
import { MuseTourGenerator } from '../src/muse/generator';

test('a new paper tool registers schema, progress stage and execution in one module', async () => {
  const tool = defineTool({
    wire: wire([
      'inspect_relation',
      'Inspect a relationship.',
      { type: 'object', properties: { label: { type: 'string' } }, required: ['label'], additionalProperties: false },
    ]),
    effect: 'write',
    stage: 'images',
    async execute(_scope, state, args) {
      state.title = args.label;
      return { state, output: { inspected: true } };
    },
  });
  const registry = createToolRegistry([tool]);
  const before: RunState = { plan: [], chapters: {}, observations: {}, presented: {} };
  const result = await registry.execute({} as ToolScope, before, 'inspect_relation', { label: 'A relationship' });
  assert.equal(result.state.title, 'A relationship');
  assert.equal(before.title, undefined, 'The journal input must not be mutated');
  assert.equal(registry.stage('inspect_relation'), 'images');
  assert.equal(registry.effect('inspect_relation'), 'write');
  await assert.rejects(registry.execute({} as ToolScope, before, 'inspect_relation', {}), /Invalid tool arguments/);
  await assert.rejects(registry.execute({} as ToolScope, before, 'invented', {}), /unknown tool/);
  assert.throws(() => createToolRegistry([tool, tool]), /Duplicate paper tool/);
  assert.deepEqual(
    paperTools.definitions.map((tool) => tool.name),
    [
      'search_paper',
      'read_elements',
      'view_visuals',
      'record_visual_observations',
      'set_tour_plan',
      'upsert_tour_chapter',
      'finish_tour',
    ],
  );
  assert.equal(paperTools.effect('search_paper'), 'read');
  assert.equal(paperTools.effect('view_visuals'), 'write', 'Delivering an image changes durable context state');
});

test('one generation factory binds guided and walkthrough strategies without losing model selection', () => {
  const config = {
    apiKey: 'test-key',
    baseUrl: 'https://api.meta.ai/v1',
    model: 'muse-spark-1.3',
    language: 'en',
    timeoutMs: 5000,
  };
  const guided = createTourGenerator(config, { writer: 'harness', preset: 'deep' });
  const walkthrough = createTourGenerator(config, { writer: 'muse', preset: 'deep' });
  assert(guided instanceof HarnessTourGenerator);
  assert(walkthrough instanceof MuseTourGenerator);
  for (const generator of [guided, walkthrough]) {
    assert.equal(generator.model, config.model);
    assert.equal(generator.withModel!('muse-spark-1.3-contributor').model, 'muse-spark-1.3-contributor');
    assert.throws(() => generator.withModel!('unsupported'), /supports paper text and images/);
  }
  assert.throws(
    () => createTourGenerator({ ...config, model: 'unsupported' }, { writer: 'harness', preset: 'deep' }),
    /supports paper text and images/,
  );
});
