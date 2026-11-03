import type { GenerationEvent } from '../../../shared/activity';

/** A generation may have several attempts. Keep earlier drafts available without mixing them into the current run. */
export function activityEvents(events: GenerationEvent[], includePrevious = false): GenerationEvent[] {
  if (includePrevious) return events;
  const latest = events.map((event) => event.type).lastIndexOf('run.started');
  return latest < 0 ? events : events.slice(latest);
}

/** A terminal request must never look as if its output is still streaming. */
export function modelOutput(events: GenerationEvent[], stopped = false): unknown {
  const completed = events.find((event) => ['model.completed', 'tool.completed'].includes(event.type));
  const failed = events.find((event) => event.type === 'model.failed');
  const output = completed?.data.output ?? failed?.data.output;
  if (output !== undefined && output !== null) return output;
  const draft = events.filter((event) => event.type === 'model.delta').map((event) => String(event.data.delta)).join('');
  if (draft) return draft;
  if (failed) return 'The model request failed before producing any output.';
  if (completed) return 'This request completed without recorded output.';
  return stopped ? 'This request ended without recorded output.' : 'Waiting for model output…';
}
