// Asking a question about a document. The server answers with a micro-tour: steps in the tour contract that the
// reader plays as a second tour (server/src/harness/ask.ts). These types mirror the server's AskRequest and AskAnswer.

import { apiRequest, ApiRequestError, getAccessToken } from '../library/client';
import { responseLanguage } from '../../../shared/languages';
import type { Step } from '../types';
import type { RegionSelection } from './regionSelection';

/** One earlier exchange; follow-up questions build on it. */
export interface AskTurn {
  question: string;
  answer: string;
}

export interface AskRequest {
  question: string;
  responseLanguage?: string;
  tourId?: string;
  analysisId?: string;
  stepId?: string;
  /** The figure, panel or equation the learner is looking at. */
  figureId?: string;
  selection?: RegionSelection;
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

export const MAX_HISTORY = 4;
/** The server gives up after 75 seconds; the browser waits a little longer for its reply. */
const WAIT_MS = 90_000;
const apiBase = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');

/** The media type of an answer that is sent as it is written (server/src/harness/ask-stream.ts). */
const NDJSON = 'application/x-ndjson';

/**
 * Ask a question. With `onProgress` the answer is read as it is written: it is called with the answer so far (the steps
 * that are whole, no follow-ups yet) each time another step arrives, and the returned answer is the whole one. An answer
 * the server already has (stored, or shared with another request) comes back whole at once, with no progress.
 */
export async function askQuestion(
  source: AskSource,
  request: AskRequest,
  signal?: AbortSignal,
  onProgress?: (answer: AskAnswer) => void,
): Promise<AskAnswer> {
  const body: AskRequest = { question: request.question.trim() };
  if (responseLanguage(request.responseLanguage)) body.responseLanguage = request.responseLanguage;
  if (request.tourId) body.tourId = request.tourId;
  if (request.analysisId) body.analysisId = request.analysisId;
  if (request.stepId) body.stepId = request.stepId;
  if (request.figureId) body.figureId = request.figureId;
  if (request.selection) body.selection = request.selection;
  if (request.history?.length) body.history = request.history.slice(-MAX_HISTORY);
  const init = {
    method: 'POST',
    body: JSON.stringify(body),
    signal: AbortSignal.any([AbortSignal.timeout(WAIT_MS), ...(signal ? [signal] : [])]),
  };
  const answer = onProgress
    ? await streamedRequest(source, init, onProgress)
    : 'documentId' in source
      ? await apiRequest<AskAnswer>(`/api/documents/${encodeURIComponent(source.documentId)}/ask`, init)
      : await demoRequest(source.paper, init);
  if (!answer?.steps?.length)
    throw new ApiRequestError('No answer came back. Try asking it another way.', 502, 'empty_answer');
  return answer;
}

/** The request of a question that is read as it is written: the same route, asking for lines of NDJSON. */
async function streamedRequest(
  source: AskSource,
  init: RequestInit,
  onProgress: (answer: AskAnswer) => void,
): Promise<AskAnswer> {
  const library = 'documentId' in source;
  const headers = new Headers({ 'Content-Type': 'application/json', Accept: `${NDJSON}, application/json` });
  if (library) headers.set('Authorization', `Bearer ${await getAccessToken()}`);
  const path = library
    ? `/api/documents/${encodeURIComponent(source.documentId)}/ask`
    : `/api/demo/${encodeURIComponent(source.paper)}/ask`;
  const response = await fetch(`${apiBase}${path}`, { ...init, headers, cache: 'no-store' });
  if (!response.ok) throw await failure(response, library);
  return response.headers.get('content-type')?.includes(NDJSON)
    ? readAnswerStream(response, onProgress)
    : ((await response.json()) as AskAnswer);
}

/** Demo papers are not in a library, so there is no session to send. */
async function demoRequest(paper: string, init: RequestInit): Promise<AskAnswer> {
  const response = await fetch(`${apiBase}/api/demo/${encodeURIComponent(paper)}/ask`, {
    ...init,
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
  });
  if (response.ok) return (await response.json().catch(() => null)) as AskAnswer;
  throw await failure(response, false);
}

/** A failed request in plain words. */
async function failure(response: Response, library: boolean): Promise<ApiRequestError> {
  const data = await response.json().catch(() => null);
  // The API answers demo questions only in local development, and only for folders under demo/ with a doc.json.
  if (!library && response.status === 404)
    return new ApiRequestError('Demo questions need the API running locally in development.', 404, 'demo_unavailable');
  return new ApiRequestError(
    data?.error?.message ??
      (response.status === 401
        ? 'Your session expired. Sign in again.'
        : `The request failed (${response.status}). Try again.`),
    response.status,
    data?.error?.code ?? 'request_failed',
  );
}

/**
 * Read a streamed answer, one JSON object per line: a `step` for each step as it is finished (passed on as the answer so
 * far), then the whole `answer`, or an `error`. A stream that ends without either was cut short.
 */
export async function readAnswerStream(
  response: Response,
  onProgress: (answer: AskAnswer) => void,
): Promise<AskAnswer> {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiRequestError('No answer came back. Try asking it another way.', 502, 'empty_answer');
  const decoder = new TextDecoder();
  const steps: Step[] = [];
  let answerable: Answerable = 'partly';
  let language: string | undefined;
  let whole: AskAnswer | null = null;
  const read = (line: string) => {
    if (!line.trim()) return;
    let event: StreamEvent;
    try {
      event = JSON.parse(line) as StreamEvent;
    } catch {
      return;
    }
    if (event.type === 'step' && event.step) {
      steps.push(event.step);
      answerable = event.answerable ?? answerable;
      language = event.language ?? language;
      onProgress({ answerable, ...(language ? { language } : {}), steps: [...steps], followups: [] });
    } else if (event.type === 'answer' && event.answer) whole = event.answer;
    else if (event.type === 'error')
      throw new ApiRequestError(
        event.error?.message ?? 'The answer could not be finished. Try again.',
        event.error?.status ?? 502,
        event.error?.code ?? 'answer_failed',
      );
  };
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    pending += decoder.decode(value, { stream: true });
    for (let end = pending.indexOf('\n'); end >= 0; end = pending.indexOf('\n')) {
      read(pending.slice(0, end));
      pending = pending.slice(end + 1);
    }
  }
  read(pending + decoder.decode());
  if (!whole) throw new ApiRequestError('The answer was cut short. Try again.', 502, 'answer_cut');
  return whole;
}

interface StreamEvent {
  type: 'step' | 'answer' | 'error';
  answerable?: Answerable;
  language?: string;
  step?: Step;
  answer?: AskAnswer;
  error?: { code?: string; message?: string; status?: number };
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
