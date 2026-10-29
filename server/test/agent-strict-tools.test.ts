import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { AGENT_TOOLS, checkArguments } from '../src/agent/tools';
import { strictVisualObservationTool, shallowChapterTool } from '../src/agent/strict-tools';

test('strict observations require descriptions and all nested fields without mutating the existing tool', () => {
  const original = AGENT_TOOLS.find((t) => t.name === 'record_visual_observations')!;
  const before = JSON.stringify(original);
  const strict = strictVisualObservationTool(original);
  assert.equal(strict.strict, true);
  assert.equal(JSON.stringify(original), before);
  const validate = new Ajv2020({ strict: false }).compile(strict.parameters);
  const data = {
    observations: [
      {
        sourceId: 'page1',
        description: 'Page title and abstract.',
        readable: true,
        uncertainties: [],
        replaceComponents: false,
        components: [{ label: 'Abstract', region: [0, 0, 1, 1], explanation: '' }],
      },
    ],
  };
  assert.equal(validate(data), true);
  checkArguments(original.name, data);
  const missing = structuredClone(data) as any;
  delete missing.observations[0].description;
  assert.equal(validate(missing), false);
  const nested = structuredClone(data) as any;
  delete nested.observations[0].components[0].explanation;
  assert.equal(validate(nested), false);
  const empty = structuredClone(data);
  empty.observations[0].components = [];
  assert.equal(validate(empty), true);
});

test('other agent tools retain their wire format and strictness', () => {
  for (const tool of AGENT_TOOLS.filter((t) => t.name !== 'record_visual_observations'))
    assert.equal(strictVisualObservationTool(tool), tool);
});

test('the chapter wire contract stays structured and bounded while canonical action validation remains strict', () => {
  const original = AGENT_TOOLS.find((tool) => tool.name === 'upsert_tour_chapter')!;
  const before = JSON.stringify(original),
    wire = shallowChapterTool(original),
    schema = wire.parameters as any;
  assert.equal(wire.strict, false);
  assert.equal(schema.properties.chapter.type, 'object');
  assert.equal(schema.$defs, undefined);
  assert(wire.description.includes(JSON.stringify(original.parameters)));
  assert.equal(JSON.stringify(original), before);
  const check = new Ajv2020({ strict: false }).compile(wire.parameters);
  const value = {
    chapter: {
      id: 'method',
      title: 'Method',
      steps: [
        {
          id: 's1',
          source: 'p1.s1',
          say: 'Explain the method.',
          evidence: ['p1.s1'],
          actions: [{ type: 'focus', target: 'p1.s1', at_word: 0 }],
        },
      ],
    },
  };
  assert(check(value));
  checkArguments(original.name, value);
  assert(!check({ chapter: JSON.stringify(value.chapter) }));
  const invalid = structuredClone(value) as any;
  invalid.chapter.steps[0].actions[0].unsupported = true;
  assert.throws(
    () => checkArguments(original.name, invalid),
    /Invalid tool arguments/,
    'The provider projection must never weaken journal validation',
  );
});

test('the same bounded authoring schema serves full tours and chapter tools without changing canonical definitions', async () => {
  const { museAuthoringSchema } = await import('../src/muse/authoring-schema');
  const { TOUR_DRAFT_SCHEMA } = await import('../src/muse/schema');
  const before = JSON.stringify(TOUR_DRAFT_SCHEMA),
    wire = museAuthoringSchema(TOUR_DRAFT_SCHEMA) as any;
  assert.equal(wire.$defs, undefined);
  assert.equal(wire.properties.chapters.items.properties.steps.items.properties.source.type, 'string');
  assert(wire.description.includes(JSON.stringify(TOUR_DRAFT_SCHEMA.$defs)));
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    assert(!Object.hasOwn(value, '$ref'), 'Provider schema must not retain dangling canonical references');
    Object.values(value).forEach(visit);
  };
  visit(wire);
  assert.equal(JSON.stringify(TOUR_DRAFT_SCHEMA), before);
  const simple = { type: 'object', properties: { query: { type: 'string' } } };
  assert.equal(museAuthoringSchema(simple), simple);
});
