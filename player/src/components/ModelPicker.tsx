import { useId, useRef, useState } from 'react';
import { ChoicePicker } from './ChoicePicker';
import { AnimatedDialog, DialogTitle } from '../ui/controls';
import type { ModelCatalog } from '../../../shared/models';
import { formatPrice, modelDisplayName, modelPurpose, otherPricing, selectedApiModel, tokenPrice } from '../library/modelChoices';
import '../modelSettings.css';

export interface ModelPickerProps {
  catalog: ModelCatalog | null;
  model: string;
  onModelChange(model: string): void;
  disabled?: boolean;
  loading?: boolean;
  compact?: boolean;
  label?: string;
}

export function ModelPicker({ catalog, model, onModelChange, disabled = false, loading = false, compact = false, label = 'Tour model' }: ModelPickerProps) {
  const id = useId();
  const selected = selectedApiModel(catalog, model);
  const selectedAbsent = !!catalog && !!model && !selected;
  const hasModels = !!catalog?.models.length;
  return <div className={`model-settings${compact ? ' compact' : ''}`}>
    <span className="model-picker-label">{label}</span>
    <ChoicePicker value={catalog ? model : ''} label={label} disabled={disabled || loading || !hasModels}
      onChange={onModelChange} options={[
        ...(!hasModels ? [{ value: '', label: loading ? 'Loading models…' : catalog ? 'No models available' : 'Models unavailable' }] : []),
        ...(hasModels && !model ? [{ value: '', label: 'Choose a model', disabled: true }] : []),
        ...(selectedAbsent ? [{ value: model, label: `${model} — not listed`, disabled: true }] : []),
        ...(catalog?.models.map((candidate) => ({ value: candidate.id, label: modelDisplayName(candidate),
          detail: !candidate.tourCompatible ? modelPurpose(candidate) : candidate.available === false ? 'Unavailable' : undefined,
          disabled: !candidate.tourCompatible || candidate.available === false })) ?? []),
      ]} />
    <div className="model-selected-prices" id={`${id}-prices`}>
      {selected?.pricing ? <p>Per 1M tokens: input {formatPrice(selected.pricing.inputPerMillionTokens)}, cached input {formatPrice(selected.pricing.cachedInputPerMillionTokens)}, output {formatPrice(selected.pricing.outputPerMillionTokens)}.</p> : <p>{loading ? 'Loading model prices…' : !catalog ? 'Retry the model list to see availability and prices.' : !selected ? 'Choose an available model to see its prices.' : 'Prices are not published for this model.'}</p>}
      {catalog?.availability === 'not_configured' && <p>Tour creation is not configured yet. Your model choice will be saved with the PDF.</p>}
      {catalog?.availability === 'unavailable' && <p>Live model availability could not be checked. Listed API prices remain available below.</p>}
      {selected?.available === false && <p>This model is not currently available for tour creation. Choose another model.</p>}
    </div>
    {selected?.contributor && <div className="model-training" id={`${id}-training`}>
      <p>Contributor mode: your paper text, images, prompts and model responses may be used by Meta to train models.</p>
    </div>}
    {catalog && <ModelPricingTable catalog={catalog} modal={compact} />}
  </div>;
}

export function ModelPricingTable({ catalog, modal = false }: { catalog: ModelCatalog; modal?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useId();
  const close = () => setOpen(false);
  if (modal) return <div className="model-price-modal-trigger">
    <button type="button" ref={trigger} onClick={() => setOpen(true)}>Compare all API model prices</button>
    <AnimatedDialog open={open} onOpenChange={setOpen} className="model-price-dialog" popupProps={{ finalFocus: trigger }}>
      <header><DialogTitle id={heading}>Meta API model prices</DialogTitle><button type="button" onClick={close} aria-label="Close model prices">Close</button></header>
      <PricingContents catalog={catalog} />
    </AnimatedDialog>
  </div>;
  return <details className="model-price-details"><summary>Compare all API model prices</summary><PricingContents catalog={catalog} /></details>;
}

function PricingContents({ catalog }: { catalog: ModelCatalog }) {
  let source: string | null = null;
  try { const url = new URL(catalog.pricingSourceUrl); if (url.protocol === 'https:') source = url.href; } catch { /* Display the date even when no safe source URL is present. */ }
  const date = new Date(catalog.pricingCheckedAt);
  const checked = Number.isNaN(date.valueOf()) ? catalog.pricingCheckedAt : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return <div className="model-price-content">
      <p>USD per 1 million tokens, unless another unit is shown. A tour uses several requests; these are unit prices, not a fixed price per PDF. “—” means that billing unit does not apply; “Not published” means an official price is not available here.</p>
      <div className="model-price-scroll" tabIndex={0} role="region" aria-label="All Meta API model prices">
        <table><caption>Meta API models and prices</caption><thead><tr><th scope="col">Model / purpose</th><th scope="col">Input / 1M</th><th scope="col">Cached / 1M</th><th scope="col">Output / 1M</th><th scope="col">Other units</th></tr></thead><tbody>
          {catalog.models.map((candidate) => <tr key={candidate.id}>
            <th scope="row"><strong>{modelDisplayName(candidate)}</strong><code>{candidate.id}</code><span>{modelPurpose(candidate)}{candidate.available === false ? ' · unavailable' : ''}</span></th>
            <td>{tokenPrice(candidate, 'inputPerMillionTokens')}</td><td>{tokenPrice(candidate, 'cachedInputPerMillionTokens')}</td><td>{tokenPrice(candidate, 'outputPerMillionTokens')}</td><td>{otherPricing(candidate.pricing).join('; ') || '—'}</td>
          </tr>)}
        </tbody></table>
      </div>
      <p className="model-price-source">{source ? <a href={source} target="_blank" rel="noreferrer">Official Meta pricing</a> : 'Meta pricing'} · Checked <time dateTime={catalog.pricingCheckedAt}>{checked}</time></p>
    </div>;
}
