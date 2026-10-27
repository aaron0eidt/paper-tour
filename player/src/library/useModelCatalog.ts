import { useCallback, useEffect, useState } from 'react';
import type { ModelCatalog } from '../../../shared/models';
import { apiRequest } from './client';
import { SETTINGS_CHANGED } from './useSettings';

/** Account-bound state; only public metadata is cached per credential version on the server. */
export function useModelCatalog() {
  const [catalog, setCatalog] = useState<ModelCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setLoading(true);
    apiRequest<ModelCatalog>('/api/models', { signal: controller.signal }).then((value) => {
      if (alive) { setCatalog(value); setError(null); }
    }).catch(() => { if (alive) { setCatalog(null); setError('Could not load models and API prices. Try again.'); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [revision]);
  useEffect(() => { window.addEventListener(SETTINGS_CHANGED, refresh); return () => window.removeEventListener(SETTINGS_CHANGED, refresh); }, [refresh]);
  return { catalog, loading, error, refresh };
}
