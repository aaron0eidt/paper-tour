// The tour's timeline: how long each step takes, where a word falls in the whole, and which word a
// position on the timeline means. Lengths are estimated from the words (or taken from a step's
// audio), so they are exact only for narration that follows the same pace.

import { DEFAULT_HOLD_MS, DEFAULT_SPEAKER } from './types';
import type { Tour } from './types';
import type { FlatStep } from './engine';
import { msPerWord } from './narration/narrator';

export interface ClockStep {
  /** Where the step begins on the timeline, in ms. */
  start: number;
  /** Narration time of the step, in ms. */
  speech: number;
  /** Speech and the hold before the next step. */
  length: number;
}

export interface ClockChapter {
  index: number;
  /** The first step of the chapter. */
  step: number;
  start: number;
  length: number;
}

export interface TourClock {
  steps: ClockStep[];
  chapters: ClockChapter[];
  total: number;
  /** Every step's length is known from its audio, not estimated from its words. */
  measured: boolean;
}

export interface ClockOptions {
  /** Speed multiplier (the UI's speed times the URL's). */
  rate?: number;
  voices?: Tour['voices'];
}

export function buildClock(steps: readonly FlatStep[], { rate = 1, voices }: ClockOptions = {}): TourClock {
  let at = 0;
  let measured = steps.length > 0;
  const clock = steps.map((fs): ClockStep => {
    const audio = fs.step.audio?.duration_ms;
    if (!audio) measured = false;
    const pace = rate * (voices?.[fs.step.speaker ?? DEFAULT_SPEAKER]?.rate ?? 1);
    const speech = audio ? audio / rate : fs.words.length * msPerWord(pace);
    const step = { start: at, speech, length: speech + (fs.step.hold_ms ?? DEFAULT_HOLD_MS) };
    at += step.length;
    return step;
  });
  const chapters: ClockChapter[] = [];
  steps.forEach((fs, i) => {
    const last = chapters.at(-1);
    if (last && last.index === fs.chapterIndex) last.length += clock[i].length;
    else chapters.push({ index: fs.chapterIndex, step: i, start: clock[i].start, length: clock[i].length });
  });
  return { steps: clock, chapters, total: at, measured };
}

/** Time on the timeline when `word` of step `index` has been spoken (-1: before the first). */
export function timeAt(clock: TourClock, index: number, word: number, words: number): number {
  const step = clock.steps[Math.min(Math.max(0, index), clock.steps.length - 1)];
  if (!step) return 0;
  return step.start + (word < 0 || words <= 0 ? 0 : step.speech * Math.min(1, (word + 1) / words));
}

/** The step and word a time on the timeline falls on; the word is the one being spoken then. */
export function wordAt(clock: TourClock, time: number, wordCounts: readonly number[]): { index: number; word: number } {
  if (!clock.steps.length) return { index: 0, word: 0 };
  const t = Math.min(Math.max(0, time), clock.total);
  let index = clock.steps.findIndex((step) => t < step.start + step.length);
  if (index < 0) index = clock.steps.length - 1;
  const step = clock.steps[index];
  const words = wordCounts[index] ?? 0;
  const fraction = step.speech > 0 ? Math.min(1, (t - step.start) / step.speech) : 0;
  return { index, word: Math.min(Math.max(0, words - 1), Math.floor(fraction * words)) };
}

/** `4:07`, or `1:02:09` from an hour on. */
export function formatTime(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const two = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${two(m)}:${two(s)}` : `${m}:${two(s)}`;
}
