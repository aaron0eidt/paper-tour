// What the cover and end cards say about a tour: its kind and length, and what each chapter established. Everything is
// read from the tour itself (no model call), so any tour gets a cover and a recap. Pure, so it can be tested.

import type { Status } from './engine';
import { sentenceStarts } from './narration/narrator';
import { splitWords } from './types';
import type { Tour } from './types';

const DOC_TYPES: Record<NonNullable<Tour['doc_type']>, string | null> = {
  research_paper: 'Research paper',
  exercise_sheet: 'Exercise sheet',
  lecture: 'Lecture slides',
  contract: 'Contract',
  letter: 'Letter',
  other: null,
};

/** The kind of document in words, or null when the tour does not say or it is just "something else". */
export function docTypeLabel(type: Tour['doc_type'] | undefined): string | null {
  return (type && DOC_TYPES[type]) || null;
}

/** "about 4 min": a length is an estimate from the narration, so it never claims to be exact. */
export function lengthLabel(ms: number): string {
  const minutes = ms / 60_000;
  return minutes < 0.75 ? 'under a minute' : `about ${Math.round(minutes)} min`;
}

/** A file's name as a title: no folders, no extension, underscores read as spaces. */
function fileTitle(file: string): string {
  const name = file.split(/[\\/]/).pop() ?? '';
  return name.replace(/\.[a-z0-9]{1,5}$/i, '').replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * What to call the document: its own title, else the tour's (slides rarely have one), else the file's name; undefined
 * when there is none of them. A title that is only blanks is no title.
 */
export function readerTitle(parts: { doc?: string | null; tour?: string | null; file?: string | null }): string | undefined {
  return (
    [parts.doc, parts.tour].map((title) => title?.trim()).find(Boolean) ||
    (parts.file ? fileTitle(parts.file) : '') ||
    undefined
  );
}

export function stepsLabel(count: number): string {
  return count === 1 ? '1 step' : `${count} steps`;
}

/** The first sentence of a narration, cut at a word if it is long. */
export function firstSentence(say: string, max = 150): string {
  const words = splitWords(say);
  const starts = sentenceStarts(words);
  const sentence = words.slice(starts[0] ?? 0, starts[1] ?? words.length).join(' ');
  if (sentence.length <= max) return sentence;
  const cut = sentence.slice(0, max).replace(/\s+\S*$/, '');
  return `${cut}…`;
}

export interface Takeaway {
  chapter: number;
  title: string;
  /** What the chapter's first step states: the writer opens each step with its point. */
  point: string;
  /** The index of the chapter's first step in the tour, to play it again. */
  step: number;
}

/** One takeaway per chapter, in order. */
export function chapterTakeaways(tour: Tour): Takeaway[] {
  let step = 0;
  return tour.chapters.map((chapter, index) => {
    const first = chapter.steps[0];
    const takeaway = { chapter: index, title: chapter.title, point: first ? firstSentence(first.say) : '', step };
    step += chapter.steps.length;
    return takeaway;
  });
}

/** What decides whether a card shows over the stage. */
export interface CardState {
  hasTour: boolean;
  status: Status;
  /** The step the tour is on. */
  index: number;
  /** The step is shown silently (a jump or a restore), not played. */
  preview?: boolean;
  /** The step a saved place brought the tour to, when it did. */
  restored: number | null;
  /** The learner closed the card, or went on without it. */
  dismissed: boolean;
  /** An answer is playing, or the tour is set aside for a question. */
  aside: boolean;
}

/**
 * The cover shows until the tour is under way: before the first play, and again on a step a saved place restored
 * (where it offers to continue). Any other jump, a play, a question or closing it ends it.
 */
export function coverVisible(state: CardState): boolean {
  if (!state.hasTour || state.dismissed || state.aside) return false;
  if (state.status === 'idle') return true;
  return state.restored !== null && state.status === 'paused' && !!state.preview && state.index === state.restored;
}

/** The recap shows when the tour has ended, until it is closed or a question sets the tour aside. */
export function recapVisible(state: CardState): boolean {
  return state.hasTour && !state.dismissed && !state.aside && state.status === 'ended';
}
