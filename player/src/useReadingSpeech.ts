import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Step } from './types';
import { READING_VISUAL_VERSION, type ReadingPassage } from '../../shared/reading';
import type { AskSource } from './ask/api';
import { apiRequest, ApiRequestError } from './library/client';
import { ReadingPreparation } from './readingPreparation';
import { prepareReadingVisuals } from './visuals/preparation';

/** Lazy source-checked speech, with shared foreground/background preparation and durable server caching. */
export function useReadingSpeech(source: AskSource, analysisId: string | undefined, removeCitations: boolean) {
  const loader = useMemo(() => new ReadingPreparation(async (step, signal) => {
    const targetId = step.id.replace(/^reading-/, '');
    const path = 'documentId' in source
      ? `/api/documents/${encodeURIComponent(source.documentId)}/reading-passage`
      : `/api/demo/${encodeURIComponent(source.paper)}/reading-passage`;
    const result = await apiRequest<ReadingPassage>(path, { method: 'POST',
      body: JSON.stringify({ targetId, removeCitations, ...('documentId' in source ? { analysisId } : {}) }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
    if (result.targetId !== targetId || !result.speech.trim()) throw new Error('No reliable spoken passage returned.');
    await prepareReadingVisuals(result, signal);
    return result;
  }, (error) => !(error instanceof ApiRequestError &&
    ['reading_text_changed', 'reading_unclear', 'answer_failed'].includes(error.code))),
  [source, analysisId, removeCitations, READING_VISUAL_VERSION]);
  useEffect(() => { loader.activate(); return () => loader.dispose(); }, [loader]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<symbol>();
  const prepare = useCallback(async (step: Step, signal: AbortSignal): Promise<{ say: string; actions?: ReadingPassage['actions'] }> => {
    const request = Symbol();
    latest.current = request;
    setBusy(true);
    setError(null);
    try {
      const result = await loader.get(step, signal);
      return { say: result.speech, actions: result.actions };
    } catch (cause) {
      if (!signal.aborted && latest.current === request)
        setError(cause instanceof Error ? cause.message : 'The passage could not be prepared.');
      throw cause;
    } finally {
      if (latest.current === request) setBusy(false);
    }
  }, [loader]);
  const plan = useCallback((current: Step | null, following: Step[], canStart: boolean) => loader.plan(current, following, canStart), [loader]);
  return { prepare, plan, busy, error };
}
