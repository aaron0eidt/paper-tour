import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ActivityRun, DocumentActivity, DocumentActivityFrame } from '../../../shared/agentActivity';
import { mergeActivity } from '../../../shared/agentActivity';
import { apiRequest, activityStream } from '../library/client';
import { readActivityStream } from '../library/activity';
import { localActivitySnapshot, subscribeLocalActivity } from './client';

/** One observation stream per reader, independent of whether the activity card is expanded. */
export function useDocumentActivity(documentId?: string) {
  const [runs, setRuns] = useState<ActivityRun[]>([]);
  const [connection, setConnection] = useState<'connecting' | 'live' | 'reconnecting'>('connecting');
  const [page, setPage] = useState<{ before?: string; more: boolean }>({ more: false });
  const [error, setError] = useState('');
  const remoteStatuses = useRef(new Map<string, string>());
  const mounted = useRef(documentId);
  mounted.current = documentId;
  const local = useSyncExternalStore(
    useCallback((notify) => subscribeLocalActivity(documentId, notify), [documentId]),
    useCallback(() => localActivitySnapshot(documentId), [documentId]),
  );
  useEffect(() => {
    setRuns([]);
    setError('');
    setPage({ more: false });
    setConnection('connecting');
    remoteStatuses.current.clear();
    if (!documentId) return;
    const controller = new AbortController();
    let cursor = '0';
    let timer: ReturnType<typeof setTimeout>;
    const pause = () =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', done);
          resolve();
        };
        timer = setTimeout(done, 1500);
        controller.signal.addEventListener('abort', done, { once: true });
      });
    void (async () => {
      let loaded = false;
      while (!controller.signal.aborted) {
        try {
          if (!loaded) {
            const snapshot = await apiRequest<DocumentActivity>(`/api/documents/${documentId}/activity`, {
              signal: controller.signal,
            });
            if (controller.signal.aborted) return;
            cursor = snapshot.cursor;
            setRuns((held) => mergeActivity(held, { runs: snapshot.runs }));
            setPage({ before: snapshot.before, more: snapshot.hasMore });
            loaded = true;
          }
          const response = await activityStream(
            `/api/documents/${documentId}/activity/events?after=${cursor}`,
            controller.signal,
          );
          for await (const frame of readActivityStream<DocumentActivityFrame>(response)) {
            if (controller.signal.aborted) return;
            if (frame.error) throw new Error(frame.error);
            cursor = frame.cursor ?? cursor;
            setRuns((held) => mergeActivity(held, frame));
            setConnection('live');
          }
        } catch {
          if (!controller.signal.aborted) setConnection('reconnecting');
        }
        if (!controller.signal.aborted) await pause();
      }
    })();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [documentId]);
  useEffect(() => {
    for (const run of runs) {
      const previous = remoteStatuses.current.get(run.id);
      if (previous === run.status) continue;
      remoteStatuses.current.set(run.id, run.status);
      const held = local.find((item) => item.run.id === run.id);
      if (!held || run.kind !== 'reading' || !previous || held.run.status === run.status) continue;
      if (run.status === 'paused') held.controls.pause?.();
      // A reconnect with an old 'running' snapshot must not unpause a newly paused local queue.
      else if (run.status === 'running' && held.run.status === 'paused') held.controls.resume?.();
    }
  }, [runs, local]);

  const loadMore = async () => {
    if (!documentId || !page.before || !page.more) return;
    try {
      const snapshot = await apiRequest<DocumentActivity>(
        `/api/documents/${documentId}/activity?before=${page.before}`,
      );
      if (mounted.current !== documentId) return;
      setRuns((held) => mergeActivity(held, { runs: snapshot.runs }));
      setPage({ before: snapshot.before, more: snapshot.hasMore });
    } catch {
      setError('History could not be loaded. Try again.');
    }
  };
  const control = async (run: ActivityRun, action: 'pause' | 'resume' | 'cancel' | 'retry') => {
    const localRun = local.find((item) => item.run.id === run.id);
    setError('');
    if (action === 'retry') {
      localRun?.controls.retry?.();
      return;
    }
    try {
      if (run.kind === 'answer' && action === 'cancel') localRun?.controls.cancel?.();
      if (documentId)
        await apiRequest(`/api/documents/${documentId}/activity/${run.id}/control`, {
          method: 'POST',
          body: JSON.stringify({ action }),
        });
      if (!(run.kind === 'answer' && action === 'cancel')) localRun?.controls[action]?.();
      setRuns((held) =>
        held.map((item) =>
          item.id === run.id
            ? { ...item, status: action === 'cancel' ? 'cancelled' : action === 'pause' ? 'paused' : 'running' }
            : item,
        ),
      );
    } catch {
      setError('The action could not be applied. Try again.');
    }
  };
  const merged = mergeActivity(
    local.map((item) => item.run),
    {
      runs: runs.map((run) => ({
        ...run,
        progress: local.find((item) => item.run.id === run.id)?.run.progress ?? run.progress,
      })),
    },
  );
  return {
    runs: merged,
    connection,
    error,
    more: page.more,
    loadMore,
    control,
    local,
    foregroundReadingId: local.find((item) => item.foreground && item.run.kind === 'reading')?.run.id,
  };
}
