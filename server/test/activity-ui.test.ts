import test from 'node:test';
import assert from 'node:assert/strict';
import { createUIMessageStreamResponse } from 'ai';
import { activityUIStream } from '../src/ai/activity-stream';
import { readActivityStream } from '../../player/src/library/activity';
import type { ActivityFrame } from '../../shared/activity';

test('SDK UI activity survives round-trip data reconciliation without duplicated events', async () => {
  const frames: ActivityFrame[] = [
    {
      event: {
        id: '1',
        at: '2026-10-29T00:00:00Z',
        type: 'model.started',
        data: { callId: 'call1', name: 'paper_card' },
      },
    },
    {
      event: {
        id: '2',
        at: '2026-10-29T00:00:01Z',
        type: 'model.delta',
        data: { callId: 'call1', delta: 'Reading β' },
      },
    },
    { status: 'ready' },
  ];
  const source = async function* () {
    for (const frame of frames) yield frame;
  };
  const response = createUIMessageStreamResponse({ stream: activityUIStream(source(), 'generation1') });
  assert.equal(response.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
  const received: ActivityFrame[] = [];
  for await (const frame of readActivityStream(response)) received.push(frame);
  assert.deepEqual(received, frames);
});
