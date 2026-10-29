import type { Telemetry } from 'ai';

const COUNTERS = [
  'inputTokens',
  'outputTokens',
  'totalTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
  'textTokens',
  'reasoningTokens',
  'noCacheTokens',
];
function usageMetadata(value: unknown): object | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const result: Record<string, number | object | undefined> = {};
  for (const [key, count] of Object.entries(value)) {
    if (COUNTERS.includes(key) && typeof count === 'number') result[key] = count;
    if (['inputTokenDetails', 'outputTokenDetails'].includes(key)) result[key] = usageMetadata(count);
  }
  return result;
}

/** DevTools currently receives full lifecycle events even with recordInputs/Outputs=false.
 * Pass an allowlist of timings, identifiers and counters, never document/tool payloads.
 */
export function metadataOnlyTelemetry(integration: Telemetry): Telemetry {
  const metadata = (value: unknown) => {
    const event = (value ?? {}) as Record<string, unknown>;
    const response = (event.response ?? {}) as Record<string, unknown>;
    return {
      ...Object.fromEntries(
        [
          'callId',
          'operationId',
          'functionId',
          'modelId',
          'provider',
          'stepNumber',
          'maxOutputTokens',
          'temperature',
          'topP',
          'topK',
          'presencePenalty',
          'frequencyPenalty',
          'seed',
          'finishReason',
        ]
          .filter((key) => event[key] !== undefined)
          .map((key) => [key, event[key]]),
      ),
      steps: Array.from({ length: Array.isArray(event.steps) ? event.steps.length : 0 }, () => ({})),
      usage: usageMetadata(event.usage),
      content: [],
      response: { id: response.id, modelId: response.modelId, timestamp: response.timestamp, messages: [] },
      ...(event.error ? { error: new Error('Model request failed') } : {}),
    };
  };
  return Object.fromEntries(
    Object.entries(integration)
      .filter(([key, handler]) => key.startsWith('on') && typeof handler === 'function')
      .map(([key, handler]) => [key, (event: unknown) => handler(metadata(event))]),
  ) as Telemetry;
}
