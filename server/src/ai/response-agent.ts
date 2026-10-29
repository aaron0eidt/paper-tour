import { ToolLoopAgent, isStepCount, tool, jsonSchema, type ModelMessage, type ToolSet, type ToolResultPart } from 'ai';
import type { MuseConfig } from '../config';
import { ProcessingError } from '../errors';
import { museResponsesModel, sdkSchema, modelTelemetry } from './provider';
import type { AgentResponse, ResponseItem, ResponseObserver } from '../agent/responses';

interface FunctionDefinition {
  name: string;
  description?: string;
  parameters: object;
  strict?: boolean;
}
export function sdkAgentTools(definitions: FunctionDefinition[]): ToolSet {
  // Execution belongs to the durable journal: writes commit atomically with their
  // result, and retries must never execute them twice inside an in-memory loop.
  return Object.fromEntries(
    definitions.map((def) => [
      def.name,
      tool({ description: def.description, inputSchema: jsonSchema(sdkSchema(def.parameters)), strict: def.strict }),
    ]),
  );
}
const imageType = (url: string) => /^data:([^;]+);/.exec(url)?.[1] ?? 'image/*';
export function responseMessages(input: unknown): ModelMessage[] {
  if (typeof input === 'string') return [{ role: 'user', content: input }];
  if (!Array.isArray(input)) throw new ProcessingError('invalid_response', 'The agent input is invalid.');
  return (input as ResponseItem[]).flatMap((item): ModelMessage[] => {
    if (item.type === 'message' || item.role) {
      if (item.role !== 'user' && item.role !== 'assistant')
        throw new ProcessingError('invalid_response', 'Unexpected agent message role.');
      const parts =
        typeof item.content === 'string'
          ? [{ type: 'input_text', text: item.content }]
          : (item.content as Record<string, unknown>[]);
      if (item.role === 'assistant')
        return [
          {
            role: 'assistant',
            content: parts
              .filter((p) => p.type === 'output_text' || p.type === 'text')
              .map((p) => String(p.text))
              .join(''),
          },
        ];
      return [
        {
          role: 'user',
          content: parts.map((p) =>
            p.type === 'input_image'
              ? { type: 'file', data: new URL(String(p.image_url)), mediaType: imageType(String(p.image_url)) }
              : { type: 'text', text: String(p.text ?? '') },
          ),
        },
      ];
    }
    if (item.type === 'function_call')
      return [
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              toolCallId: String(item.call_id),
              toolName: String(item.name),
              input: JSON.parse(String(item.arguments)),
            },
          ],
        },
      ];
    if (item.type === 'function_call_output') {
      const output: ToolResultPart['output'] =
        typeof item.output === 'string'
          ? { type: 'text', value: item.output }
          : {
              type: 'content',
              value: (item.output as Record<string, unknown>[]).map((p) =>
                p.type === 'input_image'
                  ? {
                      type: 'file',
                      data: { type: 'url', url: new URL(String(p.image_url)) },
                      mediaType: imageType(String(p.image_url)),
                    }
                  : { type: 'text', text: String(p.text ?? '') },
              ),
            };
      return [
        {
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: String(item.call_id), toolName: 'external', output }],
        },
      ];
    }
    // Provider-private reasoning is never replayed as ordinary document content.
    if (item.type === 'reasoning') return [];
    throw new ProcessingError('invalid_response', 'An unsupported agent history item cannot be discarded.');
  });
}

/** One durable model step. SDK parses tool streams; pg-boss resumes at the next committed step. */
export async function streamAgentStep(
  config: MuseConfig,
  input: Record<string, unknown>,
  transport: typeof fetch,
  observer: ResponseObserver,
  signal?: AbortSignal,
): Promise<AgentResponse> {
  const telemetry = await modelTelemetry('paper-agent.step');
  let completedJson: Response | undefined;
  const makeAgent = (fetcher: typeof fetch) =>
    new ToolLoopAgent({
      model: museResponsesModel(config, fetcher),
      instructions: String(input.instructions ?? ''),
      tools: sdkAgentTools((input.tools ?? []) as FunctionDefinition[]),
      stopWhen: isStepCount(1),
      // Muse supports only automatic tool choice. Omit tools entirely for source
      // initialization instead of sending an unsupported tool_choice=none.
      activeTools: input.tool_choice === 'none' ? [] : undefined,
      maxRetries: 0,
      maxOutputTokens: typeof input.max_output_tokens === 'number' ? input.max_output_tokens : undefined,
      providerOptions: {
        openai: {
          store: true,
          forceReasoning: true,
          systemMessageMode: 'developer',
          previousResponseId: typeof input.previous_response_id === 'string' ? input.previous_response_id : undefined,
          promptCacheKey: typeof input.prompt_cache_key === 'string' ? input.prompt_cache_key : undefined,
          reasoningEffort: (input.reasoning as { effort?: string } | undefined)?.effort ?? 'medium',
        },
      },
      include: { rawChunks: true, responseBody: true },
      telemetry,
      onError: () => {},
    });
  const agent = makeAgent(async (url, init) => {
    const response = await transport(url, init);
    if (response.ok && !response.headers.get('content-type')?.includes('text/event-stream')) {
      completedJson = response;
      throw new Error('Completed JSON response');
    }
    return response;
  });
  try {
    const result = await agent.stream({ messages: responseMessages(input.input), abortSignal: signal });
    let completed: AgentResponse | undefined;
    for await (const part of result.stream) {
      if (part.type === 'raw') {
        const event = part.rawValue as {
          type?: string;
          response?: AgentResponse;
          item?: { type?: string; call_id?: string; name?: string };
        };
        if (event.type === 'response.created' && event.response?.id) await observer.created(event.response.id);
        if (event.type === 'response.output_item.added' && event.item?.type === 'function_call')
          await observer.toolStarted?.(String(event.item.call_id), String(event.item.name));
        if (
          ['response.completed', 'response.failed', 'response.incomplete'].includes(event.type ?? '') &&
          event.response
        )
          completed = event.response;
      }
      if (part.type === 'text-delta') await observer.delta(part.text);
      if (part.type === 'error') throw part.error;
    }
    signal?.throwIfAborted();
    if (!completed)
      throw new ProcessingError('response_uncertain', 'The model stream ended without its stored result.');
    return completed;
  } catch (error) {
    if (!completedJson) throw error;
    const response = completedJson;
    const terminal = (await response.clone().json()) as AgentResponse;
    // Failed provider runs are durable results too. Keep their status and missing
    // usage visible instead of turning them into a generic SDK parsing failure.
    if (terminal.id && Array.isArray(terminal.output) && ['failed', 'incomplete'].includes(terminal.status)) {
      await observer.created(terminal.id);
      return terminal;
    }
    const result = await makeAgent(async () => response.clone()).generate({
      messages: responseMessages(input.input),
      abortSignal: signal,
    });
    const raw = result.response.body as AgentResponse;
    if (!raw || !raw.id || !Array.isArray(raw.output))
      throw new ProcessingError('invalid_response', 'The completed model response is invalid.');
    await observer.created(raw.id);
    if (result.text) await observer.delta(result.text);
    for (const call of result.toolCalls) await observer.toolStarted?.(call.toolCallId, call.toolName);
    return raw;
  }
}
