import { ReadingPreparation } from '../src/readingPreparation';
import type { Step } from '../src/types';
import type { ReadingPassage } from '../../shared/reading';
import type { ProgramItem } from '../../shared/program';
import { prepareReadingVisuals, preparedProgramFrame } from '../src/visuals/preparation';
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
bad.plan(a, [b, c], true); await flush(); eq(failures, 1);
bad.plan(a, [b, c], true); await flush(); eq(failures, 1); // An outage stops the queue, not one failed call per unit.
await bad.get(b, new AbortController().signal).catch(() => undefined); await flush(); eq(failures, 2);
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

// Entering reading mode prepares the current passage and then the whole remaining queue without word callbacks.
const ahead: string[] = [];
const full = new ReadingPreparation(async (s): Promise<ReadingPassage> => {
  ahead.push(s.id);
  return { ...result(s.id), actions: [{ type: 'board', item: { kind: 'bars', title: 'Prepared comparison',
    bars: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] } }] };
});
const remaining = Array.from({ length: 8 }, (_, i) => step(`next-${i}`));
full.plan(a, remaining, true);
for (let i = 0; i < 10; i++) await flush();
eq(ahead, ['a', ...remaining.map((s) => s.id)]);
const preparedVisual = await full.get(remaining[6], new AbortController().signal);
eq(preparedVisual.actions?.[0].type, 'board');
eq(ahead.length, 9);
full.dispose();

// Seeking backwards prioritizes an uncached current passage over a distant background request.
const priorityCalls: { id: string; signal: AbortSignal }[] = [];
const priority = new ReadingPreparation(async (s, signal) => {
  priorityCalls.push({ id: s.id, signal });
  return new Promise<ReadingPassage>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
});
priority.plan(c, [], true); await flush();
priority.plan(a, [b, c], true); await flush();
eq(priorityCalls.map((r) => r.id), ['c', 'a']);
eq(priorityCalls[0].signal.aborted, true);
priority.dispose();

const isolatedCalls: string[] = [];
const isolated = new ReadingPreparation(async (s) => {
  isolatedCalls.push(s.id);
  if (s.id === 'b') throw new Error('Bad content in one passage');
  return result(s.id);
}, () => false);
isolated.plan(a, [b, c], true); for (let i = 0; i < 4; i++) await flush();
eq(isolatedCalls, ['a', 'b', 'c']);
isolated.plan(a, [b, c], true); await flush(); eq(isolatedCalls, ['a', 'b', 'c']);
isolated.dispose();
let consecutive = 0;
const repeatedFailure = new ReadingPreparation(async () => { consecutive++; throw new Error('Repeated bad output'); }, () => false);
repeatedFailure.plan(a, [b, c], true); await flush(); eq(consecutive, 2);
repeatedFailure.dispose();

// Authored scenes render a cancellable preview ahead of playback and reuse it for an identical scene.
const originalWorker = globalThis.Worker;
let workers = 0, terminated = 0, respond = true;
class PreviewWorker {
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  constructor() { workers++; }
  postMessage(value: { t: number }) {
    eq(value.t, 0);
    if (respond) queueMicrotask(() => this.onmessage?.({ data: { frame: { svg: '<svg></svg>' } } }));
  }
  terminate() { terminated++; }
}
globalThis.Worker = PreviewWorker as unknown as typeof Worker;
try {
  const item: ProgramItem = { kind: 'program', code: '() => "<svg></svg>"', parameters: [], data: [],
    source: 'illustrative', sourceRefs: [], objective: 'Preview test' };
  const visual: ReadingPassage = { ...result('visual'), actions: [{ type: 'board', item }] };
  await prepareReadingVisuals(visual, new AbortController().signal);
  eq(preparedProgramFrame(structuredClone(item)), 'data:image/svg+xml;charset=utf-8,%3Csvg%3E%3C%2Fsvg%3E');
  await prepareReadingVisuals(structuredClone(visual), new AbortController().signal);
  eq(workers, 1); eq(terminated, 1);
  respond = false;
  const cancelled = new AbortController();
  const other = { ...item, objective: 'Cancelled preview' };
  const pending = prepareReadingVisuals({ ...result('other'), actions: [{ type: 'board', item: other }] }, cancelled.signal);
  await flush(); cancelled.abort();
  await pending.catch(() => undefined);
  eq(terminated, 2); eq(preparedProgramFrame(other), undefined);
} finally { globalThis.Worker = originalWorker; }
console.log('Reading ahead: mode-entry preparation, complete queue, visual previews and foreground priority passed');
