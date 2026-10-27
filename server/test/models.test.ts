import test from 'node:test';
import assert from 'node:assert/strict';
import type { MuseConfig } from '../src/config';
import { HttpError, ProcessingError } from '../src/errors';
import { MetaModelCatalog, isContributorModel } from '../src/muse/models';
import { OFFICIAL_MODELS, PRICING_CHECKED_AT, PRICING_SOURCE_URL } from '../src/muse/pricing';

const settings: MuseConfig = {
  apiKey: 'catalog-unit-test-key', baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3', language: 'en-US', timeoutMs: 30_000,
};
const liveIds = [
  'muse-wonder-1.0', 'muse-spark-1.3', 'muse-spark-1.2', 'muse-spark-1.1',
  'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor',
  'muse-image-1.0', 'muse-voice-transcribe-1.0', 'sam-3.1',
];
function response(ids = liveIds) {
  return new Response(JSON.stringify({ object: 'list', data: ids.map((id) => ({ id, object: 'model' })) }));
}
function errorCode(code: string) {
  return (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === code;
}

test('catalog uses the authenticated models endpoint and combines live account access with documented pricing', async () => {
  let requests = 0;
  const transport: typeof fetch = async (url, options) => {
    requests++;
    assert.equal(String(url), 'https://api.meta.ai/v1/models');
    assert.equal(options?.method, 'GET');
    assert.equal(options?.redirect, 'error');
    assert.equal(new Headers(options?.headers).get('authorization'), 'Bearer catalog-unit-test-key');
    assert(options?.signal instanceof AbortSignal);
    return response();
  };
  const catalog = await new MetaModelCatalog(settings, transport).get();
  assert.equal(requests, 1);
  assert.equal(catalog.provider, 'meta');
  assert.equal(catalog.defaultModel, settings.model);
  assert.equal(catalog.availability, 'live');
  assert.equal(catalog.pricingSourceUrl, PRICING_SOURCE_URL);
  assert.equal(catalog.pricingCheckedAt, PRICING_CHECKED_AT);
  assert(Number.isFinite(Date.parse(catalog.checkedAt)));
  assert.equal(catalog.models.length, 9);
  assert.equal(catalog.models.filter((model) => model.tourCompatible).length, 6);
  assert(catalog.models.every((model) => model.available === true));
  assert.deepEqual(catalog.models.find((model) => model.id === 'muse-spark-1.3')?.pricing, OFFICIAL_MODELS['muse-spark-1.3'].pricing);
  assert(!JSON.stringify(catalog).includes(settings.apiKey));
});

test('unknown live IDs are visible without invented capabilities or prices; missing known IDs are explicitly unavailable', async () => {
  const catalog = await new MetaModelCatalog(settings, async () => response(['muse-spark-1.3', 'future-model', 'future-model'])).get();
  const unknown = catalog.models.find((model) => model.id === 'future-model');
  assert(unknown);
  assert.equal(unknown.kind, 'unknown');
  assert.equal(unknown.pricing, null);
  assert.equal(unknown.available, true);
  assert.equal(unknown.tourCompatible, false);
  assert.equal(catalog.models.filter((model) => model.id === 'future-model').length, 1);
  assert.equal(catalog.models.find((model) => model.id === 'muse-wonder-1.0')?.available, false);
});

test('an empty valid account catalog remains live and does not claim that known models are available', async () => {
  const catalog = await new MetaModelCatalog(settings, async () => response([])).get();
  assert.equal(catalog.availability, 'live');
  assert(catalog.models.every((model) => model.available === false));
});

test('missing credentials provide a clearly marked documented fallback without a network request', async () => {
  let requests = 0;
  const catalog = new MetaModelCatalog({ ...settings, apiKey: '  ' }, async () => { requests++; return response(); });
  const result = await catalog.get();
  assert.equal(requests, 0);
  assert.equal(result.availability, 'not_configured');
  assert(result.models.every((model) => model.available === null));
  assert(result.models.some((model) => model.pricing !== null));
  assert.equal(await catalog.validateSelection(' muse-spark-1.3 '), 'muse-spark-1.3');
});

test('provider failures stay private and never become false live account results', async () => {
  for (const status of [301, 400, 401, 403, 429, 503]) {
    let bodyRead = false;
    const catalog = new MetaModelCatalog(settings, async () => {
      const failure = new Response('catalog-unit-test-key private provider response', { status });
      failure.text = async () => { bodyRead = true; throw new Error('must not inspect provider errors'); };
      return failure;
    });
    const result = await catalog.get();
    assert.equal(result.availability, 'unavailable');
    assert(result.models.every((model) => model.available === null));
    assert(!bodyRead);
    assert(!JSON.stringify(result).includes(settings.apiKey));
  }
  const network = await new MetaModelCatalog(settings, async () => { throw new Error('catalog-unit-test-key connection details'); }).get();
  assert.equal(network.availability, 'unavailable');
  assert(!JSON.stringify(network).includes(settings.apiKey));
});

test('malformed, oversized and structurally invalid successful responses use an unknown-availability fallback', async () => {
  for (const payload of ['not JSON', '{}', '[]', '{"data":{}}', '{"data":[{"id":3}]}', '{"data":[{"id":""}]}', ' '.repeat(512 * 1024 + 1)]) {
    const result = await new MetaModelCatalog(settings, async () => new Response(payload)).get();
    assert.equal(result.availability, 'unavailable');
    assert(result.models.every((model) => model.available === null));
  }
});

test('catalog requests are cached for five minutes and returned values cannot mutate the cache', async (t) => {
  let now = Date.now(), requests = 0;
  t.mock.method(Date, 'now', () => now);
  const catalog = new MetaModelCatalog(settings, async () => { requests++; return response(); });
  const first = await catalog.get();
  first.models[0].available = false;
  first.models[0].pricing = null;
  now += 5 * 60 * 1000 - 1;
  const cached = await catalog.get();
  assert.equal(requests, 1);
  assert.equal(cached.models[0].available, true);
  assert.notEqual(cached.models[0].pricing, null);
  now += 1;
  await catalog.get();
  assert.equal(requests, 2);
});

test('concurrent lookups share one in-flight account request', async () => {
  let requests = 0;
  let release!: () => void;
  const ready = new Promise<void>((resolve) => { release = resolve; });
  const catalog = new MetaModelCatalog(settings, async () => { requests++; await ready; return response(); });
  const first = catalog.get(), second = catalog.get();
  assert.equal(requests, 1);
  release();
  const results = await Promise.all([first, second]);
  assert.deepEqual(results[0], results[1]);
  assert.notStrictEqual(results[0], results[1]);
});

test('account lookups enforce a maximum ten-second network timeout', async (t) => {
  let delay = 0;
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => { delay = milliseconds; return new AbortController().signal; });
  await new MetaModelCatalog(settings, async () => response()).get();
  assert.equal(delay, 10_000);
  await new MetaModelCatalog({ ...settings, timeoutMs: 900 }, async () => response()).get();
  assert.equal(delay, 900);
});

test('selection allows available supported canonical IDs and rejects unsupported or explicitly unavailable models', async () => {
  const catalog = new MetaModelCatalog(settings, async () => response(['muse-spark-1.3']));
  assert.equal(await catalog.validateSelection('  muse-spark-1.3  '), 'muse-spark-1.3');
  await assert.rejects(catalog.validateSelection('muse-wonder-1.0'), errorCode('model_not_available'));
  for (const model of ['muse-image-1.0', 'muse-voice-transcribe-1.0', 'sam-3.1', 'future-model', '']) {
    await assert.rejects(catalog.validateSelection(model), errorCode('unsupported_model'));
  }
});

test('known compatible selections remain possible when account discovery is unavailable', async () => {
  const catalog = new MetaModelCatalog(settings, async () => new Response('unavailable', { status: 503 }));
  assert.equal(await catalog.validateSelection('muse-wonder-1.0'), 'muse-wonder-1.0');
});

test('Contributor selection requires explicit training consent even if discovery is unavailable', async () => {
  const catalog = new MetaModelCatalog(settings, async () => response());
  for (const id of ['muse-spark-1.3-contributor', 'muse-spark-1.2-contributor']) {
    assert(isContributorModel(id));
    await assert.rejects(catalog.validateSelection(id), errorCode('contributor_training_consent_required'));
    assert.equal(await catalog.validateSelection(id, true), id);
  }
  assert(!isContributorModel('muse-spark-1.3'));
  assert(isContributorModel(' muse-spark-1.3-contributor '));
  const fallback = new MetaModelCatalog({ ...settings, apiKey: '' });
  await assert.rejects(fallback.validateSelection('muse-spark-1.3-contributor'), errorCode('contributor_training_consent_required'));
});

test('catalog endpoint applies the same secure-origin and credential guards as inference', () => {
  for (const baseUrl of ['invalid', 'http://public.example/v1', 'https://key:secret@api.meta.ai/v1', 'https://api.meta.ai/v1?key=secret', 'https://api.meta.ai/v1#secret']) {
    assert.throws(() => new MetaModelCatalog({ ...settings, baseUrl }), (error) => error instanceof ProcessingError && error.code === 'muse_not_configured' && !error.message.includes('secret'));
  }
  assert.doesNotThrow(() => new MetaModelCatalog({ ...settings, baseUrl: 'http://127.0.0.1:3000/v1' }));
  assert.doesNotThrow(() => new MetaModelCatalog({ ...settings, baseUrl: 'http://[::1]:3000/v1' }));
});
