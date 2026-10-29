import { randomUUID } from 'node:crypto';
import { ProcessingError } from '../errors';
import type { TourGenerationInput } from '../tour-generator';
import { MuseClient, type Completion, type MuseMessage } from '../muse/client';
import { imageEvidence } from '../muse/context';
export type Effort = 'low' | 'medium' | 'high';

/** A model call that records its real inputs and output as activity events; images are logged by hash only. */
export function recordedCalls(client: MuseClient, input: TourGenerationInput, model: string, promptVersion: string) {
  const completions: Completion[] = [];
  const call = async (
    messages: MuseMessage[],
    name: string,
    schema: object,
    maxTokens: number,
    effort: Effort,
    signal: AbortSignal,
    task?: { id: string; label: string },
  ): Promise<Completion> => {
    const callId = randomUUID(),
      started = Date.now();
    const publicMessages = messages.map((message) => ({
      ...message,
      content:
        typeof message.content === 'string'
          ? message.content
          : message.content.map((part, index, parts) => {
              if (part.type === 'text') return part;
              const previous = parts[index - 1];
              const id = previous?.type === 'text' ? /^Visual source ([^;]+);/.exec(previous.text)?.[1] : undefined;
              const source = input.images.find((image) => image.targetId === id);
              return { type: 'image', ...(source ? { ...imageEvidence(source), label: source.label } : {}) };
            }),
    }));
    await input.onEvent?.('model.started', {
      callId,
      name,
      model,
      promptVersion,
      messages: publicMessages,
      responseSchema: schema,
      maxTokens,
      reasoningEffort: effort,
      ...(task ? { task } : {}),
    });
    try {
      const completion = await client.complete(
        messages,
        name,
        schema,
        maxTokens,
        signal,
        input.onEvent ? async (delta) => input.onEvent!('model.delta', { callId, delta }) : undefined,
        input.onEvent ? async (usage) => input.onEvent!('model.usage', { callId, usage }) : undefined,
        effort,
        input.onEvent ? async (text) => input.onEvent!('model.narration', { callId, text }) : undefined,
      );
      completions.push(completion);
      await input.onEvent?.('model.completed', {
        callId,
        output: completion.value,
        usage: completion.usage,
        requestId: completion.requestId,
        durationMs: Date.now() - started,
      });
      return completion;
    } catch (error) {
      await input.onEvent?.('model.failed', {
        callId,
        code: error instanceof ProcessingError ? error.code : 'model_error',
        durationMs: Date.now() - started,
      });
      throw error;
    }
  };
  return { call, completions };
}
