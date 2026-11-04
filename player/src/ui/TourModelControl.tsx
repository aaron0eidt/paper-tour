import { useState } from 'react';
import type { ModelCatalog } from '../../../shared/models';
import { ModelPicker } from '../components/ModelPicker';
import { canUseModel, modelDisplayName } from '../library/modelChoices';
import { AnimatedPopover } from './controls';
import { ActionButton } from './ActionButton';
import { playInterfaceSound } from './sound';

export function TourModelControl({
  model,
  catalog,
  onSave,
}: {
  model: string;
  catalog: ModelCatalog;
  onSave(model: string): Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(model);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selected = catalog.models.find((candidate) => candidate.id === model);
  const candidate = catalog.models.find((item) => item.id === draft);
  return (
    <AnimatedPopover
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        setOpen(next);
        if (next) {
          setDraft(model);
          setError('');
        }
      }}
      label="Choose tour model"
      className="ui-tour-model-panel"
      trigger={
        <button
          type="button"
          className="ui-model-chip"
          aria-label={`Tour model: ${selected ? modelDisplayName(selected) : model}. Change model`}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <rect x="5" y="5" width="14" height="14" rx="4" />
            <path d="M9 1v4m6-4v4M9 19v4m6-4v4M1 9h4m-4 6h4m14-6h4m-4 6h4M9 10l3 4 3-4" />
          </svg>
          <span>
            <small>Tour model</small>
            <strong>{selected ? modelDisplayName(selected) : model}</strong>
          </span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="m4 6 4 4 4-4" />
          </svg>
        </button>
      }
    >
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          if (saving || draft === model || !canUseModel(catalog, draft, candidate?.contributor === true))
            return;
          setSaving(true);
          setError('');
          try {
            await onSave(draft);
            setOpen(false);
            playInterfaceSound('success');
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Could not save the model. Try again.');
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="ui-popover-heading">
          <h3>Choose tour model</h3>
        </div>
        <ModelPicker catalog={catalog} model={draft} onModelChange={setDraft} compact disabled={saving} />
        <p className="profile-help">Used for new tours. Your saved tours stay as they are.</p>
        {error && (
          <p className="library-error" role="alert">
            {error}
          </p>
        )}
        <div className="ui-model-actions">
          <button className="library-button" type="button" disabled={saving} onClick={() => setOpen(false)}>
            Cancel
          </button>
          <ActionButton
            type="submit"
            busy={saving}
            label={saving ? 'Saving…' : 'Use model'}
            disabled={draft === model || !canUseModel(catalog, draft, candidate?.contributor === true)}
          />
        </div>
      </form>
    </AnimatedPopover>
  );
}
