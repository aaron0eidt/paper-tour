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
}
export interface Completion {
  value: unknown;
  usage: ModelUsage;
  requestId: string | null;
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

  async complete(
    messages: MuseMessage[],
    name: string,
    schema: object,
    maxTokens: number,
    signal?: AbortSignal,
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
          reasoning_effort: 'medium',
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
    if (!response.ok)
      throw new ProcessingError(
        'muse_request_rejected',
        'Muse could not process this paper. Check the model configuration and retry.',
      );
    let payload: {
      choices?: { finish_reason?: string; message?: { content?: unknown; refusal?: unknown } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
    };
    try {
      const raw = await response.text();
      if (raw.length > 2_000_000) throw new Error('oversized');
      payload = JSON.parse(raw);
      if (!payload || typeof payload !== 'object' || !Array.isArray(payload.choices))
        throw new Error('invalid envelope');
    } catch {
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
      },
      requestId: response.headers.get('x-request-id')?.slice(0, 200) ?? null,
    };
  }
}
