import test from 'node:test';
import assert from 'node:assert/strict';
import { replayHistory, replayOutput } from '../src/agent/history';
import { checkArguments } from '../src/agent/tools';
import type { AgentResponse } from '../src/agent/responses';

test('local replay retains assistant/tool order while omitting private reasoning and provider IDs', () => {
  const response: AgentResponse = {
    id: 'provider-id',
    status: 'completed',
    output: [
      { type: 'reasoning', summary: [{ text: 'private' }] },
      {
        type: 'message',
        id: 'message-id',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'Opening the figure.' }],
      },
      { type: 'function_call', id: 'tool-id', call_id: 'call1', name: 'view_visuals', arguments: '{"ids":["fig1"]}' },
    ],
  };
  const result = {
    type: 'function_call_output',
    call_id: 'call1',
    output: [{ type: 'input_image', sourceId: 'fig1', storagePath: 'owned/figure', sha256: 'hash' }],
  };
  const replay = replayHistory(
    [{ type: 'message', role: 'user', content: [] }],
    [{ response }],
    new Map([['call1', result]]),
  );
  assert.deepEqual(
    replay.map((item) => item.type),
    ['message', 'message', 'function_call', 'function_call_output'],
  );
  assert(!JSON.stringify(replayOutput(response)).includes('private'));
  assert(!JSON.stringify(replay).includes('provider-id'));
  assert.equal(replay.at(-1), result);
  assert.throws(() => replayHistory([], [{ response }], new Map()), /saved tool result is missing/);
});

test('missing descriptions yield a targeted repair instead of fabricated observations', () => {
  assert.throws(
    () =>
      checkArguments('record_visual_observations', {
        observations: [{ sourceId: 'page1', readable: true, uncertainties: [] }],
      }),
    (error) => {
      assert.match((error as Error).message, /Missing descriptions: page1/);
      assert.match((error as Error).message, /do not reload/);
      return true;
    },
  );
});

test('cached observations and chapters outside replay require a complete checkpoint', async () => {
  const { historyCoversCheckpoint } = await import('../src/agent/history');
  const state = {
    observations: { fig1: { description: 'Verified cache description', components: [{ label: 'Encoder' }] } },
    chapters: { intro: { title: 'Saved before rollover' } },
  };
  assert.equal(historyCoversCheckpoint(state, [], new Map()), false);
  const steps = [
    {
      response: {
        id: 'r',
        status: 'completed',
        output: [
          { type: 'function_call', name: 'record_visual_observations', call_id: 'obs' },
          { type: 'function_call', name: 'upsert_tour_chapter', call_id: 'chapter' },
        ],
      },
    },
  ];
  const results = new Map([
    [
      'obs',
      { type: 'function_call_output', output: [{ type: 'input_text', text: JSON.stringify({ recorded: ['fig1'] }) }] },
    ],
    [
      'chapter',
      { type: 'function_call_output', output: [{ type: 'input_text', text: JSON.stringify({ chapterId: 'intro' }) }] },
    ],
  ]);
  assert.equal(historyCoversCheckpoint(state, steps, results), true);
  assert.equal(
    historyCoversCheckpoint(
      { ...state, observations: { ...state.observations, fig2: { description: 'Cached' } } },
      steps,
      results,
    ),
    false,
  );
});
