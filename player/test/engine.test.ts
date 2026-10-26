// Engine tests with a fake narrator and fake timers. Run with `npm test` (esbuild bundles this
// file for Node, no test framework needed).

import { TourEngine, flattenTour } from '../src/engine';
import type { EngineState, Timers } from '../src/engine';
import type { NarrationHandle, Narrator, SpeakCallbacks, SpeakRequest } from '../src/narration/narrator';
import { SilentNarrator } from '../src/narration/silent';
import { chunkWords } from '../src/narration/webSpeech';
import { parseNote } from '../src/markup';
import { Resolver, prepareTour } from '../src/resolve';
import { checkDoc, checkTour } from '../src/validate';
import type { Doc, Tour } from '../src/types';

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
  eq(keys(s), ['0:2'], 'non-persistent overlays dropped, persistent kept');
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

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} engine tests passed`);
