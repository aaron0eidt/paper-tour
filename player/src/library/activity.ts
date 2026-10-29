import { parseJsonEventStream, readUIMessageStream, uiMessageChunkSchema, type UIMessage } from 'ai';
import type { ActivityFrame } from '../../../shared/activity';

/** AI SDK parses and reconciles typed data parts; the server owns durable resumption. */
export async function* readActivityStream(response: Response): AsyncGenerator<ActivityFrame> {
  if (!response.body) throw new Error('Missing activity stream');
  const chunks = parseJsonEventStream({ stream: response.body, schema: uiMessageChunkSchema }).pipeThrough(
    new TransformStream({
      transform(result, controller) {
        if (!result.success) throw result.error;
        controller.enqueue(result.value);
      },
    }),
  );
  let previous = '';
  for await (const message of readUIMessageStream<UIMessage<unknown, { activity: ActivityFrame }>>({
    stream: chunks,
    terminateOnError: true,
  })) {
    const part = message.parts.find((part) => part.type === 'data-activity');
    if (!part || part.type !== 'data-activity') continue;
    const frame = part.data;
    const key = frame.event ? `event:${frame.event.id}` : JSON.stringify(frame);
    if (key !== previous) {
      previous = key;
      yield frame;
    }
  }
}
