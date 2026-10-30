import test from 'node:test';
import assert from 'node:assert/strict';
import type { MuseConfig } from '../src/config';
import type { BBox, BlockType, Doc, DocExercise, Step, Tour } from '../../shared/paper';
import type { TourGenerationInput, TourImage } from '../src/tour-generator';
import { HarnessTourGenerator } from './harness-fixture';
import {
  cleanSolution,
  exerciseUnits,
  leaksResult,
  planUnits,
  solveSchema,
  unitOverhead,
  unitSteps,
} from '../src/harness/exercise';
import type { LineCheck, MathVerifier } from '../src/harness/verify';

// Coach mode for exercise sheets: before a part's worked solution the learner gets a checkpoint, a prompt with up to
// three hints that go from a nudge to almost the answer and never contain the result. The steps after it reveal the
// solution as before. Tested on an English and a German sheet, with a scripted model.

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
function makeDoc(title: string, rows: Row[], exercises: DocExercise[]): Doc {
  return {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'doc.pdf', sha256: 'e'.repeat(64), num_pages: 1, generator: 'test', title },
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
const exercises: DocExercise[] = [
  {
    id: 'ex1',
    number: '1',
    page: 1,
    block: 'p1.b2',
    blocks: ['p1.b2', 'p1.b3', 'p1.b4', 'p1.b5', 'p1.b6'],
    parts: [
      { id: 'ex1.a', label: 'a', page: 1, blocks: ['p1.b4', 'p1.b5'] },
      { id: 'ex1.b', label: 'b', page: 1, blocks: ['p1.b6'] },
    ],
  },
];
const english = makeDoc(
  'Problem Set 2',
  [
    ['p1.b1', 'title', { 'p1.s1': 'Problem Set 2' }],
    ['p1.b2', 'paragraph', { 'p1.s2': 'Problem 1' }],
    ['p1.b3', 'paragraph', { 'p1.s3': 'Consider the equation 3x - 7 = 2x + 5.' }],
    ['p1.b4', 'paragraph', { 'p1.s4': 'a) Solve the equation for x.' }],
    ['p1.b5', 'paragraph', { 'p1.s5': 'Hint: Move all terms with x to one side first.' }],
    ['p1.b6', 'paragraph', { 'p1.s6': 'b) Check your solution by substituting it.' }],
  ],
  exercises,
);
const german = makeDoc(
  'Übungsblatt 2',
  [
    ['p1.b1', 'title', { 'p1.s1': 'Übungsblatt 2' }],
    ['p1.b2', 'paragraph', { 'p1.s2': 'Aufgabe 1' }],
    ['p1.b3', 'paragraph', { 'p1.s3': 'Gegeben ist die Gleichung 3x − 7 = 2x + 5.' }],
    ['p1.b4', 'paragraph', { 'p1.s4': 'a) Lösen Sie die Gleichung nach x auf.' }],
    ['p1.b5', 'paragraph', { 'p1.s5': 'Hinweis: Bringen Sie zuerst alle Terme mit x auf eine Seite.' }],
    ['p1.b6', 'paragraph', { 'p1.s6': 'b) Machen Sie die Probe.' }],
  ],
  exercises,
);

const term = (latex: string, label: string, anchor: string) => ({ latex, label, anchor });
/** A scripted answer for part a of either sheet, with a checkpoint. */
function solution(extra: Record<string, unknown> = {}) {
  return {
    plan: '3x - 7 = 2x + 5, x = 12',
    read: {
      say: 'We are given the equation three x minus seven equals two x plus five, and we are asked to solve it for x.',
      given: ['p1.s3'],
      given_anchor: 'three x minus seven',
      asked: ['p1.s4'],
      asked_anchor: 'asked to solve it',
      marks: [],
    },
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

// ------------------------------------------------------------------------------------------------ the hints

test('a hint or prompt that gives the result away is found: the answer line, its numbers, its number words', () => {
  const given = 'Consider the equation 3x - 7 = 2x + 5.';
  assert.equal(leaksResult('So x equals 12 in the end.', 'x = 12', given), true);
  assert.equal(leaksResult('Then x = 12.', 'x = 12', given), true);
  assert.equal(leaksResult('The answer is twelve.', 'x = 12', given), true);
  assert.equal(leaksResult('Das Ergebnis ist zwölf.', 'x = 12', given), true);
  assert.equal(leaksResult('Subtract two x from both sides, then add seven.', 'x = 12', given), false);
  // A number the task itself contains is not the result, and everyday words are not number words.
  assert.equal(leaksResult('Subtract 2x and add 7 on both sides; one side has the 5.', 'x = 5', given), false);
  assert.equal(leaksResult('Take the two sides and move one term.', 'x = 2', 'Solve 4x = 8y'), false);
  // A symbolic result is found by its right-hand side.
  assert.equal(leaksResult('You get x = \\frac{b}{a} at the end.', 'x = \\frac{b}{a}', 'Solve ax = b'), true);
  assert.equal(leaksResult('Divide both sides by a.', 'x = \\frac{b}{a}', 'Solve ax = b'), false);
});

test('the checkpoint keeps up to three hints, cut at the first one that gives the result away; the sheet’s own hint comes first', () => {
  const unit = planUnits(exerciseUnits(english), 'standard').taught[0];
  const kept = cleanSolution(solution(), unit, english).solution!;
  assert.equal(kept.coach?.prompt, 'Before we solve it, what would you do first to bring the x terms together?');
  // The printed hint comes first, verbatim, and the ladder keeps three rungs.
  assert.deepEqual(kept.coach?.hints, [
    'Move all terms with x to one side first.',
    'Look at the x terms on both sides of the equation.',
    'Subtract two x from both sides so that only one x term is left.',
  ]);
  const leaking = cleanSolution(
    solution({
      try: {
        prompt: 'What is x? Try to find it.',
        hints: ['Isolate x on one side.', 'Then x equals twelve.', 'Divide nothing.'],
      },
    }),
    unit,
    english,
  ).solution!;
  assert.deepEqual(leaking.coach?.hints, ['Move all terms with x to one side first.', 'Isolate x on one side.']);
  // A prompt that gives the result, one that is too long, and an answer without a checkpoint: no pause, still a solution.
  for (const prompt of ['Show that x = 12.', 'Try it. '.repeat(50)]) {
    const none = cleanSolution(solution({ try: { prompt, hints: ['Think.'] } }), unit, english);
    assert.equal(none.solution?.coach, null, prompt.slice(0, 20));
    assert.ok(none.solution);
  }
  const { try: _omitted, ...withoutTry } = solution();
  assert.equal(cleanSolution(withoutTry, unit, english).solution?.coach, null);
  // Without the document the hints are still checked against the result.
  assert.deepEqual(cleanSolution(solution(), unit).solution?.coach?.hints.length, 3);
  // German: the printed "Hinweis" is found, and a German number word is a leak.
  const unitDe = planUnits(exerciseUnits(german), 'standard').taught[0];
  const de = cleanSolution(
    solution({
      try: { prompt: 'Was würden Sie zuerst tun?', hints: ['Sortieren Sie die x-Terme.', 'Das Ergebnis ist zwölf.'] },
    }),
    unitDe,
    german,
  ).solution!;
  assert.deepEqual(de.coach?.hints, [
    'Bringen Sie zuerst alle Terme mit x auf eine Seite.',
    'Sortieren Sie die x-Terme.',
  ]);
});

test('the solve call offers the checkpoint; the code accepts an answer without one', () => {
  const unit = planUnits(exerciseUnits(english), 'standard').taught[0];
  const strict = solveSchema(unit) as { required: string[]; properties: Record<string, any> };
  assert.ok(strict.required.includes('try'));
  assert.equal(strict.properties.try.properties.hints.maxItems, 3);
  assert.equal(strict.properties.try.properties.prompt.maxLength, 300);
  assert.equal(strict.properties.try.properties.hints.items.maxLength, 200);
  const loose = solveSchema(unit, false) as { required: string[] };
  assert.ok(!loose.required.includes('try'));
});

// ------------------------------------------------------------------------------------------------ the steps

const ok: LineCheck = { status: 'ok' };
const types = (step: Step) => step.actions.map((a) => a.type);

test('a part with a checkpoint is taught as the task, your turn, the method, the solution lines and the answer', () => {
  const unit = planUnits(exerciseUnits(english), 'standard').taught[0];
  const solved = cleanSolution(solution(), unit, english).solution!;
  const steps = unitSteps(unit, solved, [ok, ok, ok], 'en-US');
  assert.deepEqual(
    steps.map((s) => s.id),
    ['ex1.a-task', 'ex1.a-try', 'ex1.a-method', 'ex1.a-step-1', 'ex1.a-step-2', 'ex1.a-answer'],
  );
  assert.equal(unitOverhead(unit), 4);
  const turn = steps[1];
  assert.equal(turn.say, solved.coach!.prompt);
  assert.deepEqual(turn.checkpoint, { prompt: solved.coach!.prompt, hints: solved.coach!.hints });
  assert.deepEqual(types(turn), ['focus', 'highlight']);
  // Nothing before the pause says the method or the result; the steps after it reveal them.
  assert.ok(!steps[0].say.includes('same on both sides'));
  assert.equal(steps[2].say, solved.method.say);
  assert.ok(steps.filter((s) => s.checkpoint).length === 1);
  assert.ok(!/twelve|12/.test(`${steps[0].say} ${turn.say} ${turn.checkpoint!.hints.join(' ')}`));
  // The solution lines are as before, with their board and their pause.
  assert.ok(types(steps[3]).includes('board'));
  assert.equal(steps[3].hold_ms, 800);
});

test('in the compact form the method opens the first solution line, after the checkpoint', () => {
  const unit = planUnits(exerciseUnits(english), 'quick').taught[0];
  assert.equal(unit.compact, true);
  const solved = cleanSolution(solution(), unit, english).solution!;
  const steps = unitSteps(unit, solved, [ok, ok, ok], 'en-US');
  assert.deepEqual(
    steps.map((s) => s.id),
    ['ex1.a-task', 'ex1.a-try', 'ex1.a-step-1', 'ex1.a-step-2'],
  );
  assert.equal(unitOverhead(unit), 2);
  assert.equal(steps[0].say, solved.read.say);
  assert.ok(steps[2].say.startsWith(solved.method.say));
  // The board term still lights up where the narration names it, in the longer step.
  const focus = steps[2].actions.find((a) => a.type === 'board_focus');
  assert.ok(focus && (focus.at_word ?? 0) > solved.method.say.split(' ').length);
  assert.ok(steps[3].say.endsWith(solved.answer.say));
});

test('a part gets no checkpoint when it has no solution to reveal or its answer failed its check', () => {
  const unit = planUnits(exerciseUnits(english), 'standard').taught[0];
  const solved = cleanSolution(solution(), unit, english).solution!;
  const failed = unitSteps(unit, solved, [ok, ok, { status: 'failed', problem: 'x = 12 does not hold' }], 'en-US');
  assert.ok(failed.every((s) => !s.checkpoint && !s.id.endsWith('-try')));
  const none = unitSteps(unit, { ...solved, coach: null }, [ok, ok, ok], 'en-US');
  assert.deepEqual(
    none.map((s) => s.id),
    ['ex1.a-task', 'ex1.a-method', 'ex1.a-step-1', 'ex1.a-step-2', 'ex1.a-answer'],
  );
});

test('the budget counts the checkpoint, so a tour never grows past the preset', () => {
  const units = exerciseUnits(english);
  const many = Array.from({ length: 9 }, (_, i) => ({ ...units[0], id: `u${i}`, task: { ...units[0].task } }));
  for (const [preset, limit] of [
    ['quick', 10],
    ['standard', 22],
    ['deep', 30],
  ] as const) {
    const { taught } = planUnits(many, preset);
    const length = 2 + taught.reduce((n, u) => n + unitOverhead(u) + u.steps, 0);
    assert.ok(length <= limit, `${preset}: ${length}`);
  }
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
const card = (language: 'en' | 'de') => ({
  plan: 'p',
  doc_type: 'exercise_sheet',
  title: language === 'en' ? 'A problem set' : 'Ein Übungsblatt',
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
type Request = { name: string; schema: any; brief: string };
function provider(model: (r: Request) => unknown, requests: Request[] = []): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const parts = (content: any) => (typeof content === 'string' ? [{ type: 'text', text: content }] : content);
    const texts: string[] = body.messages.flatMap((m: any) => parts(m.content).map((p: any) => p.text ?? ''));
    const request: Request = {
      name: body.response_format.json_schema.name,
      schema: body.response_format.json_schema.schema,
      brief: texts.find((t) => t.startsWith('TASK:') && !t.startsWith('TASK: understand')) ?? '',
    };
    requests.push(request);
    const value = ['visual_plan', 'opening_visual'].includes(request.name)
      ? { plan: 'none', beats: [] }
      : model(request);
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  }) as typeof fetch;
}
const SAY = 'This step explains the point clearly so that the reader can follow every part of it while the page moves.';
const verifier =
  (check: (line: string) => LineCheck = () => ok): MathVerifier =>
  async (lines) =>
    lines.map(check);
const input = (doc: Doc): TourGenerationInput => ({
  documentId: 'doc',
  analysisId: 'a',
  doc,
  images: [{ targetId: 'page1', kind: 'page', page: 1, label: 'Page 1', dataUrl: png } satisfies TourImage],
});
const steps = (tour: Tour) => tour.chapters.flatMap((c) => c.steps);

async function run(doc: Doc, language: 'en' | 'de', model: (r: Request) => unknown, check?: MathVerifier) {
  const requests: Request[] = [];
  const result = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(model, requests),
    check ?? verifier(),
  ).generate(input(doc));
  return {
    ...result,
    requests,
    all: steps(result.tour),
    step: (id: string) => steps(result.tour).find((s) => s.id === id)!,
  };
  void language;
}
const sheetModel = (doc: Doc, language: 'en' | 'de') => (r: Request) => {
  if (r.name === 'paper_card') return card(language);
  if (r.name === 'exercise_solution') {
    const b = /part b\)/.test(r.brief);
    return b
      ? solution({
          read: { ...solution().read, asked: ['p1.s6'], given: ['p1.s3'] },
          try: {
            prompt: 'Try substituting your value on both sides first.',
            hints: ['Put the value in for x on the left.'],
          },
        })
      : solution();
  }
  void doc;
  const cue = r.schema.properties.cues.items.properties;
  const target = cue.target.enum?.find((id: string) => /^p\d/.test(id));
  return {
    plan: 'p',
    say: SAY,
    cues: target ? [{ action: 'highlight', target, label: '', anchor: 'explains the point' }] : [],
  };
};

for (const [language, doc] of [
  ['en', english],
  ['de', german],
] as const)
  test(`a ${language === 'en' ? 'English' : 'German'} sheet: every solved part pauses for the learner before its solution`, async () => {
    const { tour, all, requests, metadata } = await run(doc, language, sheetModel(doc, language));
    assert.equal(tour.doc_type, 'exercise_sheet');
    assert.equal(metadata.docType, 'exercise_sheet');
    assert.deepEqual(
      tour.chapters[1].steps.map((s) => s.id),
      [
        'ex1.a-task',
        'ex1.a-try',
        'ex1.a-method',
        'ex1.a-step-1',
        'ex1.a-step-2',
        'ex1.a-answer',
        'ex1.b-task',
        'ex1.b-try',
        'ex1.b-method',
        'ex1.b-step-1',
        'ex1.b-step-2',
        'ex1.b-answer',
      ],
    );
    const pauses = all.filter((s) => s.checkpoint);
    assert.equal(pauses.length, 2);
    for (const pause of pauses) {
      assert.ok(pause.checkpoint!.prompt.length <= 300);
      assert.ok(pause.checkpoint!.hints.length <= 3);
      assert.equal(pause.say, pause.checkpoint!.prompt);
    }
    // The printed hint of the sheet is the first rung, in its own language.
    assert.equal(
      pauses[0].checkpoint!.hints[0],
      language === 'en'
        ? 'Move all terms with x to one side first.'
        : 'Bringen Sie zuerst alle Terme mit x auf eine Seite.',
    );
    // The solve call asks for the checkpoint and says that no hint may give the result.
    const solve = requests.find((r) => r.name === 'exercise_solution')!;
    assert.ok(solve.schema.properties.try);
    assert.match(solve.brief, /"try" is the learner's turn/);
    assert.match(solve.brief, /No hint and not the prompt may contain the final result/);
    // No hint or prompt of the tour contains the result, though the solution steps say it.
    assert.ok(all.some((s) => /twelve/.test(s.say)));
    for (const pause of pauses)
      assert.ok(!/twelve|zwölf|12/i.test(`${pause.say} ${pause.checkpoint!.hints.join(' ')}`));
  });

test('a part the model cannot solve has no checkpoint, and an answer that fails its check has none either', async () => {
  const unsolved = await run(english, 'en', (r) =>
    r.name === 'exercise_solution' && /part b\)/.test(r.brief) ? { plan: 'p' } : sheetModel(english, 'en')(r),
  );
  assert.ok(unsolved.step('ex1.a-try').checkpoint);
  assert.deepEqual(
    unsolved.all.filter((s) => s.id.startsWith('ex1.b')).map((s) => s.id),
    ['ex1.b-task'],
  );
  const wrong = await run(
    english,
    'en',
    sheetModel(english, 'en'),
    verifier((line) => (line === 'x = 12' ? { status: 'failed', problem: 'no' } : ok)),
  );
  assert.ok(wrong.all.every((s) => !s.checkpoint));
});

test('a sheet announces its tour part by part, counting the steps of a part before it is solved', async () => {
  const partials: { ready: number; planned: number; tour: Tour }[] = [];
  const requests: Request[] = [];
  const result = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(sheetModel(english, 'en'), requests),
    verifier(),
  ).generate({
    ...input(english),
    onEvent: async (type, data) => {
      if (type === 'tour.partial') partials.push(data as never);
    },
  });
  assert.ok(partials.length >= 1);
  const total = steps(result.tour).length;
  // Planned: the overview, each part's task, checkpoint, method, three solution steps and answer, and the takeaway.
  assert.equal(partials.at(-1)!.planned, 2 + 2 * (unitOverhead({ compact: false }) + 3));
  for (const part of partials) {
    assert.equal(steps(part.tour).length, part.ready);
    assert.ok(part.ready <= total);
    assert.deepEqual(
      steps(part.tour).map((s) => s.id),
      steps(result.tour)
        .slice(0, part.ready)
        .map((s) => s.id),
    );
  }
  assert.equal(partials.at(-1)!.ready, total);
});
