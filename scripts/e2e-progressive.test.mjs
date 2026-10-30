import test from 'node:test';
import assert from 'node:assert/strict';
import { appendOnly, compareFinished, formatTimeline, parseArgs, shapeOf, stepsOf, summarize } from './e2e-progressive.mjs';

// The measurement script's own logic (no server, no model); run with: node --test scripts/e2e-progressive.test.mjs

const step = (id, say = `${id} says one thing.`) => ({ id, say, actions: [] });
const tour = (...chapters) => ({ chapters: chapters.map(([id, ...steps]) => ({ id, steps: steps.map((s) => (typeof s === 'string' ? step(s) : s)) })) });

test('the options have defaults, take values, and reject what they do not know', () => {
  const defaults = parseArgs([]);
  assert.deepEqual([defaults.keep, defaults.json, defaults.pollMs, defaults.timeoutS], [false, false, 400, 420]);
  assert.match(defaults.pdf, /demo\/attention\/paper\.pdf$/);
  const given = parseArgs(['--pdf', 'a/b.pdf', '--keep', '--poll-ms', '250', '--timeout-s', '90', '--json']);
  assert.deepEqual([given.keep, given.json, given.pollMs, given.timeoutS], [true, true, 250, 90]);
  assert.match(given.pdf, /a\/b\.pdf$/);
  assert.throws(() => parseArgs(['--nope']), /Unknown option/);
  assert.throws(() => parseArgs(['--poll-ms', '10']), /--poll-ms/);
  assert.throws(() => parseArgs(['--timeout-s', 'soon']), /--timeout-s/);
});

test('steps are read across chapters, and a tour shows its shape as ids only', () => {
  const t = tour(['c1', 'a', 'b'], ['c2', 'c']);
  assert.deepEqual(stepsOf(t).map((s) => s.id), ['a', 'b', 'c']);
  assert.deepEqual(stepsOf(null), []);
  assert.deepEqual(shapeOf(t), [['c1', ['a', 'b']], ['c2', ['c']]]);
  assert.ok(!JSON.stringify(shapeOf(t)).includes('says'), 'no narration is kept');
});

test('a tour grows by appending: the same steps with the same words in the same chapters, then more', () => {
  const held = tour(['c1', 'a', 'b']);
  assert.ok(appendOnly(held, tour(['c1', 'a', 'b'])), 'the same');
  assert.ok(appendOnly(held, tour(['c1', 'a', 'b', 'c'], ['c2', 'd'])), 'more steps and a new chapter');
  assert.ok(!appendOnly(held, tour(['c1', 'a'])), 'fewer');
  assert.ok(!appendOnly(held, tour(['c1', 'b', 'a'])), 'another order');
  assert.ok(!appendOnly(held, tour(['c1', 'a', step('b', 'other words')])), 'other narration');
  assert.ok(!appendOnly(held, tour(['c1', 'a'], ['c2', 'b'])), 'a step moved to another chapter: the reader engine would refuse to grow');
});

test('the finished tour is compared with the last partial one step by step, and what differs is named', () => {
  const held = tour(['c1', 'a', 'b'], ['c2', 'c']);
  const same = compareFinished(held, tour(['c1', 'a', 'b'], ['c2', 'c', 'd']));
  assert.deepEqual([same.prefix, same.held, same.finished, same.differing], [true, 3, 4, []]);
  const other = compareFinished(held, tour(['c1', 'a', 'x'], ['c2', step('c', 'rewritten')]));
  assert.equal(other.prefix, false);
  assert.deepEqual(other.differing.map((d) => [d.index, d.id]), [[1, 'b'], [2, 'c']]);
  assert.match(other.differing[0].why, /finished tour has x/);
  assert.match(other.differing[1].why, /narration differs/);
  const moved = compareFinished(held, tour(['c1', 'a'], ['c2', 'b', 'c']));
  assert.match(moved.differing[0].why, /in chapter c2, not c1/);
  const short = compareFinished(held, tour(['c1', 'a']));
  assert.deepEqual(short.differing.map((d) => d.why), ['missing in the finished tour', 'missing in the finished tour']);
});

const marks = [
  { name: 'reservation made', ms: -2000 },
  { name: 'upload finished', ms: 0 },
  { name: 'analysis ready', ms: 1800, note: '8 pages, limited' },
  { name: 'tour queued', ms: 1800 },
  { name: 'stage writing', ms: 3500 },
  { name: 'partial', ms: 80_100, ready: 1, planned: 11, bytes: 1500 },
  { name: 'partial', ms: 84_700, ready: 6, planned: 11, bytes: 6200 },
  { name: 'generation finished', ms: 100_000, steps: 11 },
];

test('the summary says when the first step could play and how much of the wait it saved', () => {
  const s = summarize(marks);
  assert.deepEqual([s.analysisReady, s.stageWriting, s.firstPartial, s.firstPartialSteps, s.firstPartialPlanned], [1800, 3500, 80_100, 1, 11]);
  assert.deepEqual([s.partials, s.lastPartial, s.lastPartialSteps, s.finished, s.finishedSteps], [2, 84_700, 6, 100_000, 11]);
  assert.equal(s.headStart, 19_900);
  assert.ok(Math.abs(s.headStartShare - 0.199) < 1e-9);
  assert.equal(s.firstPartialAfterWriting, 76_600);
});

test('a run with no partial or no finish leaves the numbers it could not measure empty', () => {
  const none = summarize(marks.filter((m) => m.name !== 'partial'));
  assert.deepEqual([none.firstPartial, none.headStart, none.headStartShare, none.partials], [null, null, null, 0]);
  const unfinished = summarize(marks.filter((m) => m.name !== 'generation finished'));
  assert.deepEqual([unfinished.finished, unfinished.headStart, unfinished.firstPartial], [null, null, 80_100]);
});

test('the timeline lists every mark in seconds after the upload finished', () => {
  const text = formatTimeline(marks);
  const lines = text.split('\n');
  assert.equal(lines[0], '  seconds after the upload finished');
  assert.match(lines[1], /^ {1,}-2\.0 s {2}reservation made$/);
  assert.match(lines[3], /1\.8 s {2}analysis ready: 8 pages, limited$/);
  assert.match(lines[6], /80\.1 s {2}partial tour: 1 of 11 steps \(1 kB\)$/);
  assert.equal(lines.length, marks.length + 1);
});
