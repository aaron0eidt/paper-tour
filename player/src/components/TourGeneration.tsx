import { useEffect, useState } from 'react';
import type { TourGenerationSummary } from '../../../shared/contracts';
import { apiRequest } from '../library/client';
import { isTourGenerationActive, tourGenerationCopy } from '../library/tourGeneration';
import { useModelCatalog, useModelPreference } from '../library/useModelCatalog';
import { canUseModel } from '../library/modelChoices';
import { ModelPicker } from './ModelPicker';
import '../tourGeneration.css';

export interface TourGenerationProps {
  documentId: string;
  generation?: TourGenerationSummary | null;
  onChanged(): void;
  canGenerate?: boolean;
  onOpenTour?(tourId: string): void;
  compact?: boolean;
  preferredModel?: string;
  savedModel?: string | null;
  showModelPicker?: boolean;
}

/** Generation never owns playback: the reader explicitly opens the saved tour. */
export function TourGeneration({
  documentId,
  generation,
  onChanged,
  canGenerate = true,
  onOpenTour,
  compact = false,
  preferredModel,
  savedModel,
  showModelPicker = false,
}: TourGenerationProps) {
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<TourGenerationSummary | null>(null);
  const models = useModelCatalog();
  const choice = useModelPreference(models.catalog, preferredModel ?? generation?.model);
  useEffect(() => {
    setSubmitted(null);
    setError(null);
  }, [generation, documentId]);
  const current = submitted ?? generation;
  const copy = tourGenerationCopy(current);
  const active = isTourGenerationActive(current);
  const validChoice = canUseModel(models.catalog, choice.model, choice.allowTraining);
  const actualModel = savedModel !== undefined ? savedModel : current?.status === 'ready' ? current.model : undefined;
  if (!current && !canGenerate) return null;

  async function create(regenerate = false) {
    setRequesting(true);
    setError(null);
    try {
      const response = await apiRequest<{ generation: TourGenerationSummary }>(`/api/documents/${documentId}/tours`, {
        method: 'POST',
        body: JSON.stringify({ regenerate, model: choice.model, allowTraining: choice.allowTraining }),
      });
      setSubmitted(response.generation);
      choice.resetConsent();
      onChanged();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not start the tour. Check your connection, then retry.');
    } finally {
      setRequesting(false);
    }
  }

  return (
    <section
      className={`tour-generation ${copy.kind}${compact ? ' compact' : ''}`}
      aria-label="Guided tour"
      aria-busy={active || requesting}
    >
      <div className="tour-generation-content" aria-live="polite">
        <strong>{requesting ? 'Starting your tour…' : copy.title}</strong>
        <p>{copy.detail}</p>
        {actualModel !== undefined && <p className="tour-model-used">{actualModel === null ? 'Manually authored tour' : `Tour model: ${actualModel}`}</p>}
        {active && <p className="tour-model-used">Generating with {current?.model}</p>}
        {current?.status === 'generating' && current.stage === 'images' && current.imagesTotal > 0 && (
          <progress
            aria-label="Images reviewed for the tour"
            value={Math.min(current.imagesTotal, Math.max(0, current.imagesDone))}
            max={current.imagesTotal}
          />
        )}
        {error && (
          <p className="tour-generation-error" role="alert">
            {error}
          </p>
        )}
      </div>
      {copy.action && canGenerate && (
        <button type="button" disabled={requesting || !validChoice} onClick={() => void create()}>
          {requesting ? 'Starting…' : copy.action}
        </button>
      )}
      {current?.status === 'ready' && current.tourId && onOpenTour && (
        <button type="button" onClick={() => onOpenTour(current.tourId!)}>
          Open tour
        </button>
      )}
      {current?.status === 'ready' && canGenerate && (
        <button type="button" disabled={requesting || !validChoice} onClick={() => void create(true)} title="Create a new tour version; your saved tours are kept">
          {requesting ? 'Starting…' : 'New tour'}
        </button>
      )}
      {showModelPicker && canGenerate && <details className="tour-model-settings">
        <summary>Model &amp; API pricing</summary>
        <ModelPicker catalog={models.catalog} model={choice.model} onModelChange={choice.setModel}
          allowTraining={choice.allowTraining} onAllowTrainingChange={choice.setAllowTraining}
          disabled={active || requesting} compact label="Model for next tour" />
        {models.error && <p role="alert">{models.error} <button type="button" onClick={models.refresh}>Retry model list</button></p>}
      </details>}
    </section>
  );
}
