import type { Step } from './types';
import type { ReadingPassage } from '../../shared/reading';

interface Flight {
  controller: AbortController;
  promise: Promise<ReadingPassage>;
  users: number;
  background: boolean;
}
export interface PreparationSnapshot {
  completed: number;
  total: number;
  active: boolean;
  paused: boolean;
  blocked: boolean;
  failed: number;
  foreground: boolean;
}

/** Prepare the remaining reading in order; playback shares requests and takes priority over background work. */
export class ReadingPreparation {
  private readonly cache = new Map<string, ReadingPassage>();
  private readonly flights = new Map<string, Flight>();
  private wanted = new Set<string>();
  private queue: Step[] = [];
  private readonly failed = new Set<string>();
  private canStart = false;
  private disposed = false;
  private blocked = false;
  private consecutiveFailures = 0;
  private backgroundPaused = false;
  private readonly known = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private snapshot: PreparationSnapshot = {
    completed: 0,
    total: 0,
    active: false,
    paused: false,
    blocked: false,
    failed: 0,
    foreground: false,
  };
  getSnapshot = () => this.snapshot;
  subscribe = (notify: () => void) => {
    this.listeners.add(notify);
    return () => {
      this.listeners.delete(notify);
    };
  };
  pauseBackground = () => {
    this.backgroundPaused = true;
    this.notify();
  };
  resumeBackground = () => {
    this.backgroundPaused = false;
    this.blocked = false;
    this.failed.clear();
    this.notify();
    this.pump();
  };
  private notify() {
    const completed = [...this.known].filter((id) => this.cache.has(id)).length;
    this.snapshot = {
      completed,
      total: this.known.size,
      active:
        !this.disposed &&
        (this.flights.size > 0 ||
          (this.canStart &&
            !this.blocked &&
            !this.backgroundPaused &&
            this.queue.some((step) => !this.cache.has(step.id) && !this.failed.has(step.id)))),
      paused: this.backgroundPaused || !this.canStart,
      blocked: this.blocked,
      failed: this.failed.size,
      foreground: [...this.flights.values()].some((flight) => flight.users > 0),
    };
    this.listeners.forEach((notify) => notify());
  }
  constructor(
    private readonly request: (step: Step, signal: AbortSignal) => Promise<ReadingPassage>,
    private readonly suspendOnError: (error: unknown) => boolean = () => true,
  ) {}

  /** React StrictMode replays effect setup after cleanup on the same memoized instance. */
  activate(): void {
    this.disposed = false;
  }

  async get(step: Step, signal: AbortSignal): Promise<ReadingPassage> {
    signal.throwIfAborted();
    if (this.disposed) throw new DOMException('Reading preparation disposed', 'AbortError');
    const stored = this.cache.get(step.id);
    if (stored) return structuredClone(stored);
    this.failed.delete(step.id);
    this.blocked = false;
    this.consecutiveFailures = 0;
    const flight = this.flights.get(step.id) ?? this.start(step, false);
    flight.users++;
    this.notify();
    let abort: (() => void) | undefined;
    try {
      return structuredClone(
        await Promise.race([
          flight.promise,
          new Promise<never>((_, reject) => {
            abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
            if (signal.aborted) abort();
            else signal.addEventListener('abort', abort, { once: true });
          }),
        ]),
      );
    } finally {
      if (abort) signal.removeEventListener('abort', abort);
      flight.users--;
      this.cancelUnused(step.id, flight);
      this.notify();
    }
  }

  /** Retain an approaching passage even during its camera move, before speech joins its prefetched request. */
  plan(current: Step | null, following: Step[], canStart: boolean): void {
    if (current && canStart && !this.canStart) this.blocked = false;
    this.canStart = !!current && canStart;
    this.wanted = new Set(current ? [current.id, ...following.map((s) => s.id)] : []);
    this.queue = current ? [current, ...following] : [];
    for (const step of this.queue) this.known.add(step.id);
    for (const id of this.failed) if (!this.wanted.has(id)) this.failed.delete(id);
    for (const [id, flight] of this.flights) this.cancelUnused(id, flight);
    // A backward seek may leave a far-future preparation wanted, but the new current passage comes first.
    if (this.canStart && current && !this.cache.has(current.id) && !this.flights.has(current.id)) {
      for (const [id, flight] of this.flights) {
        if (flight.background && !flight.users) {
          this.flights.delete(id);
          flight.controller.abort();
        }
      }
    }
    this.pump();
    this.notify();
  }

  dispose(): void {
    this.disposed = true;
    this.canStart = false;
    this.wanted.clear();
    this.queue = [];
    for (const flight of this.flights.values()) flight.controller.abort();
    this.flights.clear();
    this.notify();
  }

  private cancelUnused(id: string, flight: Flight): void {
    if (flight.users || this.wanted.has(id) || this.flights.get(id) !== flight) return;
    this.flights.delete(id);
    flight.controller.abort();
  }

  private start(step: Step, background: boolean): Flight {
    const controller = new AbortController();
    const flight: Flight = { controller, users: 0, background, promise: undefined! };
    flight.promise = Promise.resolve()
      .then(() => {
        controller.signal.throwIfAborted();
        return this.request(step, controller.signal);
      })
      .then((result) => {
        controller.signal.throwIfAborted();
        this.consecutiveFailures = 0;
        this.cache.set(step.id, result);
        return result;
      })
      .catch((error) => {
        // A failed foreground retry must not immediately restart as background work either.
        if (!controller.signal.aborted) {
          this.failed.add(step.id);
          // An isolated content error may leave later units usable; outages and consecutive failures stop the queue.
          this.blocked = this.suspendOnError(error) || ++this.consecutiveFailures >= 2;
        }
        throw error;
      })
      .finally(() => {
        if (this.flights.get(step.id) === flight) this.flights.delete(step.id);
        this.pump();
        this.notify();
      });
    this.flights.set(step.id, flight);
    this.notify();
    if (background) void flight.promise.catch(() => undefined);
    return flight;
  }

  private pump(): void {
    if (
      this.disposed ||
      this.blocked ||
      this.backgroundPaused ||
      !this.canStart ||
      [...this.flights.values()].some((f) => f.background)
    )
      return;
    const next = this.queue.find((s) => !this.cache.has(s.id) && !this.flights.has(s.id) && !this.failed.has(s.id));
    if (next) this.start(next, true);
  }
}
