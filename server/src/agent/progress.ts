import type { RunState } from './tools';
import type { ResponseItem } from './responses';

function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, v]) => JSON.stringify(key) + ':' + canonical(v))
        .join(',') +
      '}'
    );
  return JSON.stringify(value) ?? 'null';
}
const artifacts = (state: RunState) =>
  canonical({
    title: state.title,
    plan: state.plan,
    observations: state.observations,
    chapters: state.chapters,
    presented: state.presented,
    delivered: state.delivered,
  });

/** Detect repeated ineffective actions, rather than placing a limit on productive turns. */
export function checkProgress(before: RunState, after: RunState, calls: ResponseItem[], failed: Set<string>) {
  if (artifacts(before) !== artifacts(after)) return { counts: {}, repeated: [] as string[] };
  const counts = { ...before.loopWatch };
  const actions = calls.length
    ? calls.map((call) => {
        let args: unknown;
        try {
          args = JSON.parse(String(call.arguments));
        } catch {
          args = String(call.arguments);
        }
        const name = String(call.name);
        return { key: failed.has(String(call.call_id)) ? `rejected:${name}` : `${name}:${canonical(args)}`, name };
      })
    : [{ key: 'no_actions', name: 'a response without a tool action' }];
  const repeated: string[] = [];
  for (const { key, name } of new Map(actions.map((action) => [action.key, action])).values()) {
    counts[key] = (counts[key] ?? 0) + 1;
    if (counts[key] >= 3) repeated.push(name);
  }
  // Keep only recent signatures; the guard is a checkpoint, not an ever-growing transcript.
  return { counts: Object.fromEntries(Object.entries(counts).slice(-12)), repeated };
}
