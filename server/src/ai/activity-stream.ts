import { createUIMessageStream, type UIMessage } from 'ai';
import { setTimeout as delay } from 'node:timers/promises';
import type { ActivityFrame, GenerationActivity } from '../../../shared/activity';

export async function* activityFrames(
  initial: GenerationActivity,
  load: (after: string) => Promise<GenerationActivity>,
  after: string,
  signal: AbortSignal,
): AsyncGenerator<ActivityFrame> {
  let batch = initial,
    cursor = after;
  const end = Date.now() + 20_000;
  try {
    while (!signal.aborted) {
      for (const event of batch.events) {
        yield { event };
        cursor = event.id;
      }
      yield { status: batch.status };
      if ((!['queued', 'generating'].includes(batch.status) && batch.events.length < 100) || Date.now() >= end) break;
      if (batch.events.length < 100) await delay(700, undefined, { signal });
      batch = await load(cursor);
    }
  } catch {
    if (!signal.aborted) yield { error: 'Activity interrupted. Reconnecting…' };
  }
}

/** Reconcile the current data part by ID; the durable event journal remains the history. */
export function activityUIStream(frames: AsyncIterable<ActivityFrame>, messageId: string) {
  return createUIMessageStream<UIMessage<unknown, { activity: ActivityFrame }>>({
    execute: async ({ writer }) => {
      writer.write({ type: 'start', messageId });
      for await (const frame of frames) writer.write({ type: 'data-activity', id: 'activity', data: frame });
      writer.write({ type: 'finish' });
    },
    onError: () => 'Activity interrupted. Reconnecting…',
  });
}
