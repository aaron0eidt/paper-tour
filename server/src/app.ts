import type { TourModelSelection } from '../../shared/contracts';
import type { TourProfileDraft } from '../../shared/tourProfiles';
import { TOUR_STRUCTURES, TOUR_DEPTHS, TOUR_AUDIENCES } from '../../shared/tourProfiles';
import { pipeUIMessageStreamToResponse } from 'ai';
import { activityFrames, activityUIStream } from './ai/activity-stream';
import { RESPONSE_LANGUAGES } from '../../shared/languages';
import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import type { Readable } from 'node:stream';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpError } from './errors';
import type { Library } from './service';
import type { ReaderState } from '../../shared/contracts';
import type { CreateConversation } from '../../shared/conversations';
import type { VisualArtifactService } from './visuals/artifacts';
import { visualArtifactRoutes } from './visuals/routes';
import type { SettingsUpdate } from '../../shared/settings';
import type { SettingsService } from './settings';
import { DEMO_PAPER, answerResponse, type AskAnswer, type AskRequest } from './harness/ask';
import { snapService, type SnapRequest, type SnapResult, type SnapService } from './snap';

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
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const askBody = objectBody(
  {
    question: { type: 'string', minLength: 1 },
    tourId: uuid,
    analysisId: uuid,
    conversationId: uuid,
    page: { type: 'integer', minimum: 1 },
    activeVisual: { type: 'object' },
    visualId: uuid,
    visualRevision: { type: 'integer', minimum: 1 },
    selection: objectBody(
      {
        page: { type: 'integer', minimum: 1 },
        rect: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number', minimum: 0, maximum: 1 } },
      },
      ['page', 'rect'],
    ),
    stepId: text(200),
    figureId: text(100),
    responseLanguage: { enum: Object.keys(RESPONSE_LANGUAGES) },
    history: {
      type: 'array',
      maxItems: 4,
      items: objectBody({ question: { type: 'string', minLength: 1 }, answer: text(2000) }, ['question', 'answer']),
    },
  },
  ['question'],
);
const conversationParams = objectBody({ id: uuid, conversationId: uuid }, ['id', 'conversationId']);
const conversationContextBody = {
  ...askBody,
  required: [],
  properties: Object.fromEntries(
    Object.entries(askBody.properties).filter(
      ([key]) => !['question', 'history', 'conversationId', 'responseLanguage'].includes(key),
    ),
  ),
};
/** A loose box on a page, in PDF points; snap.ts checks it against the page. */
const snapBody = (properties: Record<string, unknown> = {}) =>
  objectBody(
    {
      page: { type: 'integer', minimum: 1 },
      box: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number' } },
      ...properties,
    },
    ['page', 'box'],
  );
interface Options {
  service: Library;
  authenticate(token: string): Promise<string | null>;
  origins?: string[];
  spaDir?: string;
  logger?: boolean;
  settings?: SettingsService;
  /** Questions about demo papers without signing in; defaults to demoAllowed() for this process. */
  demo?: boolean;
  /** Region snapping (snap.ts); defaults to one built from the service and settings when they can provide it. */
  snap?: SnapService;
  visualArtifacts?: VisualArtifactService;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Demo papers can be asked about without signing in, on the server's own Meta key, only in local development: not in
 * production, and with the API listening on a loopback address (config.ts defaults HOST to 127.0.0.1).
 */
export function demoAllowed(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV !== 'production' && LOOPBACK_HOSTS.has((env.HOST ?? '127.0.0.1').trim().toLowerCase());
}

/** A request from this machine, addressed to a local name (which also turns away DNS rebinding). */
function fromLocalhost(request: { socket: { remoteAddress?: string }; headers: { host?: string } }): boolean {
  const address = request.socket.remoteAddress ?? '';
  const local = address === '::1' || /^(?:::ffff:)?127\.\d+\.\d+\.\d+$/.test(address);
  const host = (request.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
  return local && LOOPBACK_HOSTS.has(host);
}

/** Run a model call that stops when the learner cancels or leaves. */
async function whileConnected<T>(reply: FastifyReply, run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const cancel = () => {
    if (!reply.raw.writableFinished) controller.abort();
  };
  reply.raw.once('close', cancel);
  try {
    return await run(controller.signal);
  } finally {
    reply.raw.off('close', cancel);
  }
}
export async function createApp(options: Options) {
  const snap = options.snap ?? snapService(options.service, options.settings);
  const app = Fastify({
    ajv: { customOptions: { coerceTypes: false, removeAdditional: false } },
    logger: options.logger ? { redact: ['req.headers.authorization', 'req.body.apiKey'] } : false,
    bodyLimit: 65536,
  });
  app.addContentTypeParser('audio/wav', {}, async (_req: FastifyRequest, payload: Readable) => {
    const chunks: Buffer[] = [];
    for await (const chunk of payload) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
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
      if (options.visualArtifacts) visualArtifactRoutes(api, options.visualArtifacts, owner);
      api.post<{ Params: { id: string }; Body: Buffer }>(
        '/documents/:id/transcribe',
        { schema: { params: documentParams } },
        async (req, reply) => {
          if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'invalid_audio', 'Send a WAV recording.');
          if (!service.transcribe) throw new HttpError(503, 'voice_unavailable', 'Voice input is unavailable.');
          return whileConnected(reply, (signal) => service.transcribe!(owner(req), req.params.id, req.body, signal));
        },
      );
      api.get('/models', async (req) => service.models(owner(req)));
      const profileFields = {
        name: text(80),
        instructions: { type: 'string', maxLength: 6000 },
        structure: { enum: TOUR_STRUCTURES },
        depth: { enum: TOUR_DEPTHS },
        audience: { enum: TOUR_AUDIENCES },
      };
      api.get('/tour-profiles', async (req) => {
        if (!service.tourProfiles) throw new HttpError(503, 'profiles_unavailable', 'Tour profiles are unavailable.');
        return service.tourProfiles(owner(req));
      });
      api.post<{ Body: TourProfileDraft }>(
        '/tour-profiles',
        {
          schema: { body: objectBody(profileFields, ['name', 'instructions', 'structure', 'depth', 'audience']) },
        },
        async (req, reply) => {
          if (!service.createTourProfile)
            throw new HttpError(503, 'profiles_unavailable', 'Tour profiles are unavailable.');
          return reply.code(201).send(await service.createTourProfile(owner(req), req.body));
        },
      );
      api.put<{ Params: { profileId: string }; Body: TourProfileDraft & { expectedRevision: number } }>(
        '/tour-profiles/:profileId',
        {
          schema: {
            params: objectBody({ profileId: uuid }, ['profileId']),
            body: objectBody({ ...profileFields, expectedRevision: { type: 'integer', minimum: 1 } }, [
              'name',
              'instructions',
              'structure',
              'depth',
              'audience',
              'expectedRevision',
            ]),
          },
        },
        async (req) => {
          if (!service.reviseTourProfile)
            throw new HttpError(503, 'profiles_unavailable', 'Tour profiles are unavailable.');
          const { expectedRevision, ...draft } = req.body;
          return service.reviseTourProfile(owner(req), req.params.profileId, expectedRevision, draft);
        },
      );

      if (options.settings) {
        const settings = options.settings;
        api.get('/settings', async (req) => settings.get(owner(req)));
        api.patch<{ Body: SettingsUpdate }>(
          '/settings',
          {
            schema: {
              body: objectBody(
                {
                  defaultModel: { type: 'string', minLength: 1, maxLength: 200 },
                  credentialSource: { enum: ['app', 'personal'] },
                },
                [],
              ),
            },
          },
          async (req) => {
            const result = await settings.update(owner(req), req.body);
            if (req.body.credentialSource) await service.resumeConfigured?.(owner(req));
            return result;
          },
        );
        api.put<{ Body: { apiKey: string } }>(
          '/settings/meta-key',
          { schema: { body: objectBody({ apiKey: { type: 'string', minLength: 16, maxLength: 8192 } }, ['apiKey']) } },
          async (req) => {
            const result = await settings.saveKey(owner(req), req.body.apiKey);
            await service.resumeConfigured?.(owner(req));
            return result;
          },
        );
        api.delete('/settings/meta-key', async (req) => settings.removeKey(owner(req)));
        api.post('/settings/test', async (req) => settings.test(owner(req)));
      }
      for (const runRoute of [false, true])
        api.get<{ Params: { id: string; generationId: string }; Querystring: { after?: string; format?: 'ui' } }>(
          runRoute
            ? '/documents/:id/agent-runs/:generationId/events'
            : '/documents/:id/generations/:generationId/events',
          {
            schema: {
              params: {
                type: 'object',
                required: ['id', 'generationId'],
                properties: { id: uuid, generationId: uuid },
              },
              querystring: {
                type: 'object',
                additionalProperties: false,
                properties: {
                  after: { type: 'string', pattern: '^[0-9]{1,18}$' },
                  format: { type: 'string', enum: ['ui'] },
                },
              },
            },
          },
          async (req, reply) => {
            if (!service.activity) throw new HttpError(503, 'activity_unavailable', 'Activity is unavailable.');
            let generationId = req.params.generationId;
            if (runRoute) {
              if (!service.agentRun) throw new HttpError(503, 'agent_unavailable', 'Agent runs are unavailable.');
              generationId = (await service.agentRun(owner(req), req.params.id, req.params.generationId)).generationId;
            }
            const cursor = req.query.after ?? '0';
            const batch = await service.activity(owner(req), req.params.id, generationId, cursor);
            reply
              .header('Content-Type', 'text/event-stream')
              .header('Cache-Control', 'no-store')
              .header('X-Accel-Buffering', 'no');
            // Fastify applies CORS headers before we take ownership of the stream.
            reply.hijack();
            const controller = new AbortController();
            const close = () => controller.abort();
            reply.raw.on('close', close);
            const frames = activityFrames(
              batch,
              (after) => service.activity!(owner(req), req.params.id, generationId, after),
              cursor,
              controller.signal,
            );
            if (req.query.format === 'ui') {
              try {
                await pipeUIMessageStreamToResponse({
                  response: reply.raw,
                  headers: Object.fromEntries(
                    Object.entries(reply.getHeaders()).map(([key, value]) => [key, String(value)]),
                  ),
                  stream: activityUIStream(frames, generationId),
                });
              } finally {
                reply.raw.off('close', close);
                controller.abort();
              }
              return;
            }
            reply.raw.writeHead(
              200,
              Object.fromEntries(
                Object.entries(reply.getHeaders())
                  .filter(([, value]) => value !== undefined)
                  .map(([key, value]) => [key, Array.isArray(value) ? value : String(value)]),
              ),
            );

            const send = async (value: unknown) => {
              if (controller.signal.aborted) return;
              if (!reply.raw.write(`data: ${JSON.stringify(value)}\n\n`)) {
                await new Promise<void>((resolve) => {
                  const done = () => {
                    reply.raw.off('drain', done);
                    controller.signal.removeEventListener('abort', done);
                    resolve();
                  };
                  reply.raw.once('drain', done);
                  controller.signal.addEventListener('abort', done, { once: true });
                });
              }
            };
            try {
              for await (const frame of frames) await send(frame);
            } catch {
              if (!controller.signal.aborted) await send({ error: 'Activity interrupted. Reconnecting…' });
            } finally {
              reply.raw.off('close', close);
              reply.raw.end();
            }
          },
        );
      // The leading steps of a tour still being written; the contract is TourPartialView in tour-partial.ts.
      api.get<{ Params: { id: string; generationId: string }; Querystring: { after?: string; attempt?: string } }>(
        '/documents/:id/generations/:generationId/partial',
        {
          schema: {
            params: {
              type: 'object',
              required: ['id', 'generationId'],
              properties: { id: uuid, generationId: uuid },
            },
            querystring: {
              type: 'object',
              additionalProperties: false,
              properties: { after: { type: 'string', pattern: '^[0-9]{1,6}$' }, attempt: uuid },
            },
          },
        },
        async (req, reply) => {
          if (!service.partial) throw new HttpError(503, 'partial_unavailable', 'Partial tours are unavailable.');
          const { after, attempt } = req.query;
          reply.header('Cache-Control', 'no-store');
          return service.partial(
            owner(req),
            req.params.id,
            req.params.generationId,
            after !== undefined && attempt ? { after: Number(after), attempt } : undefined,
          );
        },
      );
      api.get<{ Params: { id: string; runId: string } }>(
        '/documents/:id/agent-runs/:runId',
        { schema: { params: { type: 'object', required: ['id', 'runId'], properties: { id: uuid, runId: uuid } } } },
        async (req) => {
          if (!service.agentRun) throw new HttpError(503, 'agent_unavailable', 'Agent runs are unavailable.');
          return service.agentRun(owner(req), req.params.id, req.params.runId);
        },
      );
      for (const action of ['pause', 'resume', 'cancel'] as const)
        api.post<{ Params: { id: string; runId: string } }>(
          `/documents/:id/agent-runs/:runId/${action}`,
          { schema: { params: { type: 'object', required: ['id', 'runId'], properties: { id: uuid, runId: uuid } } } },
          async (req) => {
            if (!service.controlAgent) throw new HttpError(503, 'agent_unavailable', 'Agent controls are unavailable.');
            return service.controlAgent(owner(req), req.params.id, req.params.runId, action);
          },
        );
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
        Body: (TourModelSelection & { regenerate?: boolean }) | undefined;
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
                profileId: text(120),
                profileRevision: { type: 'integer', minimum: 1 },
                depth: { enum: TOUR_DEPTHS },
                audience: { enum: TOUR_AUDIENCES },
                model: { type: 'string', minLength: 1, maxLength: 200 },
                allowTraining: { type: 'boolean' },
              },
              [],
            ),
          },
        },
        async (req) => {
          const { regenerate = false, ...selection } = req.body ?? {};
          return service.generateTour(owner(req), req.params.id, regenerate, selection);
        },
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
      api.get<{ Params: { id: string } }>(
        '/documents/:id/conversations',
        { schema: { params: documentParams } },
        async (req) => {
          if (!service.conversations)
            throw new HttpError(
              503,
              'conversations_unavailable',
              'Saved conversations are not available on this server.',
            );
          return { conversations: await service.conversations(owner(req), req.params.id) };
        },
      );
      api.post<{ Params: { id: string }; Body: CreateConversation }>(
        '/documents/:id/conversations',
        {
          schema: {
            params: documentParams,
            body: objectBody({ title: text(160), context: conversationContextBody }, []),
          },
        },
        async (req, reply) => {
          if (!service.createConversation)
            throw new HttpError(
              503,
              'conversations_unavailable',
              'Saved conversations are not available on this server.',
            );
          return reply.code(201).send(await service.createConversation(owner(req), req.params.id, req.body));
        },
      );
      api.get<{ Params: { id: string; conversationId: string } }>(
        '/documents/:id/conversations/:conversationId',
        { schema: { params: conversationParams } },
        async (req) => {
          if (!service.conversation)
            throw new HttpError(
              503,
              'conversations_unavailable',
              'Saved conversations are not available on this server.',
            );
          return service.conversation(owner(req), req.params.id, req.params.conversationId);
        },
      );
      api.patch<{ Params: { id: string; conversationId: string }; Body: { title: string } }>(
        '/documents/:id/conversations/:conversationId',
        { schema: { params: conversationParams, body: objectBody({ title: text(160) }, ['title']) } },
        async (req) => {
          if (!service.renameConversation)
            throw new HttpError(
              503,
              'conversations_unavailable',
              'Saved conversations are not available on this server.',
            );
          return service.renameConversation(owner(req), req.params.id, req.params.conversationId, req.body.title);
        },
      );
      api.post<{ Params: { id: string }; Body: AskRequest }>(
        '/documents/:id/ask',
        { bodyLimit: 300000, schema: { params: documentParams, body: askBody } },
        async (req, reply): Promise<AskAnswer | FastifyReply> => {
          const ask = service.ask?.bind(service);
          if (!ask) throw new HttpError(503, 'ask_unavailable', 'Questions are not available on this server.');
          return whileConnected(reply, (signal) =>
            answerResponse(reply, req.headers.accept, () => ask(owner(req), req.params.id, req.body, signal)),
          );
        },
      );
      // A loose box dragged over a figure, answered with the outline of the object inside it (snap.ts).
      api.post<{ Params: { id: string }; Body: SnapRequest }>(
        '/documents/:id/snap',
        { schema: { params: documentParams, body: snapBody({ analysisId: uuid }) } },
        async (req, reply): Promise<SnapResult> => {
          if (!snap) throw new HttpError(503, 'snap_unavailable', 'Snapping is not available on this server.');
          return whileConnected(reply, (signal) => snap.snap(owner(req), req.params.id, req.body, signal));
        },
      );
    },
    { prefix: '/api' },
  );
  // Demo papers (demo/<paper>/) are not in anyone's library, so this route has no sign-in: it exists only in local
  // development, answers only this machine, and reads only folders under demo/ (harness/ask.ts, loadDemo).
  if (options.demo ?? demoAllowed())
    await app.register(
      async (demo) => {
        demo.addHook('onRequest', async (request) => {
          if (!fromLocalhost(request)) throw new HttpError(404, 'not_found', 'Endpoint not found.');
        });
        demo.post<{ Params: { paper: string }; Body: Buffer }>(
          '/:paper/transcribe',
          {
            schema: {
              params: {
                type: 'object',
                required: ['paper'],
                properties: { paper: { type: 'string', pattern: DEMO_PAPER.source } },
              },
            },
          },
          async (req, reply) => {
            if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'invalid_audio', 'Send a WAV recording.');
            if (!options.service.demoTranscribe)
              throw new HttpError(503, 'voice_unavailable', 'Voice input is unavailable.');
            return whileConnected(reply, (signal) =>
              options.service.demoTranscribe!(req.params.paper, req.body, signal),
            );
          },
        );
        demo.post<{ Params: { paper: string }; Body: AskRequest }>(
          '/:paper/ask',
          {
            schema: {
              params: {
                type: 'object',
                required: ['paper'],
                properties: { paper: { type: 'string', pattern: DEMO_PAPER.source } },
              },
              body: askBody,
            },
          },
          async (req, reply): Promise<AskAnswer | FastifyReply> => {
            const ask = options.service.demoAsk?.bind(options.service);
            if (!ask) throw new HttpError(503, 'ask_unavailable', 'Questions are not available on this server.');
            return whileConnected(reply, (signal) =>
              answerResponse(reply, req.headers.accept, () => ask(req.params.paper, req.body, signal)),
            );
          },
        );
        demo.post<{ Params: { paper: string }; Body: SnapRequest }>(
          '/:paper/snap',
          {
            schema: {
              params: {
                type: 'object',
                required: ['paper'],
                properties: { paper: { type: 'string', pattern: DEMO_PAPER.source } },
              },
              body: snapBody(),
            },
          },
          async (req, reply): Promise<SnapResult> => {
            if (!snap) throw new HttpError(503, 'snap_unavailable', 'Snapping is not available on this server.');
            return whileConnected(reply, (signal) => snap.demoSnap(req.params.paper, req.body, signal));
          },
        );
      },
      { prefix: '/api/demo' },
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
