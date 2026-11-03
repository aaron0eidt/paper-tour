import { resolve } from 'node:path';
import { ROOT } from '../config';
export interface SpeechConfig {
  openaiKey: string;
  elevenlabsKey: string;
  cacheDir: string;
  timeoutMs: number;
}
export function speechConfig(): SpeechConfig {
  return {
    openaiKey: process.env.OPENAI_TTS_API_KEY?.trim() ?? '',
    elevenlabsKey: process.env.ELEVENLABS_API_KEY?.trim() ?? '',
    cacheDir: resolve(ROOT, '.data/speech'),
    timeoutMs: 180_000,
  };
}
