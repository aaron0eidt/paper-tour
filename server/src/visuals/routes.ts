import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { BoardItem } from '../../../shared/paper';
import type { VisualArtifactInput } from '../../../shared/visualArtifacts';
import type { VisualArtifactService } from './artifacts';
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
    (request) => service.create(owner(request), request.params.id, request.body),
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
    (request) =>
      service.revise(
        owner(request),
        request.params.id,
        { id: request.params.visualId, revision: Number(request.params.revision) },
        request.body.item,
      ),
  );
}
