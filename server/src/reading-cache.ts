import { createHash } from 'node:crypto';
import type { ReadingPassage } from '../../shared/reading';
import type { Db } from './db';

export const READING_VERSION = 'paper-reading@2';
export interface ReadingCacheKey {
  owner: string;
  documentId: string;
  analysisId: string;
  sha256: string;
  targetId: string;
  removeCitations: boolean;
  model: string;
  provider: string;
  language: string;
}
export function readingCacheKey(input: ReadingCacheKey): string {
  return createHash('sha256').update(JSON.stringify([READING_VERSION, input.owner, input.documentId,
    input.analysisId, input.sha256, input.targetId, input.removeCitations, input.model, input.provider, input.language])).digest('hex');
}
interface Flight {
  controller: AbortController;
  promise: Promise<ReadingPassage>;
  users: number;
  settled: boolean;
}

/** Durable validated results plus shared in-flight work. Failed/cancelled readings are never cached. */
export class ReadingSpeechCache {
  private readonly flights = new Map<string, Flight>();
  constructor(private readonly db: Db) {}
  async serve(input: ReadingCacheKey, compute: (signal: AbortSignal) => Promise<ReadingPassage>, signal?: AbortSignal): Promise<ReadingPassage> {
    signal?.throwIfAborted();
    const key = readingCacheKey(input);
    let flight = this.flights.get(key);
    if (!flight) {
      const controller = new AbortController();
      const created: Flight = { controller, users: 0, settled: false, promise: undefined! };
      created.promise = (async () => {
        const { rows: [stored] } = await this.db.query<{ payload: ReadingPassage }>(
          'select payload from reading_speech where cache_key=$1 and owner_id=$2 and document_id=$3', [key, input.owner, input.documentId]);
        controller.signal.throwIfAborted();
        if (stored) return stored.payload;
        const result = await compute(controller.signal);
        controller.signal.throwIfAborted();
        await this.db.query('insert into reading_speech(cache_key,owner_id,document_id,analysis_id,target_id,payload) values($1,$2,$3,$4,$5,$6) on conflict(cache_key) do nothing',
          [key, input.owner, input.documentId, input.analysisId, input.targetId, JSON.stringify(result)]);
        return result;
      })().finally(() => {
        created.settled = true;
        if (this.flights.get(key) === created) this.flights.delete(key);
      });
      this.flights.set(key, created);
      flight = created;
    }
    flight.users++;
    let abort: (() => void) | undefined;
    try {
      const result = await Promise.race([flight.promise, new Promise<never>((_, reject) => {
        if (!signal) return;
        abort = () => reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
        if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
      })]);
      return structuredClone(result);
    } finally {
      if (abort) signal?.removeEventListener('abort', abort);
      if (--flight.users === 0 && !flight.settled) {
        if (this.flights.get(key) === flight) this.flights.delete(key);
        flight.controller.abort();
      }
    }
  }
}
