import type { FastifyInstance } from 'fastify';
import type { SpeechInput, SpeechPreferences } from '../../../shared/speech';
import type { SpeechService } from './service';
export function speechRoutes(api: FastifyInstance, speech: SpeechService, owner: (request: object) => string) {
  api.get('/speech/settings', async (request) => speech.get(owner(request)));
  api.put<{ Body: SpeechPreferences }>(
    '/speech/settings',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['provider', 'precompute', 'connections'],
          properties: {
            provider: { enum: ['browser', 'local', 'openai', 'elevenlabs'] },
            precompute: { type: 'boolean' },
            connections: {
              type: 'object',
              additionalProperties: false,
              required: ['local', 'openai', 'elevenlabs'],
              properties: Object.fromEntries(
                ['local', 'openai', 'elevenlabs'].map((provider) => [
                  provider,
                  {
                    type: 'object',
                    additionalProperties: false,
                    required: ['model', 'voice', 'credentialSource'],
                    properties: {
                      model: { type: 'string', minLength: 1, maxLength: 200 },
                      voice: { type: 'string', minLength: 1, maxLength: 100 },
                      credentialSource: { enum: ['app', 'personal'] },
                    },
                  },
                ]),
              ),
            },
          },
        },
      },
    },
    async (request) => speech.update(owner(request), request.body),
  );
  const params = {
    type: 'object',
    additionalProperties: false,
    required: ['provider'],
    properties: { provider: { enum: ['openai', 'elevenlabs'] } },
  };
  api.put<{ Params: { provider: 'openai' | 'elevenlabs' }; Body: { apiKey: string } }>(
    '/speech/keys/:provider',
    {
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['apiKey'],
          properties: { apiKey: { type: 'string', minLength: 16, maxLength: 8192 } },
        },
      },
    },
    async (request) => speech.saveKey(owner(request), request.params.provider, request.body.apiKey),
  );
  api.delete<{ Params: { provider: 'openai' | 'elevenlabs' } }>(
    '/speech/keys/:provider',
    { schema: { params } },
    async (request) => speech.removeKey(owner(request), request.params.provider),
  );
  api.post<{ Body: SpeechInput }>(
    '/speech/synthesize',
    {
      schema: {
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['text', 'language', 'version'],
          properties: {
            text: { type: 'string', minLength: 1, maxLength: 2500 },
            language: { type: 'string', minLength: 2, maxLength: 16 },
            version: { type: 'string', format: 'uuid' },
          },
        },
      },
    },
    async (request, reply) => {
      reply.header('Cache-Control', 'private, no-store');
      // A synthesis already in flight intentionally finishes into the private cache when playback
      // pauses/disconnects. Resume and lookahead share it instead of starting another billed request.
      // Provider timeout and the per-owner concurrency bound still apply.
      return speech.synthesize(owner(request), request.body);
    },
  );
}
