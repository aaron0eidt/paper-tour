// Tour engine: plays a tour step by step against a narrator. Framework-free and deterministic,
// so it can be driven by tests with a fake narrator and fake timers.

import { DEFAULT_HOLD_MS, DEFAULT_SPEAKER, splitWords } from './types';
import type { Action, CameraAction, OverlayAction, Step, Tour } from './types';
import type { NarrationHandle, Narrator, SpeakCallbacks, SpeakRequest } from './narration/narrator';

export type Status = 'idle' | 'playing' | 'paused' | 'ended';

export interface ScheduledAction {
  /** `<step index>:<action index>`; stable, so the UI can keep an overlay mounted across rebuilds. */
  key: string;
  at: number;
  action: Action;
}

export interface FlatStep {
  index: number;
  chapterIndex: number;
  indexInChapter: number;
  step: Step;
  words: string[];
  /** Initial camera at zero, then actions sorted by at_word; ties keep tour order. */
  schedule: ScheduledAction[];
}

export interface OverlayEntry {
  key: string;
  step: number;
  action: OverlayAction;
  persist: boolean;
}

export interface CameraCommand {
  /** Increments on every camera change, so the same target twice still moves the camera. */
  seq: number;
  key: string | null;
  /** null = the initial view (no camera action yet). */
  action: CameraAction | null;
}

export interface EngineState {
  status: Status;
  index: number;
  /** Highest narrated word of the current step; -1 before the first. */
  word: number;
  overlays: OverlayEntry[];
  camera: CameraCommand;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface EngineOptions {
  narrator: Narrator;
  /** Used for a step when the narrator throws. */
  fallbackNarrator?: Narrator;
  rate?: number;
  timers?: Timers;
  /** Wait for the initial camera move; later word-synchronized moves do not delay speech. */
  beforeNarration?: (signal: AbortSignal) => Promise<void>;
}

const realTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

export function isCamera(a: Action): a is CameraAction {
  return a.type === 'focus' || a.type === 'zoom';
}

export function flattenTour(tour: Tour): FlatStep[] {
  const out: FlatStep[] = [];
  tour.chapters.forEach((chapter, chapterIndex) => {
    chapter.steps.forEach((step, indexInChapter) => {
      const index = out.length;
      const firstCamera = step.actions.findIndex(isCamera);
      const schedule = step.actions
        .map((action, i) => ({
          key: `${index}:${i}`,
          at: i === firstCamera ? 0 : Math.max(0, Math.floor(action.at_word ?? 0)),
          action,
          i,
        }))
        .sort((a, b) => a.at - b.at || a.i - b.i)
        .map(({ key, at, action }) => ({ key, at, action }));
      out.push({ index, chapterIndex, indexInChapter, step, words: splitWords(step.say), schedule });
    });
  });
  return out;
}

export class TourEngine {
  readonly tour: Tour;
  readonly steps: FlatStep[];

  private narrator: Narrator;
  private fallback?: Narrator;
  private rate: number;
  private timers: Timers;
  private beforeNarration?: EngineOptions['beforeNarration'];
  private preparation: AbortController | null = null;
  private listeners = new Set<() => void>();

  private status: Status = 'idle';
  private index = 0;
  private word = -1;
  private overlays: OverlayEntry[] = [];
  private camera: CameraCommand = { seq: 0, key: null, action: null };
  private state: EngineState;

  /** Incremented whenever a run is started or stopped; callbacks from older runs are ignored. */
  private token = 0;
  private handle: NarrationHandle | null = null;
  private holdTimer: unknown = null;
  private nextAction = 0;
  private narrationDone = false;

  constructor(tour: Tour, opts: EngineOptions) {
    this.tour = tour;
    this.steps = flattenTour(tour);
    this.narrator = opts.narrator;
    this.fallback = opts.fallbackNarrator;
    this.rate = opts.rate ?? 1;
    this.timers = opts.timers ?? realTimers;
    this.beforeNarration = opts.beforeNarration;
    this.state = this.snapshot();
  }

  // ------------------------------------------------------------ public API

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getState = (): EngineState => this.state;

  get total(): number {
    return this.steps.length;
  }

  play(): void {
    if (this.status === 'playing' || !this.steps.length) return;
    // Resume restarts the current step: speechSynthesis.pause/resume is unreliable in Chrome.
    this.startStep(this.status === 'ended' ? 0 : this.index);
  }

  pause(): void {
    if (this.status !== 'playing') return;
    this.stopRun();
    this.status = 'paused';
    this.emit();
  }

  toggle(): void {
    if (this.status === 'playing') this.pause();
    else this.play();
  }

  next(): void {
    if (this.status === 'idle') this.goTo(0);
    else if (this.index + 1 < this.steps.length) this.goTo(this.index + 1);
  }

  prev(): void {
    if (this.status !== 'idle' && this.index > 0) this.goTo(this.index - 1);
  }

  /** Jump to a step. While playing it plays from there; otherwise it shows the step's full state silently. */
  goTo(index: number): void {
    if (!this.steps.length) return;
    const i = Math.max(0, Math.min(this.steps.length - 1, Math.floor(index)));
    if (this.status === 'playing') this.startStep(i);
    else this.showStep(i);
  }

  /** Swap the narrator (e.g. mute). A playing step restarts with the new one. */
  setNarrator(narrator: Narrator): void {
    this.narrator = narrator;
    if (this.status === 'playing') this.startStep(this.index);
  }

  /** Also changes the speed of the narration in progress, where the narrator supports it. */
  setRate(rate: number): void {
    this.rate = rate;
    try {
      this.handle?.setRate?.(rate);
    } catch (err) {
      console.warn('[engine] narrator setRate failed', err);
    }
  }

  destroy(): void {
    this.stopRun();
    this.listeners.clear();
  }

  // ------------------------------------------------------------ internals

  private snapshot(): EngineState {
    return { status: this.status, index: this.index, word: this.word, overlays: this.overlays, camera: this.camera };
  }

  private emit(): void {
    this.state = this.snapshot();
    for (const l of [...this.listeners]) l();
  }

  private stopRun(): void {
    this.token++;
    this.preparation?.abort();
    this.preparation = null;
    const handle = this.handle;
    this.handle = null;
    if (handle) {
      try {
        handle.cancel();
      } catch (err) {
        console.warn('[engine] narrator cancel failed', err);
      }
    }
    if (this.holdTimer !== null) {
      this.timers.clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
  }

  /**
   * Rebuild the visual state deterministically for step `i`: persistent overlays (and clears) of all
   * earlier steps in order, and the last camera action before it. With `includeCurrent`, every
   * action of step `i` is applied too (the silent "show this step" view).
   */
  private rebuild(i: number, includeCurrent: boolean): void {
    let overlays: OverlayEntry[] = [];
    let camera: { key: string; action: CameraAction } | null = null;
    const last = includeCurrent ? i : i - 1;
    for (let k = 0; k <= last; k++) {
      for (const item of this.steps[k].schedule) {
        const a = item.action;
        if (a.type === 'clear') overlays = overlays.filter((o) => !o.persist);
        else if (isCamera(a)) camera = { key: item.key, action: a };
        else if (k === i || a.persist) overlays.push({ key: item.key, step: k, action: a, persist: !!a.persist });
      }
    }
    this.overlays = overlays;
    this.camera = { seq: this.camera.seq + 1, key: camera?.key ?? null, action: camera?.action ?? null };
    if (includeCurrent) this.nextAction = this.steps[i].schedule.length;
  }

  private apply(item: ScheduledAction, step: number): void {
    const a = item.action;
    if (a.type === 'clear') {
      this.overlays = this.overlays.filter((o) => !o.persist);
    } else if (isCamera(a)) {
      this.camera = { seq: this.camera.seq + 1, key: item.key, action: a };
    } else {
      const entry = { key: item.key, step, action: a, persist: !!a.persist };
      this.overlays = [...this.overlays.filter((o) => o.key !== item.key), entry];
    }
  }

  private fireUpTo(word: number): void {
    const { schedule, index } = this.steps[this.index];
    while (this.nextAction < schedule.length && schedule[this.nextAction].at <= word) {
      this.apply(schedule[this.nextAction], index);
      this.nextAction++;
    }
  }

  private showStep(i: number): void {
    this.stopRun();
    this.index = i;
    this.rebuild(i, true);
    this.word = -1;
    this.status = 'paused';
    this.emit();
  }

  private startStep(i: number): void {
    this.stopRun();
    this.rebuild(i, false);
    this.runStep(i);
  }

  /** Run step `i` on top of the current visual state. */
  private runStep(i: number): void {
    const token = ++this.token;
    const fs = this.steps[i];
    this.index = i;
    this.status = 'playing';
    this.word = -1;
    this.nextAction = 0;
    this.narrationDone = false;
    this.fireUpTo(0);
    this.emit();
    if (token !== this.token) return;

    void this.speakStep(fs, token);
  }

  private async speakStep(fs: FlatStep, token: number): Promise<void> {
    if (this.beforeNarration) {
      const preparation = new AbortController();
      this.preparation = preparation;
      try {
        await this.beforeNarration(preparation.signal);
      } catch (error) {
        if (!preparation.signal.aborted) console.warn('[engine] camera preparation failed', error);
      } finally {
        if (this.preparation === preparation) this.preparation = null;
      }
    }
    if (token !== this.token) return;

    const speaker = fs.step.speaker ?? DEFAULT_SPEAKER;
    const req: SpeakRequest = {
      text: fs.step.say,
      words: fs.words,
      speaker,
      voice: this.tour.voices?.[speaker],
      rate: this.rate,
      audio: fs.step.audio,
    };
    for (const narrator of [this.narrator, this.fallback]) {
      if (token !== this.token || this.narrationDone) return;
      if (!narrator) continue;
      // A failed speak() may still have scheduled callbacks. Isolate each attempt,
      // including the fallback, without changing the current step's identity.
      let active = true;
      const cb: SpeakCallbacks = {
        onWord: (w) => {
          if (active && token === this.token) this.onWord(w);
        },
        onEnd: () => {
          if (active && token === this.token) this.onNarrationEnd(token);
        },
      };
      try {
        const handle = narrator.speak(req, cb);
        // speak() may have finished (or the engine moved on) synchronously.
        if (token !== this.token) handle.cancel();
        else if (!this.narrationDone) this.handle = handle;
        return;
      } catch (err) {
        active = false;
        console.warn(`[engine] ${narrator.name} narrator failed`, err);
      }
    }
    // No narrator could speak: never stall, just finish the step.
    if (token === this.token) this.onNarrationEnd(token);
  }

  private onWord(w: number): void {
    const word = Math.min(Math.floor(w), this.steps[this.index].words.length - 1);
    if (this.narrationDone || word <= this.word) return;
    this.word = word;
    this.fireUpTo(word);
    this.emit();
  }

  private onNarrationEnd(token: number): void {
    if (this.narrationDone) return;
    this.narrationDone = true;
    this.handle = null;
    const fs = this.steps[this.index];
    // Actions with at_word beyond the narration (or skipped by sparse word events) fire now.
    this.fireUpTo(Infinity);
    this.word = fs.words.length - 1;
    this.emit();
    if (token !== this.token) return;
    this.holdTimer = this.timers.setTimeout(() => {
      if (token !== this.token) return;
      this.holdTimer = null;
      this.advance();
    }, fs.step.hold_ms ?? DEFAULT_HOLD_MS);
  }

  private advance(): void {
    if (this.index + 1 < this.steps.length) {
      this.overlays = this.overlays.filter((o) => o.persist);
      this.runStep(this.index + 1);
    } else {
      this.token++;
      this.status = 'ended';
      this.emit();
    }
  }
}
