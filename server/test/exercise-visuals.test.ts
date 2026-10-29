import test from 'node:test';
import assert from 'node:assert/strict';
import { modelActivityNames } from '../../shared/generationTimeline';
import type { Action, BBox, BlockType, Doc, DocExercise, Step, Tour } from '../../shared/paper';
import type { MuseConfig } from '../src/config';
import type { TourGenerationInput, TourImage } from '../src/tour-generator';
import { HarnessTourGenerator } from './harness-fixture';
import { cleanSolution, exerciseUnits, exercisePlan, planUnits, unitBrief, unitSteps } from '../src/harness/exercise';
import {
  cleanUnitVisual,
  hasVisualHost,
  unitVisualSchema,
  unitVisualTask,
  visualEvidence,
} from '../src/harness/exercise-visual';
import { BOARD_KINDS } from '../src/harness/board';
import { unitTaskLines } from '../src/harness/unit-task';
import {
  allocateFrames,
  cleanVisualPlan,
  plannableBeats,
  visualPlanBrief,
  visualPlanSchema,
  visualPlanTask,
  type StepVisual,
} from '../src/harness/visual-plan';
import type { LineCheck, MathVerifier } from '../src/harness/verify';

// The method visual of an exercise part: the sheet's plan gives a task at most one, a call draws it once the part is
// solved, and it shows with the method after the checkpoint. The solution lines stay formula boards and the board never
// states the answer. Scripted model, on a probability sheet.

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
    source: { file: 'doc.pdf', sha256: 'e'.repeat(64), num_pages: 1, generator: 'test', title: 'Problem Set 2' },
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
const task = (id: string, number: string, block: string, parts: [string, string[]][]): DocExercise => ({
  id,
  number,
  page: 1,
  block,
  blocks: [block, ...parts.flatMap(([, blocks]) => blocks)],
  parts: parts.map(([label, blocks]) => ({ id: `${id}.${label}`, label, page: 1, blocks })),
});
const sheet = makeDoc(
  [
    ['p1.b1', 'title', { 'p1.s1': 'Problem Set 2' }],
    ['p1.b2', 'paragraph', { 'p1.s2': 'Problem 1' }],
    [
      'p1.b3',
      'paragraph',
      { 'p1.s3': 'A test finds 99 of every 100 sick people and wrongly flags 1 of every 100 healthy people.' },
    ],
    ['p1.b4', 'paragraph', { 'p1.s4': 'One person in 100 is sick.' }],
    ['p1.b5', 'paragraph', { 'p1.s5': 'a) A person tests positive. What is the probability that the person is sick?' }],
    ['p1.b6', 'paragraph', { 'p1.s6': 'b) How many of 10000 people test positive?' }],
    ['p1.b7', 'paragraph', { 'p1.s7': 'Problem 2' }],
    ['p1.b8', 'paragraph', { 'p1.s8': 'Draw the graph of f(x) = x^2 - 4 and find its zeros.' }],
  ],
  [
    task('ex1', '1', 'p1.b2', [
      ['a', ['p1.b5']],
      ['b', ['p1.b6']],
    ]),
    task('ex2', '2', 'p1.b7', []),
  ],
);
sheet.exercises![0].blocks = ['p1.b2', 'p1.b3', 'p1.b4', 'p1.b5', 'p1.b6'];
sheet.exercises![1].blocks = ['p1.b7', 'p1.b8'];

const units = exerciseUnits(sheet);
const unit = (id: string) => planUnits(units, 'standard').taught.find((u) => u.id === id)!;
const term = (latex: string, label: string, anchor: string) => ({ latex, label, anchor });
const METHOD =
  'We count natural frequencies: out of ten thousand people, look at the sick people and at the healthy people separately.';
function solution(answer = 'P = 0.5') {
  return {
    plan: 'positives: 99 sick + 99 healthy',
    read: {
      say: 'We are given how accurate the test is and how rare the disease is, and we are asked for the chance that a positive person is sick.',
      given: ['p1.s3'],
      given_anchor: 'how accurate the test is',
      asked: ['p1.s5'],
      asked_anchor: 'the chance that',
      marks: [],
    },
    method: {
      say: METHOD,
      formula: {
        title: 'Bayes',
        latex: 'P(S\\mid +)=\\frac{P(+\\mid S)P(S)}{P(+)}',
        terms: [term('P(S\\mid +)', 'sick given positive', 'natural frequencies')],
      },
    },
    steps: [
      {
        title: 'Count positives',
        latex: '99 + 99 = 198',
        terms: [term('198', 'all positives', 'all positives')],
        say: 'Ninety-nine sick and ninety-nine healthy people test positive, so there are all positives to divide by.',
        sure: true,
      },
      {
        title: 'Divide',
        latex: 'P = \\frac{99}{198}',
        terms: [term('\\frac{99}{198}', 'sick share', 'sick share')],
        say: 'The sick share of the positives is ninety-nine out of those, which we simplify now.',
        sure: true,
      },
    ],
    answer: {
      title: 'Result',
      latex: answer,
      terms: [term('0.5', 'one half', 'one half')],
      say: 'So the chance is one half, which surprises most people.',
    },
    try: {
      prompt:
        'Before we count, how many people would you expect to be sick among ten thousand, and how many of them test positive?',
      hints: ['Start from the share of sick people.', 'Then ask how many sick people the test catches.'],
    },
    check_note: 'Please check this step yourself.',
    questions: ['Why natural frequencies?', 'What if the disease were rarer?'],
  };
}
const ok: LineCheck = { status: 'ok' };
const solved = (u = unit('ex1.a'), answer?: string) => cleanSolution(solution(answer), u, sheet).solution!;

/** The natural-frequency grid of the part, which sets the problem up and does not state its answer. */
const grid = (extra: Record<string, unknown> = {}) => ({
  kind: 'heatmap',
  title: 'Natural frequencies, 10000 people',
  rows: ['sick', 'healthy'],
  cols: ['positive', 'negative'],
  values: [
    [99, 1],
    [99, 9801],
  ],
  source: 'illustrative',
  ...extra,
});
const planned: StepVisual = {
  visual: 'heatmap',
  idea: 'Ten thousand people sorted by sick and positive.',
  data: '10000 people; 99 and 1 per 100 as given; illustrative counts',
};
const draw = (board: unknown = grid(), focus: unknown = []) => ({ plan: 'p', heatmap: board, focus });

// ---------------------------------------------------------------------------------------------------- the plan

test('the sheet plan offers the tasks, never a formula, and names the method as what a visual is for', () => {
  const beats = exercisePlan(card('en'), sheet, 'standard').beats;
  const tasks = plannableBeats(beats);
  assert.deepEqual(
    tasks.map((b) => b.id),
    ['exercise-ex1.a', 'exercise-ex1.b', 'exercise-ex2'],
  );
  const item = (visualPlanSchema(tasks, { sheet: true }) as any).properties.beats.items;
  assert.deepEqual(item.properties.beat.enum, ['exercise-ex1.a', 'exercise-ex1.b', 'exercise-ex2']);
  assert.deepEqual(item.properties.visual.enum, [
    'none',
    ...BOARD_KINDS.filter((k) => k !== 'formula' && k !== 'timeline'),
  ]);
  const text = visualPlanTask('en-US', { sheet: true });
  assert.match(text, /solves it line by line on the board in formulas/);
  assert.match(text, /never plan a formula/);
  assert.match(text, /At most one visual per task/);
  assert.match(text, /never the result/);
  for (const kind of BOARD_KINDS.filter((k) => k !== 'formula' && k !== 'timeline'))
    assert.match(text, new RegExp(`- ${kind}: `), kind);
  assert.doesNotMatch(text, /- formula: /);
  assert.doesNotMatch(text, /- timeline: /, 'a sheet has no dates to lay out');
  // The brief gives every part its name and its task, which is what the picture is set up from.
  const brief = visualPlanBrief(card('en'), tasks, sheet);
  assert.match(brief, /THE TASKS OF THE SHEET, in order:/);
  assert.match(brief, /\[exercise-ex1\.a\] exercise step: Problem 1, part a\)/);
  assert.match(brief, /\[p1\.s3\] A test finds 99 of every 100 sick people/);
  assert.match(brief, /\[exercise-ex2\] exercise step: Problem 2/);
  assert.match(brief, /\[p1\.s8\] Draw the graph of f\(x\)/);
});

test('a sheet keeps one visual per task, never a formula, each kind within its limit', () => {
  const tasks = plannableBeats(exercisePlan(card('en'), sheet, 'standard').beats);
  const entry = (beat: string, visual: string) => ({ beat, visual, idea: 'Show the setting.', data: 'the givens' });
  const { plan, adjusted } = cleanVisualPlan(
    {
      beats: [entry('exercise-ex1.a', 'heatmap'), entry('exercise-ex1.b', 'bars'), entry('exercise-ex2', 'formula')],
    },
    tasks,
    { sheet: true },
  );
  assert.equal(plan!.get('exercise-ex1.a')!.visual, 'heatmap');
  assert.equal(plan!.get('exercise-ex1.b')!.visual, 'none');
  assert.equal(plan!.get('exercise-ex2')!.visual, 'none');
  assert.deepEqual(
    adjusted.map((a) => [a.beat, a.visual, a.reason]),
    [
      ['exercise-ex1.b', 'bars', 'at most one visual per task'],
      ['exercise-ex2', 'formula', 'the solution lines are formula boards already'],
    ],
  );
  // The same kind twice across two tasks: the second is dropped, diversity first.
  const twice = cleanVisualPlan(
    { beats: [entry('exercise-ex1.a', 'heatmap'), entry('exercise-ex2', 'heatmap')] },
    tasks,
    { sheet: true },
  );
  assert.equal(twice.plan!.get('exercise-ex2')!.visual, 'none');
  assert.match(twice.adjusted[0].reason, /at most 1 heatmap board/);
  // A sheet has no worked-example frames: its tasks plan no formula and the overview and takeaway have no entry.
  assert.deepEqual(
    [...allocateFrames(plan!, tasks).values()].filter((v) => v.frames),
    [],
  );
});

// ---------------------------------------------------------------------------------------------------- the call

test('the visual call sees the task, the plan, the narration and the answer to keep off the board', () => {
  const u = unit('ex1.a');
  const s = solved();
  const text = unitVisualTask('en-US', unitBrief(u, sheet), planned as StepVisual & { visual: 'heatmap' }, s);
  assert.match(text, /^TASK: draw ONE side-board visual for the method of an exercise/);
  assert.match(text, /EXERCISE: Problem 1, part a\)/);
  assert.match(text, /VISUAL FOR THIS STEP: heatmap: Ten thousand people/);
  assert.match(text, /THE METHOD AS IT IS NARRATED .*We count natural frequencies/);
  assert.match(text, /THE ANSWER, which your board must not show: P = 0\.5/);
  assert.match(text, /99 \+ 99 = 198/);
  assert.match(text, /Never show the result/);
  assert.equal(modelActivityNames.exercise_visual, 'Draw the method of an exercise');
  assert.match(text, /BOARD \(optional\): a heatmap shows a grid/);
  const schema: any = unitVisualSchema('heatmap');
  assert.deepEqual(schema.required, ['plan', 'heatmap', 'focus']);
  assert.equal(schema.properties.heatmap.properties.kind.enum[0], 'heatmap');
  assert.equal(schema.properties.focus.maxItems, 3);
  assert.deepEqual(schema.properties.focus.items.properties.target.enum.slice(0, 2), ['row-1', 'row-2']);
  const lines = unitTaskLines(u, sheet);
  assert.equal(lines[0], 'TASK STATEMENT, shared by its parts:');
  assert.ok(
    lines.includes('[p1.s3] A test finds 99 of every 100 sick people and wrongly flags 1 of every 100 healthy people.'),
  );
  assert.ok(
    lines.includes('THIS PART:') &&
      lines.includes('[p1.s5] a) A person tests positive. What is the probability that the person is sick?'),
  );
});

test('a board of the setting passes; one that shows the answer, invents numbers or is not drawn is sent back', () => {
  const u = unit('ex1.a');
  const s = solved();
  const clean = (value: unknown) => cleanUnitVisual(value, 'heatmap', u, sheet, s, planned);
  const good = clean(
    draw(grid(), [
      { target: 'row-1', anchor: 'the sick people' },
      { target: 'row-2', anchor: 'the healthy people' },
      { target: 'row-2', anchor: 'people separately' },
      { target: 'row-9', anchor: 'natural frequencies' },
      { target: 'row-1', anchor: 'words that are not there' },
    ]),
  );
  assert.deepEqual(good.problems, []);
  assert.equal(good.visual!.item.kind, 'heatmap');
  // Each part once, in the order the narration names them, and only with an anchor in the narration.
  assert.deepEqual(good.visual!.focus, [
    { part: 0, anchor: 'the sick people' },
    { part: 1, anchor: 'the healthy people' },
  ]);
  // The answer, in a title or a value, is kept off the board.
  for (const board of [
    grid({ title: 'Half of the positives are sick: P = 0.5' }),
    grid({
      values: [
        [99, 0.5],
        [99, 9801],
      ],
    }),
  ]) {
    const leaked = clean(draw(board));
    assert.equal(leaked.visual, null);
    assert.match(leaked.problems.join(' '), /shows the result of the exercise \(P = 0\.5\)/);
  }
  // A grid of the document's own numbers must print them; an illustrative one need not.
  const invented = clean(
    draw(
      grid({
        source: 'document',
        values: [
          [98, 2],
          [11, 9801],
        ],
      }),
    ),
  );
  assert.equal(invented.visual, null);
  assert.match(invented.problems.join(' '), /heatmap: values: not printed in the evidence/);
  assert.equal(
    clean(
      draw(
        grid({
          source: 'document',
          values: [
            [99, 1],
            [1, 99],
          ],
        }),
      ),
    ).visual!.item.kind,
    'heatmap',
  );
  // Not drawn, or not a valid board.
  assert.deepEqual(clean({ plan: 'p', focus: [] }).problems, ['draw the planned heatmap board in "heatmap"']);
  assert.match(clean(draw(grid({ cols: ['only'] }))).problems.join(' '), /heatmap:/);
  assert.equal(clean(null).visual, null);
  // The evidence is the task, the method, the lines up to the answer and the plan's data, never the answer line.
  const evidence = visualEvidence(u, sheet, s, planned);
  assert.match(evidence, /99 of every 100 sick people/);
  assert.match(evidence, /99 \+ 99 = 198/);
  assert.doesNotMatch(evidence, /P = 0\.5/);
});

test('a visual for a bars, scatter or shapes board is held to the rules of a tour step', () => {
  const u = unit('ex1.a');
  const s = solved();
  const shapes = cleanUnitVisual(
    {
      plan: 'p',
      shapes: {
        kind: 'shapes',
        title: 'Counts by group',
        terms: [
          { kind: 'matrix', name: 'C', rows: '2', cols: '2' },
          { kind: 'op', op: 'times' },
          { kind: 'matrix', name: 'v', rows: '3', cols: '1' },
          { kind: 'op', op: 'equals' },
          { kind: 'matrix', name: 'w', rows: '2', cols: '1' },
        ],
      },
      focus: [],
    },
    'shapes',
    u,
    sheet,
    s,
    { visual: 'shapes', idea: 'Show it.', data: '' },
  );
  assert.equal(shapes.visual, null);
  assert.match(shapes.problems.join(' '), /shapes:/);
  const scatter = cleanUnitVisual(
    {
      plan: 'p',
      scatter: {
        kind: 'scatter',
        x_label: 'x',
        y_label: 'y',
        points: [
          { label: 'a', x: 1, y: 2 },
          { label: 'b', x: 2, y: 3 },
          { label: 'c', x: 3, y: 5 },
        ],
        source: 'illustrative',
      },
      focus: [],
    },
    'scatter',
    u,
    sheet,
    s,
    { visual: 'scatter', idea: 'Show it.', data: '' },
  );
  assert.equal(scatter.visual, null);
  assert.match(scatter.problems.join(' '), /a scatter shows quantities measured/);
});

// ---------------------------------------------------------------------------------------------------- the steps

const types = (step: Step) => step.actions.map((a) => a.type);
const boards = (step: Step) =>
  step.actions.filter((a): a is Extract<Action, { type: 'board' }> => a.type === 'board').map((a) => a.item.kind);

test('the visual shows with the method, after the checkpoint, in place of the rule, and the solution lines stay formulas', () => {
  const u = unit('ex1.a');
  const s = solved();
  const visual = cleanUnitVisual(
    draw(grid(), [
      { target: 'row-1', anchor: 'the sick people' },
      { target: 'row-2', anchor: 'the healthy people' },
    ]),
    'heatmap',
    u,
    sheet,
    s,
    planned,
  ).visual!;
  const steps = unitSteps(u, s, [ok, ok, ok], 'en-US', visual);
  assert.deepEqual(
    steps.map((x) => x.id),
    ['ex1.a-task', 'ex1.a-try', 'ex1.a-method', 'ex1.a-step-1', 'ex1.a-step-2', 'ex1.a-answer'],
  );
  const method = steps[2];
  assert.deepEqual(boards(method), ['heatmap']);
  assert.deepEqual(types(method), ['focus', 'board', 'board_focus', 'board_focus']);
  assert.equal(method.hold_ms, 800);
  const lit = method.actions.filter((a) => a.type === 'board_focus');
  assert.deepEqual(
    lit.map((a) => a.type === 'board_focus' && a.part),
    [0, 1],
  );
  assert.ok(lit.every((a) => (a.at_word ?? 0) > 0 && (a.at_word ?? 0) < METHOD.split(' ').length));
  // Nothing before the checkpoint's reveal draws it, and every solution line is a formula board.
  for (const before of steps.slice(0, 3 - 1)) assert.deepEqual(boards(before), [], before.id);
  for (const line of steps.slice(3)) assert.deepEqual(boards(line), ['formula'], line.id);
  assert.ok(!JSON.stringify(steps.slice(0, 3)).includes('0.5'));
  // Without a visual the method step shows its rule, as before.
  assert.deepEqual(boards(unitSteps(u, s, [ok, ok, ok], 'en-US', null)[2]), ['formula']);
});

test('in the compact form the visual opens the first solution step and its line follows once the method is said', () => {
  const u = planUnits(units, 'quick').taught.find((x) => x.id === 'ex1.a')!;
  assert.equal(u.compact, true);
  const s = solved(u);
  assert.ok(hasVisualHost(u, s));
  const visual = cleanUnitVisual(
    draw(grid(), [{ target: 'row-1', anchor: 'the sick people' }]),
    'heatmap',
    u,
    sheet,
    s,
    planned,
  ).visual!;
  const steps = unitSteps(u, s, [ok, ok, ok], 'en-US', visual);
  assert.deepEqual(
    steps.map((x) => x.id),
    ['ex1.a-task', 'ex1.a-try', 'ex1.a-step-1', 'ex1.a-step-2'],
  );
  const first = steps[2];
  const said = METHOD.split(' ').length;
  assert.deepEqual(boards(first), ['heatmap', 'formula']);
  const [heat, line] = first.actions.filter((a) => a.type === 'board');
  assert.equal(heat.at_word, undefined);
  assert.equal(line.at_word, said);
  // The line's terms light up only after the line is on the board.
  for (const focus of first.actions.filter((a) => a.type === 'board_focus').slice(1))
    assert.ok((focus.at_word ?? 0) >= said);
  assert.deepEqual(boards(steps[0]), []);
  assert.deepEqual(boards(steps[1]), []);
});

test('a part with no step to show it keeps its solution as it was', () => {
  const u = unit('ex1.a');
  const bare = { ...solved(), method: { say: '', line: null } };
  assert.equal(hasVisualHost(u, bare), false);
  const visual = { item: grid() as never, focus: [] };
  const steps = unitSteps(u, bare, [ok, ok, ok], 'en-US', visual);
  assert.ok(steps.every((x) => !boards(x).includes('heatmap')));
  // Compact without a checkpoint: the method is said inside the task step, before any pause, so nothing shows.
  const compact = planUnits(units, 'quick').taught.find((x) => x.id === 'ex1.a')!;
  const noCoach = { ...solved(compact), coach: null };
  assert.equal(hasVisualHost(compact, noCoach), false);
  assert.ok(unitSteps(compact, noCoach, [ok, ok, ok], 'en-US', visual).every((x) => !boards(x).includes('heatmap')));
});

// ------------------------------------------------------------------------------------------- the whole tour

const titles = {
  problem: 'What it is',
  idea: 'Idea',
  method: 'How',
  evidence: 'Facts',
  limits: 'Catches',
  takeaway: 'Remember',
};
const item = (text: string, ...evidence: string[]) => ({ text, evidence });
const card = (language: 'en') => ({
  plan: 'p',
  doc_type: 'exercise_sheet' as const,
  title: language === 'en' ? 'A problem set' : '',
  chapter_titles: titles,
  problem: item('A sheet on conditional probability and graphs.', 'p1.s3'),
  key_idea: item('Count natural frequencies.', 'p1.s3'),
  method_steps: [item('Count and divide.', 'p1.s3')],
  key_figures: [],
  key_formulas: [],
  results: [],
  limitations: [item('Check every step.', 'p1.s3')],
  takeaway: item('Practise the method.', 'p1.s3'),
  suggested_questions: ['Why natural frequencies?', 'How do I check?', 'What about a rarer disease?'],
});
type Request = { name: string; schema: any; brief: string; task: string };
function provider(model: (r: Request) => unknown, requests: Request[] = []): typeof fetch {
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
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(model(request)) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  }) as typeof fetch;
}
const verifier: MathVerifier = async (lines) => lines.map(() => ok);
const input = (doc: Doc): TourGenerationInput => ({
  documentId: 'doc',
  analysisId: 'a',
  doc,
  images: [{ targetId: 'page1', kind: 'page', page: 1, label: 'Page 1', dataUrl: png } satisfies TourImage],
});
const allSteps = (tour: Tour) => tour.chapters.flatMap((c) => c.steps);
const SAY = 'This step explains the point clearly so that the reader can follow every part of it while the page moves.';

/** The model of the whole sheet: a plan with the given pick per task, solutions, and the replies to the visual call. */
function sheetModel(pick: (id: string) => string, visualReplies: Record<string, unknown>[]) {
  const drawn: Record<string, number> = {};
  return (r: Request) => {
    if (r.name === 'paper_card') return card('en');
    if (r.name === 'visual_plan') {
      const ids: string[] = r.schema.properties.beats.items.properties.beat.enum;
      return {
        plan: 'p',
        beats: ids.map((beat) => {
          const visual = pick(beat);
          return {
            beat,
            visual,
            idea: visual === 'none' ? '' : 'Ten thousand people sorted.',
            data: visual === 'none' ? '' : 'illustrative counts',
          };
        }),
      };
    }
    if (r.name === 'exercise_solution') {
      const b = /part b\)/.test(r.brief);
      return b
        ? {
            ...solution('n = 198'),
            read: { ...solution().read, asked: ['p1.s6'], given: ['p1.s3'] },
            try: { prompt: 'Try counting the positives first, please.', hints: ['Count the sick ones.'] },
          }
        : solution();
    }
    if (r.name === 'exercise_visual') {
      // The replies for the kind this call asks for, in turn; the last one repeats.
      const kind: string = r.schema.required[1];
      const mine = visualReplies.filter((reply) => kind in reply);
      drawn[kind] = (drawn[kind] ?? -1) + 1;
      return mine[Math.min(drawn[kind], mine.length - 1)];
    }
    const cue = r.schema.properties.cues.items.properties;
    const target = cue.target.enum?.find((id: string) => /^p\d/.test(id));
    return {
      plan: 'p',
      say: SAY,
      cues: target ? [{ action: 'highlight', target, label: '', anchor: 'explains the point' }] : [],
    };
  };
}
const generate = async (model: (r: Request) => unknown, preset: 'quick' | 'standard' = 'standard') => {
  const requests: Request[] = [];
  const events: { type: string; data: Record<string, any> }[] = [];
  const result = await new HarnessTourGenerator(settings, preset, provider(model, requests), verifier).generate({
    ...input(sheet),
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  return { ...result, requests, events, all: allSteps(result.tour) };
};

test('a sheet draws the planned visual for a task once the part is solved, and it shows after the checkpoint', async () => {
  const { all, requests, events, metadata } = await generate(
    sheetModel(
      (id) => (id === 'exercise-ex1.a' ? 'heatmap' : 'none'),
      [draw(grid(), [{ target: 'row-1', anchor: 'the sick people' }])],
    ),
  );
  // One plan call that lists the tasks, one visual call for the one task that has a visual.
  const plan = requests.find((r) => r.name === 'visual_plan')!;
  assert.match(plan.brief, /exercise sheet's tour/);
  assert.deepEqual(plan.schema.properties.beats.items.properties.beat.enum, [
    'exercise-ex1.a',
    'exercise-ex1.b',
    'exercise-ex2',
  ]);
  const calls = requests.filter((r) => r.name === 'exercise_visual');
  assert.equal(calls.length, 1);
  assert.match(calls[0].brief, /EXERCISE: Problem 1, part a\)/);
  assert.match(calls[0].brief, /THE ANSWER, which your board must not show: P = 0\.5/);
  // The tour: the checkpoint comes before the visual, the visual with the method, then the formula lines.
  const ids = all.map((s) => s.id);
  assert.ok(ids.indexOf('ex1.a-try') < ids.indexOf('ex1.a-method'));
  const method = all.find((s) => s.id === 'ex1.a-method')!;
  assert.deepEqual(boards(method), ['heatmap']);
  for (const id of ['ex1.a-task', 'ex1.a-try']) assert.deepEqual(boards(all.find((s) => s.id === id)!), []);
  for (const step of all.filter((s) => /^ex1\.a-(step|answer)/.test(s.id))) assert.deepEqual(boards(step), ['formula']);
  // The other parts have none, and the part keeps its checkpoint.
  assert.ok(all.every((s) => !s.id.startsWith('ex1.b') || !boards(s).includes('heatmap')));
  assert.ok(all.find((s) => s.id === 'ex1.a-try')!.checkpoint);
  // It is recorded: the plan with its entries, the visual, the metadata.
  assert.ok(
    events.some((e) => e.type === 'exercise.visual' && e.data.beat === 'exercise-ex1.a' && !e.data.problems.length),
  );
  const record = (metadata.exercises as { id: string; visual?: string }[]).find((e) => e.id === 'ex1.a')!;
  assert.equal(record.visual, 'heatmap');
  assert.ok((metadata.boards as { shown: string[] }).shown.includes('exercise-ex1.a:visual:heatmap'));
  assert.deepEqual(metadata.degraded, []);
});

test('a sheet keeps the plan to one visual per task and to the kinds that differ', async () => {
  const { requests, events, all } = await generate(sheetModel(() => 'heatmap', [draw()]));
  // Every task asked for a heatmap: the first is kept, the other part of the same task and the second task are not.
  assert.equal(requests.filter((r) => r.name === 'exercise_visual').length, 1);
  const planned = events.find((e) => e.type === 'visual.plan')!;
  assert.deepEqual(
    (planned.data.adjusted as { beat: string; reason: string }[]).map((a) => [a.beat, a.reason]),
    [
      ['exercise-ex1.b', 'at most one visual per task'],
      ['exercise-ex2', 'at most 1 heatmap board'],
    ],
  );
  assert.equal(all.filter((s) => boards(s).includes('heatmap')).length, 1);
});

test('a board that shows the answer is sent back once, and the corrected one is kept', async () => {
  const { requests, all, metadata } = await generate(
    sheetModel(
      (id) => (id === 'exercise-ex1.a' ? 'heatmap' : 'none'),
      [draw(grid({ title: 'Half are sick: P = 0.5' })), draw()],
    ),
  );
  const calls = requests.filter((r) => r.name === 'exercise_visual');
  assert.equal(calls.length, 2);
  assert.match(calls[1].task, /shows the result of the exercise \(P = 0\.5\)/);
  assert.deepEqual(boards(all.find((s) => s.id === 'ex1.a-method')!), ['heatmap']);
  assert.deepEqual(metadata.degraded, []);
});

test('a visual that fails twice is dropped and flagged, and the solution plays as it did', async () => {
  const leaky = draw(grid({ title: 'Half are sick: P = 0.5' }));
  const { requests, all, events, metadata } = await generate(
    sheetModel((id) => (id === 'exercise-ex1.a' ? 'heatmap' : 'none'), [leaky]),
  );
  assert.equal(requests.filter((r) => r.name === 'exercise_visual').length, 2);
  assert.ok(all.every((s) => !boards(s).includes('heatmap')));
  // The rule on the method step, the lines and the answer are as without a visual.
  assert.deepEqual(boards(all.find((s) => s.id === 'ex1.a-method')!), ['formula']);
  assert.deepEqual(
    all.filter((s) => s.id.startsWith('ex1.a')).map((s) => s.id),
    ['ex1.a-task', 'ex1.a-try', 'ex1.a-method', 'ex1.a-step-1', 'ex1.a-step-2', 'ex1.a-answer'],
  );
  const flagged = (metadata.degraded as { beat: string; dropped: string[]; problems: string[] }[]).filter(
    (d) => d.beat === 'exercise-ex1.a',
  );
  assert.equal(flagged.length, 1);
  assert.deepEqual(flagged[0].dropped, ['board']);
  assert.match(flagged[0].problems.join(' '), /shows the result of the exercise/);
  assert.ok(events.some((e) => e.type === 'beat.degraded' && e.data.beat === 'exercise-ex1.a'));
  assert.equal(
    (metadata.exercises as { id: string; visual?: string }[]).find((e) => e.id === 'ex1.a')!.visual,
    undefined,
  );
});

test('without a usable plan a sheet is taught as before: no visual call, formula boards only', async () => {
  const { requests, all } = await generate((r) =>
    r.name === 'visual_plan' ? { plan: 'none', beats: [] } : sheetModel(() => 'none', [])(r),
  );
  assert.equal(requests.filter((r) => r.name === 'exercise_visual').length, 0);
  assert.ok(all.every((s) => boards(s).every((kind) => kind === 'formula')));
  assert.equal(requests.filter((r) => r.name === 'visual_plan').length, 2, 'one repair of the plan');
});

test('the length of the sheet tour is the same with visuals: they take no step of their own', async () => {
  const none = await generate(sheetModel(() => 'none', []));
  const plot = {
    plan: 'p',
    plot: { kind: 'plot', title: 'f(x)', x: [-4, 4], y: [-5, 10], curves: [{ expression: 'x^2-4', label: 'f' }] },
    focus: [],
  };
  const some = await generate(sheetModel((id) => (id === 'exercise-ex2' ? 'plot' : 'none'), [plot]));
  assert.equal(some.all.length, none.all.length);
  assert.deepEqual(
    some.all.map((s) => s.id),
    none.all.map((s) => s.id),
  );
  const method = some.all.find((s) => s.id === 'ex2-method')!;
  assert.deepEqual(boards(method), ['plot']);
  // Only the method step differs from the tour without a visual.
  const differing = some.all.filter((s, i) => JSON.stringify(s.actions) !== JSON.stringify(none.all[i].actions));
  assert.deepEqual(
    differing.map((s) => s.id),
    ['ex2-method'],
  );
});
