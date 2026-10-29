import test from 'node:test';
import assert from 'node:assert/strict';
import { checkExample, checkedCalculation } from '../src/harness/example';
import { checkBars } from '../src/harness/board';
import { exampleSay, numericalExample } from './example-fixture';

const say =
  'Initially we show an illustrative input and keep the transformation fixed. Next we compute the output and compare the actual result with the starting value.';
const flow = (labels: string[]) => ({
  title: 'Illustrative calculation',
  nodes: labels.map((label, i) => ({ id: `node-${i + 1}`, label })),
  edges: labels.slice(1).map((_, i) => ({ from: `node-${i + 1}`, to: `node-${i + 2}` })),
});
const formula = (latex: string, terms: string[]) => ({
  title: 'Illustrative calculation',
  latex,
  terms: terms.map((part, i) => ({ latex: part, label: i ? 'Result' : 'Calculation' })),
});
const worked = (input: number, expression: string, result: number, output: object, otherInputs: number[] = []) => ({
  assumptions: 'Illustrative arithmetic with the stated inputs and fixed operation.',
  inputs: [input, ...otherInputs].map((value, i) => ({ label: `Input ${i + 1}`, value })),
  calculations: [{ expression, result }],
  frames: [
    { anchor: 'Initially we show', flow: flow([`Input ${input}`, 'Transformation', 'Output']) },
    { anchor: 'Next we compute', ...output },
  ],
});
const rejected = (value: unknown, explanation: string, narration = say) => {
  const result = checkExample(value, narration);
  assert.equal(result.example, undefined, explanation);
  assert.ok(result.problems.length, `must report the actual problem: ${explanation}`);
  return result.problems.join(' ');
};

test('native function equalities retain the function when checking visible arithmetic', () => {
  for (const [input, expression, result, shown] of [
    [4, 'sqrt(4)', 2, 'sqrt(4)=2'],
    [-2, 'relu(-2)', 0, 'relu(-2)=0'],
    [4, 'softmax(4,0)', 0.98, 'softmax(4,0)=0.98'],
  ] as const) {
    const value = worked(input, expression, result, { flow: flow([shown, `Result ${result}`, 'Finished']) });
    assert.deepEqual(checkExample(value, say).problems, [], shown);
  }
  const wrong = worked(4, 'sqrt(4)', 2, { flow: flow(['sqrt(4)=4', 'Checked result 2', 'Finished']) });
  assert.match(
    rejected(wrong, 'square root result is false even though every number is declared'),
    /Visible calculation|does not match/,
  );
});

test('ordinary one-backslash LaTeX fractions and operators are checked rather than skipped', () => {
  const fraction = String.raw`\frac{4}{2}`;
  const valid = worked(4, '4/2', 2, { formula: formula(`${fraction}=2`, [fraction, '2']) }, [2]);
  assert.deepEqual(checkExample(valid, say).problems, []);
  const falseFraction = worked(4, '4/2', 2, { formula: formula(`${fraction}=4`, [fraction, '4']) }, [2]);
  assert.match(
    rejected(falseFraction, 'a denominator that equals the checked result cannot excuse a false quotient'),
    /Visible calculation|does not match/,
  );
  const times = String.raw`2\times2`;
  const falseProduct = worked(2, '2*2', 4, { formula: formula(`${times}=2+4`, [times, '4']) });
  assert.match(
    rejected(falseProduct, 'both sides of the displayed equality must agree'),
    /Visible calculation|does not match/,
  );
});

test('every link of an equality chain must hold even when all digits are allowed', () => {
  const value = worked(2, '2+2', 4, { formula: formula('2+2=4=2', ['2+2', '4']) });
  assert.match(
    rejected(value, 'a true first equality cannot hide a false second equality'),
    /Visible calculation|does not match/,
  );
  const valid = worked(2, '2+2', 4, { formula: formula('2+2=4=2*2', ['2+2', '4']) });
  assert.deepEqual(checkExample(valid, say).problems, []);
});

test('display rounding does not require changing the checked internal result', () => {
  const exact = 1.414213562;
  assert.equal(checkedCalculation('sqrt(2)', exact), null);
  const valid = worked(2, 'sqrt(2)', exact, { flow: flow(['sqrt(2)=1.41', 'Rounded 1.41', 'Finished']) });
  assert.deepEqual(checkExample(valid, say).problems, []);
  const wrong = worked(2, 'sqrt(2)', exact, { flow: flow(['sqrt(2)=1.45', 'Rounded 1.45', 'Finished']) });
  rejected(wrong, 'rounding must stay within the displayed precision');
  assert.notEqual(checkedCalculation('sqrt(2)', 1), null, 'an integer result must be exact');
});

test('small scientific-notation results do not inherit a much larger absolute rounding tolerance', () => {
  assert.equal(checkedCalculation('1/1000000/1000', 1e-9), null);
  assert.notEqual(
    checkedCalculation('1/1000000/1000', 5e-9),
    null,
    'five times the correct result is not a rounding of it',
  );
});

test('illustrative bars may round checked outputs without weakening paper-data provenance', () => {
  const bars = (value: number) => ({
    title: 'Illustrative input and root',
    unit: 'value',
    bars: [
      { label: 'Input', value: 2 },
      { label: 'Output', value },
    ],
  });
  const exact = 1.414213562;
  const valid = worked(2, 'sqrt(2)', exact, { bars: bars(1.41) });
  assert.deepEqual(checkExample(valid, say).problems, [], 'rounded bar remains tied to its checked output');
  rejected(worked(2, 'sqrt(2)', exact, { bars: bars(1.45) }), 'an incorrect output bar cannot masquerade as rounding');
  rejected(worked(2, 'sqrt(2)', exact, { bars: bars(999) }), 'an undeclared output bar cannot publish');
  rejected(
    worked(2, 'sqrt(2)', exact, { bars: { ...bars(1.41), higher_is_better: false } }),
    'an illustrative intermediate value must not become a lower-is-better ranking either',
  );
  assert.equal(
    checkBars(bars(1.41), 'The paper reports input 2 and output 1.414213562.').item,
    null,
    'ordinary evidence charts retain exact source-number validation',
  );
  assert.equal(
    checkBars({ ...bars(1.41), higher_is_better: false }, 'The paper reports input 2 and output 1.41.').item
      ?.higher_is_better,
    false,
    'a source-backed metric may retain its explicitly authored lower-is-better direction',
  );
});

test('present malformed examples never silently become absent optional examples', () => {
  for (const value of [null, false, 'not a sequence', 42, []])
    rejected(value, `present malformed value ${JSON.stringify(value)}`);
  assert.deepEqual(
    checkExample(undefined, 'This explanation does not use a numerical example.'),
    { problems: [] },
    'omission remains allowed',
  );
});

test('invalid array elements are reported instead of being filtered out of an otherwise valid example', () => {
  const base = numericalExample();
  for (const value of [
    { ...base, inputs: [...base.inputs, null] },
    { ...base, calculations: [...base.calculations, 'malformed'] },
    { ...base, frames: [base.frames[0], null, base.frames[1]] },
    { ...base, frames: [base.frames[0], [], base.frames[1]] },
  ])
    rejected(value, 'malformed entries cannot disappear during validation', exampleSay);
});
