import test from 'node:test';
import assert from 'node:assert/strict';
import type { Step } from '../../shared/paper';
import { createApp } from '../src/app';
import { HttpError } from '../src/errors';
import type { AskAnswer, AnswerEvent } from '../src/harness/ask';
import { NDJSON, StepScanner, currentSink } from '../src/harness/ask';
import type { Library } from '../src/service';

// Reading an answer while it is written: the scanner that finds each whole step in the model's JSON, and the route that
// sends the steps as lines of NDJSON.

const step = (say: string): Step => ({ id: `s-${say.length}`, say, actions: [{ type: 'focus', target: 'p1.s1' }] });
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Feed text to a scanner in pieces of `size` characters, collecting the steps as they are found. */
function scan(text: string, size: number) {
  const scanner = new StepScanner();
  const found: { at: number; step: unknown }[] = [];
  for (let at = 0; at < text.length; at += size)
    for (const whole of scanner.push(text.slice(at, at + size)))
      found.push({ at: Math.min(text.length, at + size), step: whole });
  return { scanner, found };
}

const ANSWER = JSON.stringify({
  answerable: 'yes',
  followups: ['What is d_k?', 'Why a square root?'],
  plan: 'A plan with "quotes", braces {} and [brackets].',
  steps: [
    { board: { kind: 'none', terms: [] }, cues: [], say: 'First, a {brace} and a "quote" \\ and ] inside the words.' },
    { board: { kind: 'none', terms: [] }, cues: [{ anchor: 'x', steps: [1] }], say: 'Second.' },
  ],
});

test('the scanner finds the verdict and each step the moment its closing brace arrives, whatever the piece size', () => {
  const first = ANSWER.indexOf('Second.') - 40;
  for (const size of [1, 2, 7, 64, ANSWER.length]) {
    const { scanner, found } = scan(ANSWER, size);
    assert.equal(scanner.ok, true, `size ${size}`);
    assert.equal(scanner.answerable, 'yes');
    assert.equal(found.length, 2, `size ${size}`);
    assert.deepEqual(
      found.map((f) => (f.step as { say: string }).say),
      ['First, a {brace} and a "quote" \\ and ] inside the words.', 'Second.'],
    );
    // The first step is whole long before the answer ends: with small pieces it is found before the second begins.
    if (size < 64) assert.ok(found[0].at <= first + size, `size ${size}: found at ${found[0].at} of ${ANSWER.length}`);
    assert.deepEqual(
      scanner.steps,
      found.map((f) => f.step),
    );
  }
});

test('a step is not reported while it is half written, and a key named steps deeper down is not the list', () => {
  const half = '{"answerable":"partly","steps":[{"say":"Whole.","cues":[]},{"say":"Half writ';
  const scanner = new StepScanner();
  assert.deepEqual(scanner.push(half), [{ say: 'Whole.', cues: [] }]);
  assert.equal(scanner.answerable, 'partly');
  assert.deepEqual(scanner.push('ten.","cues":[]}]'), [{ say: 'Half written.', cues: [] }]);
  const deeper = new StepScanner();
  assert.deepEqual(deeper.push('{"plan":{"steps":[{"say":"not a step"}]},"steps":[{"say":"a step"}]}'), [
    { say: 'a step' },
  ]);
  assert.equal(deeper.ok, true);
  const nested = new StepScanner();
  nested.push('{"answerable":"yes","steps":[{"say":"a","board":{"steps":[{"say":"inner"}]}}]}');
  assert.deepEqual(nested.steps, [{ say: 'a', board: { steps: [{ say: 'inner' }] } }]);
});

test('text that is not the answer’s JSON stops the scanner instead of throwing', () => {
  const scanner = new StepScanner();
  assert.deepEqual(scanner.push('{"steps":[{"say":"a"}}]]]'), [{ say: 'a' }]);
  assert.equal(scanner.ok, false);
  assert.deepEqual(scanner.push('{"steps":[{"say":"b"}]}'), []);
  const broken = new StepScanner();
  assert.deepEqual(broken.push('{"answerable":"yes","steps":[{"say":}]}'), []);
  assert.equal(broken.ok, false);
});

// ------------------------------------------------------------------ the route

const answer: AskAnswer = {
  answerable: 'yes',
  steps: [step('First.'), step('Second step.')],
  followups: ['What next?'],
};

function app(demoAsk: (paper: string, request: unknown, signal?: AbortSignal) => Promise<AskAnswer>) {
  return createApp({
    service: { demoAsk } as unknown as Library,
    authenticate: async () => null,
    demo: true,
  });
}
const post = (server: Awaited<ReturnType<typeof app>>, accept?: string) =>
  server.inject({
    method: 'POST',
    url: '/api/demo/paper/ask',
    payload: { question: 'Why?' },
    ...(accept ? { headers: { accept } } : {}),
  });
const lines = (body: string): AnswerEvent[] =>
  body
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

test('a client that asks for NDJSON gets each step as it is finished, then the whole answer', async () => {
  const server = await app(async () => {
    const sink = currentSink();
    assert.ok(sink, 'the route gives the answer a sink');
    sink('yes', answer.steps[0], 'de-DE');
    await wait(20);
    sink('yes', answer.steps[1]);
    await wait(20);
    return answer;
  });
  try {
    const response = await post(server, NDJSON);
    assert.equal(response.statusCode, 200);
    assert.match(String(response.headers['content-type']), /^application\/x-ndjson/);
    assert.match(String(response.headers['cache-control']), /no-store/);
    assert.deepEqual(lines(response.body), [
      { type: 'step', answerable: 'yes', step: answer.steps[0], language: 'de-DE' },
      { type: 'step', answerable: 'yes', step: answer.steps[1] },
      { type: 'answer', answer },
    ]);
  } finally {
    await server.close();
  }
});

test('the usual JSON comes back without the request, with no early step, and when the answer is already known', async () => {
  let streamed = false;
  const server = await app(async () => {
    streamed = currentSink() !== undefined;
    return answer;
  });
  try {
    const plain = await post(server);
    assert.equal(plain.statusCode, 200);
    assert.match(String(plain.headers['content-type']), /^application\/json/);
    assert.deepEqual(plain.json(), answer);
    assert.equal(streamed, false, 'a client that did not ask gets no sink');
    // A stored or shared answer has no early steps: it is sent whole, as JSON, so the reader plays it at once.
    const known = await post(server, `${NDJSON}, application/json`);
    assert.match(String(known.headers['content-type']), /^application\/json/);
    assert.deepEqual(known.json(), answer);
    assert.equal(streamed, true);
  } finally {
    await server.close();
  }
});

test('an error before the first step has its own status; one after it ends the stream with an error line', async () => {
  const before = await app(async () => {
    throw new HttpError(429, 'too_many_questions', 'Wait for the current answer, then ask again.');
  });
  const after = await app(async () => {
    currentSink()?.('yes', answer.steps[0]);
    await wait(10);
    throw new HttpError(503, 'model_unavailable', 'The model could not be reached. Ask again in a moment.');
  });
  const unknown = await app(async () => {
    currentSink()?.('partly', answer.steps[0]);
    throw new Error('the key sk-secret failed');
  });
  try {
    const early = await post(before, NDJSON);
    assert.equal(early.statusCode, 429);
    assert.equal(early.json().error.code, 'too_many_questions');
    const late = await post(after, NDJSON);
    assert.equal(late.statusCode, 200);
    assert.deepEqual(lines(late.body), [
      { type: 'step', answerable: 'yes', step: answer.steps[0] },
      {
        type: 'error',
        error: {
          code: 'model_unavailable',
          message: 'The model could not be reached. Ask again in a moment.',
          status: 503,
        },
      },
    ]);
    const hidden = lines((await post(unknown, NDJSON)).body);
    assert.equal(hidden.at(-1)?.type, 'error');
    assert.doesNotMatch(JSON.stringify(hidden), /sk-secret/, 'an unexpected failure never echoes its message');
  } finally {
    await Promise.all([before.close(), after.close(), unknown.close()]);
  }
});
