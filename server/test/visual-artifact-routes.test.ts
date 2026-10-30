import test from 'node:test';
import assert from 'node:assert/strict';
import Fastify from 'fastify';
import type { VisualArtifactService } from '../src/visuals/artifacts';
import { visualArtifactRoutes } from '../src/visuals/routes';
import { attention } from './fixtures/authored-visuals';

test('visual API pins analysis and parses route revision without global coercion', async () => {
  const doc = '00000000-0000-4000-8000-000000000001',
    analysis = '00000000-0000-4000-8000-000000000002',
    visual = '00000000-0000-4000-8000-000000000003';
  const calls: unknown[][] = [];
  const service = {
    create: async (...args: unknown[]) => {
      calls.push(args);
      return { ok: true };
    },
    get: async (...args: unknown[]) => {
      calls.push(args);
      return { ok: true };
    },
    revise: async (...args: unknown[]) => {
      calls.push(args);
      return { ok: true };
    },
  } as unknown as VisualArtifactService;
  const app = Fastify({ ajv: { customOptions: { coerceTypes: false } } });
  visualArtifactRoutes(app, service, () => 'owner');
  try {
    assert.equal(
      (await app.inject({ method: 'POST', url: `/documents/${doc}/visuals`, payload: { item: attention } })).statusCode,
      400,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/documents/${doc}/visuals`,
          payload: { analysisId: analysis, item: attention },
        })
      ).statusCode,
      200,
    );
    assert.equal((calls[0][2] as { analysisId: string }).analysisId, analysis);
    assert.equal((await app.inject({ method: 'GET', url: `/documents/${doc}/visuals/${visual}/2` })).statusCode, 200);
    assert.equal((calls[1][2] as { revision: number }).revision, 2);
    assert.equal((await app.inject({ method: 'GET', url: `/documents/${doc}/visuals/${visual}/0` })).statusCode, 400);
  } finally {
    await app.close();
  }
});
