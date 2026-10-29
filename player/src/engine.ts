// Tour engine: plays a tour step by step against a narrator. Framework-free and deterministic,
// so it can be driven by tests with a fake narrator and fake timers.

import { DEFAULT_HOLD_MS, DEFAULT_SPEAKER, splitWords } from './types';
import type { Action, BoardControl, BoardItem, CameraAction, Checkpoint, OverlayAction, Step, Tour } from './types';
import { normalizeCheckpoint } from './coach';
import type { AlsoTarget } from './camera';
import { sentenceStart, sentenceStarts } from './narration/narrator';
import type { NarrationHandle, Narrator, SpeakCallbacks, SpeakRequest } from './narration/narrator';

export type Status = 'idle' | 'playing' | 'paused' | 'ended';

export interface ScheduledAction {
  /** `<step index>:<action index>`; stable, so the UI can keep an overlay mounted across rebuilds. */
  key: string;
  at: number;
  action: Action;
  /** A camera move only: what the step marks while the move holds, so the frame can keep it all in view. */
  also?: AlsoTarget[];
}

export interface FlatStep {
  index: number;
  chapterIndex: number;
  indexInChapter: number;
  step: Step;
  words: string[];
  /** Initial camera at zero, then actions sorted by at_word; ties keep tour order. */
  schedule: ScheduledAction[];
  /** The learner tries this before the next step reveals it: the tour pauses after the narration. */
  checkpoint: Checkpoint | null;
}

export interface OverlayEntry {
  key: string;
  step: number;
  action: OverlayAction;
  persist: boolean;
  /** Its step ended: it stays a moment longer to fade out as the tour moves on. */
  leaving?: boolean;
}

/** How long the marks of a step that ended take to fade out. */
export const FADE_MS = 250;

export interface CameraCommand {
  /** Increments on every camera change, so the same target twice still moves the camera. */
  seq: number;
  key: string | null;
  /** null = the initial view (no camera action yet). */
  action: CameraAction | null;
  /** The other marks shown while this move holds (see ScheduledAction.also). */
  also?: AlsoTarget[];
}

/** The side board: an item stays across steps until replaced or cleared; its focus belongs to the current step. */
export interface BoardState {
  /** Key of the action that put the item on the board; null when the board is empty. */
  key: string | null;
  item: BoardItem | null;
  /** The lit part (formula term, flow node or bar), or null. */
  focus: number | null;
}

export const EMPTY_BOARD: BoardState = { key: null, item: null, focus: null };

/** A board's animation clock follows speech, including pause, restart and silent step previews. */
export interface BoardPlayback {
  playing: boolean;
  progress: number;
}

export interface EngineState {
  status: Status;
  index: number;
  /** Highest narrated word of the current step; -1 before the first. */
  word: number;
  overlays: OverlayEntry[];
  camera: CameraCommand;
  board: BoardState;
  /** A silent seek shows all of the selected step's actions, rather than an in-progress word. */
  preview?: boolean;
  /** The step's narration is done and its checkpoint waits for the learner: paused until the answer is asked for. */
  awaiting?: boolean;
}

/** Progress over the current board's narrated interval, not a separate wall clock. */
export function boardPlayback(state: EngineState, steps: readonly FlatStep[]): BoardPlayback {
  const key = state.board.key;
  if (!key || !state.board.item) return { playing: false, progress: 1 };
  const origin = steps[Number(key.split(':')[0])];
  const actionIndex = origin?.schedule.findIndex((action) => action.key === key) ?? -1;
  if (!origin || actionIndex < 0 || origin.index !== state.index || state.preview || state.status === 'ended')
    return { playing: false, progress: 1 };
  const start = origin.schedule[actionIndex].at;
  const next = origin.schedule.slice(actionIndex + 1).find(({ action }) => action.type === 'board' || action.type === 'board_clear');
  const end = Math.min(next?.at ?? origin.words.length, origin.words.length);
  const progress = end <= start ? Number(state.word >= origin.words.length - 1)
    : Math.max(0, Math.min(1, (state.word + 1 - start) / (end - start)));
  return { playing: state.status === 'playing', progress };
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

export function isBoard(a: Action): a is BoardControl {
  return a.type === 'board' || a.type === 'board_focus' || a.type === 'board_clear';
}

/** The board after one board action; a focus only counts in the step being shown. */
export function boardAfter(board: BoardState, a: BoardControl, key: string, current: boolean): BoardState {
  // Older saved tours may contain removed video boards. Skip them without opening an empty panel or stalling playback.
  if (a.type === 'board')
    return ['formula', 'flow', 'bars', 'plot', 'scene', 'heatmap', 'scatter', 'shapes'].includes(a.item.kind)
      ? { key, item: a.item, focus: null }
      : EMPTY_BOARD;
  if (a.type === 'board_clear') return EMPTY_BOARD;
  return current && board.item ? { ...board, focus: a.part } : board;
}

/** What a mark points at, for keeping it in the camera's frame. */
function markedBy(a: Action): AlsoTarget[] {
  switch (a.type) {
    case 'highlight':
      return a.targets.map((target) => ({ target }));
    case 'box':
    case 'arrow':
    case 'circle':
    case 'spotlight':
      return [{ target: a.target, region: a.region }];
    case 'note':
      return [{ target: a.anchor, region: a.region }];
    default:
      return [];
  }
}

/** Each camera move takes the marks scheduled from it up to the next camera move. */
function keepInFrame(schedule: ScheduledAction[]): void {
  const moves = schedule.filter((item) => isCamera(item.action));
  moves.forEach((move, i) => {
    const until = moves[i + 1]?.at ?? Infinity;
    const marks = schedule.filter((item) => item.at >= move.at && item.at < until).flatMap((item) => markedBy(item.action));
    if (marks.length) move.also = marks;
  });
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
        .map(({ key, at, action }): ScheduledAction => ({ key, at, action }));
      keepInFrame(schedule);
      out.push({ index, chapterIndex, indexInChapter, step, words: splitWords(step.say), schedule, checkpoint: normalizeCheckpoint(step.checkpoint) });
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
  /** The word this run of the step began at: where the narration stands before it has said anything. */
  private from = 0;
  private overlays: OverlayEntry[] = [];
  private camera: CameraCommand = { seq: 0, key: null, action: null };
  private board: BoardState = EMPTY_BOARD;
  private state: EngineState;

  /** Incremented whenever a run is started or stopped; callbacks from older runs are ignored. */
  private token = 0;
  private handle: NarrationHandle | null = null;
  private holdTimer: unknown = null;
  private fadeTimer: unknown = null;
  private nextAction = 0;
  private narrationDone = false;
  private preview = false;
  /** Paused at a checkpoint after its step's narration. */
  private awaiting = false;

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
    // Play at a checkpoint is "show me": the next step reveals the answer.
    if (this.awaiting) return this.proceed();
    if (this.status === 'ended') this.startStep(0);
    // A pause in the middle of a step goes on from there; a silent preview plays the step from its start.
    else if (this.status === 'paused' && !this.preview && this.word >= 0) this.resume();
    else this.startStep(this.index);
  }

  /** The learner is done trying (or gives up): go on to the step that reveals the answer. */
  reveal(): void {
    if (this.awaiting) this.proceed();
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

  /**
   * Go to a word of a step, snapped back to the start of its sentence. While playing it speaks from
   * there; otherwise it shows the step as it is just before that word, without speaking.
   */
  seekTo(index: number, word = 0): void {
    if (!this.steps.length) return;
    const i = Math.max(0, Math.min(this.steps.length - 1, Math.floor(index)));
    const from = sentenceStart(this.steps[i].words, word);
    if (this.status === 'playing') return this.startStep(i, from);
    this.stopRun();
    this.rebuild(i, false);
    this.enterStep(i, from);
  }

  /** A sentence on: the start of the next one, or of the next step. Backwards: this sentence's start, or the one before. */
  skip(direction: 1 | -1): void {
    if (!this.steps.length) return;
    if (this.status === 'idle') return this.goTo(0);
    const { words } = this.steps[this.index];
    const starts = sentenceStarts(words);
    if (!starts.length) return direction > 0 ? this.next() : this.prev();
    // Just after a seek no word has been spoken yet: the run's own start is where the narration stands.
    const at = Math.max(0, this.word, this.from);
    const here = starts.filter((start) => start <= at).length - 1;
    if (direction > 0) {
      if (here + 1 < starts.length) this.seekTo(this.index, starts[here + 1]);
      else if (this.index + 1 < this.steps.length) this.seekTo(this.index + 1, 0);
    } else if (at - starts[Math.max(0, here)] >= 3 || (here === 0 && this.index === 0)) {
      this.seekTo(this.index, starts[Math.max(0, here)]);
    } else if (here > 0) this.seekTo(this.index, starts[here - 1]);
    else {
      const before = this.steps[this.index - 1];
      this.seekTo(this.index - 1, sentenceStarts(before.words).at(-1) ?? 0);
    }
  }

  /** The first step of the next chapter, or of this one when the tour is already well into it. */
  chapterStart(direction: 1 | -1): number {
    const current = this.steps[this.index];
    if (!current) return 0;
    const first = (chapter: number) => this.steps.findIndex((step) => step.chapterIndex === chapter);
    if (direction > 0) {
      const next = first(current.chapterIndex + 1);
      return next < 0 ? this.steps.length - 1 : next;
    }
    const own = first(current.chapterIndex);
    return own < this.index || this.word > 2 ? own : Math.max(0, first(current.chapterIndex - 1));
  }

  /** Swap the narrator (e.g. mute). A playing step goes on with the new one from its sentence; the same narrator again changes nothing. */
  setNarrator(narrator: Narrator): void {
    if (narrator === this.narrator) return;
    this.narrator = narrator;
    if (this.status === 'playing') this.resume();
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
    this.timers.clearTimeout(this.fadeTimer);
    this.listeners.clear();
  }

  // ------------------------------------------------------------ internals

  private snapshot(): EngineState {
    return {
      status: this.status,
      index: this.index,
      word: this.word,
      overlays: this.overlays,
      camera: this.camera,
      board: this.board,
      preview: this.preview,
      awaiting: this.awaiting,
    };
  }

  private emit(): void {
    this.state = this.snapshot();
    for (const l of [...this.listeners]) l();
  }

  private stopRun(): void {
    this.token++;
    this.awaiting = false;
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
    let camera: { key: string; action: CameraAction; also?: AlsoTarget[] } | null = null;
    let board = EMPTY_BOARD;
    const last = includeCurrent ? i : i - 1;
    for (let k = 0; k <= last; k++) {
      for (const item of this.steps[k].schedule) {
        const a = item.action;
        if (a.type === 'clear') overlays = overlays.filter((o) => !o.persist);
        else if (isCamera(a)) camera = { key: item.key, action: a, also: item.also };
        else if (isBoard(a)) board = boardAfter(board, a, item.key, k === i);
        else if (k === i || a.persist) overlays.push({ key: item.key, step: k, action: a, persist: !!a.persist });
      }
    }
    this.overlays = overlays;
    this.timers.clearTimeout(this.fadeTimer);
    this.fadeTimer = null;
    this.board = board;
    this.camera = { seq: this.camera.seq + 1, key: camera?.key ?? null, action: camera?.action ?? null, also: camera?.also };
    if (includeCurrent) this.nextAction = this.steps[i].schedule.length;
  }

  private apply(item: ScheduledAction, step: number): void {
    const a = item.action;
    if (a.type === 'clear') {
      this.overlays = this.overlays.filter((o) => !o.persist);
    } else if (isCamera(a)) {
      this.camera = { seq: this.camera.seq + 1, key: item.key, action: a, also: item.also };
    } else if (isBoard(a)) {
      this.board = boardAfter(this.board, a, item.key, true);
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
    this.from = 0;
    this.preview = true;
    this.status = 'paused';
    this.emit();
  }

  /** Play step `i` from word `from`, on the state a natural run would have reached there. */
  private startStep(i: number, from = 0): void {
    this.stopRun();
    this.rebuild(i, false);
    this.runStep(i, from);
  }

  /** The step as it is just before word `from`, paused: marks up to the word before it are shown. */
  private enterStep(i: number, from: number): void {
    this.index = i;
    this.word = from - 1;
    this.from = from;
    this.preview = false;
    this.status = 'paused';
    this.begin(from);
    this.emit();
  }

  /** Set up a step on top of the visual state: its marks up to the word before `from` are shown. */
  private begin(from: number): void {
    // The item persists across steps, but a term/node focus belongs to the words
    // that named it. Rebuilding a seek and advancing naturally must agree.
    if (this.board.focus !== null) this.board = { ...this.board, focus: null };
    this.nextAction = 0;
    this.narrationDone = false;
    this.fireUpTo(Math.max(0, from - 1));
  }

  /** Run step `i` on top of the current visual state, speaking from word `from`. */
  private runStep(i: number, from = 0): void {
    const token = ++this.token;
    const fs = this.steps[i];
    this.index = i;
    this.status = 'playing';
    this.word = from - 1;
    this.from = from;
    this.preview = false;
    this.begin(from);
    this.emit();
    if (token !== this.token) return;

    void this.speakStep(fs, token, from);
  }

  /**
   * Go on with the step in progress from the start of the sentence it was in. The step's marks
   * rewind to that point and replay as the sentence is spoken again, as in a natural run.
   */
  private resume(): void {
    if (!this.narrationDone) return this.startStep(this.index, sentenceStart(this.steps[this.index].words, this.word + 1));
    // Paused while the step was holding: only the rest of the hold is left.
    this.stopRun();
    const token = ++this.token;
    this.status = 'playing';
    this.emit();
    if (token !== this.token) return;
    this.holdTimer = this.timers.setTimeout(() => {
      if (token !== this.token) return;
      this.holdTimer = null;
      this.advance();
    }, this.steps[this.index].step.hold_ms ?? DEFAULT_HOLD_MS);
  }

  private async speakStep(fs: FlatStep, token: number, from: number): Promise<void> {
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
      startWord: from,
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
    if (fs.checkpoint) {
      // The learner tries first: nothing advances until they ask for the answer (play, next or "Show solution").
      this.awaiting = true;
      this.status = 'paused';
      this.emit();
      return;
    }
    this.emit();
    if (token !== this.token) return;
    this.holdTimer = this.timers.setTimeout(() => {
      if (token !== this.token) return;
      this.holdTimer = null;
      this.advance();
    }, fs.step.hold_ms ?? DEFAULT_HOLD_MS);
  }

  private proceed(): void {
    this.awaiting = false;
    this.advance();
  }

  private advance(): void {
    if (this.index + 1 < this.steps.length) {
      // The step's marks fade out as the camera moves on, instead of vanishing.
      if (this.overlays.some((o) => !o.persist)) {
        this.overlays = this.overlays.map((o) => (o.persist ? o : { ...o, leaving: true }));
        this.timers.clearTimeout(this.fadeTimer);
        this.fadeTimer = this.timers.setTimeout(() => {
          this.fadeTimer = null;
          if (!this.overlays.some((o) => o.leaving)) return;
          this.overlays = this.overlays.filter((o) => !o.leaving);
          this.emit();
        }, FADE_MS);
      }
      this.runStep(this.index + 1);
    } else {
      this.token++;
      this.status = 'ended';
      this.emit();
    }
  }
}
