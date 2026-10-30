import type { GenerationEvent } from '../../../shared/activity';

/** A generation may have several attempts. Keep earlier drafts available without mixing them into the current run. */
export function activityEvents(events: GenerationEvent[], includePrevious = false): GenerationEvent[] {
  if (includePrevious) return events;
  const latest = events.map((event) => event.type).lastIndexOf('run.started');
  return latest < 0 ? events : events.slice(latest);
}
