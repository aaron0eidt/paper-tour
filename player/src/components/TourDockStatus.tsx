import { useId, useState } from 'react';
import { generationChecklist } from '../../../shared/generationChecklist';
import { useDockActivity } from './useDockActivity';
import type { TourGenerationSummary } from '../../../shared/contracts';
import { isTourGenerationActive, tourGenerationCopy } from '../library/tourGeneration';
import { AgentOrb } from './AgentStream';

interface Props {
  documentId?: string;
  generation?: TourGenerationSummary | null;
  /** The tour has steps to play. */
  hasTour: boolean;
  /** Steps of the tour that can be played already, and how many are planned, while it is still being written. */
  steps?: { ready: number; planned: number } | null;
  onActivity?(): void;
}

/**
 * The tour's preparation status, in the dock while it is made or needs attention. Once a tour is
 * there the dock is only the ask bar: the control bar's timeline already says where the tour is.
 */
export function TourDockStatus({ documentId, generation, hasTour, steps, onActivity }: Props) {
  const [expanded, setExpanded] = useState(false);
  const checklistId = useId();
  const activity = useDockActivity(documentId, generation?.id, expanded);
  const checklist = generationChecklist(activity.events, generation?.status ?? 'ready');
  const generating = isTourGenerationActive(generation);
  const generationNeedsAttention =
    generation && ['paused', 'failed', 'needs_configuration'].includes(generation.status);
  const showingGeneration = generating || generationNeedsAttention;
  if (!showingGeneration && (hasTour || !generation)) return null;

  let title = 'Tour ready';
  let detail = 'Open activity to see how it was made';
  let fraction: number | undefined;
  let count = '';
  let countLabel = 'sources reviewed';
  if (showingGeneration && generation) {
    title = tourGenerationCopy(generation).title;
    detail =
      generation.status === 'needs_configuration'
        ? 'Open Settings to check your model connection'
        : generation.status === 'failed'
          ? 'Use Retry tour above to start again'
          : generation.status === 'paused'
            ? 'Open Activity to resume the saved work'
            : 'Your assistant is preparing this document';
    if (generation.status === 'generating' && generation.stage === 'images' && generation.imagesTotal > 0) {
      const done = Math.min(generation.imagesTotal, Math.max(0, generation.imagesDone));
      fraction = done / generation.imagesTotal;
      count = `${done} / ${generation.imagesTotal}`;
      detail = 'Sources reviewed';
    } else if (generation.stage === 'writing' && generating && steps && steps.planned > 0) {
      // The first steps can be played already: say how far the rest is.
      const planned = Math.max(steps.ready, steps.planned);
      fraction = Math.min(1, steps.ready / planned);
      count = `${steps.ready} / ${planned}`;
      countLabel = 'steps ready to play';
      detail = 'You can play the steps that are ready';
    } else if (generation.stage === 'writing' && generating) detail = 'Building explanations and visual steps';
    else if (generation.stage === 'validating' && generating) detail = 'Checking the tour before it is ready';
  } else if (generation?.status === 'cancelled') {
    title = 'Tour creation stopped';
    detail = 'Your document is ready to explore';
  }
  return (
    <div className={`ask-tour-status${generationNeedsAttention ? ' needs-attention' : ''}`}>
      <div className="ask-tour-summary">
        <button
          type="button"
          className="ask-tour-toggle"
          aria-expanded={expanded}
          aria-controls={checklistId}
          onClick={() => setExpanded((value) => !value)}
          title={expanded ? 'Hide tour checklist' : 'Show tour checklist'}
        >
          <span className="ask-tour-avatar">
            <AgentOrb active={generating} />
            {fraction !== undefined && (
              <svg className="ask-tour-ring" viewBox="0 0 40 40" aria-hidden="true">
                <circle className="track" cx="20" cy="20" r="18" />
                <circle cx="20" cy="20" r="18" pathLength="100" strokeDasharray={`${fraction * 100} 100`} />
              </svg>
            )}
          </span>
          <div className="ask-tour-copy" role="status" aria-live="polite">
            <strong title={title}>{title}</strong>
            <span>{detail}</span>
          </div>
          {count && (
            <span
              className="ask-tour-count"
              aria-label={showingGeneration ? `${count} ${countLabel}` : `Step ${count}`}
            >
              {count}
            </span>
          )}
          <svg
            className="ask-tour-chevron"
            viewBox="0 0 16 16"
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden="true"
          >
            <path d="m4 10 4-4 4 4" />
          </svg>
        </button>
        {generation && onActivity && (
          <button type="button" className="ask-tour-activity" onClick={onActivity} aria-label="Open tour activity">
            Activity
          </button>
        )}
        <div
          className={`ask-tour-track${fraction === undefined && generating ? ' indeterminate' : ''}`}
          aria-hidden="true"
        >
          <span style={{ width: fraction === undefined ? undefined : `${fraction * 100}%` }} />
        </div>
      </div>
      {expanded && (
        <section className="ask-checklist" id={checklistId} aria-label="Tour checklist">
          <header>
            <strong>Tour checklist</strong>
            <span>
              {checklist.planned
                ? `${checklist.finished} / ${checklist.planned} tasks finished`
                : 'Preparation and creation'}
            </span>
          </header>
          {activity.error && (
            <p className="ask-checklist-error" role="status">
              {activity.error}
            </p>
          )}
          <ol className="ask-checklist-phases">
            {checklist.phases.map((item) => (
              <li key={item.id} data-state={item.state}>
                <span className="ask-check-mark" aria-label={item.state}>
                  {item.state === 'done' ? '✓' : item.state === 'failed' ? '!' : ''}
                </span>
                <span>
                  <strong>{item.label}</strong>
                  {item.detail && <small>{item.detail}</small>}
                </span>
              </li>
            ))}
          </ol>
          {checklist.items.length > 0 && (
            <ol className="ask-checklist-steps" aria-label="Planned tour steps">
              {checklist.items.map((item) => (
                <li key={item.id} data-state={item.state}>
                  <span className="ask-check-mark" aria-label={item.state}>
                    {item.state === 'done' ? '✓' : item.state === 'failed' ? '!' : ''}
                  </span>
                  <span>
                    <strong>{item.label}</strong>
                    {item.detail && <small>{item.detail}</small>}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {!checklist.items.length && (
            <p className="ask-checklist-note">
              {generating
                ? 'Planned steps appear here as the assistant prepares them.'
                : 'Open Activity for the recorded work on this tour.'}
            </p>
          )}
        </section>
      )}
    </div>
  );
}
