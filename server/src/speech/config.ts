import { resolve } from 'node:path';
import { ROOT } from '../config';
export interface SpeechConfig {
  localUrl: string;
  localModel: string;
  openaiKey: string;
  elevenlabsKey: string;
  cacheDir: string;
  timeoutMs: number;
}
export function speechConfig(): SpeechConfig {
  return {
    localUrl: process.env.LOCAL_TTS_URL ?? 'http://127.0.0.1:8045/v1',
    localModel: process.env.LOCAL_TTS_MODEL ?? 'qwen3-tts-0.6b',
    openaiKey: process.env.OPENAI_TTS_API_KEY?.trim() ?? '',
    elevenlabsKey: process.env.ELEVENLABS_API_KEY?.trim() ?? '',
    cacheDir: resolve(ROOT, '.data/speech'),
    timeoutMs: 180_000,
  };
}
/** The local adapter cannot be used as an arbitrary HTTP proxy or send credentials off this machine. */
export function localSpeechUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('LOCAL_TTS_URL must be a loopback HTTP URL.');
  }
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw new Error('LOCAL_TTS_URL must be a loopback HTTP URL without credentials or query parameters.');
  return url.href.replace(/\/$/, '');
}
