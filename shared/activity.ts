/** Persisted facts and provider output, never inferred model thoughts. */
export interface GenerationEvent {
  id: string;
  type: string;
  at: string;
  data: Record<string, unknown>;
}
export interface GenerationActivity {
  events: GenerationEvent[];
  status: string;
}
export interface ActivityFrame {
  event?: GenerationEvent;
  status?: string;
  error?: string;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
}

/** Latest provider-reported usage per call: completion events never double-count stream usage. */
export function reportedUsage(events: GenerationEvent[]): Map<string, TokenUsage> {
  const calls = new Map<string, TokenUsage>();
  for (const event of events)
    if (['model.usage', 'model.completed', 'model.failed'].includes(event.type) && event.data.usage)
      calls.set(String(event.data.callId), event.data.usage as TokenUsage);
  return calls;
}
