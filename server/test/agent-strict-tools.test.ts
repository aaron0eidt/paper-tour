import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { AGENT_TOOLS, checkArguments } from '../src/agent/tools';
import { strictVisualObservationTool } from '../src/agent/strict-tools';

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
