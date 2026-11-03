import { useCallback, useEffect, useMemo, useState } from 'react';
import type { SpeechPreferences, SpeechSettings } from '../../../shared/speech';
import { apiRequest } from '../library/client';
import { SETTINGS_CHANGED, settingsChanged } from '../library/useSettings';
import { SpeechAudioCache } from './remote';
export function useSpeechSettings(enabled = true) {
  const [data, setData] = useState<SpeechSettings | null>(null),
    [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled),
    [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    apiRequest<SpeechSettings>('/api/speech/settings', { signal: controller.signal })
      .then((value) => {
        setData(value);
        setError(null);
      })
      .catch((cause) => {
        if (!controller.signal.aborted)
          setError(cause instanceof Error ? cause.message : 'Could not load speech settings.');
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [enabled, revision]);
  useEffect(() => {
    window.addEventListener(SETTINGS_CHANGED, refresh);
    return () => window.removeEventListener(SETTINGS_CHANGED, refresh);
  }, [refresh]);
  const update = useCallback(async (preferences: SpeechPreferences) => {
    const value = await apiRequest<SpeechSettings>('/api/speech/settings', {
      method: 'PUT',
      body: JSON.stringify(preferences),
    });
    setData(value);
    setError(null);
    settingsChanged();
  }, []);
  // A settings/credential version never reuses the previous version's audio.
  const cache = useMemo(
    () =>
      new SpeechAudioCache((input) =>
        apiRequest('/api/speech/synthesize', { method: 'POST', body: JSON.stringify(input) }),
      ),
    [data?.version],
  );
  return { data, error, loading, refresh, update, cache };
}
