import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, BBox, BlockType, BoardItem, Doc, DocExercise, Step } from '../../shared/paper';
import { answerQuestion } from '../src/harness/ask';
import { MuseClient } from '../src/muse/client';
import { assembleTour, dropRepeatedBoards, onePicturePerStep } from '../src/harness/assemble';
import { planBeats, type Beat, type TourPlan } from '../src/harness/beats';
import { beatTargets, directOptions, directionSchema, lengthProblems, sayCap } from '../src/harness/direct';
import { checkExample } from '../src/harness/example';
import { cleanSolution, exerciseUnits, planUnits, unitSteps } from '../src/harness/exercise';
import { cleanUnitVisual } from '../src/harness/exercise-visual';
import {
  MAX_HIGHLIGHTS,
  MAX_PEN_MARKS,
  STEP_MAX_WORDS,
  answerNarrationProblems,
  answerStyleProblems,
  insightStep,
  narrationProblems,
  styleProblems,
} from '../src/harness/insight';
import { directTask } from '../src/harness/prompts';
import type { StepVisual } from '../src/harness/visual-plan';
import type { LineCheck } from '../src/harness/verify';
import { exampleSay, numericalExample } from './example-fixture';
import { HarnessTourGenerator } from './harness-fixture';
import { EXPLAIN, card, checkReply, direct, doc as paperDoc, input, planFor, provider, settings } from './plan-fixture';

// Tours that help understanding instead of cluttering it (TUTOR-RESEARCH 4.8): narration about the subject, one
// picture per step, and marks only where the narration names them.

// ------------------------------------------------------------------------------------------------------- narration

const problems = (say: string, board = true) => styleProblems(say, board);
const words = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');

test('narration about the tour’s own pictures is flagged in the five document languages', () => {
  const talk = [
    'The illustration shows three trigger branches that start the renewal.',
    'This diagram shows how the notice period runs.',
    'The board shows the fee, the deposit and the deadline.',
    'The chart shows rising costs over the term.',
    'As shown on the board, the costs add up.',
    'This illustrative example uses a deposit of two months.',
    'In this step we compare the two clauses.',
    "Let's look at the notice period.",
    'Let us take a look at the notice period.',
    'As you can see, the deposit is returned.',
    'Die Illustration zeigt drei Auslöser.',
    'Die Tafel zeigt die Kosten.',
    'Wie Sie sehen können, steigt die Miete.',
    'In diesem Schritt betrachten wir die Frist.',
    'In diesem Schritt betrachten Sie die Frist.',
    'Schauen wir uns die Frist an.',
    'Dieses illustrative Beispiel nimmt zwei Monate an.',
    "L'illustration montre trois déclencheurs.",
    'Ce schéma montre les coûts.',
    'Comme vous pouvez le voir, le dépôt est rendu.',
    'Dans cette étape, nous comparons les clauses.',
    'Regardons le délai de préavis.',
    'Cet exemple illustratif suppose deux mois.',
    'La ilustración muestra tres desencadenantes.',
    'El gráfico muestra los costes.',
    'La pizarra muestra los costes.',
    'Como puedes ver, el depósito se devuelve.',
    'En este paso vamos a comparar las cláusulas.',
    'Veamos el plazo de aviso.',
    'Este ejemplo ilustrativo supone dos meses.',
    "L'illustrazione mostra tre inneschi.",
    'Il grafico mostra i costi.',
    'La lavagna mostra i costi.',
    'Come puoi vedere, il deposito viene restituito.',
    'In questo passaggio confrontiamo le clausole.',
    'Guardiamo il termine di preavviso.',
    'Questo esempio illustrativo suppone due mesi.',
  ];
  for (const say of talk) {
    const found = problems(say);
    assert.equal(found.length, 1, say);
    assert.match(found[0], /^Narration talks about the tour's own pictures \("/, say);
  }
  // The feedback quotes what it found and says what to do instead; it never trims.
  assert.match(problems('As you can see, the board shows the fee.')[0], /"as you can see", "the board shows"/);
  assert.match(problems(talk[0])[0], /Speak about the subject itself/);
});

test('the paper’s own figures and tables, and ordinary words that contain these, stay unflagged', () => {
  for (const say of [
    'The figure shows the pipeline of the model, and the table lists the costs of each run.',
    'The dashboard shows live prices, while the boards of directors show little interest.',
    // Subject matter that happens to say what a board displays, not the tour's own board.
    'The rendering system builds an animation from geometric primitives. The board displays an example of the resulting layout.',
    'The illustrations in the report are by the author, who also drew the cover.',
    'Take a look at Table 2 for the full costs of the plan.',
    'In this step of the algorithm the pointer moves one cell to the right.',
    // "wie sie sehen" alone is "how they see"; "sie" is "they" or "it" unless it is the formal, capitalised "Sie".
    'Wir untersuchen, wie sie sehen lernen und was das für das Modell bedeutet.',
    'In diesem Schritt werden sie addiert, und die Summe bleibt gleich.',
    'The notice period starts on the day the landlord receives the letter.',
  ])
    assert.deepEqual(problems(say), [], say);
});

test('"the board shows" is the tour’s own board only in a step that draws one', () => {
  const say = 'The board shows strong support for the merger.';
  assert.equal(problems(say, true).length, 1);
  assert.deepEqual(problems(say, false), []);
  for (const other of [
    'As shown on the board, the costs add up.',
    'Die Tafel zeigt die Kosten.',
    'La lavagna mostra i costi.',
  ]) {
    assert.equal(problems(other, true).length, 1, other);
    assert.deepEqual(problems(other, false), [], other);
  }
  // The other pictures are the tour's own wherever they come up.
  assert.equal(problems('The illustration shows the costs.', false).length, 1);
});

test('condescending fillers are flagged; "clearly" and "simply" in their ordinary uses are not', () => {
  const fillers: [string, string][] = [
    ['Obviously the loss goes down once the rate is lowered.', 'obviously'],
    ['It is easy to see that the sum converges.', 'it is easy to see'],
    ["It's easy to see that the sum converges.", "it's easy to see"],
    ['This trivially holds for every positive input.', 'trivially'],
    ['Of course the deposit is returned at the end.', 'of course'],
    ['Clearly, the loss drops after the first epoch.', 'clearly'],
    ['Clearly the loss drops after the first epoch.', 'clearly'],
    ['The loss drops, clearly, after the first epoch.', 'clearly'],
    ['Simply multiply both sides by two.', 'simply'],
    ['We simply divide the total by the count.', 'simply'],
    ['Offensichtlich steigt die Miete mit dem Index.', 'offensichtlich'],
    ['Das gilt einfach nur für befristete Verträge.', 'einfach nur'],
    ['Das gilt trivialerweise für jede Zahl.', 'trivialerweise'],
    ['Natürlich ist die Frist kurz.', 'natürlich ist'],
    ['Évidemment, le dépôt est rendu à la fin.', 'évidemment'],
    ['Il est évident que le dépôt est rendu.', 'il est évident que'],
    ['Obviamente, el depósito se devuelve al final.', 'obviamente'],
    ['Es obvio que el depósito se devuelve.', 'es obvio que'],
    ['Ovviamente, il deposito viene restituito.', 'ovviamente'],
    ['È ovvio che il deposito viene restituito.', 'è ovvio che'],
  ];
  for (const [say, phrase] of fillers) {
    const found = problems(say);
    assert.equal(found.length, 1, say);
    assert.match(found[0], /^Narration uses a condescending filler/, say);
    assert.ok(found[0].includes(`"${phrase}"`), `${say} -> ${found[0]}`);
  }
  for (const say of [
    'A clearly defined threshold decides when the valve opens.',
    'Clearly defined terms matter in a contract.',
    'Clearly marked rows show the totals of each year.',
    'The authors explain the proof clearly and give three cases.',
    'A simply connected space has no holes, so every loop shrinks to a point.',
    'The beam is simply supported at both ends and carries the load evenly.',
    'The result is not simply a lookup but a computation over all rows.',
    // A name, in the middle of a sentence, after a title, or opening a sentence before another name.
    'The band Simply Red toured in 1985.',
    'Dr. Simply Jones proved the bound.',
    'Simply Jones proved the bound in her thesis.',
    'In the course of training the loss falls steadily.',
    'Natürliche Zahlen sind abgeschlossen unter Addition.',
  ])
    assert.deepEqual(problems(say), [], say);
});

test('a denied filler is no filler, and an idiom that contains one stays', () => {
  for (const say of [
    // Negations, in the five languages.
    'The bound is not obviously tight.',
    "It isn't obviously tight.",
    'Es ist nicht offensichtlich, dass die Folge konvergiert.',
    'Das ist nicht einfach nur eine Formalität.',
    'Ce n’est pas tout simplement une formalité.',
    'No es obvio que la suma converja.',
    'No es simplemente una consulta.',
    'Non è ovvio che la somma converga.',
    'Non è semplicemente una ricerca.',
    // Idioms that merely contain the word.
    'A change of course came after the first epoch.',
    'Costs rise as a matter of course when the term runs on.',
    'A reversal of course would reopen the question.',
    'Es fácil que la deuda crezca con los intereses.',
    'È facile che il costo salga con il tempo.',
    'Der Antrag ist offensichtlich unbegründet und wird abgewiesen.',
    'Die Klage ist offensichtlich unzulässig.',
  ])
    assert.deepEqual(problems(say), [], say);
  // Without the denial the same words are the filler.
  assert.equal(problems('The bound is obviously tight.').length, 1);
  assert.equal(problems('Es ist offensichtlich, dass die Folge konvergiert.').length, 1);
  assert.equal(problems('Es obvio que la suma converja.').length, 1);
});

test('empty comprehension checks are flagged; sentences that merely mention understanding are not', () => {
  for (const say of [
    'Do you understand why the gradient vanishes?',
    'Is that clear?',
    'The rate falls. Does that make sense?',
    'Any questions?',
    'Any questions about the deposit?',
    'Alles klar?',
    'Alles klar!',
    'Verstanden?',
    'Ist das klar?',
    'Noch Fragen?',
    'Gibt es noch Fragen?',
    'Habt ihr das verstanden?',
    'Haben Sie das verstanden?',
    "C'est clair ?",
    '¿Está claro?',
    'Alguna pregunta?',
    'È chiaro?',
    'Tutto chiaro?',
    'Ci sono domande?',
  ]) {
    const found = problems(say);
    assert.equal(found.length, 1, say);
    assert.match(found[0], /^Narration asks an empty comprehension check/, say);
  }
  for (const say of [
    'The authors answer any questions the reviewers raised in the appendix.',
    'Any questions about billing are answered by the support team.',
    'The paper asks whether the model can understand context at all.',
    'It is clear from Table 2 that costs rise with the term.',
    'Clear, short sentences keep a listener on track.',
    'Verstanden hat das Modell die Aufgabe nicht.',
    // The same words as a statement, in German, Spanish and Italian.
    'Im Vertrag ist alles klar geregelt.',
    'Ist das klar geregelt, entfällt die Nachfrage.',
    'Die Studie lässt noch Fragen offen.',
    'Gibt es Fragen zur Abrechnung, hilft der Support.',
    'Erst später haben sie verstanden, was gemeint war.',
    'Si tiene alguna pregunta, contacte con el banco.',
    'Ci sono domande aperte sul contratto.',
    'Il contratto rende tutto chiaro.',
  ])
    assert.deepEqual(problems(say), [], say);
});

test('only the decoder-padding checks refuse a narration; the style points and the length are asked for apart', () => {
  const padded = `Explain the mechanism in clean spoken words.`.padEnd(630, '​');
  assert.match(narrationProblems(`${padded} Obviously.`)[0], /invisible formatting/);
  assert.equal(narrationProblems(`${padded} Obviously.`).length, 1, 'the filler is not among them');
  assert.deepEqual(narrationProblems('As you can see, obviously, any questions?'), []);
  assert.deepEqual(narrationProblems(words(400)), []);
  // An answer step is the same: a filler never refuses it, and neither does a long step.
  assert.deepEqual(answerNarrationProblems([{ say: 'Of course, as you can see, the weights add up to one.' }], []), []);
  assert.deepEqual(answerNarrationProblems([{ say: words(95) }], []), []);
});

test('an answer’s style points are asked for apart, from the first step not yet spoken, and by step', () => {
  const board: Action = { type: 'board', item: { kind: 'formula', latex: 'x=1', terms: [] } };
  const steps = [
    { say: 'As you can see, the weights add up to one.' },
    { say: 'Of course the sum stays one.' },
    { say: 'The board shows strong support.', actions: [board] },
    { say: 'The board shows strong support.' },
  ];
  const found = answerStyleProblems(steps);
  assert.deepEqual(
    found.map((problem) => problem.slice(0, 7)),
    ['Step 1:', 'Step 2:', 'Step 3:'],
  );
  assert.match(found[0], /"as you can see"/);
  assert.match(found[1], /"of course"/);
  assert.deepEqual(
    answerStyleProblems(steps, 2).map((problem) => problem.slice(0, 7)),
    ['Step 3:'],
  );
  assert.deepEqual(answerStyleProblems([{ say: EXPLAIN }]), []);
});

// ------------------------------------------------------------------------------------------------------ the length

const beats = planBeats(card, paperDoc, 'standard');
const beat = (id: string) => beats.find((b) => b.id === id)!;

test('an overview is held to 60 words by one number, in the task, the schema and the length repair', () => {
  const overview = beat('method-1');
  assert.equal(STEP_MAX_WORDS, 60);
  assert.equal(directOptions(overview).words, STEP_MAX_WORDS);
  const schema: any = directionSchema(overview, beatTargets(overview, paperDoc));
  assert.equal(schema.properties.say.description, 'About 50-60 spoken words.');
  assert.match(directTask('en', 'BRIEF', directOptions(overview)), /"say" is 50-60 spoken words/);
  assert.equal(sayCap(overview), STEP_MAX_WORDS);
  assert.deepEqual(lengthProblems(words(60), overview), []);
  const long = lengthProblems(words(61), overview);
  assert.equal(long.length, 1);
  assert.match(long[0], /^This step is 61 spoken words; say it in at most 60\. Keep the point and the "because"/);
});

test('a worked case, a claim’s move, a slide and an adaptive step keep the range they are planned with', () => {
  const detail = { ...beat('formula-1'), detail: true };
  const claim: Beat = { ...beat('method-1'), say: [40, 80] };
  const slide: Beat = { ...beat('method-1'), say: [35, 120] };
  const adaptive: Beat = { ...beat('method-1'), flexibleNarration: true };
  assert.deepEqual(
    [detail, claim, slide].map((b) => directOptions(b).words),
    [140, 80, 120],
  );
  assert.deepEqual([detail, claim, slide, adaptive].map(sayCap), [161, 92, 138, Infinity]);
  assert.deepEqual(lengthProblems(words(140), detail), []);
  assert.equal(lengthProblems(words(162), detail).length, 1);
  assert.match(directTask('en', 'BRIEF', directOptions(detail)), /"say" is 90-140 spoken words/);
  assert.match(directTask('en', 'BRIEF', directOptions(claim)), /"say" is 40-80 spoken words/);
  assert.deepEqual(lengthProblems(words(400), adaptive), []);
});

// ---------------------------------------------------------------------------------------------- one picture per step

const bars = (...values: number[]): BoardItem => ({
  kind: 'bars',
  bars: values.map((value, i) => ({ label: `bar ${i + 1}`, value })),
});
const flow: BoardItem = {
  kind: 'flow',
  nodes: [
    { id: 'a', label: 'Notice' },
    { id: 'b', label: 'Renewal' },
  ],
  edges: [['a', 'b']],
};
const formula = (latex: string): BoardItem => ({ kind: 'formula', latex, terms: [] });
const board = (item: BoardItem, at_word?: number): Action => ({
  type: 'board',
  item,
  ...(at_word !== undefined ? { at_word } : {}),
});
const lit = (part: number, at_word: number): Action => ({ type: 'board_focus', part, at_word });
const step = (id: string, ...actions: Action[]): Step => ({ id, say: 'Some narration for this step.', actions });
const focus: Action = { type: 'focus', target: 'p1.s1' };
const kinds = (s: Step) => s.actions.flatMap((a) => (a.type === 'board' ? [a.item.kind] : []));
const highlights = (s: Step) => s.actions.filter((a) => a.type === 'highlight');

test('a step that mixes board kinds keeps none of them, with their focus cues, and each is recorded', () => {
  const contract = step(
    'costs',
    focus,
    board(bars(3, 1, 2)),
    lit(0, 1),
    { type: 'highlight', targets: ['p1.s1'], color: 'yellow', at_word: 2 },
    board(flow, 5),
    lit(1, 6),
    board(formula('c = f + d'), 9),
    lit(0, 10),
  );
  const { steps, extra } = onePicturePerStep([[contract]]);
  // Not the first picture alone: the narration speaks of all of them and the result is in the last.
  assert.deepEqual(steps[0][0].actions, [
    focus,
    { type: 'highlight', targets: ['p1.s1'], color: 'yellow', at_word: 2 },
  ]);
  assert.equal(steps[0][0].say, contract.say);
  assert.deepEqual(extra, [
    { step: 'costs', kind: 'bars' },
    { step: 'costs', kind: 'flow' },
    { step: 'costs', kind: 'formula' },
  ]);
  assert.equal(contract.actions.length, 8, 'the authored step is not changed');
});

test('successive frames of one kind stay with every focus cue; a different kind among them takes the example whole', () => {
  const builds = step(
    'builds',
    focus,
    board(bars(1, 2)),
    lit(0, 1),
    board(bars(2, 4), 4),
    lit(1, 5),
    board(bars(4, 8), 8),
  );
  const same = onePicturePerStep([[builds]]);
  assert.equal(same.steps[0][0], builds, 'nothing to drop, the step is returned as it is');
  assert.deepEqual(same.extra, []);
  const between = step('between', board(bars(1, 2)), board(flow, 3), lit(0, 4), board(bars(2, 4), 6), lit(1, 7));
  const mixed = onePicturePerStep([[between]]);
  assert.deepEqual(mixed.steps[0][0].actions, []);
  assert.deepEqual(
    mixed.extra.map((d) => d.kind),
    ['bars', 'flow', 'bars'],
  );
});

test('a worked example is written in one kind of board, so that none has to be cut', () => {
  // The flow and then its result as a formula card: two pictures, sent back to be rewritten in one.
  const mixed = {
    ...numericalExample(),
    frames: [
      numericalExample().frames[0],
      {
        anchor: 'Adding the input twice',
        formula: { title: 'Illustrative result', latex: '2+2=4', terms: [{ latex: '2+2', label: 'Sum' }] },
      },
    ],
  };
  const refused = checkExample(mixed, exampleSay);
  assert.ok(!refused.example);
  assert.match(refused.problems.join(' '), /must all be one kind of board, but these are flow and formula/);
  assert.match(refused.problems.join(' '), /rewrite every frame in it, together with the narration/);
  // The same case in one kind, with the result in the last frame, is accepted.
  const ok = checkExample(numericalExample(), exampleSay);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(
    ok.example!.frames.map((frame) => frame.item.kind),
    ['flow', 'flow'],
  );
});

test('a board that repeats an earlier step is dropped, recorded apart from the boards cut for mixing kinds', () => {
  const first = step('first', board(bars(5, 6)));
  const again = step('again', board(bars(5, 6)), lit(0, 1), { type: 'highlight', targets: ['p1.s1'], color: 'yellow' });
  const result = dropRepeatedBoards([[first], [again]]);
  assert.deepEqual(result.steps[1][0].actions, [{ type: 'highlight', targets: ['p1.s1'], color: 'yellow' }]);
  assert.deepEqual(result.dropped, [{ step: 'again', kind: 'bars', repeats: 'first' }]);
  assert.deepEqual(result.extra, []);
  const mixed = step('mixed', board(flow), lit(0, 2), board(formula('y = 2'), 8), lit(0, 9));
  const both = dropRepeatedBoards([[first], [mixed]]);
  assert.deepEqual(both.steps[1][0].actions, []);
  assert.deepEqual(both.dropped, [], 'a cut board is no repeat');
  assert.deepEqual(both.extra, [
    { step: 'mixed', kind: 'flow' },
    { step: 'mixed', kind: 'formula' },
  ]);
});

test('a board cut from a mixed step is shown nowhere, so a later step that shows it is no repeat', () => {
  const sum = formula('2+2=4');
  const mixed = step('beat-0', focus, board(flow), board(sum, 8));
  const later = step('beat-1', focus, board(sum));
  const result = dropRepeatedBoards([[mixed], [later]]);
  assert.deepEqual(kinds(result.steps[0][0]), []);
  assert.deepEqual(kinds(result.steps[1][0]), ['formula'], 'the formula is on screen once, in the later step');
  assert.deepEqual(result.dropped, []);
  assert.deepEqual(
    result.extra.map((d) => d.kind),
    ['flow', 'formula'],
  );
  // The exercise beats are neither compared nor remembered.
  const exempt = dropRepeatedBoards([[mixed], [later]], new Set([0]));
  assert.deepEqual(kinds(exempt.steps[0][0]), ['flow', 'formula']);
  assert.deepEqual(exempt.extra, []);
});

// The compact form of an exercise part: the method visual, then the first solution line.
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
const sheet = makeDoc(
  [
    ['p1.b2', 'paragraph', { 'p1.s2': 'Problem 1' }],
    [
      'p1.b3',
      'paragraph',
      { 'p1.s3': 'A test finds 99 of every 100 sick people and wrongly flags 1 of every 100 healthy people.' },
    ],
    ['p1.b4', 'paragraph', { 'p1.s4': 'One person in 100 is sick.' }],
    ['p1.b5', 'paragraph', { 'p1.s5': 'a) A person tests positive. What is the probability that the person is sick?' }],
    ['p1.b6', 'paragraph', { 'p1.s6': 'b) How many of 10000 people test positive?' }],
  ],
  [
    {
      id: 'ex1',
      number: '1',
      page: 1,
      block: 'p1.b2',
      blocks: ['p1.b2', 'p1.b3', 'p1.b4', 'p1.b5', 'p1.b6'],
      parts: [
        { id: 'ex1.a', label: 'a', page: 1, blocks: ['p1.b5'] },
        { id: 'ex1.b', label: 'b', page: 1, blocks: ['p1.b6'] },
      ],
    },
  ],
);
const term = (latex: string, label: string, anchor: string) => ({ latex, label, anchor });
const METHOD =
  'We count natural frequencies: out of ten thousand people, look at the sick people and at the healthy people separately.';
const solution = () => ({
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
    latex: 'P = 0.5',
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
});
const ok: LineCheck = { status: 'ok' };
const planned: StepVisual = {
  visual: 'heatmap',
  idea: 'Ten thousand people sorted.',
  data: '10000 people; illustrative',
};
const grid = {
  kind: 'heatmap',
  title: 'Natural frequencies, 10000 people',
  rows: ['sick', 'healthy'],
  cols: ['positive', 'negative'],
  values: [
    [99, 1],
    [99, 9801],
  ],
  source: 'illustrative',
};
const compact = planUnits(exerciseUnits(sheet), 'quick').taught.find((u) => u.id === 'ex1.a')!;
const solved = cleanSolution(solution(), compact, sheet).solution!;
const drawn = cleanUnitVisual(
  { plan: 'p', heatmap: grid, focus: [{ target: 'row-1', anchor: 'the sick people' }] },
  'heatmap',
  compact,
  sheet,
  solved,
  planned,
).visual!;
const exercise = unitSteps(compact, solved, [ok, ok, ok], 'en-US', drawn);

test('the compact exercise form keeps its method visual followed by its formula line', () => {
  assert.equal(compact.form, 'compact');
  const opening = exercise.find((s) => kinds(s).length > 1)!;
  assert.deepEqual(kinds(opening), ['heatmap', 'formula'], 'the form the exercise tour builds on purpose');
  // Exercise beats are exempt, so the visual and its line stay, whatever else the tour does to a step.
  const kept = onePicturePerStep([exercise], new Set([0]));
  assert.equal(kept.steps[0], exercise);
  assert.deepEqual(kept.extra, []);
  // The same two boards in a paper step are two pictures: it keeps neither, and says so.
  const paper = onePicturePerStep([[opening]]);
  assert.deepEqual(kinds(paper.steps[0][0]), []);
  assert.deepEqual(
    paper.extra.map((d) => d.kind),
    ['heatmap', 'formula'],
  );
});

test('assembling a tour holds a paper step to one picture, also when the repeat check does not run, and spares exercises', () => {
  const plan: TourPlan = {
    type: 'research_paper',
    chapters: [{ id: 'method', title: 'Method' }],
    beats: [
      { id: 'method-1', kind: 'method', arc: 'method', point: 'The method.', evidence: [] },
      { id: 'exercise-ex1.a', kind: 'exercise', arc: 'method', point: 'Part a', evidence: [], unit: compact },
    ] satisfies Beat[],
  };
  const crowded = step('method-1', focus, board(bars(1, 2)), board(flow, 4), lit(0, 5), board(formula('z = 1'), 8));
  const tour = assembleTour(
    { title: 'T', suggested_questions: [] } as never,
    plan,
    [[crowded], exercise],
    sheet,
    'doc',
    'en-US',
    'standard',
  );
  const all = tour.chapters.flatMap((c) => c.steps);
  assert.deepEqual(kinds(all[0]), []);
  assert.ok(!all[0].actions.some((a) => a.type === 'board_focus'));
  const exerciseKinds = all.slice(1).map(kinds);
  assert.deepEqual(exerciseKinds, exercise.map(kinds));
  // The exercise's given, asked and circled marks are all still there.
  assert.ok(highlights(exercise[0]).length >= 2 && highlights(exercise.at(-1)!).length >= 1);
  assert.deepEqual(all.slice(1).flatMap(highlights), exercise.flatMap(highlights));
});

// ------------------------------------------------------------------------------------------------------- the marks

const doc = makeDoc(
  [
    ['p1.b0', 'paragraph', { 'p1.s1': 'The first claim.', 'p1.s2': 'Its second sentence.' }],
    ['p1.b1', 'paragraph', { 'p1.s3': 'A third sentence.' }],
    ['p1.b2', 'paragraph', { 'p1.s4': 'The fourth.', 'p1.s5': 'The fifth.' }],
  ],
  [],
);
const light = (targets: string[], at_word?: number): Action => ({
  type: 'highlight',
  targets,
  color: 'yellow',
  ...(at_word !== undefined ? { at_word } : {}),
});
const say = 'One two three four five six seven eight nine ten eleven twelve.';
const marked = (...actions: Action[]): Step => ({ id: 's', say, actions });

test('a step keeps at most three highlights, the ones whose words come first', () => {
  assert.equal(MAX_HIGHLIGHTS, 3);
  const crowded = marked(
    focus,
    light(['p1.s5'], 9),
    light(['p1.s1'], 1),
    light(['p1.s4'], 7),
    light(['p1.s3'], 4),
    light(['p1.s2'], 11),
  );
  const result = insightStep(crowded, doc);
  assert.deepEqual(result.actions, [focus, light(['p1.s1'], 1), light(['p1.s4'], 7), light(['p1.s3'], 4)]);
  assert.equal(crowded.actions.length, 6, 'the authored step is not changed');
  // Three or fewer are left exactly as they are.
  const fine = marked(focus, light(['p1.s1'], 1), light(['p1.s3'], 4), light(['p1.s4'], 7));
  assert.deepEqual(insightStep(fine, doc).actions, fine.actions);
});

test('a sentence is highlighted once in a step: later duplicates go, a partly repeated highlight keeps its new sentences', () => {
  const result = insightStep(
    marked(
      focus,
      light(['p1.s1'], 1),
      light(['p1.s1'], 5),
      light(['p1.s1', 'p1.s2'], 8),
      light(['p1.s2', 'p1.s2'], 10),
    ),
    doc,
  );
  assert.deepEqual(result.actions, [focus, light(['p1.s1'], 1), light(['p1.s2'], 8)]);
  // A prose spotlight becomes a highlight, and does not double an explicit highlight of the same sentence.
  const spot = insightStep(marked(light(['p1.s3'], 2), { type: 'spotlight', target: 'p1.s3', at_word: 6 }), doc);
  assert.deepEqual(spot.actions, [light(['p1.s3'], 2)]);
});

test('a highlight does not repeat what a box or spotlight in the step already outlines', () => {
  const box: Action = { type: 'box', target: 'p1.b0', color: 'blue', at_word: 0 };
  const covered = insightStep(marked(box, light(['p1.s1', 'p1.s3'], 3), light(['p1.s2'], 6)), doc);
  assert.deepEqual(covered.actions, [box, light(['p1.s3'], 3)], 'p1.s1 and p1.s2 are in the outlined block');
  const own = insightStep(marked({ type: 'box', target: 'p1.s4', color: 'blue' }, light(['p1.s4'], 2)), doc);
  assert.deepEqual(own.actions, [{ type: 'box', target: 'p1.s4', color: 'blue' }]);
  // A box on a region marks part of the block, and a spotlight on a figure is not text: the highlights stay.
  const part: Action = { type: 'box', target: 'p1.b0', region: [0, 0, 0.5, 0.5], color: 'blue' };
  assert.deepEqual(insightStep(marked(part, light(['p1.s1'], 3)), doc).actions, [part, light(['p1.s1'], 3)]);
  const figure: Action = { type: 'spotlight', target: 'fig1' };
  assert.deepEqual(insightStep(marked(figure, light(['p1.s1'], 3)), doc).actions, [figure, light(['p1.s1'], 3)]);
});

test('a step draws at most two pen marks, the first ones; boxes are not pen marks', () => {
  assert.equal(MAX_PEN_MARKS, 2);
  const pen = (type: 'arrow' | 'circle', at_word: number): Action => ({ type, target: 'fig1', color: 'blue', at_word });
  const box = (at_word: number): Action => ({ type: 'box', target: 'fig1', color: 'blue', at_word });
  const crowded = marked(pen('circle', 9), box(1), pen('arrow', 2), pen('arrow', 5), box(3), pen('circle', 7));
  assert.deepEqual(insightStep(crowded, doc).actions, [box(1), pen('arrow', 2), pen('arrow', 5), box(3)]);
  const fine = marked(pen('arrow', 2), pen('circle', 5), box(3));
  assert.deepEqual(insightStep(fine, doc).actions, fine.actions);
});

// ------------------------------------------------------------------------------------------------------- the prompt

test('the direction task says the same rules in a few lines and keeps the word range of every other step', () => {
  const task = (options: Partial<Parameters<typeof directTask>[2]> = {}) =>
    directTask('en', 'BRIEF', {
      actions: ['highlight', 'box', 'arrow', 'circle', 'board_focus'],
      words: STEP_MAX_WORDS,
      ...options,
    });
  const overview = task();
  assert.match(overview, /Speak about the subject, never about the tour: no "the board shows", "as you can see"/);
  assert.match(overview, /One picture per step: one board, or the frames of one example in one kind of board/);
  assert.match(overview, /at most 3 highlights and 2 pen marks, none on text a box already covers/);
  assert.match(overview, /"say" is 50-60 spoken words/);
  // The worked-example rule in the same request says the same: one kind for all the frames.
  assert.match(overview, /ALL of ONE kind of board/);
  // A step with a range of its own, a detail with a worked case and a natural-length step keep theirs.
  assert.match(task({ fewest: 70, words: 100 }), /"say" is 70-100 spoken words/);
  assert.match(task({ detail: true, words: 140 }), /"say" is 90-140 spoken words/);
  const natural = task({ flexibleNarration: true });
  assert.match(natural, /natural length it needs/);
  assert.doesNotMatch(natural, /"say" is \d+-\d+ spoken words|Infinity/);
  assert.match(natural, /Speak about the subject/);
  // The rules replaced older text of the same kind rather than adding to it (visual-rules.test.ts keeps the same budget).
  const plain = directTask('en', 'BRIEF', { actions: ['highlight', 'board_focus'], words: 120 });
  assert.ok(plain.length < 19_700, `${plain.length} characters`);
});

// ----------------------------------------------------------------------------------------- the rules in a whole tour

const steps = (tour: { chapters: { steps: Step[] }[] }) => tour.chapters.flatMap((c) => c.steps);
const wanted = (request: { task: string }) => request.task.includes('STEP KIND: problem');
const flagged = `As you can see, a fixed dose gives wet corners the same water as dry ones. The fixed schedule wastes it twice.`;
const clean = `A fixed dose gives wet corners the same water as dry ones, so the fixed schedule wastes it twice: in the pump bill and in the roots.`;

/** A model whose problem step answers from the list, one reply per call (the last repeats); every other step explains. */
function narrator(problem: string[], seen: { task: string }[] = []) {
  let calls = 0;
  return (request: Parameters<Parameters<typeof provider>[0]>[0]) => {
    if (request.name === 'paper_card') return card;
    if (['visual_plan', 'opening_visual'].includes(request.name)) return planFor(request);
    if (request.name === 'quick_check') return checkReply(request, { fits: false });
    seen.push(request);
    const cue = request.schema.properties.cues.items.properties;
    const say = wanted(request) ? problem[Math.min(calls++, problem.length - 1)] : EXPLAIN;
    const target = cue.target.enum?.[0];
    return {
      plan: 'p',
      say,
      cues: target ? [{ action: cue.action.enum[0], target, label: '', anchor: 'a fixed dose' }] : [],
    };
  };
}
const generate = (model: (request: any) => unknown, events: { type: string; data: any }[] = []) =>
  new HarnessTourGenerator(settings, 'standard', provider(model)).generate({
    ...input,
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });

test('a step that talks about its own picture is sent back once, and a reply that still does is kept', async () => {
  const seen: { task: string }[] = [];
  const events: { type: string; data: any }[] = [];
  const { tour, metadata } = await generate(narrator([flagged, clean], seen), events);
  assert.equal(seen.filter(wanted).length, 2);
  assert.ok(seen.filter(wanted)[1].task.includes('Narration talks about the tour\'s own pictures ("as you can see")'));
  assert.equal(steps(tour)[0].say, clean);
  assert.ok(
    events.some((e) => e.type === 'beat.guarded' && e.data.problems.some((p: string) => /own pictures/.test(p))),
  );
  // The repair is asked once: the reply that still talks about the picture is the step, not a reason to refuse it.
  const stubborn = await generate(narrator([flagged, flagged]));
  assert.equal(steps(stubborn.tour)[0].say, flagged);
  assert.deepEqual((stubborn.metadata as { fallbackBeats: string[] }).fallbackBeats, []);
  assert.deepEqual((metadata as { degraded: unknown[] }).degraded, []);
});

test('a step that mixes kinds in its worked example is sent back, and one that stays mixed is dropped and flagged', async () => {
  const mixed = {
    ...numericalExample(),
    frames: [
      numericalExample().frames[0],
      {
        anchor: 'Adding the input twice',
        formula: { title: 'Illustrative result', latex: '2+2=4', terms: [{ latex: '2+2', label: 'Sum' }] },
      },
    ],
  };
  let formulaCalls = 0;
  const events: { type: string; data: any }[] = [];
  const model = (request: any) => {
    if (request.name === 'paper_card') return card;
    if (['visual_plan', 'opening_visual'].includes(request.name))
      return planFor(request, (id) =>
        id === 'formula-1' ? { visual: 'formula', idea: 'Add the input.', data: 'illustrative' } : 'none',
      );
    if (request.name === 'quick_check') return checkReply(request, { fits: false });
    if (request.task.includes('STEP KIND: formula')) {
      formulaCalls++;
      return direct(request, exampleSay, { example: formulaCalls === 1 ? mixed : numericalExample() });
    }
    return direct(request, EXPLAIN);
  };
  const { tour, metadata } = await generate(model, events);
  assert.equal(formulaCalls, 2, 'the second reply is in one kind');
  const failed = events.find((e) => e.type === 'validation.failed' && e.data.beat === 'formula-1');
  assert.match(String(failed?.data.problems), /must all be one kind of board/);
  const formulaStep = steps(tour).find((s) => s.id === 'formula-1')!;
  assert.deepEqual(
    formulaStep.actions.flatMap((a) => (a.type === 'board' ? [a.item.kind] : [])),
    ['flow', 'flow'],
  );
  assert.deepEqual((metadata as { degraded: unknown[] }).degraded, []);
  // A writer that keeps mixing them loses the example, visibly, and the step keeps its narration.
  const loss: { type: string; data: any }[] = [];
  const stuck = await generate((request) => {
    if (request.name === 'beat_direction' && request.task.includes('STEP KIND: formula'))
      return direct(request, exampleSay, { example: mixed });
    return model(request);
  }, loss);
  const bare = steps(stuck.tour).find((s) => s.id === 'formula-1')!;
  assert.equal(bare.say, exampleSay);
  assert.ok(!bare.actions.some((a) => a.type === 'board' || a.type === 'board_focus'));
  const dropped = (stuck.metadata as { degraded: { beat: string; dropped: string[]; problems: string[] }[] }).degraded;
  assert.deepEqual(
    dropped.filter((d) => d.beat === 'formula-1').map((d) => d.dropped),
    [['example']],
  );
  assert.match(dropped[0].problems.join(' '), /must all be one kind of board/);
  assert.ok(loss.some((e) => e.type === 'beat.degraded' && e.data.beat === 'formula-1'));
});

// --------------------------------------------------------------------------------------------- an answer, not refused

const NO_BOARD = {
  kind: 'none',
  title: '',
  latex: '',
  terms: [],
  nodes: [],
  bars: [],
  unit: '',
  higher_is_better: true,
};
const answering = (steps: string[], replies: { calls: number } = { calls: 0 }) =>
  answerQuestion({
    client: new MuseClient(
      settings,
      provider(() => {
        const say = steps[Math.min(replies.calls++, steps.length - 1)];
        return { plan: 'p', answerable: 'yes', steps: [{ say, cues: [], board: NO_BOARD }], followups: [] };
      }),
    ),
    measureFigure: async () => [],
    doc: paperDoc,
    documentId: 'doc-test',
    request: { question: 'Why use probes?' },
    language: 'en-US',
  });

test('an answer that talks about its picture or uses a filler is asked to polish once, and is never refused for it', async () => {
  const OF_COURSE = `Of course, ${clean}`;
  const replies = { calls: 0 };
  const polished = await answering([OF_COURSE, clean], replies);
  assert.equal(replies.calls, 2);
  assert.equal(polished.answer.steps[0].say, clean);
  // A reply that keeps the filler is accepted after that one repair, not turned into a failed answer.
  const stubborn = { calls: 0 };
  const kept = await answering([OF_COURSE], stubborn);
  assert.equal(stubborn.calls, 2);
  assert.equal(kept.answer.steps[0].say, OF_COURSE);
  // Without a style point there is nothing to ask for.
  const quiet = { calls: 0 };
  await answering([clean], quiet);
  assert.equal(quiet.calls, 1);
});
