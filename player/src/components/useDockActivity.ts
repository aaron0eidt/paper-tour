import { useEffect, useState } from 'react';
import type { GenerationEvent } from '../../../shared/activity';
import { checklistEvent } from '../../../shared/generationChecklist';
import { sseData } from '../../../shared/sse';
import { activityStream } from '../library/client';

/** Subscribe only when the checklist is open; diagnostics remain in the Activity dialog. */
export function useDockActivity(documentId: string | undefined, generationId: string | undefined, open: boolean) {
  const [events, setEvents] = useState<GenerationEvent[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    setEvents([]);
    setError('');
    if (!open || !documentId || !generationId) return;
    const controller = new AbortController();
    let cursor = '0';
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const pause = () =>
      new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(retryTimer);
          controller.signal.removeEventListener('abort', finish);
          resolve();
        };
        retryTimer = setTimeout(finish, 1500);
        controller.signal.addEventListener('abort', finish, { once: true });
      });
    void (async () => {
      while (!controller.signal.aborted) {
        let finished = false;
        try {
          const response = await activityStream(
            `/api/documents/${documentId}/generations/${generationId}/events?after=${cursor}`,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          setError('');
          for await (const data of sseData(response.body!)) {
            if (controller.signal.aborted) return;
            const item = JSON.parse(data) as { event?: GenerationEvent; status?: string; error?: string };
            if (item.event) {
              cursor = item.event.id;
              // Avoid storing model prompts and token deltas in this small progress view.
              const event = checklistEvent(item.event);
              if (event) {
                setEvents((previous) => [...previous, event]);
              }
            }
            if (item.status) finished = !['queued', 'generating'].includes(item.status);
            if (item.error) throw new Error(item.error);
          }
          if (finished) return;
        } catch {
          if (!controller.signal.aborted) setError('Reconnecting to live progress…');
        }
        if (controller.signal.aborted) return;
        await pause();
      }
    })();
    return () => {
      controller.abort();
      clearTimeout(retryTimer);
    };
  }, [documentId, generationId, open]);
  return { events, error };
}
