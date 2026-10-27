import type { ApiModel, ModelCatalog } from '../../../shared/models';
import { canUseModel, formatPrice, modelDisplayName, otherPricing, tokenPrice } from './modelChoices';

let failures = 0;
const results: string[] = [];
function test(name: string, run: () => void) {
  try { run(); results.push(`  ok    ${name}`); }
  catch (error) { failures++; results.push(`  FAIL  ${name}\n        ${(error as Error).message}`); }
}
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
function model(values: Partial<ApiModel> = {}): ApiModel {
  return { id: 'standard', name: 'Standard', kind: 'reasoning', tourCompatible: true, available: true, contributor: false, pricing: null, ...values };
}
function catalog(models: ApiModel[]): ModelCatalog {
  return { provider: 'meta', defaultModel: 'standard', availability: 'live', checkedAt: '2026-10-27', pricingCheckedAt: '2026-10-27', pricingSourceUrl: 'https://dev.meta.ai/docs/pricing', models };
}

test('unpublished or invalid prices never appear as zero; an official zero stays explicit', () => {
  equal(formatPrice(undefined), 'Not published');
  equal(formatPrice(Number.NaN), 'Not published');
  equal(formatPrice(-1), 'Not published');
  equal(formatPrice(0), '$0');
  equal(formatPrice(0.008), '$0.008');
});
test('unsupported billing units differ from missing token prices', () => {
  equal(tokenPrice(model({ kind: 'image_generation', tourCompatible: false }), 'inputPerMillionTokens'), '—');
  equal(tokenPrice(model(), 'inputPerMillionTokens'), 'Not published');
  equal(tokenPrice(model({ pricing: { currency: 'USD', cachedInputPerMillionTokens: 0 } }), 'cachedInputPerMillionTokens'), '$0');
  equal(otherPricing({ currency: 'USD', perImage: 0.02 }), ['$0.02 / image']);
  equal(otherPricing(null), []);
});
test('Contributor use is gated by explicit consent for the selected model', () => {
  const models = catalog([model(), model({ id: 'contributor', contributor: true })]);
  equal(canUseModel(models, 'standard', false), true);
  equal(canUseModel(models, 'contributor', false), false);
  equal(canUseModel(models, 'contributor', true), true);
  equal(canUseModel(null, 'contributor', true), false);
});
test('models that cannot make tours or are known unavailable cannot be submitted', () => {
  const models = catalog([model({ id: 'image', kind: 'image_generation', tourCompatible: false }), model({ id: 'unavailable', available: false }), model({ id: 'unchecked', available: null })]);
  equal(canUseModel(models, 'image', true), false);
  equal(canUseModel(models, 'unavailable', true), false);
  equal(canUseModel(models, 'not-in-catalog', true), false);
  equal(canUseModel(models, 'unchecked', false), true);
});
test('Contributor labels are clear and never duplicated', () => {
  equal(modelDisplayName(model({ name: 'Spark · Contributor', contributor: true })), 'Spark · Contributor');
  equal(modelDisplayName(model({ name: 'Spark', contributor: true })), 'Spark · Contributor');
});
console.log(results.join('\n'));
if (failures) throw new Error(`${failures} model-choice test(s) failed`);
console.log(`\nall ${results.length} model-choice tests passed`);
