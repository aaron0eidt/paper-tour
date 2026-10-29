import { ProcessingError } from '../errors';
import type { AgentResponse, ResponseItem } from './responses';

/** Replay only model messages and tool protocol items, never provider-private reasoning or IDs. */
export function replayOutput(response: AgentResponse): ResponseItem[] {
  return response.output.flatMap((item): ResponseItem[] => {
    if (item.type === 'function_call')
      return [{ type: 'function_call', call_id: item.call_id, name: item.name, arguments: item.arguments }];
    if (item.type === 'message' && Array.isArray(item.content))
      return [
        {
          type: 'message',
          role: 'assistant',
          content: item.content
            .filter((part: any) => part.type === 'output_text' && typeof part.text === 'string')
            .map((part: any) => ({ type: 'output_text', text: part.text })),
        },
      ];
    return [];
  });
}

/** Reconstruct from committed local records. A model call is never reissued to rebuild history. */
export function replayHistory(
  source: ResponseItem[],
  steps: { response: AgentResponse }[],
  results: Map<string, ResponseItem>,
): ResponseItem[] {
  const input = [...source];
  for (const step of steps) {
    input.push(...replayOutput(step.response));
    for (const call of step.response.output.filter((item) => item.type === 'function_call')) {
      const result = results.get(String(call.call_id));
      if (!result)
        throw new ProcessingError(
          'history_incomplete',
          'A saved tool result is missing. Resume after repairing the local checkpoint.',
        );
      input.push(result);
    }
  }
  return input;
}

/** Only omit checkpoint bodies when this replay actually contains every saved artifact. */
export function historyCoversCheckpoint(
  state: { chapters: Record<string, unknown>; observations: Record<string, unknown> },
  steps: { response: AgentResponse }[],
  results: Map<string, ResponseItem>,
): boolean {
  const chapters = new Set<string>(),
    observations = new Set<string>();
  for (const { response } of steps)
    for (const call of response.output.filter((item) => item.type === 'function_call')) {
      const result = results.get(String(call.call_id));
      if (!Array.isArray(result?.output)) continue;
      for (const part of result.output as { type: string; text?: string }[]) {
        if (part.type !== 'input_text' || !part.text) continue;
        try {
          const data = JSON.parse(part.text);
          if (data.error) continue;
          if (call.name === 'upsert_tour_chapter' && typeof data.chapterId === 'string') chapters.add(data.chapterId);
          if (call.name === 'record_visual_observations' && Array.isArray(data.recorded))
            for (const id of data.recorded) if (typeof id === 'string') observations.add(id);
        } catch {
          /* malformed outputs cannot prove checkpoint coverage */
        }
      }
    }
  return (
    Object.keys(state.chapters).every((id) => chapters.has(id)) &&
    Object.keys(state.observations).every((id) => observations.has(id))
  );
}
