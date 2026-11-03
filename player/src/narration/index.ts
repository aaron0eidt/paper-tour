import { AudioNarrator } from './audio';
import { SilentNarrator } from './silent';
import { WebSpeechNarrator } from './webSpeech';
import type { Narrator } from './narrator';
import { ProviderNarrator, type SpeechAudioCache } from './remote';
import type { SpeechSettings } from '../../../shared/speech';

export type { Narrator, SpeakRequest, SpeakCallbacks, NarrationHandle } from './narrator';
export { SilentNarrator } from './silent';
export { useBrowserVoices } from './useBrowserVoices';
export { pickVoice, voiceId, isGoogleVoice } from './voices';

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export interface NarrationConfig {
  /** Paper folder URL; step audio paths are relative to it. */
  baseUrl: string;
  muted: boolean;
  /** ?silent=1 */
  forceSilent: boolean;
  /** An explicitly chosen voice from this browser; empty uses automatic selection. */
  voiceId?: string;
  speech?: SpeechSettings | null;
  cache?: SpeechAudioCache;
  settingsError?: string;
}

/** One narrator for the engine that picks audio, speech or silent per step. */
export function createNarrator(cfg: NarrationConfig): Narrator {
  const silent = new SilentNarrator();
  const quiet = cfg.muted || cfg.forceSilent;
  if (!quiet && cfg.speech && cfg.speech.preferences.provider !== 'browser' && cfg.cache) return new ProviderNarrator(cfg.speech, cfg.cache);
  const speech = !quiet && speechAvailable() ? new WebSpeechNarrator(cfg.voiceId) : null;
  const audio = quiet ? null : new AudioNarrator(cfg.baseUrl);
  return {
    name: quiet ? 'silent' : speech ? 'speech' : 'silent',
    speak(req, cb) {
      if (audio && req.audio) return audio.speak(req, cb);
      if (quiet) return silent.speak(req, cb);
      if (cfg.settingsError) { let cancelled = false; queueMicrotask(() => { if (!cancelled) cb.onError?.(new Error(cfg.settingsError!)); }); return { cancel() { cancelled = true; } }; }
      if (speech) return speech.speak(req, cb);
      let cancelled = false;
      queueMicrotask(() => { if (!cancelled) cb.onError?.(new Error('Browser speech is unavailable. Choose an audio provider in Settings.')); });
      return { cancel() { cancelled = true; } };
    },
  };
}
