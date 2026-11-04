import { useEffect, useId, useRef, useState } from 'react';
import { activeActivity, type ActivityKind } from '../../../shared/agentActivity';
import { CloseIcon, PauseIcon, PlayIcon } from '../components/icons';
import { SparkIcon } from '../ask/icons';
import { GenerationActivity } from '../components/GenerationActivity';
import { AgentAvatar } from './AgentAvatar';
import { ActivityOperation, OperationMark, elapsed } from './ActivityOperation';
import { companionPresence, currentActivity, spokenSentence, type CompanionPlayback } from './presence';
import { useDocumentActivity } from './useDocumentActivity';
import { useActivityPlacement } from './useActivityPlacement';
import './activity.css';

const workflow = { tour: 'Guided tour', answer: 'Your question', reading: 'Read aloud' };
const stateLabel = {
  queued: 'Queued',
  running: 'Working',
  pausing: 'Pausing',
  paused: 'Paused',
  completed: 'Ready',
  failed: 'Needs attention',
  cancelled: 'Stopped',
};

/** A companion to the existing player, not a second narrator or a second conversation pipeline. */
export function AgentActivity({
  documentId,
  mode,
  playback,
  showNarration = true,
  playerVisible = true,
  onSource,
  onAsk,
  onTogglePlayback,
}: {
  documentId: string;
  mode: ActivityKind;
  playback: CompanionPlayback;
  showNarration?: boolean;
  playerVisible?: boolean;
  onSource?(id: string): void;
  onAsk(): void;
  onTogglePlayback(): void;
}) {
  const activity = useDocumentActivity(documentId);
  const [open, setOpen] = useState(false);
  const [quiet, setQuiet] = useState(false);
  const [selected, setSelected] = useState<{ id: string; mode: ActivityKind }>();
  const [history, setHistory] = useState(false);
  const [allActions, setAllActions] = useState(false);
  const [controlling, setControlling] = useState(false);
  const [now, setNow] = useState(Date.now);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const feed = useRef<HTMLOListElement>(null);
  const following = useRef(true);
  const [follow, setFollow] = useState(true);
  const panelId = useId();
  useActivityPlacement(root);
  const current = currentActivity(activity.runs, mode, activity.foregroundReadingId);
  const selectedRun = selected?.mode === mode ? activity.runs.find((run) => run.id === selected.id) : undefined;
  const run = selectedRun ?? current;
  const historical = !!selectedRun && selectedRun.id !== current?.id;
  const active = !!run && activeActivity(run.status);
  const local = activity.local.find((item) => item.run.id === run?.id);
  // Explicit foreground preparation still runs while lookahead is paused.
  const liveOperations = active || !!local?.foreground;
  const generating = !historical && playback.playing && !!playback.generating;
  const speaking = !historical && playback.speaking && !generating;
  const presence = companionPresence(run, mode, { ...playback, speaking, generating }, !!local?.foreground);
  const busy = presence.mood === 'working';
  const compactPeek = !showNarration && !busy && presence.mood !== 'attention';
  const sentence =
    showNarration && !historical && !busy && presence.mood !== 'attention'
      ? spokenSentence({ ...playback, speaking }, true)
      : undefined;
  const peek = !quiet;
  const tourPlayback = !historical && mode === 'tour' && playback.canPlay && (!run || run.status === 'completed');
  const operations = tourPlayback && !allActions ? undefined : allActions ? run?.operations : run?.operations.slice(-3);
  const lastDraft = liveOperations ? [...(run?.operations ?? [])].reverse().find((op) => op.draft)?.draft : undefined;
  const canControlPreparation =
    run?.controllable &&
    (run.kind === 'tour' || (run.kind === 'reading' && !!local)) &&
    (active || run.status === 'paused' || run.status === 'failed');

  useEffect(() => {
    setSelected(undefined);
    setOpen(false);
    setHistory(false);
    setAllActions(false);
    setQuiet(false);
  }, [documentId, mode]);
  useEffect(() => {
    setQuiet(false);
  }, [current?.id, playback.speaking, playback.generating, playback.preparingText, playback.preparationError]);
  useEffect(() => {
    if (!open && !active) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open, active]);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (document.activeElement?.closest('dialog[open]')) return;
      if (event.key === 'Escape' && root.current?.contains(document.activeElement)) {
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        setQuiet(true);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);
  useEffect(() => {
    following.current = true;
    setFollow(true);
  }, [run?.id]);
  useEffect(() => {
    if (open && following.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [run?.operations, open, allActions]);

  const close = () => {
    setOpen(false);
    setQuiet(true);
    trigger.current?.focus();
  };
  async function control(action: 'pause' | 'resume' | 'cancel' | 'retry') {
    if (!run) return;
    setControlling(true);
    try {
      await activity.control(run, action);
    } finally {
      setControlling(false);
    }
  }
  const speech = sentence && (
    <span className="agent-spoken-sentence">
      {sentence.words.map((word, index) => (
        <span key={index} data-current={index === sentence.current || undefined}>
          {word}{' '}
        </span>
      ))}
    </span>
  );
  const context = [playback.page && `Page ${playback.page}`, playback.title].filter(Boolean).join(' · ');

  return (
    <div className="reader-agent" ref={root} data-mood={presence.mood} data-expanded={open || undefined}>
      <span className="agent-generation-announcement" role="status" aria-live="polite">{playback.preparingText ? 'Preparing spoken text…' : generating ? 'Generating speech…' : ''}</span>
      <button
        className="reader-agent-trigger"
        ref={trigger}
        type="button"
        aria-label={`Paper Tour agent: ${presence.label}. ${open ? 'Close' : 'Open'} activity`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <AgentAvatar mood={presence.mood} word={playback.word} engaged={open} />
      </button>
      {!playerVisible && !historical && playback.canPlay && (
        <button
          type="button"
          className="agent-orb-playback"
          aria-label={playback.playing ? 'Pause narration' : 'Play narration'}
          title={playback.playing ? 'Pause narration' : 'Play narration'}
          onClick={onTogglePlayback}
        >
          <span aria-hidden="true">{playback.playing ? <PauseIcon /> : <PlayIcon />}</span>
        </button>
      )}
      {!open && peek && (
        <button
          type="button"
          className="agent-speech-peek"
          data-compact={compactPeek || undefined}
          onClick={() => setOpen(true)}
          aria-label="Open agent conversation and activity"
        >
          <span className="agent-peek-status">
            <span className="activity-status-dot" />
            {presence.label}
            <span>{busy && run && !generating ? elapsed(now - Date.parse(run.startedAt)) : '···'}</span>
          </span>
          {!compactPeek && <span className="agent-peek-message">{speaking ? speech : presence.message}</span>}
          {busy && !generating && !!operations?.length && (
            <span className="agent-peek-steps">
              {operations.slice(-3).map((operation) => (
                <span key={operation.id}>
                  <span>{operation.label}</span>
                  <span className="agent-peek-step-state" data-state={operation.state}>
                    <OperationMark state={operation.state} active={liveOperations} />
                  </span>
                </span>
              ))}
            </span>
          )}
        </button>
      )}
      {open && (
        <section className="reader-agent-card" id={panelId} aria-label="Paper Tour agent activity">
          <header className="reader-agent-card-head">
            <strong>
              <span className="agent-header-spark" aria-hidden="true">
                <SparkIcon />
              </span>{' '}
              Paper Tour agent
            </strong>
            <button type="button" className="activity-icon-button" aria-label="Close agent activity" onClick={close}>
              <CloseIcon />
            </button>
          </header>
          <div className="agent-card-scroll">
            {historical && (
              <button
                className="activity-follow-current"
                type="button"
                onClick={() => {
                  setSelected(undefined);
                  setAllActions(false);
                }}
              >
                ← Back to current activity
              </button>
            )}
            <div className="activity-live-status" role="status" aria-live="polite">
              <span className="activity-status-dot" />
              <strong>{historical && run ? stateLabel[run.status] : presence.label}</strong>
              <span>
                {activity.connection === 'reconnecting'
                  ? 'Reconnecting…'
                  : active && run
                    ? elapsed(now - Date.parse(run.startedAt))
                    : run
                      ? workflow[run.kind]
                      : ''}
              </span>
            </div>
            {!historical && context && <p className="agent-speech-context">{context}</p>}
            <p className="agent-message">
              {sentence ? speech : speaking ? 'Follow along in the player below.' : presence.message}
            </p>
            {tourPlayback && playback.step && (
              <div className="activity-queue-progress">
                <span>
                  Step {playback.step.current} of {playback.step.total}
                </span>
                <progress max={playback.step.total} value={playback.step.current} aria-label="Tour position" />
              </div>
            )}
            {!tourPlayback && run?.progress && (
              <div className="activity-queue-progress">
                <span>
                  {run.progress.completed} / {run.progress.total} {run.progress.label}
                </span>
                <progress
                  max={run.progress.total || 1}
                  value={run.progress.completed}
                  aria-label={run.progress.label}
                />
              </div>
            )}
            {!historical && (
              <div className="agent-conversation-actions">
                {playback.canPlay && (
                  <button type="button" className="agent-playback-button" onClick={onTogglePlayback}>
                    {playback.playing ? <PauseIcon /> : <PlayIcon />}
                    {playback.playing
                      ? 'Pause'
                      : mode === 'reading'
                        ? 'Continue reading'
                        : mode === 'answer'
                          ? 'Play answer'
                          : 'Continue tour'}
                  </button>
                )}
                <button
                  type="button"
                  className="agent-ask-button"
                  onClick={() => {
                    setOpen(false);
                    setQuiet(true);
                    onAsk();
                  }}
                >
                  Ask about this page
                </button>
              </div>
            )}
            {!!operations?.length && run && (
              <div className="activity-transcript">
                <div className="activity-actions-heading">
                  <span>{allActions ? 'Actions and public drafts' : 'Recent activity'}</span>
                  <button type="button" aria-expanded={allActions} onClick={() => setAllActions((value) => !value)}>
                    {allActions ? 'Show less' : 'All actions'}
                  </button>
                </div>
                <ol
                  className={`activity-operations${allActions ? ' is-expanded' : ''}`}
                  ref={feed}
                  aria-label="Actions and public drafts"
                  aria-live="off"
                  onScroll={() => {
                    if (!feed.current) return;
                    following.current =
                      feed.current.scrollHeight - feed.current.scrollTop - feed.current.clientHeight < 45;
                    setFollow(following.current);
                  }}
                >
                  {operations?.map((operation) => (
                    <ActivityOperation
                      key={operation.id}
                      operation={operation}
                      now={active ? now : Date.parse(run.updatedAt)}
                      active={liveOperations}
                      compact={!allActions}
                      onSource={onSource}
                    />
                  ))}
                </ol>
                {!follow && allActions && (
                  <button
                    className="activity-follow"
                    type="button"
                    onClick={() => {
                      following.current = true;
                      setFollow(true);
                      if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
                    }}
                  >
                    Latest activity ↓
                  </button>
                )}
              </div>
            )}
            {lastDraft && !allActions && (
              <details className="activity-public-draft">
                <summary>Live narration draft · checking follows</summary>
                <p>{lastDraft}</p>
              </details>
            )}
            <div className="activity-controls">
              {canControlPreparation && run && (
                <button
                  type="button"
                  disabled={controlling || run.status === 'pausing'}
                  onClick={() => void control(active ? 'pause' : 'resume')}
                >
                  {run.status === 'pausing' ? 'Pausing…' : active ? 'Pause preparation' : 'Resume preparation'}
                </button>
              )}
              {run?.controllable && active && run.kind !== 'reading' && (
                <button type="button" disabled={controlling} onClick={() => void control('cancel')}>
                  {run.kind === 'answer' ? 'Stop answer' : 'Cancel tour'}
                </button>
              )}
              {run?.kind === 'answer' && ['failed', 'cancelled'].includes(run.status) && local?.controls.retry && (
                <button type="button" disabled={controlling} onClick={() => void control('retry')}>
                  Retry answer
                </button>
              )}
            </div>
            {canControlPreparation && run?.kind === 'reading' && (
              <p className="activity-reading-note">
                Preparation runs ahead of the voice. Pausing it lets the current passage finish.
              </p>
            )}
            {activity.error && (
              <p className="activity-action-error" role="alert">
                {activity.error}
              </p>
            )}
            <footer className="activity-history">
              <button
                className="activity-history-toggle"
                type="button"
                aria-expanded={history}
                onClick={() => setHistory((value) => !value)}
              >
                Activity history <span>{activity.runs.length}</span>
              </button>
              {history && (
                <div className="activity-history-list" aria-label="Document activity history">
                  {activity.runs.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      aria-pressed={run?.id === item.id}
                      onClick={() => {
                        setSelected({ id: item.id, mode });
                        setHistory(false);
                        setAllActions(true);
                      }}
                    >
                      <span>
                        <strong>{workflow[item.kind]}</strong>
                        <small>
                          {new Date(item.startedAt).toLocaleString(undefined, {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </small>
                      </span>
                      <span>{item.title}</span>
                      <small>{stateLabel[item.status]}</small>
                    </button>
                  ))}
                  {activity.more && (
                    <button type="button" onClick={() => void activity.loadMore()}>
                      Load earlier activity
                    </button>
                  )}
                </div>
              )}
              {run?.kind === 'tour' && (
                <GenerationActivity
                  documentId={documentId}
                  generationId={run.id}
                  agentRunId={run.agentRunId}
                  active={active}
                  label="Technical details"
                />
              )}
            </footer>
          </div>
        </section>
      )}
    </div>
  );
}
