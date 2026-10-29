import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createOpenAI } from '@ai-sdk/openai';
import { APICallError, type LanguageModelUsage, type ModelMessage, type JSONSchema7 } from 'ai';
import type { MuseConfig } from '../config';
import { ProcessingError } from '../errors';
import type { ModelUsage, MuseMessage } from '../muse/client';
import { metadataOnlyTelemetry } from './telemetry';

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

/** No redirect-following or provider error bodies at the application boundary. */
export function modelBaseUrl(config: MuseConfig): string {
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new ProcessingError('muse_not_configured', 'The Muse API address is invalid.');
  }
  if (
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new ProcessingError('muse_not_configured', 'The Muse API address is invalid.');
  return url.href.replace(/\/$/, '');
}

export function providerFetch(transport: typeof fetch): typeof fetch {
  return async (url, init) => {
    const response = await transport(url, { ...init, redirect: 'error' });
    if (response.ok) {
      // Some compatible endpoints return a completed JSON response even when
      // streaming was requested. Adapt that envelope; SDK still parses the stream.
      if (
        !String(url).endsWith('/chat/completions') ||
        response.headers.get('content-type')?.includes('text/event-stream')
      )
        return response;
      let payload: {
        choices?: { message?: { content?: string; refusal?: unknown }; finish_reason?: string }[];
        usage?: unknown;
      };
      try {
        payload = await response.clone().json();
      } catch {
        return response;
      }
      if (payload.choices?.some((choice) => choice.message?.refusal))
        throw new ProcessingError('muse_refused', 'The model declined this request.');
      const request = typeof init?.body === 'string' ? JSON.parse(init.body) : {};
      if (!request.stream || !Array.isArray(payload.choices)) return response;
      const wire = `data: ${JSON.stringify({ ...payload, choices: payload.choices.map((choice) => ({ ...choice, delta: choice.message })) })}\n\ndata: [DONE]\n\n`;
      const headers = new Headers(response.headers);
      headers.set('content-type', 'text/event-stream');
      return new Response(wire, { status: response.status, headers });
    }
    const status = response.status;
    if (status === 401 || status === 403)
      throw new ProcessingError('muse_auth_failed', 'The Meta connection was not accepted.');
    if (status === 429) throw new ProcessingError('muse_rate_limited', 'The model is busy. Please retry.', true);
    if (status >= 500) throw new ProcessingError('muse_unavailable', 'The model is temporarily unavailable.', true);
    const reason = await providerFailureReason(response);
    console.warn(JSON.stringify({ event: 'model_request_rejected', status, reason }));
    throw new ProcessingError('muse_request_rejected', 'The model could not process this request.');
  };
}

export function museChatModel(config: MuseConfig, transport: typeof fetch = fetch) {
  return createOpenAICompatible({
    name: 'muse',
    apiKey: config.apiKey,
    baseURL: modelBaseUrl(config),
    fetch: providerFetch(transport),
    includeUsage: true,
    supportsStructuredOutputs: true,
    transformRequestBody: (body) => ({
      ...body,
      messages: Array.isArray(body.messages)
        ? body.messages.map((message: Record<string, unknown>) => ({
            ...message,
            role: message.role === 'system' ? 'developer' : message.role,
          }))
        : body.messages,
    }),
  }).chatModel(config.model);
}

export function museResponsesModel(config: MuseConfig, transport: typeof fetch = fetch) {
  return createOpenAI({
    apiKey: config.apiKey,
    baseURL: modelBaseUrl(config),
    fetch: providerFetch(transport),
  }).responses(config.model);
}

export function sdkMessages(messages: MuseMessage[]): ModelMessage[] {
  return messages.map((message) => {
    if (message.role === 'developer')
      return {
        role: 'system',
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content
                .filter((p) => p.type === 'text')
                .map((p) => p.text)
                .join('\n'),
      };
    if (typeof message.content === 'string') return { role: message.role, content: message.content };
    if (message.role !== 'user') throw new ProcessingError('muse_invalid_response', 'Images require a user message.');
    return {
      role: 'user',
      content: message.content.map((part) =>
        part.type === 'text'
          ? part
          : {
              type: 'file',
              data: new URL(part.image_url.url),
              mediaType: /^data:([^;]+);/.exec(part.image_url.url)?.[1] ?? 'image/*',
            },
      ),
    };
  });
}
export const sdkSchema = (schema: object) => schema as JSONSchema7;
export function modelUsage(usage: LanguageModelUsage): ModelUsage {
  const count = (n: unknown) => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0);
  return {
    promptTokens: count(usage.inputTokens),
    completionTokens: count(usage.outputTokens),
    totalTokens: count(usage.totalTokens),
    ...(usage.inputTokenDetails.cacheReadTokens !== undefined
      ? { cachedInputTokens: Math.min(count(usage.inputTokens), count(usage.inputTokenDetails.cacheReadTokens)) }
      : {}),
  };
}
export function modelError(error: unknown, signal?: AbortSignal): ProcessingError {
  let cause: unknown = error;
  for (let i = 0; i < 6 && cause && typeof cause === 'object'; i++) {
    if (cause instanceof ProcessingError) return cause;
    cause = 'cause' in cause ? cause.cause : undefined;
  }
  if (signal?.aborted)
    return new ProcessingError('muse_timeout', 'The model request was interrupted or timed out.', true);
  if (APICallError.isInstance(error) && (!error.statusCode || error.statusCode >= 400))
    return new ProcessingError('muse_network_error', 'The model could not be reached.', true);
  return new ProcessingError('muse_invalid_response', 'The model returned an unusable response.');
}
/** Development-only traces omit prompts, credentials, image data and generated content. */
export async function modelTelemetry(name: string) {
  if (process.env.AI_SDK_DEVTOOLS !== 'true' || process.env.NODE_ENV === 'production') return undefined;
  const { DevToolsTelemetry } = await import('@ai-sdk/devtools');
  return {
    functionId: name,
    recordInputs: false,
    recordOutputs: false,
    integrations: [metadataOnlyTelemetry(DevToolsTelemetry())],
  };
}
