import type { MuseConfig } from '../config';
import type { TranscriptionModel } from 'ai';
import { HttpError } from '../errors';
import { validWav } from '../../../shared/voice';
import { cleanHints, type VoiceHints } from '../muse/voice-hints';

/** Not a problem with the request body, so sending it again without the hints cannot help. */
const NOT_THE_HINTS = new Set([401, 403, 429]);

/**
 * Meta Voice API file endpoint, documented at https://dev.meta.ai/docs/api-reference/voice/transcribe . `hints` bias
 * recognition toward the document's terms and language; when the provider refuses the request with them, it is sent once
 * more without, because a recording never fails over a hint.
 */
async function requestTranscript(
  config: MuseConfig,
  audio: Uint8Array,
  transport: typeof fetch = fetch,
  signal?: AbortSignal,
  hints?: VoiceHints,
): Promise<{ transcript: string }> {
  if (!validWav(audio)) throw new HttpError(400, 'invalid_audio', 'Send a valid mono PCM16 WAV recording at 16 kHz.');
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
  const send = async (bias?: VoiceHints): Promise<Response> => {
    const request = {
      model: 'muse-voice-transcribe-1.0',
      audioEncoding: 'WAV',
      mode: 'PUSH_TO_TALK',
      ...(bias?.keywords.length ? { keywords: bias.keywords } : {}),
      ...(bias?.languageBias.length ? { languageBias: bias.languageBias } : {}),
    };
    const body = new FormData();
    body.append('request', new Blob([JSON.stringify(request)], { type: 'application/json' }));
    body.append('audio', new Blob([new Uint8Array(audio)], { type: 'audio/wav' }), 'question.wav');
    try {
      return await transport(`${url.href.replace(/\/$/, '')}/asr/transcribe`, {
        method: 'POST',
        redirect: 'error',
        headers: { Authorization: `Bearer ${config.apiKey}`, Accept: 'application/json' },
        body,
        signal,
      });
    } catch {
      throw new HttpError(
        503,
        'voice_unavailable',
        'Transcription could not finish. Check your connection and try again.',
      );
    }
  };
  const biased = Boolean(hints?.keywords.length || hints?.languageBias.length);
  let response = await send(hints);
  if (biased && !response.ok && !NOT_THE_HINTS.has(response.status) && !signal?.aborted) {
    console.warn(JSON.stringify({ event: 'voice_hints_rejected', status: response.status }));
    await response.body?.cancel().catch(() => {});
    response = await send();
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
  if (typeof result?.transcript !== 'string')
    throw new HttpError(502, 'invalid_transcript', 'No readable transcript came back.');
  const transcript = result.transcript.replace(/\s+/g, ' ').trim();
  if (!transcript)
    throw new HttpError(422, 'empty_transcript', 'No speech was detected. Hold the microphone button and try again.');
  return { transcript };
}

/** Meta's ASR has a nonstandard multipart endpoint, exposed through the SDK provider contract. */
export function museTranscriptionModel(config: MuseConfig, transport: typeof fetch = fetch): TranscriptionModel {
  const modelId = 'muse-voice-transcribe-1.0';
  return {
    specificationVersion: 'v4',
    provider: 'muse.voice',
    modelId,
    async doGenerate(options) {
      const audio = typeof options.audio === 'string' ? Buffer.from(options.audio, 'base64') : options.audio;
      // The document's terms and language arrive as provider options (muse.keywords, muse.languageBias).
      const { transcript } = await requestTranscript(
        config,
        audio,
        transport,
        options.abortSignal,
        cleanHints(options.providerOptions?.muse),
      );
      return {
        text: transcript,
        segments: [],
        language: undefined,
        durationInSeconds: undefined,
        warnings: [],
        response: { timestamp: new Date(), modelId },
      };
    },
  };
}
