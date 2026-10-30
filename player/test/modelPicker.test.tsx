import { renderToStaticMarkup } from 'react-dom/server';
import { ModelPicker } from '../src/components/ModelPicker';
import type { ModelCatalog } from '../../shared/models';

function test(name: string, run: () => void) { run(); console.log(`  ok    ${name}`); }
function check(value: boolean) { if (!value) throw new Error('Model picker state is misleading'); }
const catalog: ModelCatalog = {
  provider: 'meta', defaultModel: 'model', availability: 'live', checkedAt: '2026-10-30',
  pricingCheckedAt: '2026-10-30', pricingSourceUrl: 'https://example.com/pricing',
  models: [{ id: 'model', name: 'Available model', kind: 'reasoning', tourCompatible: true,
    available: true, contributor: false, pricing: null }],
};
const render = (current: ModelCatalog | null, model = '', loading = false) =>
  renderToStaticMarkup(<ModelPicker catalog={current} model={model} loading={loading} onModelChange={() => {}} />);

test('a failed model request stops claiming that models are loading', () => {
  const loading = render(null, 'model', true);
  const failed = render(null, 'model');
  check(loading.includes('Loading models…'));
  check(failed.includes('Models unavailable') && !failed.includes('Loading'));
  check(!failed.includes('not listed') && failed.includes('disabled=""'));
});
test('an empty selection never silently appears to select the first available model', () => {
  check(render(catalog).includes('Choose a model'));
  check(render({ ...catalog, models: [] }).includes('No models available'));
  check(render(catalog, 'removed-model').includes('removed-model — not listed'));
});
