import { pipeUIMessageStreamToResponse } from 'ai';
import type { FastifyInstance } from 'fastify';
import { setTimeout as delay } from 'node:timers/promises';
import type { Library } from './service';
import { activityUIStream } from './ai/activity-stream';
import { HttpError } from './errors';
import type { DocumentActivityFrame } from '../../shared/agentActivity';

const uuid = { type: 'string', format: 'uuid' };
const params = { type: 'object', required: ['id'], properties: { id: uuid } };
const runParams = { type: 'object', required: ['id', 'runId'], properties: { id: uuid, runId: uuid } };

/** SDK data parts are transport; authorization, history and workflow control stay in the application. */
export function documentActivityRoutes(api: FastifyInstance, service: Library, owner: (request: object) => string) {
  const store = () => {
    if (!service.documentActivity) throw new HttpError(503, 'activity_unavailable', 'Activity is unavailable.');
    return service.documentActivity;
  };
  api.get<{ Params: { id: string }; Querystring: { before?: string } }>(
    '/documents/:id/activity',
    {
      schema: { params, querystring: { type: 'object', additionalProperties: false, properties: { before: uuid } } },
    },
    (request) => store()!.list(owner(request), request.params.id, request.query.before),
  );

  api.get<{ Params: { id: string }; Querystring: { after?: string } }>(
    '/documents/:id/activity/events',
    {
      schema: {
        params,
        querystring: {
          type: 'object',
          additionalProperties: false,
          properties: { after: { type: 'string', pattern: '^[0-9]{1,18}$' } },
        },
      },
    },
    async (request, reply) => {
      const activity = store()!;
      let cursor = request.query.after ?? '0';
      // Check ownership before hijacking a response, so auth failures remain ordinary HTTP failures.
      const initial = await activity.changes(owner(request), request.params.id, cursor);
      const controller = new AbortController();
      const close = () => controller.abort();
      reply.raw.once('close', close);
      reply.header('Cache-Control', 'no-store').header('X-Accel-Buffering', 'no').hijack();
      const frames = async function* (): AsyncGenerator<DocumentActivityFrame> {
        const end = Date.now() + 20_000;
        let frame = initial;
        let previous = '';
        while (!controller.signal.aborted) {
          const key = JSON.stringify(frame);
          if (key !== previous) yield frame;
          previous = key;
          cursor = frame.cursor ?? cursor;
          if (Date.now() >= end) return;
          try {
            await delay(frame.operations?.length === 100 ? 0 : 900, undefined, { signal: controller.signal });
            frame = await activity.changes(owner(request), request.params.id, cursor);
          } catch {
            if (!controller.signal.aborted) yield { error: 'Live activity disconnected. Reconnecting…' };
            return;
          }
        }
      };
      try {
        await pipeUIMessageStreamToResponse({
          response: reply.raw,
          headers: Object.fromEntries(Object.entries(reply.getHeaders()).map(([key, value]) => [key, String(value)])),
          stream: activityUIStream(frames(), `document:${request.params.id}`),
        });
      } finally {
        reply.raw.off('close', close);
        controller.abort();
      }
    },
  );

  api.post<{ Params: { id: string; runId: string }; Body: { action: 'pause' | 'resume' | 'cancel' } }>(
    '/documents/:id/activity/:runId/control',
    {
      schema: {
        params: runParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['action'],
          properties: { action: { enum: ['pause', 'resume', 'cancel'] } },
        },
      },
    },
    async (request, reply) => {
      const activity = store()!;
      // Tours keep their durable pg-boss pause/resume and exactly-once tool execution.
      if (service.controlDocumentActivity)
        await service.controlDocumentActivity(
          owner(request),
          request.params.id,
          request.params.runId,
          request.body.action,
        );
      else await activity.control(owner(request), request.params.id, request.params.runId, request.body.action);
      return reply.code(204).send();
    },
  );

  api.post<{
    Params: { id: string; runId: string };
    Body: {
      completed: number;
      total: number;
      status?: 'completed' | 'paused' | 'failed';
      preview?: string;
      previewState?: 'running' | 'completed' | 'failed';
    };
  }>(
    '/documents/:id/activity/:runId/progress',
    {
      schema: {
        params: runParams,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['completed', 'total'],
          properties: {
            completed: { type: 'integer', minimum: 0 },
            total: { type: 'integer', minimum: 0 },
            status: { enum: ['completed', 'paused', 'failed'] },
            preview: { type: 'string', minLength: 1, maxLength: 200 },
            previewState: { enum: ['running', 'completed', 'failed'] },
          },
        },
      },
    },
    async (request, reply) => {
      await store()!.readingProgress(owner(request), request.params.id, request.params.runId, request.body);
      return reply.code(204).send();
    },
  );
}
