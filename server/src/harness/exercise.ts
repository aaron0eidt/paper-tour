import Ajv2020 from 'ajv/dist/2020.js';
import {
  FORMULA_BEFORE_MAX,
  splitWords,
  type Action,
  type Doc,
  type DocExercise,
  type DocExercisePart,
  type FormulaLine,
  type Step,
} from '../../../shared/paper';
import type { MuseMessage } from '../muse/client';
import { findAnchor } from './assemble';
import { BOARD_LIMITS, checkFormula, numbersIn, type FormulaItem } from './board';
import type { Beat, PlanChapter, Preset, TourPlan } from './beats';
import type { PaperCard, Subject } from './card';
import { TONE } from './doctype';
import { exampleFor } from './exercise-examples';
import { taskName } from './paper-block';
import { idEnum, pick } from './schema-budget';
import type { UnitVisual } from './exercise-visual';
import { unitTaskLines } from './unit-task';
import type { LineCheck } from './verify';

// The tutor for exercise sheets (notes/TUTOR.md, notes/HARNESS.md, "Tutor"): each taught part gets one solve call that
// reads the task, recalls the background it rests on, names the method and writes the solution as lines of maths, a
// check and the common mistake; code checks the lines' LaTeX and their maths, and turns the part into the steps of a
// tutor: the task (givens and question highlighted), the background (once per concept in a tour), the checkpoint, the
// method, one board line per solution step built term by term under the earlier lines, and the answer with its check.
// A part comes in three forms (full, follow-on, compact); when the tour is tight the method joins the first solution
// line and the answer the last one. Before the solution comes a checkpoint (coach mode): the learner tries first, with
// up to three hints that go from a nudge to almost the answer and never contain the result, and the steps after it
// reveal the solution.

/** How deeply the tour teaches a part: all the tutor's moves, a later part of a task, or the tight form. */
export type PartForm = 'full' | 'follow' | 'compact';

/** One exercise part the tour teaches: a part of a task, or a task without parts, and its plan. */
export interface Unit {
  id: string;
  /** "Aufgabe 1: Lineare Gleichungen, part a)". */
  name: string;
  task: DocExercise;
  part?: DocExercisePart;
  /** The part's blocks, or the task's. */
  blocks: string[];
  /** For a part: the task's own blocks before and around its parts, which hold the givens. */
  statement: string[];
  /** Sentences a highlight may mark: the statement's and the part's. */
  sentences: string[];
  /** Blocks without sentences, such as display maths and matrices, which a pen mark may ring. */
  maths: string[];
  pages: number[];
  /** Most solution steps on the board. */
  steps: number;
  /**
   * Full: all the tutor's moves. Follow-on: a later part of a task, with no background (it was given with part a) and
   * a short method. Compact, when the tour is tight: the method joins the first solution step and the answer the last.
   */
  form: PartForm;
}

/**
 * Tour length for a sheet by preset: longer than a paper's, since a solution step is short, and long enough for the
 * tutor's whole flow (background, checkpoint and method) on the first part of every task of a typical sheet.
 */
export const SHEET_STEPS: Record<Preset, number> = { quick: 60, standard: 100, deep: 160 };
/** Most solution lines of a part, and fewest when the tour is tight. */
const STEP_CAP: Record<Preset, number> = { quick: 3, standard: 5, deep: 7 };
const STEP_FLOOR = 2;
/** Most solution lines of a compact part, whatever the preset. */
const COMPACT_LINES = 3;
/** The checkpoint's limits, as the tour schema states them (a paper's quick checks keep to them too, check.ts). */
export const COACH_PROMPT_MAX = 300;
export const COACH_HINT_MAX = 200;
/** Most sentences (or formulas) of a task a solve call may cite from. */
const UNIT_IDS = 400;
const COACH_HINTS = 3;
/**
 * Steps of a part besides its solution steps: the task, the background, the checkpoint, the method and the answer; a
 * follow-on part has no background; the compact form only the task and the checkpoint, since the method joins the first
 * solution step and the answer the last. The background counts although a routine part has none, so that a tour never
 * grows past its preset.
 */
export const unitOverhead = (unit: Pick<Unit, 'form'>) => ({ full: 5, follow: 4, compact: 2 })[unit.form];

/** Every part of the sheet in reading order; a task without parts is one unit. */
export function exerciseUnits(doc: Doc): Unit[] {
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  const sentences = new Set(doc.sentences.map((s) => s.id));
  const units: Unit[] = [];
  const unit = (task: DocExercise, part: DocExercisePart | undefined, own: string[], statement: string[]): Unit => {
    const all = [...statement, ...own].map((id) => blocks.get(id)).filter((b) => b !== undefined);
    return {
      id: part?.id ?? task.id,
      name: `${taskName(doc, task)}${part ? `, part ${part.label})` : ''}`,
      task,
      ...(part ? { part } : {}),
      blocks: own,
      statement,
      sentences: all.flatMap((b) => b.sentences).filter((id) => sentences.has(id)),
      maths: all.filter((b) => !b.sentences.length && b.text.trim() && b.type !== 'header_footer').map((b) => b.id),
      pages: [...new Set(all.map((b) => b.page))],
      steps: 0,
      form: 'full',
    };
  };
  for (const task of doc.exercises ?? []) {
    const inParts = new Set(task.parts.flatMap((p) => p.blocks));
    const statement = task.blocks.filter((id) => !inParts.has(id));
    if (!task.parts.length) units.push(unit(task, undefined, task.blocks, []));
    for (const part of task.parts) units.push(unit(task, part, part.blocks, statement));
  }
  return units.filter((u) => u.blocks.length);
}

/**
 * Which parts the tour teaches and how deeply, within the preset's length (two steps go to the overview and the
 * takeaway; each part also keeps the steps unitOverhead counts). The preset sets the forms: quick teaches every part
 * compact, standard the first part of each task in full and its later parts as follow-ons, deep every part in full,
 * each with up to the preset's most solution lines (a compact part keeps to three). If that is too long, in this order:
 * fewer lines per part (never under two); then the later parts of the tasks turn compact, one at a time from the end of
 * the sheet, so that the first parts stay in full as long as possible; then later parts are dropped, the highest-ranked
 * and latest first; then the first parts turn compact too, from the end. A task's first part is never dropped: a sheet
 * with more tasks than the preset has room for keeps each of them compact with the fewest lines, so that the tour grows
 * past the preset only by what the number of tasks forces.
 */
export function planUnits(units: Unit[], preset: Preset): { taught: Unit[]; skipped: Unit[] } {
  if (!units.length) return { taught: [], skipped: [] };
  const room = SHEET_STEPS[preset] - 2;
  // A part's rank is its place in its task: 0 for the first part.
  const rank = units.map((u, i) => units.filter((o, j) => j < i && o.task === u.task).length);
  const forms: PartForm[] = units.map((_, i) =>
    preset === 'quick' ? 'compact' : preset === 'deep' || !rank[i] ? 'full' : 'follow',
  );
  /** The most solution lines of a part of this form: the preset's, and for the compact form at most three. */
  const most = (form: PartForm) => (form === 'compact' ? Math.min(COMPACT_LINES, STEP_CAP[preset]) : STEP_CAP[preset]);
  let chosen = units.map((_, i) => i);
  /** The most solution lines per part, up to the preset's, with which the chosen parts fit; 0 when two do not. */
  const linesFor = () => {
    for (let lines = STEP_CAP[preset]; lines >= STEP_FLOOR; lines--) {
      const length = chosen.reduce((n, i) => n + unitOverhead({ form: forms[i] }) + Math.min(lines, most(forms[i])), 0);
      if (length <= room) return lines;
    }
    return 0;
  };
  let lines = linesFor();
  /** Turns the given parts compact, the last first, until the chosen parts fit. */
  const compacting = (parts: number[]) => {
    for (const i of [...parts].reverse()) {
      if (lines) break;
      if (forms[i] === 'compact') continue;
      forms[i] = 'compact';
      lines = linesFor();
    }
  };
  compacting(chosen.filter((i) => rank[i] > 0));
  // Still too long: drop the later parts of the tasks, the highest-ranked and latest first. A task's first part stays.
  const dropping = chosen.filter((i) => rank[i] > 0).sort((a, b) => rank[b] - rank[a] || b - a);
  for (const gone of dropping) {
    if (lines) break;
    chosen = chosen.filter((i) => i !== gone);
    lines = linesFor();
  }
  compacting(chosen);
  const kept = new Set(chosen);
  return {
    taught: units.flatMap((u, i) =>
      kept.has(i) ? [{ ...u, steps: Math.min(lines || STEP_FLOOR, most(forms[i])), form: forms[i] }] : [],
    ),
    skipped: units.filter((_, i) => !kept.has(i)),
  };
}

/**
 * A sheet's tour: an overview, then each task as a chapter of its taught parts, then a takeaway that names the parts
 * left out. Without a usable card item, the overview and takeaway are left out rather than invented.
 */
export function exercisePlan(card: PaperCard, doc: Doc, preset: Preset): TourPlan {
  const { taught, skipped } = planUnits(exerciseUnits(doc), preset);
  const beats: Beat[] = [];
  const chapters: PlanChapter[] = [];
  const usable = (item: { text: string; evidence: string[] }) => Boolean(item.text && item.evidence.length);
  if (usable(card.problem)) {
    chapters.push({ id: 'overview', title: card.chapter_titles.problem });
    beats.push({
      id: 'overview-1',
      kind: 'overview',
      arc: 'overview',
      point: card.problem.text,
      evidence: card.problem.evidence,
      role: 'introduce the sheet: what it practises and which tasks the tour works through',
      notes: [`THE TOUR WORKS THROUGH: ${taught.map((u) => u.name).join('; ')}`],
    });
  }
  for (const unit of taught) {
    if (!chapters.some((c) => c.id === unit.task.id))
      chapters.push({ id: unit.task.id, title: taskName(doc, unit.task) });
    beats.push({
      id: `exercise-${unit.id}`,
      kind: 'exercise',
      arc: unit.task.id,
      point: unit.name,
      evidence: [],
      unit,
    });
  }
  if (usable(card.takeaway)) {
    chapters.push({ id: 'takeaway', title: card.chapter_titles.takeaway });
    beats.push({
      id: 'takeaway-1',
      kind: 'takeaway',
      arc: 'takeaway',
      point: card.takeaway.text,
      evidence: card.takeaway.evidence,
      questions: card.suggested_questions,
      role: 'sum up the methods the sheet practises',
      ...(skipped.length
        ? { notes: [`NOT COVERED, for the learner to try or ask about: ${skipped.map((u) => u.name).join('; ')}`] }
        : {}),
    });
  }
  return { type: 'exercise_sheet', chapters, beats };
}

// ------------------------------------------------------------------------------------------- solve call

/** The solve call's brief: the part's text with IDs, the maths only the page shows, and the parts before it. */
export function unitBrief(unit: Unit, doc: Doc): string {
  const points = unit.part?.points ?? unit.task.points;
  return [
    `EXERCISE: ${unit.name}${points !== undefined ? `, ${points} points` : ''}`,
    ...unitTaskLines(unit, doc),
    `The page${unit.pages.length > 1 ? 's' : ''} with this exercise ${unit.pages.length > 1 ? 'are' : 'is'} attached.`,
  ].join('\n');
}

/** What a part asks for; the solve call names it so that the tutor knows the kind of answer to work towards. */
export const SOLVE_KINDS = [
  'calculation',
  'derivation',
  'proof',
  'explanation',
  'chemical_equation',
  'choice',
  'sketch',
  'trace',
] as const;
export type SolveKind = (typeof SOLVE_KINDS)[number];
/** Longest background concept name and common mistake, in characters. */
const CONCEPT_MAX = 60;
const PITFALL_MAX = 160;

const object = (properties: Record<string, object>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});
const words = (most: number, description: string) => ({
  type: 'string',
  minLength: 1,
  maxLength: most * 9,
  description,
});
const anchor = { type: 'string', maxLength: 80, description: 'A 2-6 word phrase copied exactly from the say.' };

/** A board line of the solution: its LaTeX and the parts the narration lights up. */
function line(fewest: number, most: number, latexMin = 1) {
  return object({
    title: { type: 'string', maxLength: BOARD_LIMITS.title, description: 'What this line does, at most 5 words.' },
    latex: {
      type: 'string',
      minLength: latexMin,
      maxLength: 300,
      description: 'One line of maths that KaTeX renders.',
    },
    terms: {
      type: 'array',
      minItems: fewest,
      maxItems: most,
      items: object({
        latex: {
          type: 'string',
          minLength: 1,
          maxLength: 120,
          description: 'Copied character for character from latex.',
        },
        label: {
          type: 'string',
          minLength: 1,
          maxLength: BOARD_LIMITS.termLabel,
          description: 'At most 5 plain words.',
        },
        anchor,
      }),
    },
  });
}

/** The solve call's response schema; `strict` adds the ID enums (the code checks them again). */
export function solveSchema(unit: Unit, strict = true): object {
  if (!strict) {
    // The checkpoint is optional and checked by hand (cleanCoach): an answer without a usable one is still a solution.
    const loose = withoutMaxItems(solveSchema({ ...unit, sentences: [], maths: [] })) as {
      required: string[];
      properties: Record<string, object>;
    };
    // The checkpoint and the tutor's extras (the kind, the background, the check and the common mistake) are optional
    // and cleaned by hand: an answer without them is still a solution.
    const extras = ['try', 'kind', 'background', 'check', 'pitfall'];
    return {
      ...loose,
      required: loose.required.filter((key) => !extras.includes(key)),
      properties: { ...loose.properties, ...Object.fromEntries(extras.map((key) => [key, {}])) },
    };
  }
  // The task's sentences are listed once for the fields that cite them; a task of many pages offers its first
  // sentences and the rest is checked in code (schema-budget.ts).
  const sentence = { $ref: '#/$defs/sentenceId' };
  const { title, latex, terms } = line(1, 3).properties;
  return {
    $defs: { sentenceId: idEnum(pick(unit.sentences, UNIT_IDS)), mathId: idEnum(pick(unit.maths, UNIT_IDS)) },
    ...object({
      plan: { type: 'string', maxLength: 6000, description: 'Solve the exercise here first and check the result.' },
      kind: { type: 'string', enum: [...SOLVE_KINDS], description: 'What this part asks for.' },
      read: object({
        say: words(55, 'What is given, what is asked and the kind of answer, in 20-50 spoken words.'),
        given: { type: 'array', maxItems: 3, items: sentence },
        given_anchor: anchor,
        asked: { type: 'array', minItems: 1, maxItems: 2, items: sentence },
        asked_anchor: anchor,
        marks: {
          type: 'array',
          maxItems: unit.maths.length ? 1 : 0,
          items: object({ target: { $ref: '#/$defs/mathId' }, anchor }),
        },
      }),
      background: object({
        concept: {
          type: 'string',
          maxLength: CONCEPT_MAX,
          description: 'The concept, law or definition this part rests on; empty when it needs no background.',
        },
        say: {
          type: 'string',
          maxLength: 50 * 9,
          description:
            'The concept in plain words, why this part needs it and one everyday picture, in 20-50 spoken words; never solves the part. Empty without a concept.',
        },
        formula: line(0, 4, 0),
      }),
      method: object({
        say: words(45, 'The idea or method and why it fits, in 15-45 spoken words.'),
        formula: line(0, 4, 0),
      }),
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: Math.max(1, unit.steps),
        items: object({
          title,
          latex,
          terms,
          say: words(45, 'What this step does and why it works, in 10-45 spoken words.'),
          sure: { type: 'boolean', description: 'false when you are not certain this step is right' },
        }),
      },
      answer: object({ ...line(1, 2).properties, say: words(45, 'The result in words and a one-line summary.') }),
      check: object({
        say: {
          type: 'string',
          maxLength: 35 * 9,
          description:
            'How we know the answer is right (substitute back, units, size, a special case), in 10-35 spoken words. Empty when there is no check.',
        },
        latex: {
          type: 'string',
          maxLength: 300,
          description: 'One checkable line of the check, such as 5 \\cdot 3 + 2 = 17; empty when none.',
        },
      }),
      pitfall: {
        type: 'string',
        maxLength: PITFALL_MAX,
        description: 'The most common mistake on this part, in one sentence; empty when none.',
      },
      try: object({
        prompt: {
          type: 'string',
          minLength: 1,
          maxLength: COACH_PROMPT_MAX,
          description:
            'What the learner should try before seeing the solution, in 1-2 spoken sentences; never the result.',
        },
        hints: {
          type: 'array',
          maxItems: COACH_HINTS,
          items: { type: 'string', minLength: 1, maxLength: COACH_HINT_MAX },
          description: 'Up to 3 hints from a nudge to almost the answer; none contains the final result.',
        },
      }),
      check_note: {
        type: 'string',
        maxLength: 140,
        description: 'One short sentence asking the learner to check a step.',
      },
      questions: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'string', minLength: 1, maxLength: 120 } },
    }),
  };
}

/**
 * The schema the code checks an answer against: no ID enums and no maxItems, which the provider does not enforce;
 * cleanSolution keeps the first items of a list that is too long (of the solution lines the first ones and the last)
 * instead of rejecting the answer.
 */
function withoutMaxItems(node: unknown): object {
  if (Array.isArray(node)) return node.map(withoutMaxItems);
  if (typeof node !== 'object' || node === null) return node as object;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === 'maxItems') continue;
    if (key === 'enum' || (key === 'maxLength' && value === 0)) continue;
    out[key] = withoutMaxItems(value);
  }
  return out;
}

/** What a tutor does with one part (notes/TUTOR.md); the solve call's TASK line adds it to the sheet's general tone. */
const TUTOR_MOVES =
  'Work through the part as a tutor would: name what is given and asked, recall what is needed, plan, take one move ' +
  'per step and say why, then check the result.';

/**
 * The solve call's task: the tutor's moves as rules, then the worked examples of the part's subject (exercise-examples.ts)
 * for exercises other than this one. The part's text names the example when the card's subject does not.
 */
export function solveTask(language: string, brief: string, unit: Unit, subject?: Subject): string {
  const lang = JSON.stringify(language);
  const rules = [
    `Solve the exercise yourself in "plan" first, step by step, and check the result, for example by substituting it.
   Solving is your own work: the document gives the task, you give the solution.`,
    `"kind" is what this part asks for: calculation, derivation, proof, explanation, chemical_equation (balance or complete
   a reaction), choice (pick or judge options), sketch (draw or construct) or trace (follow an algorithm or a process).`,
    `READ. "read.say" says what is given, what is asked and the kind of answer expected ("a mass in grams", "a proof", "a
   probability"). "given" and "asked" are the IDs of the sentences that state them; each anchor is a 2-6 word phrase
   copied from "read.say" where you name them. When the givens are a formula or matrix listed under MATHS, add one
   "marks" entry for it.`,
    unit.form === 'full'
      ? `BACKGROUND. "background" is what a tutor recalls before starting, and only when this part rests on a concept, law
   or definition a student may not have ready (Bayes' rule, a molar mass, free fall, binary search). Leave "concept",
   "say" and the formula's latex empty for routine algebra and for anything the student has surely met. "concept" names
   it in at most ${CONCEPT_MAX} characters, in the usual words for it. "say" is 20-50 spoken words: the concept in plain
   words, why this part needs it and one everyday picture or example; it never solves the part and never states its
   result. "formula" writes the law or definition in general form (such as pV = nRT) with 0-4 terms, each anchored in
   "background.say"; leave its latex empty when there is none.`
      : `BACKGROUND. This part comes after the first part of its task, which gave the background, or the tour is short:
   leave "background.concept", "background.say" and the formula's latex empty.`,
    `TRY. "try" is the learner's turn: the tour stops after the task and the learner attempts the part before the solution
   is shown. "try.prompt" says in 1-2 spoken sentences in ${lang} what to try first, as a question or a first move, never
   the result. "try.hints" are 1-3 hints in ${lang} that go from a nudge to almost the answer: the first points at the
   idea or the question to ask, the second names the method or rule and the first move, the third carries out the first
   step but stops short of the result. No hint and not the prompt may contain the final result or the "answer" line.
   After a background step, ask for the first use of the background on this part, not for the concept the background
   just explained: "solve the law for t before putting in numbers", not "which law connects these quantities?".`,
    `METHOD. "method.say" is the plan in order and why it fits${unit.form === 'full' ? ', in 15-45 spoken words' : ': one or two short sentences'}.
   "method.formula" shows the rule you use, such as a formula from the lecture, with 1-4 terms; leave its latex and terms
   empty when no rule helps.`,
    `STEPS. "steps" are 1-${unit.steps} steps in order, ONE move per step: one thing is done to the line before it, and its
   "say" tells what is done and why it works. Each "latex" is ONE line that KaTeX renders: the line on the board after
   that step, such as "2x = 12", never prose. Write maths as maths. Write chemistry with \\ce{...} (mhchem), such as
   \\ce{2H2 + O2 -> 2H2O}, and units as \\,\\mathrm{g/mol}; never use siunitx macros such as \\SI or \\si. For an
   explanation or a proof a line may be a short statement in \\text{...} of at most 8 words, so that the board grows into
   the argument. Write each line so it can be checked on its own: restate a given equation, function or matrix in the first
   line that uses it.`,
    `Each line's "terms" are 1-3 parts of it to light up while you speak: copied character for character from its
   latex, a complete symbol or group (a whole \\ce{...} group, never a part of one), with a label of at most 5 words and
   an anchor copied from that step's "say".`,
    `Each step's "say" explains in 10-45 spoken words what you do and why it works. Read symbols aloud ("x squared",
   "the determinant of A"), never as LaTeX.`,
    `"sure" is false when you are not certain a step is right. Never guess silently: an honest "not sure" is better.`,
    `ANSWER. "answer" is the final result as one line of LaTeX, and its "say" states it in words with a one-line summary.`,
    `CHECK. "check.say" is 10-35 spoken words on how we know the answer is right: substitute it back, look at the units,
   the size, or a special case. "check.latex" is one checkable line of that check, such as "5 \\cdot 3 + 2 = 17"; leave
   both empty when nothing can be checked.`,
    `PITFALL. "pitfall" is one sentence of at most ${PITFALL_MAX} characters on the most common mistake on this part; empty
   when there is none.`,
    `"check_note" is one short sentence in ${lang} asking the learner to check a step themselves.`,
    `"questions" are two short questions in ${lang} a learner might ask about this exercise, such as why a step works.`,
    ...(unit.form === 'compact'
      ? [
          `Keep "read.say" and "method.say" short: the tour plays them as one step. The tour also says "answer.say" and
   "check.say" right after the last step, whose line shows the result. There, "answer.say" is one short summary
   sentence without the result, and "check.say" one short check.`,
        ]
      : []),
  ];
  const examples = exampleFor(subject, brief);
  return [
    `TASK: teach ONE exercise in ${lang}. ${TONE.exercise_sheet} ${TUTOR_MOVES}`,
    brief,
    ...rules.map((rule, i) => `${i + 1}. ${rule}`),
    `EXAMPLES for different exercises (copy their format, not their length: this part has at most ${unit.steps} steps, and the last one shows the result):`,
    ...examples.map((example) => JSON.stringify(example)),
  ].join('\n');
}

// ---------------------------------------------------------------------------------------- the solution

/** A board line that passed its checks (or null), with each term's anchor in the narration. */
export interface BoardLine {
  latex: string;
  title: string;
  board: FormulaItem | null;
  anchors: string[];
}
/** A checkpoint: what the learner tries first, and up to three hints from a nudge to almost the answer. */
export interface Coach {
  prompt: string;
  hints: string[];
}
export interface Solution {
  /** What the part asks for. */
  kind: SolveKind;
  read: {
    say: string;
    given: string[];
    givenAnchor: string;
    asked: string[];
    askedAnchor: string;
    mark?: string;
    markAnchor: string;
  };
  /** The concept the part rests on, in plain words, with the law or definition on the board; the concept is '' without one. */
  background: { concept: string; say: string; line: BoardLine | null };
  method: { say: string; line: BoardLine | null };
  steps: (BoardLine & { say: string; sure: boolean })[];
  answer: BoardLine & { say: string };
  /** How we know the answer is right, with one checkable line (a verifier checks it; null without one). */
  check: { say: string; line: BoardLine | null };
  /** The most common mistake on the part; '' without one. */
  pitfall: string;
  /** The learner's turn before the solution: what to try and the hints, none of which gives the result; null without one. */
  coach: Coach | null;
  checkNote: string;
  questions: string[];
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
type Raw = Record<string, unknown>;
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const spoken = (s: string) => s.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * A board line from the model: the formula when it renders with its first `most` terms (at least `fewest`), else null and
 * the problems.
 */
function boardLine(raw: Raw, name: string, problems: string[], most: number, fewest = 1): BoardLine {
  const given = (Array.isArray(raw.terms) ? raw.terms : []).slice(0, most) as Raw[];
  const latex = clean(raw.latex);
  const check = checkFormula({ title: raw.title, latex, terms: given }, { minTerms: fewest });
  problems.push(...check.problems.map((p) => `${name}: ${p}`));
  return {
    latex: check.item?.latex ?? latex,
    title: clean(raw.title).slice(0, BOARD_LIMITS.title),
    board: check.item,
    anchors: given.map((t) => clean(t.anchor)),
  };
}

const flatten = (text: string) =>
  text
    .toLowerCase()
    .replace(/\\(?:left|right|,|;|!|quad|displaystyle)/g, '')
    .replace(/\\(?:cdot|times)/g, '*')
    .replace(/[\s${}]/g, '');

/** Number words of the languages the sheets come in (English and German), for results that are small whole numbers. */
const NUMBER_WORDS: Record<number, string[]> = Object.fromEntries(
  [
    ['zero', 'null'],
    ['one', 'eins', 'ein'],
    ['two', 'zwei'],
    ['three', 'drei'],
    ['four', 'vier'],
    ['five', 'fuenf', 'fünf'],
    ['six', 'sechs'],
    ['seven', 'sieben'],
    ['eight', 'acht'],
    ['nine', 'neun'],
    ['ten', 'zehn'],
    ['eleven', 'elf'],
    ['twelve', 'zwoelf', 'zwölf'],
    ['thirteen', 'dreizehn'],
    ['fourteen', 'vierzehn'],
    ['fifteen', 'fuenfzehn', 'fünfzehn'],
    ['sixteen', 'sechzehn'],
    ['seventeen', 'siebzehn'],
    ['eighteen', 'achtzehn'],
    ['nineteen', 'neunzehn'],
    ['twenty', 'zwanzig'],
  ].map((words, n) => [n, words]),
);

/** The coefficients of a chemical formula or equation: the numbers in front of a formula, not its subscripts. */
const COEFFICIENT = /(?:^|[\s+>=])\d+(?:[.,/]\d+)?(?=\s*[A-Z(\[])/g;

/**
 * An answer line without the names inside it: the subscripts of chemical formulas and the exponents of unit names are
 * no result, but the coefficients of an equation are (the result of balancing it), and so are the numbers in a \text.
 */
const withoutNames = (latex: string) =>
  latex
    .replace(
      /\\ce\{((?:[^{}]|\{[^{}]*\})*)\}/g,
      (_, formula: string) => ` ${(formula.match(COEFFICIENT) ?? []).join(' ')} `,
    )
    .replace(/\\mathrm\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ');

/**
 * Whether a hint or a prompt gives the final result away: the answer's own line, its right-hand side, or a number of
 * the answer (in digits or, for a whole number from three to twenty, in words, since "one" and "two" are everyday words)
 * that the task itself does not already contain. The 2 of \ce{H2O} or of \mathrm{m/s^2} is no number of the answer, the
 * 4 of \ce{4Fe + 3O2 -> 2Fe2O3} is.
 */
export function leaksResult(text: string, answer: string, given: string): boolean {
  const heard = flatten(text);
  const line = flatten(answer);
  const result = flatten(answer.split('=').at(-1) ?? '');
  if (line.length >= 3 && heard.includes(line)) return true;
  if (result.length >= 3 && heard.includes(result)) return true;
  const known = new Set(numbersIn(given));
  const mine = new Set(numbersIn(text));
  const words = new Set(text.toLowerCase().match(/\p{L}+/gu) ?? []);
  return numbersIn(withoutNames(answer)).some(
    (n) => !known.has(n) && (mine.has(n) || (n >= 3 && (NUMBER_WORDS[n] ?? []).some((word) => words.has(word)))),
  );
}

/** A hint the sheet itself prints for the part: "Hint: ...", "Hinweis: ...". */
const PRINTED_HINT =
  /^\s*(?:hints?|tips?|hinweis(?:e)?|tipp|indice|pista|suggerimento|aanwijzing)\s*[:.)\u2013-]\s*(.+)$/i;

/** The checkpoint from the model's "try", or null when it has no usable prompt; the printed hints of the part come first. */
function cleanCoach(raw: unknown, answer: string, given: string, printed: string[]): Coach | null {
  const entry = (raw && typeof raw === 'object' ? raw : {}) as Raw;
  const prompt = clean(entry.prompt);
  if (spoken(prompt) < 3 || prompt.length > COACH_PROMPT_MAX || leaksResult(prompt, answer, given)) return null;
  // The ladder only gets more revealing, so everything from the first hint that gives the result away is left out.
  const own: string[] = [];
  for (const hint of (Array.isArray(entry.hints) ? entry.hints : []).map(clean).filter(Boolean)) {
    if (hint.length > COACH_HINT_MAX || leaksResult(hint, answer, given)) break;
    own.push(hint);
  }
  const hints = [
    ...new Set([...printed.filter((h) => h.length <= COACH_HINT_MAX && !leaksResult(h, answer, given)), ...own]),
  ];
  return { prompt, hints: hints.slice(0, COACH_HINTS) };
}

const isRaw = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const NO_BACKGROUND: Solution['background'] = { concept: '', say: '', line: null };

/**
 * The background the part rests on: its concept, the plain words, and the law on the board when it renders (a formula
 * that fails its LaTeX check is dropped, not fatal). Only a full part has one, and it comes before the checkpoint, so
 * words that give the result away leave it out.
 */
function cleanBackground(raw: unknown, form: PartForm, answer: string, given: string): Solution['background'] {
  const entry = isRaw(raw) ? raw : {};
  const concept = clean(entry.concept).slice(0, CONCEPT_MAX);
  const say = clean(entry.say);
  if (form !== 'full' || !concept || spoken(say) < 8 || leaksResult(say, answer, given)) return NO_BACKGROUND;
  const formula = isRaw(entry.formula) ? entry.formula : {};
  const line = clean(formula.latex) ? boardLine(formula, 'background.formula', [], 4, 0) : null;
  return { concept, say, line: line?.board ? line : null };
}

/** The check of the answer: what we say, and the line that shows it when it renders; nothing without the words. */
function cleanCheck(raw: unknown): Solution['check'] {
  const entry = isRaw(raw) ? raw : {};
  const say = clean(entry.say);
  if (spoken(say) < 4) return { say: '', line: null };
  const line = clean(entry.latex) ? boardLine({ latex: entry.latex }, 'check', [], 0, 0) : null;
  return { say, line: line?.board ? line : null };
}

/**
 * The solution with only known IDs and checked board lines; null when its shape or narration is unusable. Problems
 * with a board line are returned for one repair turn; the line then shows without its board if they stay. With the
 * document, the checkpoint's hints can also be checked against the task's own numbers and the sheet's printed hints
 * go first.
 */
export function cleanSolution(
  value: unknown,
  unit: Unit,
  doc?: Doc,
): { solution: Solution | null; problems: string[] } {
  const check = ajv.compile(solveSchema(unit, false));
  if (!check(value))
    return {
      solution: null,
      problems: (check.errors ?? []).slice(0, 8).map((e) => `${e.instancePath || '/'}: ${e.message}`),
    };
  const v = value as Raw & { read: Raw; method: Raw & { formula: Raw }; steps: Raw[]; answer: Raw };
  const problems: string[] = [];
  const own = new Set(unit.sentences);
  const ids = (list: unknown, most: number) =>
    [...new Set((list as string[]).filter((id) => own.has(id)))].slice(0, most);
  const asked = ids(v.read.asked, 2);
  const mark = clean((v.read.marks as Raw[])[0]?.target);
  const read = {
    say: clean(v.read.say),
    given: ids(v.read.given, 3).filter((id) => !asked.includes(id)),
    givenAnchor: clean(v.read.given_anchor),
    asked,
    askedAnchor: clean(v.read.asked_anchor),
    ...(unit.maths.includes(mark) ? { mark } : {}),
    markAnchor: clean((v.read.marks as Raw[])[0]?.anchor),
  };
  if (spoken(read.say) < 8) problems.push('read.say: say what is given and what is asked in at least 8 words');
  const formula = v.method.formula;
  const method = {
    say: clean(v.method.say),
    line: clean(formula.latex) ? boardLine(formula, 'method.formula', problems, 4) : null,
  };
  // Too many lines: the last one stays, since it carries the result (in the compact form the only place that shows it).
  const most = Math.max(1, unit.steps);
  const kept = v.steps.length > most ? [...v.steps.slice(0, most - 1), v.steps[v.steps.length - 1]] : v.steps;
  const steps = kept.map((s, i) => {
    const say = clean(s.say);
    if (spoken(say) < 5) problems.push(`step ${i + 1}: its say needs at least 5 words`);
    return { ...boardLine(s, `step ${i + 1}`, problems, 3), say, sure: s.sure !== false };
  });
  const answer = { ...boardLine(v.answer, 'answer', problems, 2), say: clean(v.answer.say) };
  const text = new Map((doc?.sentences ?? []).map((sentence) => [sentence.id, sentence.text]));
  const blocks = new Map((doc?.blocks ?? []).map((block) => [block.id, block]));
  const given = [
    ...unit.sentences.map((id) => text.get(id) ?? ''),
    ...unit.maths.map((id) => blocks.get(id)?.text ?? ''),
  ].join(' ');
  const printed = unit.blocks
    .flatMap((id) => blocks.get(id)?.sentences ?? [])
    .flatMap((id) => PRINTED_HINT.exec(text.get(id) ?? '')?.[1].trim() ?? []);
  const pitfall = clean(v.pitfall);
  const solution: Solution = {
    kind: SOLVE_KINDS.find((kind) => kind === v.kind) ?? 'calculation',
    read,
    background: cleanBackground(v.background, unit.form, answer.latex, given),
    method,
    steps,
    answer,
    check: cleanCheck(v.check),
    pitfall: spoken(pitfall) >= 3 && pitfall.length <= PITFALL_MAX * 1.5 ? pitfall : '',
    coach: cleanCoach(v.try, answer.latex, given, printed),
    checkNote: clean(v.check_note),
    questions: (v.questions as string[]).map(clean).filter(Boolean).slice(0, 2),
  };
  if (spoken(answer.say) < 5) problems.push('answer.say: state the result in at least 5 words');
  const usable = spoken(read.say) >= 8 && spoken(answer.say) >= 5 && steps.some((s) => spoken(s.say) >= 5);
  return { solution: usable ? solution : null, problems };
}

/** The lines a verifier checks, in order: every step, then the answer, then the check line when there is one. */
export const solutionLines = (s: Solution) => [
  ...s.steps.map((step) => step.latex),
  s.answer.latex,
  ...(s.check.line ? [s.check.line.latex] : []),
];
/** A verifier's line index as the repair turn names it. */
export const lineName = (s: Solution, i: number) =>
  i < s.steps.length ? `step ${i + 1}` : i === s.steps.length ? 'answer' : 'check';

/** One repair turn: the exact problems with the board lines and the maths, and the rest of the answer kept. */
export function solutionRepair(previous: unknown, problems: string[]): MuseMessage[] {
  return [
    { role: 'assistant', content: JSON.stringify(previous) },
    {
      role: 'user',
      content: [
        'Some lines cannot be shown or do not check out:',
        ...problems.map((p) => `- ${p}`),
        'Check those lines again (the steps, the answer and the check line) and return the complete answer with them',
        'fixed. If a step is right as it is, keep it and set "sure" honestly. If the check line is wrong, correct it, or',
        'leave "check.say" and "check.latex" empty. Keep everything else.',
      ].join('\n'),
    },
  ];
}

const BOARD_HOLD_MS = 800;

// Articles that start a concept name in the languages the sheets come in (English, German, French, Spanish, Italian,
// Portuguese, Dutch), which do not tell two names of one concept apart.
const ARTICLES = new Set(
  'the a an der die das den dem des ein eine einen einem einer eines le la les un une des du el los las una unos unas il lo gli i uno o os as um uma de het een'.split(
    ' ',
  ),
);

/**
 * A concept name as the tour compares it with the ones before it: lower case, accents folded, punctuation and a leading
 * article removed, white space collapsed ("The Bayes' Rule" is "bayes rule").
 */
export function conceptKey(concept: string): string {
  const words = concept
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b[ld][\u2019'`\u00b4](?=\p{L})/gu, '')
    .replace(/[\u2019'`\u00b4]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .split(' ')
    .filter(Boolean);
  while (words.length > 1 && ARTICLES.has(words[0])) words.shift();
  return words.join(' ');
}

/**
 * The key of the background the part's steps give (conceptKey of its concept), or '' when they give none: only a full
 * part has the background step. The tour gives each concept once, so a later part with the same key drops the step.
 */
export const backgroundKey = (unit: Pick<Unit, 'form'>, s: Solution) =>
  unit.form === 'full' ? conceptKey(s.background.concept) : '';

/** How a line comes onto the board: its verdict, the lines it follows, and the words it comes in at and lights terms to. */
interface BoardOptions {
  check?: LineCheck;
  before?: FormulaLine[];
  from?: number;
  until?: number;
}

/**
 * The steps that teach one part; `checks` are the verifier's verdicts on the solution lines, in order (solutionLines).
 * The steps are the tutor's moves: the task; the background, in the full form and when the part rests on a concept; the
 * checkpoint; the method; one step per solution line, its board line under the part's earlier lines; the answer, which
 * also says how we know it is right and the common mistake, and shows the check line under the answer. A line code
 * verified carries a check mark. The compact form joins the method to the first solution step and the answer to the last.
 * A method visual (exercise-visual.ts) shows with the method, after the checkpoint: on the method step, or in the compact
 * form on the first solution step, where the line's board follows it once the method has been said. It replaces the rule
 * the method step would show; the solution lines stay formula boards. The tour's language no longer matters to the
 * steps (a line the code could not verify carries no tag), so `_language` is kept only for the callers.
 */
export function unitSteps(
  unit: Unit,
  s: Solution,
  checks: LineCheck[],
  _language: string,
  visual?: UnitVisual | null,
): Step[] {
  const compact = unit.form === 'compact';
  const camera: Action = { type: 'focus', target: unit.blocks[0] };
  const at = (say: string, phrase: string) => {
    const word = phrase ? findAnchor(say, phrase) : null;
    return word ? { at_word: word } : {};
  };
  /** A line as the board keeps it above the lines after it: what it says, what it did, and whether code checked it. */
  const lineOf = (l: BoardLine, check?: LineCheck): FormulaLine => ({
    latex: l.board!.latex,
    ...(l.board!.title ? { title: l.board!.title } : {}),
    ...(check?.status === 'ok' ? { verified: true } : {}),
  });
  /** The part's solution lines shown so far (the first `count`), oldest first, as many as the board keeps. */
  const worked = (count: number): FormulaLine[] =>
    s.steps.slice(0, count).flatMap((step, i) => (step.board ? [lineOf(step, checks[i])] : []));
  /**
   * The line's board item, with the lines it follows and a check mark when code verified it, and a focus per named term.
   * `from` is the word the board comes in at (after a visual that the narration has been naming); a term named after
   * the word `until` is left to the board that replaces this one there.
   */
  const board = (
    l: BoardLine | null,
    say: string,
    { check, before = [], from = 0, until = Infinity }: BoardOptions = {},
  ): Action[] => {
    if (!l?.board) return [];
    const earlier = before.slice(-FORMULA_BEFORE_MAX);
    const item: FormulaItem = {
      ...l.board,
      ...(earlier.length ? { before: earlier } : {}),
      ...(check?.status === 'ok' ? { verified: true } : {}),
    };
    const out: Action[] = [{ type: 'board', item, ...(from ? { at_word: from } : {}) }];
    const used = new Set<number>();
    l.anchors.forEach((phrase, part) => {
      const word = phrase && part < item.terms.length ? findAnchor(say, phrase) : null;
      if (word === null || word < from || word >= until || used.has(word)) return;
      used.add(word);
      out.push({ type: 'board_focus', part, ...(word ? { at_word: word } : {}) });
    });
    return out;
  };
  /** The method visual and the parts of it the narration names, each lit up where it does. */
  const sketch = (v: UnitVisual, say: string): Action[] => [
    { type: 'board', item: v.item },
    ...v.focus.flatMap(({ part, anchor }): Action[] => {
      const word = findAnchor(say, anchor);
      return word === null ? [] : [{ type: 'board_focus', part, ...(word ? { at_word: word } : {}) }];
    }),
  ];
  /** A step that failed its check, or that its author doubts and the code could not confirm, asks for a check. */
  const doubt = (say: string, check: LineCheck | undefined, sure: boolean) =>
    check?.status === 'failed' || (!sure && check?.status !== 'ok') ? `${say} ${s.checkNote}`.trim() : say;

  const read = s.read;
  const answerCheck = checks[s.steps.length];
  const checkVerdict = s.check.line ? checks[s.steps.length + 1] : undefined;
  // The learner tries first, unless the answer line failed its check: a solution in doubt is not worth a pause.
  const coach = s.coach && answerCheck?.status !== 'failed' ? s.coach : null;
  // With a checkpoint the method must not be heard before the learner has tried: it opens the solution instead.
  const methodFirst = compact && Boolean(coach) && Boolean(s.method.say);
  const taskSay = compact && s.method.say && !coach ? `${read.say} ${s.method.say}` : read.say;
  const task: Action[] = [camera, ...(compact && !coach ? board(s.method.line, taskSay) : [])];
  if (read.given.length)
    task.push({ type: 'highlight', targets: read.given, color: 'blue', ...at(taskSay, read.givenAnchor) });
  if (read.asked.length)
    task.push({ type: 'highlight', targets: read.asked, color: 'yellow', ...at(taskSay, read.askedAnchor) });
  if (read.mark) task.push({ type: 'circle', target: read.mark, color: 'blue', ...at(taskSay, read.markAnchor) });
  const steps: Step[] = [{ id: `${unit.id}-task`, say: taskSay, actions: task }];
  // What a tutor recalls before the learner tries: the concept in plain words, with its law written term by term.
  if (backgroundKey(unit, s)) {
    const actions = [camera, ...board(s.background.line, s.background.say)];
    steps.push({
      id: `${unit.id}-background`,
      say: s.background.say,
      actions,
      ...(actions.length > 1 ? { hold_ms: BOARD_HOLD_MS } : {}),
    });
  }
  // Your turn: the tour stops here with the question still marked, and the next steps reveal the solution.
  if (coach)
    steps.push({
      id: `${unit.id}-try`,
      say: coach.prompt,
      actions: [
        camera,
        ...(read.asked.length ? [{ type: 'highlight' as const, targets: read.asked, color: 'yellow' as const }] : []),
      ],
      checkpoint: { prompt: coach.prompt, hints: coach.hints },
    });
  if (!compact && s.method.say) {
    const actions = [camera, ...(visual ? sketch(visual, s.method.say) : board(s.method.line, s.method.say))];
    steps.push({
      id: `${unit.id}-method`,
      say: s.method.say,
      actions,
      ...(actions.length > 1 ? { hold_ms: BOARD_HOLD_MS } : {}),
    });
  }
  const lead = doubt(s.answer.say, answerCheck, true) || s.answer.latex;
  // The check is said after the result; a check that failed asks for a look unless the answer already did.
  const checkSay = answerCheck?.status === 'failed' ? s.check.say : doubt(s.check.say, checkVerdict, true);
  const solved: Action = { type: 'highlight', targets: read.asked, color: 'green' };
  s.steps.forEach((step, i) => {
    // In compact form the last step also gives the answer and its check, and lights up the question once the result is said.
    const last = compact && i === s.steps.length - 1;
    const opening =
      i === 0 && methodFirst
        ? `${s.method.say} ${doubt(step.say, checks[i], step.sure)}`
        : doubt(step.say, checks[i], step.sure);
    const say = last ? [opening, lead, checkSay].filter(Boolean).join(' ') : opening;
    const shown = i === 0 && methodFirst && visual ? sketch(visual, s.method.say) : [];
    const actions = [
      camera,
      ...shown,
      ...board(step, say, {
        check: checks[i],
        before: worked(i),
        from: shown.length ? splitWords(s.method.say).length : 0,
      }),
    ];
    if (last && read.asked.length) actions.push({ ...solved, at_word: splitWords(opening).length });
    steps.push({ id: `${unit.id}-step-${i + 1}`, say, actions, hold_ms: BOARD_HOLD_MS });
  });
  if (compact && s.steps.length) return steps;
  // The answer under the working; then the check, whose line comes in at the word where its narration starts.
  const answerSay = [lead, checkSay, s.pitfall].filter(Boolean).join(' ');
  const checkAt = checkSay && s.check.line?.board ? splitWords(lead).length : 0;
  const all = worked(s.steps.length);
  const answer: Action[] = [
    camera,
    ...board(s.answer, answerSay, { check: answerCheck, before: all, until: checkAt || Infinity }),
    ...(checkAt
      ? board(s.check.line, answerSay, {
          check: checkVerdict,
          before: [...all, ...(s.answer.board ? [lineOf(s.answer, answerCheck)] : [])],
          from: checkAt,
        })
      : []),
  ];
  if (read.asked.length) answer.push(solved);
  steps.push({ id: `${unit.id}-answer`, say: answerSay, actions: answer, hold_ms: BOARD_HOLD_MS });
  return steps;
}

/** A part the model could not teach: its own text, pointed at, so the tour still covers it. */
export function unitFallback(unit: Unit, doc: Doc): Step[] {
  const text = new Map(doc.sentences.map((s) => [s.id, s.text]));
  const own = unit.sentences.filter((id) =>
    doc.blocks.some((b) => unit.blocks.includes(b.id) && b.sentences.includes(id)),
  );
  const first = own[0] ?? unit.sentences[0];
  const say = first ? `${unit.name}. ${text.get(first)}` : unit.name;
  const actions: Action[] = [{ type: 'focus', target: unit.blocks[0] }];
  if (first) actions.push({ type: 'highlight', targets: [first], color: 'yellow' });
  return [{ id: `${unit.id}-task`, say, actions }];
}
