import { useCallback, useMemo, useRef, useState } from 'react';
import type { Step } from './types';
import type { ReadingPassage } from '../../shared/reading';
import type { AskSource } from './ask/api';
import { apiRequest } from './library/client';

/** Lazy per-analysis speech cache. Source prose is checked word for word by the server. */
export function useReadingSpeech(source: AskSource, analysisId: string | undefined, removeCitations: boolean) {
  const cache = useMemo(() => new Map<string, ReadingPassage>(), [source, analysisId, removeCitations]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef<symbol>();
  const prepare = useCallback(async (step: Step, signal: AbortSignal): Promise<string | { say: string; actions?: ReadingPassage['actions'] }> => {
    setError(null);
    const targetId = step.id.replace(/^reading-/, '');
    const stored = cache.get(targetId);
    if (stored) return { say: stored.speech, actions: stored.actions };
    const request = Symbol();
    latest.current = request;
    setBusy(true);
    setError(null);
    try {
      const path = 'documentId' in source
        ? `/api/documents/${encodeURIComponent(source.documentId)}/reading-passage`
        : `/api/demo/${encodeURIComponent(source.paper)}/reading-passage`;
      const result = await apiRequest<ReadingPassage>(path, { method: 'POST',
        body: JSON.stringify({ targetId, removeCitations, ...('documentId' in source ? { analysisId } : {}) }),
        signal: AbortSignal.any([signal, AbortSignal.timeout(120_000)]) });
      signal.throwIfAborted();
      if (result.targetId !== targetId || !result.speech.trim()) throw new Error('No reliable visual description returned.');
      cache.set(targetId, result);
      return { say: result.speech, actions: result.actions };
    } catch (cause) {
      if (!signal.aborted && latest.current === request)
        setError(cause instanceof Error ? cause.message : 'The equation or table could not be described.');
      throw cause;
    } finally {
      if (latest.current === request) setBusy(false);
    }
  }, [cache, source, analysisId, removeCitations]);
  return { prepare, busy, error };
}
