import { sseData } from '../../../shared/sse';
import { ProcessingError } from '../errors';
import type { MuseConfig } from '../config';

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

/** Classify provider failures without retaining their potentially echoed request data. */
export async function providerFailureReason(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return 'request_rejected';
  let text = '';
  const decoder = new TextDecoder();
  try {
    while (text.length < 8192) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true }).slice(0, 8192 - text.length);
    }
    if (/json schema.*(?:maximum nesting|nesting depth)/is.test(text)) return 'schema_nesting_depth';
    if (/json schema.*(?:total enum|enum values|enum properties)/is.test(text)) return 'schema_enum_budget';
    if (/(?:invalid json schema|invalid schema|schema validation)/i.test(text)) return 'invalid_schema';
    if (/(?:context length|context window|too many tokens)/i.test(text)) return 'context_length';
    if (/(?:model not found|unknown model|model does not exist)/i.test(text)) return 'unknown_model';
    return 'request_rejected';
  } catch {
    return 'request_rejected';
  } finally {
    await reader.cancel().catch(() => undefined);
  }
}

/** The provider boundary: no application state, tool execution or persistence lives here. */
export class MuseClient {
  private readonly endpoint: string;
  constructor(
    private readonly config: MuseConfig,
    private readonly transport: typeof fetch = fetch,
  ) {
    let url: URL;
    try {
      url = new URL(config.baseUrl);
    } catch {
      throw new ProcessingError('muse_not_configured', 'The Muse API address is invalid.');
    }
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    ) {
      throw new ProcessingError('muse_not_configured', 'Muse requires a secure API connection.');
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new ProcessingError(
        'muse_not_configured',
        'The Muse API address must not contain credentials or query parameters.',
      );
    }
    this.endpoint = `${url.href.replace(/\/$/, '')}/chat/completions`;
  }

  private async stream(
    response: Response,
    onDelta: (text: string) => Promise<void>,
    onUsage?: (usage: ModelUsage) => Promise<void>,
  ): Promise<string> {
    if (!response.body) throw new Error('Missing response stream');
    let content = '',
      pending = '',
      lastFlush = Date.now(),
      ended = false;
    let finish: string | undefined,
      usage: unknown,
      refusal = false;
    try {
      for await (const data of sseData(response.body)) {
        if (data === '[DONE]') {
          ended = true;
          break;
        }
        const chunk = JSON.parse(data);
        if (chunk.error) throw new Error('Provider stream error');
        const choice = chunk.choices?.[0];
        if (choice?.delta?.refusal) refusal = true;
        if (typeof choice?.delta?.content === 'string') {
          const delta = choice.delta.content;
          content += delta;
          pending += delta;
          if (content.length > 2_000_000) throw new Error('Oversized response');
          if (pending.length >= 4096 || Date.now() - lastFlush >= 500) {
            await onDelta(pending);
            pending = '';
            lastFlush = Date.now();
          }
        }
        if (choice?.finish_reason) finish = choice.finish_reason;
        if (chunk.usage) {
          usage = chunk.usage;
          const count = (n: unknown) => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0);
          await onUsage?.({
            promptTokens: count(chunk.usage.prompt_tokens),
            completionTokens: count(chunk.usage.completion_tokens),
            totalTokens: count(chunk.usage.total_tokens),
            ...(typeof chunk.usage.prompt_tokens_details?.cached_tokens === 'number'
              ? {
                  cachedInputTokens: Math.min(
                    count(chunk.usage.prompt_tokens_details.cached_tokens),
                    count(chunk.usage.prompt_tokens),
                  ),
                }
              : {}),
          });
        }
      }
    } finally {
      if (pending) await onDelta(pending);
    }
    if ((!ended && finish !== 'length') || !finish) throw new Error('Interrupted response stream');
    return JSON.stringify({
      choices: [{ finish_reason: finish, message: { content, ...(refusal ? { refusal: true } : {}) } }],
      usage,
    });
  }

  async complete(
    messages: MuseMessage[],
    name: string,
    schema: object,
    maxTokens: number,
    signal?: AbortSignal,
    onDelta?: (text: string) => Promise<void>,
    onUsage?: (usage: ModelUsage) => Promise<void>,
    effort: 'low' | 'medium' | 'high' = 'medium',
  ): Promise<Completion> {
    if (!this.config.apiKey.trim())
      throw new ProcessingError('muse_not_configured', 'Tour creation needs a Muse API key on the server.');
    const abort = AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(signal ? [signal] : [])]);
    let response: Response;
    try {
      response = await this.transport(this.endpoint, {
        method: 'POST',
        redirect: 'error',
        signal: abort,
        headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.model,
          ...(onDelta ? { stream: true, stream_options: { include_usage: true } } : {}),
          reasoning_effort: effort,
          messages,
          max_tokens: maxTokens,
          response_format: { type: 'json_schema', json_schema: { name, strict: false, schema } },
        }),
      });
    } catch {
      if (abort.aborted)
        throw new ProcessingError('muse_timeout', 'Muse took too long to respond. Please retry the tour.', true);
      throw new ProcessingError('muse_network_error', 'Muse could not be reached. Please retry the tour.', true);
    }
    // Provider errors can echo request contents. Never forward their response body or API key.
    if (response.status === 401 || response.status === 403)
      throw new ProcessingError(
        'muse_auth_failed',
        'The Muse API key was not accepted. Check the server configuration.',
      );
    if (response.status === 429)
      throw new ProcessingError(
        'muse_rate_limited',
        'Muse is busy or its usage limit was reached. The tour will be retried.',
        true,
      );
    if (response.status >= 500)
      throw new ProcessingError('muse_unavailable', 'Muse is temporarily unavailable. The tour will be retried.', true);
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          event: 'model_request_rejected',
          status: response.status,
          schema: name,
          reason: await providerFailureReason(response),
        }),
      );
      throw new ProcessingError(
        'muse_request_rejected',
        'Muse could not process this paper. Check the model configuration and retry.',
      );
    }
    let payload: {
      choices?: { finish_reason?: string; message?: { content?: unknown; refusal?: unknown } }[];
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: { cached_tokens?: number };
      };
    };
    try {
      const raw =
        onDelta && response.headers.get('content-type')?.includes('text/event-stream')
          ? await this.stream(response, onDelta, onUsage)
          : await response.text();
      if (raw.length > 2_000_000) throw new Error('oversized');
      payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.choices))
        throw new Error('invalid envelope');
    } catch {
      if (abort.aborted)
        throw new ProcessingError('muse_timeout', 'Muse took too long to respond. Please retry the tour.', true);
      throw new ProcessingError(
        'muse_invalid_response',
        'Muse returned an unreadable response. Please retry the tour.',
      );
    }
    const choice = payload.choices?.[0];
    if (choice?.finish_reason === 'length')
      throw new ProcessingError('muse_output_truncated', 'Muse could not finish the tour within its output limit.');
    if (choice?.message?.refusal || choice?.finish_reason === 'content_filter')
      throw new ProcessingError('muse_refused', 'Muse could not create a tour for this document.');
    if (typeof choice?.message?.content !== 'string' || !choice.message.content.trim())
      throw new ProcessingError('muse_invalid_response', 'Muse returned no tour content.');
    let value: unknown;
    try {
      value = JSON.parse(choice.message.content);
    } catch {
      throw new ProcessingError('muse_invalid_response', 'Muse returned an invalid structured response.');
    }
    const count = (n: unknown) => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0);
    return {
      value,
      usage: {
        promptTokens: count(payload.usage?.prompt_tokens),
        completionTokens: count(payload.usage?.completion_tokens),
        totalTokens: count(payload.usage?.total_tokens),
        ...(typeof payload.usage?.prompt_tokens_details?.cached_tokens === 'number'
          ? {
              cachedInputTokens: Math.min(
                count(payload.usage.prompt_tokens_details.cached_tokens),
                count(payload.usage.prompt_tokens),
              ),
            }
          : {}),
      },
      requestId: response.headers.get('x-request-id')?.slice(0, 200) ?? null,
    };
  }
}
