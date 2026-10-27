import { randomUUID } from 'node:crypto';
import { ProcessingError } from '../errors';
import type { TourGenerationInput, TourImage } from '../tour-generator';
import { MuseClient, type Completion, type MuseContent, type MuseMessage } from '../muse/client';
import { imageEvidence } from '../muse/context';
import { HARNESS_VERSION } from './prompts';

export type Effort = 'low' | 'medium' | 'high';

/** Image parts in the convention the activity log understands: "Visual source <id>; <label>" before each image. */
export function imageParts(images: TourImage[]): MuseContent[] {
  return images.flatMap((image) => [
    { type: 'text' as const, text: `Visual source ${image.targetId}; ${image.label}, page ${image.page}.` },
    { type: 'image_url' as const, image_url: { url: image.dataUrl } },
  ]);
}

/** A model call that records its real inputs and output as activity events; images are logged by hash only. */
export function recordedCalls(client: MuseClient, input: TourGenerationInput, model: string) {
  const completions: Completion[] = [];
  const call = async (
    messages: MuseMessage[],
    name: string,
    schema: object,
    maxTokens: number,
    effort: Effort,
    signal: AbortSignal,
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
      promptVersion: HARNESS_VERSION,
      messages: publicMessages,
      responseSchema: schema,
      maxTokens,
      reasoningEffort: effort,
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

/** Run tasks with at most `limit` in flight; results keep the input order. */
export async function pool<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index], index);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
