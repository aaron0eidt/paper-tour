// Asking a question about a document. The server answers with a micro-tour: steps in the tour contract that the
// engine can insert and play (server/src/harness/ask.ts). These types mirror the server's AskRequest and AskAnswer.

import { apiRequest, ApiRequestError } from '../library/client';
import type { Step } from '../types';

/** One earlier exchange; follow-up questions build on it. */
export interface AskTurn {
  question: string;
  answer: string;
}

export interface AskRequest {
  question: string;
  tourId?: string;
  stepId?: string;
  /** The figure, panel or equation the learner is looking at. */
  figureId?: string;
  /** Up to four earlier exchanges, oldest first. */
  history?: AskTurn[];
}

export type Answerable = 'yes' | 'partly' | 'no';

export interface AskAnswer {
  answerable: Answerable;
  steps: Step[];
  followups: string[];
}

export const MAX_QUESTION = 500;
export const MAX_HISTORY = 4;
/** The server gives up after 75 seconds; the browser waits a little longer for its reply. */
const WAIT_MS = 90_000;

export async function askQuestion(documentId: string, request: AskRequest, signal?: AbortSignal): Promise<AskAnswer> {
  const body: AskRequest = { question: request.question.trim().slice(0, MAX_QUESTION) };
  if (request.tourId) body.tourId = request.tourId;
  if (request.stepId) body.stepId = request.stepId;
  if (request.figureId) body.figureId = request.figureId;
  if (request.history?.length) body.history = request.history.slice(-MAX_HISTORY);
  const answer = await apiRequest<AskAnswer>(`/api/documents/${encodeURIComponent(documentId)}/ask`, {
    method: 'POST',
    body: JSON.stringify(body),
    signal: AbortSignal.any([AbortSignal.timeout(WAIT_MS), ...(signal ? [signal] : [])]),
  });
  if (!answer?.steps?.length)
    throw new ApiRequestError('No answer came back. Try asking it another way.', 502, 'empty_answer');
  return answer;
}

/** What an answer said, as one line for the history the next question sends. */
export function answerText(answer: AskAnswer): string {
  return answer.steps
    .map((step) => step.say)
    .join(' ')
    .slice(0, 2000);
}

/** True when the learner stopped the question themselves; that is not an error to show. */
export function isCancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/** A failed question in plain words. */
export function askErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'TimeoutError')
    return 'The answer is taking too long. Try again in a moment.';
  if (error instanceof ApiRequestError) {
    if (error.status === 401) return 'Your session expired. Sign in again to ask.';
    if (error.status === 404) return 'This document is no longer available.';
    return error.message;
  }
  if (error instanceof TypeError) return 'Could not reach Paper Tour. Check your connection and try again.';
  return 'Something went wrong. Try again.';
}
