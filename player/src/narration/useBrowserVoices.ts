import { useCallback, useEffect, useState } from 'react';
import { browserSpeech, readVoices, watchVoices } from './voices';

const STORAGE_KEY = 'paper-tour.voice.v1';
function savedVoice(): string {
  try { return localStorage.getItem(STORAGE_KEY) ?? ''; } catch { return ''; }
}

export function useBrowserVoices() {
  const [voices, setVoices] = useState(readVoices);
  const [loading, setLoading] = useState(() => !!browserSpeech() && !readVoices().length);
  const [selectedVoiceId, setSelectedVoice] = useState(savedVoice);
  useEffect(() => watchVoices((available, waiting) => { setVoices(available); setLoading(waiting); }), []);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) setSelectedVoice(savedVoice()); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  const setSelectedVoiceId = useCallback((id: string) => {
    setSelectedVoice(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* The selected voice still works when storage is unavailable. */ }
  }, []);
  return { voices, loading, selectedVoiceId, setSelectedVoiceId };
}
