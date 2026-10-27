import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import type { Library } from '../src/service';
import { HttpError } from '../src/errors';
const id = '7694558d-f7e2-4cbd-9355-978ec677b254';
function service(overrides: Partial<Library> = {}): Library {
  return new Proxy(overrides, {
    get: (target, key) =>
      key in target
        ? target[key as keyof Library]
        : async () => {
            throw new Error(`Unexpected service call: ${String(key)}`);
          },
  }) as Library;
}
test('every library endpoint requires a verified token', async () => {
  const app = await createApp({
    service: service(),
    authenticate: async () => null,
  });
  try {
    for (const url of [
      '/api/models',
      '/api/documents',
      `/api/documents/${id}/manifest`,
      `/api/documents/${id}/search?q=test`,
      `/api/documents/${id}/outline`,
      `/api/documents/${id}/elements?ids=fig1`,
      `/api/documents/${id}/figures/fig1`,
    ]) {
      const response = await app.inject({ url });
      assert.equal(response.statusCode, 401, url);
      assert.equal(response.json().error.code, 'unauthorized');
    }
    assert.equal((await app.inject({ url: '/health' })).statusCode, 200);
  } finally {
    await app.close();
  }
});
test('the server uses the verified identity and masks internal failures', async () => {
  let called = '';
  const app = await createApp({
    authenticate: async (token) => (token === 'valid' ? 'actual-owner' : null),
    service: service({
      list: async (owner) => {
        called = owner;
        return [];
      },
      manifest: async () => {
        throw new Error('database_password=never_expose');
      },
    }),
  });
  try {
    const response = await app.inject({
      url: '/api/documents',
      headers: { authorization: 'Bearer valid' },
    });
    assert.deepEqual(response.json(), { documents: [] });
    assert.equal(called, 'actual-owner');
    const failure = await app.inject({
      url: `/api/documents/${id}/manifest`,
      headers: { authorization: 'Bearer valid' },
    });
    assert.equal(failure.statusCode, 500);
    assert.ok(!failure.body.includes('password'));
  } finally {
    await app.close();
  }
});
test('invalid positions and upload reservations fail before reaching persistence', async () => {
  const app = await createApp({
    authenticate: async () => 'owner',
    service: service(),
  });
  try {
    for (const payload of [
      { page: 0, pageOffset: 0, zoom: 1, tourId: null, stepId: null },
      { page: 1, pageOffset: 2, zoom: 1, tourId: null, stepId: null },
      { page: 1, pageOffset: 0, zoom: -2, tourId: null, stepId: null },
    ])
      assert.equal(
        (
          await app.inject({
            method: 'PUT',
            url: `/api/documents/${id}/reader-state`,
            headers: { authorization: 'Bearer valid' },
            payload,
          })
        ).statusCode,
        400,
      );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/documents',
          headers: { authorization: 'Bearer valid' },
          payload: { filename: 'paper.pdf', size: 30 * 1024 * 1024 },
        })
      ).statusCode,
      400,
    );
  } finally {
    await app.close();
  }
});
test('ownership denials keep the generic 404 contract', async () => {
  const app = await createApp({
    authenticate: async () => 'owner',
    service: service({
      manifest: async () => {
        throw new HttpError(404, 'not_found', 'Document or element not found.');
      },
    }),
  });
  try {
    const r = await app.inject({
      url: `/api/documents/${id}/manifest`,
      headers: { authorization: 'Bearer valid' },
    });
    assert.equal(r.statusCode, 404);
    assert.equal(r.json().error.code, 'not_found');
  } finally {
    await app.close();
  }
});

test('malformed JSON and empty JSON bodies remain client errors', async () => {
  const app = await createApp({
    service: service(),
    authenticate: async () => 'owner',
  });
  try {
    for (const payload of ['', '{']) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/documents/${id}/complete`,
        headers: {
          authorization: 'Bearer valid',
          'content-type': 'application/json',
        },
        payload,
      });
      assert.equal(response.statusCode, 400);
      assert.equal(response.json().error.code, 'invalid_request');
    }
  } finally {
    await app.close();
  }
});

test('tour regeneration is explicit and accepts the existing empty-body request', async () => {
  const values: boolean[] = [];
  const app = await createApp({
    authenticate: async () => 'owner',
    service: service({
      generateTour: async (_owner, _id, regenerate) => {
        values.push(Boolean(regenerate));
        return {
          generation: {
            id,
            analysisId: id,
            status: 'ready',
            stage: 'validating',
            imagesDone: 1,
            imagesTotal: 1,
            error: null,
            model: 'test',
            tourId: id,
          },
        };
      },
    }),
  });
  try {
    const empty = await app.inject({
      method: 'POST',
      url: `/api/documents/${id}/tours`,
      headers: { authorization: 'Bearer valid' },
    });
    assert.equal(empty.statusCode, 200);
    const explicit = await app.inject({
      method: 'POST',
      url: `/api/documents/${id}/tours`,
      headers: { authorization: 'Bearer valid' },
      payload: { regenerate: true },
    });
    assert.equal(explicit.statusCode, 200);
    assert.deepEqual(values, [false, true]);
  } finally {
    await app.close();
  }
});

test('authenticated model catalog and per-request model selections reach the service', async () => {
  const catalog = {
    provider: 'meta',
    defaultModel: 'muse-spark-1.3',
    availability: 'not_configured',
    checkedAt: 'now',
    pricingCheckedAt: 'now',
    pricingSourceUrl: 'https://dev.meta.ai/docs/pricing',
    models: [],
  } as const;
  const selections: unknown[] = [];
  const app = await createApp({
    authenticate: async () => 'owner',
    service: service({
      models: async () => ({ ...catalog, models: [] }),
      reserve: async (_owner, _filename, _size, selection) => {
        selections.push(selection);
        return { documentId: id, bucket: 'paper-files', path: 'owner/file.pdf' };
      },
      generateTour: async (_owner, _id, _regenerate, selection) => {
        selections.push(selection);
        return {
          generation: {
            id,
            analysisId: id,
            status: 'queued',
            stage: 'preparing',
            imagesDone: 0,
            imagesTotal: 0,
            error: null,
            model: 'muse-spark-1.3-contributor',
            tourId: null,
          },
        };
      },
    }),
  });
  try {
    assert.equal(
      (await app.inject({ url: '/api/models', headers: { authorization: 'Bearer valid' } })).json().provider,
      'meta',
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: '/api/documents',
          headers: { authorization: 'Bearer valid' },
          payload: { filename: 'paper.pdf', size: 8, model: 'muse-wonder-1.0', allowTraining: false },
        })
      ).statusCode,
      201,
    );
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/documents/${id}/tours`,
          headers: { authorization: 'Bearer valid' },
          payload: { regenerate: true, model: 'muse-spark-1.3-contributor', allowTraining: true },
        })
      ).statusCode,
      200,
    );
    const invalidConsent = await app.inject({
      method: 'POST',
      url: `/api/documents/${id}/tours`,
      headers: { authorization: 'Bearer valid' },
      payload: { regenerate: true, model: 'muse-spark-1.3-contributor', allowTraining: 'true' },
    });
    assert.equal(invalidConsent.statusCode, 400, 'training consent must be an explicit JSON boolean');
    assert.deepEqual(selections, [
      { model: 'muse-wonder-1.0', allowTraining: false },
      { model: 'muse-spark-1.3-contributor', allowTraining: true },
    ]);
  } finally {
    await app.close();
  }
});
