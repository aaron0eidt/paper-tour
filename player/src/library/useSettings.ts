import { useCallback, useEffect, useState } from 'react';
import type { UserSettings } from '../../../shared/settings';
import { apiRequest } from './client';

export const SETTINGS_CHANGED = 'paper-tour:settings-changed';
export function settingsChanged() { window.dispatchEvent(new Event(SETTINGS_CHANGED)); }

export function useSettings() {
  const [data, setData] = useState<UserSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    const controller = new AbortController(); let alive = true;
    setLoading(true);
    apiRequest<UserSettings>('/api/settings', { signal: controller.signal }).then((value) => {
      if (alive) { setData(value); setError(null); }
    }).catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : 'Could not load settings.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; controller.abort(); };
  }, [revision]);
  useEffect(() => { window.addEventListener(SETTINGS_CHANGED, refresh); return () => window.removeEventListener(SETTINGS_CHANGED, refresh); }, [refresh]);
  return { data, loading, error, refresh };
}
