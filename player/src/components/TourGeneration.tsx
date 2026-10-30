import { TourProfileDialog } from './TourProfileDialog';
import type { TourProfileSelection } from '../../../shared/tourProfiles';
import { GenerationActivity } from './GenerationActivity';
import { useEffect, useState } from 'react';
import type { TourGenerationSummary } from '../../../shared/contracts';
import { apiRequest } from '../library/client';
import { isTourGenerationActive, tourGenerationCopy } from '../library/tourGeneration';
import { useModelCatalog } from '../library/useModelCatalog';
import { useSettings } from '../library/useSettings';
import { canUseModel } from '../library/modelChoices';
import '../tourGeneration.css';

export interface TourGenerationProps {
  documentId: string;
  generation?: TourGenerationSummary | null;
  onChanged(): void;
  canGenerate?: boolean;
  onOpenTour?(tourId: string): void;
  compact?: boolean;
  toolbar?: boolean;
  activityRequest?: number;
}

/** Generation never owns playback: the reader explicitly opens the saved tour. */
export function TourGeneration({
  documentId,
  generation,
  onChanged,
  canGenerate = true,
  onOpenTour,
  compact = false,
  toolbar = false,
  activityRequest,
}: TourGenerationProps) {
  const [requesting, setRequesting] = useState(false);
  const [creating, setCreating] = useState<null | { regenerate: boolean }>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState<TourGenerationSummary | null>(null);
  const models = useModelCatalog();
  const profile = useSettings();
  const model = profile.data?.defaultModel ?? '';
  const selected = models.catalog?.models.find((candidate) => candidate.id === model);
  const allowTraining = selected?.contributor === true;
  useEffect(() => {
    setSubmitted(null);
    setError(null);
  }, [generation, documentId]);
  const current = submitted ?? generation;
  const copy = tourGenerationCopy(current);
  const active = isTourGenerationActive(current);
  const validChoice = !!profile.data && canUseModel(models.catalog, model, allowTraining);
  if (!current && !canGenerate) return null;

  async function create(selection: TourProfileSelection, regenerate = false) {
    setRequesting(true);
    setError(null);
    try {
      const response = await apiRequest<{ generation: TourGenerationSummary }>(`/api/documents/${documentId}/tours`, {
        method: 'POST',
        body: JSON.stringify({ regenerate, model, allowTraining, ...selection }),
      });
      setSubmitted(response.generation);
      setCreating(null);
      onChanged();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Could not start the tour. Check your connection, then retry.';
      setError(message);
      throw new Error(message);
    } finally {
      setRequesting(false);
    }
  }

  return (
    <>
      <section
        className={`tour-generation ${copy.kind}${compact ? ' compact' : ''}${toolbar ? ' in-toolbar' : ''}`}
        aria-label="Guided tour"
        aria-busy={active || requesting}
      >
        {(!compact || current?.status !== 'ready') && (
          <div className="tour-generation-content" aria-live="polite" title={`${copy.title} ${copy.detail}`}>
            <strong>{requesting ? 'Starting your tour…' : copy.title}</strong>
            <p>{copy.detail}</p>
            {current?.status === 'generating' && current.stage === 'images' && current.imagesTotal > 0 && (
              <progress
                aria-label="Images reviewed for the tour"
                value={Math.min(current.imagesTotal, Math.max(0, current.imagesDone))}
                max={current.imagesTotal}
              />
            )}
          </div>
        )}
        {current && (
          <GenerationActivity
            key={current.id}
            documentId={documentId}
            generationId={current.id}
            agentRunId={current.agentRunId}
            active={active || requesting}
            openRequest={activityRequest}
            onChanged={onChanged}
            label={toolbar ? 'Activity' : undefined}
          />
        )}
        {error && (
          <p className="tour-generation-error" role="alert" title={error}>
            {error}
          </p>
        )}
        {copy.action && canGenerate && (
          <button
            type="button"
            disabled={requesting || !validChoice}
            onClick={() => setCreating({ regenerate: false })}
          >
            {requesting ? 'Starting…' : copy.action}
          </button>
        )}
        {current?.status === 'ready' && current.tourId && onOpenTour && (
          <button type="button" onClick={() => onOpenTour(current.tourId!)}>
            Open tour
          </button>
        )}
        {current?.status === 'ready' && canGenerate && (
          <button
            type="button"
            disabled={requesting || !validChoice}
            onClick={() => setCreating({ regenerate: true })}
            title="Create a new tour version; your saved tours are kept"
          >
            {requesting ? 'Starting…' : 'New tour'}
          </button>
        )}
        {canGenerate && (
          <div className="tour-generation-extra">
            {current?.status === 'needs_configuration' && (
              <a className="library-text-button" href={`${import.meta.env.BASE_URL}?settings=profile`}>
                Connect Meta in Profile &amp; Settings →
              </a>
            )}
            {(models.error || profile.error) && (
              <p role="alert">
                Could not load your model settings.{' '}
                <button
                  type="button"
                  onClick={() => {
                    models.refresh();
                    profile.refresh();
                  }}
                >
                  Retry
                </button>
              </p>
            )}
          </div>
        )}
      </section>
      {creating && (
        <TourProfileDialog
          current={current?.profile}
          model={selected?.name ?? model}
          busy={requesting}
          onCreate={(selection) => create(selection, creating.regenerate)}
          onClose={() => setCreating(null)}
        />
      )}
    </>
  );
}
