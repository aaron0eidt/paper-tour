// Progressive tours in the reader: what a poll leaves the reader holding, how the poll follows a generation, what the
// timeline expects of the steps still to be written, and the simulated server the demo uses. Bundled for Node with esbuild
// like the other player tests (no test framework).

import { simulatedView, readGrowthPlan, leadingSteps } from '../src/dev/growth';
import { flattenTour } from '../src/engine';
import { followPartial } from '../src/library/followPartial';
import type { PartialFollow, PartialSource } from '../src/library/followPartial';
import { ApiRequestError } from '../src/library/client';
import { acceptPartial, countSteps, currentStatus, growthOf, partialPath, playablePartial, stoppedCopy, writingLabel } from '../src/partialTour';
import type { HeldPartial } from '../src/partialTour';
import { buildClock, wordAt } from '../src/tourClock';
import type { Doc, Tour } from '../src/types';
import type { TourGenerationStatus, TourPartialView } from '../../shared/contracts';

const results: string[] = [];
let failures = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
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

const SHA = 'a'.repeat(64);
const doc = { source: { sha256: SHA } } as unknown as Doc;
const step = (id: string, say = 'one two three four five six') => ({
  id,
  say,
  actions: [{ type: 'highlight' as const, targets: ['p1.s1'] }],
});
const tour: Tour = {
  schema: 'paper-tour/tour@0.1',
  title: 'A tour',
  paper: 'p',
  doc_sha256: SHA,
  chapters: [
    { id: 'c1', title: 'One', steps: [step('a'), step('b'), step('c')] },
    { id: 'c2', title: 'Two', steps: [step('d'), step('e')] },
  ],
};

const G = 'generation-1';
const view = (over: Partial<TourPartialView> = {}): TourPartialView => ({
  generationId: G,
  status: 'generating',
  stage: 'writing',
  tourId: null,
  attempt: 'attempt-1',
  ready: 2,
  planned: 5,
  tour: leadingSteps(tour, 2),
  ...over,
});
const held = (over: Partial<HeldPartial> = {}): HeldPartial => ({
  generationId: G,
  attempt: 'attempt-1',
  ready: 2,
  planned: 5,
  tour: leadingSteps(tour, 2),
  ...over,
});

// ------------------------------------------------------------------------------------------------- what is held

await test('the first partial is held with its counts; the tour itself is the step list', () => {
  const next = acceptPartial(null, view());
  eq([next?.ready, next?.planned, next && countSteps(next.tour), next?.attempt], [2, 5, 2, 'attempt-1']);
});

await test('a longer partial of the same attempt replaces the held one', () => {
  const next = acceptPartial(held(), view({ ready: 4, tour: leadingSteps(tour, 4) }));
  eq([next?.ready, next && countSteps(next.tour)], [4, 4]);
});

await test('a poll with counts only keeps the held tour and learns the plan', () => {
  const current = held();
  eq(acceptPartial(current, view({ tour: null })), current, 'nothing new: the same object');
  const planned = acceptPartial(current, view({ tour: null, planned: 8 }));
  eq([planned?.planned, planned?.tour === current.tour], [8, true]);
});

await test('a partial that is not longer, or a poll without an attempt, never steps back', () => {
  const current = held({ ready: 4, tour: leadingSteps(tour, 4) });
  eq(acceptPartial(current, view({ ready: 3, tour: leadingSteps(tour, 3) })), current);
  eq(acceptPartial(current, view({ status: 'queued', attempt: null, ready: 0, planned: 0, tour: null })), current);
  eq(acceptPartial(current, view({ status: 'failed', attempt: null, ready: 0, planned: 0, tour: null })), current, 'kept after a failure');
});

await test('another attempt or another generation replaces what is held, however short', () => {
  const current = held({ ready: 4, tour: leadingSteps(tour, 4) });
  const again = acceptPartial(current, view({ attempt: 'attempt-2', ready: 1, tour: leadingSteps(tour, 1) }));
  eq([again?.attempt, again?.ready, again && countSteps(again.tour)], ['attempt-2', 1, 1]);
  const other = acceptPartial(current, view({ generationId: 'generation-2', ready: 1, tour: leadingSteps(tour, 1) }));
  eq([other?.generationId, other?.ready], ['generation-2', 1]);
});

await test('planned never falls below what is ready', () => {
  eq(acceptPartial(null, view({ ready: 4, planned: 2, tour: leadingSteps(tour, 4) }))?.planned, 4);
});

await test('a client that holds a partial asks only for what is new, and only of its own generation', () => {
  const doc1 = 'doc/1';
  eq(partialPath(doc1, G, null), `/api/documents/doc%2F1/generations/${G}/partial`);
  eq(partialPath('d', G, held({ ready: 3 })), `/api/documents/d/generations/${G}/partial?after=3&attempt=attempt-1`);
  eq(partialPath('d', 'generation-2', held()), '/api/documents/d/generations/generation-2/partial', 'another generation: all of it');
});

await test('a partial plays only for the document it was written for, and without recorded audio', () => {
  const withAudio = held({ tour: { ...leadingSteps(tour, 2), chapters: [{ id: 'c1', title: 'One', steps: [{ ...step('a'), audio: { src: 'k', duration_ms: 1000 } }, step('b')] }] } });
  const playable = playablePartial(withAudio, doc);
  eq(playable?.chapters[0].steps.map((s) => s.audio), [undefined, undefined]);
  eq(playablePartial(withAudio, { source: { sha256: 'b'.repeat(64) } } as unknown as Doc), null, 'another document');
  eq(playablePartial(withAudio, null), null, 'no document yet');
  eq(playablePartial(held({ tour: { ...tour, chapters: [] } as Tour }), doc), null, 'a shape the player rejects');
  eq(playablePartial(null, doc), null);
});

await test('what the learner is told: writing, writing again, or why it stopped', () => {
  const states: [TourGenerationStatus | null, string, string | undefined][] = [
    ['generating', 'writing', undefined],
    [null, 'writing', undefined],
    ['ready', 'writing', undefined],
    ['queued', 'retrying', undefined],
    ['failed', 'stopped', 'failed'],
    ['needs_configuration', 'stopped', 'failed'],
    ['cancelled', 'stopped', 'cancelled'],
    ['paused', 'stopped', 'paused'],
  ];
  for (const [status, phase, reason] of states) {
    const growth = growthOf(held(), status);
    eq([growth?.phase, growth?.reason, growth?.steps, growth?.planned], [phase, reason, 2, 5], String(status));
  }
  eq(growthOf(null, 'generating'), null);
  eq(writingLabel({ phase: 'writing' }), 'Writing the next step');
  eq(writingLabel({ phase: 'retrying' }), 'Writing the tour again');
  const stopped = stoppedCopy(growthOf(held(), 'failed')!);
  eq([stopped.label, stopped.title], ['Stopped early', 'The tour stopped early']);
  if (!stopped.detail.includes('first 2 steps')) throw new Error(stopped.detail);
  if (!stoppedCopy(growthOf(held({ tour: leadingSteps(tour, 1), ready: 1 }), 'cancelled')!).detail.includes('the first step')) throw new Error('one step');
});

await test('the status shown is the poll\'s while the generation runs, and the manifest\'s once it does not', () => {
  const cases: [TourGenerationStatus | undefined, TourGenerationStatus | null, TourGenerationStatus | null][] = [
    ['generating', 'generating', 'generating'],
    ['queued', 'generating', 'generating'],
    ['generating', null, 'generating'],
    [undefined, 'generating', 'generating'],
    [undefined, null, null],
    ['failed', 'generating', 'failed'],
    ['generating', 'failed', 'generating'],
    ['failed', 'failed', 'failed'],
    ['ready', 'generating', 'ready'],
    ['cancelled', 'failed', 'cancelled'],
  ];
  for (const [manifest, polled, shown] of cases) eq(currentStatus(manifest, polled), shown, `${manifest} / ${polled}`);
});

// -------------------------------------------------------------------------------------------------- the poll

/** A source that answers from a script, one answer per poll, and records what it was asked. */
function scripted(answers: (TourPartialView | Error)[]) {
  const asked: (HeldPartial | null)[] = [];
  const source: PartialSource = {
    key: G,
    fetch: async (current) => {
      asked.push(current);
      const next = answers.shift();
      if (!next) throw new Error('asked too often');
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { source, asked };
}

async function follow(answers: (TourPartialView | Error)[], abortAfter = Infinity) {
  const { source, asked } = scripted(answers);
  const current: { current: HeldPartial | null } = { current: null };
  const reports: PartialFollow[] = [];
  const settled: TourGenerationStatus[] = [];
  const waits: number[] = [];
  const controller = new AbortController();
  await followPartial(
    source,
    current,
    (next) => reports.push(next),
    (status) => settled.push(status),
    controller.signal,
    async (ms) => {
      waits.push(ms);
      if (waits.length >= abortAfter) controller.abort();
    },
  );
  return { asked, reports, settled, waits, held: current.current };
}

await test('the poll follows a generation to the finished tour, sending what it holds and then stopping', async () => {
  const done = view({ status: 'ready', tourId: 't', attempt: null, ready: 0, planned: 0, tour: null });
  const run = await follow([view({ attempt: null, ready: 0, planned: 0, tour: null }), view(), view({ tour: null }), view({ ready: 4, tour: leadingSteps(tour, 4) }), done]);
  eq(run.asked.map((h) => h && [h.ready, h.attempt]), [null, null, [2, 'attempt-1'], [2, 'attempt-1'], [4, 'attempt-1']]);
  eq(run.reports.map((r) => [r.status, r.held && countSteps(r.held.tour)]), [['generating', null], ['generating', 2], ['generating', 2], ['generating', 4], ['ready', 4]]);
  eq(run.settled, ['ready']);
  eq(run.waits, [1500, 1500, 1500, 1500], 'about every 1.5 s');
  eq(run.held && countSteps(run.held.tour), 4, 'the steps stay for the learner');
});

await test('a failed or stopped generation settles the poll and keeps what came', async () => {
  for (const status of ['failed', 'cancelled', 'paused', 'needs_configuration'] as const) {
    const run = await follow([view(), view({ status, attempt: null, ready: 0, planned: 0, tour: null })]);
    eq(run.settled, [status]);
    eq(run.held?.ready, 2, status);
  }
});

await test('a retry is followed through: queued, then the next attempt replaces the steps', async () => {
  const queued = view({ status: 'queued', attempt: null, ready: 0, planned: 0, tour: null });
  const run = await follow([view({ ready: 3, tour: leadingSteps(tour, 3) }), queued, view({ attempt: 'attempt-2', ready: 1, tour: leadingSteps(tour, 1) }), view({ status: 'ready', tourId: 't', attempt: null, ready: 0, planned: 0, tour: null })]);
  eq(run.reports.map((r) => [r.status, r.held?.attempt, r.held?.ready]), [['generating', 'attempt-1', 3], ['queued', 'attempt-1', 3], ['generating', 'attempt-2', 1], ['ready', 'attempt-2', 1]]);
  eq(run.asked[3]?.attempt, 'attempt-2', 'the new attempt is what is sent after it');
});

await test('a connection that fails is asked again, less often each time, and recovers', async () => {
  const run = await follow([new Error('offline'), new Error('offline'), new Error('offline'), new Error('offline'), view(), view({ status: 'ready', attempt: null, ready: 0, planned: 0, tour: null })]);
  eq(run.waits, [3000, 6000, 8000, 8000, 1500]);
  eq(run.settled, ['ready']);
});

await test('errors that no retry mends end the poll quietly', async () => {
  for (const status of [401, 403, 404, 503]) {
    const run = await follow([new ApiRequestError('no', status, 'x')]);
    eq([run.asked.length, run.waits.length, run.settled.length], [1, 0, 0], String(status));
  }
  const retried = await follow([new ApiRequestError('busy', 500, 'x'), view({ status: 'failed', attempt: null, ready: 0, planned: 0, tour: null })]);
  eq(retried.settled, ['failed'], 'a server error is retried');
});

await test('an aborted poll reports nothing more', async () => {
  const run = await follow([view(), view({ ready: 3, tour: leadingSteps(tour, 3) }), view({ ready: 4, tour: leadingSteps(tour, 4) })], 1);
  eq(run.reports.length, 1);
  eq(run.settled, []);
});

// ---------------------------------------------------------------------------------------------------- the timeline

await test('the timeline expects the steps still to be written to take as long as the written ones', () => {
  const steps = flattenTour(leadingSteps(tour, 3));
  const finished = buildClock(steps);
  eq([finished.pending, finished.span], [0, finished.total]);
  const writing = buildClock(steps, { pending: 2 });
  eq(writing.total, finished.total, 'what is written is unchanged');
  eq(writing.pending, (finished.total / 3) * 2);
  eq(writing.span, writing.total + writing.pending);
  eq(buildClock([], { pending: 3 }).pending, 60_000, 'without a step to go by: 20 s each');
  // A position beyond the written part means the end of the last written step.
  const at = wordAt(writing, writing.span, steps.map((fs) => fs.words.length));
  eq(at.index, 2);
});

// ------------------------------------------------------------------------------------ the simulated server (dev)

await test('the simulated generation hands out steps on a clock and follows the endpoint\'s rules', () => {
  const plan = { first: 2, every: 5 };
  const at = (seconds: number, held: { ready: number; attempt: string } | null = null) => simulatedView(tour, plan, seconds * 1000, held);
  eq([at(0).ready, at(0).planned, at(0).tour && countSteps(at(0).tour!)], [2, 5, 2]);
  eq([at(4.9).ready, at(5).ready, at(10).ready], [2, 3, 4]);
  eq(at(5, { ready: 2, attempt: 'attempt-1' }).tour && 1, 1, 'newer than what is held: the tour comes');
  eq(at(5, { ready: 3, attempt: 'attempt-1' }).tour, null, 'what is held is current: counts only');
  eq(at(5, { ready: 3, attempt: 'other' }).tour && 1, 1, 'another attempt: always the tour');
  const done = at(15);
  eq([done.status, done.tour, done.attempt, done.ready, done.tourId], ['ready', null, null, 0, 'simulated-tour']);
});

await test('the simulation can stop, or start the attempt again with the same steps', () => {
  const stopped = { first: 2, every: 5, stop: { after: 3, status: 'cancelled' as const } };
  eq([simulatedView(tour, stopped, 5000, null).ready, simulatedView(tour, stopped, 10000, null).status], [3, 'cancelled']);
  const restart = { first: 2, every: 5, restart: { at: 4, renamed: false } };
  const before = simulatedView(tour, restart, 5000, null);
  const after = simulatedView(tour, restart, 10000, null);
  eq([before.attempt, before.ready, after.attempt, after.ready], ['attempt-1', 3, 'attempt-2', 2]);
  eq(after.tour && countSteps(after.tour), 2);
  const renamed = simulatedView(tour, { ...restart, restart: { at: 4, renamed: true } }, 10000, null);
  eq(renamed.tour?.chapters[0].steps.map((st) => st.id), ['a~2', 'b~2']);
});

await test('the demo reads its plan from the address', () => {
  eq(readGrowthPlan(new URLSearchParams('paper=x')), null);
  eq(readGrowthPlan(new URLSearchParams('grow')), { first: 2, every: 6 });
  eq(readGrowthPlan(new URLSearchParams('grow=3&growFrom=4&growStop=7:cancelled&growRestart=5')), {
    first: 4,
    every: 3,
    stop: { after: 7, status: 'cancelled' },
    restart: { at: 5, renamed: false },
  });
  eq(readGrowthPlan(new URLSearchParams('grow=3&growRestart=5:new'))?.restart, { at: 5, renamed: true });
  eq(readGrowthPlan(new URLSearchParams('grow=nope&growStop=6'))?.stop, { after: 6, status: 'failed' });
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} partial tour tests passed`);
