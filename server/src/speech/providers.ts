import type { AudioSpeechProvider, SpeechAudio } from '../../../shared/speech';
import { HttpError } from '../errors';
import { localSpeechUrl, type SpeechConfig } from './config';

export interface SynthesisRequest {
  provider: AudioSpeechProvider;
  text: string;
  language: string;
  model: string;
  voice: string;
  apiKey: string;
}
export type SynthesizedAudio = Omit<SpeechAudio, 'cached'>;
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

/** Character alignment is accepted only when it matches the original text, never a rewritten transcript. */
export function alignedWordTimes(text: string, alignment: unknown): number[] | undefined {
  const a = alignment as { characters?: unknown; character_start_times_seconds?: unknown } | null;
  if (!Array.isArray(a?.characters) || !Array.isArray(a?.character_start_times_seconds)) return;
  const chars = a.characters,
    times = a.character_start_times_seconds;
  if (chars.some((c) => typeof c !== 'string') || chars.join('') !== text || chars.length !== times.length) return;
  if (times.some((t, i) => typeof t !== 'number' || !Number.isFinite(t) || t < 0 || (i > 0 && t < times[i - 1])))
    return;
  const starts = new Set([...text.matchAll(/\S+/gu)].map((match) => match.index!));
  const result: number[] = [];
  let offset = 0;
  for (let i = 0; i < chars.length; i++) {
    if (starts.has(offset)) result.push(Math.round(times[i] * 1000));
    offset += chars[i].length;
  }
  return result.length === starts.size ? result : undefined;
}
export function wavDurationMs(audio: Buffer): number | undefined {
  if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') return;
  let bytesPerSecond = 0,
    dataBytes = 0;
  for (let at = 12; at + 8 <= audio.length; ) {
    const tag = audio.toString('ascii', at, at + 4),
      size = audio.readUInt32LE(at + 4);
    if (at + 8 + size > audio.length) return;
    if (tag === 'fmt ' && size >= 16) bytesPerSecond = audio.readUInt32LE(at + 16);
    if (tag === 'data') dataBytes += size;
    at += 8 + size + (size % 2);
  }
  return bytesPerSecond && dataBytes ? (dataBytes / bytesPerSecond) * 1000 : undefined;
}
export class SpeechProviders {
  constructor(
    readonly config: SpeechConfig,
    readonly transport: typeof fetch = fetch,
  ) {}
  async localAvailable(): Promise<boolean> {
    try {
      const response = await this.transport(`${localSpeechUrl(this.config.localUrl)}/models`, {
        signal: AbortSignal.timeout(1800),
        redirect: 'error',
      });
      if (!response.ok) return false;
      const value = (await response.json()) as { data?: { id: string }[] };
      return Boolean(value.data?.some((m) => m.id === this.config.localModel));
    } catch {
      return false;
    }
  }
  async verifyKey(provider: 'openai' | 'elevenlabs', apiKey: string): Promise<void> {
    const url = provider === 'openai' ? 'https://api.openai.com/v1/models' : 'https://api.elevenlabs.io/v1/voices';
    const headers: Record<string, string> =
      provider === 'openai' ? { Authorization: `Bearer ${apiKey}` } : { 'xi-api-key': apiKey };
    let response: Response;
    try {
      response = await this.transport(url, { headers, signal: AbortSignal.timeout(12_000), redirect: 'error' });
    } catch {
      throw new HttpError(
        503,
        'speech_key_verification_unavailable',
        'The speech provider could not be reached. Retry before saving this key.',
      );
    }
    // A restricted ElevenLabs TTS key can synthesize but cannot list voices. Do not call it verified.
    if (!response.ok && provider === 'elevenlabs' && response.status === 401) {
      const value = (await response.json().catch(() => null)) as { detail?: { status?: string } } | null;
      if (value?.detail?.status === 'missing_permissions') return;
    } else await response.body?.cancel();
    if (!response.ok)
      throw new HttpError(
        400,
        'speech_key_not_verified',
        `The ${provider === 'openai' ? 'OpenAI' : 'ElevenLabs'} key could not be verified (HTTP ${response.status}). Check the key and its API permissions.`,
      );
  }
  async synthesize(input: SynthesisRequest, signal?: AbortSignal): Promise<SynthesizedAudio> {
    if (input.provider !== 'local' && !input.apiKey)
      throw new HttpError(
        503,
        'speech_not_configured',
        'Add a speech API key in Settings, or select local or browser speech.',
      );
    if (input.provider === 'local' && !['en', 'de'].includes(input.language.split(/[-_]/)[0].toLowerCase()))
      throw new HttpError(
        400,
        'speech_language_unsupported',
        'This local voice is configured for English and German. Select another speech provider for this language.',
      );
    const url =
      input.provider === 'local'
        ? `${localSpeechUrl(this.config.localUrl)}/audio/speech`
        : input.provider === 'openai'
          ? 'https://api.openai.com/v1/audio/speech'
          : `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(input.voice)}/with-timestamps?output_format=mp3_44100_128`;
    const body =
      input.provider === 'elevenlabs'
        ? { text: input.text, model_id: input.model, language_code: input.language.split(/[-_]/)[0].toLowerCase() }
        : {
            input: input.text,
            model: input.model,
            voice: input.voice,
            response_format: 'wav',
            ...(input.provider === 'local' ? { language: input.language } : {}),
          };
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (input.provider === 'openai') headers.Authorization = `Bearer ${input.apiKey}`;
    if (input.provider === 'elevenlabs') headers['xi-api-key'] = input.apiKey;
    let response: Response;
    try {
      response = await this.transport(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        redirect: 'error',
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)])
          : AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      if (signal?.aborted) throw signal.reason;
      throw new HttpError(
        503,
        'speech_unavailable',
        input.provider === 'local'
          ? 'Local speech is unavailable. Start scripts/local-tts.py on port 8045, then retry. No other provider was used.'
          : 'The speech provider could not be reached or timed out. Retry or explicitly choose another provider.',
      );
    }
    if (!response.ok) {
      await response.body?.cancel(); // Provider errors may echo private text or credentials.
      throw new HttpError(
        response.status === 429 ? 429 : 502,
        'speech_provider_error',
        `Speech generation failed (HTTP ${response.status}). ${response.status === 401 || response.status === 403 ? 'Check the provider key and permissions in Settings.' : response.status === 429 ? 'Check your provider quota or retry later.' : 'Check that the selected model and voice are available, then retry.'} No other provider was used.`,
      );
    }
    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    if (!reader) throw new HttpError(502, 'speech_empty', 'The speech provider returned no audio.');
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_AUDIO_BYTES * (input.provider === 'elevenlabs' ? 1.5 : 1)) {
        await reader.cancel();
        throw new HttpError(502, 'speech_too_large', 'The speech response exceeded the audio size limit.');
      }
      chunks.push(part.value);
    }
    const raw = Buffer.concat(chunks);
    let audio = raw;
    let wordTimesMs: number[] | undefined;
    if (input.provider === 'elevenlabs') {
      let value: { audio_base64?: string; alignment?: unknown };
      try {
        value = JSON.parse(raw.toString('utf8'));
      } catch {
        throw new HttpError(502, 'speech_invalid', 'The speech provider returned an invalid audio response.');
      }
      if (typeof value.audio_base64 !== 'string')
        throw new HttpError(502, 'speech_empty', 'The speech provider returned no audio.');
      audio = Buffer.from(value.audio_base64, 'base64');
      wordTimesMs = alignedWordTimes(input.text, value.alignment);
    }
    const wav = audio.toString('ascii', 0, 4) === 'RIFF' && audio.toString('ascii', 8, 12) === 'WAVE';
    const mp3 = audio.toString('ascii', 0, 3) === 'ID3' || (audio[0] === 255 && (audio[1] & 224) === 224);
    if (audio.length < 128 || audio.length > MAX_AUDIO_BYTES || (!wav && !mp3))
      throw new HttpError(502, 'speech_invalid', 'The speech provider returned an unreadable audio file.');
    return {
      provider: input.provider,
      model: input.model,
      voice: input.voice,
      audioBase64: audio.toString('base64'),
      mimeType: wav ? 'audio/wav' : 'audio/mpeg',
      durationMs: wav ? wavDurationMs(audio) : undefined,
      wordTimesMs,
      timing: wordTimesMs ? 'provider' : 'estimated',
    };
  }
}
