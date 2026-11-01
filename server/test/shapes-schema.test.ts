import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { SHAPES_SCHEMA, shapesProblems } from '../../shared/shapes';
import { sdkSchema } from '../src/ai/provider';
import { answerSchema } from '../src/harness/ask-authoring';
import { retrieve } from '../src/harness/ask-retrieval';
import { ENUM_ROOM, enumValues } from '../src/harness/schema-budget';
import { doc } from './plan-fixture';

const check = new Ajv2020({ strict: false, allErrors: true }).compile(sdkSchema(SHAPES_SCHEMA));
const matrix = (name: string) => ({ kind: 'matrix', name, rows: 'n', cols: 'd' });
const expression = (op: object) => ({ kind: 'shapes', terms: [matrix('X'), op, matrix('Y')] });

test('the provider shapes contract requires an actual function label for apply', () => {
  for (const op of [
    { kind: 'op', op: 'apply' },
    { kind: 'op', op: 'apply', label: '' },
    { kind: 'op', op: 'apply', label: '   ' },
    { kind: 'op', op: 'apply', rows: 'n' },
  ])
    assert.equal(check(expression(op)), false, JSON.stringify(op));
  const valid = expression({ kind: 'op', op: 'apply', label: 'tanh' });
  assert.equal(check(valid), true, JSON.stringify(check.errors));
  assert.deepEqual(shapesProblems(valid), []);
});
test('matrix and ordinary operator variants require their own fields without dummy labels', () => {
  const valid = expression({ kind: 'op', op: 'plus' });
  assert.equal(check(valid), true, JSON.stringify(check.errors));
  assert.deepEqual(shapesProblems(valid), []);
  for (const field of ['name', 'rows', 'cols']) {
    const incomplete = matrix('X') as Record<string, unknown>;
    delete incomplete[field];
    assert.equal(check({ kind: 'shapes', terms: [incomplete, { kind: 'op', op: 'plus' }, matrix('Y')] }), false, field);
  }
  assert.equal(
    check(expression({ kind: 'op', op: 'plus', rows: 'n' })),
    false,
    'matrix dimensions cannot be placed on operators',
  );
  assert.equal(
    check(expression({ kind: 'matrix', op: 'apply', label: 'f' })),
    false,
    'the discriminator cannot claim an operator is a matrix',
  );
});
test('the tagged term variants keep the complete answer schema within provider nesting and enum budgets', () => {
  const schema = answerSchema(retrieve(doc, { question: 'Explain the matrix dimensions.' }));
  const depth = (node: unknown): number => {
    if (!node || typeof node !== 'object') return 0;
    if (Array.isArray(node)) return Math.max(0, ...node.map(depth));
    const value = node as { type?: string };
    return (
      (value.type === 'object' || value.type === 'array' ? 1 : 0) + Math.max(0, ...Object.values(value).map(depth))
    );
  };
  assert.ok(depth(schema) <= 10, `${depth(schema)} object/array levels`);
  assert.ok(enumValues(schema) <= ENUM_ROOM, `${enumValues(schema)} enum values`);
});
