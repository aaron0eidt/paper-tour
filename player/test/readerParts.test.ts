// The reader's smaller parts: which key does what, which mark the voice is on, the tour's timeline and its sentences.
// Bundled for Node with esbuild like the other player tests (no test framework).

import { flattenTour } from '../src/engine';
import type { EngineState } from '../src/engine';
import { keyBelongsTo, keyCommand } from '../src/keys';
import type { KeyTarget } from '../src/keys';
import { markPlayback } from '../src/marks';
import { sentenceStart, sentenceStarts } from '../src/narration/narrator';
import { buildClock, formatTime, timeAt, wordAt } from '../src/tourClock';
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

const tour: Tour = {
  schema: 'paper-tour/tour@0.1',
  title: 'Parts',
  paper: 'test',
  chapters: [
    {
      id: 'c1',
      title: 'One',
      steps: [
        {
          id: 'a',
          say: 'First point. Second point is longer than that. Third and last.',
          hold_ms: 1000,
          actions: [
            { type: 'focus', target: 'p1.b1' },
            { type: 'highlight', targets: ['p1.s1'], at_word: 0 },
            { type: 'highlight', targets: ['p1.s2'], at_word: 2 },
            { type: 'board_focus', part: 'x', at_word: 5 } as never,
            { type: 'box', target: 'fig1', at_word: 8 },
            { type: 'zoom', target: 'fig1', at_word: 8 },
          ],
        },
        { id: 'b', say: 'Next step comes right here.', hold_ms: 500, actions: [{ type: 'focus', target: 'p2.b1' }] },
      ],
    },
    {
      id: 'c2',
      title: 'Two',
      steps: [{ id: 'c', say: 'Chapter two starts. It goes on.', hold_ms: 500, actions: [], audio: { src: 'c.mp3', duration_ms: 4000 } }],
    },
  ],
};
const steps = flattenTour(tour);

function state(over: Partial<EngineState>): EngineState {
  return { status: 'playing', index: 0, word: -1, overlays: [], camera: { seq: 0, key: null, action: null }, board: { item: null, focus: null } as never, preview: false, ...over };
}

// ------------------------------------------------------------------------------------------------ keys

/** A stand-in for an element: `closest` says whether it or an ancestor matches one of the selector's tags. */
function el(tag: string, extra: Partial<KeyTarget> = {}): KeyTarget {
  return { closest: (selector: string) => (selector.split(',').map((part) => part.trim()).includes(tag) ? {} : null), ...extra };
}

test('keys: the reader\'s shortcuts', () => {
  eq(keyCommand(' '), 'toggle');
  eq(keyCommand('k'), 'toggle');
  eq(keyCommand('ArrowRight'), 'next');
  eq(keyCommand('ArrowRight', true), 'nextSentence');
  eq(keyCommand('ArrowLeft', true), 'prevSentence');
  eq(keyCommand(']'), 'nextChapter');
  eq(keyCommand('['), 'prevChapter');
  eq(keyCommand('Home'), 'first');
  eq(keyCommand('End'), 'last');
  eq(keyCommand('R'), 'replay');
  eq(keyCommand('m'), 'mute');
  eq(keyCommand('?'), 'help');
  eq(keyCommand('x'), null);
  eq(keyCommand('Enter'), null);
});

test('keys: typing keeps its keys, and a button keeps only Space and Enter', () => {
  for (const tag of ['input', 'textarea', 'select']) eq(keyBelongsTo(el(tag), 'ArrowRight'), true, tag);
  eq(keyBelongsTo({ isContentEditable: true, closest: () => null }, 'r'), true, 'an editable element');
  eq(keyBelongsTo(el('button'), 'ArrowRight'), false, 'the arrows still steer the tour after a click on Play');
  eq(keyBelongsTo(el('button'), 'r'), false, 'letters too');
  eq(keyBelongsTo(el('button'), ' '), true, 'Space presses the button');
  eq(keyBelongsTo(el('button'), 'Enter'), true, 'Enter too');
  eq(keyBelongsTo(el('a'), 'Enter'), true, 'a link');
  eq(keyBelongsTo(el('summary'), ' '), true, 'a summary');
  eq(keyBelongsTo(el('div'), ' '), false, 'the page body');
  eq(keyBelongsTo(null, ' '), false, 'nothing focused');
  eq(keyBelongsTo({}, ' '), false, 'the document itself');
});

// ------------------------------------------------------------------------------------------------ marks

test('marks: the mark the voice is on, and the sweep along it', () => {
  const [a] = steps;
  const key = (at: number) => a.schedule.filter((item) => item.at === at && item.action.type !== 'zoom' && item.action.type !== 'focus').map((item) => item.key);
  eq(markPlayback(state({ status: 'idle' }), steps), { current: null, sweep: 1 }, 'before the tour starts');
  eq(markPlayback(state({ preview: true }), steps), { current: null, sweep: 1 }, 'a silent preview shows every mark alike');
  eq(markPlayback(state({ index: 9 }), steps), { current: null, sweep: 1 }, 'no such step');
  // The first highlight is at word 0 and runs until the next one, at word 2.
  eq(markPlayback(state({ word: 0 }), steps), { current: key(0), sweep: 0.5 }, 'half way through the first sentence');
  eq(markPlayback(state({ word: 1 }), steps), { current: key(0), sweep: 1 }, 'its last word');
  eq(markPlayback(state({ word: 2 }), steps).current, key(2), 'the next mark takes over');
  eq(markPlayback(state({ word: 2 }), steps).sweep, 1 / 6, 'and its sweep starts again');
  // A mark at word 8 is the last: it holds to the end of the step (11 words).
  const last = markPlayback(state({ word: 9 }), steps);
  eq(last.current, key(8), 'the box');
  eq(last.sweep, 2 / 3, 'two of three words');
  eq(markPlayback(state({ status: 'ended', word: 10 }), steps), { current: key(8), sweep: 1 }, 'the step is done: the last mark stays bright');
  eq(markPlayback(state({ index: 1, word: 0 }), steps), { current: null, sweep: 1 }, 'a step with no marks');
});

// --------------------------------------------------------------------------------------------- sentences

test('sentences: where each one starts, and the start of the one a word is in', () => {
  const words = steps[0].words;
  eq(sentenceStarts(words), [0, 2, 8]);
  eq(sentenceStarts([]), []);
  eq(sentenceStart(words, 0), 0);
  eq(sentenceStart(words, 1), 0);
  eq(sentenceStart(words, 2), 2);
  eq(sentenceStart(words, 7), 2);
  eq(sentenceStart(words, 99), 8, 'past the end is the last sentence');
  eq(sentenceStart(words, -3), 0);
  eq(sentenceStarts(['He', 'said', '"Stop."', 'Then', 'left.']), [0, 3], 'a quote after the full stop');
  eq(sentenceStarts(['Is', 'it?', 'Yes!', 'Really.']), [0, 2, 3]);
});

// ---------------------------------------------------------------------------------------------- timeline

test('timeline: step lengths come from the words, or from the audio when there is some', () => {
  const clock = buildClock(steps);
  const ms = 60000 / 165;
  eq(clock.steps[0].speech, 11 * ms);
  eq(clock.steps[0].length, 11 * ms + 1000);
  eq(clock.steps[1].start, clock.steps[0].length);
  eq(clock.steps[2].speech, 4000, 'measured from the audio');
  eq(clock.total, clock.steps.reduce((sum, step) => sum + step.length, 0));
  eq(clock.measured, false, 'one step is only estimated');
  const faster = buildClock(steps, { rate: 2 });
  eq(faster.steps[0].speech, (11 * ms) / 2, 'speed shortens the narration');
  eq(faster.steps[2].speech, 2000, 'and the audio');
  eq(faster.steps[0].length - faster.steps[0].speech, 1000, 'but not the hold');
  eq(buildClock([]).total, 0);
  eq(buildClock([]).measured, false);
});

test('timeline: chapters are runs of steps, and a time maps to the word spoken then', () => {
  const clock = buildClock(steps);
  eq(clock.chapters.map((c) => [c.index, c.step]), [[0, 0], [1, 2]]);
  eq(clock.chapters[0].length, clock.steps[0].length + clock.steps[1].length);
  eq(clock.chapters[0].start + clock.chapters[0].length, clock.chapters[1].start, 'chapters meet');
  const counts = steps.map((fs) => fs.words.length);
  eq(wordAt(clock, 0, counts), { index: 0, word: 0 });
  eq(wordAt(clock, clock.steps[1].start, counts), { index: 1, word: 0 }, 'the start of a step');
  eq(wordAt(clock, clock.total, counts).index, 2, 'the end is the last step');
  eq(wordAt(clock, -50, counts), { index: 0, word: 0 }, 'before the start');
  eq(wordAt(clock, clock.steps[0].start + clock.steps[0].speech + 300, counts), { index: 0, word: 10 }, 'the hold shows the last word');
  // A time inside the narration maps back to about the same time: word positions are whole words.
  const wordMs = clock.steps[0].speech / 11;
  for (const word of [0, 3, 7, 10]) {
    const at = timeAt(clock, 0, word, 11);
    eq(wordAt(clock, at - wordMs / 2, counts).word, word, `word ${word} round-trips`);
  }
  eq(timeAt(clock, 0, -1, 11), 0, 'before the first word');
  eq(timeAt(clock, 1, 4, 5), clock.steps[1].start + clock.steps[1].speech, 'the last word ends the speech');
});

test('timeline: times read as minutes and seconds', () => {
  eq(formatTime(0), '0:00');
  eq(formatTime(7400), '0:07');
  eq(formatTime(61_000), '1:01');
  eq(formatTime(3_725_000), '1:02:05');
  eq(formatTime(-5), '0:00');
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} reader part tests passed`);
