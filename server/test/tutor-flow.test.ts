import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { BUILTIN_TOUR_PROFILES, profileSnapshot } from '../../shared/tourProfiles';
import {
  FORMULA_BEFORE_MAX,
  splitWords,
  type Action,
  type BBox,
  type BlockType,
  type Doc,
  type DocExercise,
  type Step,
  type Tour,
} from '../../shared/paper';
import type { MuseConfig } from '../src/config';
import type { TourGenerationInput, TourImage } from '../src/tour-generator';
import { HarnessTourGenerator } from './harness-fixture';
import { boardProblems, findAnchor } from '../src/harness/assemble';
import { checkFormula, type FormulaItem } from '../src/harness/board';
import { SUBJECTS } from '../src/harness/card';
import {
  SHEET_STEPS,
  SOLVE_KINDS,
  cleanSolution,
  conceptKey,
  exerciseUnits,
  leaksResult,
  lineName,
  planUnits,
  solutionLines,
  solveSchema,
  solveTask,
  startsTask,
  toolKeys,
  unitBrief,
  unitFallback,
  unitOverhead,
  unitSteps,
  type Unit,
} from '../src/harness/exercise';
import { opensTemplated } from '../src/harness/exercise-voice';
import {
  EXAMPLES,
  FOLLOW_ON,
  exampleFor,
  exampleKind,
  type ExampleLine,
} from '../src/harness/exercise-examples';
import type { LineCheck, MathVerifier } from '../src/harness/verify';

// The tutor flow for exercise sheets (notes/TUTOR.md): the solve schema v2 (kind, background, check, pitfall), the
// worked examples by subject, the three forms of a part and the steps they make, the board that keeps the working, the
// background given once per concept in tour order, the lengths by preset and the adaptive fallback.

const settings: MuseConfig = {
  apiKey: 'unit-test-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en-US',
  timeoutMs: 5000,
};
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=';
const rect = (y: number): BBox => [50, y, 500, y + 14];

type Row = [string, BlockType, Record<string, string>];
function makeDoc(rows: Row[], exercises: DocExercise[]): Doc {
  return {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'doc.pdf', sha256: 'f'.repeat(64), num_pages: 1, generator: 'test', title: 'Problem Set 3' },
    pages: [{ n: 1, width: 600, height: 800 }],
    sections: [],
    blocks: rows.map(([id, type, sentences], i) => ({
      id,
      page: 1,
      type,
      bbox: rect(40 + 20 * i),
      text: Object.values(sentences).join(' '),
      sentences: Object.keys(sentences),
    })),
    sentences: rows.flatMap(([id, , sentences], i) =>
      Object.entries(sentences).map(([sid, text]) => ({
        id: sid,
        page: 1,
        block: id,
        text,
        rects: [rect(40 + 20 * i)],
      })),
    ),
    figures: [],
    equations: [],
    exercises,
  };
}
const sheet = makeDoc(
  [
    ['p1.b1', 'title', { 'p1.s1': 'Problem Set 3' }],
    ['p1.b2', 'paragraph', { 'p1.s2': 'Problem 1' }],
    ['p1.b3', 'paragraph', { 'p1.s3': 'Consider the equation 3x - 7 = 2x + 5.' }],
    ['p1.b4', 'paragraph', { 'p1.s4': 'a) Solve the equation for x.' }],
    ['p1.b5', 'paragraph', { 'p1.s5': 'b) Check your solution by substituting it.' }],
    ['p1.b6', 'paragraph', { 'p1.s6': 'Problem 2' }],
    ['p1.b7', 'paragraph', { 'p1.s7': 'Solve 2x + 3 = 11 for x.' }],
    ['p1.b8', 'paragraph', { 'p1.s8': 'Problem 3' }],
    ['p1.b9', 'paragraph', { 'p1.s9': 'Solve x - 4 = 1 for x.' }],
  ],
  [
    {
      id: 'ex1',
      number: '1',
      page: 1,
      block: 'p1.b2',
      blocks: ['p1.b2', 'p1.b3', 'p1.b4', 'p1.b5'],
      parts: [
        { id: 'ex1.a', label: 'a', page: 1, blocks: ['p1.b4'] },
        { id: 'ex1.b', label: 'b', page: 1, blocks: ['p1.b5'] },
      ],
    },
    { id: 'ex2', number: '2', page: 1, block: 'p1.b6', blocks: ['p1.b6', 'p1.b7'], parts: [] },
    { id: 'ex3', number: '3', page: 1, block: 'p1.b8', blocks: ['p1.b8', 'p1.b9'], parts: [] },
  ],
);

const term = (latex: string, label: string, anchor: string) => ({ latex, label, anchor });
const OWN = {
  'ex1.a': { given: ['p1.s3'], asked: ['p1.s4'] },
  'ex1.b': { given: ['p1.s3'], asked: ['p1.s5'] },
  ex2: { given: [], asked: ['p1.s7'] },
  ex3: { given: [], asked: ['p1.s9'] },
} as const;
const BACKGROUND_SAY =
  'An equation is like a balanced scale, so whatever we do to one side we must also do to the other side.';
const RECALL_SAY = 'Again the balanced scale: whatever we do on one side, we do on the other.';
/** The law of a tool by its concept: two tools of one tour are two when their laws differ. */
const lawOf = (concept: string) =>
  /divid/i.test(concept) ? 'a = b \\;\\Rightarrow\\; \\frac{a}{c} = \\frac{b}{c}' : 'a = b \\;\\Rightarrow\\; a + c = b + c';

/** A scripted answer in schema v3; the part's tool is the given concept, or none. */
function solution(id: keyof typeof OWN = 'ex1.a', concept = 'Equal operations on both sides', extra: object = {}) {
  return {
    plan: '3x - 7 = 2x + 5, x = 12',
    kind: 'calculation',
    read: {
      say: 'Here is an equation in x, and we want the value of x that makes it true. The answer is one number.',
      given: OWN[id].given,
      given_anchor: 'an equation in x',
      asked: OWN[id].asked,
      asked_anchor: 'the value of x',
      marks: [],
    },
    tools: concept
      ? [
          {
            concept,
            say: BACKGROUND_SAY,
            recall: RECALL_SAY,
            formula: {
              title: 'Same move on both sides',
              latex: lawOf(concept),
              terms: [
                term('a = b', 'balanced sides', 'balanced scale'),
                term(lawOf(concept).split('\\Rightarrow\\; ')[1], 'still balanced', 'we must also do'),
              ],
            },
          },
        ]
      : [],
    method: {
      say: 'We do the same on both sides, so the two sides stay equal at every step.',
      formula: { title: '', latex: '', terms: [] },
    },
    steps: [
      {
        title: 'Subtract 2x',
        latex: 'x - 7 = 5',
        terms: [term('x - 7', 'what is left', 'x minus seven is left')],
        say: 'First we subtract two x on both sides, so x minus seven is left on the left and five on the right.',
        sure: true,
      },
      {
        title: 'Add 7',
        latex: 'x = 12',
        terms: [term('12', 'the solution', 'x equals twelve')],
        say: 'Then we add seven on both sides, so x equals twelve.',
        sure: true,
      },
    ],
    answer: {
      title: 'Result',
      latex: 'x = 12',
      terms: [term('12', 'solution', 'x is twelve')],
      say: 'So x is twelve, and both sides of the equation agree.',
    },
    check: {
      say: 'We put twelve back into the equation: three times twelve minus seven and two times twelve plus five are both twenty-nine.',
      latex: '3 \\cdot 12 - 7 = 2 \\cdot 12 + 5',
    },
    pitfall: 'Subtracting on one side only, which breaks the balance.',
    try: {
      prompt: 'Before we solve it, what would you do first to bring the x terms together?',
      hints: [
        'Look at the x terms on both sides of the equation.',
        'Subtract two x from both sides so that only one x term is left.',
        'After that, x minus seven equals five is left; ask which number undoes the minus seven.',
      ],
    },
    check_note: 'Please check this step yourself.',
    questions: ['Why do we do the same on both sides?', 'How can I check my answer?'],
    ...extra,
  };
}
/** The same answer as a model that knows nothing of schema v3 would give it. */
function plainSolution(id: keyof typeof OWN = 'ex1.a') {
  const { kind: _kind, tools: _tools, check: _check, pitfall: _pitfall, ...plain } = solution(id);
  return plain;
}

const taught = (preset: 'quick' | 'standard' | 'deep') => planUnits(exerciseUnits(sheet), preset).taught;
const unitOf = (preset: 'quick' | 'standard' | 'deep', id: string) => taught(preset).find((u) => u.id === id)!;
const solved = (unit: Unit, extra: object = {}) =>
  cleanSolution(solution(unit.id as keyof typeof OWN, undefined, extra), unit, sheet).solution!;
const ok: LineCheck = { status: 'ok' };
const unknown: LineCheck = { status: 'unknown' };
const types = (step: Step) => step.actions.map((a) => a.type);
const boardsOf = (step: Step) =>
  step.actions.filter((a): a is Extract<Action, { type: 'board' }> => a.type === 'board');
const formulaOf = (action: Extract<Action, { type: 'board' }>) => action.item as FormulaItem;

// ----------------------------------------------------------------------------------------------- the solve schema

test('schema v3: the strict schema asks for the kind, the tools, the check and the pitfall', () => {
  const unit = unitOf('standard', 'ex1.a');
  const strict = solveSchema(unit) as { required: string[]; properties: Record<string, any>; $defs: any };
  assert.deepEqual(strict.required, [
    'plan',
    'kind',
    'read',
    'tools',
    'method',
    'steps',
    'answer',
    'check',
    'pitfall',
    'try',
    'check_note',
    'questions',
  ]);
  assert.deepEqual(strict.properties.kind.enum, [...SOLVE_KINDS]);
  assert.deepEqual(SOLVE_KINDS, [
    'calculation',
    'derivation',
    'proof',
    'explanation',
    'chemical_equation',
    'choice',
    'sketch',
    'trace',
  ]);
  // The toolkit: up to two tools in a full part, one in a follow-on or compact part, and none for routine algebra.
  const tools = strict.properties.tools;
  assert.equal(tools.maxItems, 2);
  assert.equal(tools.minItems, undefined, 'the toolkit may be empty');
  assert.deepEqual(tools.items.required, ['concept', 'say', 'recall', 'formula']);
  assert.equal(tools.items.properties.concept.maxLength, 60);
  assert.equal(tools.items.properties.formula.properties.terms.maxItems, 4);
  assert.equal(tools.items.properties.formula.properties.terms.minItems, 0);
  assert.equal((solveSchema(unitOf('standard', 'ex1.b')) as any).properties.tools.maxItems, 1);
  assert.equal((solveSchema(unitOf('quick', 'ex1.a')) as any).properties.tools.maxItems, 1);
  // The checkpoint and the method are the part's choice: both may be empty.
  assert.equal(strict.properties.try.properties.prompt.minLength, undefined, 'a part may have no checkpoint');
  assert.equal(strict.properties.method.properties.say.minLength, undefined, 'a part may have no method step');
  assert.deepEqual(strict.properties.check.required, ['say', 'latex']);
  assert.equal(strict.properties.pitfall.maxLength, 160);
  // The strict schema keeps the ID enums of the part's own sentences.
  assert.deepEqual(strict.$defs.sentenceId.enum, unit.sentences);
});

test('schema v3: the loose schema takes an answer without the new fields, and the part is a usable solution', () => {
  const unit = unitOf('standard', 'ex1.a');
  const loose = solveSchema(unit, false) as { required: string[]; properties: Record<string, any> };
  for (const key of ['kind', 'tools', 'check', 'pitfall', 'try']) assert.ok(!loose.required.includes(key), key);
  for (const key of ['plan', 'read', 'method', 'steps', 'answer', 'check_note', 'questions'])
    assert.ok(loose.required.includes(key), key);
  const { solution: kept, problems } = cleanSolution(plainSolution(), unit, sheet);
  assert.deepEqual(problems, []);
  assert.equal(kept?.kind, 'calculation');
  assert.deepEqual(kept?.tools, []);
  assert.deepEqual(kept?.check, { say: '', line: null });
  assert.equal(kept?.pitfall, '');
  assert.deepEqual(solutionLines(kept!), ['x - 7 = 5', 'x = 12', 'x = 12']);
  // Junk in the new fields is not fatal either.
  const junk = cleanSolution(
    { ...plainSolution(), kind: 7, tools: 'none', check: [], pitfall: null },
    unit,
    sheet,
  );
  assert.ok(junk.solution);
  assert.equal(junk.solution.kind, 'calculation');
});

test('schema v3: the new fields are cleaned like the others', () => {
  const unit = unitOf('standard', 'ex1.a');
  const kept = cleanSolution(
    solution('ex1.a', '  Equal   operations on both sides ', {
      kind: 'proof',
      pitfall: '  Subtracting on one side only. ',
    }),
    unit,
    sheet,
  ).solution!;
  assert.equal(kept.kind, 'proof');
  const [tool] = kept.tools;
  assert.equal(tool.concept, 'Equal operations on both sides');
  assert.equal(tool.say, BACKGROUND_SAY);
  assert.equal(tool.recall, RECALL_SAY);
  assert.equal(tool.line?.latex, 'a = b \\;\\Rightarrow\\; a + c = b + c');
  assert.deepEqual(tool.line?.anchors, ['balanced scale', 'we must also do']);
  assert.equal(kept.check.line?.latex, '3 \\cdot 12 - 7 = 2 \\cdot 12 + 5');
  assert.deepEqual(kept.check.line?.board?.terms, []);
  assert.equal(kept.pitfall, 'Subtracting on one side only.');
  // The concept is cut to 60 characters, an unknown kind is a calculation.
  const long = cleanSolution(solution('ex1.a', 'Very long concept names '.repeat(6), { kind: 'magic' }), unit, sheet);
  assert.equal(long.solution!.tools[0].concept.length, 60);
  assert.equal(long.solution!.kind, 'calculation');
  // A tool formula that fails its LaTeX check is dropped; the words and the concept stay, and it is no problem.
  const broken = solution('ex1.a');
  broken.tools[0].formula.latex = 'a = \\notacommand b';
  const dropped = cleanSolution(broken, unit, sheet);
  assert.deepEqual(dropped.problems, []);
  assert.equal(dropped.solution!.tools[0].line, null);
  assert.equal(dropped.solution!.tools[0].concept, 'Equal operations on both sides');
  // A tool of too few words, or one that gives the result away before the checkpoint, is dropped whole; a recall that gives
  // it away or is no sentence is left empty and the tool stays.
  assert.deepEqual(
    cleanSolution(
      solution('ex1.a', 'Balance', { tools: [{ ...broken.tools[0], say: 'A scale.' }] }),
      unit,
      sheet,
    ).solution!.tools,
    [],
  );
  const leaking = solution('ex1.a');
  leaking.tools[0].say = 'An equation is a balanced scale, and in this one x ends up as twelve.';
  assert.deepEqual(cleanSolution(leaking, unit, sheet).solution!.tools, []);
  const recalling = solution('ex1.a');
  recalling.tools[0].recall = 'Again the scale, so x is twelve.';
  assert.equal(cleanSolution(recalling, unit, sheet).solution!.tools[0].recall, '');
  recalling.tools[0].recall = 'Scale.';
  assert.equal(cleanSolution(recalling, unit, sheet).solution!.tools[0].recall, '');
  // A full part keeps two tools, a later part and a compact part one, and a tool the part already has is dropped.
  const another = {
    ...solution('ex1.a', 'Dividing by a number').tools[0],
    say: 'Dividing both sides by one number keeps the balance, like cutting both loads in the same ratio.',
  };
  const two = { tools: [solution().tools[0], another, { ...another, concept: 'A third tool', formula: { ...another.formula, latex: 'a + b = b + a' } }] };
  assert.deepEqual(
    cleanSolution(solution('ex1.a', undefined, two), unit, sheet).solution!.tools.map((t) => t.concept),
    ['Equal operations on both sides', 'Dividing by a number'],
  );
  assert.equal(solved(unitOf('standard', 'ex1.b'), two).tools.length, 1);
  assert.equal(solved(unitOf('quick', 'ex1.a'), two).tools.length, 1);
  const twice = { tools: [solution().tools[0], { ...solution().tools[0], concept: 'The balance rule' }] };
  assert.equal(solved(unit, twice).tools.length, 1, 'the same law under another name is one tool');
  // A check with too few words has no line either; a check line that does not render is left out without a problem.
  const mute = solution('ex1.a', undefined, { check: { say: 'Fine.', latex: '1 = 1' } });
  assert.deepEqual(cleanSolution(mute, unit, sheet).solution!.check, { say: '', line: null });
  const unrendered = solution('ex1.a', undefined, { check: { say: solution().check.say, latex: '3 \\cdot \\bogus' } });
  const noLine = cleanSolution(unrendered, unit, sheet);
  assert.deepEqual(noLine.problems, []);
  assert.equal(noLine.solution!.check.line, null);
  assert.equal(noLine.solution!.check.say, solution().check.say);
  // A common mistake that is no sentence, or far too long, is left out.
  assert.equal(cleanSolution(solution('ex1.a', undefined, { pitfall: 'No.' }), unit, sheet).solution!.pitfall, '');
  assert.equal(
    cleanSolution(solution('ex1.a', undefined, { pitfall: 'Careful. '.repeat(40) }), unit, sheet).solution!.pitfall,
    '',
  );
});

test('too many solution lines: the first ones stay and the last one, which carries the result, is not cut', () => {
  const line = (n: number, latex: string, part: string) => ({
    title: `Move ${n}`,
    latex,
    terms: [term(part, 'a part of the line', `move number ${n}`)],
    say: `Then we do move number ${n} on this line.`,
    sure: true,
  });
  const long = (id: keyof typeof OWN) =>
    solution(id, '', {
      steps: [
        line(1, '3x - 7 = 2x + 5', '3x'),
        line(2, 'x - 7 = 5', 'x - 7'),
        line(3, 'x - 7 + 7 = 5 + 7', '5 + 7'),
        line(4, 'x = 12', '12'),
      ],
    });
  const quick = unitOf('quick', 'ex1.a');
  assert.equal(quick.steps, 3);
  const compact = cleanSolution(long('ex1.a'), quick, sheet).solution!;
  assert.deepEqual(
    compact.steps.map((step) => step.latex),
    ['3x - 7 = 2x + 5', 'x - 7 = 5', 'x = 12'],
  );
  // The compact form shows no answer board, so the last line is the only place the result stands.
  const played = unitSteps(quick, compact, [ok, ok, ok, ok], 'en-US');
  assert.ok(boardsOf(played.at(-1)!).some((action) => formulaOf(action).latex === 'x = 12'));
  // A list within the limit is kept as it is, and one line may hold the whole part.
  assert.equal(cleanSolution(long('ex1.a'), { ...quick, steps: 4 }, sheet).solution!.steps.length, 4);
  const single = cleanSolution(long('ex1.a'), { ...quick, steps: 1 }, sheet).solution!;
  assert.deepEqual(
    single.steps.map((step) => step.latex),
    ['x = 12'],
  );
  // A part of one line has no first move to try: its checkpoint is left out, one of two lines keeps it.
  assert.equal(single.coach, null);
  assert.ok(cleanSolution(long('ex1.a'), { ...quick, steps: 2 }, sheet).solution!.coach);
  assert.ok(cleanSolution(solution('ex1.a'), unitOf('standard', 'ex1.a'), sheet).solution!.coach);
});

test('schema v2: the check line goes to the verifier after the answer, and the repair turn names it', () => {
  const unit = unitOf('standard', 'ex1.a');
  const s = solved(unit);
  assert.deepEqual(solutionLines(s), ['x - 7 = 5', 'x = 12', 'x = 12', '3 \\cdot 12 - 7 = 2 \\cdot 12 + 5']);
  assert.deepEqual(
    solutionLines(s).map((_, i) => lineName(s, i)),
    ['step 1', 'step 2', 'answer', 'check'],
  );
});

// ---------------------------------------------------------------------------------------- the worked examples

/** The sentences of the examples' tasks, so that the strict schema accepts their IDs. */
const examplesUnit = {
  id: 'ex',
  sentences: ['p2.s4', 'p2.s5', 'p3.s2', 'p3.s3', 'p4.s2', 'p4.s3', 'p5.s2', 'p5.s3', 'p6.s2', 'p6.s3', 'p7.s4'],
  maths: [] as string[],
  blocks: ['p2.b1'],
  steps: 4,
  form: 'full',
  task: { id: 'ex1', number: '1', parts: [{ id: 'ex1.a', label: 'a' }] },
} as unknown as Unit;
/** What each example's task says, which no hint of it may repeat the result of. */
const TASKS: Record<string, string> = {
  maths: 'Solve the equation 2x^2 - 3x - 5 = 0 for x.',
  chemistry: 'Hydrogen burns completely in excess oxygen. How many grams of water form from 4.0 g of hydrogen?',
  physics:
    'A ball is dropped from rest from a height of 20 m. Air resistance is ignored. How long does it take to reach the ground?',
  computer_science: 'Given the sorted array [1, 3, 5, 7, 9, 11], trace binary search for the value 7.',
  explanation: 'Ice floats on liquid water. Explain why.',
  follow_on: 'The weekly study hours of eight students are 8, 10, 12, 9, 11, 13, 7 and 10. b) Find the sample variance and the standard deviation.',
};
const spokenWords = (text: string) => splitWords(text).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const allExamples = { ...EXAMPLES, follow_on: FOLLOW_ON };

test('every worked example fits schema v3 exactly: the strict schema, the LaTeX checks, the anchors and the lengths', () => {
  const validate = new Ajv2020({ strict: false, allErrors: true }).compile(solveSchema(examplesUnit));
  assert.deepEqual(Object.keys(EXAMPLES), ['maths', 'chemistry', 'physics', 'computer_science', 'explanation']);
  for (const [name, example] of Object.entries(allExamples)) {
    assert.ok(validate(example), `${name}: ${JSON.stringify(validate.errors?.slice(0, 3))}`);
    assert.ok(SOLVE_KINDS.includes(example.kind), name);
    assert.ok(example.steps.length >= 2 && example.steps.length <= 4, `${name}: two to four granular steps`);
    assert.ok(example.pitfall && example.pitfall.length <= 160, name);
    assert.ok(example.check.latex, `${name}: a check line`);
    // The words each field asks for.
    const within = (label: string, text: string, fewest: number, most: number) =>
      assert.ok(
        spokenWords(text) >= fewest && spokenWords(text) <= most,
        `${name} ${label}: ${spokenWords(text)} words`,
      );
    within('read.say', example.read.say, 20, 50);
    if (example.method.say) within('method.say', example.method.say, 15, 45);
    example.tools.forEach((tool, i) => {
      within(`tools[${i}].say`, tool.say, 25, 55);
      within(`tools[${i}].recall`, tool.recall, 8, 25);
    });
    example.steps.forEach((step, i) => within(`step ${i + 1}`, step.say, 10, 45));
    within('check.say', example.check.say, 10, 35);
    // Every line renders, every term is a placeable piece of it and every anchor is in its narration.
    const lines: [string, { title: string; latex: string; terms: any[] }, string, number][] = [
      ['method.formula', example.method.formula, example.method.say, 0],
      ...example.tools.map((tool, i): [string, ExampleLine, string, number] => [`tools[${i}]`, tool.formula, tool.say, 0]),
      ...example.steps.map((step, i): [string, typeof step, string, number] => [`step ${i + 1}`, step, step.say, 1]),
      ['answer', example.answer, example.answer.say, 1],
    ];
    for (const [label, line, say, fewest] of lines) {
      if (!line.latex) continue;
      assert.deepEqual(checkFormula(line, { minTerms: fewest }).problems, [], `${name} ${label}: ${line.latex}`);
      for (const t of line.terms) assert.notEqual(findAnchor(say, t.anchor), null, `${name} ${label}: ${t.anchor}`);
    }
    assert.deepEqual(checkFormula({ latex: example.check.latex, terms: [] }, { minTerms: 0 }).problems, [], name);
    for (const anchor of [example.read.given_anchor, example.read.asked_anchor].filter(Boolean))
      assert.notEqual(findAnchor(example.read.say, anchor), null, `${name}: ${anchor}`);
    // The checkpoint is the part's choice: a part that has one has three hints, and none gives the result away.
    if (example.try.prompt) assert.equal(example.try.hints.length, 3, name);
    else assert.deepEqual(example.try.hints, [], name);
    for (const text of [example.try.prompt, ...example.try.hints, ...example.tools.map((tool) => tool.say), ...example.tools.map((tool) => tool.recall)])
      assert.equal(leaksResult(text, example.answer.latex, TASKS[name]), false, `${name}: ${text}`);
    // The last tool plays right before the checkpoint, which asks for its first use on this part: no prompt or hint
    // repeats four words in a row of what the tool just said.
    const grams = (text: string, n = 4) => {
      const w = text.toLowerCase().match(/\p{L}+/gu) ?? [];
      return new Set(w.slice(0, Math.max(0, w.length - n + 1)).map((_, i) => w.slice(i, i + n).join(' ')));
    };
    const said = grams(example.tools.at(-1)?.say ?? '');
    for (const text of [example.try.prompt, ...example.try.hints])
      assert.deepEqual(
        [...grams(text)].filter((g) => said.has(g)),
        [],
        `${name}: ${text}`,
      );
  }
});

test('the worked examples differ in shape, and none of them speaks from a template', () => {
  const shapes = Object.entries(allExamples).map(([name, example]) => ({
    name,
    tools: example.tools.length,
    try: Boolean(example.try.prompt),
    method: Boolean(example.method.say),
    steps: example.steps.length,
  }));
  // Different numbers of tools, with and without a checkpoint or a method step, and more than one length of working.
  assert.ok(new Set(shapes.map((x) => x.tools)).size >= 3, JSON.stringify(shapes));
  assert.ok(shapes.some((x) => x.try) && shapes.some((x) => !x.try), 'with and without a checkpoint');
  assert.ok(shapes.some((x) => x.method) && shapes.some((x) => !x.method), 'with and without a method step');
  assert.ok(new Set(shapes.map((x) => x.steps)).size >= 3, 'different numbers of lines');
  for (const [name, example] of Object.entries(allExamples)) {
    for (const say of [example.read.say, ...example.tools.map((tool) => tool.say), example.method.say].filter(Boolean))
      assert.equal(opensTemplated(say), false, `${name}: ${say}`);
    // No two examples open alike, and no example's steps all open with one word.
    const firsts = example.steps.map((step) => step.say.split(' ')[0].toLowerCase());
    assert.ok(new Set(firsts).size > Math.floor(firsts.length / 2), `${name}: ${firsts}`);
  }
  const openings = Object.values(allExamples).map((example) => example.read.say.split(' ').slice(0, 2).join(' ').toLowerCase());
  assert.equal(new Set(openings).size, openings.length, `the openings differ: ${openings}`);
});

test('every worked example is a solution the code accepts, with its tools, check and pitfall', () => {
  const unit = { ...examplesUnit, form: 'full' as const };
  const later = { ...unit, task: { ...unit.task, parts: [{ id: 'ex0', label: 'a' }, { id: 'ex1.b', label: 'b' }] }, part: { id: 'ex1.b', label: 'b' } } as unknown as Unit;
  for (const [name, example] of Object.entries(allExamples)) {
    // The follow-on example is a part that goes on from an earlier one; the others open their task.
    const { solution: kept, problems } = cleanSolution(example, name === 'follow_on' ? later : unit);
    assert.deepEqual(problems, [], name);
    assert.ok(kept, name);
    assert.equal(kept.kind, example.kind);
    assert.equal(kept.tools.length, example.tools.length, `${name}: the tools`);
    for (const tool of kept.tools) assert.ok(tool.line?.board && tool.recall, `${name}: the tool and its law`);
    assert.ok(kept.check.line?.board, `${name}: the check line`);
    assert.equal(kept.pitfall, example.pitfall);
    assert.equal(kept.coach?.hints.length ?? 0, example.try.hints.length, `${name}: the checkpoint`);
    assert.equal(kept.steps.length, example.steps.length);
  }
});

test('the example comes from the card’s subject, then from the part’s text, and an explanation always comes with it', () => {
  const chosen = (subject: (typeof SUBJECTS)[number] | undefined, text = '') =>
    exampleFor(subject, text).map((example) => Object.entries(EXAMPLES).find(([, e]) => e === example)![0]);
  const byKind = {
    mathematics: 'maths',
    statistics: 'maths',
    economics: 'maths',
    physics: 'physics',
    engineering: 'physics',
    chemistry: 'chemistry',
    computer_science: 'computer_science',
  } as const;
  for (const [subject, kind] of Object.entries(byKind))
    assert.deepEqual(chosen(subject as never), [kind, 'explanation'], subject);
  // Parts that are explanations get the explanation example alone.
  for (const subject of ['language', 'humanities', 'law'] as const)
    assert.deepEqual(chosen(subject), ['explanation'], subject);
  // Without a subject (other, biology, medicine, or none) the text decides, and a calculation is the default.
  for (const subject of [undefined, 'other', 'biology', 'medicine'] as const) {
    assert.deepEqual(chosen(subject, 'Balance \\ce{H2 + O2 -> H2O}.'), ['chemistry', 'explanation']);
    assert.deepEqual(chosen(subject, 'How many grams of NaCl are in 0.5 mol?'), ['chemistry', 'explanation']);
    assert.deepEqual(chosen(subject, 'Compute the pH of a 0.01 M solution.'), ['chemistry', 'explanation']);
    assert.deepEqual(chosen(subject, 'Water, H2O, boils at 100 degrees.'), ['chemistry', 'explanation']);
    assert.deepEqual(chosen(subject, 'A car goes 20 m/s and the force is 5 N. Find the acceleration.'), [
      'physics',
      'explanation',
    ]);
    assert.deepEqual(chosen(subject, 'A block of 3 kg has kinetic energy; what is its velocity?'), [
      'physics',
      'explanation',
    ]);
    assert.deepEqual(chosen(subject, 'Trace the algorithm on the array and give its runtime O(n log n).'), [
      'computer_science',
      'explanation',
    ]);
    assert.deepEqual(chosen(subject, 'Solve 2x + 3 = 11.'), ['maths', 'explanation']);
    assert.deepEqual(chosen(subject, ''), ['maths', 'explanation']);
  }
  // Letters that only look like formulas are no chemistry, and a unit without a physics word is no physics.
  assert.equal(exampleKind(undefined, 'Parse the HTML of the PDF, and send an OK to CPU 5'), 'maths');
  assert.equal(exampleKind(undefined, 'The distance is 20 m/s of something'), 'maths');
  assert.equal(exampleKind(undefined, 'Hello World. In case of doubt, ask.'), 'maths');
  // The subject wins over the text.
  assert.deepEqual(chosen('mathematics', 'a flask of H2O'), ['maths', 'explanation']);
  // A part that goes on from an earlier one sees the follow-on part in place of the explanation.
  assert.deepEqual(exampleFor('chemistry', '', false), [EXAMPLES.chemistry, FOLLOW_ON]);
  assert.deepEqual(exampleFor('law', '', false), [EXAMPLES.explanation, FOLLOW_ON]);
  assert.deepEqual(exampleFor('law', '', true), [EXAMPLES.explanation]);
});

test('the solve task teaches the tutor’s moves and shows the examples of the subject', () => {
  const unit = unitOf('standard', 'ex1.a');
  const text = solveTask('en-US', 'EXERCISE: Problem 1, part a)', unit, 'chemistry');
  assert.ok(text.startsWith('TASK: teach ONE exercise in "en-US". Speak as a patient tutor'));
  assert.match(text, /set the scene, go over the tools it needs, take one move per step and say why, then check the result/);
  // The examples are for the moves, not the length: the part has at most its own number of lines.
  assert.match(
    text,
    /EXAMPLES for different exercises \(copy their moves, not their words or length: this part has at most 5 steps/,
  );
  assert.ok(text.includes(JSON.stringify(EXAMPLES.chemistry)));
  assert.ok(text.includes(JSON.stringify(EXAMPLES.explanation)));
  assert.ok(!text.includes(JSON.stringify(EXAMPLES.maths)));
  assert.ok(!text.includes(JSON.stringify(FOLLOW_ON)));
  // The moves: the kind, the voice, the opening, the tools, the checkpoint, the plan, one move per step, the check.
  for (const pattern of [
    /"kind" is what this part asks for/,
    /Never open a narration with "Given",\s+"We are given", "Gegeben ist" or "In exercise 3"/,
    /Say the task's number once at most, never as the first words/,
    /READ\. "read\.say" opens the task in your own words: the situation and what we are after/,
    /the kind of answer \("a mass in grams", "a proof"\)/,
    /TOOLS\. "tools" are the formulas, definitions or laws a student needs for this task \(its later parts are listed too\), at most 2/,
    /how it works intuitively \(a tiny example or an everyday picture\) and how we use it to answer the question/,
    /never solves the part or states its result/,
    /"recall" is one sentence of 8-25 words that reminds a student who met the tool earlier/,
    /Give it only when there is a real first move worth trying/,
    /leave it empty when the steps already say it/,
    /ONE move per step/,
    /\\ce\{\.\.\.\} \(mhchem\)/,
    /\\,\\mathrm\{g\/mol\}/,
    /never use siunitx macros such as \\SI or \\si/,
    /short statement in \\text\{\.\.\.\} of at most 8 words/,
    /the steps do not all begin alike/,
    /"check\.say" is 10-35 spoken words/,
    /PITFALL\. "pitfall" is one sentence of at most 160 characters/,
    /"try" is the learner's turn/,
    /No hint and not the prompt may contain the final result/,
    /After a tool step, ask for the first use of the tool on this part, not for the concept/,
    /"sure" is false when you are not certain/,
  ])
    assert.match(text, pattern);
  // A later part goes on from the part before: no number, no givens again, one tool at most, and the follow-on example.
  const follow = solveTask('en-US', 'EXERCISE: x', unitOf('standard', 'ex1.b'));
  assert.match(follow, /This part goes on from the part before: never say the task's or the part's number/);
  assert.match(follow, /READ\. "read\.say" opens the part in your own words: what this part asks, from where the part/);
  assert.match(follow, /this part needs that the earlier parts did not give, at most 1/);
  assert.doesNotMatch(follow, /Say the task's number once at most/);
  assert.ok(follow.includes(JSON.stringify(FOLLOW_ON)) && !follow.includes(JSON.stringify(EXAMPLES.explanation)));
  const compact = solveTask('en-US', 'EXERCISE: x', unitOf('quick', 'ex1.a'));
  assert.match(compact, /Keep "read\.say", the tool's "say" and "method\.say" short/);
  // Where the last line shows the result, the answer is one summary sentence and the check one check, not two checks.
  assert.match(
    compact,
    /"answer\.say" is one short summary\s+sentence without the result, and "check\.say" one short check/,
  );
  // Without a subject the text names the example.
  assert.ok(
    solveTask('en-US', 'EXERCISE: Trace the algorithm on this array.', unit).includes(
      JSON.stringify(EXAMPLES.computer_science),
    ),
  );
});

test('neighbouring parts are suggested different ways in, so that a tour does not open every follow-on alike', () => {
  const taughtUnits = planUnits(exerciseUnits(sheet), 'standard').taught;
  assert.deepEqual(taughtUnits.map((u) => u.way), [0, 1, 2, 3]);
  const way = (unit: Unit) => /a way in could be to open ([^.]*(?:\([^)]*\))?[^.]*)\./.exec(solveTask('en-US', 'EXERCISE: x', unit))?.[1];
  // The first parts of tasks and the parts that go on from an earlier one are suggested different openings.
  const first = way(unitOf('standard', 'ex1.a'));
  const second = way(unitOf('standard', 'ex1.b'));
  const third = way(unitOf('standard', 'ex2'));
  assert.ok(first && second && third);
  assert.equal(new Set([first, second, third]).size, 3);
  assert.match(second, /^with the new question itself|link word|still missing|different|result we just got/);
  // A suggestion for a part that goes on never says a number, and the rule says it is only a way in.
  assert.doesNotMatch(solveTask('en-US', 'EXERCISE: x', unitOf('standard', 'ex1.b')), /With x known/);
  // The rotation wraps around, and a part with no place has the first way.
  assert.equal(way({ ...unitOf('standard', 'ex2'), way: 5 }), way({ ...unitOf('standard', 'ex2'), way: 0 }));
  assert.equal(way({ ...unitOf('standard', 'ex2'), way: undefined }), way({ ...unitOf('standard', 'ex2'), way: 0 }));
});

test('only the first part of a task sees the later parts, for the toolkit', () => {
  const first = unitOf('standard', 'ex1.a');
  assert.deepEqual(first.ahead?.map((p) => p.id), ['ex1.b']);
  assert.ok(startsTask(first) && !startsTask(unitOf('standard', 'ex1.b')) && startsTask(unitOf('standard', 'ex2')));
  assert.equal(unitOf('standard', 'ex1.b').ahead, undefined);
  const brief = unitBrief(first, sheet, true);
  assert.match(brief, /LATER PARTS OF THIS TASK, taught after this one \(for the toolkit only, do not solve them\):\nb\) b\) Check your solution by substituting it\./);
  assert.doesNotMatch(unitBrief(first, sheet), /LATER PARTS/, 'the visual plan reads the brief without them');
  assert.doesNotMatch(unitBrief(unitOf('standard', 'ex1.b'), sheet, true), /LATER PARTS/);
  // A part the tour leaves out is not listed.
  const quick = planUnits(exerciseUnits(sheet), 'quick').taught.find((u) => u.id === 'ex1.a')!;
  assert.deepEqual(quick.ahead?.map((p) => p.id), ['ex1.b']);
});

// ----------------------------------------------------------------------------------------------- the forms of a part

const ids = (steps: Step[]) => steps.map((step) => step.id);

test('the full form is the task, the tools, your turn, the method, the solution lines and the answer', () => {
  const unit = unitOf('standard', 'ex1.a');
  assert.equal(unit.form, 'full');
  const s = solved(unit);
  const steps = unitSteps(unit, s, [ok, ok, ok, ok], 'en-US');
  assert.deepEqual(ids(steps), [
    'ex1.a-task',
    'ex1.a-tool-1',
    'ex1.a-try',
    'ex1.a-method',
    'ex1.a-step-1',
    'ex1.a-step-2',
    'ex1.a-answer',
  ]);
  assert.equal(unitOverhead(unit), 5);
  // The tool says its words, with the law on the board term by term and lit up where the narration names it.
  const tool = steps[1];
  assert.equal(tool.say, BACKGROUND_SAY);
  assert.deepEqual(types(tool), ['focus', 'board', 'board_focus', 'board_focus']);
  const board = formulaOf(boardsOf(tool)[0]);
  assert.equal(board.latex, 'a = b \\;\\Rightarrow\\; a + c = b + c');
  assert.equal(board.title, 'Same move on both sides');
  assert.equal(board.before, undefined);
  assert.equal(board.verified, undefined);
  const lit = tool.actions.filter((a) => a.type === 'board_focus');
  assert.deepEqual(
    lit.map((a) => a.type === 'board_focus' && [a.part, a.at_word]),
    [
      [0, findAnchor(BACKGROUND_SAY, 'balanced scale')],
      [1, findAnchor(BACKGROUND_SAY, 'we must also do')],
    ],
  );
  assert.equal(tool.hold_ms, 800);
  // The tools come before the checkpoint and say nothing of the result; the checkpoint is the only pause.
  assert.ok(!/twelve|12/.test(`${steps[0].say} ${tool.say}`));
  assert.equal(steps.filter((step) => step.checkpoint).length, 1);
  // Without a tool there is no tool step; without a checkpoint no pause; without a method no method step, and the
  // answer still stands; nor is there a pause when the answer failed.
  const bare = { ...s, tools: [] };
  assert.deepEqual(ids(unitSteps(unit, bare, [ok, ok, ok, ok], 'en-US')).slice(0, 3), [
    'ex1.a-task',
    'ex1.a-try',
    'ex1.a-method',
  ]);
  const free = unitSteps(unit, { ...s, tools: [], coach: null, method: { say: '', line: null } }, [ok, ok, ok, ok], 'en-US');
  assert.deepEqual(ids(free), ['ex1.a-task', 'ex1.a-step-1', 'ex1.a-step-2', 'ex1.a-answer']);
  const failed = unitSteps(unit, s, [ok, ok, { status: 'failed', problem: 'no' }, ok], 'en-US');
  assert.deepEqual(ids(failed).slice(0, 3), ['ex1.a-task', 'ex1.a-tool-1', 'ex1.a-method']);
  // Two tools are two steps, each with its own board.
  const other = { ...s.tools[0], concept: 'Dividing by a number', say: 'Dividing both sides by one number keeps the balance, like cutting both loads alike.' };
  const two = unitSteps(unit, { ...s, tools: [s.tools[0], other] }, [ok, ok, ok, ok], 'en-US');
  assert.deepEqual(ids(two).slice(0, 4), ['ex1.a-task', 'ex1.a-tool-1', 'ex1.a-tool-2', 'ex1.a-try']);
  assert.equal(two[2].say, other.say);
});

test('a tool the tour has met is recalled in a sentence of the task step, not given again', () => {
  const unit = unitOf('standard', 'ex1.a');
  const s = solved(unit);
  const seen = new Set(toolKeys(s.tools[0]));
  const steps = unitSteps(unit, s, [ok, ok, ok, ok], 'en-US', null, seen);
  assert.deepEqual(ids(steps), ['ex1.a-task', 'ex1.a-try', 'ex1.a-method', 'ex1.a-step-1', 'ex1.a-step-2', 'ex1.a-answer']);
  // The sentence follows the opening, and the law comes back on the board when the sentence starts.
  assert.equal(steps[0].say, `${s.read.say} ${RECALL_SAY}`);
  const [recalled] = boardsOf(steps[0]);
  assert.equal(formulaOf(recalled).latex, s.tools[0].line!.latex);
  assert.equal(recalled.at_word, splitWords(s.read.say).length);
  // Only a term the recall names lights up, and only after the sentence has started.
  const lit = steps[0].actions.flatMap((a) => (a.type === 'board_focus' ? [a.at_word ?? 0] : []));
  assert.ok(lit.every((word) => word >= splitWords(s.read.say).length), JSON.stringify(steps[0].actions));
  // Keys the tour has not met leave the tool as it was; a tool is known by its concept and by its law.
  assert.deepEqual(ids(unitSteps(unit, s, [ok, ok, ok, ok], 'en-US', null, new Set(['another tool']))).slice(0, 2), ['ex1.a-task', 'ex1.a-tool-1']);
  assert.equal(toolKeys(s.tools[0])[0], 'equal operations on both sides');
  assert.ok(toolKeys(s.tools[0])[1].startsWith('law:'));
  const byLaw = new Set(toolKeys({ concept: 'The balance rule', line: s.tools[0].line }));
  assert.ok(unitSteps(unit, s, [ok, ok, ok, ok], 'en-US', null, byLaw).every((step) => !step.id.endsWith('-tool-1')));
  // A tool without a recall sentence is not said again either.
  const mute = { ...s, tools: [{ ...s.tools[0], recall: '' }] };
  assert.equal(unitSteps(unit, mute, [ok, ok, ok, ok], 'en-US', null, seen)[0].say, s.read.say);
});

test('a later part of a task goes on from the one before: its own tool, if any, and the same steps', () => {
  const unit = unitOf('standard', 'ex1.b');
  assert.equal(unit.form, 'follow');
  assert.equal(unitOverhead(unit), 4);
  assert.deepEqual(ids(unitSteps(unit, solved(unit, { tools: [] }), [ok, ok, ok, ok], 'en-US')), [
    'ex1.b-task',
    'ex1.b-try',
    'ex1.b-method',
    'ex1.b-step-1',
    'ex1.b-step-2',
    'ex1.b-answer',
  ]);
  const withTool = solved(unit, { tools: solution('ex1.b').tools });
  assert.equal(withTool.tools.length, 1);
  assert.deepEqual(ids(unitSteps(unit, withTool, [ok, ok, ok, ok], 'en-US')).slice(0, 3), [
    'ex1.b-task',
    'ex1.b-tool-1',
    'ex1.b-try',
  ]);
});

test('the compact form says its tool in the task step and joins the method to the first line and the answer to the last', () => {
  const unit = unitOf('quick', 'ex1.a');
  assert.equal(unit.form, 'compact');
  assert.equal(unitOverhead(unit), 2);
  const s = solved(unit);
  const steps = unitSteps(unit, s, [ok, ok, ok, ok], 'en-US');
  assert.deepEqual(ids(steps), ['ex1.a-task', 'ex1.a-try', 'ex1.a-step-1', 'ex1.a-step-2']);
  assert.ok(steps[2].say.startsWith(s.method.say));
  // The last line also says the answer and how we know it is right, but not the common mistake.
  assert.ok(steps[3].say.endsWith(`${s.answer.say} ${s.check.say}`));
  assert.ok(!steps[3].say.includes(s.pitfall));
  const lead = steps[3].say.slice(0, steps[3].say.indexOf(s.answer.say)).trim();
  assert.deepEqual(steps[3].actions.at(-1), {
    type: 'highlight',
    targets: ['p1.s4'],
    color: 'green',
    at_word: splitWords(lead).length,
  });
  // The tool is no step of its own: its words follow the opening in the task step, and its law comes onto the board where
  // they start, with its terms lit up. No check line is played in the compact form.
  assert.ok(steps.every((step) => !step.id.includes('-tool-')));
  assert.equal(steps[0].say, `${s.read.say} ${s.tools[0].say}`);
  const [law] = boardsOf(steps[0]);
  assert.equal(formulaOf(law).latex, s.tools[0].line!.latex);
  assert.equal(law.at_word, splitWords(s.read.say).length);
  const lit = steps[0].actions.flatMap((a) => (a.type === 'board_focus' ? [a.at_word ?? 0] : []));
  assert.equal(lit.length, 2);
  assert.ok(lit.every((word) => word >= splitWords(s.read.say).length), 'the terms light up as the tool is said');
  assert.ok(steps.every((step) => boardsOf(step).every((action) => formulaOf(action).latex !== s.check.line!.latex)));
  // Without a checkpoint the method joins the task step, after the tool, with its own board when it has a rule.
  const noCoach = unitSteps(unit, { ...s, coach: null }, [ok, ok, ok, ok], 'en-US');
  assert.deepEqual(ids(noCoach), ['ex1.a-task', 'ex1.a-step-1', 'ex1.a-step-2']);
  assert.equal(noCoach[0].say, `${s.read.say} ${s.tools[0].say} ${s.method.say}`);
  // A tool the tour has met is recalled in a sentence there; without a tool the task step is the opening alone.
  assert.equal(unitSteps(unit, s, [ok, ok, ok, ok], 'en-US', null, new Set(toolKeys(s.tools[0])))[0].say, `${s.read.say} ${RECALL_SAY}`);
  assert.equal(unitSteps(unit, { ...s, tools: [] }, [ok, ok, ok, ok], 'en-US')[0].say, s.read.say);
});

test('the answer step says the result, how we know it is right and the common mistake, with the check line under the answer', () => {
  const unit = unitOf('standard', 'ex1.a');
  const s = solved(unit);
  const steps = unitSteps(unit, s, [ok, ok, ok, ok], 'en-US');
  const answer = steps.at(-1)!;
  assert.equal(answer.id, 'ex1.a-answer');
  assert.equal(answer.say, `${s.answer.say} ${s.check.say} ${s.pitfall}`);
  const [result, check] = boardsOf(answer).map(formulaOf);
  assert.equal(result.latex, 'x = 12');
  assert.equal(result.verified, true);
  assert.deepEqual(result.before, [
    { latex: 'x - 7 = 5', title: 'Subtract 2x', verified: true },
    { latex: 'x = 12', title: 'Add 7', verified: true },
  ]);
  // The check line comes in at the word where its narration starts, under the working and the answer.
  assert.equal(check.latex, '3 \\cdot 12 - 7 = 2 \\cdot 12 + 5');
  assert.equal(check.verified, true);
  assert.deepEqual(check.before, [
    { latex: 'x - 7 = 5', title: 'Subtract 2x', verified: true },
    { latex: 'x = 12', title: 'Add 7', verified: true },
    { latex: 'x = 12', title: 'Result', verified: true },
  ]);
  const checkStarts = splitWords(s.answer.say).length;
  assert.deepEqual(
    boardsOf(answer).map((a) => a.at_word),
    [undefined, checkStarts],
  );
  // The answer's terms light up before the check line replaces its board, and the question turns green.
  const focus = answer.actions.filter((a) => a.type === 'board_focus');
  assert.ok(focus.length && focus.every((a) => a.type === 'board_focus' && (a.at_word ?? 0) < checkStarts));
  assert.deepEqual(answer.actions.at(-1), { type: 'highlight', targets: ['p1.s4'], color: 'green' });
  // Whatever the parts of the answer, no cue points past the narration and the boards stay in order.
  const tour = { chapters: [{ steps }] } as unknown as Tour;
  assert.deepEqual(boardProblems(tour), []);
  for (const step of steps)
    for (const a of step.actions) assert.ok((a.at_word ?? 0) < splitWords(step.say).length, step.id);
  // Without the check, the answer step ends with the pitfall; without both it is the answer alone.
  const without = { ...s, check: { say: '', line: null }, pitfall: '' };
  const plain = unitSteps(unit, without, [ok, ok, ok], 'en-US').at(-1)!;
  assert.equal(plain.say, s.answer.say);
  assert.equal(boardsOf(plain).length, 1);
  // A check without a line is said and not drawn.
  const spoken = unitSteps(unit, { ...s, check: { ...s.check, line: null } }, [ok, ok, ok], 'en-US').at(-1)!;
  assert.equal(spoken.say, `${s.answer.say} ${s.check.say} ${s.pitfall}`);
  assert.equal(boardsOf(spoken).length, 1);
});

test('the board keeps the working: every line stands under the earlier lines of its part, checked lines carry a check mark', () => {
  const unit = { ...unitOf('deep', 'ex1.a'), steps: 10 };
  const line = (n: number) => ({
    title: `Move ${n}`,
    latex: `x + ${n} = ${n + 1}`,
    terms: [term(`x + ${n}`, `part ${n}`, `part ${n}`)],
    say: `Step ${n} adds one more, and part ${n} stays.`,
    sure: true,
  });
  const many = solved(unit, { steps: Array.from({ length: 10 }, (_, i) => line(i + 1)) });
  assert.equal(many.steps.length, 10);
  // Lines 1, 3 and 4 are verified, line 2 is unknown, the answer is verified.
  const checks: LineCheck[] = [ok, unknown, ok, ok, ...Array(6).fill(unknown), ok, unknown];
  const steps = unitSteps(unit, many, checks, 'en-US');
  const lineBoard = (n: number) => formulaOf(boardsOf(steps.find((step) => step.id === `ex1.a-step-${n}`)!)[0]);
  assert.equal(lineBoard(1).before, undefined, 'the first line has nothing above it');
  assert.deepEqual(lineBoard(1).verified, true);
  assert.deepEqual(lineBoard(2).before, [{ latex: 'x + 1 = 2', title: 'Move 1', verified: true }]);
  assert.equal(lineBoard(2).verified, undefined, 'a line the code could not check carries no tag and no mark');
  assert.deepEqual(lineBoard(3).before, [
    { latex: 'x + 1 = 2', title: 'Move 1', verified: true },
    { latex: 'x + 2 = 3', title: 'Move 2' },
  ]);
  // At most FORMULA_BEFORE_MAX lines are kept above a line: the latest ones.
  assert.equal(FORMULA_BEFORE_MAX, 8);
  assert.equal(lineBoard(10).before?.length, 8);
  assert.deepEqual(
    lineBoard(10).before?.map((l) => l.latex),
    Array.from({ length: 8 }, (_, i) => `x + ${i + 2} = ${i + 3}`),
  );
  const answer = formulaOf(boardsOf(steps.at(-1)!)[0]);
  assert.equal(answer.before?.length, 8);
  assert.equal(answer.before?.at(-1)?.latex, 'x + 10 = 11');
  assert.equal(answer.verified, true);
  const check = formulaOf(boardsOf(steps.at(-1)!)[1]);
  assert.equal(check.verified, undefined);
  assert.equal(check.before?.at(-1)?.latex, 'x = 12');
  // A line without a board (it did not render) is not kept above the lines after it.
  const unrendered = { ...many, steps: many.steps.map((step, i) => (i === 0 ? { ...step, board: null } : step)) };
  const after = unitSteps(unit, unrendered, checks, 'en-US');
  assert.deepEqual(
    boardsOf(after.find((step) => step.id === 'ex1.a-step-2')!).map((a) => formulaOf(a).before),
    [undefined],
  );
});

test('no line is tagged "unchecked"; a failed line keeps the spoken please-check note, said once', () => {
  const unit = unitOf('standard', 'ex1.a');
  const s = solved(unit);
  const failedLine: LineCheck = { status: 'failed', problem: 'does not hold' };
  const all = (checks: LineCheck[]) => unitSteps(unit, s, checks, 'en-US');
  for (const language of ['en-US', 'de-DE', 'fr-FR'])
    for (const checks of [[unknown, unknown, unknown, unknown], [ok, failedLine, ok, failedLine], []]) {
      const text = JSON.stringify(unitSteps(unit, s, checks, language));
      assert.doesNotMatch(
        text,
        /unchecked|ungepr|non v[eé]rifi|sin comprobar|da verificare|n[aã]o verificado|niet gecontroleerd/i,
      );
    }
  // Unknown lines get no tag and no note; the titles are the model's own.
  const titles = all([unknown, unknown, unknown, unknown]).flatMap((step) =>
    boardsOf(step).map((a) => formulaOf(a).title),
  );
  assert.deepEqual(titles, ['Same move on both sides', 'Subtract 2x', 'Add 7', 'Result', undefined]);
  assert.equal(
    all([unknown, unknown, unknown, unknown]).find((step) => step.id.endsWith('step-2'))!.say,
    s.steps[1].say,
  );
  // A failed step asks for a check, and so does a failed answer (once, although its check line failed too).
  const failedStep = all([ok, failedLine, ok, ok]);
  assert.equal(failedStep.find((step) => step.id.endsWith('step-2'))!.say, `${s.steps[1].say} ${s.checkNote}`);
  assert.equal(boardsOf(failedStep.find((step) => step.id.endsWith('step-2'))!)[0].item.kind, 'formula');
  assert.equal(formulaOf(boardsOf(failedStep.find((step) => step.id.endsWith('step-2'))!)[0]).verified, undefined);
  const failedAnswer = all([ok, ok, failedLine, failedLine]).at(-1)!;
  assert.equal(failedAnswer.say.split(s.checkNote).length - 1, 1);
  assert.ok(failedAnswer.say.startsWith(`${s.answer.say} ${s.checkNote} ${s.check.say}`));
  // A check line that failed on its own is flagged after the check narration.
  const failedCheck = all([ok, ok, ok, failedLine]).at(-1)!;
  assert.equal(failedCheck.say, `${s.answer.say} ${s.check.say} ${s.checkNote} ${s.pitfall}`);
  // A step its author doubts and the code did not confirm asks for a check; one the code verified does not.
  const doubted = { ...s, steps: s.steps.map((step, i) => (i === 0 ? { ...step, sure: false } : step)) };
  assert.equal(unitSteps(unit, doubted, [unknown, ok, ok, ok], 'en-US')[4].say, `${s.steps[0].say} ${s.checkNote}`);
  assert.equal(unitSteps(unit, doubted, [ok, ok, ok, ok], 'en-US')[4].say, s.steps[0].say);
});

test('a part the model could not teach points at its task text', () => {
  const unit = unitOf('standard', 'ex2');
  const steps = unitFallback(unit, sheet);
  assert.deepEqual(ids(steps), ['ex2-task']);
  assert.deepEqual(steps[0].actions, [
    { type: 'focus', target: 'p1.b6' },
    { type: 'highlight', targets: ['p1.s6'], color: 'yellow' },
  ]);
});

// ------------------------------------------------------------------------------------------- the concept key

test('a concept is compared by a normalised key: case, accents, punctuation and a leading article do not matter', () => {
  for (const [a, b] of [
    ['The Bayes’ rule', 'bayes rule'],
    ["Bayes' Rule.", 'The Bayes rule'],
    ['Newton’s second law', 'Newtons second law'],
    ['  The   mole and molar mass ', 'mole and molar mass'],
    ['Équilibre chimique', 'equilibre chimique'],
    ['L’énergie cinétique', 'energie cinetique'],
    ['Der Satz des Pythagoras', 'satz des pythagoras'],
    ['La ley de Ohm', 'ley de ohm'],
    ['Binary search (on sorted arrays)', 'a Binary-Search on sorted arrays'],
  ])
    assert.equal(conceptKey(a), conceptKey(b), `${a} / ${b}`);
  assert.equal(conceptKey('The Bayes’ rule'), 'bayes rule');
  assert.equal(conceptKey('Équilibre chimique'), 'equilibre chimique');
  assert.equal(conceptKey('The'), 'the', 'a name is never emptied');
  assert.equal(conceptKey(''), '');
  assert.notEqual(conceptKey('Free fall'), conceptKey('Free energy'));
  // A tool is known by its concept's key and by its law; a short law is no key.
  const [tool] = solved(unitOf('standard', 'ex1.a')).tools;
  assert.equal(toolKeys(tool)[0], 'equal operations on both sides');
  assert.deepEqual(toolKeys({ concept: 'The Mole', line: null }), ['mole']);
  assert.equal(toolKeys({ concept: 'Mole', line: { ...tool.line!, latex: 'n = m' } }).length, 1);
  assert.equal(toolKeys({ concept: 'Mole', line: { ...tool.line!, latex: 'n = \\frac{m}{M}' } }).length, 2);
});

// ---------------------------------------------------------------------------------------------------- the lengths

/** Parts of tasks as exerciseUnits makes them: `perTask` lists the number of parts of each task. */
function units(perTask: number[]): Unit[] {
  const base = exerciseUnits(sheet)[0];
  return perTask.flatMap((parts, t) => {
    const task = { ...base.task, id: `t${t + 1}` };
    return Array.from({ length: parts }, (_, p) => ({ ...base, id: `t${t + 1}.${p + 1}`, task }));
  });
}
const total = (list: Unit[]) => 2 + list.reduce((n, u) => n + unitOverhead(u) + u.steps, 0);
const shapes = (list: Unit[]) => list.map((u) => `${u.id}:${u.form[0]}${u.steps}`);

test('a sheet’s length is 60, 100 and 160 steps, with 3, 5 and 7 solution lines at most', () => {
  assert.deepEqual(SHEET_STEPS, { quick: 60, standard: 100, deep: 160 });
  const small = units([1, 1]);
  assert.deepEqual(shapes(planUnits(small, 'quick').taught), ['t1.1:c3', 't2.1:c3']);
  assert.deepEqual(shapes(planUnits(small, 'standard').taught), ['t1.1:f5', 't2.1:f5']);
  assert.deepEqual(shapes(planUnits(small, 'deep').taught), ['t1.1:f7', 't2.1:f7']);
  assert.deepEqual(unitOverhead({ form: 'full' }), 5);
  assert.deepEqual(unitOverhead({ form: 'follow' }), 4);
  assert.deepEqual(unitOverhead({ form: 'compact' }), 2);
  assert.deepEqual(planUnits([], 'standard'), { taught: [], skipped: [] });
});

test('the preset sets the forms: quick compact, standard the first part of a task in full, deep everything in full', () => {
  const sheetUnits = units([2, 1]);
  assert.deepEqual(
    planUnits(sheetUnits, 'quick').taught.map((u) => u.form),
    ['compact', 'compact', 'compact'],
  );
  assert.deepEqual(
    planUnits(sheetUnits, 'standard').taught.map((u) => u.form),
    ['full', 'follow', 'full'],
  );
  assert.deepEqual(
    planUnits(sheetUnits, 'deep').taught.map((u) => u.form),
    ['full', 'full', 'full'],
  );
  for (const preset of ['quick', 'standard', 'deep'] as const)
    assert.deepEqual(planUnits(sheetUnits, preset).skipped, []);
});

const formsOf = (list: Unit[]) => list.map((u) => u.form);
const countOf = (list: Unit[], form: Unit['form']) => list.filter((u) => u.form === form).length;

test('a sheet that is too long loses solution lines first (never under two), then later parts go compact, then are dropped', () => {
  // Lines first: three tasks of four parts in standard keep their forms (3 in full, 9 follow-ons) and the lines shrink.
  const lines = planUnits(units([4, 4, 4]), 'standard');
  assert.equal(countOf(lines.taught, 'full'), 3);
  assert.equal(countOf(lines.taught, 'follow'), 9);
  assert.deepEqual(new Set(lines.taught.map((u) => u.steps)), new Set([3]));
  assert.ok(total(lines.taught) <= SHEET_STEPS.standard);
  // Deep: seven lines shrink to what fits before anything else changes.
  const deep = planUnits(units([4, 4, 4, 4]), 'deep');
  assert.ok(deep.taught.every((u) => u.form === 'full' && u.steps === 4));
  assert.ok(total(deep.taught) <= SHEET_STEPS.deep);
  // The lines have reached their floor of two and the forms still do not fit: later parts turn compact, the last one of
  // the sheet first, so that the first part of every task stays in full.
  const tight = units([6, 6, 6]);
  const compacted = planUnits(tight, 'standard');
  assert.equal(compacted.skipped.length, 0);
  assert.deepEqual(new Set(compacted.taught.map((u) => u.steps)), new Set([2]));
  assert.ok(total(compacted.taught) <= SHEET_STEPS.standard);
  assert.deepEqual(
    compacted.taught.filter((u) => u.id.endsWith('.1')).map((u) => u.form),
    ['full', 'full', 'full'],
  );
  const compactIds = compacted.taught.filter((u) => u.form === 'compact').map((u) => u.id);
  assert.ok(compactIds.length > 0 && compactIds.length < 15, 'only as many as the length needs');
  assert.deepEqual(
    compactIds,
    tight
      .filter((u) => !u.id.endsWith('.1'))
      .slice(-compactIds.length)
      .map((u) => u.id),
    'the later parts at the end of the sheet',
  );
  // Every later part compact and the first parts in full still fit: the six tasks of 20 parts keep all of them.
  const twenty = planUnits(units([4, 4, 4, 3, 3, 2]), 'standard');
  assert.equal(twenty.taught.length, 20);
  assert.equal(countOf(twenty.taught, 'full'), 6);
  assert.equal(countOf(twenty.taught, 'compact'), 14);
  assert.ok(total(twenty.taught) <= SHEET_STEPS.standard);
  // Then later parts are dropped: the last part of the highest rank first, never the first part of a task, and the first
  // parts stay in full.
  const long = units([12, 12, 12]);
  const dropped = planUnits(long, 'standard');
  assert.deepEqual(
    dropped.taught.filter((u) => u.id.endsWith('.1')).map((u) => u.form),
    ['full', 'full', 'full'],
  );
  assert.ok(dropped.taught.filter((u) => !u.id.endsWith('.1')).every((u) => u.form === 'compact' && u.steps === 2));
  assert.ok(total(dropped.taught) <= SHEET_STEPS.standard);
  assert.deepEqual(
    dropped.taught.filter((u) => u.id.endsWith('.1')).map((u) => u.id),
    ['t1.1', 't2.1', 't3.1'],
    'every task keeps its first part',
  );
  assert.ok(dropped.skipped.length > 0);
  assert.equal(dropped.taught.length + dropped.skipped.length, 36);
  // What is kept is the earliest parts of the lowest ranks, in reading order; what is skipped the latest of the highest.
  const rankOf = (u: Unit) => Number(u.id.split('.')[1]);
  const keptRanks = dropped.taught.map(rankOf);
  const skippedRanks = dropped.skipped.map(rankOf);
  assert.ok(Math.max(...keptRanks) <= Math.min(...skippedRanks));
  const keptIds = new Set(dropped.taught.map((u) => u.id));
  assert.deepEqual(
    dropped.taught.map((u) => u.id),
    long.filter((u) => keptIds.has(u.id)).map((u) => u.id),
    'in reading order',
  );
  const lastRank = dropped.taught.filter((u) => rankOf(u) === Math.max(...keptRanks)).map((u) => u.id);
  const skippedAtThatRank = dropped.skipped.filter((u) => rankOf(u) === Math.max(...keptRanks)).map((u) => u.id);
  if (skippedAtThatRank.length)
    assert.ok(long.findIndex((u) => u.id === lastRank.at(-1)) < long.findIndex((u) => u.id === skippedAtThatRank[0]));
  // Last, when even the first parts do not fit in full, they turn compact too, the last one of the sheet first.
  const firsts = planUnits(units(Array(20).fill(1)), 'standard');
  assert.equal(firsts.taught.length, 20);
  assert.deepEqual(formsOf(firsts.taught).slice(0, 4), ['full', 'full', 'full', 'full']);
  assert.equal(formsOf(firsts.taught).at(-1), 'compact');
  assert.equal(countOf(firsts.taught, 'full'), 6);
  assert.ok(total(firsts.taught) <= SHEET_STEPS.standard);
  // The tour of every preset stays within its length however long the sheet is, but for what its tasks force: every
  // task keeps its first part, compact with the fewest lines.
  for (const preset of ['quick', 'standard', 'deep'] as const)
    for (const shape of [
      [6, 6, 6],
      [1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
      [12],
      [2, 2, 2, 2, 2, 2],
      [20, 20, 20],
      Array(30).fill(1),
    ]) {
      const { taught, skipped } = planUnits(units(shape), preset);
      const forced = 2 + shape.length * (unitOverhead({ form: 'compact' }) + 2);
      assert.ok(total(taught) <= Math.max(SHEET_STEPS[preset], forced), `${preset} ${shape}: ${total(taught)}`);
      assert.equal(
        taught.length + skipped.length,
        shape.reduce((n, parts) => n + parts, 0),
      );
      assert.deepEqual(
        taught.filter((u) => u.id.endsWith('.1')).map((u) => u.id),
        shape.map((_, t) => `t${t + 1}.1`),
        `${preset} ${shape.length}: every task keeps its first part`,
      );
    }
});

test('a sheet of 20 parts in six tasks: standard keeps every part with the first of each task in full, quick teaches compact parts, deep every part in full', () => {
  const sheetUnits = units([4, 4, 4, 3, 3, 2]);
  assert.equal(sheetUnits.length, 20);
  const standard = planUnits(sheetUnits, 'standard');
  assert.equal(standard.taught.length, 20);
  assert.deepEqual(standard.skipped, []);
  assert.deepEqual(
    standard.taught.filter((u) => u.id.endsWith('.1')).map((u) => u.form),
    Array(6).fill('full'),
    'the six first parts are taught in full, with their background and method',
  );
  assert.ok(standard.taught.filter((u) => !u.id.endsWith('.1')).every((u) => u.form !== 'full'));
  assert.ok(standard.taught.every((u) => u.steps >= 2));
  assert.ok(total(standard.taught) <= SHEET_STEPS.standard);
  // Quick: every part compact, as many as fit.
  const quick = planUnits(sheetUnits, 'quick');
  assert.ok(quick.taught.every((u) => u.form === 'compact'));
  assert.ok(total(quick.taught) <= SHEET_STEPS.quick);
  assert.deepEqual(
    quick.taught.filter((u) => u.id.endsWith('.1')).map((u) => u.id),
    ['t1.1', 't2.1', 't3.1', 't4.1', 't5.1', 't6.1'],
  );
  assert.equal(quick.taught.length + quick.skipped.length, 20);
  // Quick keeps all the parts of a sheet that fits.
  const small = planUnits(units([3, 3, 2, 2]), 'quick');
  assert.equal(small.taught.length, 10);
  assert.deepEqual(small.skipped, []);
  assert.ok(small.taught.every((u) => u.form === 'compact'));
  // Deep: every part in full, with as many lines as the length leaves.
  const deep = planUnits(sheetUnits, 'deep');
  assert.equal(deep.taught.length, 20);
  assert.ok(deep.taught.every((u) => u.form === 'full' && u.steps >= 2));
  assert.ok(total(deep.taught) <= SHEET_STEPS.deep);
  const fitting = planUnits(units([3, 3, 2]), 'deep');
  assert.ok(fitting.taught.every((u) => u.form === 'full' && u.steps === 7));
  assert.deepEqual(fitting.skipped, []);
});

test('a sheet of single-part tasks keeps every task: only the later parts of a task are ever dropped', () => {
  // Sixteen problems of one part each: quick has no room for them, and the tour grows past it by what they force.
  const sixteen = planUnits(units(Array(16).fill(1)), 'quick');
  assert.deepEqual(
    sixteen.taught.map((u) => u.id),
    Array.from({ length: 16 }, (_, t) => `t${t + 1}.1`),
  );
  assert.deepEqual(sixteen.skipped, []);
  assert.deepEqual(new Set(shapes(sixteen.taught).map((s) => s.slice(s.indexOf(':')))), new Set([':c2']));
  assert.equal(total(sixteen.taught), 2 + 16 * (2 + 2));
  assert.ok(total(sixteen.taught) > SHEET_STEPS.quick);
  // Twenty-five problems the same; and where a task has later parts, those are dropped before any task loses its first part.
  const many = planUnits(units(Array(25).fill(1)), 'quick');
  assert.equal(many.taught.length, 25);
  assert.equal(many.skipped.length, 0);
  const mixed = planUnits(units([4, ...Array(14).fill(1)]), 'quick');
  assert.deepEqual(
    mixed.taught.filter((u) => u.id.startsWith('t1.')).map((u) => u.id),
    ['t1.1'],
    'the later parts of task 1 go first',
  );
  assert.deepEqual(
    mixed.taught.filter((u) => u.id.endsWith('.1')).map((u) => u.id),
    Array.from({ length: 15 }, (_, t) => `t${t + 1}.1`),
  );
  assert.deepEqual(
    mixed.skipped.map((u) => u.id),
    ['t1.2', 't1.3', 't1.4'],
  );
});

test('a compact part never has more than three solution lines, whichever preset turned it compact', () => {
  for (const preset of ['quick', 'standard', 'deep'] as const)
    for (const shape of [Array(9).fill(1), Array(20).fill(1), Array(30).fill(1), [6, 6, 6], [4, 4, 4, 3, 3, 2]]) {
      const { taught } = planUnits(units(shape), preset);
      assert.ok(
        taught.every((u) => u.steps >= 2 && (u.form !== 'compact' || u.steps <= 3)),
        `${preset} ${shape.length}: ${shapes(taught)}`,
      );
    }
  // Quick falls back on three lines when the sheet fits.
  assert.deepEqual(new Set(planUnits(units(Array(9).fill(1)), 'quick').taught.map((u) => u.steps)), new Set([3]));
  // The other forms keep the preset's own most: five lines in standard.
  assert.deepEqual(shapes(planUnits(units([1, 1]), 'standard').taught), ['t1.1:f5', 't2.1:f5']);
});

test('the plan of a sheet names the parts that do not fit as not covered, and keeps every task’s first part', () => {
  const doc = makeDoc(
    [
      ['p1.b1', 'title', { 'p1.s1': 'Problem Set' }],
      ...Array.from(
        { length: 21 },
        (_, i): Row => [`p1.b${i + 2}`, 'paragraph', { [`p1.s${i + 2}`]: `Part ${i + 1}.` }],
      ),
    ],
    [
      {
        id: 'ex1',
        number: '1',
        page: 1,
        block: 'p1.b2',
        blocks: ['p1.b2'],
        parts: Array.from({ length: 20 }, (_, i) => ({
          id: `ex1.${i + 1}`,
          label: String(i + 1),
          page: 1,
          blocks: [`p1.b${i + 3}`],
        })),
      },
    ],
  );
  const parts = exerciseUnits(doc);
  assert.equal(parts.length, 20);
  const { taught, skipped } = planUnits(parts, 'quick');
  assert.equal(taught[0].id, 'ex1.1');
  assert.deepEqual(
    skipped.map((u) => u.id),
    parts.slice(taught.length).map((u) => u.id),
  );
  assert.ok(skipped.length > 0);
});

// ------------------------------------------------------------------------------------------------ the whole tour

type Request = { name: string; schema: any; brief: string; task: string };
const titles = {
  problem: 'What it is',
  idea: 'Idea',
  method: 'How',
  evidence: 'Facts',
  limits: 'Catches',
  takeaway: 'Remember',
};
const item = (text: string, ...evidence: string[]) => ({ text, evidence });
const card = (subject = 'mathematics') => ({
  plan: 'p',
  doc_type: 'exercise_sheet',
  subject,
  title: 'A problem set',
  chapter_titles: titles,
  problem: item('A sheet on linear equations.', 'p1.s3'),
  key_idea: item('Solve by doing the same on both sides.', 'p1.s3'),
  method_steps: [item('Subtract and divide.', 'p1.s3')],
  key_figures: [],
  key_formulas: [],
  results: [],
  limitations: [item('Check every step.', 'p1.s3')],
  takeaway: item('Practise the method.', 'p1.s3'),
  suggested_questions: ['Why the same on both sides?', 'How do I check?', 'What about two unknowns?'],
});
const SAY = 'This step explains the point clearly so that the reader can follow every part of it while the page moves.';
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

/** A scripted provider whose model may answer later (`await`) or hang until the call is aborted. */
function provider(
  model: (r: Request) => unknown | Promise<unknown>,
  requests: Request[] = [],
  hangs: (r: Request) => boolean = () => false,
): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const parts = (content: any) => (typeof content === 'string' ? [{ type: 'text', text: content }] : content);
    const texts: string[] = body.messages.flatMap((m: any) => parts(m.content).map((p: any) => p.text ?? ''));
    const request: Request = {
      name: body.response_format.json_schema.name,
      schema: body.response_format.json_schema.schema,
      brief: texts.find((t) => t.startsWith('TASK:') && !t.startsWith('TASK: understand')) ?? '',
      task: texts.join('\n'),
    };
    requests.push(request);
    if (hangs(request))
      return new Promise<Response>((_, reject) => {
        const abort = () => reject(new Error('aborted'));
        if (init?.signal?.aborted) abort();
        else init?.signal?.addEventListener('abort', abort, { once: true });
      });
    const value = await model(request);
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  }) as typeof fetch;
}
const unitOfRequest = (r: Request): keyof typeof OWN =>
  /part a\)/.test(r.brief)
    ? 'ex1.a'
    : /part b\)/.test(r.brief)
      ? 'ex1.b'
      : /EXERCISE: Problem 2/.test(r.brief)
        ? 'ex2'
        : 'ex3';
/** The model of the sheet: a card, no pictures, a solution per part with the concept `concepts` gives it. */
const sheetModel =
  (concepts: Partial<Record<keyof typeof OWN, string>>, subject = 'mathematics', adaptive = false) =>
  (r: Request) => {
    if (r.name === 'paper_card') return card(subject);
    if (r.name === 'visual_plan') {
      // Adaptive tours need a decision for every part; the others take an empty plan.
      const choices: string[] = r.schema.properties.beats.items.properties.beat.enum;
      return adaptive
        ? { plan: 'p', beats: choices.map((beat) => ({ beat, visual: 'none', idea: '', data: '' })) }
        : { plan: 'none', beats: [] };
    }
    if (r.name === 'exercise_solution') {
      const id = unitOfRequest(r);
      return solution(id, concepts[id] ?? '');
    }
    const cue = r.schema.properties.cues.items.properties;
    const target = cue.target.enum?.find((id: string) => /^p\d/.test(id));
    return {
      plan: 'p',
      say: SAY,
      cues: target ? [{ action: 'highlight', target, label: '', anchor: 'explains the point' }] : [],
    };
  };
const verifier: MathVerifier = async (lines) => lines.map(() => ok);
const input = (doc: Doc): TourGenerationInput => ({
  documentId: 'doc',
  analysisId: 'a',
  doc,
  images: [{ targetId: 'page1', kind: 'page', page: 1, label: 'Page 1', dataUrl: png } satisfies TourImage],
});
const stepsOfTour = (tour: Tour) => tour.chapters.flatMap((c) => c.steps);

test('a tool is taught once per tour, in tour order, and later parts recall it in a sentence, in partial tours and in the final one', async () => {
  // Part a of task 1 finishes last, so the later tasks are solved before the part whose tool they repeat.
  const requests: Request[] = [];
  const partials: { ready: number; planned: number; tour: Tour }[] = [];
  const concepts = {
    'ex1.a': 'The Equal Operations on Both Sides',
    'ex1.b': 'Equal operations on both sides',
    ex2: 'equal operations on both sides.',
    ex3: 'Dividing by a number',
  };
  const model = sheetModel(concepts);
  const result = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(async (r) => {
      if (r.name === 'exercise_solution' && unitOfRequest(r) === 'ex1.a') await wait(120);
      return model(r);
    }, requests),
    verifier,
  ).generate({
    ...input(sheet),
    onEvent: async (type, data) => {
      if (type === 'tour.partial') partials.push(data as never);
    },
  });
  const all = ids(stepsOfTour(result.tour));
  const tools = all.filter((id) => id.includes('-tool-'));
  // Part b is a follow-on that repeats the first tool, task 2 repeats it too, task 3 has its own.
  assert.deepEqual(tools, ['ex1.a-tool-1', 'ex3-tool-1']);
  assert.ok(all.includes('ex2-try') && all.includes('ex1.b-try'));
  const step = (id: string) => stepsOfTour(result.tour).find((s) => s.id === id)!;
  assert.deepEqual(
    result.tour.chapters.find((c) => c.id === 'ex2')!.steps.map((s) => s.id),
    ['ex2-task', 'ex2-try', 'ex2-method', 'ex2-step-1', 'ex2-step-2', 'ex2-answer'],
  );
  // The repeat is one sentence after the opening, with the law back on the board; the first time is the whole tool.
  assert.ok(step('ex2-task').say.endsWith(RECALL_SAY) && step('ex1.b-task').say.endsWith(RECALL_SAY));
  assert.ok(!step('ex1.a-task').say.includes(RECALL_SAY) && step('ex1.a-tool-1').say === BACKGROUND_SAY);
  assert.equal(boardsOf(step('ex2-task')).length, 1);
  // Every partial tour is a prefix of the final one, so its tools are the final tour's.
  assert.ok(partials.length >= 1);
  for (const part of partials) {
    const mine = ids(stepsOfTour(part.tour));
    assert.deepEqual(mine, all.slice(0, mine.length));
    assert.ok(!mine.includes('ex2-step-1') || mine.includes('ex1.a-tool-1'));
  }
  assert.equal(ids(stepsOfTour(partials.at(-1)!.tour)).length, all.length);
  // The planned count is an upper bound: a tool that is not played only shortens the tour.
  assert.ok(partials.at(-1)!.planned >= all.length);
  // Part a of task 1 asks for the later part's tools, the others do not.
  const asked = (id: keyof typeof OWN) => requests.find((r) => r.name === 'exercise_solution' && unitOfRequest(r) === id)!;
  assert.match(asked('ex1.a').task, /LATER PARTS OF THIS TASK/);
  assert.doesNotMatch(asked('ex1.b').task, /LATER PARTS OF THIS TASK/);
});

test('a tool whose first part could not be taught is taught by the next part that needs it', async () => {
  const model = sheetModel({ 'ex1.a': 'Balance', ex2: 'Balance', ex3: 'Balance' });
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider((r) => (r.name === 'exercise_solution' && unitOfRequest(r) === 'ex1.a' ? { plan: 'p' } : model(r))),
    verifier,
  ).generate(input(sheet));
  const all = ids(stepsOfTour(tour));
  assert.deepEqual(
    all.filter((id) => id.includes('-tool-')),
    ['ex2-tool-1'],
  );
  assert.deepEqual(metadata.fallbackBeats, ['exercise-ex1.a']);
  assert.ok(all.includes('ex1.a-task') && !all.includes('ex1.a-try'));
});

test('a part that speaks from a template is sent back once with the words it opened with; the repaired part is taught', async () => {
  const templated = (id: keyof typeof OWN) =>
    solution(id, '', {
      read: { ...solution(id).read, say: 'Given the equation three x minus seven, we are asked to find the value of x.' },
    });
  const requests: Request[] = [];
  const events: string[] = [];
  const model = sheetModel({});
  // The first answer for ex1.a opens with "Given"; the first answer for ex1.b names its part; the repairs are fine.
  const result = await new HarnessTourGenerator(
    settings,
    'standard',
    provider((r) => {
      const id = r.name === 'exercise_solution' ? unitOfRequest(r) : undefined;
      const repair = r.task.includes('worded in a way the tour does not use');
      if (id === 'ex1.a' && !repair) return templated(id);
      if (id === 'ex1.b' && !repair)
        return solution(id, '', {
          steps: solution(id).steps.map((step, i) => (i ? step : { ...step, say: `${step.say} That is part b done.` })),
        });
      return model(r);
    }, requests),
    verifier,
  ).generate({
    ...input(sheet),
    onEvent: async (type, data) => {
      if (type === 'solution.checked') events.push(JSON.stringify(data));
    },
  });
  const repairs = requests.filter((r) => r.name === 'exercise_solution' && r.task.includes('worded in a way'));
  assert.equal(repairs.length, 2, 'one repair turn for each part');
  const forA = repairs.find((r) => unitOfRequest(r) === 'ex1.a')!;
  assert.match(forA.task, /- read\.say opens with "Given the equation three x": no template/);
  const forB = repairs.find((r) => unitOfRequest(r) === 'ex1.b')!;
  assert.match(forB.task, /- step 1 names its task or part \("part b"\): this part goes on from the part before/);
  assert.match(forB.task, /Reword a narration only as far as the problem says/);
  // The repaired answers are the ones taught.
  const all = stepsOfTour(result.tour);
  assert.ok(!all.find((s) => s.id === 'ex1.a-task')!.say.startsWith('Given'));
  assert.ok(!all.find((s) => s.id === 'ex1.b-step-1')!.say.includes('part b'));
  assert.equal(requests.filter((r) => r.name === 'exercise_solution' && unitOfRequest(r) === 'ex1.a').length, 2);
  assert.ok(events.some((e) => /opens with/.test(e)), 'the problems are in the events');
  // A part that still speaks from the template after its repair is taught all the same, never dropped.
  const stubborn = await new HarnessTourGenerator(
    settings,
    'standard',
    provider((r) => (r.name === 'exercise_solution' && unitOfRequest(r) === 'ex1.a' ? templated('ex1.a') : model(r))),
    verifier,
  ).generate(input(sheet));
  assert.deepEqual(stubborn.metadata.fallbackBeats, []);
  assert.ok(ids(stepsOfTour(stubborn.tour)).includes('ex1.a-answer'));
});

test('the card’s subject chooses the worked example of the solve call, and the check line is verified after the answer', async () => {
  const requests: Request[] = [];
  const seen: string[][] = [];
  const checking: MathVerifier = async (lines) => {
    seen.push(lines);
    return lines.map((line) =>
      line.startsWith('3 \\cdot 12') ? { status: 'failed' as const, problem: '3 * 12 - 7 is not 2 * 12 + 5' } : ok,
    );
  };
  const { step } = await (async () => {
    const result = await new HarnessTourGenerator(
      settings,
      'standard',
      provider(sheetModel({ 'ex1.a': 'The mole and molar mass' }, 'chemistry'), requests),
      checking,
    ).generate(input(sheet));
    return { ...result, step: (id: string) => stepsOfTour(result.tour).find((s) => s.id === id)! };
  })();
  // The overview and the takeaway play before any part is worked: they keep the sheet's tone and not the tutor's moves.
  const overview = requests.find((r) => r.brief.includes('STEP KIND: overview'))!;
  assert.ok(overview.brief.includes('patient tutor'));
  assert.ok(!overview.brief.includes('take one move per step'));
  const solves = requests.filter((r) => r.name === 'exercise_solution');
  assert.ok(solves.length >= 4);
  for (const solve of solves) {
    assert.ok(solve.brief.includes('patient tutor') && solve.brief.includes('take one move per step'));
    assert.ok(solve.brief.includes(JSON.stringify(EXAMPLES.chemistry)));
    // The first part of a task sees the explanation too, a part that goes on from an earlier one the follow-on part.
    const later = unitOfRequest(solve) === 'ex1.b';
    assert.equal(solve.brief.includes(JSON.stringify(EXAMPLES.explanation)), !later);
    assert.equal(solve.brief.includes(JSON.stringify(FOLLOW_ON)), later);
    assert.ok(!solve.brief.includes(JSON.stringify(EXAMPLES.maths)));
  }
  // The verifier saw the steps, the answer and then the check line; the repair turn named the failing check line.
  assert.deepEqual(seen[0], ['x - 7 = 5', 'x = 12', 'x = 12', '3 \\cdot 12 - 7 = 2 \\cdot 12 + 5']);
  const repaired = requests.filter((r) => r.name === 'exercise_solution' && r.task.includes('do not check out'));
  assert.ok(repaired.length >= 1);
  assert.match(repaired[0].task, /- check: 3 \* 12 - 7 is not 2 \* 12 \+ 5/);
  assert.match(repaired[0].task, /If the check line is wrong, correct it/);
  // The check line that stays wrong is said with a please-check note, once.
  const answer = step('ex1.a-answer');
  assert.equal(answer.say.split('Please check this step yourself.').length - 1, 1);
  assert.ok(boardsOf(answer).length === 2 && formulaOf(boardsOf(answer)[1]).verified === undefined);
});

test('an adaptive tour never fails because of one part: it is tried three times, then points at its task text', async () => {
  const requests: Request[] = [];
  const events: { type: string; data: Record<string, any> }[] = [];
  const model = sheetModel({ 'ex1.a': 'Balance', ex2: 'Balance' }, 'mathematics', true);
  // Every call for task 2 hangs until its time (the request budget) is over; the other parts are fine.
  const result = await new HarnessTourGenerator(
    { ...settings, timeoutMs: 150 },
    'standard',
    provider(model, requests, (r) => r.name === 'exercise_solution' && unitOfRequest(r) === 'ex2'),
    verifier,
  ).generate({
    ...input(sheet),
    profile: profileSnapshot(BUILTIN_TOUR_PROFILES[0]),
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  assert.equal(requests.filter((r) => r.name === 'exercise_solution' && unitOfRequest(r) === 'ex2').length, 3);
  const all = ids(stepsOfTour(result.tour));
  assert.ok(all.includes('ex2-task') && !all.includes('ex2-try'), 'the part is its task text');
  assert.ok(all.includes('ex1.a-answer') && all.includes('ex3-answer'), 'the other parts are taught');
  assert.deepEqual(result.metadata.fallbackBeats, ['exercise-ex2']);
  const fallback = events.find((e) => e.type === 'beat.fallback' && e.data.beat === 'exercise-ex2');
  assert.equal(fallback?.data.code, 'slow');
  assert.deepEqual(result.tour.left_out, [{ step: 'exercise-ex2', part: 'narration', cause: 'slow' }]);
  // Not adaptive, the same part is tried twice and falls back all the same.
  const plain: Request[] = [];
  const done = await new HarnessTourGenerator(
    { ...settings, timeoutMs: 5000 },
    'standard',
    provider(sheetModel({}), plain, (r) => r.name === 'exercise_solution' && unitOfRequest(r) === 'ex2'),
    verifier,
    undefined,
    { ...(await import('../src/harness/pace')).PACE, callMs: () => 150 },
  ).generate(input(sheet));
  assert.equal(plain.filter((r) => r.name === 'exercise_solution' && unitOfRequest(r) === 'ex2').length, 2);
  assert.deepEqual(done.metadata.fallbackBeats, ['exercise-ex2']);
});

test('an adaptive tour gives a part that has a usable answer one repair only, as the others do; the extra try is for a part with none', async () => {
  const stubborn: MathVerifier = async (lines) =>
    lines.map((line) =>
      line.startsWith('3 \\cdot 12') ? { status: 'failed' as const, problem: 'the check line does not hold' } : ok,
    );
  const calls = async (adaptive: boolean) => {
    const requests: Request[] = [];
    const result = await new HarnessTourGenerator(
      settings,
      'standard',
      provider(sheetModel({}, 'mathematics', adaptive), requests),
      stubborn,
    ).generate({ ...input(sheet), ...(adaptive ? { profile: profileSnapshot(BUILTIN_TOUR_PROFILES[0]) } : {}) });
    return {
      count: requests.filter((r) => r.name === 'exercise_solution' && unitOfRequest(r) === 'ex1.a').length,
      result,
    };
  };
  // A check line that stays wrong is asked about once: the first answer and one repair, adaptive or not.
  const plain = await calls(false);
  const adaptive = await calls(true);
  assert.equal(plain.count, 2);
  assert.equal(adaptive.count, 2);
  // The part is taught, with the check line said under a please-check note, not dropped.
  assert.deepEqual(adaptive.result.metadata.fallbackBeats, []);
  assert.ok(ids(stepsOfTour(adaptive.result.tour)).includes('ex1.a-answer'));
});
