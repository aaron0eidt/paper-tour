import { transcribe as sdkTranscribe } from 'ai';
import type { MuseConfig } from '../config';
import { HttpError } from '../errors';
import { validWav } from '../../../shared/voice';
import { museTranscriptionModel } from '../ai/transcription';

/** Preserve the voice-question API; SDK handles the transcription lifecycle. */
export async function transcribe(
  config: MuseConfig,
  audio: Uint8Array,
  transport: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ transcript: string }> {
  if (!validWav(audio)) throw new HttpError(400, 'invalid_audio', 'Send a valid mono PCM16 WAV recording at 16 kHz.');
  const result = await sdkTranscribe({
    model: museTranscriptionModel(config, transport),
    audio,
    maxRetries: 0,
    abortSignal: signal,
  });
  return { transcript: result.text };
}
