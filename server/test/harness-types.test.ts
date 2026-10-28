import test from 'node:test';
import assert from 'node:assert/strict';
import type { MuseConfig } from '../src/config';
import type { Action, BBox, BlockType, Doc, DocExercise, Step, Tour } from '../../shared/paper';
import type { TourGenerationInput, TourImage } from '../src/tour-generator';
import { HarnessTourGenerator } from './harness-fixture';
import { ARC_SPECS, arcTourPlan, fallbackArcPlan } from '../src/harness/arcs';
import { findAnchor } from '../src/harness/assemble';
import { checkFormula } from '../src/harness/board';
import { guessType } from '../src/harness/doctype';
import {
  SOLVE_EXAMPLE,
  cleanSolution,
  exercisePlan,
  exerciseUnits,
  planUnits,
  unitOverhead,
} from '../src/harness/exercise';
import { paperBlock, proseSentences, taskName } from '../src/harness/paper-block';
import { pythonVerifier, readChecks, type LineCheck, type MathVerifier } from '../src/harness/verify';

// Document types end to end with a scripted model (no network): what the card says the document is chooses the arc,
// the tone and the board; an exercise sheet is solved part by part, checked by a verifier, and taught on the board.

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

/** A one-column document: each block is [id, type, sentences as {id: text}] in reading order. */
function makeDoc(
  title: string,
  pages: number,
  blocks: [string, BlockType, Record<string, string>, string?][],
  extra: Partial<Doc> = {},
): Doc {
  return {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'doc.pdf', sha256: 'd'.repeat(64), num_pages: pages, generator: 'test', title },
    pages: Array.from({ length: pages }, (_, i) => ({ n: i + 1, width: 600, height: 800 })),
    sections: [],
    blocks: blocks.map(([id, type, sentences, text], i) => ({
      id,
      page: Number(id.slice(1, id.indexOf('.'))),
      type,
      bbox: rect(40 + 20 * i),
      text: text ?? Object.values(sentences).join(' '),
      sentences: Object.keys(sentences),
    })),
    sentences: blocks.flatMap(([id, , sentences], i) =>
      Object.entries(sentences).map(([sid, text]) => ({
        id: sid,
        page: Number(id.slice(1, id.indexOf('.'))),
        block: id,
        text,
        rects: [rect(40 + 20 * i)],
      })),
    ),
    figures: [],
    equations: [],
    ...extra,
  };
}
const pageImages = (doc: Doc): TourImage[] =>
  doc.pages.map((p) => ({ targetId: `page${p.n}`, kind: 'page', page: p.n, label: `Page ${p.n}`, dataUrl: png }));
const input = (doc: Doc): TourGenerationInput => ({
  documentId: 'doc',
  analysisId: 'a',
  doc,
  images: [
    ...pageImages(doc),
    ...doc.figures.map((f) => ({
      targetId: f.id,
      kind: f.kind,
      page: f.page,
      label: `Figure ${f.number}`,
      dataUrl: png,
    })),
  ],
});

const titles = {
  problem: 'What it is',
  idea: 'Idea',
  method: 'How',
  evidence: 'Facts',
  limits: 'Catches',
  takeaway: 'Remember',
};
const item = (text: string, ...evidence: string[]) => ({ text, evidence });
function cardFor(type: string, evidence: string[]) {
  const [first, second, last] = [evidence[0], evidence[1] ?? evidence[0], evidence.at(-1)!];
  return {
    plan: 'p',
    doc_type: type,
    title: 'A guided tour',
    chapter_titles: titles,
    problem: item('What the document is about.', first),
    key_idea: item('Its main point.', second),
    method_steps: [item('How it works.', second)],
    key_figures: [],
    key_formulas: [],
    results: [],
    limitations: [item('A catch.', last)],
    takeaway: item('What to remember.', last),
    suggested_questions: ['What does it cost?', 'When can I leave?', 'What if I pay late?'],
  };
}

type Request = { name: string; schema: any; brief: string; task: string; images: number };
type Model = (r: Request) => unknown;
function provider(model: Model, requests: Request[]): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const parts = (content: any) => (typeof content === 'string' ? [{ type: 'text', text: content }] : content);
    const texts: string[] = body.messages.flatMap((m: any) => parts(m.content).map((p: any) => p.text ?? ''));
    const last = body.messages.at(-1);
    const request: Request = {
      name: body.response_format.json_schema.name,
      schema: body.response_format.json_schema.schema,
      brief: texts.find((t) => t.startsWith('TASK:') && !t.startsWith('TASK: understand')) ?? '',
      task: texts.join('\n'),
      images: body.messages.flatMap((m: any) => parts(m.content)).filter((p: any) => p.type === 'image_url').length,
    };
    requests.push(request);
    void last;
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(model(request)) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  }) as typeof fetch;
}
const SAY =
  'This step explains the point clearly so that the reader can follow every part of it while the page moves along.';
/** A direction with one highlight of the first offered sentence, anchored in SAY. */
function plainDirection(r: Request, extra: object = {}) {
  const cue = r.schema.properties.cues.items.properties;
  const target = cue.target.enum?.find((id: string) => /^p\d/.test(id));
  const cues = target ? [{ action: 'highlight', target, label: '', anchor: 'explains the point' }] : [];
  return { plan: 'p', say: SAY, cues, ...extra };
}
/** All native schemas are available now; this scripted author follows the planner's
 * suggested board for these document-type fixtures instead of inferring it from availability. */
function suggestedBoard(r: Request): 'bars' | 'flow' | 'formula' | undefined {
  const suggestion = /^BOARD(?: \([^)]*\))?: (.+)$/m.exec(r.brief)?.[1] ?? '';
  if (suggestion.includes('as bars')) return 'bars';
  if (suggestion.includes('a flow')) return 'flow';
  if (suggestion.includes('equation term by term')) return 'formula';
  return undefined;
}
const steps = (tour: Tour) => tour.chapters.flatMap((c) => c.steps);
const types = (step: Step) => step.actions.map((a: Action) => a.type);

async function run(
  doc: Doc,
  model: Model,
  verifier?: MathVerifier,
  preset: 'quick' | 'standard' | 'deep' = 'standard',
) {
  const requests: Request[] = [];
  const generator = new HarnessTourGenerator(settings, preset, provider(model, requests), verifier);
  const result = await generator.generate(input(doc));
  return {
    ...result,
    requests,
    steps: steps(result.tour),
    step: (id: string) => steps(result.tour).find((s) => s.id === id)!,
  };
}

// ------------------------------------------------------------------------------------------------ contract

const lease = makeDoc('Residential Lease Agreement', 2, [
  ['p1.b1', 'title', { 'p1.s1': 'Residential Lease Agreement' }],
  [
    'p1.b2',
    'authors',
    { 'p1.s2': 'This lease is made between Northbank Homes Ltd. (the Landlord) and Jordan Lee (the Tenant).' },
  ],
  ['p1.b3', 'paragraph', { 'p1.s3': 'The Tenant rents the flat at 7 Elm Court as a private home.' }],
  [
    'p1.b4',
    'paragraph',
    { 'p1.s4': 'The monthly rent is EUR 950.', 'p1.s5': 'The Tenant also pays EUR 180 a month for heating.' },
  ],
  ['p1.b5', 'paragraph', { 'p1.s6': 'The security deposit is EUR 2,850.' }],
  ['p1.b6', 'paragraph', { 'p1.s7': 'The tenancy starts on 1 November 2026 and runs for at least 12 months.' }],
  ['p2.b1', 'paragraph', { 'p2.s1': 'After that, the Tenant may end it with three months notice.' }],
  ['p2.b2', 'paragraph', { 'p2.s2': 'A payment more than ten days late costs a fee of EUR 40.' }],
]);
const leasePlan = {
  plan: 'p',
  chapter_titles: {
    overview: 'The deal',
    terms: 'You agree to',
    costs: 'What it costs',
    deadlines: 'Dates',
    risks: 'Watch out',
    takeaway: 'Before you sign',
  },
  overview: [item('A lease between Northbank Homes and Jordan Lee for a flat at 7 Elm Court.', 'p1.s2', 'p1.s3')],
  terms: [item('You rent the flat only as your private home.', 'p1.s3')],
  costs: [
    item('The rent is EUR 950 a month plus EUR 180 for heating.', 'p1.s4', 'p1.s5'),
    item('The deposit is EUR 2,850.', 'p1.s6'),
  ],
  deadlines: [
    item('It starts on 1 November 2026 and runs at least 12 months.', 'p1.s7'),
    item('Then three months notice ends it.', 'p2.s1'),
  ],
  risks: [item('Paying more than ten days late costs EUR 40.', 'p2.s2')],
  takeaway: [item('Budget for rent, heating and the deposit, and mind the notice period.', 'p1.s4', 'p2.s1')],
  disclaimer: 'This tour explains the lease in plain words; it is not legal advice.',
};
const COSTS = {
  title: 'Money you pay',
  unit: 'EUR',
  higher_is_better: false,
  bars: [
    { label: 'Monthly rent', value: 950 },
    { label: 'Heating per month', value: 180 },
    { label: 'Deposit', value: 2850 },
  ],
};
const TIMELINE = {
  title: 'From start to end',
  nodes: [
    { id: 'node-1', label: 'Starts 1 Nov 2026' },
    { id: 'node-2', label: '12-month minimum' },
    { id: 'node-3', label: '3 months notice' },
  ],
  edges: [
    { from: 'node-1', to: 'node-2' },
    { from: 'node-2', to: 'node-3' },
  ],
};
function leaseModel(r: Request) {
  if (r.name === 'paper_card') return cardFor('contract', ['p1.s2', 'p1.s3', 'p2.s2']);
  if (r.name === 'tour_plan') return leasePlan;
  if (suggestedBoard(r) === 'bars') return plainDirection(r, { bars: COSTS });
  if (suggestedBoard(r) === 'flow') return plainDirection(r, { flow: TIMELINE });
  return plainDirection(r);
}

test('a contract follows what you agree to, what it costs, its deadlines and its risks, framed as no legal advice', async () => {
  const { tour, steps: all, requests, metadata } = await run(lease, leaseModel);
  assert.equal(metadata.docType, 'contract');
  assert.equal(metadata.planSource, 'model');
  assert.deepEqual(
    tour.chapters.map((c) => `${c.id}:${c.title}`),
    [
      'overview:The deal',
      'terms:You agree to',
      'costs:What it costs',
      'deadlines:Dates',
      'risks:Watch out',
      'takeaway:Before you sign',
    ],
  );
  assert.equal(all.length, 8);
  // The parties' sentence sits in what ingestion took for an author block; outside papers it is content to cite.
  const card = requests.find((r) => r.name === 'paper_card')!;
  assert.equal(card.schema.properties.problem.properties.evidence.items.$ref, '#/$defs/evidenceId');
  assert.ok(card.schema.$defs.evidenceId.enum.includes('p1.s2'));
  assert.deepEqual(card.schema.properties.doc_type.enum, [
    'research_paper',
    'exercise_sheet',
    'lecture',
    'contract',
    'letter',
    'other',
  ]);
  // The plan call offers the contract's arc and asks for the disclaimer; directions speak to someone about to sign.
  const plan = requests.find((r) => r.name === 'tour_plan')!;
  assert.deepEqual(Object.keys(plan.schema.properties), [
    'plan',
    'chapter_titles',
    'overview',
    'terms',
    'costs',
    'deadlines',
    'risks',
    'takeaway',
    'disclaimer',
  ]);
  assert.equal(plan.schema.properties.costs.maxItems, 2);
  const directions = requests.filter((r) => r.name === 'beat_direction');
  assert.ok(directions.every((r) => r.brief.includes('someone who is about to sign')));
  assert.ok(directions.some((r) => r.brief.includes('THIS STEP OF THE TOUR: risks and catches')));
  // First and last steps say it is no legal advice; the first step's cues move on by the disclaimer's words.
  const disclaimer = leasePlan.disclaimer;
  assert.ok(all[0].say.startsWith(`${disclaimer} ${SAY}`));
  assert.ok(all.at(-1)!.say.endsWith(` ${disclaimer}`));
  const highlight = all[0].actions.find((a) => a.type === 'highlight')!;
  assert.equal(highlight.at_word, findAnchor(all[0].say, 'explains the point'));
  assert.deepEqual(all[0].actions[0], { type: 'focus', target: 'p1.s2' });
  // Costs: one chart of every amount in the chapter, from the sentences of both cost points; deadlines: a timeline.
  const cost = all.find((s) => s.id === 'point-2')!;
  const bars = cost.actions.find((a) => a.type === 'board');
  assert.equal(bars?.type === 'board' && bars.item.kind === 'bars' && bars.item.bars.length, 3);
  const costBrief = directions.find((r) => r.brief.includes('POINT TO MAKE: The rent is EUR 950'))!.brief;
  assert.match(costBrief, /MORE NUMBERS FOR THE BARS ONLY .*:\n\[p1\.s6\] The security deposit is EUR 2,850\./);
  // Each point knows what the other points of its chapter say, so it does not repeat them.
  assert.match(costBrief, /OTHER STEPS IN THIS CHAPTER \(leave their points to them\): The deposit is EUR 2,850\./);
  assert.deepEqual(types(all.find((s) => s.id === 'point-3')!).slice(0, 2), ['focus', 'board_clear']);
  const deadline = all.find((s) => s.id === 'point-4')!;
  assert.ok(deadline.actions.some((a) => a.type === 'board' && a.item.kind === 'flow'));
  assert.equal(tour.level, 'intro');
  assert.deepEqual(tour.suggested_questions, cardFor('contract', ['p1.s1']).suggested_questions);
});

test('without a usable plan, a contract tour falls back to the card and still says it is no legal advice', async () => {
  const {
    steps: all,
    metadata,
    requests,
  } = await run(lease, (r) => (r.name === 'tour_plan' ? { plan: 'p' } : leaseModel(r)));
  assert.equal(metadata.planSource, 'fallback');
  assert.equal(requests.filter((r) => r.name === 'tour_plan').length, 2);
  assert.ok(all[0].say.startsWith('This tour explains the document in plain words; it is not legal advice.'));
  assert.ok(all.at(-1)!.say.endsWith('it is not legal advice.'));
  assert.deepEqual(fallbackArcPlan(cardFor('contract', ['p1.s2']) as never, 'contract').items.risks, [
    item('A catch.', 'p1.s2'),
  ]);
});

// -------------------------------------------------------------------------------------------------- letter

const letter = makeDoc('Exampleton City Council', 1, [
  ['p1.b1', 'paragraph', { 'p1.s1': 'Your housing benefit claim: we need more information.' }],
  ['p1.b2', 'paragraph', { 'p1.s2': 'Please send us your payslips for August to October by 9 November 2026.' }],
  ['p1.b3', 'paragraph', { 'p1.s3': 'You can upload them at the online portal with your reference number.' }],
  ['p1.b4', 'paragraph', { 'p1.s4': 'If we do not receive them, we may have to refuse your claim.' }],
]);
test('a letter says what it is, what to do as a flow of steps, by when, and what happens otherwise', async () => {
  const plan = {
    plan: 'p',
    chapter_titles: {
      overview: 'The letter',
      actions: 'To do',
      deadlines: 'By when',
      consequences: 'Otherwise',
      takeaway: 'In short',
    },
    overview: [item('The council needs more information about your claim.', 'p1.s1')],
    actions: [item('Send your payslips.', 'p1.s2'), item('Upload them at the portal.', 'p1.s3')],
    deadlines: [item('By 9 November 2026.', 'p1.s2')],
    consequences: [item('Otherwise the claim may be refused.', 'p1.s4')],
    takeaway: [item('Upload the payslips before 9 November 2026.', 'p1.s2')],
  };
  const {
    tour,
    steps: all,
    requests,
  } = await run(letter, (r) => {
    if (r.name === 'paper_card') return cardFor('letter', ['p1.s1', 'p1.s2', 'p1.s4']);
    if (r.name === 'tour_plan') return plan;
    if (suggestedBoard(r) === 'flow') return plainDirection(r, { flow: TIMELINE });
    return plainDirection(r);
  });
  assert.deepEqual(
    tour.chapters.map((c) => c.id),
    ['overview', 'actions', 'deadlines', 'consequences', 'takeaway'],
  );
  assert.deepEqual(
    all.map((s) => s.id),
    ['overview-1', 'point-1', 'point-2', 'point-3', 'point-4', 'takeaway-1'],
  );
  assert.ok(types(all[1]).includes('board'));
  assert.ok(!types(all[2]).includes('board'));
  assert.ok(!all[0].say.includes('legal advice'));
  assert.ok(
    requests
      .filter((r) => r.name === 'beat_direction')
      .every((r) => r.brief.includes('what the reader must do and by when')),
  );
});

// ------------------------------------------------------------------------------------------------- lecture

const slides = makeDoc(
  'Lecture 4: Gradient Descent',
  5,
  [
    ['p1.b1', 'title', { 'p1.s1': 'Lecture 4: Gradient Descent' }],
    ['p2.b1', 'paragraph', { 'p2.s1': 'Training means finding the parameters with the smallest loss.' }],
    ['p3.b1', 'paragraph', { 'p3.s1': 'Gradient descent repeats one update: w minus eta times the gradient.' }],
    ['p4.b1', 'paragraph', { 'p4.s1': 'If the learning rate is too large, the loss diverges.' }],
    ['p5.b1', 'paragraph', { 'p5.s1': 'A smaller rate converges in fewer epochs here.' }],
    ['p5.b2', 'paragraph', { 'p5.s2': 'Learning rate Epochs to converge 0.001 0.01 120 35' }],
  ],
  {
    figures: [
      {
        id: 'fig1',
        kind: 'figure',
        number: '1',
        page: 4,
        bbox: [50, 300, 500, 600],
        caption: 'Loss curves for three learning rates',
        image: 'figures/fig1.png',
        panels: [],
        referenced_by: [],
      },
    ],
  },
);
test('a lecture follows its own order: one chapter per topic, its figure right after it, a formula read from the page', async () => {
  const plan = {
    plan: 'p',
    chapter_titles: { overview: 'This lecture', takeaway: 'Summary' },
    overview: [item('How gradient descent trains a model.', 'p1.s1')],
    // Out of order on purpose: the tour follows the slides.
    topics: [
      {
        title: 'Learning rate',
        text: 'A large learning rate makes the loss diverge.',
        evidence: ['p4.s1'],
        board: 'none',
        visual: 'fig1',
      },
      {
        title: 'The update rule',
        text: 'Each step moves against the gradient.',
        evidence: ['p3.s1'],
        board: 'formula',
        visual: '',
      },
      {
        title: 'Learning as search',
        text: 'Training searches for the smallest loss.',
        evidence: ['p2.s1'],
        board: 'none',
        visual: '',
      },
      // The slide's table is not cited, but its numbers are on the same slide.
      {
        title: 'Epochs',
        text: 'The rates converge at different speeds.',
        evidence: ['p5.s1'],
        board: 'bars',
        visual: '',
      },
    ],
    takeaway: [item('Step against the gradient with a well chosen rate.', 'p3.s1')],
  };
  const epochs = {
    title: 'Epochs to converge',
    unit: 'epochs',
    higher_is_better: false,
    bars: [
      { label: 'Rate 0.001', value: 120 },
      { label: 'Rate 0.01', value: 35 },
    ],
  };
  const formula = {
    title: 'Update',
    latex: 'w_{t+1} = w_t - \\eta \\nabla L(w_t)',
    terms: [
      { latex: '\\eta', label: 'step size' },
      { latex: '\\nabla L(w_t)', label: 'the gradient' },
    ],
  };
  const {
    tour,
    steps: all,
    requests,
  } = await run(slides, (r) => {
    if (r.name === 'paper_card') return cardFor('lecture', ['p1.s1', 'p2.s1', 'p4.s1']);
    if (r.name === 'tour_plan') return plan;
    if (suggestedBoard(r) === 'formula') return plainDirection(r, { formula });
    if (suggestedBoard(r) === 'bars') return plainDirection(r, { bars: epochs });
    return plainDirection(r);
  });
  assert.deepEqual(
    tour.chapters.map((c) => c.title),
    ['This lecture', 'Learning as search', 'The update rule', 'Learning rate', 'Epochs', 'Summary'],
  );
  const chart = tour.chapters[4].steps[0].actions.find((a) => a.type === 'board');
  assert.deepEqual(
    chart?.type === 'board' && chart.item.kind === 'bars' && chart.item.bars.map((b) => b.value),
    [120, 35],
  );
  const bars = requests.find((r) => r.brief.includes('POINT TO MAKE: The rates converge'))!.brief;
  assert.match(bars, /MORE NUMBERS FOR THE BARS ONLY .*:\n\[p5\.s2\] Learning rate Epochs to converge/);
  assert.deepEqual(
    tour.chapters[3].steps.map((s) => s.id),
    ['point-3', 'figure-1'],
  );
  assert.deepEqual(tour.chapters[3].steps[1].actions[0], { type: 'zoom', target: 'fig1' });
  const update = tour.chapters[2].steps[0];
  assert.ok(update.actions.some((a) => a.type === 'board' && a.item.kind === 'formula'));
  const brief = requests.find((r) => r.brief.includes('POINT TO MAKE: Each step moves against the gradient.'))!;
  assert.match(brief.brief, /Page 3 is attached: read the formula there\./);
  assert.equal(brief.images, 1);
  assert.ok(all.length <= 12);
});

test('a card that cannot be read leaves the type to the document: tasks make a sheet, a paper layout a paper', () => {
  const plain = makeDoc('Notes', 1, [['p1.b1', 'paragraph', { 'p1.s1': 'Some notes.' }]]);
  assert.equal(guessType(plain), 'other');
  assert.equal(
    guessType({ ...plain, sections: [{ id: 'sec-abstract', title: 'Abstract', level: 1, page: 1, block: 'p1.b1' }] }),
    'research_paper',
  );
  assert.equal(guessType(sheet), 'exercise_sheet');
});

// ---------------------------------------------------------------------------------------------- exercises

const sheet = makeDoc(
  'Übungsblatt 2',
  1,
  [
    ['p1.b1', 'title', { 'p1.s1': 'Übungsblatt 2' }],
    ['p1.b2', 'paragraph', { 'p1.s2': 'Aufgabe 1 (Lineare Gleichungen)' }],
    ['p1.b3', 'paragraph', { 'p1.s3': 'Gegeben ist die Gleichung 3x − 7 = 2x + 5.' }],
    ['p1.b4', 'paragraph', { 'p1.s4': 'a) Lösen Sie die Gleichung nach x auf.' }],
    ['p1.b5', 'paragraph', { 'p1.s5': 'b) Machen Sie die Probe.' }],
    ['p1.b6', 'paragraph', { 'p1.s6': 'Aufgabe 2 (Determinanten)' }],
    ['p1.b7', 'paragraph', { 'p1.s7': 'Berechnen Sie die Determinante der Matrix' }],
    ['p1.b8', 'equation', {}, '1 2 3 −1'],
  ],
  {
    exercises: [
      {
        id: 'ex1',
        number: '1',
        title: 'Lineare Gleichungen',
        points: 4,
        page: 1,
        block: 'p1.b2',
        blocks: ['p1.b2', 'p1.b3', 'p1.b4', 'p1.b5'],
        parts: [
          { id: 'ex1.a', label: 'a', page: 1, blocks: ['p1.b4'] },
          { id: 'ex1.b', label: 'b', points: 2, page: 1, blocks: ['p1.b5'] },
        ],
      },
      {
        id: 'ex2',
        number: '2',
        title: 'Determinanten',
        page: 1,
        block: 'p1.b6',
        blocks: ['p1.b6', 'p1.b7', 'p1.b8'],
        parts: [],
      },
    ] satisfies DocExercise[],
  },
);
const term = (latex: string, label: string, anchor: string) => ({ latex, label, anchor });
function solution(unit: string) {
  if (unit === 'ex2')
    return {
      plan: 'det = 1 * (-1) - 2 * 3 = -7',
      read: {
        say: 'We are given a two by two matrix with rows one two and three minus one, and we are asked for its determinant.',
        given: ['p1.s7'],
        given_anchor: 'a two by two matrix',
        asked: ['p1.s7'],
        asked_anchor: 'asked for its determinant',
        marks: [{ target: 'p1.b8', anchor: 'rows one two' }],
      },
      method: {
        say: 'For a two by two matrix, the determinant is the product of the diagonal minus the product of the other diagonal.',
        formula: {
          title: 'Two by two rule',
          latex: '\\det A = ad - bc',
          terms: [
            term('ad', 'main diagonal', 'product of the diagonal'),
            term('bc', 'other diagonal', 'the other diagonal'),
          ],
        },
      },
      steps: [
        {
          title: 'Multiply the diagonals',
          latex: '\\det A = 1 \\cdot (-1) - 2 \\cdot 3',
          terms: [term('1 \\cdot (-1)', 'main diagonal', 'one times minus one')],
          say: 'We multiply one times minus one, and subtract two times three.',
          sure: true,
        },
        {
          title: 'Subtract',
          latex: '\\det A = -7',
          terms: [term('-7', 'the determinant', 'minus seven')],
          say: 'Minus one minus six gives minus seven.',
          sure: false,
        },
      ],
      answer: {
        title: 'Result',
        latex: '\\det A = -7',
        terms: [term('-7', 'determinant', 'is minus seven')],
        say: 'So the determinant is minus seven, which is not zero.',
      },
      check_note: 'Please check this step yourself.',
      questions: ['Why does the rule work?', 'What does a zero determinant mean?'],
    };
  const a = unit === 'ex1.a';
  return {
    plan: '3x - 7 = 2x + 5, x = 12',
    read: {
      say: a
        ? 'We are given the equation three x minus seven equals two x plus five, and we are asked to solve it for x.'
        : 'We take the solution from part a, x equals twelve, and are asked to check it in both sides of the equation.',
      given: ['p1.s3'],
      given_anchor: a ? 'three x minus seven' : 'solution from part a',
      asked: [a ? 'p1.s4' : 'p1.s5'],
      asked_anchor: a ? 'asked to solve it' : 'asked to check it',
      marks: [],
    },
    method: {
      say: 'We do the same on both sides, so the two sides of the equation stay equal at every step.',
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
    check_note: 'Please check this step yourself.',
    questions: ['Why may we subtract on both sides?', 'How do I check the answer?'],
  };
}
function sheetModel(r: Request) {
  if (r.name === 'paper_card') return cardFor('exercise_sheet', ['p1.s1', 'p1.s3', 'p1.s3']);
  if (r.name === 'exercise_solution') {
    const unit = /EXERCISE: Aufgabe 2/.test(r.brief) ? 'ex2' : /part b\)/.test(r.brief) ? 'ex1.b' : 'ex1.a';
    return solution(unit);
  }
  return plainDirection(r);
}
/** A verifier that says ok, except where `verdicts` says otherwise for a line. */
function verifier(verdicts: Record<string, LineCheck> = {}, seen: string[][] = []): MathVerifier {
  return async (lines) => {
    seen.push(lines);
    return lines.map((line) => verdicts[line] ?? { status: 'ok' });
  };
}

test('an exercise sheet is taught part by part: the task, the method, each solution line on the board, the answer', async () => {
  const seen: string[][] = [];
  const { tour, step, requests, metadata } = await run(
    sheet,
    sheetModel,
    verifier({ '\\det A = 1 \\cdot (-1) - 2 \\cdot 3': { status: 'unknown' } }, seen),
  );
  assert.equal(metadata.docType, 'exercise_sheet');
  assert.equal(requests.filter((r) => r.name === 'tour_plan').length, 0);
  assert.deepEqual(
    tour.chapters.map((c) => `${c.id}:${c.title}`),
    ['overview:What it is', 'ex1:Aufgabe 1: Lineare Gleichungen', 'ex2:Aufgabe 2: Determinanten', 'takeaway:Remember'],
  );
  assert.deepEqual(
    tour.chapters[1].steps.map((s) => s.id),
    [
      'ex1.a-task',
      'ex1.a-method',
      'ex1.a-step-1',
      'ex1.a-step-2',
      'ex1.a-answer',
      'ex1.b-task',
      'ex1.b-method',
      'ex1.b-step-1',
      'ex1.b-step-2',
      'ex1.b-answer',
    ],
  );
  // The task: the givens in blue and the question in yellow as they are named.
  const task = step('ex1.a-task');
  assert.deepEqual(task.actions[0], { type: 'focus', target: 'p1.b4' });
  assert.deepEqual(task.actions.slice(1), [
    { type: 'highlight', targets: ['p1.s3'], color: 'blue', at_word: findAnchor(task.say, 'three x minus seven')! },
    { type: 'highlight', targets: ['p1.s4'], color: 'yellow', at_word: findAnchor(task.say, 'asked to solve it')! },
  ]);
  // Each solution line is a formula built term by term, lit up when the narration names it, with a pause after it.
  const first = step('ex1.a-step-1');
  assert.deepEqual(first.actions, [
    { type: 'focus', target: 'p1.b4' },
    {
      type: 'board',
      item: {
        kind: 'formula',
        title: 'Subtract 2x',
        latex: 'x - 7 = 5',
        terms: [{ latex: 'x - 7', label: 'what is left' }],
      },
    },
    { type: 'board_focus', part: 0, at_word: findAnchor(first.say, 'x minus seven is left')! },
  ]);
  assert.equal(first.hold_ms, 800);
  // The answer lights up the question again in green; the next task step clears the board.
  const answer = step('ex1.a-answer');
  assert.deepEqual(answer.actions.at(-1), { type: 'highlight', targets: ['p1.s4'], color: 'green' });
  assert.deepEqual(types(step('ex1.b-task')).slice(0, 2), ['focus', 'board_clear']);
  // The method without a rule to show has no board; the rule of the determinant is shown term by term.
  assert.ok(!types(step('ex1.a-method')).includes('board'));
  assert.ok(types(step('ex2-method')).includes('board_focus'));
  // A matrix printed without sentences gets a pen circle when the givens are named.
  const det = step('ex2-task');
  assert.deepEqual(
    det.actions.find((a) => a.type === 'circle'),
    {
      type: 'circle',
      target: 'p1.b8',
      color: 'blue',
      at_word: findAnchor(det.say, 'rows one two')!,
    },
  );
  // A line the code could not check is marked on the board; one its author doubts also asks the learner to check.
  const unchecked = step('ex2-step-1').actions.find((a) => a.type === 'board');
  assert.equal(unchecked?.type === 'board' && unchecked.item.title, 'Multiply the diagonals · ungeprüft');
  assert.equal(step('ex2-step-1').say, 'We multiply one times minus one, and subtract two times three.');
  assert.equal(step('ex2-step-2').say, 'Minus one minus six gives minus seven.');
  // The verifier saw every solution line and the answer, once per part.
  assert.deepEqual(
    seen.find((lines) => lines.includes('\\det A = -7')),
    ['\\det A = 1 \\cdot (-1) - 2 \\cdot 3', '\\det A = -7', '\\det A = -7'],
  );
  assert.equal(requests.filter((r) => r.name === 'exercise_solution').length, 3);
  // The solve call offers only the part's own sentences and printed maths, and sees the page.
  const solve = requests.find((r) => r.name === 'exercise_solution' && r.brief.includes('EXERCISE: Aufgabe 2'))!;
  assert.deepEqual(solve.schema.properties.read.properties.asked.items.enum, ['p1.s6', 'p1.s7']);
  assert.deepEqual(solve.schema.properties.read.properties.marks.items.properties.target.enum, ['p1.b8']);
  assert.match(solve.brief, /MATHS ON THE PAGE as extracted .*\n\[p1\.b8\] 1 2 3 −1/);
  assert.equal(solve.images, 1);
  assert.deepEqual(metadata.exercises, [
    { id: 'ex1.a', solved: true, ok: 3, failed: 0, unknown: 0 },
    { id: 'ex1.b', solved: true, ok: 3, failed: 0, unknown: 0 },
    { id: 'ex2', solved: true, ok: 2, failed: 0, unknown: 1 },
  ]);
  // The overview names the parts the tour works through.
  const overview = requests.find((r) => r.brief.includes('STEP KIND: overview'))!;
  assert.match(
    overview.brief,
    /THE TOUR WORKS THROUGH: Aufgabe 1: Lineare Gleichungen, part a\); Aufgabe 1: Lineare Gleichungen, part b\); Aufgabe 2: Determinanten/,
  );
  assert.ok(overview.brief.includes('patient tutor'));
});

test('a solution line that does not check out gets one repair with the reason; still wrong, it asks for a check', async () => {
  const wrong = { 'x = 12': { status: 'failed' as const, problem: '3x - 7 = 2x + 5 does not hold for x = 12' } };
  const fixed = await run(
    sheet,
    (r) => {
      if (r.name !== 'exercise_solution' || !r.brief.includes('part b)')) return sheetModel(r);
      // The repaired answer drops the line the verifier rejected.
      const base = solution('ex1.b');
      return r.task.includes('do not check out') ? { ...base, steps: base.steps.slice(0, 1) } : base;
    },
    verifier(wrong),
  );
  const calls = fixed.requests.filter((r) => r.name === 'exercise_solution' && r.brief.includes('part b)'));
  assert.equal(calls.length, 2);
  assert.match(calls[1].task, /- step 2: 3x - 7 = 2x \+ 5 does not hold for x = 12/);
  // The answer line (x = 12) still fails, so part b keeps its best attempt and marks what is in doubt.
  const answer = fixed.step('ex1.b-answer');
  assert.equal(answer.say, 'So x is twelve, and both sides of the equation agree. Please check this step yourself.');
  const board = answer.actions.find((a) => a.type === 'board');
  assert.equal(board?.type === 'board' && board.item.title, 'Result · ungeprüft');
  assert.equal(fixed.step('ex1.b-step-1').say, solution('ex1.b').steps[0].say);
});

test('a part the model cannot teach still points at its task, and a tight preset names the parts left out', async () => {
  const { step, metadata } = await run(
    sheet,
    (r) => (r.name === 'exercise_solution' && r.brief.includes('EXERCISE: Aufgabe 2') ? { plan: 'p' } : sheetModel(r)),
    verifier(),
  );
  assert.deepEqual(step('ex2-task').actions, [
    { type: 'focus', target: 'p1.b6' },
    { type: 'board_clear' },
    { type: 'highlight', targets: ['p1.s6'], color: 'yellow' },
  ]);
  assert.deepEqual(metadata.fallbackBeats, ['exercise-ex2']);

  const quick = await run(sheet, sheetModel, verifier(), 'quick');
  const takeaway = quick.requests.find((r) => r.brief.includes('STEP KIND: takeaway'))!;
  assert.match(
    takeaway.brief,
    /NOT COVERED, for the learner to try or ask about: Aufgabe 1: Lineare Gleichungen, part b\)/,
  );
  // Quick: the task and the method in one step, two solution lines at most, the answer said with the last line.
  assert.deepEqual(
    quick.tour.chapters[1].steps.map((s) => s.id),
    ['ex1.a-task', 'ex1.a-step-1', 'ex1.a-step-2'],
  );
  assert.ok(quick.step('ex1.a-task').say.endsWith('stay equal at every step.'));
  const last = quick.step('ex1.a-step-2');
  const line = solution('ex1.a').steps[1].say;
  assert.equal(last.say, `${line} ${solution('ex1.a').answer.say}`);
  assert.deepEqual(last.actions.at(-1), {
    type: 'highlight',
    targets: ['p1.s4'],
    color: 'green',
    at_word: line.split(' ').length,
  });
  assert.ok(quick.steps.length <= 10);
});

test('an answer longer than the plan allows is cut to size, not rejected; unknown IDs are dropped', () => {
  const unit = planUnits(exerciseUnits(sheet), 'standard').taught[0];
  const base = solution('ex1.a');
  const long = {
    ...base,
    read: { ...base.read, given: ['p1.s3', 'p9.s9'], asked: ['p1.s4', 'p1.s5', 'p1.s2'] },
    steps: [...base.steps, ...base.steps, ...base.steps],
    questions: ['One?', 'Two?', 'Three?'],
  };
  const { solution: kept, problems } = cleanSolution(long, unit);
  assert.deepEqual(problems, []);
  assert.equal(kept!.steps.length, unit.steps);
  assert.deepEqual(kept!.questions, ['One?', 'Two?']);
  assert.deepEqual([kept!.read.given, kept!.read.asked], [['p1.s3'], ['p1.s4', 'p1.s2']]);
  assert.match(
    cleanSolution({ ...base, answer: { ...base.answer, say: 'Twelve.' } }, unit).problems.join(),
    /answer\.say/,
  );
});

test('parts are planned within the preset: all of them when they fit, else the first part of each task first', () => {
  const units = exerciseUnits(sheet);
  assert.deepEqual(
    units.map((u) => [u.id, u.statement, u.sentences, u.maths]),
    [
      ['ex1.a', ['p1.b2', 'p1.b3'], ['p1.s2', 'p1.s3', 'p1.s4'], []],
      ['ex1.b', ['p1.b2', 'p1.b3'], ['p1.s2', 'p1.s3', 'p1.s5'], []],
      ['ex2', [], ['p1.s6', 'p1.s7'], ['p1.b8']],
    ],
  );
  const plan = (preset: 'quick' | 'standard' | 'deep', list = units) => planUnits(list, preset);
  assert.deepEqual(
    plan('standard').taught.map((u) => [u.id, u.steps, u.compact]),
    [
      ['ex1.a', 3, false],
      ['ex1.b', 3, false],
      ['ex2', 3, false],
    ],
  );
  assert.deepEqual(
    plan('quick').taught.map((u) => [u.id, u.steps, u.compact]),
    [
      ['ex1.a', 2, true],
      ['ex2', 2, true],
    ],
  );
  assert.deepEqual(
    plan('quick').skipped.map((u) => u.id),
    ['ex1.b'],
  );
  const many = Array.from({ length: 9 }, (_, i) => ({ ...units[0], id: `u${i}`, task: { ...units[0].task } }));
  for (const preset of ['quick', 'standard', 'deep'] as const) {
    const { taught } = plan(preset, many);
    const length = 2 + taught.reduce((n, u) => n + unitOverhead(u) + u.steps, 0);
    assert.ok(length <= { quick: 10, standard: 20, deep: 30 }[preset], `${preset}: ${length}`);
  }
  // The tour of a sheet: overview, the taught parts, takeaway.
  const card = cardFor('exercise_sheet', ['p1.s1', 'p1.s3']) as never;
  assert.deepEqual(
    exercisePlan(card, sheet, 'standard').beats.map((b) => b.kind),
    ['overview', 'exercise', 'exercise', 'exercise', 'takeaway'],
  );
  assert.equal(taskName(sheet, sheet.exercises![0]), 'Aufgabe 1: Lineare Gleichungen');
});

test('a sheet without tasks found by ingestion is toured as an ordinary document', async () => {
  const plain = { ...sheet, exercises: undefined };
  const plan = {
    plan: 'p',
    chapter_titles: { overview: 'Sheet', points: 'Tasks', caveats: 'Notes', takeaway: 'Remember' },
    overview: [item('An exercise sheet on equations.', 'p1.s1')],
    points: [item('Solve a linear equation.', 'p1.s3')],
    caveats: [],
    takeaway: [item('Practise both methods.', 'p1.s4')],
  };
  const { tour, metadata } = await run(plain, (r) => (r.name === 'tour_plan' ? plan : sheetModel(r)), verifier());
  assert.equal(metadata.docType, 'other');
  assert.deepEqual(
    tour.chapters.map((c) => c.id),
    ['overview', 'points', 'takeaway'],
  );
});

test('the paper block lists a sheet’s tasks with the maths only the page shows; papers keep their author lines out', () => {
  const block = paperBlock(sheet);
  assert.match(
    block,
    /EXERCISES \(tasks and their parts\):\n\[ex1\] Aufgabe 1: Lineare Gleichungen, 4 points, page 1\n  statement: sentences p1\.s2, p1\.s3\n  \[ex1\.a\] part a, page 1: sentences p1\.s4\n  \[ex1\.b\] part b, 2 points, page 1: sentences p1\.s5\n\[ex2\] Aufgabe 2: Determinanten, page 1\n  statement: sentences p1\.s6, p1\.s7; maths as extracted .*: \[p1\.b8\] 1 2 3 −1/,
  );
  assert.ok(proseSentences(lease).some((s) => s.id === 'p1.s2'));
  const paper = { ...lease, sections: [{ id: 'sec-abstract', title: 'Abstract', level: 1, page: 1, block: 'p1.b3' }] };
  assert.ok(!proseSentences(paper).some((s) => s.id === 'p1.s2'));
  assert.ok(!paperBlock(paper).includes('EXERCISES'));
});

test('the worked example the solve call is shown passes the same checks as an answer', () => {
  for (const line of [...SOLVE_EXAMPLE.steps, SOLVE_EXAMPLE.answer]) {
    const { problems } = checkFormula(line, { minTerms: 1 });
    assert.deepEqual(problems, [], line.latex);
    const say = 'say' in line ? line.say : '';
    for (const t of line.terms) assert.notEqual(findAnchor(say, t.anchor), null, t.anchor);
  }
  for (const anchor of [SOLVE_EXAMPLE.read.given_anchor, SOLVE_EXAMPLE.read.asked_anchor])
    assert.notEqual(findAnchor(SOLVE_EXAMPLE.read.say, anchor), null, anchor);
});

test('the lecture, contract, letter and other arcs fit the step budget of every preset', () => {
  const card = cardFor('other', ['p1.s1']) as never;
  for (const type of ['lecture', 'contract', 'letter', 'other'] as const)
    for (const preset of ['quick', 'standard', 'deep'] as const) {
      const items = Object.fromEntries(
        ARC_SPECS[type].map((s) => [
          s.id,
          Array.from({ length: s.max[preset] }, () => ({ text: 'x', evidence: ['p1.s1'], visual: 'fig1' })),
        ]),
      );
      const plan = arcTourPlan({ plan: 'p', titles: {}, items }, type, card, slides, preset, 'en-US');
      assert.ok(plan.beats.length <= 30, `${type} ${preset}: ${plan.beats.length}`);
      assert.equal(plan.beats.at(-1)!.kind, 'takeaway');
    }
});

test('the verifier reads the helper’s answer, and runs the real helper when the ingestion venv is there', async () => {
  assert.deepEqual(readChecks('{"lines":[{"status":"ok"},{"status":"failed","problem":"x"}]}', 2), [
    { status: 'ok' },
    { status: 'failed', problem: 'x' },
  ]);
  assert.equal(readChecks('{"lines":[{"status":"ok"}]}', 2), null);
  assert.equal(readChecks('nonsense', 1), null);
  assert.deepEqual(await pythonVerifier('/nonexistent/python')(['x = 1']), [{ status: 'unknown' }]);
  const checks = await pythonVerifier()(['3x - 7 = 2x + 5', 'x = 13']);
  if (checks[0].status !== 'unknown')
    assert.deepEqual(
      checks.map((c) => c.status),
      ['failed', 'ok'],
    );
});
