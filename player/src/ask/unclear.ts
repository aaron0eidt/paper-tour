// "Not clear?": four ways to ask about the step the tour is on. Each is a question for the ask flow, so the answer plays
// as a short tour and "Back to the tour" returns to the step. The question quotes the step's first sentence: the learner
// reads in the ask bar what was asked, and the retrieval has words to match. Pure, so test/ask.test.ts checks it
// without a browser.

import type { Status } from '../engine';
import { firstSentence } from '../tourSummary';

export type Unclear = 'simpler' | 'example' | 'term' | 'deeper';

export const UNCLEAR: readonly { kind: Unclear; label: string; hint: string }[] = [
  { kind: 'simpler', label: 'Simpler', hint: 'In plainer words' },
  { kind: 'example', label: 'Example', hint: 'A small, concrete case' },
  { kind: 'term', label: 'A term', hint: 'The key word, explained' },
  { kind: 'deeper', label: 'Deeper', hint: 'Why it works' },
];

const ASK: Record<Unclear, string> = {
  simpler: 'Say this more simply, in plain words',
  example: 'Give a small, concrete example of this',
  term: 'Name the key term in this and explain what it means in plain words',
  deeper: 'Go deeper on this and explain why it works',
};

/** The question a choice asks about the step the learner is on, whose narration is `say`. */
export function unclearQuestion(kind: Unclear, say: string): string {
  const point = firstSentence(say, 110);
  return point ? `${ASK[kind]}: “${point}”` : `${ASK[kind]}.`;
}

/** What decides whether "Not clear?" is offered. */
export interface UnclearState {
  /** There is a document to ask about, and a tour on it. */
  asking: boolean;
  status: Status;
  /** The tour waits for the learner to try (a checkpoint): its card has hints of its own. */
  awaiting?: boolean;
  /** A question, an answer or a region selection has the tour set aside. */
  aside: boolean;
}

/** It is offered on a step of the tour that is under way: not before it starts, after it ends, or while it is set aside. */
export function unclearOffered(state: UnclearState): boolean {
  return state.asking && !state.aside && !state.awaiting && (state.status === 'playing' || state.status === 'paused');
}
