// Asking a question about a document. The server answers with a micro-tour: steps in the tour contract that the
// reader plays as a second tour (server/src/harness/ask.ts). These types mirror the server's AskRequest and AskAnswer.

import { apiRequest, ApiRequestError } from '../library/client';
import { responseLanguage } from '../../../shared/languages';
import type { Step } from '../types';

/** One earlier exchange; follow-up questions build on it. */
export interface AskTurn {
  question: string;
  answer: string;
}

export interface AskRequest {
  question: string;
  responseLanguage?: string;
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
  language?: string;
  steps: Step[];
  followups: string[];
}

/**
 * What a question is about: a document in the signed-in learner's library, or a demo paper folder (?paper=), which the
 * API answers without an account only in local development.
 */
export type AskSource = { documentId: string } | { paper: string };

export const MAX_QUESTION = 500;
export const MAX_HISTORY = 4;
/** The server gives up after 75 seconds; the browser waits a little longer for its reply. */
const WAIT_MS = 90_000;
const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

export async function askQuestion(source: AskSource, request: AskRequest, signal?: AbortSignal): Promise<AskAnswer> {
  const body: AskRequest = { question: request.question.trim().slice(0, MAX_QUESTION) };
  if (responseLanguage(request.responseLanguage)) body.responseLanguage = request.responseLanguage;
  if (request.tourId) body.tourId = request.tourId;
  if (request.stepId) body.stepId = request.stepId;
  if (request.figureId) body.figureId = request.figureId;
  if (request.history?.length) body.history = request.history.slice(-MAX_HISTORY);
  const init = {
    method: 'POST',
    body: JSON.stringify(body),
    signal: AbortSignal.any([AbortSignal.timeout(WAIT_MS), ...(signal ? [signal] : [])]),
  };
  const answer =
    'documentId' in source
      ? await apiRequest<AskAnswer>(`/api/documents/${encodeURIComponent(source.documentId)}/ask`, init)
      : await demoRequest(source.paper, init);
  if (!answer?.steps?.length)
    throw new ApiRequestError('No answer came back. Try asking it another way.', 502, 'empty_answer');
  return answer;
}

/** Demo papers are not in a library, so there is no session to send. */
async function demoRequest(paper: string, init: RequestInit): Promise<AskAnswer> {
  const response = await fetch(`${apiBase}/api/demo/${encodeURIComponent(paper)}/ask`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  const data = await response.json().catch(() => null);
  if (response.ok) return data as AskAnswer;
  // The API answers demo questions only in local development, and only for folders under demo/ with a doc.json.
  if (response.status === 404)
    throw new ApiRequestError('Demo questions need the API running locally in development.', 404, 'demo_unavailable');
  throw new ApiRequestError(
    data?.error?.message ?? `The request failed (${response.status}). Try again.`,
    response.status,
    data?.error?.code ?? 'request_failed',
  );
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
    if (error.status === 404 && error.code === 'not_found') return 'This document is no longer available.';
    return error.message;
  }
  if (error instanceof TypeError) return 'Could not reach Paper Tour. Check your connection and try again.';
  return 'Something went wrong. Try again.';
}
