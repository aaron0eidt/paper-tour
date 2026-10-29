// Answers kept ahead of the learner: the suggested questions are asked for in the background, one at a time, with the
// request a click would send, and a question the learner asks goes first. Driven with a fake transport whose requests
// the test settles by hand. Bundled for Node with esbuild like the other player tests (no test framework).

import type { AskAnswer, AskRequest, AskSource } from '../src/ask/api';
import { AnswerKeeper, prefetchPossible, prefetchWanted, requestKey } from '../src/ask/prefetch';
import type { PrefetchState } from '../src/ask/prefetch';

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

const source: AskSource = { paper: 'demo' };
const answerTo = (say: string): AskAnswer => ({
  answerable: 'yes',
  steps: [{ id: 'a', say, actions: [] }],
  followups: [],
});
const request = (question: string, extra: Partial<AskRequest> = {}): AskRequest => ({
  question,
  tourId: 't1',
  stepId: 'last',
  history: [],
  ...extra,
});

/** One request the keeper made: settle it by hand. */
interface Call {
  question: string;
  signal: AbortSignal;
  resolve(answer: AskAnswer): void;
  reject(error: unknown): void;
}

function fake() {
  const calls: Call[] = [];
  let open = 0;
  let most = 0;
  const transport = (_source: AskSource, req: AskRequest, signal: AbortSignal) =>
    new Promise<AskAnswer>((resolve, reject) => {
      open++;
      most = Math.max(most, open);
      const done = () => void open--;
      const call: Call = {
        question: req.question,
        signal,
        resolve: (answer) => (done(), resolve(answer)),
        reject: (error) => (done(), reject(error)),
      };
      signal.addEventListener('abort', () => call.reject(new DOMException('aborted', 'AbortError')), { once: true });
      calls.push(call);
    });
  return { calls, transport, concurrent: () => most };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

await test('a request is the same question whatever the earlier exchanges, spacing or an unknown language', () => {
  const base = requestKey(source, request('Why  this?'));
  eq(requestKey(source, request(' Why this? ', { history: [{ question: 'a', answer: 'b' }] })), base, 'history and blanks');
  eq(requestKey(source, request('Why this?', { responseLanguage: 'xx-XX' })), base, 'a language the server ignores');
  for (const other of [
    request('Why this?', { stepId: 'middle' }),
    request('Why this?', { figureId: 'fig1' }),
    request('Why this?', { tourId: 't2' }),
    request('Why this?', { analysisId: 'a1' }),
    request('Why this?', { responseLanguage: 'de-DE' }),
    request('Why this?', { selection: { page: 1, rect: [0, 0, 1, 1] } }),
    request('Why that?'),
  ])
    if (requestKey(source, other) === base) throw new Error(`the same key for ${JSON.stringify(other)}`);
  eq(requestKey({ paper: 'other' }, request('Why this?')) === base, false, 'another document');
  eq(requestKey({ documentId: 'demo' }, request('Why this?')) === base, false, 'a library document is not a demo');
});

await test('the background asks one question at a time, in order, and keeps the answers', async () => {
  const { calls, transport, concurrent } = fake();
  const keeper = new AnswerKeeper(transport);
  let changes = 0;
  keeper.subscribe(() => changes++);
  keeper.prefetch(source, [request('one'), request('two'), request('three')]);
  eq(calls.map((c) => c.question), ['one'], 'only the first is asked');
  calls[0].resolve(answerTo('A'));
  await settle();
  eq(calls.map((c) => c.question), ['one', 'two'], 'the next after it');
  eq(keeper.has(source, request('one')), true);
  eq(keeper.has(source, request('two')), false);
  calls[1].resolve(answerTo('B'));
  await settle();
  calls[2].resolve(answerTo('C'));
  await settle();
  eq([keeper.size, changes, concurrent()], [3, 3, 1], 'three kept, announced three times, never two at once');
  eq(keeper.take(source, request('three'))?.steps[0].say, 'C');
});

await test('a kept answer is a copy: playing it cannot change what is kept', async () => {
  const { calls, transport } = fake();
  const keeper = new AnswerKeeper(transport);
  keeper.prefetch(source, [request('one')]);
  calls[0].resolve(answerTo('A'));
  await settle();
  const first = keeper.take(source, request('one'))!;
  first.steps[0].say = 'changed';
  first.steps.push({ id: 'b', say: 'more', actions: [] });
  eq(keeper.take(source, request('one'))?.steps.map((s) => s.say), ['A']);
});

await test('asking again for what is running, queued or kept asks nothing new; a new list replaces the queue', async () => {
  const { calls, transport } = fake();
  const keeper = new AnswerKeeper(transport);
  keeper.prefetch(source, [request('one'), request('two')]);
  keeper.prefetch(source, [request('one'), request('two')]);
  eq(calls.length, 1, 'the same list while the first runs');
  keeper.prefetch(source, [request('one'), request('three')]);
  eq(calls.length, 1, 'the running one is still wanted');
  calls[0].resolve(answerTo('A'));
  await settle();
  eq(calls.map((c) => c.question), ['one', 'three'], 'two was dropped from the queue');
  keeper.prefetch(source, [request('one'), request('three')]);
  eq(calls.length, 2, 'a kept answer is not asked again');
});

await test('a running request that is no longer wanted stops, and the next one starts', async () => {
  const { calls, transport } = fake();
  const keeper = new AnswerKeeper(transport);
  keeper.prefetch(source, [request('one', { stepId: 'a' })]);
  keeper.prefetch(source, [request('one', { stepId: 'b' })]);
  eq(calls.map((c) => c.signal.aborted), [true, false], 'the one asked about another step was stopped');
  await settle();
  eq(keeper.size, 0, 'a stopped request keeps nothing');
  calls[1].resolve(answerTo('B'));
  await settle();
  eq(keeper.has(source, request('one', { stepId: 'b' })), true);
  eq(keeper.has(source, request('one', { stepId: 'a' })), false);
});

await test('a failed background request ends the background work: nothing is asked again', async () => {
  const { calls, transport } = fake();
  const keeper = new AnswerKeeper(transport);
  keeper.prefetch(source, [request('one'), request('two')]);
  calls[0].reject(new Error('Demo questions need the API running locally in development.'));
  await settle();
  keeper.prefetch(source, [request('one'), request('two')]);
  eq(calls.length, 1, 'neither the next question nor a retry');
  keeper.clear();
  keeper.prefetch(source, [request('one')]);
  eq(calls.length, 2, 'a new document starts afresh');
});

await test('holding lets the running request finish but starts no more', async () => {
  const { calls, transport } = fake();
  const keeper = new AnswerKeeper(transport);
  keeper.prefetch(source, [request('one'), request('two')]);
  keeper.hold();
  calls[0].resolve(answerTo('A'));
  await settle();
  eq([calls.length, keeper.size, calls[0].signal.aborted], [1, 1, false]);
});

await test('a kept answer plays at once, with no request', async () => {
  const { calls, transport } = fake();
  const keeper = new AnswerKeeper(transport);
  keeper.prefetch(source, [request('one')]);
  calls[0].resolve(answerTo('A'));
  await settle();
  const answer = await keeper.answer(source, request('one', { history: [{ question: 'x', answer: 'y' }] }), new AbortController().signal);
  eq([answer.steps[0].say, calls.length], ['A', 1], 'earlier exchanges do not matter');
});

await test('a question the background is already answering waits for it instead of asking again', async () => {
  const { calls, transport } = fake();
  const keeper = new AnswerKeeper(transport);
  keeper.prefetch(source, [request('one'), request('two')]);
  const asked = keeper.answer(source, request('one'), new AbortController().signal);
  eq(calls.length, 1, 'no second request');
  calls[0].resolve(answerTo('A'));
  eq((await asked).steps[0].say, 'A');
  await settle();
  eq(calls.map((c) => c.question), ['one', 'two'], 'the background goes on with the next');
});

await test('a question that was not asked for stops the background work and asks for itself', async () => {
  const { calls, transport, concurrent } = fake();
  const keeper = new AnswerKeeper(transport);
  keeper.prefetch(source, [request('one'), request('two')]);
  const asked = keeper.answer(source, request('mine'), new AbortController().signal);
  eq(calls.map((c) => [c.question, c.signal.aborted]), [['one', true], ['mine', false]]);
  calls[1].resolve(answerTo('M'));
  eq((await asked).steps[0].say, 'M');
  await settle();
  eq([calls.length, concurrent()], [2, 1], 'the queue is gone, and never two at once');
});

await test('stopping while waiting for the background request gives up the wait, not the request', async () => {
  const { calls, transport } = fake();
  const keeper = new AnswerKeeper(transport);
  keeper.prefetch(source, [request('one')]);
  const stop = new AbortController();
  const asked = keeper.answer(source, request('one'), stop.signal);
  stop.abort();
  let error: unknown;
  await asked.catch((e) => (error = e));
  eq([error instanceof DOMException, (error as DOMException).name], [true, 'AbortError'], 'a cancellation');
  eq(calls[0].signal.aborted, false, 'the background request goes on');
  calls[0].resolve(answerTo('A'));
  await settle();
  eq(keeper.has(source, request('one')), true, 'and its answer is kept');
});

await test('when the background request fails the waiting question asks for itself', async () => {
  const { calls, transport } = fake();
  const keeper = new AnswerKeeper(transport);
  keeper.prefetch(source, [request('one')]);
  const asked = keeper.answer(source, request('one'), new AbortController().signal);
  calls[0].reject(new Error('busy'));
  await settle();
  eq(calls.length, 2, 'asked again, for itself');
  calls[1].resolve(answerTo('A'));
  eq((await asked).steps[0].say, 'A');
});

await test('leaving the document stops the request and forgets the answers', async () => {
  const { calls, transport } = fake();
  const keeper = new AnswerKeeper(transport);
  keeper.prefetch(source, [request('one'), request('two')]);
  calls[0].resolve(answerTo('A'));
  await settle();
  let changes = 0;
  keeper.subscribe(() => changes++);
  keeper.clear();
  eq([calls[1].signal.aborted, keeper.size, changes], [true, 0, 1]);
  await settle();
  eq(calls.length, 2, 'nothing follows');
});

const state = (extra: Partial<PrefetchState> = {}): PrefetchState => ({
  finished: true,
  steps: 5,
  index: 4,
  status: 'playing',
  aside: false,
  ...extra,
});

await test('the suggested questions are asked for from the last step on', () => {
  eq(prefetchWanted(state()), true, 'playing the last step');
  eq(prefetchWanted(state({ status: 'ended' })), true, 'the end card');
  eq(prefetchWanted(state({ status: 'paused' })), true, 'paused there after hearing it');
  eq(prefetchWanted(state({ index: 3 })), false, 'a step before the last');
  eq(prefetchWanted(state({ status: 'paused', preview: true })), false, 'only jumped to the last step');
  eq(prefetchWanted(state({ status: 'idle' })), false, 'the tour has not started');
});

await test('nothing is asked for while the tour is being written or the learner asks something else', () => {
  eq(prefetchWanted(state({ finished: false })), false, 'still being written, or no document to ask about');
  eq(prefetchWanted(state({ aside: true })), false, 'a question, an answer or a region is on');
  eq(prefetchWanted(state({ steps: 0, index: 0 })), false, 'no steps');
});

await test('a demo paper is asked about in the background only where a local API can answer', () => {
  eq(prefetchPossible({ documentId: 'd1' }, {}), true, 'a library document has its API');
  eq(prefetchPossible({ paper: 'demo' }, { DEV: true }), true, 'the dev server proxies the demo route');
  eq(prefetchPossible({ paper: 'demo' }, { VITE_API_URL: 'http://127.0.0.1:3001' }), true, 'an API address was given');
  eq(prefetchPossible({ paper: 'demo' }, {}), false, 'a static demo has no ask route');
  eq(prefetchPossible({ paper: 'demo' }, { DEV: false, VITE_API_URL: '' }), false);
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} prefetch tests passed`);
