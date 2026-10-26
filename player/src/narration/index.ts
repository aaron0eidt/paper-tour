import { AudioNarrator } from './audio';
import { SilentNarrator } from './silent';
import { WebSpeechNarrator } from './webSpeech';
import type { Narrator } from './narrator';

export type { Narrator, SpeakRequest, SpeakCallbacks, NarrationHandle } from './narrator';
export { SilentNarrator } from './silent';

export function speechAvailable(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export interface NarrationConfig {
  /** Paper folder URL; step audio paths are relative to it. */
  baseUrl: string;
  muted: boolean;
  /** ?silent=1 */
  forceSilent: boolean;
}

/** One narrator for the engine that picks audio, speech or silent per step. */
export function createNarrator(cfg: NarrationConfig): Narrator {
  const silent = new SilentNarrator();
  const quiet = cfg.muted || cfg.forceSilent;
  const speech = !quiet && speechAvailable() ? new WebSpeechNarrator() : null;
  const audio = quiet ? null : new AudioNarrator(cfg.baseUrl);
  return {
    name: quiet ? 'silent' : speech ? 'speech' : 'silent',
    speak(req, cb) {
      if (audio && req.audio) return audio.speak(req, cb);
      // Once speech has proved not to work here, steps go straight to timed narration.
      if (speech?.available) return speech.speak(req, cb);
      return silent.speak(req, cb);
    },
  };
}
