import { ReadingPreparation } from '../src/readingPreparation';
import type { Step } from '../src/types';
import type { ReadingPassage } from '../../shared/reading';
const eq = (a: unknown, b: unknown) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`); };
const step = (id: string): Step => ({ id, say: id, actions: [] });
const result = (id: string): ReadingPassage => ({ targetId: id, speech: `Prepared ${id}`, language: 'en-US' });
const flush = async () => { for (let i = 0; i < 16; i++) await Promise.resolve(); };
const calls: { id: string; signal: AbortSignal; resolve(value: ReadingPassage): void }[] = [];
const loader = new ReadingPreparation((s, signal) => new Promise((resolve, reject) => {
  calls.push({ id: s.id, signal, resolve });
  signal.addEventListener('abort', () => reject(signal.reason), { once: true });
}));
const a = step('a'), b = step('b'), c = step('c');
loader.plan(a, [b, c], false);
const first = loader.get(a, new AbortController().signal);
await flush(); eq(calls.map((r) => r.id), ['a']);
calls[0].resolve(result('a')); await first;
loader.plan(a, [b, c], true); await flush(); eq(calls.map((r) => r.id), ['a', 'b']);
// The camera is moving to b; don't cancel the prefetched request before foreground joins it.
loader.plan(b, [c], false);
const joined = loader.get(b, new AbortController().signal); await flush();
eq(calls.length, 2); eq(calls[1].signal.aborted, false);
calls[1].resolve(result('b')); await joined;
loader.plan(b, [c], true); await flush(); eq(calls.map((r) => r.id), ['a', 'b', 'c']);
loader.plan(null, [], false); await flush(); eq(calls[2].signal.aborted, true);
eq((await loader.get(b, new AbortController().signal)).speech, 'Prepared b'); eq(calls.length, 3);
loader.dispose(); loader.activate();
eq((await loader.get(b, new AbortController().signal)).speech, 'Prepared b');
loader.dispose();

let failures = 0;
const bad = new ReadingPreparation(async () => { failures++; throw new Error('Provider unavailable'); });
bad.plan(a, [b, c], true); await flush(); eq(failures, 2);
bad.plan(a, [b, c], true); await flush(); eq(failures, 2); // Background errors do not loop.
await bad.get(b, new AbortController().signal).catch(() => undefined); await flush(); eq(failures, 3);
bad.dispose();
console.log('Reading lookahead: shared flights, natural handoff, cancellation, caching, StrictMode and no retry loops passed');

// Effect replay must reactivate new background work, not only serve old cache entries.
const replayCalls: AbortSignal[] = [];
const replay = new ReadingPreparation(async (_step, signal) => {
  replayCalls.push(signal);
  return new Promise<ReadingPassage>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
});
replay.plan(a, [b], true); await flush(); replay.dispose(); await flush();
replay.activate(); replay.plan(a, [c], true); await flush();
eq(replayCalls.length, 2); eq(replayCalls[1].aborted, false);
replay.dispose(); await flush(); eq(replayCalls[1].aborted, true);
