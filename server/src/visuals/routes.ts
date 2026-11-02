import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BoardItem } from '../../../shared/paper';
import type { VisualArtifactInput } from '../../../shared/visualArtifacts';
import type { VisualArtifactService } from './artifacts';
import { inspectAuthoredVisual, isAuthoredVisual } from './inspect';
import { checkBoard } from '../harness/board';
import { HttpError } from '../errors';

async function inspectUpload(item: BoardItem) {
  if (!item || !isAuthoredVisual(item))
    throw new HttpError(400, 'invalid_visual', 'Upload an authored program or plot.');
  const checked = checkBoard(item.kind, item);
  if (checked.problems.length) throw new HttpError(400, 'invalid_visual', checked.problems.join('; '));
  const review = await inspectAuthoredVisual(item, AbortSignal.timeout(10000));
  if (review.problems.length) throw new HttpError(400, 'invalid_visual', review.problems.join('; '));
}
const uuid = { type: 'string', format: 'uuid' };
const ref = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'revision'],
  properties: { id: uuid, revision: { type: 'integer', minimum: 1 } },
};
const params = {
  type: 'object',
  required: ['id', 'visualId', 'revision'],
  properties: { id: uuid, visualId: uuid, revision: { type: 'string', pattern: '^[1-9][0-9]{0,6}$' } },
};
/** Register inside the application's authenticated API plugin, with its already-verified owner resolver. */
export function visualArtifactRoutes(
  app: FastifyInstance,
  service: VisualArtifactService,
  owner: (request: FastifyRequest) => string,
) {
  app.get<{ Params: { id: string; visualId: string; revision: string } }>(
    '/documents/:id/visuals/:visualId/:revision',
    { schema: { params } },
    (request) =>
      service.get(owner(request), request.params.id, {
        id: request.params.visualId,
        revision: Number(request.params.revision),
      }),
  );
  app.post<{ Params: { id: string }; Body: VisualArtifactInput }>(
    '/documents/:id/visuals',
    {
      bodyLimit: 300000,
      schema: {
        params: { type: 'object', required: ['id'], properties: { id: uuid } },
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['item', 'analysisId'],
          properties: { analysisId: uuid, item: { type: 'object' }, conversationId: uuid, tourId: uuid, parent: ref },
        },
      },
    },
    async (request) => {
      await inspectUpload(request.body.item);
      return service.create(owner(request), request.params.id, request.body);
    },
  );
  app.post<{ Params: { id: string; visualId: string; revision: string }; Body: { item: BoardItem } }>(
    '/documents/:id/visuals/:visualId/:revision',
    {
      bodyLimit: 300000,
      schema: {
        params,
        body: {
          type: 'object',
          additionalProperties: false,
          required: ['item'],
          properties: { item: { type: 'object' } },
        },
      },
    },
    async (request) => {
      await inspectUpload(request.body.item);
      return service.revise(
        owner(request),
        request.params.id,
        { id: request.params.visualId, revision: Number(request.params.revision) },
        request.body.item,
      );
    },
  );
}
