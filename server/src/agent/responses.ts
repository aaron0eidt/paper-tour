import { setTimeout as delay } from 'node:timers/promises';
import type { MuseConfig } from '../config';
import type { TokenUsage } from '../../../shared/activity';
import { sseData } from '../../../shared/sse';
import { ProcessingError } from '../errors';
export interface ResponseItem {
  type: string;
  [key: string]: unknown;
}
export interface AgentResponse {
  id: string;
  status: string;
  output: ResponseItem[];
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    total_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
  };
  error?: unknown;
}
export interface ResponseObserver {
  created(id: string): Promise<void>;
  delta(text: string): Promise<void>;
  toolStarted?(id: string, name: string): Promise<void>;
}
export const responseUsage = (response: AgentResponse): TokenUsage => {
  const count = (n: unknown) => (typeof n === 'number' && Number.isSafeInteger(n) && n >= 0 ? n : 0);
  return {
    promptTokens: count(response.usage?.input_tokens),
    completionTokens: count(response.usage?.output_tokens),
    totalTokens: count(response.usage?.total_tokens),
    ...(typeof response.usage?.input_tokens_details?.cached_tokens === 'number'
      ? { cachedInputTokens: count(response.usage.input_tokens_details.cached_tokens) }
      : {}),
  };
};
export class ResponsesClient {
  private endpoint: string;
  constructor(
    private config: MuseConfig,
    private transport: typeof fetch = fetch,
  ) {
    const url = new URL(config.baseUrl);
    if (
      (url.protocol !== 'https:' &&
        !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new ProcessingError('configuration_error', 'The Meta API address is invalid.');
    this.endpoint = url.href.replace(/\/$/, '') + '/responses';
  }
  private async request(path: string, body: object | undefined, signal?: AbortSignal) {
    if (!this.config.apiKey) throw new ProcessingError('muse_not_configured', 'Connect Meta in Profile & Settings.');
    const response = await this.transport(this.endpoint + path, {
      method: body ? 'POST' : 'GET',
      redirect: 'error',
      signal: AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(signal ? [signal] : [])]),
      headers: { Authorization: `Bearer ${this.config.apiKey}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok && response.status === 400) {
      const payload = (await response.json().catch(() => null)) as {
        error?: { param?: string; code?: string; message?: string };
      } | null;
      if (
        payload?.error?.param === 'previous_response_id' ||
        payload?.error?.code === 'response_not_found' ||
        payload?.error?.message === 'referenced response not found or expired'
      )
        throw new ProcessingError('response_missing', 'The previous Meta response is no longer available.');
    }
    if (!response.ok)
      throw new ProcessingError(
        response.status === 404
          ? 'response_missing'
          : response.status === 401 || response.status === 403
            ? 'muse_auth_failed'
            : response.status === 429
              ? 'muse_rate_limited'
              : response.status >= 500
                ? 'muse_unavailable'
                : 'muse_request_rejected',
        `Meta request failed (${response.status}).`,
        response.status === 429 || response.status >= 500,
      );
    return response;
  }
  /** Stored responses can briefly be invisible to the next endpoint after SSE completes.
   * Only retry explicit history rejection (no inference started), never an uncertain dispatch.
   */
  private async historyRequest(path: string, body: object | undefined, signal?: AbortSignal) {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.request(path, body, signal);
      } catch (error) {
        if (
          !(error instanceof ProcessingError) ||
          error.code !== 'response_missing' ||
          attempt >= 3 ||
          (body && !(body as Record<string, unknown>).previous_response_id)
        )
          throw error;
        await delay([500, 1500, 3000][attempt], undefined, { signal });
      }
    }
  }
  async count(input: object, signal?: AbortSignal): Promise<number> {
    const fields = input as Record<string, unknown>;
    const response = await this.historyRequest(
      '/input_tokens',
      Object.fromEntries(
        ['input', 'instructions', 'tools', 'reasoning', 'previous_response_id']
          .filter((key) => fields[key] !== undefined)
          .map((key) => [key, fields[key]])
          .concat([['model', this.config.model]]),
      ),
      signal,
    );
    const data = (await response.json()) as { input_tokens?: number };
    if (!Number.isSafeInteger(data.input_tokens) || data.input_tokens! < 0)
      throw new ProcessingError('invalid_token_count', 'Meta returned an invalid context size.');
    return data.input_tokens!;
  }
  async retrieve(id: string, signal?: AbortSignal): Promise<AgentResponse> {
    return this.validate(await (await this.historyRequest('/' + encodeURIComponent(id), undefined, signal)).json());
  }
  private validate(value: unknown): AgentResponse {
    const result = value as AgentResponse;
    if (!result || typeof result.id !== 'string' || !Array.isArray(result.output))
      throw new ProcessingError('invalid_response', 'Meta returned an invalid response.');
    return result;
  }
  async create(input: object, observer: ResponseObserver, signal?: AbortSignal): Promise<AgentResponse> {
    const response = await this.historyRequest(
      '',
      { ...input, model: this.config.model, store: true, stream: true },
      signal,
    );
    if (!response.headers.get('content-type')?.includes('text/event-stream')) {
      const result = this.validate(await response.json());
      await observer.created(result.id);
      return result;
    }
    if (!response.body) throw new ProcessingError('invalid_response', 'Meta returned an empty stream.');
    let bytes = 0;
    let pending = '',
      flushed = Date.now();
    try {
      for await (const text of sseData(response.body)) {
        if (text === '[DONE]') continue;
        bytes += text.length;
        if (bytes > 16 * 1024 * 1024)
          throw new ProcessingError('response_limit', 'The response stream exceeded its limit.');
        const event = JSON.parse(text);
        if (event.type === 'response.created') await observer.created(String(event.response.id));
        if (event.type === 'response.output_item.added' && event.item?.type === 'function_call')
          await observer.toolStarted?.(String(event.item.call_id), String(event.item.name));
        if (event.type === 'response.output_text.delta' && typeof event.delta === 'string') {
          pending += event.delta;
          if (pending.length >= 4096 || Date.now() - flushed >= 500) {
            await observer.delta(pending);
            pending = '';
            flushed = Date.now();
          }
        }
        if (['response.completed', 'response.failed', 'response.incomplete'].includes(event.type))
          return this.validate(event.response);
      }
    } finally {
      if (pending) await observer.delta(pending);
    }
    throw new ProcessingError(
      'response_uncertain',
      'The model stream was interrupted; its stored response must be checked.',
    );
  }
}
