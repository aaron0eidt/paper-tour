// Engine tests with a fake narrator and fake timers. Run with `npm test` (esbuild bundles this
// file for Node, no test framework needed).

import { BOARD_KINDS, EMPTY_BOARD, FADE_MS, TourEngine, boardAfter, boardPlayback, flattenTour } from '../src/engine';
import type { EngineState, Timers } from '../src/engine';
import type { NarrationHandle, Narrator, SpeakCallbacks, SpeakRequest } from '../src/narration/narrator';
import { SilentNarrator } from '../src/narration/silent';
import { chunkWords } from '../src/narration/webSpeech';
import { parseNote } from '../src/markup';
import { Resolver, prepareTour } from '../src/resolve';
import { checkDoc, checkTour } from '../src/validate';
import type { BoardItem, Doc, Tour } from '../src/types';

// ------------------------------------------------------------------ harness

let failures = 0;
const results: string[] = [];
// Expected narrator failures and unknown IDs warn; keep the output readable.
const warnings: string[] = [];
console.warn = (...args: unknown[]) => void warnings.push(args.map(String).join(' '));

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push(`  ok    ${name}`);
  } catch (err) {
    failures++;
    results.push(`  FAIL  ${name}\n        ${(err as Error).message}`);
  }
}

function eq<T>(actual: T, expected: T, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

class FakeNarrator implements Narrator {
  readonly name = 'fake';
  calls: { req: SpeakRequest; cb: SpeakCallbacks; cancelled: boolean }[] = [];
  speak(req: SpeakRequest, cb: SpeakCallbacks): NarrationHandle {
    const call = { req, cb, cancelled: false };
    this.calls.push(call);
    // Deliberately keeps delivering callbacks after cancel, to exercise the engine's race guards.
    return { cancel: () => void (call.cancelled = true) };
  }
  get last() {
    return this.calls[this.calls.length - 1];
  }
}

class ThrowingNarrator implements Narrator {
  readonly name = 'throwing';
  speak(): NarrationHandle {
    throw new Error('no voice');
  }
}

class FakeTimers implements Timers {
  now = 0;
  private queue: { id: number; at: number; fn: () => void }[] = [];
  private nextId = 1;
  setTimeout(fn: () => void, ms: number) {
    const id = this.nextId++;
    this.queue.push({ id, at: this.now + ms, fn });
    return id;
  }
  clearTimeout(id: unknown) {
    this.queue = this.queue.filter((t) => t.id !== id);
  }
  tick(ms: number) {
    const end = this.now + ms;
    for (;;) {
      const due = this.queue.filter((t) => t.at <= end).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      this.queue = this.queue.filter((t) => t !== due);
      this.now = due.at;
      due.fn();
    }
    this.now = end;
  }
}

// ------------------------------------------------------------------ fixture

const tour: Tour = {
  schema: 'paper-tour/tour@0.1',
  title: 'Test tour',
  paper: 'test',
  voices: { guest: { lang: 'en-GB', rate: 1.2 } },
  chapters: [
    {
      id: 'c1',
      title: 'One',
      steps: [
        {
          id: 'a',
          say: 'one two three four five',
          actions: [
            { type: 'highlight', targets: ['p1.s1'], at_word: 2 }, // 0:0
            { type: 'focus', target: 'p1.b1' }, // 0:1
            { type: 'box', target: 'fig1', persist: true, at_word: 0 }, // 0:2
            { type: 'note', anchor: 'fig1', text: 'late', at_word: 99 }, // 0:3
          ],
        },
        {
          id: 'b',
          speaker: 'guest',
          say: 'six seven eight',
          hold_ms: 100,
          actions: [
            { type: 'spotlight', target: 'fig1', persist: true, at_word: 1 }, // 1:0
            { type: 'zoom', target: 'fig1', at_word: 2 }, // 1:1
          ],
        },
      ],
    },
    {
      id: 'c2',
      title: 'Two',
      steps: [
        {
          id: 'c',
          say: 'nine ten',
          actions: [
            { type: 'clear', at_word: 1 }, // 2:0
            { type: 'highlight', targets: ['p2.s1'], persist: true, at_word: 1 }, // 2:1
          ],
        },
        { id: 'd', say: 'eleven', hold_ms: 0, actions: [] },
      ],
    },
  ],
};

const keys = (s: EngineState) => s.overlays.map((o) => o.key);

function setup(narrator: Narrator = new FakeNarrator(), fallback?: Narrator) {
  const timers = new FakeTimers();
  const engine = new TourEngine(tour, { narrator, fallbackNarrator: fallback, timers });
  let emits = 0;
  engine.subscribe(() => emits++);
  return { engine, timers, narrator: narrator as FakeNarrator, emits: () => emits };
}

/** Finish the current step's narration and its hold. */
function finishStep(n: FakeNarrator, timers: FakeTimers) {
  n.last.cb.onEnd();
  timers.tick(1000);
}

// -------------------------------------------------------------------- tests

await test('flattenTour sorts actions by at_word, stable within ties', () => {
  const steps = flattenTour(tour);
  eq(steps.length, 4, 'steps');
  eq(steps[0].schedule.map((s) => s.key), ['0:1', '0:2', '0:0', '0:3'], 'schedule');
  eq(steps[2].schedule.map((s) => s.key), ['2:0', '2:1'], 'clear before highlight at the same word');
  eq([steps[2].chapterIndex, steps[2].indexInChapter], [1, 0], 'chapter position');
});

await test('the first camera move starts before narration even in an older delayed tour', () => {
  const delayed = structuredClone(tour);
  delayed.chapters[0].steps[0].actions = [
    { type: 'focus', target: 'p1.b1', at_word: 4 },
    { type: 'box', target: 'fig1', at_word: 2 },
    { type: 'zoom', target: 'fig1', at_word: 3 },
  ];
  const schedule = flattenTour(delayed)[0].schedule;
  eq(schedule.map((s) => [s.action.type, s.at]), [['focus', 0], ['box', 2], ['zoom', 3]]);
  eq(delayed.chapters[0].steps[0].actions[0].at_word, 4, 'saved tour stays unchanged');
});

await test('narration waits for the initial camera and pause cancels that wait', async () => {
  const narrator = new FakeNarrator();
  let ready!: () => void;
  let signal!: AbortSignal;
  const engine = new TourEngine(tour, {
    narrator,
    beforeNarration: (s) => { signal = s; return new Promise<void>((resolve) => { ready = resolve; }); },
  });
  engine.play();
  eq(engine.getState().camera.key, '0:1', 'camera requested before speech');
  eq(narrator.calls.length, 0);
  engine.pause();
  eq(signal.aborted, true);
  ready();
  await Promise.resolve();
  eq(narrator.calls.length, 0, 'cancelled step never starts speaking');
  engine.play();
  ready();
  await Promise.resolve();
  eq(narrator.calls.length, 1, 'speech starts after camera settles');
  engine.destroy();
});

await test('seeking during camera preparation starts only the latest step', async () => {
  const narrator = new FakeNarrator();
  const preparations: { signal: AbortSignal; ready: () => void }[] = [];
  const engine = new TourEngine(tour, {
    narrator,
    beforeNarration: (signal) => new Promise<void>((ready) => preparations.push({ signal, ready })),
  });
  engine.play();
  engine.next();
  eq(preparations[0].signal.aborted, true);
  preparations[0].ready();
  preparations[1].ready();
  await Promise.resolve();
  eq(narrator.calls.map((call) => call.req.text), ['six seven eight']);
  engine.destroy();
});

await test('at_word 0 actions fire at step start, before narration', () => {
  const { engine, narrator } = setup();
  eq(engine.getState().status, 'idle');
  engine.play();
  const s = engine.getState();
  eq([s.status, s.index, s.word], ['playing', 0, -1]);
  eq(s.camera.key, '0:1', 'camera');
  eq(keys(s), ['0:2'], 'overlays');
  eq(narrator.calls.length, 1, 'speak calls');
  eq(narrator.last.req.words, ['one', 'two', 'three', 'four', 'five']);
});

await test('actions fire when narration reaches at_word; skipped words still fire', () => {
  const { engine, narrator } = setup();
  engine.play();
  narrator.last.cb.onWord(1);
  eq(keys(engine.getState()), ['0:2'], 'before word 2');
  narrator.last.cb.onWord(3); // word 2 was never reported
  eq(keys(engine.getState()), ['0:2', '0:0'], 'after word 3');
  narrator.last.cb.onWord(1); // going backwards is ignored
  eq(engine.getState().word, 3, 'word is monotonic');
});

await test('a narrated example shows input, intermediate and result frames at their spoken words', () => {
  const frame = (title: string, value: number): BoardItem => ({ kind: 'formula', title, latex: `x=${value}`,
    terms: [{ latex: 'x', label: 'Value' }] });
  const example: Tour = { schema: 'paper-tour/tour@0.1', title: 'Example', paper: 'test', chapters: [{ id: 'c', title: 'C', steps: [
    { id: 'example', say: 'Input has minus two then rectify it to zero and return result', hold_ms: 0, actions: [
      { type: 'board', item: frame('Input', -2) },
      { type: 'board_focus', part: 0, at_word: 1 },
      { type: 'board', item: frame('Intermediate', 0), at_word: 4 },
      { type: 'board_focus', part: 0, at_word: 6 },
      { type: 'board', item: frame('Result', 0), at_word: 8 },
      { type: 'board_focus', part: 0, at_word: 8 },
    ] },
    { id: 'next', say: 'The result remains visible while we explain it.', actions: [] },
  ] }] };
  const narrator = new FakeNarrator(), timers = new FakeTimers();
  const engine = new TourEngine(example, { narrator, timers });
  const clock = () => boardPlayback(engine.getState(), engine.steps);
  engine.play();
  eq([engine.getState().board.item?.title, engine.getState().board.focus, clock()],
    ['Input', null, { playing: true, progress: 0 }], 'input precedes speech');
  narrator.last.cb.onWord(1);
  eq([engine.getState().board.focus, clock().progress], [0, 0.5], 'input uses its own four-word interval');
  narrator.last.cb.onWord(4);
  eq([engine.getState().board.item?.title, engine.getState().board.focus], ['Intermediate', null], 'new state clears previous term focus');
  narrator.last.cb.onWord(6);
  eq([engine.getState().board.focus, clock().progress], [0, 0.75], 'intermediate has a separate interval');
  const cancelled = narrator.last;
  engine.pause();
  const frozen = clock();
  timers.tick(10000);
  cancelled.cb.onWord(10);
  cancelled.cb.onEnd();
  eq(clock(), frozen, 'pause and stale callbacks cannot advance an independent animation clock');
  eq(frozen, { playing: false, progress: 0.75 });
  engine.play();
  eq([engine.getState().board.item?.title, engine.getState().board.focus, clock().progress],
    ['Input', null, 0], 'resume restarts the spoken step and visual example together');
  narrator.last.cb.onWord(9);
  eq([engine.getState().board.item?.title, engine.getState().board.focus], ['Result', 0], 'sparse callbacks apply all frames in order and same-word focus follows replacement');
  narrator.last.cb.onEnd();
  timers.tick(0);
  eq([engine.getState().index, engine.getState().board.item?.title, engine.getState().board.focus, clock()],
    [1, 'Result', null, { playing: false, progress: 1 }], 'retained result is complete and no stale focus leaks into the next step');
  engine.pause();
  engine.goTo(0);
  eq([engine.getState().board.item?.title, engine.getState().board.focus, clock()],
    ['Result', 0, { playing: false, progress: 1 }], 'silent backward seek reconstructs the completed example');
  engine.play();
  eq([engine.getState().board.item?.title, engine.getState().board.focus, clock().progress], ['Input', null, 0], 'playing the sought step starts at its input again');
  engine.destroy();
});

await test('plot progress distinguishes pause before speech from a completed silent seek', async () => {
  const plot: BoardItem = { kind: 'plot', x: [-2, 2], y: [0, 2], curves: [{ expression: 'relu(x)', label: 'ReLU' }] };
  const example: Tour = { schema: 'paper-tour/tour@0.1', title: 'Plot', paper: 'test', chapters: [{ id: 'c', title: 'C', steps: [
    { id: 'plot', say: 'Negative inputs map to zero and positive inputs pass through', actions: [{ type: 'board', item: plot }] },
  ] }] };
  let ready!: () => void;
  const narrator = new FakeNarrator();
  const engine = new TourEngine(example, { narrator, beforeNarration: () => new Promise<void>(resolve => { ready = resolve; }) });
  engine.play();
  eq(boardPlayback(engine.getState(), engine.steps), { playing: true, progress: 0 });
  engine.pause();
  eq(boardPlayback(engine.getState(), engine.steps), { playing: false, progress: 0 }, 'pause during camera travel stays at the input');
  ready();
  await Promise.resolve();
  eq(narrator.calls.length, 0, 'cancelled camera wait does not start the animation or speech');
  engine.goTo(0);
  eq(boardPlayback(engine.getState(), engine.steps), { playing: false, progress: 1 }, 'silent navigation displays the completed plot');
  engine.destroy();
});

await test('composed scene states preserve objects and plot bindings across timed focus, pause and seek', () => {
  const frame = (value: number): BoardItem => ({ kind: 'scene', title: 'Illustrative vector scaling', objects: [
    { id: 'coordinates', type: 'matrix', x: .05, y: .2, w: .25, h: .4, values: [[value], [value]] },
    { id: 'plane', type: 'plot', x: .4, y: .1, w: .55, h: .75, background: true,
      plot: { kind: 'plot', x: [-3, 3], y: [-3, 3], curves: [{ expression: 'x', label: 'Direction' }] } },
    { id: 'vector', type: 'vector', x: 0, y: 0, w: value, h: value, plotId: 'plane', color: 'blue' },
  ] });
  const example: Tour = { schema: 'paper-tour/tour@0.1', title: 'Scene', paper: 'test', chapters: [{ id: 'c', title: 'C', steps: [
    { id: 'example', say: 'Start with one then double both coordinates to two', actions: [
      { type: 'board', item: frame(1) },
      { type: 'board_focus', part: 2, at_word: 1 },
      { type: 'board', item: frame(2), at_word: 4 },
      { type: 'board_focus', part: 0, at_word: 6 },
    ] },
  ] }] };
  eq(checkTour(example), [], 'composed scene is accepted by the player contract');
  const narrator = new FakeNarrator(), timers = new FakeTimers();
  const engine = new TourEngine(example, { narrator, timers });
  const current = () => {
    const board = engine.getState().board;
    if (board.item?.kind !== 'scene') throw new Error('Scene board disappeared');
    return [board.item.objects[0].values, board.item.objects[2].w, board.item.objects[2].plotId, board.focus];
  };
  engine.play();
  narrator.last.cb.onWord(1);
  eq(current(), [[[1], [1]], 1, 'plane', 2], 'focus addresses an object, not a matrix cell');
  narrator.last.cb.onWord(4);
  eq(current(), [[[2], [2]], 2, 'plane', null], 'the next authored state changes values and resets focus');
  const pending = narrator.last;
  engine.pause();
  pending.cb.onWord(6);
  timers.tick(1000);
  eq(current(), [[[2], [2]], 2, 'plane', null], 'paused state ignores late narration callbacks');
  eq(boardPlayback(engine.getState(), engine.steps).playing, false);
  engine.goTo(0);
  eq(current(), [[[2], [2]], 2, 'plane', 0], 'silent seek reconstructs the complete scene and final focus');
  eq(boardPlayback(engine.getState(), engine.steps), { playing: false, progress: 1 });
  engine.play();
  eq(current(), [[[1], [1]], 1, 'plane', null], 'replay restores the input state without stale focus');
  engine.destroy();
});

await test('a board scheduled beyond the final word completes when sparse narration ends', () => {
  const example = structuredClone(tour);
  example.chapters[0].steps[0].actions = [{ type: 'board', at_word: 99,
    item: { kind: 'formula', title: 'Late result', latex: 'x=2', terms: [] } }];
  const narrator = new FakeNarrator(), timers = new FakeTimers();
  const engine = new TourEngine(example, { narrator, timers });
  engine.play();
  narrator.last.cb.onEnd();
  eq(boardPlayback(engine.getState(), engine.steps).progress, 1, 'out-of-range legacy timing never produces a negative interval or NaN');
  engine.destroy();
});

await test('at_word past the narration fires at the end; advance after hold_ms', () => {
  const { engine, narrator, timers } = setup();
  engine.play();
  narrator.last.cb.onEnd();
  eq(keys(engine.getState()), ['0:2', '0:0', '0:3'], 'all fired at end');
  eq(engine.getState().word, 4, 'all words spoken');
  timers.tick(299);
  eq(engine.getState().index, 0, 'still holding (default 300 ms)');
  timers.tick(1);
  const s = engine.getState();
  eq(s.index, 1, 'advanced');
  eq(s.overlays.filter((o) => !o.leaving).map((o) => o.key), ['0:2'], 'only persistent overlays stay');
  eq(s.overlays.filter((o) => o.leaving).map((o) => o.key), ['0:0', '0:3'], 'the step\'s marks fade out');
  timers.tick(FADE_MS);
  eq(keys(engine.getState()), ['0:2'], 'non-persistent overlays dropped once faded, persistent kept');
  eq(narrator.calls.length, 2, 'second step spoken');
  eq(narrator.last.req.speaker, 'guest', 'speaker');
  eq(narrator.last.req.voice, { lang: 'en-GB', rate: 1.2 }, 'voice for speaker');
});

await test('persist and clear across steps, then ended', () => {
  const { engine, narrator, timers } = setup();
  engine.play();
  finishStep(narrator, timers);
  narrator.last.cb.onWord(2);
  let s = engine.getState();
  eq(keys(s), ['0:2', '1:0'], 'spotlight persisted');
  eq(s.camera.key, '1:1', 'zoom at word 2');
  finishStep(narrator, timers);
  eq(keys(engine.getState()), ['0:2', '1:0'], 'step c starts with persistent overlays');
  narrator.last.cb.onWord(1);
  eq(keys(engine.getState()), ['2:1'], 'clear removed persistent overlays, then new highlight');
  finishStep(narrator, timers);
  eq(engine.getState().index, 3);
  finishStep(narrator, timers);
  s = engine.getState();
  eq(s.status, 'ended');
  eq(keys(s), ['2:1'], 'visuals kept at the end');
});

await test('seeking while playing rebuilds the same state as playing through', () => {
  // Natural play to the start of step c.
  const a = setup();
  a.engine.play();
  finishStep(a.narrator, a.timers);
  finishStep(a.narrator, a.timers);
  const natural = a.engine.getState();

  const b = setup();
  b.engine.play();
  const first = b.narrator.last;
  b.engine.goTo(2);
  const seeked = b.engine.getState();
  eq(first.cancelled, true, 'previous narration cancelled');
  eq([seeked.status, seeked.index], ['playing', 2]);
  eq(keys(seeked), keys(natural), 'overlays');
  eq(seeked.camera.key, natural.camera.key, 'camera');
  eq(b.narrator.last.req.text, 'nine ten', 'step c spoken');
});

await test('late callbacks from a cancelled narration never advance the tour', () => {
  const { engine, narrator, timers } = setup();
  engine.play();
  const stale = narrator.last;
  engine.goTo(2);
  stale.cb.onWord(4);
  stale.cb.onEnd();
  timers.tick(5000);
  const s = engine.getState();
  eq([s.index, s.word, s.status], [2, -1, 'playing'], 'unaffected by stale callbacks');
  eq(narrator.calls.length, 2, 'no extra speak');
});

await test('pause keeps visuals; resume restarts the step from its beginning', () => {
  const { engine, narrator } = setup();
  engine.play();
  narrator.last.cb.onWord(2);
  const seqBefore = engine.getState().camera.seq;
  const call = narrator.last;
  engine.pause();
  let s = engine.getState();
  eq(call.cancelled, true, 'narration stopped');
  eq([s.status, s.index], ['paused', 0]);
  eq(keys(s), ['0:2', '0:0'], 'visuals kept while paused');
  engine.play();
  s = engine.getState();
  eq(narrator.calls.length, 2, 'spoken again');
  eq(narrator.last.req.text, 'one two three four five', 'same step');
  eq([s.status, s.word], ['playing', -1], 'from the beginning');
  eq(keys(s), ['0:2'], 'step overlays replay as narration progresses');
  eq(s.camera.seq > seqBefore, true, 'camera re-applied');
});

await test('pausing during the hold cancels the advance', () => {
  const { engine, narrator, timers } = setup();
  engine.play();
  narrator.last.cb.onEnd();
  engine.pause();
  timers.tick(5000);
  eq([engine.getState().status, engine.getState().index], ['paused', 0]);
});

await test('navigating while paused shows the full step state without speaking', () => {
  const { engine, narrator } = setup();
  engine.play();
  engine.pause();
  engine.next();
  let s = engine.getState();
  eq([s.status, s.index, s.word], ['paused', 1, -1]);
  eq(keys(s), ['0:2', '1:0'], 'persistent from step a + all of step b');
  eq(s.camera.key, '1:1', 'camera of step b');
  engine.prev();
  s = engine.getState();
  eq(keys(s), ['0:2', '0:0', '0:3'], 'all of step a, including at_word 99');
  eq(s.camera.key, '0:1');
  engine.goTo(3);
  s = engine.getState();
  eq(keys(s), ['2:1'], 'clear in step c applied');
  eq(s.camera.key, '1:1', 'last camera action at or before the step');
  eq(narrator.calls.length, 1, 'nothing spoken while paused');
});

await test('next from idle shows the first step; play from ended restarts', () => {
  const { engine, narrator, timers } = setup();
  engine.prev();
  eq(engine.getState().status, 'idle', 'prev from idle is a no-op');
  engine.next();
  eq([engine.getState().status, engine.getState().index], ['paused', 0]);
  engine.goTo(3);
  engine.play();
  finishStep(narrator, timers);
  eq(engine.getState().status, 'ended');
  engine.play();
  const s = engine.getState();
  eq([s.status, s.index], ['playing', 0]);
  eq(keys(s), ['0:2'], 'state rebuilt from scratch');
});

await test('swapping the narrator restarts the playing step', () => {
  const { engine, narrator } = setup();
  engine.play();
  const call = narrator.last;
  const other = new FakeNarrator();
  engine.setNarrator(other);
  eq(call.cancelled, true, 'old narration cancelled');
  eq(other.calls.length, 1, 'new narrator speaks');
  engine.setRate(1.5);
  other.last.cb.onEnd();
});

await test('a throwing narrator falls back, and without a fallback the tour still moves on', () => {
  const fallback = new FakeNarrator();
  const a = setup(new ThrowingNarrator(), fallback);
  a.engine.play();
  eq(fallback.calls.length, 1, 'fallback used');

  const b = setup(new ThrowingNarrator());
  b.engine.play();
  for (let i = 0; i < 4; i++) b.timers.tick(1000);
  eq(b.engine.getState().status, 'ended', 'never stalls');
});

await test('callbacks from a failed narrator cannot advance its active fallback', () => {
  let abandoned!: SpeakCallbacks;
  const broken: Narrator = { name: 'partial failure', speak(_req, cb) { abandoned = cb; throw new Error('failed after starting'); } };
  const fallback = new FakeNarrator();
  const { engine, timers } = setup(broken, fallback);
  engine.play();
  abandoned.onWord(4);
  abandoned.onEnd();
  timers.tick(1000);
  eq([engine.getState().index, engine.getState().word], [0, -1]);
  fallback.last.cb.onWord(2);
  eq(engine.getState().word, 2);
  engine.destroy();
});

await test('pausing from the first state notification prevents speech from starting', () => {
  const { engine, narrator } = setup();
  engine.subscribe(() => { if (engine.getState().status === 'playing') engine.pause(); });
  engine.play();
  eq(engine.getState().status, 'paused');
  eq(narrator.calls.length, 0);
});

await test('pausing during synchronous narration startup cancels the returned handle', () => {
  let cancelled = false;
  const narrator: Narrator = {
    name: 'synchronous word',
    speak(_req, cb) { cb.onWord(0); return { cancel() { cancelled = true; } }; },
  };
  const { engine } = setup(narrator);
  engine.subscribe(() => { if (engine.getState().word === 0 && engine.getState().status === 'playing') engine.pause(); });
  engine.play();
  eq(engine.getState().status, 'paused');
  eq(cancelled, true);
});

await test('resolver: IDs to rects, regions, unknown IDs', () => {
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'paper.pdf', sha256: '0'.repeat(64), num_pages: 1, generator: 'test' },
    pages: [{ n: 1, width: 600, height: 800 }],
    sections: [{ id: 'sec-1', title: 'Intro', level: 1, page: 1, block: 'p1.b1' }],
    blocks: [
      { id: 'p1.b1', page: 1, type: 'heading', bbox: [100, 50, 300, 60], text: 'Intro', sentences: [] },
      { id: 'p1.b2', page: 1, type: 'paragraph', bbox: [100, 70, 500, 100], text: 'A. B.', sentences: ['p1.s1', 'p1.s2'] },
    ],
    sentences: [
      { id: 'p1.s1', page: 1, block: 'p1.b2', text: 'A.', rects: [[100, 70, 200, 80]] },
      { id: 'p1.s2', page: 1, block: 'p1.b2', text: 'B.', rects: [[202, 70, 500, 80], [100, 90, 300, 100]] },
    ],
    figures: [
      { id: 'fig1', kind: 'figure', number: '1', page: 1, bbox: [100, 200, 500, 400], caption: '', image: 'f.png', panels: [{ id: 'fig1.a', bbox: [100, 200, 300, 400] }], referenced_by: [] },
    ],
    equations: [],
  };
  const r = new Resolver(doc, [{ width: 600, height: 800 }]);
  eq(r.resolve('p1.s2'), [{ page: 1, rects: [[202, 70, 500, 80], [100, 90, 300, 100]] }], 'sentence lines');
  eq(r.resolve('sec-1'), [{ page: 1, rects: [[100, 50, 300, 60]] }], 'section heading');
  eq(r.resolve('p1.b2', { lines: true }), [{ page: 1, rects: [[100, 70, 500, 80], [100, 90, 300, 100]] }], 'block lines merged');
  eq(r.resolve('fig1.a'), [{ page: 1, rects: [[100, 200, 300, 400]] }], 'panel');
  eq(r.resolve('page1'), [{ page: 1, rects: [[0, 0, 600, 800]] }], 'page');
  eq(r.resolveTarget('fig1', [0.5, 0, 1, 0.5]), [{ page: 1, rects: [[300, 200, 500, 300]] }], 'region');
  eq([r.resolve('fig9'), r.resolve('page2')], [null, null], 'unknown');

  const { tour: clean, problems } = prepareTour(
    {
      ...tour,
      chapters: [{ id: 'x', title: 'X', steps: [{ id: 's', say: 'hi', actions: [{ type: 'highlight', targets: ['p1.s1', 'p9.s9'] }, { type: 'box', target: 'fig9' }] }] }],
    },
    r,
  );
  eq(clean.chapters[0].steps[0].actions, [{ type: 'highlight', targets: ['p1.s1'] }], 'unknown targets dropped');
  eq(problems.length, 2, 'problems reported');
  eq(warnings.some((w) => w.includes('"fig9"')), true, 'unknown IDs are console.warned');
});

await test('validators explain broken files', () => {
  eq(checkTour(tour), [], 'valid tour');
  eq(checkTour({ schema: 'x', title: 't', chapters: [{ steps: [{ id: 's', say: '', actions: [{ type: 'wiggle' }] }] }] }), [
    'schema is "x", expected "paper-tour/tour@0.1"',
    'chapters[0].steps[0].say must be a non-empty string',
    'chapters[0].steps[0].actions[0].type "wiggle" is not a known action',
  ]);
  eq(checkDoc({ schema: 'paper-tour/doc@0.1', source: {}, pages: [], sections: [], blocks: [{ id: 'p1.b1' }], sentences: [], figures: [], equations: [] }).length > 0, true, 'doc errors');
});

await test('note markup: bold and code only, everything else is text', () => {
  eq(parseNote('**h = 8** heads, `QK^T` and <b>x</b>'), [
    { kind: 'bold', text: 'h = 8' },
    { kind: 'text', text: ' heads, ' },
    { kind: 'code', text: 'QK^T' },
    { kind: 'text', text: ' and <b>x</b>' },
  ]);
  eq(parseNote('`**not bold**`'), [{ kind: 'code', text: '**not bold**' }], 'no bold inside code');
});

await test('speech chunks keep a global word index', () => {
  const words = `${'word '.repeat(60)}end. Short one. ${'x'.repeat(30)} tail`.split(/\s+/).filter(Boolean);
  const chunks = chunkWords(words);
  let next = 0;
  for (const c of chunks) {
    eq(c.start, next, 'contiguous');
    eq(c.text.split(' ').length, c.count, 'count');
    eq(c.text.length <= 180, true, 'short enough for Chrome');
    next += c.count;
  }
  eq(next, words.length, 'all words covered');
});

await test('silent narrator: words in order, one end, cancel stops it', async () => {
  const silent = new SilentNarrator();
  const words: number[] = [];
  let ends = 0;
  await new Promise<void>((resolve) => {
    silent.speak({ text: 'a b c', words: ['a', 'b', 'c'], speaker: 'host', rate: 8 }, {
      onWord: (i) => words.push(i),
      onEnd: () => {
        ends++;
        resolve();
      },
    });
  });
  eq(words, [0, 1, 2], 'words');
  const seen: number[] = [];
  const h = silent.speak({ text: 'a b c', words: ['a', 'b', 'c'], speaker: 'host', rate: 8 }, { onWord: (i) => seen.push(i), onEnd: () => ends++ });
  await new Promise((r) => setTimeout(r, 10));
  h.cancel();
  await new Promise((r) => setTimeout(r, 200));
  eq([ends, seen.length < 3], [1, true], 'cancelled before the end');
});

await test('removed video boards in saved tours neither open a panel nor block ordinary playback', () => {
  const legacy = structuredClone(tour);
  legacy.chapters[0].steps[0].actions = [{ type: 'board', item: { kind: 'animation', spec: {} } } as unknown as import('../src/types').Action];
  const narrator = new FakeNarrator(), timers = new FakeTimers();
  const engine = new TourEngine(legacy, { narrator, timers });
  engine.play();
  eq(engine.getState().board, { key: null, item: null, focus: null });
  finishStep(narrator, timers);
  eq(engine.getState().index, 1);
  engine.pause();
  engine.goTo(0);
  eq(engine.getState().board, { key: null, item: null, focus: null }, 'seeking also skips obsolete video items');
  engine.destroy();
});

// ------------------------------------------------------- seeking, resuming and the timeline

/** Two chapters; the first step has three sentences, so a pause or a seek can land inside it. */
const spoken: Tour = {
  schema: 'paper-tour/tour@0.1',
  title: 'Seeking',
  paper: 'test',
  chapters: [
    {
      id: 'c1',
      title: 'One',
      steps: [
        {
          id: 'a',
          say: 'First point. Second point is longer than that. Third and last.',
          hold_ms: 100,
          actions: [
            { type: 'focus', target: 'p1.b1' },
            { type: 'highlight', targets: ['p1.s1'], at_word: 0 },
            { type: 'highlight', targets: ['p1.s2'], at_word: 2 },
            { type: 'box', target: 'fig1', at_word: 8 },
            { type: 'zoom', target: 'fig1', at_word: 8 },
          ],
        },
        { id: 'b', say: 'Next step comes right here.', hold_ms: 100, actions: [{ type: 'focus', target: 'p2.b1' }] },
      ],
    },
    {
      id: 'c2',
      title: 'Two',
      steps: [
        { id: 'c', say: 'Chapter two starts. It goes on.', hold_ms: 100, actions: [] },
        { id: 'd', say: 'Last one.', hold_ms: 100, actions: [] },
      ],
    },
  ],
};

function spokenSetup() {
  const narrator = new FakeNarrator(), timers = new FakeTimers();
  return { engine: new TourEngine(spoken, { narrator, timers }), narrator, timers };
}

await test('a camera move carries the marks that appear while it holds', () => {
  const steps = flattenTour(spoken);
  const [first, second] = steps[0].schedule.filter((item) => item.action.type === 'focus' || item.action.type === 'zoom');
  eq(first.also?.map((m) => m.target), ['p1.s1', 'p1.s2'], 'marks until the next camera move');
  eq(second.also?.map((m) => m.target), ['fig1'], 'marks of the later move');
  const { engine, narrator } = spokenSetup();
  engine.play();
  eq(engine.getState().camera.also?.map((m) => m.target), ['p1.s1', 'p1.s2'], 'the command the reader frames');
  narrator.last.cb.onWord(8);
  eq(engine.getState().camera.also?.map((m) => m.target), ['fig1'], 'and at the later move');
});

await test('pause then play goes on from the start of the sentence that was being spoken', () => {
  const { engine, narrator } = spokenSetup();
  engine.play();
  eq(narrator.last.req.startWord, 0, 'a step starts at its first word');
  narrator.last.cb.onWord(4);
  engine.pause();
  engine.play();
  eq(narrator.calls.length, 2, 'spoken again');
  eq(narrator.last.req.startWord, 2, 'from the second sentence');
  const s = engine.getState();
  eq([s.status, s.word], ['playing', 1], 'the first sentence stays spoken');
  eq(keys(s), ['0:1', '0:2'].filter((k) => k !== '0:2'), 'marks of later sentences wait for their words');
  narrator.last.cb.onWord(2);
  eq(keys(engine.getState()), ['0:1', '0:2'], 'and replay as the sentence is spoken again');
});

await test('pausing at the end of a sentence resumes with the next one, nothing repeated', () => {
  const { engine, narrator } = spokenSetup();
  engine.play();
  narrator.last.cb.onWord(1);
  engine.pause();
  engine.play();
  eq(narrator.last.req.startWord, 2, 'the sentence after the one that finished');
});

await test('pausing during the hold and playing again only waits out the hold', () => {
  const { engine, narrator, timers } = spokenSetup();
  engine.play();
  narrator.last.cb.onEnd();
  engine.pause();
  engine.play();
  eq(narrator.calls.length, 1, 'the step is not spoken again');
  timers.tick(100);
  eq([engine.getState().index, engine.getState().status], [1, 'playing']);
});

await test('seeking while playing speaks from the sentence the word is in, on the state a natural run reaches', () => {
  const natural = spokenSetup();
  natural.engine.play();
  natural.narrator.last.cb.onWord(8);
  const naturalState = natural.engine.getState();

  const { engine, narrator } = spokenSetup();
  engine.play();
  const first = narrator.last;
  engine.seekTo(0, 5);
  eq(first.cancelled, true, 'the old narration stops');
  eq(narrator.last.req.startWord, 2, 'snapped back to the start of the second sentence');
  let s = engine.getState();
  eq([s.status, s.index, s.word], ['playing', 0, 1]);
  eq(keys(s), ['0:1'], 'only what was marked before that sentence');
  narrator.last.cb.onWord(8);
  s = engine.getState();
  eq(keys(s), keys(naturalState), 'the rest arrives as in a natural run');
  eq(s.camera.key, naturalState.camera.key, 'camera');
  engine.seekTo(2, 0);
  eq([engine.getState().index, narrator.last.req.text], [2, 'Chapter two starts. It goes on.'], 'into another step');
});

await test('seeking while paused shows the step before that sentence and play speaks from it', () => {
  const { engine, narrator } = spokenSetup();
  engine.seekTo(0, 9);
  let s = engine.getState();
  eq([s.status, s.index, s.word, s.preview], ['paused', 0, 7, false]);
  eq(keys(s), ['0:1', '0:2'], 'marks up to the word before the sentence');
  eq(narrator.calls.length, 0, 'nothing spoken');
  engine.play();
  eq(narrator.last.req.startWord, 8, 'from the third sentence');
  engine.pause();
  engine.seekTo(1, 0);
  s = engine.getState();
  eq([s.index, s.word], [1, -1]);
  engine.play();
  eq(narrator.last.req.startWord, 0, 'a seek to a step start plays the whole step');
});

await test('skip moves by sentence, restarting the current one first, then across steps', () => {
  const { engine, narrator } = spokenSetup();
  engine.play();
  narrator.last.cb.onWord(4);
  engine.skip(1);
  eq([engine.getState().index, narrator.last.req.startWord], [0, 8], 'next sentence');
  engine.skip(1);
  eq([engine.getState().index, narrator.last.req.startWord], [1, 0], 'next step after the last sentence');
  narrator.last.cb.onWord(3);
  engine.skip(-1);
  eq([engine.getState().index, narrator.last.req.startWord], [1, 0], 'a sentence well under way restarts');
  engine.skip(-1);
  eq([engine.getState().index, narrator.last.req.startWord], [0, 8], 'then the last sentence of the step before');
  narrator.last.cb.onWord(10);
  engine.skip(-1);
  eq(narrator.last.req.startWord, 2, 'and back through the sentences');
});

await test('chapter jumps: the next chapter, or this one is restarted before going back', () => {
  const { engine } = spokenSetup();
  eq(engine.chapterStart(1), 2, 'the first step of chapter two');
  engine.goTo(1);
  eq(engine.chapterStart(-1), 0, 'the start of this chapter');
  engine.goTo(2);
  eq(engine.chapterStart(-1), 0, 'at a chapter start, the one before');
  engine.goTo(3);
  eq(engine.chapterStart(-1), 2, 'later in a chapter, its own start');
  eq(engine.chapterStart(1), 3, 'the last chapter has none after it');
});

await test('the marks of a step fade out as the next one starts, and the camera keeps its mark list', () => {
  const { engine, narrator, timers } = spokenSetup();
  engine.play();
  narrator.last.cb.onWord(9);
  narrator.last.cb.onEnd();
  timers.tick(100);
  let s = engine.getState();
  eq(s.index, 1);
  eq(s.overlays.map((o) => [o.key, !!o.leaving]), [['0:1', true], ['0:2', true], ['0:3', true]], 'leaving, not gone');
  engine.pause();
  engine.seekTo(1, 0);
  eq(engine.getState().overlays.length, 0, 'a seek drops them at once');
  engine.play();
  narrator.last.cb.onEnd();
  timers.tick(100 + FADE_MS);
  s = engine.getState();
  eq([s.index, s.overlays.length], [2, 0]);
});

await test('silent narrator starts at the given word', async () => {
  const seen: number[] = [];
  await new Promise<void>((resolve) => {
    new SilentNarrator().speak({ text: 'a b c d', words: ['a', 'b', 'c', 'd'], speaker: 'host', rate: 8, startWord: 2 }, {
      onWord: (i) => seen.push(i),
      onEnd: resolve,
    });
  });
  eq(seen, [2, 3], 'only the words from there');
});

// ------------------------------------------------------------ a tour that is still being written

/** The tour of its first `count` steps, as a partial tour is: the chapters that have none yet are not there. */
function leading(count: number): Tour {
  let left = count;
  return {
    ...tour,
    chapters: tour.chapters
      .map((chapter) => {
        const steps = chapter.steps.slice(0, Math.max(0, left));
        left -= steps.length;
        return { ...chapter, steps };
      })
      .filter((chapter) => chapter.steps.length),
  };
}

function growing(count: number) {
  const timers = new FakeTimers();
  const narrator = new FakeNarrator();
  const engine = new TourEngine(leading(count), { narrator, timers, open: true });
  return { engine, timers, narrator };
}

await test('new steps join a playing tour without touching what plays', () => {
  const { engine, narrator } = growing(2);
  engine.play();
  narrator.last.cb.onWord(2);
  const before = engine.getState();
  const calls = narrator.calls.length;
  eq(engine.extend(leading(4), true), true);
  const after = engine.getState();
  eq([engine.steps.length, engine.tour.chapters.length], [4, 2], 'the new steps are there');
  eq([after.status, after.index, after.word], [before.status, before.index, before.word], 'the place');
  eq(keys(after), keys(before), 'the marks');
  eq(after.camera, before.camera, 'the camera');
  eq(after.board, before.board, 'the board');
  eq(narrator.calls.length, calls, 'the voice is not started again');
  eq(after.revision, (before.revision ?? 0) + 1, 'it says that the tour grew');
  eq(engine.steps[3].chapterIndex, 1);
});

await test('a tour that played everything written waits for the next step, and goes on when it comes', () => {
  const { engine, timers, narrator } = growing(2);
  engine.play();
  finishStep(narrator, timers);
  finishStep(narrator, timers);
  let s = engine.getState();
  eq([s.status, s.index, s.waiting], ['playing', 1, true], 'waiting, not ended');
  const marks = keys(s);
  timers.tick(5000);
  s = engine.getState();
  eq([s.status, s.waiting, keys(s)], ['playing', true, marks], 'it keeps waiting, the marks stay');
  engine.extend(leading(3), true);
  s = engine.getState();
  eq([s.status, s.index, s.waiting], ['playing', 2, false], 'the next step plays');
  eq(narrator.last.req.text, 'nine ten');
  // Waiting once more at the new last step.
  finishStep(narrator, timers);
  eq(engine.getState().waiting, true);
});

await test('closing a tour that waits ends it; a tour that is not open ends after its last step', () => {
  const { engine, timers, narrator } = growing(2);
  engine.play();
  finishStep(narrator, timers);
  finishStep(narrator, timers);
  eq(engine.getState().waiting, true);
  engine.close();
  let s = engine.getState();
  eq([s.status, s.waiting], ['ended', false]);
  const finished = new TourEngine(leading(2), { narrator: new FakeNarrator(), timers: new FakeTimers() });
  eq(finished.getState().waiting, false);
  const t = new FakeTimers();
  const n = new FakeNarrator();
  const plain = new TourEngine(leading(2), { narrator: n, timers: t });
  plain.play();
  finishStep(n, t);
  finishStep(n, t);
  s = plain.getState();
  eq([s.status, s.waiting], ['ended', false]);
});

await test('pausing while it waits is a pause: nothing is skipped when the step arrives or the learner plays', () => {
  const { engine, timers, narrator } = growing(2);
  engine.play();
  finishStep(narrator, timers);
  finishStep(narrator, timers);
  engine.pause();
  let s = engine.getState();
  eq([s.status, s.waiting], ['paused', false]);
  engine.extend(leading(3), true);
  eq(engine.getState().status, 'paused', 'the new step does not start by itself');
  engine.play();
  timers.tick(1000);
  s = engine.getState();
  eq([s.status, s.index], ['playing', 2], 'play goes on to the new step');
});

await test('going elsewhere while it waits leaves the wait', () => {
  const { engine, timers, narrator } = growing(2);
  engine.play();
  finishStep(narrator, timers);
  finishStep(narrator, timers);
  engine.goTo(0);
  const s = engine.getState();
  eq([s.status, s.index, s.waiting], ['playing', 0, false]);
});

await test('steps that are not the ones held are refused, and nothing changes', () => {
  const { engine } = growing(2);
  engine.play();
  const other = leading(3);
  other.chapters[0].steps[1] = { ...other.chapters[0].steps[1], id: 'renamed' };
  const before = engine.getState();
  eq(engine.extend(other, true), false);
  eq([engine.steps.length, engine.getState()], [2, before], 'untouched');
  const moved = leading(3);
  moved.chapters = [{ ...moved.chapters[0], steps: moved.chapters[0].steps.slice(0, 1) }, { id: 'c1b', title: 'Rest', steps: [moved.chapters[0].steps[1], ...moved.chapters[1].steps] }];
  eq(engine.extend(moved, true), false, 'a step in another chapter');
});

await test('a version that is not longer (the tour written again, still catching up) keeps what is held', () => {
  const { engine } = growing(3);
  engine.play();
  eq(engine.extend(leading(2), true), true);
  eq([engine.steps.length, engine.tour.chapters.flatMap((c) => c.steps).length], [3, 3]);
  engine.extend(leading(2), false);
  eq(engine.getState().revision, 2);
});

await test('steps already shown stay as shown; the ones after them come from the new version', () => {
  const { engine } = growing(3);
  engine.play();
  engine.next();
  const finished = structuredClone(leading(4));
  finished.chapters[0].steps[0].say = 'rewritten before';
  finished.chapters[0].steps[1].say = 'rewritten now';
  finished.chapters[1].steps[0].say = 'rewritten after';
  engine.extend(finished, false);
  eq(engine.steps.map((fs) => fs.step.say), ['one two three four five', 'six seven eight', 'rewritten after', 'eleven']);
  eq(engine.tour.chapters.flatMap((c) => c.steps).map((st) => st.say)[2], 'rewritten after');
});

await test('before the first play the whole version is replaced', () => {
  const { engine } = growing(2);
  const finished = structuredClone(leading(4));
  finished.chapters[0].steps[0].say = 'a new first step';
  engine.extend(finished, false);
  eq(engine.steps[0].words.length, 4);
  eq(engine.getState().status, 'idle');
});

await test('a tour that ended goes on from its old end when more arrives', () => {
  const { engine, timers, narrator } = growing(2);
  engine.play();
  finishStep(narrator, timers);
  finishStep(narrator, timers);
  engine.close();
  eq(engine.getState().status, 'ended');
  engine.extend(leading(3), true);
  let s = engine.getState();
  eq([s.status, s.index], ['paused', 1], 'paused on the old last step');
  engine.play();
  timers.tick(1000);
  s = engine.getState();
  eq([s.status, s.index], ['playing', 2]);
  eq(narrator.last.req.text, 'nine ten');
});

await test('a checkpoint at the last step written waits for the learner, then for the next step', () => {
  const checked = structuredClone(leading(2));
  checked.chapters[0].steps[1].checkpoint = { prompt: 'Try it', solution_step: 'c' } as never;
  const timers = new FakeTimers();
  const narrator = new FakeNarrator();
  const engine = new TourEngine(checked, { narrator, timers, open: true });
  engine.play();
  finishStep(narrator, timers);
  narrator.last.cb.onEnd();
  eq([engine.getState().awaiting, engine.getState().waiting], [true, false], 'the learner is asked first');
  engine.reveal();
  eq(engine.getState().waiting, true, 'then it waits for the step that follows');
});

await test('the board kinds the player draws include the timeline and the distribution; an unknown kind is skipped', () => {
  for (const kind of ['formula', 'flow', 'bars', 'plot', 'scene', 'heatmap', 'scatter', 'shapes', 'timeline', 'distribution'])
    eq(BOARD_KINDS.includes(kind), true, kind);
  const timeline = {
    kind: 'timeline',
    unit: 'step',
    source: 'illustrative',
    events: [
      { label: 'One', at: 1, position: 1 },
      { label: 'Two', at: 2, position: 2 },
    ],
  } as BoardItem;
  const shown = boardAfter(EMPTY_BOARD, { type: 'board', item: timeline }, '0:1', true);
  eq([shown.key, shown.item?.kind, shown.focus], ['0:1', 'timeline', null]);
  eq(boardAfter(shown, { type: 'board_focus', part: 2 }, '0:2', true).focus, 2, 'a focus on a span or the region is just an index');
  eq(boardAfter(EMPTY_BOARD, { type: 'board', item: { kind: 'video' } as unknown as BoardItem }, '0:1', true), EMPTY_BOARD);
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} engine tests passed`);
