import { AsyncLocalStorage } from 'node:async_hooks';
import { PassThrough } from 'node:stream';
import type { FastifyReply } from 'fastify';
import { HttpError } from '../errors';
import type { AnswerEvent, AskAnswer, StepSink } from './ask-types';

// Reading an answer while it is written. The model writes the whole answer in one call, so the first step is finished
// long before the last: the scanner below finds each step the moment its closing brace arrives, ask.ts checks it and
// hands it to the sink, and the route sends it to the reader as one line of NDJSON. The sink travels with the request
// (AsyncLocalStorage), so the cached answer path in service.ts is unchanged: a cached or shared answer simply has no
// early steps and is sent whole.

/** The media type of a streamed answer; a client that does not ask for it gets the usual JSON. */
export const NDJSON = 'application/x-ndjson';

const sinks = new AsyncLocalStorage<StepSink>();
/** Where the request being answered wants its finished steps, if it asked to read them as they are written. */
export const currentSink = (): StepSink | undefined => sinks.getStore();
/** Run an answer so that its finished steps go to `sink`. */
export const withSink = <T>(sink: StepSink, run: () => T): T => sinks.run(sink, run);

/**
 * Reads the model's JSON as it arrives and reports what is already whole: the verdict (`answerable`) and each element of
 * `steps` once its closing brace is in. Strings are skipped correctly (braces and quotes inside the narration), and
 * nothing else of the document is interpreted.
 */
export class StepScanner {
  private text = '';
  private at = 0;
  private depth = 0;
  private quoted = false;
  private escaped = false;
  private word = '';
  private key = '';
  private reading: 'key' | 'value' | 'other' = 'other';
  private last = '';
  private begin = -1;
  answerable: string | undefined;
  readonly steps: unknown[] = [];
  /** False once the text turned out not to be JSON of this shape; nothing more is reported. */
  ok = true;

  /** Add the next piece of text; returns the steps that this piece finished. */
  push(chunk: string): unknown[] {
    const found: unknown[] = [];
    if (!this.ok) return found;
    this.text += chunk;
    for (; this.at < this.text.length; this.at++) {
      const c = this.text[this.at];
      if (this.quoted) {
        if (this.escaped) this.escaped = false;
        else if (c === '\\') this.escaped = true;
        else if (c === '"') {
          this.quoted = false;
          if (this.reading === 'key') this.key = this.word;
          else if (this.reading === 'value' && this.key === 'answerable') this.answerable = this.word;
          this.last = c;
          continue;
        }
        if (this.reading !== 'other' && this.word.length < 64) this.word += c;
        continue;
      }
      if (c === '"') {
        this.quoted = true;
        this.word = '';
        // At the top of the answer a string after "{" or "," is a key, after ":" a value.
        this.reading = this.depth === 1 ? (this.last === ':' ? 'value' : 'key') : 'other';
      } else if (c === '{' || c === '[') {
        if (c === '{' && this.depth === 2 && this.key === 'steps') this.begin = this.at;
        this.depth++;
        this.last = c;
      } else if (c === '}' || c === ']') {
        this.depth--;
        if (this.depth < 0) {
          this.ok = false;
          return found;
        }
        if (c === '}' && this.depth === 2 && this.begin >= 0 && this.key === 'steps') {
          try {
            const step: unknown = JSON.parse(this.text.slice(this.begin, this.at + 1));
            this.steps.push(step);
            found.push(step);
          } catch {
            this.ok = false;
            return found;
          }
          this.begin = -1;
        }
        this.last = c;
      } else if (!/\s/.test(c)) this.last = c;
    }
    return found;
  }
}

/** The event for an error the learner should read: the code and words of an HttpError, else a plain failure. */
function failure(error: unknown): Extract<AnswerEvent, { type: 'error' }>['error'] {
  return error instanceof HttpError
    ? { code: error.code, message: error.message, status: error.status }
    : { code: 'answer_failed', message: 'The answer could not be finished. Ask again.', status: 500 };
}

/**
 * Answer a request. A client that sent `Accept: application/x-ndjson` reads the answer as it is written: the response
 * opens with the first finished step (so an error before it still has its own status), carries one line per step, and
 * ends with the whole answer or an error. Anything else, and an answer that had no early step (stored, shared with
 * another request, or too plain to split), is the usual JSON.
 */
export async function answerResponse(
  reply: FastifyReply,
  accept: string | undefined,
  run: () => Promise<AskAnswer>,
): Promise<AskAnswer | FastifyReply> {
  if (!accept?.includes(NDJSON)) return run();
  let out = undefined as PassThrough | undefined;
  const write = (event: AnswerEvent) => {
    if (reply.raw.destroyed) return;
    if (!out) {
      out = new PassThrough();
      void reply.type(`${NDJSON}; charset=utf-8`).header('cache-control', 'no-store').send(out);
    }
    out.write(`${JSON.stringify(event)}\n`);
  };
  try {
    const answer = await withSink(
      (answerable, step, language) => write({ type: 'step', answerable, step, ...(language ? { language } : {}) }),
      run,
    );
    if (!out) return answer;
    write({ type: 'answer', answer });
  } catch (error) {
    if (!out) throw error;
    write({ type: 'error', error: failure(error) });
  }
  out?.end();
  return reply;
}
