import test from 'node:test';
import assert from 'node:assert/strict';
import type { Db } from '../src/db';
import { ReadingSpeechCache, readingCacheKey, type ReadingCacheKey } from '../src/reading-cache';
import type { ReadingPassage } from '../../shared/reading';
const input: ReadingCacheKey = { owner: 'owner', documentId: 'doc', analysisId: 'analysis', sha256: 'abc',
  targetId: 'p1.b1', removeCitations: true, model: 'muse', provider: 'https://example.test', language: 'en-US' };
const result: ReadingPassage = { targetId: input.targetId, speech: 'Actual paper text.', language: 'en-US', actions: [{ type: 'highlight', targets: ['p1.s1'] }] };
function store() {
  const rows = new Map<string, ReadingPassage>();
  const db = { query: async (sql: string, values: any[]) => {
    if (sql.startsWith('select')) return { rows: rows.has(values[0]) ? [{ payload: structuredClone(rows.get(values[0])) }] : [] };
    rows.set(values[0], JSON.parse(values[5])); return { rows: [] };
  } } as unknown as Db;
  return { db, rows };
}

test('validated speech and visual actions survive a fresh cache instance and keys isolate source/options/model/owner', async () => {
  const { db } = store(); let calls = 0;
  const compute = async () => { calls++; return result; };
  await new ReadingSpeechCache(db).serve(input, compute);
  assert.deepEqual(await new ReadingSpeechCache(db).serve(input, compute), result);
  assert.equal(calls, 1);
  for (const changed of [{ owner: 'other' }, { analysisId: 'new' }, { sha256: 'new' }, { targetId: 'new' },
    { removeCitations: false }, { model: 'other' }, { provider: 'other' }, { language: 'de-DE' }])
    assert.notEqual(readingCacheKey({ ...input, ...changed }), readingCacheKey(input));
});

test('concurrent callers share one model call; cancelling one does not cancel the other', async () => {
  const { db } = store(); const cache = new ReadingSpeechCache(db); let calls = 0, done!: (value: ReadingPassage) => void;
  let modelSignal!: AbortSignal;
  const compute = async (signal: AbortSignal) => { modelSignal = signal; calls++; return new Promise<ReadingPassage>((resolve) => { done = resolve; }); };
  const firstStop = new AbortController();
  const first = cache.serve(input, compute, firstStop.signal);
  const second = cache.serve(input, compute);
  await new Promise((resolve) => setImmediate(resolve));
  firstStop.abort(); await assert.rejects(first);
  assert.equal(modelSignal.aborted, false); done(result);
  assert.deepEqual(await second, result); assert.equal(calls, 1);
});

test('failed and cancelled model work is never stored', async () => {
  const { db, rows } = store(); const cache = new ReadingSpeechCache(db);
  await assert.rejects(cache.serve(input, async () => { throw new Error('provider failed'); }));
  assert.equal(rows.size, 0);
  const stop = new AbortController();
  const pending = cache.serve(input, async (signal) => {
    await new Promise<void>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    return result;
  }, stop.signal);
  await new Promise((resolve) => setImmediate(resolve));
  stop.abort(); await assert.rejects(pending); assert.equal(rows.size, 0);
});
