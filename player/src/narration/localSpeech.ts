import type { SpeechPreferences, SpeechSettings } from '../../../shared/speech';

const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
const STORAGE = 'paper-tour.local-speech.v1';
export async function localSpeechRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${base}/api/local/speech${path}`, {
    ...options, cache: 'no-store', headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) throw new Error(value?.error?.message ?? 'Local Siri is unavailable. Start the local Paper Tour server, then retry.');
  return value as T;
}
export function localPreferences(settings: SpeechSettings): SpeechSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE) ?? 'null') as SpeechPreferences | null;
    if (saved && ['browser', 'siri'].includes(saved.provider)) {
      const voice = saved.connections?.siri?.voice;
      settings.preferences = { ...settings.preferences, provider: saved.provider,
        connections: { ...settings.preferences.connections, siri: { ...settings.preferences.connections.siri,
          voice: typeof voice === 'string' && voice.length <= 200 && voice ? voice : 'auto' } } };
    }
  } catch { /* Local preferences are optional; no audio or keys are stored here. */ }
  return settings;
}
export function saveLocalPreferences(preferences: SpeechPreferences) {
  if (!['browser', 'siri'].includes(preferences.provider)) throw new Error('Sign in to configure cloud speech.');
  try { localStorage.setItem(STORAGE, JSON.stringify(preferences)); } catch { /* Works for this session as well. */ }
}
