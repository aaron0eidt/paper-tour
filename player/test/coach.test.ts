// Coach checkpoints: the rules for a step that asks the learner to try first, and the engine's pause after it. Bundled for
// Node with esbuild like the other player tests (no test framework), with a fake narrator and fake timers.

import { MAX_HINTS, hintLabel, moreHints, normalizeCheckpoint } from '../src/coach';
import { FADE_MS, TourEngine, flattenTour } from '../src/engine';
import type { EngineState, Timers } from '../src/engine';
import type { NarrationHandle, Narrator, SpeakCallbacks, SpeakRequest } from '../src/narration/narrator';
import type { Tour } from '../src/types';

const results: string[] = [];
let failures = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push(`  ok    ${name}`);
  } catch (error) {
    failures++;
    results.push(`  FAIL  ${name}\n        ${(error as Error).message}`);
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
    return { cancel: () => void (call.cancelled = true) };
  }
  get last() {
    return this.calls[this.calls.length - 1];
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
  get pending() {
    return this.queue.length;
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

// ------------------------------------------------------------------------------------------------ the rules

test('a checkpoint needs a prompt; hints are trimmed, cleaned and kept to three', () => {
  eq(normalizeCheckpoint(undefined), null, 'none');
  eq(normalizeCheckpoint('try it'), null, 'not an object');
  eq(normalizeCheckpoint({ prompt: '   ', hints: ['a'] }), null, 'blank prompt');
  eq(normalizeCheckpoint({ hints: ['a'] }), null, 'no prompt');
  eq(normalizeCheckpoint({ prompt: ' Solve it. ', hints: [' one ', '', 7, 'two', 'three', 'four'] }), { prompt: 'Solve it.', hints: ['one', 'two', 'three'] }, 'cleaned');
  eq(normalizeCheckpoint({ prompt: 'Solve it.' }), { prompt: 'Solve it.', hints: [] }, 'hints are optional');
  eq(MAX_HINTS, 3);
});

test('hints come one at a time, up to the number there are', () => {
  eq([0, 1, 2, 3].map((n) => moreHints(n, 3)), [1, 2, 3, 3], 'one more, never past the end');
  eq(moreHints(0, 0), 0, 'no hints');
  eq(moreHints(-2, 2), 1, 'a negative count starts over');
  eq([0, 1, 2, 3].map((n) => hintLabel(n, 3)), ['Hint (1 of 3)', 'Another hint (2 of 3)', 'Another hint (3 of 3)', null], 'labels');
  eq(hintLabel(0, 1), 'Hint', 'a single hint is just "Hint"');
  eq(hintLabel(0, 0), null, 'no hints, no button');
});

// ------------------------------------------------------------------------------------------------ the engine

const tour: Tour = {
  schema: 'paper-tour/tour@0.1',
  title: 'Coach',
  paper: 'test',
  chapters: [
    {
      id: 'c1',
      title: 'One',
      steps: [
        { id: 'intro', say: 'First we set it up.', hold_ms: 100, actions: [{ type: 'focus', target: 'p1.b1' }] },
        {
          id: 'ask',
          say: 'Now you try it. Take your time.',
          hold_ms: 100,
          actions: [{ type: 'highlight', targets: ['p1.s1'], at_word: 1 }, { type: 'highlight', targets: ['p1.s2'], persist: true, at_word: 99 }],
          checkpoint: { prompt: 'Find the value.', hints: ['Nudge.', 'Method.'] },
        },
        { id: 'answer', say: 'The answer is twelve.', hold_ms: 100, actions: [{ type: 'highlight', targets: ['p1.s3'], at_word: 0 }] },
      ],
    },
    {
      id: 'c2',
      title: 'Two',
      steps: [
        // No usable prompt: not a checkpoint.
        { id: 'plain', say: 'Just listen.', hold_ms: 100, actions: [], checkpoint: { prompt: ' ', hints: ['x'] } },
        { id: 'last', say: 'And one last try.', hold_ms: 100, actions: [], checkpoint: { prompt: 'Last one.', hints: [] } },
      ],
    },
  ],
};

function setup() {
  const narrator = new FakeNarrator();
  const timers = new FakeTimers();
  const engine = new TourEngine(tour, { narrator, timers });
  return { engine, narrator, timers };
}

const status = (engine: TourEngine): EngineState => engine.getState();
const finish = (n: FakeNarrator) => n.last.cb.onEnd();

test('flattening keeps the checkpoints a step really has', () => {
  const steps = flattenTour(tour);
  eq(steps.map((s) => s.checkpoint?.prompt ?? null), [null, 'Find the value.', null, null, 'Last one.']);
  eq(steps[1].checkpoint?.hints, ['Nudge.', 'Method.']);
});

test('a tour without checkpoints is unchanged: the hold ends each step and the next one plays', () => {
  const plain: Tour = { ...tour, chapters: [{ id: 'c', title: 'C', steps: [{ id: 'a', say: 'One.', hold_ms: 50, actions: [] }, { id: 'b', say: 'Two.', hold_ms: 50, actions: [] }] }] };
  const narrator = new FakeNarrator();
  const timers = new FakeTimers();
  const engine = new TourEngine(plain, { narrator, timers });
  engine.play();
  finish(narrator);
  eq(status(engine).awaiting, false, 'never waits');
  timers.tick(50);
  eq([status(engine).status, status(engine).index], ['playing', 1]);
});

test('after the narration of a checkpoint the tour waits: paused, no hold timer, nothing advances', () => {
  const { engine, narrator, timers } = setup();
  engine.play();
  finish(narrator);
  timers.tick(100);
  eq(status(engine).index, 1, 'on the checkpoint step');
  finish(narrator);
  timers.tick(60_000);
  const s = status(engine);
  eq([s.status, s.index, s.awaiting], ['paused', 1, true], 'waiting for the learner');
  eq(timers.pending, 0, 'no timer would move it on');
  eq(narrator.calls.length, 2, 'the answer has not been spoken');
});

test('the step marks stay up while the learner tries, including those past the last word', () => {
  const { engine, narrator, timers } = setup();
  engine.play();
  finish(narrator);
  timers.tick(100);
  finish(narrator);
  eq(status(engine).overlays.map((o) => o.key), ['1:0', '1:1'], 'both highlights shown');
  timers.tick(10_000);
  eq(status(engine).overlays.length, 2, 'and they stay');
});

test('play at a checkpoint shows the answer: the next step starts speaking at once', () => {
  const { engine, narrator, timers } = setup();
  engine.play();
  finish(narrator);
  timers.tick(100);
  finish(narrator);
  engine.play();
  const s = status(engine);
  eq([s.status, s.index, s.awaiting], ['playing', 2, false]);
  eq(narrator.last.req.text, 'The answer is twelve.');
  timers.tick(FADE_MS);
  eq(status(engine).overlays.map((o) => o.key), ['1:1', '2:0'], 'the step marks fade; its persistent mark stays');
});

test('reveal() does the same, and only while waiting', () => {
  const { engine, narrator, timers } = setup();
  engine.play();
  engine.reveal();
  eq(status(engine).index, 0, 'ignored while playing');
  finish(narrator);
  timers.tick(100);
  engine.reveal();
  eq(status(engine).index, 1, 'ignored in the middle of a step');
  finish(narrator);
  engine.reveal();
  eq([status(engine).status, status(engine).index], ['playing', 2]);
  engine.reveal();
  eq(status(engine).index, 2, 'and not again');
});

test('pause during the narration of a checkpoint resumes it, and the wait follows the narration', () => {
  const { engine, narrator, timers } = setup();
  engine.play();
  finish(narrator);
  timers.tick(100);
  engine.pause();
  eq(status(engine).awaiting, false, 'paused mid-narration is not waiting');
  engine.play();
  eq(status(engine).status, 'playing');
  finish(narrator);
  eq(status(engine).awaiting, true, 'waits once it has finished speaking');
});

test('seeking or jumping away from a checkpoint ends the wait; seeking back to it plays through to the wait again', () => {
  const { engine, narrator, timers } = setup();
  engine.play();
  finish(narrator);
  timers.tick(100);
  finish(narrator);
  eq(status(engine).awaiting, true);
  engine.goTo(0);
  eq([status(engine).awaiting, status(engine).index, status(engine).status], [false, 0, 'paused'], 'a jump shows another step silently');
  engine.goTo(1);
  eq(status(engine).awaiting, false, 'showing the step silently is not waiting');
  engine.play();
  eq(status(engine).status, 'playing');
  finish(narrator);
  eq([status(engine).awaiting, status(engine).status], [true, 'paused'], 'played to its end, it waits');
  engine.seekTo(1, 0);
  eq(status(engine).awaiting, false, 'a seek leaves the wait');
});

test('next and the sentence keys leave a checkpoint like any step; the card is gone with it', () => {
  const { engine, narrator, timers } = setup();
  engine.play();
  finish(narrator);
  timers.tick(100);
  finish(narrator);
  engine.next();
  eq([status(engine).index, status(engine).awaiting, status(engine).status], [2, false, 'paused']);
});

test('a checkpoint on the last step waits too, and play there ends the tour', () => {
  const { engine, narrator, timers } = setup();
  engine.goTo(4);
  engine.play();
  finish(narrator);
  eq([status(engine).index, status(engine).awaiting, status(engine).status], [4, true, 'paused']);
  engine.play();
  eq([status(engine).status, status(engine).awaiting], ['ended', false]);
  engine.play();
  eq([status(engine).status, status(engine).index], ['playing', 0], 'play after the end starts over');
  timers.tick(0);
});

test('a step whose checkpoint has no prompt plays on like any other', () => {
  const { engine, narrator, timers } = setup();
  engine.goTo(3);
  engine.play();
  finish(narrator);
  eq(status(engine).awaiting, false);
  timers.tick(100);
  eq(status(engine).index, 4, 'the hold moved it on');
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} coach tests passed`);
