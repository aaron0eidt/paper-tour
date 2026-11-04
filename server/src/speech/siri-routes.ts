import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { DEFAULT_SPEECH_PREFERENCES, type SpeechSettings } from '../../../shared/speech';
import { HttpError } from '../errors';
import type { SiriRuntime } from './siri';

function localRequest(request: FastifyRequest, origins: string[]) {
  const host = (request.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
  const address = request.socket.remoteAddress ?? '';
  const origin = request.headers.origin;
  return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(host) &&
    (address === '::1' || /^(?:::ffff:)?127\.\d+\.\d+\.\d+$/.test(address)) &&
    (!origin || origin === `${request.protocol}://${request.headers.host}` || origins.includes(origin));
}

/** Read access follows the enclosing API; native install actions always require this Mac. */
export function siriRoutes(api: FastifyInstance, siri: SiriRuntime, origins: string[], local = false) {
  if (local) api.addHook('onRequest', async (request) => {
    if (!localRequest(request, origins)) throw new HttpError(404, 'not_found', 'Endpoint not found.');
  });
  api.get<{ Querystring: { refresh?: '1' } }>('/speech/siri', {
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { refresh: { enum: ['1'] } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    const status = await siri.status(request.query.refresh === '1');
    return { ...status, canInstall: status.canInstall && localRequest(request, origins) };
  });
  api.post<{ Body: { action?: 'start' | 'pause'; voiceId?: string } }>('/speech/siri/setup', {
    schema: { body: { type: 'object', additionalProperties: false,
      properties: { action: { enum: ['start', 'pause'] }, voiceId: { type: 'string', minLength: 1, maxLength: 200 } } } },
  }, async (request, reply) => {
    if (!localRequest(request, origins)) throw new HttpError(403, 'siri_setup_local_only', 'Set up Siri from a browser on the Mac running Paper Tour.');
    reply.header('Cache-Control', 'no-store');
    return request.body.action === 'pause' ? siri.pause() : siri.start(request.body.voiceId);
  });
  if (!local) return;
  // Local speech: this endpoint can only use native Siri, never a server's paid cloud keys.
  const version = randomUUID();
  api.get('/speech/settings', async (): Promise<SpeechSettings> => {
    const status = await siri.status();
    const preferences = structuredClone(DEFAULT_SPEECH_PREFERENCES);
    preferences.provider = status.supported ? 'siri' : 'browser';
    const missing = { configured: false, appKeyAvailable: false, personalKey: { configured: false, masked: null }, message: 'Sign in to configure cloud speech.' };
    return { preferences, version, providers: { openai: missing, elevenlabs: missing,
      siri: { ...missing, configured: status.cliReady && status.installed > 0, appKeyAvailable: status.supported, message: status.message } } };
  });
  api.post<{ Body: { text: string; language: string; version: string; voice: string } }>('/speech/synthesize', {
    schema: { body: { type: 'object', additionalProperties: false, required: ['text', 'language', 'version', 'voice'],
      properties: { text: { type: 'string', minLength: 1, maxLength: 2500 }, language: { type: 'string', minLength: 2, maxLength: 16 },
        version: { type: 'string', format: 'uuid' }, voice: { type: 'string', minLength: 1, maxLength: 200 } } } },
  }, async (request, reply) => {
    reply.header('Cache-Control', 'private, no-store');
    if (!request.body.text.trim()) throw new HttpError(400, 'speech_input_invalid', 'Speech needs some text.');
    return { ...await siri.synthesize(request.body.text, request.body.language, request.body.voice), cached: false };
  });
}
