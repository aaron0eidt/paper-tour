import { generateText, streamText, Output, jsonSchema } from 'ai';
import { ProcessingError } from '../errors';
import type { MuseConfig } from '../config';
import {
  modelBaseUrl,
  museChatModel,
  sdkMessages,
  sdkSchema,
  modelUsage,
  modelError,
  modelTelemetry,
} from '../ai/provider';
export { providerFailureReason } from '../ai/provider';

/** How much the model reasons before it answers; `minimal` is the provider's lowest setting, below `low`. */
export type Effort = 'minimal' | 'low' | 'medium' | 'high';
export type MuseContent = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
export interface MuseMessage {
  role: 'developer' | 'user' | 'assistant';
  content: string | MuseContent[];
}
export interface ModelUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedInputTokens?: number;
}
export interface Completion {
  value: unknown;
  usage: ModelUsage;
  requestId: string | null;
}

/** Application compatibility boundary; Vercel AI SDK owns generation and stream parsing. */
export class MuseClient {
  constructor(
    private readonly config: MuseConfig,
    private readonly transport: typeof fetch = fetch,
  ) {
    modelBaseUrl(config);
  }
  async complete(
    messages: MuseMessage[],
    name: string,
    schema: object,
    maxTokens: number,
    signal?: AbortSignal,
    onDelta?: (text: string) => Promise<void>,
    onUsage?: (usage: ModelUsage) => Promise<void>,
    effort: Effort = 'medium',
    onNarration?: (text: string) => Promise<void>,
  ): Promise<Completion> {
    if (!this.config.apiKey.trim())
      throw new ProcessingError('muse_not_configured', 'Connect Meta in Profile & Settings.');
    const abort = AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(signal ? [signal] : [])]);
    const options = {
      model: museChatModel(this.config, this.transport),
      instructions:
        messages
          .filter((m) => m.role === 'developer')
          .map((m) =>
            typeof m.content === 'string'
              ? m.content
              : m.content
                  .filter((p) => p.type === 'text')
                  .map((p) => p.text)
                  .join('\n'),
          )
          .join('\n') || undefined,
      messages: sdkMessages(messages.filter((m) => m.role !== 'developer')),
      output: Output.object({ schema: jsonSchema(sdkSchema(schema)), name }),
      maxOutputTokens: maxTokens,
      providerOptions: { muse: { reasoningEffort: effort, strictJsonSchema: false } },
      abortSignal: abort,
      maxRetries: 0,
      telemetry: await modelTelemetry(name),
    };
    try {
      const result =
        onDelta || onNarration ? streamText({ ...options, onError: () => {} }) : await generateText(options);
      if ('stream' in result) {
        // SDK parses incomplete structured output. Only the public `say` field
        // becomes a narration snapshot; raw JSON remains in technical activity.
        const narration = async () => {
          if (!onNarration) return;
          let sent = '',
            latest = '',
            last = 0;
          for await (const partial of result.partialOutputStream) {
            const value = partial as { say?: unknown } | undefined;
            if (typeof value?.say !== 'string' || value.say === sent) continue;
            latest = value.say;
            if (Date.now() - last >= 250) {
              await onNarration(latest);
              sent = latest;
              last = Date.now();
            }
          }
          if (latest !== sent) await onNarration(latest);
        };
        const diagnostics = async () => {
          let pending = '',
            length = 0,
            lastFlush = Date.now();
          for await (const part of result.stream) {
            if (part.type === 'text-delta') {
              length += part.text.length;
              if (length > 2_000_000)
                throw new ProcessingError('muse_invalid_response', 'The model response is too large.');
              pending += part.text;
              if (pending.length >= 4096 || Date.now() - lastFlush >= 500) {
                await onDelta?.(pending);
                pending = '';
                lastFlush = Date.now();
              }
            }
            if (part.type === 'error') throw part.error;
          }
          if (pending) await onDelta?.(pending);
        };
        await Promise.all([diagnostics(), narration()]);
      }
      if ((await result.text).length > 2_000_000)
        throw new ProcessingError('muse_invalid_response', 'The model response is too large.');
      const finish = await result.finishReason;
      if (finish === 'length')
        throw new ProcessingError('muse_output_truncated', 'The model reached its output budget.');
      if (finish === 'content-filter') throw new ProcessingError('muse_refused', 'The model declined this request.');
      const value = await result.output;
      const usage = modelUsage(await result.totalUsage);
      await onUsage?.(usage);
      return { value, usage, requestId: (await result.response).headers?.['x-request-id']?.slice(0, 200) ?? null };
    } catch (error) {
      throw modelError(error, abort);
    }
  }
}
