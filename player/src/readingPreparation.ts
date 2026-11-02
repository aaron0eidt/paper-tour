import type { Step } from './types';
import type { ReadingPassage } from '../../shared/reading';

interface Flight {
  controller: AbortController;
  promise: Promise<ReadingPassage>;
  users: number;
  background: boolean;
}

/** Foreground and lookahead share one request. A small scheduling window never limits document content. */
export class ReadingPreparation {
  private readonly cache = new Map<string, ReadingPassage>();
  private readonly flights = new Map<string, Flight>();
  private wanted = new Set<string>();
  private queue: Step[] = [];
  private readonly failed = new Set<string>();
  private canStart = false;
  private disposed = false;
  constructor(private readonly request: (step: Step, signal: AbortSignal) => Promise<ReadingPassage>) {}

  /** React StrictMode replays effect setup after cleanup on the same memoized instance. */
  activate(): void { this.disposed = false; }

  async get(step: Step, signal: AbortSignal): Promise<ReadingPassage> {
    signal.throwIfAborted();
    if (this.disposed) throw new DOMException('Reading preparation disposed', 'AbortError');
    const stored = this.cache.get(step.id);
    if (stored) return structuredClone(stored);
    this.failed.delete(step.id);
    const flight = this.flights.get(step.id) ?? this.start(step, false);
    flight.users++;
    let abort: (() => void) | undefined;
    try {
      return structuredClone(await Promise.race([flight.promise, new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      })]));
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
      flight.users--;
      this.cancelUnused(step.id, flight);
    }
  }

  /** Retain an approaching passage even during its camera move, before speech joins its prefetched request. */
  plan(current: Step | null, following: Step[], canStart: boolean): void {
    this.canStart = !!current && canStart;
    this.wanted = new Set(current ? [current.id, ...following.map((s) => s.id)] : []);
    this.queue = current ? following : [];
    for (const id of this.failed) if (!this.wanted.has(id)) this.failed.delete(id);
    for (const [id, flight] of this.flights) this.cancelUnused(id, flight);
    this.pump();
  }

  dispose(): void {
    this.disposed = true;
    this.canStart = false;
    this.wanted.clear();
    this.queue = [];
    for (const flight of this.flights.values()) flight.controller.abort();
    this.flights.clear();
  }

  private cancelUnused(id: string, flight: Flight): void {
    if (flight.users || this.wanted.has(id) || this.flights.get(id) !== flight) return;
    this.flights.delete(id);
    flight.controller.abort();
  }

  private start(step: Step, background: boolean): Flight {
    const controller = new AbortController();
    const flight: Flight = { controller, users: 0, background, promise: undefined! };
    flight.promise = Promise.resolve().then(() => {
      controller.signal.throwIfAborted();
      return this.request(step, controller.signal);
    }).then((result) => {
      controller.signal.throwIfAborted();
      this.cache.set(step.id, result);
      return result;
    }).catch((error) => {
      // A failed foreground retry must not immediately restart as background work either.
      if (!controller.signal.aborted) this.failed.add(step.id);
      throw error;
    }).finally(() => {
      if (this.flights.get(step.id) === flight) this.flights.delete(step.id);
      this.pump();
    });
    this.flights.set(step.id, flight);
    if (background) void flight.promise.catch(() => undefined);
    return flight;
  }

  private pump(): void {
    if (this.disposed || !this.canStart || [...this.flights.values()].some((f) => f.background)) return;
    const next = this.queue.find((s) => !this.cache.has(s.id) && !this.flights.has(s.id) && !this.failed.has(s.id));
    if (next) this.start(next, true);
  }
}
