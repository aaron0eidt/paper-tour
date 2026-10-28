import type { MuseConfig } from '../config';
import { HttpError } from '../errors';
import { validWav } from '../../../shared/voice';

/** Meta Voice API file endpoint, documented at https://dev.meta.ai/docs/api-reference/voice/transcribe . */
export async function transcribe(
  config: MuseConfig,
  audio: Uint8Array,
  transport: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<{ transcript: string }> {
  if (!validWav(audio))
    throw new HttpError(400, 'invalid_audio', 'Record up to 30 seconds of mono PCM16 audio at 16 kHz.');
  if (!config.apiKey.trim())
    throw new HttpError(503, 'voice_not_configured', 'Voice input needs a Meta connection in Profile & Settings.');
  const url = new URL(config.baseUrl);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))
  )
    throw new HttpError(503, 'voice_not_configured', 'The voice API address is invalid.');
  const body = new FormData();
  body.append(
    'request',
    new Blob([JSON.stringify({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' })], {
      type: 'application/json',
    }),
  );
  body.append('audio', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'question.wav');
  let response: Response;
  try {
    response = await transport(`${url.href.replace(/\/$/, '')}/asr/transcribe`, {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
      body,
      signal: AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])]),
    });
  } catch {
    throw new HttpError(
      503,
      'voice_unavailable',
      'Transcription could not finish. Check your connection and try again.',
    );
  }
  if (!response.ok)
    throw new HttpError(
      response.status === 429 ? 429 : 503,
      'voice_unavailable',
      response.status === 401 || response.status === 403
        ? 'The Meta connection was not accepted. Check Profile & Settings.'
        : 'Transcription is unavailable. Try again in a moment.',
    );
  const result = await response.json().catch(() => null);
  if (typeof result?.transcript !== 'string' || result.transcript.length > 20000)
    throw new HttpError(502, 'invalid_transcript', 'No readable transcript came back.');
  const transcript = result.transcript.replace(/\s+/g, ' ').trim();
  if (!transcript)
    throw new HttpError(422, 'empty_transcript', 'No speech was detected. Hold the microphone button and try again.');
  if (transcript.length > 500)
    throw new HttpError(422, 'long_transcript', 'That question is too long. Try a shorter recording.');
  return { transcript };
}
