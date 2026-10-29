import test from 'node:test';
import assert from 'node:assert/strict';
import { ResponsesClient } from '../src/agent/responses';
import { responseMessages, sdkAgentTools } from '../src/ai/response-agent';
import { metadataOnlyTelemetry } from '../src/ai/telemetry';
import { MuseClient } from '../src/muse/client';
import { ProcessingError } from '../src/errors';

const config = {
  apiKey: 'private-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en',
  timeoutMs: 5000,
};
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=';
const schema = {
  type: 'object',
  properties: { result: { type: 'number' } },
  required: ['result'],
  additionalProperties: false,
};
const definition = {
  type: 'function',
  name: 'inspect',
  description: 'Inspect the selected source before explaining it.',
  parameters: schema,
  strict: false,
};
const observer = { created: async (_id: string) => {}, delta: async (_text: string) => {} };
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });
const response = {
  id: 'r1',
  created_at: 1,
  model: config.model,
  status: 'completed',
  output: [
    {
      type: 'function_call',
      id: 'fc1',
      call_id: 'call1',
      name: 'inspect',
      arguments: '{"result":5}',
      status: 'completed',
    },
  ],
  usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
};

test('SDK durable step retains provider IDs, tool schemas, reasoning and images without a second dispatch', async () => {
  const requests: any[] = [],
    ids: string[] = [],
    tools: string[] = [];
  const client = new ResponsesClient(config, async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return json(response);
  });
  const result = await client.create(
    {
      instructions: 'Use only source evidence.',
      input: [
        {
          role: 'user',
          content: [
            { type: 'input_text', text: 'Inspect this source.' },
            { type: 'input_image', image_url: png },
          ],
        },
      ],
      tools: [definition],
      previous_response_id: 'previous',
      prompt_cache_key: 'version',
      reasoning: { effort: 'high' },
      max_output_tokens: 2000,
    },
    {
      ...observer,
      created: async (id) => {
        ids.push(id);
      },
      toolStarted: async (id) => {
        tools.push(id);
      },
    },
  );
  assert.equal(requests.length, 1, 'A completed JSON reply must not trigger a second paid request');
  assert.equal(requests[0].store, true);
  assert.equal(requests[0].previous_response_id, 'previous');
  assert.equal(requests[0].prompt_cache_key, 'version');
  assert.equal(requests[0].reasoning.effort, 'high');
  assert.equal(requests[0].tools[0].description, definition.description);
  assert.deepEqual(requests[0].tools[0].parameters, schema);
  assert.match(JSON.stringify(requests[0].input), /data:image\/png;base64/);
  assert.deepEqual(ids, ['r1']);
  assert.deepEqual(tools, ['call1']);
  assert.deepEqual(result, response);
  assert.equal(sdkAgentTools([definition]).inspect.execute, undefined, 'Only the journal executes durable writes');
});

test('SDK root initialization disables tools, and cancellation does not dispatch', async () => {
  let calls = 0;
  const client = new ResponsesClient(config, async (_url, init) => {
    calls++;
    const request = JSON.parse(String(init?.body));
    assert.equal(request.tools, undefined);
    assert.equal(request.tool_choice, undefined);
    return json({ ...response, output: [] });
  });
  await client.create({ input: 'Acknowledge the source.', tools: [definition], tool_choice: 'none' }, observer);
  const cancel = new AbortController();
  cancel.abort();
  await assert.rejects(
    client.create({ input: 'x' }, observer, cancel.signal),
    (error) => error instanceof ProcessingError && error.code === 'muse_timeout',
  );
  assert.equal(calls, 1);
});

test('SDK local replay preserves calls and visual tool results while omitting provider-private reasoning', () => {
  const messages = responseMessages([
    { type: 'reasoning', encrypted_content: 'provider-private' },
    response.output[0],
    {
      type: 'function_call_output',
      call_id: 'call1',
      output: [
        { type: 'input_text', text: 'Source image' },
        { type: 'input_image', image_url: png },
      ],
    },
  ]);
  assert.equal(messages[0].role, 'assistant');
  assert.equal(messages[1].role, 'tool');
  assert.match(JSON.stringify(messages), /call1/);
  assert.match(JSON.stringify(messages), /data:image\/png;base64/);
  assert(!JSON.stringify(messages).includes('provider-private'));
  assert.throws(() => responseMessages([{ type: 'unknown' }]), /cannot be discarded/);
});

test('SDK structured calls retain developer instructions, effort and bounded streaming callbacks', async () => {
  let chunks = 0;
  const client = new MuseClient(config, async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    assert.equal(request.messages[0].role, 'developer');
    assert.equal(request.reasoning_effort, 'high');
    assert.deepEqual(request.response_format.json_schema.schema, schema);
    return json({
      choices: [{ finish_reason: 'stop', message: { content: '{"result":5}' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    });
  });
  const result = await client.complete(
    [
      { role: 'developer', content: 'Return the calculation.' },
      { role: 'user', content: '2+3' },
    ],
    'calculation',
    schema,
    1000,
    undefined,
    async () => {
      chunks++;
    },
    undefined,
    'high',
  );
  assert.deepEqual(result.value, { result: 5 });
  assert.equal(chunks, 1);
  assert.equal(result.usage.totalTokens, 15);
});

test('SDK diagnostics retain counters while removing prompts, credentials, images and raw replies', async () => {
  let captured: any;
  const integration = metadataOnlyTelemetry({
    onStepStart: (event) => {
      captured = event;
    },
  });
  await (integration.onStepStart as Function)({
    callId: 'call1',
    stepNumber: 0,
    steps: [],
    modelId: config.model,
    provider: 'muse',
    messages: [{ content: `private paper ${png}` }],
    providerOptions: { apiKey: config.apiKey },
    request: { body: 'private request' },
    response: { id: 'r1', body: 'private reply', headers: { authorization: config.apiKey } },
    usage: { inputTokens: 10, outputTokens: 5, raw: 'private data' },
  });
  assert.equal(captured.callId, 'call1');
  assert.equal(captured.usage.inputTokens, 10);
  assert.equal(captured.response.id, 'r1');
  assert.doesNotMatch(JSON.stringify(captured), /private|base64|authorization/);
});
