import { resolve } from 'node:path';
import { ROOT } from '../config';
export interface SpeechConfig {
  openaiKey: string;
  elevenlabsKey: string;
  cacheDir: string;
  timeoutMs: number;
  siri?: SiriConfig;
}
export interface SiriConfig {
  binary?: string;
  dataDir: string;
  allowInstall: boolean;
  autoSetup: boolean;
}
export function speechConfig(): SpeechConfig {
  return {
    openaiKey: process.env.OPENAI_TTS_API_KEY?.trim() ?? '',
    elevenlabsKey: process.env.ELEVENLABS_API_KEY?.trim() ?? '',
    cacheDir: resolve(ROOT, '.data/speech'),
    timeoutMs: 180_000,
    siri: {
      binary: process.env.SIRI_TTS_BIN?.trim() || undefined,
      dataDir: resolve(ROOT, '.data/siri'),
      allowInstall: process.env.NODE_ENV !== 'production' && ['127.0.0.1', 'localhost', '::1'].includes(process.env.HOST ?? '127.0.0.1'),
      autoSetup: process.env.SIRI_TTS_AUTO_SETUP !== 'false',
    },
  };
}
