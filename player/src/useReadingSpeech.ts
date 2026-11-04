import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Step } from './types';
import { READING_VISUAL_VERSION, type ReadingPassage } from '../../shared/reading';
import type { AskSource } from './ask/api';
import { apiRequest, ApiRequestError } from './library/client';
import { ReadingPreparation } from './readingPreparation';
import { prepareReadingVisuals } from './visuals/preparation';
import { ReadingActivity } from './activity/reading';

/** Lazy source-checked speech, with shared foreground/background preparation and durable server caching. */
export function useReadingSpeech(source: AskSource, analysisId: string | undefined, removeCitations: boolean) {
  const { loader, activity } = useMemo(() => {
    let activity: ReadingActivity;
    const loader = new ReadingPreparation(
      async (step, signal) => {
        const activityRunId = activity.begin();
        const targetId = step.id.replace(/^reading-/, '');
        const path = `/api/documents/${encodeURIComponent(source.documentId)}/reading-passage`;
        const result = await apiRequest<ReadingPassage>(path, {
          method: 'POST',
          body: JSON.stringify({
            targetId,
            removeCitations,
            analysisId, activityRunId,
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]),
        });
        if (result.targetId !== targetId || !result.speech.trim())
          throw new Error('No reliable spoken passage returned.');
        activity.received();
        const hasVisual = result.actions?.some((action) => action.type === 'board');
        if (hasVisual) await activity.preview(targetId, 'running');
        try {
          await prepareReadingVisuals(result, signal);
          if (hasVisual) await activity.preview(targetId, 'completed');
        } catch (error) {
          if (hasVisual) await activity.preview(targetId, 'failed');
          throw error;
        }
        return result;
      },
      (error) =>
        !(
          error instanceof ApiRequestError &&
          ['reading_text_changed', 'reading_unclear', 'answer_failed', 'visual_validation_failed'].includes(error.code)
        ),
    );
    activity = new ReadingActivity('documentId' in source ? source.documentId : undefined, loader);
    return { loader, activity };
  }, [source, analysisId, removeCitations, READING_VISUAL_VERSION]);
  useEffect(() => {
    loader.activate();
    activity.activate();
    return () => {
      loader.dispose();
      activity.dispose();
    };
  }, [loader, activity]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<symbol>();
  const prepare = useCallback(
    async (step: Step, signal: AbortSignal): Promise<{ say: string; actions?: ReadingPassage['actions']; language: string }> => {
      const request = Symbol();
      latest.current = request;
      setBusy(true);
      setError(null);
      try {
        const result = await loader.get(step, signal);
        return { say: result.speech, actions: result.actions, language: result.language };
      } catch (cause) {
        if (!signal.aborted && latest.current === request)
          setError(cause instanceof Error ? cause.message : 'The passage could not be prepared.');
        throw cause;
      } finally {
        if (latest.current === request) setBusy(false);
      }
    },
    [loader],
  );
  const plan = useCallback(
    (current: Step | null, following: Step[], canStart: boolean) => loader.plan(current, following, canStart),
    [loader],
  );
  const cached = useCallback((step: Step) => loader.peek(step), [loader]);
  return { prepare, plan, busy, error, cached };
}
