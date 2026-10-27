import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ModelCatalog } from '../../../shared/models';
import { formatPrice, modelDisplayName, modelPurpose, otherPricing, selectedApiModel, tokenPrice } from '../library/modelChoices';
import '../modelSettings.css';

export interface ModelPickerProps {
  catalog: ModelCatalog | null;
  model: string;
  onModelChange(model: string): void;
  disabled?: boolean;
  compact?: boolean;
  label?: string;
}

export function ModelPicker({ catalog, model, onModelChange, disabled = false, compact = false, label = 'Tour model' }: ModelPickerProps) {
  const id = useId();
  const selected = selectedApiModel(catalog, model);
  const selectedAbsent = !!model && !selected;
  return <div className={`model-settings${compact ? ' compact' : ''}`}>
    <label className="model-picker-label" htmlFor={id}>{label}</label>
    <select id={id} value={model} onChange={(event) => onModelChange(event.target.value)} disabled={disabled || !catalog} aria-describedby={`${id}-prices ${selected?.contributor ? `${id}-training` : ''}`}>
      {!catalog && <option value="">Loading models…</option>}
      {selectedAbsent && <option value={model} disabled>{model} — not listed</option>}
      {catalog?.models.map((candidate) => <option key={candidate.id} value={candidate.id} disabled={!candidate.tourCompatible || candidate.available === false}>
        {modelDisplayName(candidate)}{!candidate.tourCompatible ? ` · ${modelPurpose(candidate)}` : candidate.available === false ? ' · unavailable' : ''}
      </option>)}
    </select>
    <div className="model-selected-prices" id={`${id}-prices`}>
      {selected?.pricing ? <p>Per 1M tokens: input {formatPrice(selected.pricing.inputPerMillionTokens)}, cached input {formatPrice(selected.pricing.cachedInputPerMillionTokens)}, output {formatPrice(selected.pricing.outputPerMillionTokens)}.</p> : <p>{catalog ? 'Prices are not published for this model.' : 'Prices load with the model list.'}</p>}
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
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const heading = useId();
  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, [open]);
  const close = () => { dialog.current?.close(); setOpen(false); trigger.current?.focus(); };
  if (modal) return <div className="model-price-modal-trigger">
    <button type="button" ref={trigger} onClick={() => setOpen(true)}>Compare all API model prices</button>
    {open && createPortal(<dialog ref={dialog} className="model-price-dialog" aria-labelledby={heading} onCancel={(event) => { event.preventDefault(); close(); }}>
      <header><h2 id={heading}>Meta API model prices</h2><button type="button" onClick={close} aria-label="Close model prices">Close</button></header>
      <PricingContents catalog={catalog} />
    </dialog>, document.body)}
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
