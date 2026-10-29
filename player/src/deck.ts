// Deck mode: a lecture plays slide by slide. When a document is read as a deck, which slide each step shows, and the
// filmstrip's view of the tour. Pure, so it can be tested without a DOM.

import type { PageSize, Resolver } from './resolve';
import type { Tour } from './types';
import type { FlatStep } from './engine';
import { isCamera } from './engine';

export type ReaderMode = 'deck' | 'paper';

/** Pages at least this much wider than tall read as slides. */
const SLIDE_ASPECT = 1.25;
/** Without a stated document type, a document needs this many pages, nearly all of them slides, to be read as a deck. */
const MIN_DECK_PAGES = 4;
const DECK_SHARE = 0.8;

/**
 * How a document is read. The tour says what it is: a lecture plays as a deck (when its pages are slides, wider than
 * tall; lecture notes in portrait pages scroll like a paper), anything else as a paper. Only a tour that does not say
 * (older ones, or none yet) is judged by its pages: a run of clearly landscape pages is slides.
 */
export function readerMode(tour: Pick<Tour, 'doc_type'> | null | undefined, sizes: readonly PageSize[]): ReaderMode {
  if (tour?.doc_type) {
    if (tour.doc_type !== 'lecture' || !sizes.length) return 'paper';
    return sizes.filter((size) => size.width > size.height).length >= sizes.length / 2 ? 'deck' : 'paper';
  }
  if (sizes.length < MIN_DECK_PAGES) return 'paper';
  const wide = sizes.filter((size) => size.width >= SLIDE_ASPECT * size.height).length;
  return wide >= DECK_SHARE * sizes.length ? 'deck' : 'paper';
}

/** The slide a camera action lands on, or null when its target is not on a page of this document. */
export function slideOf(target: string, resolver: Resolver): number | null {
  const groups = resolver.resolve(target);
  return groups?.[0]?.page ?? null;
}

/**
 * The slide each step starts on: the page its first camera move lands on, or the slide before it when it has none (the
 * camera stays where it was). The first step starts on slide 1 unless it moves.
 */
export function stepSlides(steps: readonly FlatStep[], resolver: Resolver): number[] {
  let slide = 1;
  return steps.map((fs) => {
    const move = fs.schedule.find((item) => isCamera(item.action));
    const page = move && isCamera(move.action) ? slideOf(move.action.target, resolver) : null;
    if (page) slide = page;
    return slide;
  });
}

/** For each slide with steps on it, the indices of those steps in tour order. */
export function stepsBySlide(slides: readonly number[]): Map<number, number[]> {
  const out = new Map<number, number[]>();
  slides.forEach((slide, index) => out.set(slide, [...(out.get(slide) ?? []), index]));
  return out;
}

/** A slide number kept to the deck. */
export function clampSlide(n: number, count: number): number {
  return Math.max(1, Math.min(Math.max(1, count), Math.floor(Number.isFinite(n) ? n : 1)));
}
