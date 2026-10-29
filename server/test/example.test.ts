import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc } from '../../shared/paper';
import { parseExpression } from '../../shared/plot';
import { checkExample, checkedCalculation, claimsNumericExample } from '../src/harness/example';
import { beatStep, findAnchor, tourProblems } from '../src/harness/assemble';
import { beatTargets, cleanDirection, directionSchema } from '../src/harness/direct';
import type { Beat } from '../src/harness/beats';
import { exampleSay, numericalExample } from './example-fixture';
const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  blocks: [],
  sentences: [],
  figures: [],
  equations: [{ id: 'eq1', number: '1', page: 1, block: 'b1', bbox: [0, 0, 200, 50], text: 'y=2x' }],
};
const beat: Beat = {
  id: 'formula-2',
  kind: 'formula',
  arc: 'method',
  target: 'eq1',
  detail: true,
  board: 'formula',
  evidence: [],
  point: 'Explain doubling.',
};
const flow = (labels: string[]) => ({
  title: 'Illustrative values',
  nodes: labels.map((label, i) => ({ id: `node-${i + 1}`, label })),
  edges: labels.slice(1).map((_, i) => ({ from: `node-${i + 1}`, to: `node-${i + 2}` })),
});

test('worked example compiles input and result states at narrated times, with focus reset per frame', () => {
  const targets = beatTargets(beat, doc);
  const direction = cleanDirection(
    {
      plan: 'Compute a small case.',
      say: exampleSay,
      example: numericalExample(),
      cues: [
        { action: 'board_focus', target: 'node-1', label: '', anchor: 'the input is' },
        { action: 'board_focus', target: 'term-1', label: '', anchor: 'Adding the input twice' },
      ],
    },
    beat,
    targets,
  )!;
  assert.deepEqual(direction.exampleProblems, []);
  const step = beatStep(beat, targets, direction, doc);
  const boards = step.actions.filter((a) => a.type === 'board');
  assert.equal(boards.length, 2);
  assert.equal(boards[0].item.kind, 'flow');
  assert.equal(boards[1].item.kind === 'formula' && boards[1].item.latex, '2+2=4');
  assert.deepEqual(
    boards.map((a) => a.at_word),
    [findAnchor(exampleSay, 'the input is'), findAnchor(exampleSay, 'Adding the input twice')],
  );
  assert.deepEqual(
    step.actions.filter((a) => a.type === 'board_focus').map((a) => [a.part, a.at_word]),
    [
      [0, boards[0].at_word],
      [0, boards[1].at_word],
    ],
  );
  assert.deepEqual(
    tourProblems(
      {
        schema: 'paper-tour/tour@0.1',
        title: 'Example',
        paper: 'paper',
        chapters: [{ id: 'c', title: 'Method', steps: [step] }],
      },
      doc,
    ),
    [],
  );
});

test('formula detail cannot replace its worked sequence with the original symbolic formula', () => {
  const targets = beatTargets(beat, doc);
  const direction = cleanDirection(
    {
      plan: 'p',
      say: exampleSay,
      formula: {
        latex: 'y=2x',
        terms: [
          { latex: 'y', label: 'Output' },
          { latex: '2x', label: 'Transformation' },
        ],
      },
      cues: [],
    },
    beat,
    targets,
  )!;
  assert.match(direction.exampleProblems!.join(' '), /needs example frames/);
  assert.throws(() => beatStep(beat, targets, direction, doc), /needs example frames/);
  const formula = {
    latex: 'x=2',
    terms: [
      { latex: 'x', label: 'Input' },
      { latex: '2', label: 'Value' },
    ],
  };
  const changedLabels = {
    ...numericalExample(),
    frames: [
      { anchor: 'the input is', formula },
      {
        anchor: 'Adding the input twice',
        formula: {
          ...formula,
          title: 'New title',
          terms: [
            { latex: 'x', label: 'Different label' },
            { latex: '2', label: 'Another label' },
          ],
        },
      },
    ],
  };
  assert.match(checkExample(changedLabels, exampleSay).problems.join(' '), /change visible values/);
});

test('visible invented values, false equalities and undeclared calculation operands require correction', () => {
  const first = { anchor: 'the input is', flow: flow(['Input 2', 'Addition', 'Result']) };
  for (const final of [flow(['Output 999', 'Check 4', 'Result']), flow(['2 + 2 = 2', 'Checked 4', 'Result'])]) {
    const value = { ...numericalExample(), frames: [first, { anchor: 'Adding the input twice', flow: final }] };
    assert.ok(checkExample(value, exampleSay).problems.some((p) => /undeclared value 999|does not match/.test(p)));
  }
  const bad = { ...numericalExample(), calculations: [{ expression: '2+999', result: 1001 }] };
  assert.match(checkExample(bad, exampleSay).problems.join(' '), /undeclared value 999/);
  assert.match(checkedCalculation('2+2', 5)!, /does not match/);
  assert.match(checkedCalculation('globalThis.process.exit()', 4)!, /bounded arithmetic/);
  assert.match(checkedCalculation('x+2', 4)!, /undeclared/);
});

test('rounded values and neutral constants work without accepting incorrect arithmetic', () => {
  assert.equal(checkedCalculation('softmax(4,0)', 0.98), null);
  assert.equal(checkedCalculation('softmax(4,0)*10', 9.8), null);
  assert.equal(checkedCalculation('relu(-2)', 0), null);
  assert.match(checkedCalculation('softmax(4,0)', 0.95)!, /does not match/);
  assert.deepEqual(
    checkExample({ ...numericalExample(), calculations: [{ expression: '2+0+1+1', result: 4 }] }, exampleSay).problems,
    [],
  );
});

test('frames need exact forward anchors and explicit values rather than axis endpoints', () => {
  const value = numericalExample();
  value.frames[1].anchor = 'unspoken words';
  assert.match(checkExample(value, exampleSay).problems.join(' '), /exact anchor/);
  value.frames[1].anchor = value.frames[0].anchor;
  assert.match(checkExample(value, exampleSay).problems.join(' '), /progress through/);
  const plot = { kind: 'plot', x: [0, 2], y: [0, 4], curves: [{ expression: 'relu(x)', label: 'Output' }] };
  assert.match(
    checkExample(
      {
        ...numericalExample(),
        frames: [
          { anchor: 'the input is', plot },
          { anchor: 'Adding the input twice', plot: { ...plot, x: [0, 1] } },
        ],
      },
      exampleSay,
    ).problems.join(' '),
    /axis bounds alone/,
  );
  assert.deepEqual(checkExample(undefined, 'The paper compares 4 systems on 2 datasets.').problems, []);
  assert.equal(claimsNumericExample('For an illustrative case, input two becomes four.'), true);
  assert.equal(claimsNumericExample('Follow an illustrative token through the two modules.'), false);
});

test('method can choose a plot without a planner keyword or first-flow restriction', () => {
  const method: Beat = {
    id: 'method-1',
    kind: 'method',
    arc: 'method',
    point: 'A nonlinear transformation.',
    evidence: [],
  };
  const targets = beatTargets(method, doc);
  assert.ok('plot' in directionSchema(method, targets).properties);
  assert.ok(targets.parts?.includes('curve-1'));
  const direction = cleanDirection(
    {
      plan: 'p',
      say: 'The curve bends upward as input increases, so equal changes in input have different effects on output.',
      plot: { x: [0, 2], y: [0, 4], curves: [{ expression: 'x^2', label: 'Squared input' }] },
      cues: [{ action: 'board_focus', target: 'curve-1', anchor: 'curve bends upward', label: '' }],
    },
    method,
    targets,
  )!;
  assert.equal(direction.board?.kind, 'plot');
  assert.deepEqual(direction.boardProblems, []);
});

test('parameter lists and subtraction of a declared negative bias remain valid concrete arithmetic', () => {
  const say =
    'Initially the illustrative parameters specify the input and both maps. Next the first map suppresses the negative value. Finally the second map produces the output.';
  const value = {
    assumptions: 'Illustrative scalar maps with fixed weights and biases.',
    inputs: [
      { label: 'x', value: 2 },
      { label: 'W1', value: 0.5 },
      { label: 'b1', value: -1.5 },
      { label: 'W2', value: 2 },
      { label: 'b2', value: 1 },
    ],
    calculations: [
      { expression: '2*0.5-1.5', result: -0.5 },
      { expression: 'max(-0.5,0)', result: 0 },
      { expression: '0*2+1', result: 1 },
    ],
    frames: [
      {
        anchor: 'Initially the illustrative',
        formula: {
          latex: 'x=2, W_1=0.5, b_1=-1.5, W_2=2.0, b_2=1.0',
          terms: [
            { latex: 'x=2', label: 'Scalar input' },
            { latex: 'b_1=-1.5', label: 'First bias' },
          ],
        },
      },
      { anchor: 'Next the first map', flow: flow(['Input 2', 'max(0,2*0.5-1.5)=0', 'Hidden 0']) },
      {
        anchor: 'Finally the second map',
        formula: {
          latex: '0\\times 2.0+1.0=1.0',
          terms: [
            { latex: '0\\times 2.0+1.0', label: 'Second map' },
            { latex: '1.0', label: 'Output' },
          ],
        },
      },
    ],
  };
  assert.deepEqual(checkExample(value, say).problems, []);
  const onlyFormula = { ...value, frames: [value.frames[0], value.frames[2]] };
  assert.match(checkExample(onlyFormula, say).problems.join(' '), /not only formula cards/);
});

test('example arithmetic permits finite operation counts without loosening plot constants', () => {
  assert.equal(checkedCalculation('32*512^2', 8388608), null);
  assert.equal(checkedCalculation('2147483648/2', 1073741824), null);
  assert.throws(() => parseExpression('2147483648'));
  const example = {
    assumptions: 'Illustrative operation count with sequence length 32 and width 512.',
    inputs: [
      { label: 'Length', value: 32 },
      { label: 'Width', value: 512 },
    ],
    calculations: [{ expression: '32*512^2', result: 8388608 }],
    frames: [
      { anchor: 'Start with', flow: flow(['Length 32', 'Width 512', 'Compute cost']) },
      { anchor: 'The result', flow: flow(['Operation count 8388608', 'Checked arithmetic', 'Result']) },
    ],
  };
  assert.deepEqual(
    checkExample(example, 'Start with the illustrative dimensions. The result is the operation count.').problems,
    [],
  );
});

test('one repair report includes bad layout and missing first input even when later frames are valid', () => {
  const example = numericalExample();
  example.frames[0].flow!.nodes[0].label = 'Input';
  example.frames[0].flow!.edges = [];
  const problems = checkExample(example, exampleSay).problems;
  assert.ok(
    problems.some((p) => /connect|edge|arrows/i.test(p)),
    problems.join('\n'),
  );
  assert.ok(
    problems.some((p) => /first example frame.*Input = 2/i.test(p)),
    problems.join('\n'),
  );
  assert.ok(!problems.some((p) => /final example frame/.test(p)), problems.join('\n'));
});

test('progressive comparison accepts a single baseline bar and digits inside model names', () => {
  const say = 'The baseline scores 26.36. The comparison adds 28.4. The gain is 2.04.';
  const result = checkExample(
    {
      assumptions: 'Fixed metric and baseline.',
      inputs: [
        { label: 'baseline', value: 26.36 },
        { label: 'comparison', value: 28.4 },
      ],
      calculations: [{ expression: '28.4-26.36', result: 2.04 }],
      frames: [
        {
          anchor: 'The baseline scores',
          bars: { title: 'Baseline', unit: 'score', bars: [{ label: 'ConvS2S Ensemble', value: 26.36 }] },
        },
        {
          anchor: 'The comparison adds',
          bars: {
            title: 'Comparison',
            unit: 'score',
            bars: [
              { label: 'ConvS2S Ensemble', value: 26.36 },
              { label: 'Model2', value: 28.4 },
            ],
          },
        },
        {
          anchor: 'The gain is',
          formula: {
            latex: '28.4-26.36\\approx 2.04',
            terms: [
              { latex: '2.04', label: 'gain' },
              { latex: '28.4', label: 'comparison' },
            ],
          },
        },
      ],
    },
    say,
  );
  assert.deepEqual(result.problems, []);
  assert.equal(checkedCalculation('exp(8)/(exp(8)+exp(0))', 0.9996646498695336), null);
  assert.notEqual(checkedCalculation('2+2', 5), null);
});

test('comma-separated numeric equations are checked independently without splitting function arguments', () => {
  const example = numericalExample();
  const say = exampleSay;
  const frame = example.frames.find((f: any) => f.formula) as any;
  frame.formula.latex = '8/8=1, 6/8=0.75';
  frame.formula.terms = [
    { latex: '8/8=1', label: 'first' },
    { latex: '6/8=0.75', label: 'second' },
  ];
  const problems = checkExample(example, say).problems;
  assert.equal(
    problems.some((p) => p.includes('Visible calculation')),
    false,
  );
  frame.formula.latex = '8/8=2, 6/8=0.75';
  assert.equal(
    checkExample(example, say).problems.some((p) => p.includes('Visible calculation')),
    true,
  );
});

test('vector display notation does not enter the scalar checker; explicit calculations still do', () => {
  const example = numericalExample();
  const frame = example.frames.find((f: any) => f.formula) as any;
  frame.formula.latex = '[2,2][1,1]^T=4';
  frame.formula.terms = [
    { latex: '[2,2]', label: 'vector' },
    { latex: '4', label: 'result' },
  ];
  assert.equal(
    checkExample(example, exampleSay).problems.some((p) => p.includes('Visible calculation')),
    false,
  );
  example.calculations[0].result = 5;
  assert.equal(
    checkExample(example, exampleSay).problems.some((p) => p.includes('does not match')),
    true,
  );
});

test('rounded intermediate references retain exact computed values across later stages', () => {
  const value = numericalExample();
  value.inputs = [{ label: 'logit', value: 2 }];
  value.calculations = [
    { expression: 'exp(2)/(exp(2)+1)', result: 0.88079708 },
    { expression: '1-0.88079708', result: 0.11920292 },
    { expression: '0.88079708*0.11920292', result: 0.10499359 },
  ];
  value.frames[0].flow!.nodes[0].label = 'Input 2';
  value.frames[1].formula!.latex = '0.88079708*0.11920292\\approx0.10499359';
  value.frames[1].formula!.terms = [
    { latex: '0.88079708*0.11920292', label: 'gradient' },
    { latex: '0.10499359', label: 'result' },
  ];
  assert.deepEqual(checkExample(value, exampleSay).problems, []);
  value.calculations[2].result = 0.15;
  assert.match(checkExample(value, exampleSay).problems.join(' '), /does not match/);
});

test('literal rounded substitutions remain valid alongside exact intermediate references', () => {
  const exact = new Map([
    [0.82, 0.8175744762],
    [0.18, 0.1824255238],
  ]);
  assert.equal(checkedCalculation('0.82*1+0.18*3', 1.36, exact), null);
  assert.match(checkedCalculation('0.82*1+0.18*3', 1.5, exact)!, /does not match/);
});

test('isolated scalar matrices cannot satisfy the requirement to visualize a mechanism', () => {
  const value = numericalExample();
  const first = value.frames[0] as any;
  delete first.flow;
  first.scene = {
    title: 'Starting scalar',
    objects: [{ id: 'input', type: 'matrix', x: 0.2, y: 0.3, w: 0.4, h: 0.3, values: [[2]] }],
  };
  assert.match(checkExample(value, exampleSay).problems.join(' '), /isolated scalar matrices/);
});

test('named component ordinals are labels rather than invented numerical operands', () => {
  const value = numericalExample();
  value.frames[0].flow!.nodes[0].label = 'key 3 input 2';
  assert.deepEqual(checkExample(value, exampleSay).problems, []);
  value.frames[0].flow!.nodes[0].label = 'key 3 input 7';
  assert.match(checkExample(value, exampleSay).problems.join(' '), /undeclared value 7/);
});
