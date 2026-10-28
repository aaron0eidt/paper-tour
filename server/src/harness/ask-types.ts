import type { Step } from '../../../shared/paper';
import type { RegionSelection } from '../../../shared/selection';

/** One earlier exchange; a follow-up question may build on it. */
export interface AskTurn {
  question: string;
  answer: string;
}
/** A learner's question, with where they are in the tour and what they are looking at. */
export interface AskRequest {
  question: string;
  responseLanguage?: string;
  tourId?: string;
  analysisId?: string;
  selection?: RegionSelection;
  stepId?: string;
  figureId?: string;
  history?: AskTurn[];
}
export const ANSWERABLE = ['yes', 'partly', 'no'] as const;
export type Answerable = (typeof ANSWERABLE)[number];
/** The answer as a micro-tour: steps in the tour contract, plus two questions to ask next. */
export interface AskAnswer {
  answerable: Answerable;
  language?: string;
  steps: Step[];
  followups: string[];
}
