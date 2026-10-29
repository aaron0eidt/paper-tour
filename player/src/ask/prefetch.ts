// Answers kept ahead of the learner. While the tour plays its last step, the answers to its suggested questions are asked
// for in the background, one request at a time and with exactly the request a click on that question would send, so
// picking one plays at once. A question the learner asks meanwhile goes first: it joins a background request that is
// already answering the same thing, and otherwise stops the background work. A background request that fails ends the
// background work for good (a demo without the ask route, a model that is busy): speculation is never retried. Free of
// the DOM, so test/ask.test.ts drives it with a fake transport.

import { responseLanguage } from '../../../shared/languages';
import type { Status } from '../engine';
import type { AskAnswer, AskRequest, AskSource } from './api';

export type Transport = (source: AskSource, request: AskRequest, signal: AbortSignal) => Promise<AskAnswer>;

const sourceKey = (source: AskSource) =>
  'documentId' in source ? `document:${source.documentId}` : `demo:${source.paper}`;

/**
 * What makes two requests the same question: everything the server reads, except the earlier exchanges. A suggested
 * question stands on its own, so an answer kept before the learner asked something else still answers it.
 */
export function requestKey(source: AskSource, request: AskRequest): string {
  const { selection } = request;
  return JSON.stringify([
    sourceKey(source),
    request.question.replace(/\s+/g, ' ').trim(),
    responseLanguage(request.responseLanguage) ? request.responseLanguage : '',
    request.tourId ?? '',
    request.analysisId ?? '',
    request.stepId ?? '',
    request.figureId ?? '',
    selection ? [selection.page, ...selection.rect] : null,
  ]);
}

/**
 * Whether there is anything to ask in the background. A library document has its API; a demo paper's questions are
 * answered only by a local API (api.ts demoRequest), so without the dev server or an API address nothing is asked.
 */
export function prefetchPossible(source: AskSource, env: { DEV?: boolean; VITE_API_URL?: string }): boolean {
  return 'documentId' in source || !!env.DEV || !!env.VITE_API_URL;
}

/** What decides whether the suggested questions are answered in the background now. */
export interface PrefetchState {
  /** The tour is whole (not still being written) and has a document to ask about. */
  finished: boolean;
  steps: number;
  /** The step the tour is on. */
  index: number;
  status: Status;
  /** The step is shown silently (a jump), not played. */
  preview?: boolean;
  /** A question, an answer or a region selection is on: what a click would send is about to change. */
  aside: boolean;
}

/**
 * From the tour's last step on, while it plays or has ended, or while a learner who heard it pauses there; not when the
 * learner only jumped to that step, and not while they are asking something else.
 */
export function prefetchWanted(state: PrefetchState): boolean {
  if (!state.finished || state.aside || state.steps < 1 || state.index !== state.steps - 1) return false;
  return state.status === 'playing' || state.status === 'ended' || (state.status === 'paused' && !state.preview);
}

interface Job {
  key: string;
  source: AskSource;
  request: AskRequest;
}

interface Running {
  key: string;
  controller: AbortController;
  /** The answer, or null when the request failed or was stopped; never rejects. */
  done: Promise<AskAnswer | null>;
}

const cancelled = () => new DOMException('The request was cancelled.', 'AbortError');

/** Wait for a promise, but give up with a cancellation as soon as the signal aborts. */
function until<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(cancelled());
    const abort = () => reject(cancelled());
    signal.addEventListener('abort', abort, { once: true });
    void promise.then((value) => {
      signal.removeEventListener('abort', abort);
      resolve(value);
    });
  });
}

export class AnswerKeeper {
  private readonly kept = new Map<string, AskAnswer>();
  private readonly listeners = new Set<() => void>();
  private queue: Job[] = [];
  private running: Running | null = null;
  private failed = false;

  constructor(private readonly transport: Transport) {}

  /** Calls `listener` whenever the set of kept answers changes; returns a function that stops it. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  /** Whether an answer to this request is kept. */
  has(source: AskSource, request: AskRequest): boolean {
    return this.kept.has(requestKey(source, request));
  }

  /** The kept answer to this request, as a copy (playing it cannot change what is kept), or null. */
  take(source: AskSource, request: AskRequest): AskAnswer | null {
    const answer = this.kept.get(requestKey(source, request));
    return answer ? structuredClone(answer) : null;
  }

  /**
   * The questions to answer in the background, in order. They replace what was queued before; a request that is
   * running, or whose answer is kept, is not asked again, and one that is no longer wanted stops.
   */
  prefetch(source: AskSource, requests: readonly AskRequest[]): void {
    if (this.failed) return;
    const jobs = new Map<string, Job>();
    for (const request of requests) {
      const key = requestKey(source, request);
      if (!jobs.has(key)) jobs.set(key, { key, source, request });
    }
    if (this.running && !jobs.has(this.running.key)) this.stopRunning();
    this.queue = [...jobs.values()].filter((job) => job.key !== this.running?.key && !this.kept.has(job.key));
    this.pump();
  }

  /**
   * Answer a question the learner asked: at once from a kept answer, by waiting for the background request that is
   * already answering it, or with a request of its own, which stops the background work first.
   */
  async answer(source: AskSource, request: AskRequest, signal: AbortSignal): Promise<AskAnswer> {
    const key = requestKey(source, request);
    const kept = this.take(source, request);
    if (kept) return kept;
    const running = this.running;
    if (running?.key === key) {
      const joined = await until(running.done, signal);
      const answer = joined && this.take(source, request);
      if (answer) return answer;
    }
    this.cancel();
    return this.transport(source, request, signal);
  }

  /** Start no more background requests; the one that runs finishes, since a learner may be waiting for it. */
  hold(): void {
    this.queue = [];
  }

  /** Stop the background work. Kept answers stay. */
  cancel(): void {
    this.hold();
    this.stopRunning();
  }

  /** How many answers are kept. */
  get size(): number {
    return this.kept.size;
  }

  /** Leaving the document: nothing stays, and the background work may start again. */
  clear(): void {
    this.cancel();
    this.failed = false;
    if (this.kept.size) {
      this.kept.clear();
      this.notify();
    }
  }

  private stopRunning(): void {
    const run = this.running;
    this.running = null;
    run?.controller.abort();
  }

  private notify(): void {
    for (const listener of [...this.listeners]) listener();
  }

  private pump(): void {
    if (this.running || this.failed) return;
    const job = this.queue.shift();
    if (!job) return;
    const controller = new AbortController();
    const run: Running = { key: job.key, controller, done: Promise.resolve(null) };
    run.done = this.transport(job.source, job.request, controller.signal).then(
      (answer) => {
        if (controller.signal.aborted) return null;
        if (this.running === run) this.running = null;
        this.kept.set(job.key, answer);
        this.notify();
        this.pump();
        return answer;
      },
      () => {
        if (this.running === run) this.running = null;
        if (!controller.signal.aborted) {
          this.failed = true;
          this.queue = [];
        }
        return null;
      },
    );
    this.running = run;
  }
}
