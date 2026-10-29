import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Doc } from '../../shared/paper';
import { ARC_SPECS, arcSchema, arcTourPlan, fallbackArcPlan, type ArcType } from '../src/harness/arcs';
import { paperPlan, type Preset, type TourPlan } from '../src/harness/beats';
import { BOARD_KINDS } from '../src/harness/board';
import { cardProblems, cardSchema, evidencePool, fallbackCard, type PaperCard } from '../src/harness/card';
import { claimContext, claimSentenceIds, claimsSchema } from '../src/harness/claims';
import { deckSchema, deckTourPlan, fallbackDeckPlan, slideCards } from '../src/harness/deck';
import { beatTargets, directionSchema } from '../src/harness/direct';
import type { AskRequest } from '../src/harness/ask-types';
import { deckLike } from '../src/harness/doctype';
import { EXAMPLE_SCHEMA, exampleSchema } from '../src/harness/example';
import { exercisePlan, solveSchema, type Unit } from '../src/harness/exercise';
import { unitVisualSchema } from '../src/harness/exercise-visual';
import {
  ENUM_BUDGET,
  ENUM_ROOM,
  EQUATION_IDS,
  FIGURE_IDS,
  enumChars,
  enumValues,
  equationIds,
  figureIds,
  idEnum,
  pick,
} from '../src/harness/schema-budget';
import { plannableBeats, visualPlanSchema, type StepVisual } from '../src/harness/visual-plan';
import { answerSchema } from '../src/harness/ask-authoring';
import { retrieve } from '../src/harness/ask-retrieval';
import { longDoc } from './long-doc-fixture';

// The provider rejects a response schema that carries more than 3000 enum values in all (schema_enum_budget), counted as
// written: a list in $defs counts once however often it is referenced. These tests build every call's schema the way the
// generator does, for a real 63-page lease and for synthetic documents of 100 pages, and hold each to the budget.

interface Built {
  name: string;
  schema: object;
}

const PRESETS: Preset[] = ['quick', 'standard', 'deep'];
const pageSelection = (doc: Doc, page: number) => ({
  page: Math.min(page, doc.pages.length),
  rect: [0, 0, 1, 1] as [number, number, number, number],
});

/** A card that cites the document's own sentences, figures and formulas, as a model's card would. */
function cardOf(doc: Doc): PaperCard {
  const base = fallbackCard(doc);
  const prose = evidencePool(doc);
  const item = (i: number) => ({
    text: `A point about the document, number ${i + 1}.`,
    evidence: [prose[i * 3]?.id ?? prose[0].id],
  });
  const figures = doc.figures.slice(0, 3).map((f) => ({ id: f.id, why: `${f.caption}` }));
  const tables = doc.figures.filter((f) => f.kind === 'table').slice(0, 1);
  return {
    ...base,
    problem: item(0),
    key_idea: item(1),
    method_steps: [item(2), item(3), item(4)],
    key_figures: [...figures.slice(0, 2), ...tables.map((f) => ({ id: f.id, why: f.caption }))],
    key_formulas: doc.equations.slice(0, 2).map((e) => ({ id: e.id, why: 'The rule that the method applies.' })),
    results: [item(5), item(6)],
    limitations: [item(7)],
    takeaway: item(8),
    suggested_questions: ['What changes?', 'How does it work?', 'What are the limits?'],
  };
}

/** Every plan the generator can make for the document, with the preset it was made for. */
function plansOf(doc: Doc, card: PaperCard): { plan: TourPlan; preset: Preset }[] {
  const plans: { plan: TourPlan; preset: Preset }[] = [];
  for (const preset of PRESETS) {
    if (doc.exercises?.length) plans.push({ plan: exercisePlan(card, doc, preset), preset });
    else if (deckLike(doc)) {
      const slides = slideCards(doc);
      plans.push({ plan: deckTourPlan(fallbackDeckPlan(slides, preset, 'A deck'), card, doc), preset });
    } else {
      plans.push({ plan: paperPlan(card, doc, preset), preset });
      for (const type of Object.keys(ARC_SPECS) as ArcType[])
        plans.push({ plan: arcTourPlan(fallbackArcPlan(card, type), type, card, doc, preset, 'en'), preset });
    }
  }
  return plans;
}

/** The response schema of every model call a tour of the document makes, for every preset and document type. */
export function callSchemas(doc: Doc): Built[] {
  const built: Built[] = [];
  const add = (name: string, schema: object) => built.push({ name, schema });
  const card = cardOf(doc);
  const evidenceIds = evidencePool(doc).map((s) => s.id);
  add('paper_card', cardSchema(doc, evidenceIds));
  const context = claimContext(doc);
  for (const preset of PRESETS) {
    if (context) add(`claims ${preset}`, claimsSchema(doc, claimSentenceIds(doc, context), preset));
    for (const type of Object.keys(ARC_SPECS) as ArcType[])
      add(`tour_plan ${type} ${preset}`, arcSchema(type, doc, evidenceIds, preset));
    if (deckLike(doc)) add(`deck_plan ${preset}`, deckSchema(slideCards(doc).length, preset));
  }
  add('example', EXAMPLE_SCHEMA);
  for (const kind of BOARD_KINDS) add(`example ${kind}`, exampleSchema([kind]));
  for (const { plan, preset } of plansOf(doc, card)) {
    const sheet = plan.beats.some((beat) => beat.unit);
    const plannable = plannableBeats(plan.beats);
    if (plannable.length) add(`visual_plan ${plan.type} ${preset}`, visualPlanSchema(plannable, { sheet }));
    for (const beat of plan.beats) {
      if (beat.unit) {
        add(`exercise_solution ${beat.id}`, solveSchema(beat.unit));
        continue;
      }
      // Unplanned (every board kind on offer) and planned with each kind in turn.
      const planned: (StepVisual | undefined)[] = [
        undefined,
        { visual: 'none', idea: '', data: '' },
        ...BOARD_KINDS.map((visual): StepVisual => ({ visual, idea: 'The point.', data: 'illustrative 1, 2, 3' })),
      ];
      for (const visual of planned) {
        const targets = beatTargets(beat, doc, visual);
        // A figure seen as an image offers its measured parts as well (up to 80 of them).
        if (beat.target && doc.figures.find((f) => f.id === beat.target)?.kind === 'figure') {
          targets.imaged = beat.target;
          targets.measured = Array.from({ length: 80 }, (_, i) => ({
            id: `measured:${beat.target}:${i + 1}`,
            target: beat.target!,
            kind: i % 3 === 0 ? ('panel' as const) : ('text' as const),
            label: `part ${i + 1}`,
            region: [0.1, 0.1, 0.4, 0.4] as [number, number, number, number],
          }));
        }
        add(`beat_direction ${beat.id} ${visual?.visual ?? 'unplanned'}`, directionSchema(beat, targets, true, visual));
      }
    }
  }
  for (const kind of BOARD_KINDS) add(`exercise_visual ${kind}`, unitVisualSchema(kind));
  const asked: AskRequest[] = [
    { question: 'What does the tenant pay?' },
    // A selection that covers a whole page of the document puts all of its sentences in focus.
    { question: 'What does this say?', selection: pageSelection(doc, 50) },
    { question: `What does ${doc.figures[0]?.id ?? 'the first part'} show?`, figureId: doc.figures[0]?.id },
  ];
  for (const request of asked) add(`ask_answer ${request.question.slice(0, 20)}`, answerSchema(retrieve(doc, request)));
  // A task that spans many pages: its sentences and formulas are all the solve call could cite.
  const sentences = doc.sentences.slice(0, 1500).map((s) => s.id);
  const task = {
    id: 'ex1',
    name: 'Task 1',
    blocks: [],
    statement: [],
    sentences,
    maths: doc.blocks.slice(0, 1200).map((b) => b.id),
    pages: [1],
    steps: 3,
    compact: false,
  } as unknown as Unit;
  add('exercise_solution of a task with 1500 sentences', solveSchema(task));
  return built;
}

function holdsBudget(label: string, doc: Doc) {
  const built = callSchemas(doc);
  assert.ok(built.length > 30, `${label}: the document's calls were built`);
  const over: string[] = [];
  for (const { name, schema } of built) {
    const values = enumValues(schema);
    if (values > ENUM_ROOM) over.push(`${name}: ${values} enum values`);
    const long = enumChars(schema);
    if (long > 15_000) over.push(`${name}: an enum of ${long} characters`);
  }
  assert.deepEqual(
    over.slice(0, 12),
    [],
    `${label}: schemas past the provider's limits (room ${ENUM_ROOM} of ${ENUM_BUDGET} values, 15000 characters per long enum)`,
  );
}

const lease = resolve(import.meta.dirname, '../../demo/eval-lease/doc.json');

test('every call schema of the 63-page lease fits the provider enum budget', { skip: !existsSync(lease) }, () => {
  const doc = JSON.parse(readFileSync(lease, 'utf8')) as Doc;
  holdsBudget('lease', doc);
});

for (const kind of ['paper', 'contract', 'slides', 'sheet'] as const)
  test(`every call schema of a synthetic 100-page ${kind} fits the provider enum budget`, () => {
    const doc = longDoc(kind);
    assert.equal(doc.pages.length, 100);
    holdsBudget(kind, doc);
  });

test('a shared list counts once however often it is used, and a subset keeps the IDs that matter most', () => {
  const ids = Array.from({ length: 800 }, (_, i) => `p${i}.s1`);
  const shared = {
    $defs: { id: idEnum(ids) },
    a: { $ref: '#/$defs/id' },
    b: { $ref: '#/$defs/id' },
    c: { $ref: '#/$defs/id' },
  };
  const repeated = { a: idEnum(ids), b: idEnum(ids), c: idEnum(ids) };
  assert.equal(enumValues(shared), 800);
  assert.equal(enumValues(repeated), 2400);
  assert.deepEqual(idEnum([]), { type: 'string', maxLength: 0 });
  // The preferred IDs come first in line, the rest keep their order, and nothing outside the list is invented.
  const chosen = pick(ids, 5, ['p700.s1', 'p3.s1', 'unknown']);
  assert.deepEqual(
    chosen,
    ['p0.s1', 'p1.s1', 'p2.s1', 'p3.s1', 'p700.s1'].filter((id) => chosen.includes(id)),
  );
  assert.equal(chosen.length, 5);
  assert.ok(chosen.includes('p700.s1') && chosen.includes('p3.s1') && !chosen.includes('unknown'));
  assert.equal(pick(ids, 900), ids);
  const doc = longDoc('paper');
  assert.ok(figureIds(doc).length <= FIGURE_IDS && equationIds(doc).length <= EQUATION_IDS);
  // Numbered formulas and the most cited figures stay in when the document has more than fit.
  assert.ok(equationIds(doc).includes('eq160'));
  const cited = [...doc.figures].sort((a, b) => b.referenced_by.length - a.referenced_by.length)[0].id;
  assert.ok(figureIds(doc, 10).includes(cited));
});

test('the plan schemas of a long document keep every sentence the card or the plan may cite', () => {
  const doc = longDoc('contract');
  const ids = evidencePool(doc).map((s) => s.id);
  assert.ok(ids.length > 800, 'a long contract has more citable sentences than any one field could list');
  for (const type of Object.keys(ARC_SPECS) as ArcType[]) {
    const schema = arcSchema(type, doc, ids, 'standard') as { $defs: { sentenceId: { enum: string[] } } };
    assert.deepEqual(schema.$defs.sentenceId.enum, ids, type);
    assert.deepEqual(cardProblems(arcAnswer(type, ids[ids.length - 1]), schema), [], type);
  }
});

const arcAnswer = (type: ArcType, evidence: string) => {
  const item = { text: 'A point.', evidence: [evidence] };
  const topic = { ...item, title: 'Topic', board: 'none', visual: '' };
  const lists = Object.fromEntries(
    ARC_SPECS[type].map((spec) => [
      spec.id,
      Array.from({ length: Math.max(1, spec.min) }, () => (type === 'lecture' && spec.id === 'topics' ? topic : item)),
    ]),
  );
  const titles = Object.fromEntries(
    ARC_SPECS[type].filter((s) => !(type === 'lecture' && s.id === 'topics')).map((s) => [s.id, 'Title']),
  );
  return {
    plan: 'p',
    chapter_titles: titles,
    ...lists,
    ...(type === 'contract' ? { disclaimer: 'Not legal advice.' } : {}),
  };
};
