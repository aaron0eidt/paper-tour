import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpError } from './errors';
import type { Library } from './service';
import type { ReaderState } from '../../shared/contracts';
import type { SettingsUpdate } from '../../shared/settings';
import type { SettingsService } from './settings';

const uuid = { type: 'string', format: 'uuid' };
const documentParams = {
  type: 'object',
  required: ['id'],
  properties: { id: uuid },
};
const analysisQuery = {
  type: 'object',
  additionalProperties: false,
  properties: { analysisId: uuid },
};
const objectBody = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required,
});
interface Options {
  service: Library;
  authenticate(token: string): Promise<string | null>;
  origins?: string[];
  spaDir?: string;
  logger?: boolean;
  settings?: SettingsService;
}
export async function createApp(options: Options) {
  const app = Fastify({
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    logger: options.logger ? { redact: ['req.headers.authorization', 'req.body.apiKey'] } : false,
    bodyLimit: 65536,
  });
  await app.register(cors, { origin: options.origins ?? false });
  app.get('/health', async () => ({ status: 'ok' }));
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof HttpError)
      return reply.code(error.status).send({ error: { code: error.code, message: error.message } });
    if (error && typeof error === 'object' && 'validation' in error)
      return reply.code(400).send({
        error: {
          code: 'invalid_request',
          message: 'The request contains invalid or missing fields.',
        },
      });
    const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      return reply.code(status).send({
        error: {
          code: 'invalid_request',
          message: 'The request contains invalid or missing fields.',
        },
      });
    }
    if (request.url.startsWith('/api/settings')) request.log.error({ event: 'settings_request_failed' });
    else request.log.error(error);
    return reply.code(500).send({
      error: {
        code: 'internal_error',
        message: 'The request could not be completed. Please retry.',
      },
    });
  });
  await app.register(
    async (api) => {
      const owners = new WeakMap<object, string>();
      api.addHook('preHandler', async (request) => {
        const match = /^Bearer (\S+)$/.exec(request.headers.authorization ?? '');
        const owner = match ? await options.authenticate(match[1]) : null;
        if (!owner) throw new HttpError(401, 'unauthorized', 'Sign in to access your library.');
        owners.set(request, owner);
      });
      const owner = (r: object) => owners.get(r)!;
      const service = options.service;
      api.get('/models', async (req) => service.models(owner(req)));
      if (options.settings) {
        const settings = options.settings;
        api.get('/settings', async (req) => settings.get(owner(req)));
        api.patch<{ Body: SettingsUpdate }>('/settings', { schema: { body: objectBody({
          defaultModel: { type: 'string', minLength: 1, maxLength: 200 }, credentialSource: { enum: ['app', 'personal'] },
        }, []) } }, async (req) => {
          const result = await settings.update(owner(req), req.body);
          if (req.body.credentialSource) await service.resumeConfigured?.(owner(req));
          return result;
        });
        api.put<{ Body: { apiKey: string } }>('/settings/meta-key', { schema: { body: objectBody({ apiKey: { type: 'string', minLength: 16, maxLength: 8192 } }, ['apiKey']) } }, async (req) => {
          const result = await settings.saveKey(owner(req), req.body.apiKey);
          await service.resumeConfigured?.(owner(req));
          return result;
        });
        api.delete('/settings/meta-key', async (req) => settings.removeKey(owner(req)));
        api.post('/settings/test', async (req) => settings.test(owner(req)));
      }
      api.get('/documents', async (req) => ({
        documents: await service.list(owner(req)),
      }));
      api.post<{ Body: { filename: string; size: number; model?: string; allowTraining?: boolean } }>(
        '/documents',
        {
          schema: {
            body: objectBody(
              {
                filename: { type: 'string', minLength: 1, maxLength: 1024 },
                size: { type: 'integer', minimum: 1, maximum: 26214400 },
                model: { type: 'string', minLength: 1, maxLength: 200 },
                allowTraining: { type: 'boolean' },
              },
              ['filename', 'size'],
            ),
          },
        },
        async (req, reply) =>
          reply.code(201).send(
            await service.reserve(owner(req), req.body.filename, req.body.size, {
              model: req.body.model,
              allowTraining: req.body.allowTraining,
            }),
          ),
      );
      api.post<{ Params: { id: string } }>(
        '/documents/:id/complete',
        { schema: { params: documentParams } },
        async (req) => service.complete(owner(req), req.params.id),
      );
      api.post<{
        Params: { id: string };
        Body: { regenerate?: boolean; model?: string; allowTraining?: boolean } | undefined;
      }>(
        '/documents/:id/tours',
        {
          preValidation: async (req) => {
            if (req.body === undefined) req.body = {};
          },
          schema: {
            params: documentParams,
            body: objectBody(
              {
                regenerate: { type: 'boolean' },
                model: { type: 'string', minLength: 1, maxLength: 200 },
                allowTraining: { type: 'boolean' },
              },
              [],
            ),
          },
        },
        async (req) =>
          service.generateTour(owner(req), req.params.id, req.body?.regenerate ?? false, {
            model: req.body?.model,
            allowTraining: req.body?.allowTraining,
          }),
      );
      api.post<{ Params: { id: string } }>(
        '/documents/:id/analyze',
        { schema: { params: documentParams } },
        async (req) => service.analyze(owner(req), req.params.id),
      );
      api.get<{ Params: { id: string }; Querystring: { tourId?: string } }>(
        '/documents/:id/manifest',
        {
          schema: {
            params: documentParams,
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: { tourId: uuid },
            },
          },
        },
        async (req) => service.manifest(owner(req), req.params.id, req.query.tourId),
      );
      api.patch<{ Params: { id: string }; Body: { title: string } }>(
        '/documents/:id',
        {
          schema: {
            params: documentParams,
            body: objectBody({ title: { type: 'string', minLength: 1, maxLength: 300 } }, ['title']),
          },
        },
        async (req) => service.rename(owner(req), req.params.id, req.body.title),
      );
      api.delete<{ Params: { id: string } }>(
        '/documents/:id',
        { schema: { params: documentParams } },
        async (req, reply) => {
          await service.remove(owner(req), req.params.id);
          return reply.code(204).send();
        },
      );
      api.put<{ Params: { id: string }; Body: ReaderState }>(
        '/documents/:id/reader-state',
        {
          schema: {
            params: documentParams,
            body: objectBody(
              {
                page: { type: 'integer', minimum: 1, maximum: 100 },
                pageOffset: { type: 'number', minimum: 0, maximum: 1 },
                zoom: {
                  anyOf: [{ type: 'number', minimum: 0.1, maximum: 6 }, { type: 'null' }],
                },
                tourId: { anyOf: [uuid, { type: 'null' }] },
                stepId: {
                  anyOf: [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }],
                },
              },
              ['page', 'pageOffset', 'zoom', 'tourId', 'stepId'],
            ),
          },
        },
        async (req, reply) => {
          await service.saveState(owner(req), req.params.id, req.body);
          return reply.code(204).send();
        },
      );
      api.get<{
        Params: { id: string };
        Querystring: { analysisId?: string; q: string };
      }>(
        '/documents/:id/search',
        {
          schema: {
            params: documentParams,
            querystring: {
              ...analysisQuery,
              required: ['q'],
              properties: {
                analysisId: uuid,
                q: { type: 'string', maxLength: 300 },
              },
            },
          },
        },
        async (req) => ({
          hits: await service.search(owner(req), req.params.id, req.query.analysisId, req.query.q),
        }),
      );
      api.get<{ Params: { id: string }; Querystring: { analysisId?: string } }>(
        '/documents/:id/outline',
        { schema: { params: documentParams, querystring: analysisQuery } },
        async (req) => service.outline(owner(req), req.params.id, req.query.analysisId),
      );
      api.get<{
        Params: { id: string };
        Querystring: { analysisId?: string; ids: string };
      }>(
        '/documents/:id/elements',
        {
          schema: {
            params: documentParams,
            querystring: {
              ...analysisQuery,
              required: ['ids'],
              properties: {
                analysisId: uuid,
                ids: { type: 'string', maxLength: 3000 },
              },
            },
          },
        },
        async (req) => ({
          elements: await service.elements(
            owner(req),
            req.params.id,
            req.query.analysisId,
            req.query.ids.split(',').filter(Boolean),
          ),
        }),
      );
      api.get<{
        Params: { id: string; elementId: string };
        Querystring: { analysisId?: string };
      }>(
        '/documents/:id/figures/:elementId',
        {
          schema: {
            params: {
              type: 'object',
              required: ['id', 'elementId'],
              properties: {
                id: uuid,
                elementId: { type: 'string', minLength: 1, maxLength: 100 },
              },
            },
            querystring: analysisQuery,
          },
        },
        async (req) => service.figure(owner(req), req.params.id, req.query.analysisId, req.params.elementId),
      );
    },
    { prefix: '/api' },
  );
  if (options.spaDir && existsSync(resolve(options.spaDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: resolve(options.spaDir),
      prefix: '/',
    });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/') || req.method !== 'GET'
        ? reply.code(404).send({
            error: { code: 'not_found', message: 'Endpoint not found.' },
          })
        : reply.sendFile('index.html'),
    );
  } else {
    app.setNotFoundHandler((_req, reply) =>
      reply.code(404).send({ error: { code: 'not_found', message: 'Endpoint not found.' } }),
    );
  }
  return app;
}
