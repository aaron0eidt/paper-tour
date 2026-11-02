import type { BoardItem, Step } from '../../../shared/paper';
import type { RegionSelection } from '../../../shared/selection';

/** One earlier exchange; a follow-up question may build on it. */
export interface AskTurn {
  question: string;
  answer: string;
}
/** A learner's question, with where they are in the tour and what they are looking at. */
export interface AskRequest {
  question: string;
  conversationId?: string;
  page?: number;
  activeVisual?: BoardItem;
  visualId?: string;
  visualRevision?: number;
  responseLanguage?: string;
  tourId?: string;
  analysisId?: string;
  /** A region the learner selected: what the question is about. */
  selection?: RegionSelection;
  /** The tour step they were on; its narration counts only where it is about what they point at (ask-retrieval.ts). */
  stepId?: string;
  /** The figure or equation on screen: what the question is about when no region is selected. */
  figureId?: string;
  history?: AskTurn[];
}
export const ANSWERABLE = ['yes', 'partly', 'no'] as const;
export type Answerable = (typeof ANSWERABLE)[number];
/** The answer as a micro-tour: steps in the tour contract, plus two questions to ask next. */
export interface AskAnswer {
  conversationId?: string;
  messageId?: string;
  answerable: Answerable;
  language?: string;
  steps: Step[];
  followups: string[];
}

/**
 * What a streamed answer sends, one JSON object per line (ask-stream.ts): each step that is finished and checked while
 * the rest is still being written, then the whole answer, whose first steps are those already sent.
 */
export type AnswerEvent =
  | { type: 'step'; answerable: Answerable; step: Step; language?: string }
  | { type: 'answer'; answer: AskAnswer }
  | { type: 'error'; error: { code: string; message: string; status: number } };
/** Where a finished step goes while the answer is written, with the answer language when the learner chose one. */
export type StepSink = (answerable: Answerable, step: Step, language?: string) => void;
