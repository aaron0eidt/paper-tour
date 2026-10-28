import type { GenerationEvent } from './activity';

const number = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

/** Replayed SSE events and usage updates must not count as additional work. */
export function uniqueGenerationEvents(events: GenerationEvent[]): GenerationEvent[] {
  return [...new Map(events.map((event) => [event.id, event])).values()];
}

export function generationDiagnostics(input: GenerationEvent[], status = '', now = Date.now()) {
  let events = uniqueGenerationEvents(input);
  const attempt = events.map((event) => event.type).lastIndexOf('run.started');
  if (attempt >= 0) events = events.slice(attempt);
  const directionEvent = [...events].reverse().find((event) => event.type === 'tour.direction');
  const direction = directionEvent
    ? {
        steps: number(directionEvent.data.steps),
        words: number(directionEvent.data.words),
        actions: Object.entries(object(directionEvent.data.actions))
          .filter((entry): entry is [string, number] => number(entry[1]) !== undefined && Number.isInteger(entry[1]))
          .map(([name, count]) => ({ name, count })),
      }
    : undefined;
  const starts = new Map<string, GenerationEvent>();
  const ends = new Map<string, GenerationEvent>();
  const firstOutputs = new Map<string, number>();
  for (const event of events) {
    if (!event.data.callId) continue;
    const id = String(event.data.callId);
    if (['model.started', 'tool.started'].includes(event.type) && !starts.has(id)) starts.set(id, event);
    if (
      event.type === 'model.delta' &&
      typeof event.data.delta === 'string' &&
      event.data.delta.length &&
      !firstOutputs.has(id)
    ) {
      firstOutputs.set(id, Date.parse(event.at));
    }
    if (['model.completed', 'model.failed', 'tool.completed'].includes(event.type)) ends.set(id, event);
  }
  const firstModelAt = Math.min(
    ...[...starts.values()]
      .filter((event) => event.type === 'model.started')
      .map((event) => Date.parse(event.at))
      .filter(Number.isFinite),
  );
  const lastCompletedAt = Math.max(...[...ends.values()].map((event) => Date.parse(event.at)).filter(Number.isFinite));
  const live = ['queued', 'running', 'generating', 'pausing'].includes(status);
  const elapsedMs = Number.isFinite(firstModelAt) ? number((live ? now : lastCompletedAt) - firstModelAt) : undefined;
  let modelMs = 0,
    toolMs = 0,
    timedModels = 0,
    timedTools = 0,
    failedCalls = 0;
  let modelCalls = 0,
    toolCalls = 0;
  const outputDelays: number[] = [];
  const slowest: { callId: string; name: string; durationMs: number }[] = [];
  const phases = new Map<string, number>();
  const queueWaitMs = events
    .filter((event) => event.type === 'turn.started')
    .reduce((sum, event) => sum + (number(event.data.queueWaitMs) ?? 0), 0);
  if (queueWaitMs > 0) phases.set('Waiting in queue', queueWaitMs);
  for (const [id, start] of starts) {
    const model = start.type === 'model.started';
    if (model) modelCalls++;
    else toolCalls++;
    const end = ends.get(id);
    if (!end) continue;
    if (end.type === 'model.failed' || object(end.data.output).error) failedCalls++;
    const duration = number(end.data.durationMs) ?? number(Date.parse(end.at) - Date.parse(start.at));
    if (duration !== undefined) {
      if (model) {
        modelMs += duration;
        timedModels++;
      } else {
        toolMs += duration;
        timedTools++;
      }
      slowest.push({
        callId: id,
        name: String(start.data.name ?? (model ? 'Model call' : 'Document tool')).replaceAll('_', ' '),
        durationMs: duration,
      });
    }
    if (model) {
      const timing = object(end.data.timing);
      for (const [key, label] of [
        ['preparationMs', 'Preparing requests'],
        ['inferenceMs', 'Waiting for model responses'],
      ] as const) {
        const measured = number(timing[key]);
        if (measured !== undefined) phases.set(label, (phases.get(label) ?? 0) + measured);
      }
      const first = number(timing.firstOutputMs) ?? number((firstOutputs.get(id) ?? NaN) - Date.parse(start.at));
      if (first !== undefined) outputDelays.push(first);
    }
  }
  outputDelays.sort((a, b) => a - b);
  const middle = Math.floor(outputDelays.length / 2);
  const medianFirstOutputMs = outputDelays.length
    ? outputDelays.length % 2
      ? outputDelays[middle]
      : (outputDelays[middle - 1] + outputDelays[middle]) / 2
    : undefined;
  slowest.sort((a, b) => b.durationMs - a.durationMs);
  const total = modelMs + toolMs;
  const explanation =
    !timedModels && !timedTools
      ? 'Timing appears after the first completed action.'
      : total > 0 && modelMs / total >= 0.8
        ? 'Most recorded call time is in model requests. Repeated reads or rejected drafts add more model round trips.'
        : 'Compare the slowest actions below to locate the delay. Call durations can overlap and exclude pauses.';
  return {
    modelCalls,
    toolCalls,
    failedCalls,
    modelMs,
    toolMs,
    timedModels,
    timedTools,
    medianFirstOutputMs,
    phases: [...phases].map(([label, durationMs]) => ({ label, durationMs })),
    slowest: slowest.slice(0, 3),
    explanation,
    direction,
    elapsedMs,
  };
}
