// Reading an answer while the server writes it: lines of NDJSON, one step at a time, then the whole answer. Driven with
// Responses built in the test and a stubbed fetch. Bundled for Node with esbuild like the other player tests.

import { readAnswerStream } from '../src/ask/api';
import type { AskAnswer } from '../src/ask/api';
import { answerTour } from '../src/ask/answer';
import { ApiRequestError } from '../src/library/client';
import { TourEngine } from '../src/engine';
import type { Timers } from '../src/engine';
import { SilentNarrator } from '../src/narration/silent';
import type { Step } from '../src/types';

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

const step = (id: string, say: string): Step => ({ id, say, actions: [] });
const first = step('a-1', 'The scores are scaled so the softmax stays useful.');
const second = step('a-2', 'Without scaling the gradients would almost vanish for large keys.');
const whole: AskAnswer = { answerable: 'yes', steps: [first, second], followups: ['What is d_k?'] };
const line = (event: unknown) => `${JSON.stringify(event)}\n`;
const stream = (...events: unknown[]) => events.map(line).join('');

/** A response whose body arrives in pieces of `size` bytes, so that lines and characters are cut anywhere. */
function pieces(text: string, size: number, type = 'application/x-ndjson'): Response {
  const bytes = new TextEncoder().encode(text);
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let at = 0; at < bytes.length; at += size) controller.enqueue(bytes.slice(at, at + size));
        controller.close();
      },
    }),
    { headers: { 'content-type': type } },
  );
}

await test('each step is passed on as the answer so far, and the whole answer ends the stream, whatever the pieces', async () => {
  const text = stream(
    { type: 'step', answerable: 'yes', step: first, language: 'de-DE' },
    { type: 'step', answerable: 'yes', step: second },
    { type: 'answer', answer: { ...whole, steps: [first, { ...second, say: `${second.say} — über Größen` }] } },
  );
  for (const size of [1, 3, 17, 1000]) {
    const progress: AskAnswer[] = [];
    const answer = await readAnswerStream(pieces(text, size), (part) => progress.push(part));
    eq(
      progress.map((p) => p.steps.map((s) => s.id)),
      [['a-1'], ['a-1', 'a-2']],
      `size ${size}`,
    );
    eq(progress[1].followups, [], 'no follow-ups before the whole answer');
    eq(progress[0].answerable, 'yes');
    eq(
      progress.map((p) => p.language),
      ['de-DE', 'de-DE'],
      'the chosen language comes with the first step',
    );
    eq(answer.followups, ['What is d_k?']);
    eq(answer.steps[1].say.endsWith('über Größen'), true, 'a character cut between two pieces is read whole');
  }
});

await test('an error line ends the stream with its words, and a stream that just stops was cut short', async () => {
  const progress: string[] = [];
  const failed = readAnswerStream(
    pieces(
      stream(
        { type: 'step', answerable: 'partly', step: first },
        {
          type: 'error',
          error: { code: 'model_unavailable', message: 'The model could not be reached.', status: 503 },
        },
      ),
      9,
    ),
    (part) => progress.push(part.steps[0].id),
  );
  await failed.then(
    () => {
      throw new Error('it should have failed');
    },
    (error) => {
      eq(error instanceof ApiRequestError, true);
      eq([error.message, error.status, error.code], ['The model could not be reached.', 503, 'model_unavailable']);
    },
  );
  eq(progress, ['a-1'], 'the step before the error was passed on');
  const cut = readAnswerStream(pieces(stream({ type: 'step', answerable: 'yes', step: first }), 50), () => {});
  await cut.then(
    () => {
      throw new Error('it should have failed');
    },
    (error) => eq(error.code, 'answer_cut'),
  );
  // Lines that are not JSON are skipped.
  const noisy = await readAnswerStream(pieces(`garbage\n${stream({ type: 'answer', answer: whole })}\n`, 20), () => {});
  eq(noisy.steps.length, 2);
});

/** Run `fn` with fetch replaced; records what the request asked for. */
await test('the steps of an answer keep their IDs as it grows, so the playing answer can take the next ones', () => {
  const timers: Timers = { setTimeout: () => 0, clearTimeout: () => {} };
  const tour = answerTour({ ...whole, steps: [first], followups: [] }, 'Why scale?', null);
  const engine = new TourEngine(tour, { narrator: new SilentNarrator(), timers, open: true });
  eq(engine.total, 1);
  eq(engine.extend(answerTour({ ...whole, steps: [first, second], followups: [] }, 'Why scale?', null), true), true);
  eq(engine.total, 2, 'the second step joined');
  eq(engine.extend(answerTour(whole, 'Why scale?', null), false), true);
  eq(engine.total, 2);
  engine.destroy();
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} answer stream tests passed`);
