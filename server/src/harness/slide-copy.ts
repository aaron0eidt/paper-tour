import type { BoardItem, Doc } from '../../../shared/paper';
import type { Beat } from './beats';
import { GENERIC, boardTerms, keyOf, sameTerm, spokenTerms } from './board-agreement';
import type { BoardCheck, BoardKind } from './board';

// Whether a board of a slide step only redraws its slide. The learner sees the slide: its bullets, its table, the text
// inside its figures. A board whose words, labels and numbers are mostly printed there adds nothing; one that builds on
// the slide (the mechanism behind its picture, a worked case, the next step, a contrast) names things the slide does not.
// A picture is only an image, so a slide with little text cannot be judged and is let be: the check flags a copy it can
// prove, and the direction task (prompts.ts) steers the rest. The problem is worded as an instruction for the repair turn.

/** The text the learner reads on a step's slides: titles, bullets, tables and the text inside figures; not the footer. */
export function slidePrinted(beat: Beat, doc: Doc): string {
  const pages = new Set(beat.slides ?? []);
  return doc.blocks
    .filter((b) => pages.has(b.page) && b.type !== 'header_footer')
    .map((b) => b.text)
    .join('\n');
}

/** What a board prints, by whether the slide prints it too: its words and its numeric values. */
export interface Copy {
  words: { copied: string[]; fresh: string[] };
  values: { copied: string[]; fresh: string[] };
}

/** A value as a printed number tells something: a decimal or a number of two digits; a single digit is said anywhere. */
const distinctive = (n: string) => n.includes('.') || Number(n) >= 10;
/** The ways a slide prints a value: as it is, or as a percentage ("0.8" is "80%"). */
const printedAs = (value: string) => [
  value,
  ...(Number(value) <= 1 ? [String(Number((Number(value) * 100).toPrecision(12)))] : []),
];

/** The numbers of the data an authored board draws, which its terms do not list: a program's arrays, a plotly figure's traces. */
function dataValues(item: BoardItem): string[] {
  const keys = (trace: Record<string, unknown>) => ['x', 'y', 'z'].flatMap((key) => [trace[key]].flat(2));
  let numbers: unknown[] = [];
  // The board may be unchecked (a failed one is judged too), so its parts are read defensively.
  if (item.kind === 'program')
    numbers = (Array.isArray(item.data) ? item.data : []).flatMap((series) =>
      Array.isArray(series?.values) ? series.values : [],
    );
  else if (item.kind === 'plotly') {
    try {
      numbers = (JSON.parse(item.figure).data as Record<string, unknown>[]).flatMap(keys);
    } catch {
      // A figure that is no JSON, or has no traces, has failed its own check.
    }
  }
  return numbers
    .filter((n): n is number => typeof n === 'number' && Number.isFinite(n))
    .map((n) => String(Math.abs(n)));
}

/** The board's words and numeric values, split by whether the printed text has them. */
export function slideCopy(item: BoardItem, printed: string): Copy {
  // An authored board's objective is a sentence about what to see, not a label on it.
  const board = boardTerms(item.kind === 'program' || item.kind === 'plotly' ? { ...item, objective: '' } : item);
  const slide = spokenTerms(printed);
  const words = [
    ...new Map(
      [...board.core, ...board.items, ...board.sizes]
        .filter((word) => !GENERIC.has(keyOf(word)))
        .map((word) => [keyOf(word), word]),
    ).values(),
  ];
  const out: Copy = { words: { copied: [], fresh: [] }, values: { copied: [], fresh: [] } };
  for (const word of words)
    (slide.words.some((w) => sameTerm(w, word)) ? out.words.copied : out.words.fresh).push(word);
  // Each value once, as printed or as a percentage of one; its roundings (which a narration may say) are no copy.
  for (const value of new Set([...board.values.map((forms) => forms[0]), ...dataValues(item)]))
    (printedAs(value).some((n) => slide.numbers.has(n)) ? out.values.copied : out.values.fresh).push(value);
  return out;
}

/** With fewer words and numbers than this a board says too little to judge. */
export const MIN_MARKS = 6;
/**
 * A number that tells something weighs this much against a word, a single digit as much as a word: a topic's words come
 * back on any board about it, its values only on a copy.
 */
export const VALUE_WEIGHT = 3;
const weight = (value: string) => (distinctive(value) ? VALUE_WEIGHT : 1);
/** How much of what a board prints the slide prints too, from 0 to 1 (values weigh VALUE_WEIGHT words), and the marks it is judged by. */
export function copyShare({ words, values }: Copy): { share: number; marks: number } {
  const sum = (list: string[]) => list.reduce((n, value) => n + weight(value), 0);
  const copied = words.copied.length + sum(values.copied);
  const all = words.copied.length + words.fresh.length + sum(values.copied) + sum(values.fresh);
  return {
    share: all ? copied / all : 0,
    marks: words.copied.length + words.fresh.length + values.copied.length + values.fresh.length,
  };
}
/**
 * A board is a copy of its slide when this share of what it prints is printed there as well. Calibrated on the boards of
 * the saved tours of a lecture deck (see test/slide-copy.test.ts): the boards that only redraw the slide (its numbers as
 * bars or points, its table as a chart) have 0.79 to 1.00 of their weighted words and numbers on it; those that build on
 * it (a formula that breaks the slide's idea into terms, a plot of the curve it describes, a worked case with numbers of
 * its own) have 0.27 to 0.50.
 */
export const COPY_SHARE = 0.65;

const NAMED = 5;
const listed = (words: string[]) => `${words.slice(0, NAMED).join(', ')}${words.length > NAMED ? ', ...' : ''}`;

/** Why the board is only the slide again, as an instruction for the repair turn; empty when it adds something or cannot be judged. */
export function slideCopyProblems(item: BoardItem, printed: string): string[] {
  const copy = slideCopy(item, printed);
  const { share, marks } = copyShare(copy);
  if (marks < MIN_MARKS || share < COPY_SHARE) return [];
  const copied = [...copy.words.copied, ...copy.values.copied];
  return [
    `the board copies the slide: ${copied.length} of its ${marks} words and numbers (${listed(copied)}) are printed on the slide, so the learner sees them twice. Show what the slide leaves out instead: the mechanism behind its picture, a worked case with numbers of your own (label them illustrative), the next step, or a contrast or what-if`,
  ];
}

/**
 * Why a worked example only redraws its slide: every one of its frames does and none works out a number the slide does not
 * print. An example that computes something new (a total, a ratio) builds on the slide, even where it names the slide's
 * own things.
 */
export function exampleCopyProblems(frames: { item: BoardItem }[], printed: string): string[] {
  const copies = frames.filter((frame) => {
    const copy = slideCopy(frame.item, printed);
    return slideCopyProblems(frame.item, printed).length > 0 && !copy.values.fresh.some(distinctive);
  });
  return frames.length > 0 && copies.length === frames.length
    ? [
        'the worked example copies the slide: its frames show only words and numbers the slide prints, so the learner sees them twice. Show what the slide leaves out instead: a worked case with numbers of your own (label them illustrative) and what they lead to, the mechanism behind its picture, the next step, or a contrast or what-if',
      ]
    : [];
}

/**
 * The board's check, with the problem added when the board only redraws its slide. As in agreementCheck, a board that
 * failed its own checks is judged by what the model wrote, so that one repair turn names every fault.
 */
export function copyCheck(
  check: BoardCheck,
  raw: { kind: BoardKind; value: unknown },
  printed: string | undefined,
): BoardCheck {
  if (printed === undefined) return check;
  const given = raw.value && typeof raw.value === 'object' ? ({ ...raw.value, kind: raw.kind } as BoardItem) : null;
  const item = check.item ?? (check.problems.length ? given : null);
  const problems = item ? slideCopyProblems(item, printed) : [];
  return problems.length ? { item: null, problems: [...check.problems, ...problems] } : check;
}
