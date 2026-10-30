import test from 'node:test';
import assert from 'node:assert/strict';
import type { GenerationEvent } from '../../shared/activity';
import {
  LOSS_CAUSES,
  coverageNote,
  lossDetail,
  lossSentence,
  lossesFromEvents,
  type LeftOut,
} from '../../shared/coverage';
import { generationProgress } from '../../shared/generationProgress';
import { leftOutOf, type StepOutcome } from '../src/harness/degrade';

// What a tour left out and why, in the words a learner reads (shared/coverage.ts), and the record the writer builds it from.

const item = (part: LeftOut['part'], cause: LeftOut['cause'], step = 'a', because?: 'example'): LeftOut => ({
  step,
  part,
  cause,
  ...(because ? { because } : {}),
});

test('every cause has its own plain words, and none of them blames the wrong thing', () => {
  const said = LOSS_CAUSES.map((cause) => lossSentence(item('board', cause)));
  assert.deepEqual(said, [
    'Its visual took too long to write, so it was left out.',
    'Its visual did not pass the checks, so it was left out.',
    'Its visual came back unusable, so it was left out.',
    'Its visual would have repeated earlier content, so it was left out.',
    'Its visual could not be written because the model was not available, so it was left out.',
  ]);
  assert.equal(new Set(said).size, LOSS_CAUSES.length);
});

test('each part says what became of it', () => {
  assert.equal(lossSentence(item('step', 'slow')), 'This step took too long to write, so it was left out.');
  assert.equal(
    lossSentence(item('narration', 'invalid')),
    'Its explanation came back unusable, so a short summary stands in.',
  );
  assert.equal(
    lossSentence(item('example', 'checks')),
    'Its worked example did not pass the checks, so it was left out.',
  );
  assert.equal(lossSentence(item('marks', 'checks')), 'Some pen marks did not pass the checks, so they were left out.');
  assert.equal(
    lossSentence(item('step', 'slow', 'a', 'example')),
    'Its worked example took too long to write, so the step was left out.',
  );
  assert.equal(
    lossDetail([item('board', 'slow'), item('board', 'checks'), item('example', 'slow')]),
    'Its visual took too long to write, so it was left out. Its worked example took too long to write, so it was left out.',
    'a part is said once',
  );
});

test('the note a learner reads is brief and says what was left out and why', () => {
  assert.equal(coverageNote([]), null);
  assert.equal(
    coverageNote([item('step', 'slow', 'a', 'example')]),
    '1 planned step left out: its worked example took too long to write',
  );
  assert.equal(
    coverageNote([item('step', 'repeats')]),
    '1 planned step left out: it would have repeated earlier content',
  );
  assert.equal(coverageNote([item('example', 'slow')]), '1 worked example left out: it took too long to write');
  assert.equal(coverageNote([item('narration', 'invalid')]), '1 step explained only briefly: it came back unusable');
  assert.equal(
    coverageNote([item('board', 'checks', 'a'), item('board', 'checks', 'b')]),
    '2 visuals left out: they did not pass the checks',
  );
  assert.equal(
    coverageNote([item('board', 'checks', 'a'), item('board', 'slow', 'b'), item('board', 'slow', 'c')]),
    '3 visuals left out: 1 did not pass the checks, 2 took too long to write',
  );
  assert.equal(
    coverageNote([item('board', 'slow', 'b'), item('step', 'slow', 'a')]),
    '1 planned step left out: it took too long to write; 1 visual left out: it took too long to write',
    'steps first, whatever the order they were lost in',
  );
});

test('pen marks are recorded but not counted: the step and what it says stay', () => {
  assert.equal(coverageNote([item('marks', 'checks')]), null);
  assert.equal(
    coverageNote([item('marks', 'checks', 'a'), item('example', 'checks', 'b')]),
    '1 worked example left out: it did not pass the checks',
  );
});

// ---------------------------------------------------------------------------------------- the record the writer builds

const outcome = (over: Partial<StepOutcome> = {}): StepOutcome => ({
  beat: 'a',
  present: true,
  fallback: false,
  ...over,
});

test('the record has what each step lost with the cause the writer found, in tour order, and a part only once', () => {
  assert.deepEqual(
    leftOutOf([
      outcome({ beat: 'a' }),
      outcome({
        beat: 'b',
        present: false,
        fallback: true,
        omission: { code: 'slow', because: 'example' },
      }),
      outcome({ beat: 'c', fallback: true, omission: { code: 'invalid' } }),
      outcome({
        beat: 'd',
        degraded: {
          dropped: ['board', 'example', 'marks'],
          problems: [],
          causes: { example: 'slow', board: 'checks', marks: 'checks' },
        },
        late: true,
        repeated: true,
      }),
      outcome({ beat: 'e', degraded: { dropped: ['marks'], problems: ['x'] } }),
      outcome({ beat: 'f', repeated: true }),
      outcome({ beat: 'g', late: true }),
      // A worked example the plan never asked for has no cause among the others: it is not told of.
      outcome({ beat: 'h', degraded: { dropped: ['example'], problems: ['x'], causes: {} } }),
    ]),
    [
      item('step', 'slow', 'b', 'example'),
      item('narration', 'invalid', 'c'),
      item('board', 'checks', 'd'),
      item('example', 'slow', 'd'),
      item('marks', 'checks', 'd'),
      item('marks', 'checks', 'e'),
      item('board', 'repeats', 'f'),
      item('board', 'checks', 'g'),
    ],
  );
});

test('a step that is not there has its own cause, whether it was a detail or a stand-in that only read the source aloud', () => {
  assert.deepEqual(
    leftOutOf([
      outcome({ beat: 'a', present: false, fallback: true }),
      outcome({ beat: 'b', present: false, fallback: true, omission: { code: 'slow' } }),
      outcome({ beat: 'c', present: false, fallback: true, omission: { code: 'repeats' } }),
    ]),
    [item('step', 'invalid', 'a'), item('step', 'slow', 'b'), item('step', 'repeats', 'c')],
    'never a cause that was not recorded: no record is called unusable',
  );
});

test('the record never holds more than the schema allows, and pen marks, which the learner is not told of, go first', () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    outcome({
      beat: `s${i}`,
      degraded: { dropped: ['marks', 'board'], problems: [], causes: { board: 'checks', marks: 'checks' } },
    }),
  );
  const out = leftOutOf(many);
  assert.equal(out.length, 40);
  assert.ok(
    out.every((entry) => entry.part === 'board'),
    'over the limit the marks are gone, the boards stay',
  );
  assert.equal(leftOutOf(many.slice(0, 20)).length, 40, 'under it nothing is dropped');
  assert.equal(
    leftOutOf(
      Array.from({ length: 70 }, (_, i) => outcome({ beat: `s${i}`, present: false, omission: { code: 'slow' } })),
    ).length,
    60,
  );
});

// ---------------------------------------------------------------------------------------- what the events say

const e = (id: string, type: string, data: Record<string, unknown> = {}): GenerationEvent => ({
  id,
  type,
  data,
  at: '2026-10-30T10:00:00Z',
});

test('the events carry the same record, and an event from before causes were kept says nothing it does not know', () => {
  const events = [
    e('1', 'beat.omitted', { beat: 'a', code: 'slow', because: 'example' }),
    e('2', 'beat.fallback', { beat: 'b', code: 'invalid' }),
    e('3', 'beat.degraded', { beat: 'c', dropped: ['example', 'board'], causes: { example: 'slow', board: 'checks' } }),
    e('4', 'board.duplicate', { dropped: [{ step: 'd' }] }),
    e('5', 'beat.omitted', { beat: 'old' }),
    e('6', 'beat.degraded', { beat: 'older', dropped: ['board'], problems: ['x'] }),
    e('7', 'beat.omitted', { beat: 'odd', code: 'whatever' }),
  ];
  assert.deepEqual(lossesFromEvents(events), [
    item('step', 'slow', 'a', 'example'),
    item('narration', 'invalid', 'b'),
    item('example', 'slow', 'c'),
    item('board', 'checks', 'c'),
    item('board', 'repeats', 'd'),
  ]);
});

test('a retry starts again: only the latest run says what was left out', () => {
  const events = [
    e('1', 'run.started'),
    e('2', 'beat.omitted', { beat: 'a', code: 'unavailable' }),
    e('3', 'beat.degraded', { beat: 'b', dropped: ['board'], causes: { board: 'slow' } }),
    e('4', 'run.started'),
    e('5', 'beat.degraded', { beat: 'c', dropped: ['board'], causes: { board: 'checks' } }),
  ];
  assert.deepEqual(lossesFromEvents(events), [item('board', 'checks', 'c')]);
  assert.deepEqual(lossesFromEvents(events.slice(0, 3)), [
    item('step', 'unavailable', 'a'),
    item('board', 'slow', 'b'),
  ]);
});

test('a board that repeated an earlier one is the loss of the step that owns it, not of a step ID that is no beat', () => {
  assert.deepEqual(
    lossesFromEvents([
      e('1', 'board.duplicate', { dropped: [{ step: 'ex1.a-method', beat: 'exercise-ex1.a' }, { step: 'b' }] }),
    ]),
    [item('board', 'repeats', 'exercise-ex1.a'), item('board', 'repeats', 'b')],
  );
});

test('a finished generation says in its activity what was left out, and nothing when nothing was', () => {
  const lost = [e('1', 'beat.omitted', { beat: 'a', code: 'slow', because: 'example' })];
  const said = generationProgress(lost, 'ready');
  assert.match(said.detail, /^Ready to play\./);
  assert.match(said.detail, / \(1 planned step left out: its worked example took too long to write\)\.$/);
  assert.doesNotMatch(generationProgress([], 'ready').detail, /left out/);
  assert.doesNotMatch(
    generationProgress(lost, 'generating').detail,
    /left out/,
    'only a finished tour has anything to say',
  );
});
