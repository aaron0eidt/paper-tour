import Ajv2020 from 'ajv/dist/2020.js';
import { splitWords, type Action, type Doc, type Step } from '../../../shared/paper';
import { findAnchor } from './assemble';
import { numbersIn } from './board';
import { MAX_STEPS, type Beat, type BeatKind, type PlanChapter, type Preset, type TourPlan } from './beats';
import { COACH_HINT_MAX, COACH_PROMPT_MAX, leaksResult } from './exercise';
import { equationName } from './equations';
import { readsSource } from './insight';
import type { Move } from './moves';
import { idEnum } from './schema-budget';

// Quick checks (notes/ROADMAP.md, learning): at the end of a chapter of a paper or a lecture that teaches a mechanism or
// a result, the tour stops and asks the learner to predict or recall one thing the chapter just showed, with up to three
// hints. It uses the checkpoint of an exercise sheet (the tour waits; the next step reveals) but it is practice, never a
// grade: nothing is scored and no answer is called wrong. One small call per chapter writes it from what the chapter
// said; code decides where checks go, keeps the hints from giving the answer away, and builds the two steps.

/** Most checks in a tour by preset: none in a quick tour, two in a standard one. */
export const CHECK_LIMIT: Record<Preset, number> = { quick: 0, standard: 2, deep: 3 };
/** The steps a check adds: the question and the answer. */
export const CHECK_STEPS = 2;
/** Shorter tours are not interrupted. */
const MIN_BEATS = 6;
/** The document types whose chapters teach mechanisms and results; an exercise sheet has its own try-first steps. */
const CHECK_TYPES: readonly string[] = ['research_paper', 'lecture'];

/** The quick check's answer is brief: it is spoken after a pause, not taught again. */
const ANSWER_WORDS = 60;
const ANSWER_MAX = 300;
/** A chapter that said less than this has nothing to ask about. */
const MIN_NARRATION = 40;
const MAX_SENTENCES = 10;
const MAX_ELEMENTS = 4;
const CLIP = 220;

// ------------------------------------------------------------------------------------------------- where

const KIND_WEIGHT: Partial<Record<BeatKind, number>> = { method: 2, formula: 2, result: 2, figure: 1, point: 1 };
const MOVE_WEIGHT: Partial<Record<Move, number>> = { why: 2, evidence: 2 };

/**
 * How much a step teaches that a learner can predict or recall: a mechanism, an equation or a result counts most, a
 * figure or a point of a lecture less (two of them, or one with a figure or a board, make a chapter), and the framing
 * steps (the problem, the claim as stated, the catch, the takeaway) nothing.
 */
function teaches(beat: Beat): number {
  if (beat.move) return MOVE_WEIGHT[beat.move] ?? 0;
  const base = KIND_WEIGHT[beat.kind] ?? 0;
  return beat.kind === 'point' && (beat.board || beat.target) ? base + 1 : base;
}

/** A chapter that closes with a check: its beats (indices into the plan's), and the number the check is named by. */
export interface CheckSite {
  n: number;
  chapter: PlanChapter;
  beats: number[];
}

/**
 * Where a tour stops to check: at the end of at most `CHECK_LIMIT` chapters of a paper or a lecture that teach
 * something to predict or recall, spread over the tour, never the last chapter (the takeaway follows nothing) and never
 * in a quick tour, a short one or past the tour's step limit.
 */
export function checkSites(plan: TourPlan, preset: Preset): CheckSite[] {
  if (!CHECK_TYPES.includes(plan.type) || plan.beats.length < MIN_BEATS || plan.beats.some((beat) => beat.unit))
    return [];
  const chapters = plan.chapters
    .map((chapter) => ({
      chapter,
      beats: plan.beats.flatMap((beat, i) => (beat.arc === chapter.id ? [i] : [])),
    }))
    .filter((c) => c.beats.length);
  const eligible = chapters.slice(0, -1).filter((c) => c.beats.reduce((n, i) => n + teaches(plan.beats[i]), 0) >= 2);
  const most = Math.min(
    CHECK_LIMIT[preset],
    eligible.length,
    Math.floor((MAX_STEPS - plan.beats.length) / CHECK_STEPS),
  );
  // Evenly through the eligible chapters, so that two checks do not sit side by side.
  return Array.from(
    { length: Math.max(0, most) },
    (_, k) => eligible[Math.floor(((k + 0.5) * eligible.length) / most)],
  ).map((c, k) => ({ n: k + 1, ...c }));
}

// ------------------------------------------------------------------------------------------------- the material

/** What the chapter said and pointed at, which is all a check may rest on. */
export interface CheckMaterial {
  title: string;
  /** The narration of the chapter's steps, in order. */
  narration: string[];
  sentences: { id: string; text: string }[];
  /** Figures, tables and equations the chapter pointed at. */
  elements: { id: string; label: string }[];
  /** Whether there is enough to ask about, and something to point at when the answer comes. */
  ready: boolean;
}

const spoken = (s: string) => s.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const clip = (s: string) => (s.length > CLIP ? `${s.slice(0, CLIP - 1).trimEnd()}…` : s);

const idsOf = (action: Action): string[] =>
  'targets' in action ? action.targets : 'target' in action ? [action.target] : [];

/**
 * The material of a chapter from its finished steps: their narration, the sentences they highlighted (then the beats'
 * evidence) and the figures, tables and equations they pointed at (a panel counts as its figure).
 */
export function checkMaterial(title: string, steps: Step[], beats: Beat[], doc: Doc): CheckMaterial {
  const text = new Map(doc.sentences.map((s) => [s.id, s.text]));
  const figures = new Map(doc.figures.flatMap((f) => [[f.id, f] as const, ...f.panels.map((p) => [p.id, f] as const)]));
  const equations = new Map(doc.equations.map((e) => [e.id, e]));
  const pointed = [
    ...steps.flatMap((step) => step.actions.flatMap(idsOf)),
    ...beats.flatMap((beat) => [...beat.evidence, ...(beat.target ? [beat.target] : [])]),
  ];
  const sentences = [...new Set(pointed)]
    .filter((id) => text.has(id))
    .slice(0, MAX_SENTENCES)
    .map((id) => ({ id, text: clip(text.get(id)!) }));
  const elements = [...new Set(pointed.flatMap((id) => figures.get(id)?.id ?? (equations.has(id) ? [id] : [])))]
    .slice(0, MAX_ELEMENTS)
    .map((id) => {
      const figure = figures.get(id);
      const equation = equations.get(id);
      return {
        id,
        label: figure
          ? clip(`${figure.kind === 'table' ? 'Table' : 'Figure'} ${figure.number}: ${figure.caption}`)
          : equationName(equation!),
      };
    });
  const narration = steps.map((step) => step.say);
  return {
    title,
    narration,
    sentences,
    elements,
    ready: spoken(narration.join(' ')) >= MIN_NARRATION && sentences.length + elements.length > 0,
  };
}

/** The ids the answer's cue may point at: the chapter's own elements first, since a figure is the clearer cue. */
export const checkTargets = (m: CheckMaterial) => [...m.elements.map((e) => e.id), ...m.sentences.map((s) => s.id)];

/** The chapter as the check call reads it. */
export function checkBrief(m: CheckMaterial): string {
  return [
    `CHAPTER "${m.title}". WHAT THE TOUR JUST SAID, step by step:`,
    ...m.narration.map((say, i) => `${i + 1}. ${say}`),
    'WHAT IT POINTED AT (the IDs "target" may use):',
    ...m.elements.map((e) => `[${e.id}] ${e.label}`),
    ...m.sentences.map((s) => `[${s.id}] ${s.text}`),
  ].join('\n');
}

// ------------------------------------------------------------------------------------------------- the call

const KINDS = ['predict', 'recall'] as const;

/**
 * The call's response schema. `strict` adds the enum of IDs the answer may point at and the length limits; the schema
 * the code checks against has neither, since cleanCheck judges lengths itself (a hint that is too long ends the ladder
 * instead of failing the whole check) and falls back to the chapter's own target.
 */
export function checkSchema(ids: string[], strict = true) {
  const text = (maxLength: number, description: string) => ({
    type: 'string',
    ...(strict ? { maxLength } : {}),
    description,
  });
  const list = (max: number, items: object, description: string) => ({
    type: 'array',
    ...(strict ? { maxItems: max } : {}),
    items,
    description,
  });
  const properties = {
    plan: text(600, 'A few words: what the chapter taught, and the one thing worth predicting or recalling.'),
    fits: {
      type: 'boolean',
      description:
        'false when the chapter has no mechanism, result or key point to predict or recall; then leave the rest empty.',
    },
    kind: { type: 'string', enum: KINDS },
    prompt: text(COACH_PROMPT_MAX, 'The question, in 1-2 spoken sentences. It never states the answer.'),
    hints: list(
      3,
      text(COACH_HINT_MAX, 'A hint; none contains the answer or a word of "keys".'),
      'Up to 3 hints, from a nudge to almost the answer.',
    ),
    answer: text(ANSWER_MAX, 'The answer, spoken, in 1-2 sentences of at most 40 words.'),
    keys: list(
      3,
      text(30, 'One word or number copied exactly from the answer.'),
      'The words or numbers that would give the answer away.',
    ),
    target: strict ? idEnum(ids) : { type: 'string' },
    anchor: text(80, 'A 2-6 word phrase copied from the answer, where the page is pointed at.'),
  };
  return {
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  };
}

/** A check for a different document (weak models copy the format and depth of examples). */
const EXAMPLE = {
  plan: 'The chapter showed that each comparison halves the search range, so a doubled list costs one more step.',
  fits: true,
  kind: 'predict',
  prompt: 'Before the next step: if the list becomes twice as long, how many more comparisons does the search need?',
  hints: [
    'Think about what a single comparison does to the part of the list that is still possible.',
    'Each comparison cuts the remaining part in half.',
    'Doubling the list adds a small, fixed amount of extra work.',
  ],
  answer:
    'Only one extra comparison. Each comparison halves the remaining range, so doubling the list adds a single halving.',
  keys: ['one', 'single'],
  target: 'p2.s3',
  anchor: 'adds a single halving',
};

/** The call's task text; the chapter's material follows it. */
export function checkTask(language: string, brief: string): string {
  const lang = JSON.stringify(language);
  const rules = [
    `"fits" is true when what the tour just said contains a mechanism the learner can reason about, or a result or key
   point the learner can recall. It is false when the chapter only introduces, defines or lists things.`,
    `"kind" is "predict" when you ask what happens to one thing if another changes, or what a result will be, for a
   mechanism or relationship the chapter showed; "recall" when you ask for the chapter's key point or result in the
   learner's own words.`,
    `"prompt" is one or two spoken sentences in ${lang} that open with a short lead-in such as "Before the next step:".
   It asks one thing, answerable from the narration and sentences above alone: no outside knowledge, no trick, no
   choice between options, no yes-or-no question. It never states the answer and never calls itself a quiz or a test.`,
    `"hints" are up to 3 short hints in ${lang}, from a nudge to almost the answer: the first points at where in the
   chapter to look, the second names the idea or relationship, the third narrows it down. No hint states the answer or
   contains a word of "keys".`,
    `"answer" is what the learner hears next, in ${lang}: the answer first in one or two sentences of at most 40 words,
   then the one reason from the chapter. In your own words, not read from the sentences above.`,
    `"keys" are 1-3 single words or numbers copied exactly from "answer" that would give it away. None may appear in
   "prompt".`,
    `"target" is the ID, from the list above, of the sentence, figure or equation that shows the answer on the page;
   "anchor" is a 2-6 word phrase copied from "answer" where it is pointed at.`,
    'A quick check is practice: nothing is scored and nobody is told they are wrong.',
  ];
  return [
    `TASK: write ONE quick check for the learner, in ${lang}. The tour has just finished a chapter. The learner now stops
for about twenty seconds, thinks, and then hears the answer.`,
    brief,
    ...rules.map((rule, i) => `${i + 1}. ${rule}`),
    `EXAMPLE for a different document: ${JSON.stringify(EXAMPLE)}`,
  ].join('\n');
}

// ------------------------------------------------------------------------------------------------- the answer

const tokens = (s: string) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+(?:[.,]\p{N}+)*/gu) ?? [];
/** Light stemming for the languages the documents come in: "shut" and "shutting", "closes" and "closed" are one word. */
const stem = (w: string) => (w.length >= 5 ? w.slice(0, Math.max(5, w.length - 3)) : w);
const sameWord = (a: string, b: string) =>
  a === b ||
  (Math.min(a.length, b.length) >= 4 &&
    !/\d/.test(a + b) &&
    (a.startsWith(b) || b.startsWith(a) || stem(a).startsWith(stem(b)) || stem(b).startsWith(stem(a))));

/** The words that give the answer away: those of `keys` the answer has and the question does not already say. */
function giveaways(keys: unknown, prompt: string, answer: string): string[] {
  const inPrompt = tokens(prompt);
  const inAnswer = tokens(answer);
  const found = new Set<string>();
  for (const key of (Array.isArray(keys) ? keys : []).map(clean))
    for (const word of tokens(key)) {
      if (word.length < 3 && !/\d/.test(word)) continue;
      if (inAnswer.some((a) => sameWord(a, word)) && !inPrompt.some((p) => sameWord(p, word))) found.add(word);
    }
  return [...found];
}
const mentions = (text: string, words: string[]) => tokens(text).some((t) => words.some((w) => sameWord(t, w)));

/** A quick check that passed its checks. */
export interface QuickCheck {
  kind: (typeof KINDS)[number];
  prompt: string;
  /** From a nudge to almost the answer; none gives it away. */
  hints: string[];
  answer: string;
  /** The sentence, figure or equation the answer points at on the page, and the word of the answer where it does. */
  target: string;
  at: number;
}

const ajv = new Ajv2020({ strict: false, allErrors: true });

/**
 * The check from the model's answer. `declined` when the model finds nothing in the chapter to ask about; otherwise
 * `problems` for one repair turn when the question or the answer is unusable: too short, a question that states the
 * answer, no words that give the answer away to check the hints against, or an answer read out of the document. A hint
 * that gives the answer away is left out with the ones after it (the ladder only gets more revealing), the leak check of
 * the exercise sheets plus the answer's key words. A target outside the chapter becomes the chapter's own.
 */
export function cleanCheck(
  value: unknown,
  material: CheckMaterial,
  doc: Doc,
): { check: QuickCheck | null; declined: boolean; problems: string[] } {
  const ids = checkTargets(material);
  // Without a sentence or figure to point at when the answer comes, there is no check.
  if (!ids.length) return { check: null, declined: true, problems: [] };
  const valid = ajv.compile(checkSchema(ids, false));
  if (!valid(value))
    return {
      check: null,
      declined: false,
      problems: (valid.errors ?? []).slice(0, 8).map((e) => `${e.instancePath || '/'}: ${e.message}`),
    };
  const raw = value as Record<string, unknown>;
  if (raw.fits === false) return { check: null, declined: true, problems: [] };
  const prompt = clean(raw.prompt);
  const answer = clean(raw.answer);
  const given = [
    ...material.narration,
    ...material.sentences.map((s) => s.text),
    ...material.elements.map((e) => e.label),
  ].join(' ');
  const keys = giveaways(raw.keys, prompt, answer);
  // `known` is what the text may already say of the answer's numbers: the chapter's for the question, but only the
  // question's own for a hint, since a hint that repeats a figure of the answer has given it away.
  const leaks = (text: string, known: string) => leaksResult(text, answer, known) || mentions(text, keys);
  const problems: string[] = [];
  if (spoken(prompt) < 4 || prompt.length > COACH_PROMPT_MAX)
    problems.push(`prompt: ask in 1-2 spoken sentences of at least 4 words and at most ${COACH_PROMPT_MAX} characters`);
  else if (leaks(prompt, given))
    problems.push('prompt: it gives the answer away; ask the question without stating the answer');
  if (spoken(answer) < 5 || spoken(answer) > ANSWER_WORDS) problems.push(`answer: say it in 5 to 40 spoken words`);
  else if (readsSource(answer, doc)) problems.push('answer: say it in your own words; do not read the document aloud');
  else {
    // The answer rests on what the tour showed: a number it states is one the chapter or the question already has (a
    // small whole number may come from reasoning, such as "four times"), never a figure the model brings along.
    const stated = new Set([...numbersIn(given), ...numbersIn(prompt)]);
    const brought = numbersIn(answer).filter((n) => !stated.has(n) && !(Number.isInteger(n) && n >= 0 && n <= 10));
    if (brought.length)
      problems.push(
        `answer: ${[...new Set(brought)].join(', ')} is in neither the chapter nor the question; use only numbers the chapter states, or answer without them`,
      );
  }
  if (!keys.length)
    problems.push('keys: give 1-3 words or numbers copied exactly from the answer that the prompt does not contain');
  if (problems.length) return { check: null, declined: false, problems };
  const hints: string[] = [];
  for (const hint of (Array.isArray(raw.hints) ? raw.hints : []).map(clean).filter(Boolean)) {
    if (hint.length > COACH_HINT_MAX || leaks(hint, prompt)) break;
    if (!hints.includes(hint) && hint !== prompt) hints.push(hint);
  }
  const target = clean(raw.target);
  const anchor = findAnchor(answer, clean(raw.anchor));
  return {
    check: {
      kind: raw.kind === 'recall' ? 'recall' : 'predict',
      prompt,
      hints: hints.slice(0, 3),
      answer,
      target: ids.includes(target) ? target : ids[0],
      at: Math.min(anchor ?? 0, splitWords(answer).length - 1),
    },
    declined: false,
    problems: [],
  };
}

// ------------------------------------------------------------------------------------------------- the steps

/** The camera of the chapter's last step, which the question keeps: the page stays where the learner just looked. */
function lastCamera(steps: Step[]): Action | undefined {
  for (const step of [...steps].reverse()) {
    const camera = [...step.actions].reverse().find((a) => a.type === 'focus' || a.type === 'zoom');
    if (camera) {
      const copy = { ...camera };
      delete copy.at_word;
      return copy;
    }
  }
  return undefined;
}

/**
 * The two steps of a check: the question, a checkpoint that waits for the learner with the page as it was, and the
 * answer, which flies to what shows it and marks it in green as the anchor words are spoken. The ids are `check-N` and
 * `check-N-answer`, which the reader tells from an exercise sheet's try-first step.
 */
export function checkSteps(check: QuickCheck, n: number, chapter: Step[], doc: Doc): Step[] {
  const sentence = doc.sentences.some((s) => s.id === check.target);
  const timing = check.at > 0 ? { at_word: check.at } : {};
  const camera = lastCamera(chapter);
  return [
    {
      id: `check-${n}`,
      say: check.prompt,
      actions: camera ? [camera] : [],
      checkpoint: { prompt: check.prompt, hints: check.hints },
    },
    {
      id: `check-${n}-answer`,
      say: check.answer,
      actions: sentence
        ? [
            { type: 'focus', target: check.target },
            { type: 'highlight', targets: [check.target], color: 'green', ...timing },
          ]
        : [
            { type: 'zoom', target: check.target },
            { type: 'box', target: check.target, color: 'green', ...timing },
          ],
    },
  ];
}
