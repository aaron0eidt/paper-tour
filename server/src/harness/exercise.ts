import Ajv2020 from 'ajv/dist/2020.js';
import {
  splitWords,
  type Action,
  type Doc,
  type DocExercise,
  type DocExercisePart,
  type Step,
} from '../../../shared/paper';
import type { MuseMessage } from '../muse/client';
import { findAnchor } from './assemble';
import { BOARD_LIMITS, checkFormula, numbersIn, type FormulaItem } from './board';
import type { Beat, PlanChapter, Preset, TourPlan } from './beats';
import type { PaperCard } from './card';
import { TONE } from './doctype';
import { taskName } from './paper-block';
import type { UnitVisual } from './exercise-visual';
import { unitTaskLines } from './unit-task';
import type { LineCheck } from './verify';

// The tutor for exercise sheets (notes/HARNESS.md, "Tutor"): each taught part gets one solve call that reads the task,
// names the method and writes the solution as lines of maths; code checks the lines' LaTeX and their maths, and turns
// the part into steps: the task (givens and question highlighted), the method, one board line per solution step built
// term by term, and the answer. When the tour is tight, the method joins the first solution line and the answer the last
// one. Before the solution comes a checkpoint (coach mode): the learner tries first, with up to three hints that go from
// a nudge to almost the answer and never contain the result, and the steps after it reveal the solution.

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
  /** When the tour is tight: the method joins the first solution step, and the answer the last one. */
  compact: boolean;
}

/** Tour length for a sheet by preset: longer than a paper's, since a solution step is short. */
export const SHEET_STEPS: Record<Preset, number> = { quick: 10, standard: 22, deep: 30 };
const STEP_CAP: Record<Preset, number> = { quick: 2, standard: 3, deep: 4 };
/** The checkpoint's limits, as the tour schema states them. */
const COACH_PROMPT_MAX = 300;
const COACH_HINT_MAX = 200;
const COACH_HINTS = 3;
/**
 * Steps of a part besides its solution steps: the task, the checkpoint, the method and the answer; in compact form the
 * task and the checkpoint, since the method joins the first solution step and the answer the last.
 */
export const unitOverhead = (unit: Pick<Unit, 'compact'>) => (unit.compact ? 2 : 4);

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
      compact: false,
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
 * takeaway; each part also keeps the steps unitOverhead counts, the checkpoint among them). Every part in full when it
 * fits with at least two solution steps (up to the preset's); else every part in compact form when each gets at least
 * two solution steps; else as many parts as fit, the first part of each task first, then the second ones, in reading
 * order.
 */
export function planUnits(units: Unit[], preset: Preset): { taught: Unit[]; skipped: Unit[] } {
  const room = SHEET_STEPS[preset] - 2;
  const cap = STEP_CAP[preset];
  if (!units.length) return { taught: [], skipped: [] };
  const each = Math.floor(room / units.length);
  const full = unitOverhead({ compact: false }),
    tight = unitOverhead({ compact: true });
  // Every part in full form with as many solution steps as fit (at least two), else in compact form.
  if (each >= full + 2) return { taught: units.map((u) => ({ ...u, steps: Math.min(cap, each - full) })), skipped: [] };
  if (each >= tight + 2)
    return { taught: units.map((u) => ({ ...u, steps: Math.min(cap, each - tight), compact: true })), skipped: [] };
  const rank = new Map<string, number>();
  for (const u of units)
    rank.set(u.id, units.filter((o) => o.task === u.task && units.indexOf(o) < units.indexOf(u)).length);
  const chosen = new Set(
    [...units]
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)! || units.indexOf(a) - units.indexOf(b))
      .slice(0, Math.max(1, Math.floor(room / (tight + 2))))
      .map((u) => u.id),
  );
  return {
    taught: units.filter((u) => chosen.has(u.id)).map((u) => ({ ...u, steps: 2, compact: true })),
    skipped: units.filter((u) => !chosen.has(u.id)),
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
    return {
      ...loose,
      required: loose.required.filter((key) => key !== 'try'),
      properties: { ...loose.properties, try: {} },
    };
  }
  const ids = (list: string[]) => (list.length ? { type: 'string', enum: list } : { type: 'string', maxLength: 0 });
  const { title, latex, terms } = line(1, 3).properties;
  return object({
    plan: { type: 'string', maxLength: 6000, description: 'Solve the exercise here first and check the result.' },
    read: object({
      say: words(55, 'What is given and what is asked, in 20-50 spoken words.'),
      given: { type: 'array', maxItems: 3, items: ids(unit.sentences) },
      given_anchor: anchor,
      asked: { type: 'array', minItems: 1, maxItems: 2, items: ids(unit.sentences) },
      asked_anchor: anchor,
      marks: { type: 'array', maxItems: unit.maths.length ? 1 : 0, items: object({ target: ids(unit.maths), anchor }) },
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
  });
}

/**
 * The schema the code checks an answer against: no ID enums and no maxItems, which the provider does not enforce;
 * cleanSolution keeps the first items of a list that is too long instead of rejecting the answer.
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

/** One short worked example for a different exercise (weak models copy the format and depth of examples). */
export const SOLVE_EXAMPLE = {
  plan: '5x + 2 = 17. Subtract 2: 5x = 15. Divide by 5: x = 3. Check: 5 * 3 + 2 = 17.',
  read: {
    say: 'We are given the equation five x plus two equals seventeen, and we are asked to find the value of x.',
    given: ['p2.s4'],
    given_anchor: 'five x plus two',
    asked: ['p2.s5'],
    asked_anchor: 'asked to find the value',
    marks: [],
  },
  method: {
    say: 'To solve a linear equation, we undo each operation on both sides, so the two sides stay equal.',
    formula: { title: '', latex: '', terms: [] },
  },
  steps: [
    {
      title: 'Subtract 2',
      latex: '5x = 15',
      terms: [
        { latex: '5x', label: 'five times the unknown', anchor: 'five x is left' },
        { latex: '15', label: '17 minus 2', anchor: 'seventeen minus two' },
      ],
      say: 'First we subtract two on both sides. On the left, five x is left, and on the right seventeen minus two gives fifteen.',
      sure: true,
    },
    {
      title: 'Divide by 5',
      latex: 'x = \\frac{15}{5} = 3',
      terms: [{ latex: '\\frac{15}{5}', label: 'fifteen shared into five', anchor: 'fifteen divided by five' }],
      say: 'Now we divide both sides by five, which leaves x alone. Fifteen divided by five is three.',
      sure: true,
    },
  ],
  answer: {
    title: 'Result',
    latex: 'x = 3',
    terms: [{ latex: '3', label: 'the solution', anchor: 'x equals three' }],
    say: 'So x equals three. Putting it back in, five times three plus two is seventeen, so the answer checks out.',
  },
  try: {
    prompt: 'Before we solve it, what would you do first to get the x term alone on one side?',
    hints: [
      'Look at what is added to the x term, and how you could undo it.',
      'Undo an addition by subtracting the same number from both sides, so the equation stays balanced.',
      'Subtracting that number leaves only the x term on the left; then ask what x is multiplied by.',
    ],
  },
  check_note: 'Please check this step yourself.',
  questions: ['Why do we do the same on both sides?', 'How can I check my answer?'],
};

export function solveTask(language: string, brief: string, unit: Unit): string {
  const lang = JSON.stringify(language);
  const rules = [
    `Solve the exercise yourself in "plan" first, step by step, and check the result, for example by substituting it.
   Solving is your own work: the document gives the task, you give the solution.`,
    `"read.say" says what is given and what is asked. "given" and "asked" are the IDs of the sentences that state them;
   each anchor is a 2-6 word phrase copied from "read.say" where you name them. When the givens are a formula or
   matrix listed under MATHS, add one "marks" entry for it.`,
    `"method.say" names the idea or method and why it fits. "method.formula" shows the rule you use, such as a formula
   from the lecture, with 1-4 terms; leave its latex and terms empty when no rule helps.`,
    `"steps" are 1-${unit.steps} steps in order. Each "latex" is ONE line of maths that KaTeX renders: the line on the
   board after that step, such as "2x = 12", never words. Write each line so it can be checked on its own: restate a
   given equation, function or matrix in the first line that uses it.`,
    `Each line's "terms" are 1-3 parts of it to light up while you speak: copied character for character from its
   latex, a complete symbol or group, with a label of at most 5 words and an anchor copied from that step's "say".`,
    `Each step's "say" explains in 10-45 spoken words what you do and why it works. Read symbols aloud ("x squared",
   "the determinant of A"), never as LaTeX.`,
    `"sure" is false when you are not certain a step is right. Never guess silently: an honest "not sure" is better.`,
    `"answer" is the final result as one line of LaTeX, and its "say" states it in words with a one-line summary.`,
    `"try" is the learner's turn: the tour stops after the task and the learner attempts the part before the solution is
   shown. "try.prompt" says in 1-2 spoken sentences in ${lang} what to try first, as a question or a first move, never the
   result. "try.hints" are 1-3 hints in ${lang} that go from a nudge to almost the answer: the first points at the idea or
   the question to ask, the second names the method or rule and the first move, the third carries out the first step but
   stops short of the result. No hint and not the prompt may contain the final result or the "answer" line.`,
    `"check_note" is one short sentence in ${lang} asking the learner to check a step themselves.`,
    `"questions" are two short questions in ${lang} a learner might ask about this exercise, such as why a step works.`,
    ...(unit.compact
      ? [
          `Keep "read.say" and "method.say" short: the tour plays them as one step. The tour also says "answer.say"
   right after the last step, whose line shows the result: there, do not repeat the result, give one short check or
   summary sentence instead.`,
        ]
      : []),
  ];
  return [
    `TASK: teach ONE exercise in ${lang}. ${TONE.exercise_sheet}`,
    brief,
    ...rules.map((rule, i) => `${i + 1}. ${rule}`),
    `EXAMPLE for a different exercise: ${JSON.stringify(SOLVE_EXAMPLE)}`,
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
  read: {
    say: string;
    given: string[];
    givenAnchor: string;
    asked: string[];
    askedAnchor: string;
    mark?: string;
    markAnchor: string;
  };
  method: { say: string; line: BoardLine | null };
  steps: (BoardLine & { say: string; sure: boolean })[];
  answer: BoardLine & { say: string };
  /** The learner's turn before the solution: what to try and the hints, none of which gives the result; null without one. */
  coach: Coach | null;
  checkNote: string;
  questions: string[];
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
type Raw = Record<string, unknown>;
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const spoken = (s: string) => s.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** A board line from the model: the formula when it renders with its first `most` terms, else null and the problems. */
function boardLine(raw: Raw, name: string, problems: string[], most: number): BoardLine {
  const given = (Array.isArray(raw.terms) ? raw.terms : []).slice(0, most) as Raw[];
  const latex = clean(raw.latex);
  const check = checkFormula({ title: raw.title, latex, terms: given }, { minTerms: 1 });
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

/**
 * Whether a hint or a prompt gives the final result away: the answer's own line, its right-hand side, or a number of
 * the answer (in digits or, for a whole number from three to twenty, in words, since "one" and "two" are everyday words)
 * that the task itself does not already contain.
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
  return numbersIn(answer).some(
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
  const steps = v.steps.slice(0, Math.max(1, unit.steps)).map((s, i) => {
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
  const solution: Solution = {
    read,
    method,
    steps,
    answer,
    coach: cleanCoach(v.try, answer.latex, given, printed),
    checkNote: clean(v.check_note),
    questions: (v.questions as string[]).map(clean).filter(Boolean).slice(0, 2),
  };
  if (spoken(answer.say) < 5) problems.push('answer.say: state the result in at least 5 words');
  const usable = spoken(read.say) >= 8 && spoken(answer.say) >= 5 && steps.some((s) => spoken(s.say) >= 5);
  return { solution: usable ? solution : null, problems };
}

/** The lines a verifier checks, in order: every step, then the answer. */
export const solutionLines = (s: Solution) => [...s.steps.map((step) => step.latex), s.answer.latex];
/** A verifier's line index as the repair turn names it. */
export const lineName = (s: Solution, i: number) => (i < s.steps.length ? `step ${i + 1}` : 'answer');

/** One repair turn: the exact problems with the board lines and the maths, and the rest of the answer kept. */
export function solutionRepair(previous: unknown, problems: string[]): MuseMessage[] {
  return [
    { role: 'assistant', content: JSON.stringify(previous) },
    {
      role: 'user',
      content: [
        'Some lines cannot be shown or do not check out:',
        ...problems.map((p) => `- ${p}`),
        'Check those steps again and return the complete answer with them fixed. If a step is right as it is, keep it',
        'and set "sure" honestly. Keep everything else.',
      ].join('\n'),
    },
  ];
}

/** "Unchecked" in the tour's language, for the board title of a line the code could not verify. */
const UNCHECKED: Record<string, string> = {
  en: 'unchecked',
  de: 'ungeprüft',
  fr: 'non vérifié',
  es: 'sin comprobar',
  it: 'da verificare',
  pt: 'não verificado',
  nl: 'niet gecontroleerd',
};
const BOARD_HOLD_MS = 800;

/**
 * The steps that teach one part; `checks` are the verifier's verdicts on the solution lines, in order. A method visual
 * (exercise-visual.ts) shows with the method, after the checkpoint: on the method step, or in the compact form on the
 * first solution step, where the line's board follows it once the method has been said. It replaces the rule the method
 * step would show; the solution lines stay formula boards.
 */
export function unitSteps(
  unit: Unit,
  s: Solution,
  checks: LineCheck[],
  language: string,
  visual?: UnitVisual | null,
): Step[] {
  const tag = UNCHECKED[language.slice(0, 2).toLowerCase()] ?? UNCHECKED.en;
  const camera: Action = { type: 'focus', target: unit.blocks[0] };
  const at = (say: string, phrase: string) => {
    const word = phrase ? findAnchor(say, phrase) : null;
    return word ? { at_word: word } : {};
  };
  /** The line's board item, titled "unchecked" when the code could not verify it, and a focus per named term. */
  const board = (l: BoardLine | null, say: string, check?: LineCheck, from = 0): Action[] => {
    if (!l?.board) return [];
    const title = check && check.status !== 'ok' ? [l.title, tag].filter(Boolean).join(' · ') : l.title;
    const item: FormulaItem = { ...l.board, ...(title ? { title } : {}) };
    // From a word on (after a visual that the narration has been naming): the board and its terms come in there.
    const out: Action[] = [{ type: 'board', item, ...(from ? { at_word: from } : {}) }];
    const used = new Set<number>();
    l.anchors.forEach((phrase, part) => {
      const word = phrase && part < item.terms.length ? findAnchor(say, phrase) : null;
      if (word === null || word < from || used.has(word)) return;
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
  // The learner tries first, unless the answer line failed its check: a solution in doubt is not worth a pause.
  const coach = s.coach && answerCheck?.status !== 'failed' ? s.coach : null;
  // With a checkpoint the method must not be heard before the learner has tried: it opens the solution instead.
  const methodFirst = unit.compact && Boolean(coach) && Boolean(s.method.say);
  const taskSay = unit.compact && s.method.say && !coach ? `${read.say} ${s.method.say}` : read.say;
  const task: Action[] = [camera, ...(unit.compact && !coach ? board(s.method.line, taskSay) : [])];
  if (read.given.length)
    task.push({ type: 'highlight', targets: read.given, color: 'blue', ...at(taskSay, read.givenAnchor) });
  if (read.asked.length)
    task.push({ type: 'highlight', targets: read.asked, color: 'yellow', ...at(taskSay, read.askedAnchor) });
  if (read.mark) task.push({ type: 'circle', target: read.mark, color: 'blue', ...at(taskSay, read.markAnchor) });
  const steps: Step[] = [{ id: `${unit.id}-task`, say: taskSay, actions: task }];
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
  if (!unit.compact && s.method.say) {
    const actions = [camera, ...(visual ? sketch(visual, s.method.say) : board(s.method.line, s.method.say))];
    steps.push({
      id: `${unit.id}-method`,
      say: s.method.say,
      actions,
      ...(actions.length > 1 ? { hold_ms: BOARD_HOLD_MS } : {}),
    });
  }
  const answerSay = doubt(s.answer.say, answerCheck, true) || s.answer.latex;
  const solved: Action = { type: 'highlight', targets: read.asked, color: 'green' };
  s.steps.forEach((step, i) => {
    // In compact form the last step also gives the answer, and lights up the question once the result is said.
    const last = unit.compact && i === s.steps.length - 1;
    const lead =
      i === 0 && methodFirst
        ? `${s.method.say} ${doubt(step.say, checks[i], step.sure)}`
        : doubt(step.say, checks[i], step.sure);
    const say = last ? `${lead} ${answerSay}` : lead;
    const shown = i === 0 && methodFirst && visual ? sketch(visual, s.method.say) : [];
    const actions = [
      camera,
      ...shown,
      ...board(step, say, checks[i], shown.length ? splitWords(s.method.say).length : 0),
    ];
    if (last && read.asked.length) actions.push({ ...solved, at_word: splitWords(lead).length });
    steps.push({ id: `${unit.id}-step-${i + 1}`, say, actions, hold_ms: BOARD_HOLD_MS });
  });
  if (unit.compact && s.steps.length) return steps;
  const answer: Action[] = [camera, ...board(s.answer, answerSay, answerCheck)];
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
