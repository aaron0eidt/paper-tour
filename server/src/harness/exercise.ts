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
import { BOARD_LIMITS, checkFormula, type FormulaItem } from './board';
import type { Beat, PlanChapter, Preset, TourPlan } from './beats';
import type { PaperCard } from './card';
import { TONE } from './doctype';
import { taskName } from './paper-block';
import type { LineCheck } from './verify';

// The tutor for exercise sheets (notes/HARNESS.md, "Tutor"): each taught part gets one solve call that reads the task,
// names the method and writes the solution as lines of maths; code checks the lines' LaTeX and their maths, and turns
// the part into steps: the task (givens and question highlighted), the method, one board line per solution step built
// term by term, and the answer. When the tour is tight, the method joins the task and the answer the last line.

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
  /** When the tour is tight: the task and the method in one step, and the answer with the last solution step. */
  compact: boolean;
}

/** Tour length for a sheet by preset: longer than a paper's, since a solution step is short. */
export const SHEET_STEPS: Record<Preset, number> = { quick: 10, standard: 22, deep: 30 };
const STEP_CAP: Record<Preset, number> = { quick: 2, standard: 3, deep: 4 };
/** Steps of a part besides its solution steps: the task, the method and the answer, or one in compact form. */
export const unitOverhead = (unit: Pick<Unit, 'compact'>) => (unit.compact ? 1 : 3);

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
 * takeaway). Every part in full when it fits with the preset's solution steps; else every part in compact form when
 * each gets at least two solution steps; else as many parts as fit, the first part of each task first, then the second
 * ones, in reading order.
 */
export function planUnits(units: Unit[], preset: Preset): { taught: Unit[]; skipped: Unit[] } {
  const room = SHEET_STEPS[preset] - 2;
  const cap = STEP_CAP[preset];
  if (!units.length) return { taught: [], skipped: [] };
  const each = Math.floor(room / units.length);
  if (each >= 3 + cap) return { taught: units.map((u) => ({ ...u, steps: cap })), skipped: [] };
  if (each >= 3)
    return { taught: units.map((u) => ({ ...u, steps: Math.min(cap, each - 1), compact: true })), skipped: [] };
  const rank = new Map<string, number>();
  for (const u of units)
    rank.set(u.id, units.filter((o) => o.task === u.task && units.indexOf(o) < units.indexOf(u)).length);
  const chosen = new Set(
    [...units]
      .sort((a, b) => rank.get(a.id)! - rank.get(b.id)! || units.indexOf(a) - units.indexOf(b))
      .slice(0, Math.max(1, Math.floor(room / 3)))
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
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const quote = (ids: string[]) =>
    ids.flatMap((id) => blocks.get(id)?.sentences ?? []).map((id) => `[${id}] ${sentences.get(id)?.text ?? ''}`);
  const points = unit.part?.points ?? unit.task.points;
  const lines = [`EXERCISE: ${unit.name}${points !== undefined ? `, ${points} points` : ''}`];
  if (unit.statement.length) lines.push('TASK STATEMENT, shared by its parts:', ...quote(unit.statement));
  lines.push(unit.part ? 'THIS PART:' : 'THE TASK:', ...quote(unit.blocks));
  if (unit.maths.length)
    lines.push(
      'MATHS ON THE PAGE as extracted (often garbled; read it in the page image):',
      ...unit.maths.map((id) => `[${id}] ${blocks.get(id)!.text.replace(/\s+/g, ' ').trim()}`),
    );
  const earlier = unit.part ? unit.task.parts.slice(0, unit.task.parts.indexOf(unit.part)) : [];
  if (earlier.length)
    lines.push(
      'EARLIER PARTS OF THIS TASK:',
      ...earlier.map((p) => `${p.label}) ${quote(p.blocks.slice(0, 1)).join(' ')}`),
    );
  lines.push(
    `The page${unit.pages.length > 1 ? 's' : ''} with this exercise ${unit.pages.length > 1 ? 'are' : 'is'} attached.`,
  );
  return lines.join('\n');
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
  if (!strict) return withoutMaxItems(solveSchema({ ...unit, sentences: [], maths: [] }));
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

/**
 * The solution with only known IDs and checked board lines; null when its shape or narration is unusable. Problems
 * with a board line are returned for one repair turn; the line then shows without its board if they stay.
 */
export function cleanSolution(value: unknown, unit: Unit): { solution: Solution | null; problems: string[] } {
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
  const solution: Solution = {
    read,
    method,
    steps,
    answer,
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

/** The steps that teach one part; `checks` are the verifier's verdicts on the solution lines, in order. */
export function unitSteps(unit: Unit, s: Solution, checks: LineCheck[], language: string): Step[] {
  const tag = UNCHECKED[language.slice(0, 2).toLowerCase()] ?? UNCHECKED.en;
  const camera: Action = { type: 'focus', target: unit.blocks[0] };
  const at = (say: string, phrase: string) => {
    const word = phrase ? findAnchor(say, phrase) : null;
    return word ? { at_word: word } : {};
  };
  /** The line's board item, titled "unchecked" when the code could not verify it, and a focus per named term. */
  const board = (l: BoardLine | null, say: string, check?: LineCheck): Action[] => {
    if (!l?.board) return [];
    const title = check && check.status !== 'ok' ? [l.title, tag].filter(Boolean).join(' · ') : l.title;
    const item: FormulaItem = { ...l.board, ...(title ? { title } : {}) };
    const out: Action[] = [{ type: 'board', item }];
    const used = new Set<number>();
    l.anchors.forEach((phrase, part) => {
      const word = phrase && part < item.terms.length ? findAnchor(say, phrase) : null;
      if (word === null || used.has(word)) return;
      used.add(word);
      out.push({ type: 'board_focus', part, ...(word ? { at_word: word } : {}) });
    });
    return out;
  };
  /** A step that failed its check, or that its author doubts and the code could not confirm, asks for a check. */
  const doubt = (say: string, check: LineCheck | undefined, sure: boolean) =>
    check?.status === 'failed' || (!sure && check?.status !== 'ok') ? `${say} ${s.checkNote}`.trim() : say;

  const read = s.read;
  const taskSay = unit.compact && s.method.say ? `${read.say} ${s.method.say}` : read.say;
  const task: Action[] = [camera, ...(unit.compact ? board(s.method.line, taskSay) : [])];
  if (read.given.length)
    task.push({ type: 'highlight', targets: read.given, color: 'blue', ...at(taskSay, read.givenAnchor) });
  if (read.asked.length)
    task.push({ type: 'highlight', targets: read.asked, color: 'yellow', ...at(taskSay, read.askedAnchor) });
  if (read.mark) task.push({ type: 'circle', target: read.mark, color: 'blue', ...at(taskSay, read.markAnchor) });
  const steps: Step[] = [{ id: `${unit.id}-task`, say: taskSay, actions: task }];
  if (!unit.compact && s.method.say) {
    const actions = [camera, ...board(s.method.line, s.method.say)];
    steps.push({
      id: `${unit.id}-method`,
      say: s.method.say,
      actions,
      ...(actions.length > 1 ? { hold_ms: BOARD_HOLD_MS } : {}),
    });
  }
  const answerCheck = checks[s.steps.length];
  const answerSay = doubt(s.answer.say, answerCheck, true) || s.answer.latex;
  const solved: Action = { type: 'highlight', targets: read.asked, color: 'green' };
  s.steps.forEach((step, i) => {
    // In compact form the last step also gives the answer, and lights up the question once the result is said.
    const last = unit.compact && i === s.steps.length - 1;
    const own = doubt(step.say, checks[i], step.sure);
    const say = last ? `${own} ${answerSay}` : own;
    const actions = [camera, ...board(step, say, checks[i])];
    if (last && read.asked.length) actions.push({ ...solved, at_word: splitWords(own).length });
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
