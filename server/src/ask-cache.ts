import { createHash } from 'node:crypto';
import type { Step } from '../../shared/paper';
import type { AskAnswer, AskRequest } from './harness/ask-types';

/** Where a served answer came from: a new model call, the stored answer, or a call another request had already begun. */
export type AnswerSource = 'model' | 'cache' | 'flight';

interface Flight {
  promise: Promise<AskAnswer>;
  stop: AbortController;
  waiting: number;
  settled: boolean;
}

/**
 * Answers to questions, for the learner who asked them: a repeated or prefetched question is served at once instead of
 * by a new model call, and a question asked while an identical one is still being answered waits for that call. The
 * store lives in this process, holds at most `max` answers and drops each after `ttlMs`. Failures and answers that say
 * the document cannot answer are never stored, so asking again tries again.
 */
export class AnswerCache {
  private readonly answers = new Map<string, { answer: AskAnswer; expires: number }>();
  private readonly flights = new Map<string, Flight>();
  readonly max: number;
  constructor(
    max = 300,
    readonly ttlMs = 30 * 60_000,
    readonly now: () => number = Date.now,
  ) {
    this.max = Math.max(1, max);
  }
  get size(): number {
    return this.answers.size;
  }

  async serve(
    key: string,
    compute: (signal: AbortSignal) => Promise<AskAnswer>,
    signal?: AbortSignal,
  ): Promise<{ answer: AskAnswer; source: AnswerSource }> {
    signal?.throwIfAborted();
    const stored = this.answers.get(key);
    if (stored && stored.expires > this.now()) {
      // Most recently used last, so the oldest entry is the one that goes when the store is full.
      this.answers.delete(key);
      this.answers.set(key, stored);
      return { answer: structuredClone(stored.answer), source: 'cache' };
    }
    this.answers.delete(key);
    let flight = this.flights.get(key);
    const source: AnswerSource = flight ? 'flight' : 'model';
    if (!flight) flight = this.start(key, compute);
    return { answer: structuredClone(await this.wait(key, flight, signal)), source };
  }

  private start(key: string, compute: (signal: AbortSignal) => Promise<AskAnswer>): Flight {
    const stop = new AbortController();
    const flight: Flight = { promise: undefined as unknown as Promise<AskAnswer>, stop, waiting: 0, settled: false };
    flight.promise = new Promise<AskAnswer>((resolve) => resolve(compute(stop.signal))).then(
      (answer) => {
        flight.settled = true;
        if (this.flights.get(key) === flight) this.flights.delete(key);
        if (answer.answerable !== 'no') this.store(key, answer);
        return answer;
      },
      (error) => {
        flight.settled = true;
        if (this.flights.get(key) === flight) this.flights.delete(key);
        throw error;
      },
    );
    this.flights.set(key, flight);
    return flight;
  }

  /** Wait for the call; a caller who leaves stops waiting, and the call stops once nobody is left to read it. */
  private async wait(key: string, flight: Flight, signal?: AbortSignal): Promise<AskAnswer> {
    flight.waiting++;
    let leave: (() => void) | undefined;
    try {
      return await Promise.race([
        flight.promise,
        new Promise<never>((_, reject) => {
          if (!signal) return;
          leave = () => reject(signal.reason ?? new DOMException('This operation was aborted', 'AbortError'));
          if (signal.aborted) leave();
          else signal.addEventListener('abort', leave, { once: true });
        }),
      ]);
    } finally {
      if (leave) signal?.removeEventListener('abort', leave);
      if (--flight.waiting === 0 && !flight.settled) {
        // A question asked from now on starts its own call instead of joining the one being stopped.
        if (this.flights.get(key) === flight) this.flights.delete(key);
        flight.stop.abort(signal?.reason);
      }
    }
  }

  private store(key: string, answer: AskAnswer): void {
    const now = this.now();
    this.answers.delete(key);
    if (this.answers.size >= this.max) {
      for (const [k, entry] of this.answers) if (entry.expires <= now) this.answers.delete(k);
      while (this.answers.size >= this.max) this.answers.delete(this.answers.keys().next().value!);
    }
    this.answers.set(key, { answer: structuredClone(answer), expires: now + this.ttlMs });
  }
}

/** Questions are the same up to case, spacing and Unicode composition: "Why  scale?" and "why scale?". */
const fold = (text: string) => text.normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase().toLowerCase();
/** JSON with the keys of every object in order, so equal values give equal text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/**
 * The key of one question: whose it is, which document version and tour step it is about, what was asked (with the
 * conversation before it, which changes what a follow-up means), what the learner selected and looked at, the answer
 * language and the model. Anything that could change the answer is in it, nothing that cannot.
 */
export function answerKey(input: {
  /** The learner: an owner ID, or `demo` for a demo paper. */
  scope: string;
  documentId: string;
  /** The analysis the question is answered against, or the document's hash for a demo paper. */
  version: string;
  request: AskRequest;
  /** The tour step the learner was on, with the words it said. */
  step?: Step;
  /** The language of the tour's voice; without a tour the answer follows the document, and the server's default is fixed. */
  language?: string;
  model: string;
}): string {
  const { request } = input;
  return createHash('sha256')
    .update(
      canonical([
        input.scope,
        input.documentId,
        input.version,
        request.tourId ?? null,
        input.step ?? null,
        fold(request.question),
        (request.history ?? []).map((turn) => [fold(turn.question), turn.answer]),
        request.selection ?? null,
        request.figureId ?? null,
        request.responseLanguage ?? null,
        input.language ?? null,
        input.model,
      ]),
    )
    .digest('hex');
}
