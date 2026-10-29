import { TokenCounts } from './TokenCounts';
import { AgentOrb, AgentStream } from './AgentStream';
import { reportedUsage, type TokenUsage } from '../../../shared/activity';
import { generationProgress } from '../../../shared/generationProgress';
import { generationDiagnostics } from '../../../shared/generationDiagnostics';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationEvent } from '../../../shared/activity';
import { sseData } from '../../../shared/sse';
import type { AgentRun } from '../../../shared/agent';
import { apiRequest, activityStream } from '../library/client';
import './generationActivity.css';

function payloadText(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '');
}
function name(value: unknown): string {
  return String(value ?? '').replaceAll('_', ' ');
}
function duration(ms: number): string {
  const seconds = ms / 1000;
  return seconds < 60
    ? `${seconds < 10 ? seconds.toFixed(1) : Math.round(seconds)}s`
    : `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function GenerationActivity({
  documentId,
  generationId,
  agentRunId,
  onChanged,
  label = 'Tour assistant',
  active = false,
  openRequest = 0,
}: {
  documentId: string;
  generationId: string;
  agentRunId?: string | null;
  onChanged?(): void;
  label?: string;
  active?: boolean;
  openRequest?: number;
}) {
  const [run, setRun] = useState<AgentRun | null>(null);
  const [controlling, setControlling] = useState(false);
  const [revision, setRevision] = useState(0);
  const [open, setOpen] = useState(false);
  const previousOpenRequest = useRef(openRequest);
  useEffect(() => {
    if (openRequest > 0 && openRequest !== previousOpenRequest.current) setOpen(true);
    previousOpenRequest.current = openRequest;
  }, [openRequest]);
  const [view, setView] = useState<'stream' | 'details'>('stream');
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!open) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  const lastRunStatus = useRef<string>();
  useEffect(() => {
    if (
      open &&
      run &&
      ['queued', 'running', 'pausing'].includes(run.status) &&
      ['paused', 'failed'].includes(lastRunStatus.current ?? '')
    )
      setRevision((n) => n + 1);
    lastRunStatus.current = run?.status;
  }, [run?.status, open]);
  const runPath = `/api/documents/${documentId}/agent-runs/${agentRunId}`;
  async function control(action: 'pause' | 'resume' | 'cancel') {
    setControlling(true);
    try {
      setRun(await apiRequest<AgentRun>(`${runPath}/${action}`, { method: 'POST' }));
      setRevision((n) => n + 1);
      onChanged?.();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not update the run.');
    } finally {
      setControlling(false);
    }
  }
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showSystem, setShowSystem] = useState(false);
  const [tab, setTab] = useState<'input' | 'output' | 'request'>('output');
  const [copied, setCopied] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  const [events, setEvents] = useState<GenerationEvent[]>([]);
  const [error, setError] = useState('');
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('');
  const progress = useMemo(() => generationProgress(events, run?.status ?? status), [events, run?.status, status]);
  const diagnostics = useMemo(
    () => generationDiagnostics(events, run?.status ?? status, now),
    [events, run?.status, status, now],
  );
  const actionSeconds = progress.since ? Math.max(0, Math.floor((now - Date.parse(progress.since)) / 1000)) : null;
  const activityStatus = run?.status ?? status;
  const working =
    ['queued', 'running', 'generating', 'pausing'].includes(activityStatus) || (!activityStatus && active);
  useEffect(() => {
    setEvents([]);
    setSelectedId(null);
    setCopied(false);
    setError('');
    setStatus('');
    setConnected(false);
    if (!open) return;
    const controller = new AbortController();
    let pending: GenerationEvent[] = [];
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    const flush = () => {
      clearTimeout(flushTimer);
      flushTimer = undefined;
      if (controller.signal.aborted || !pending.length) return;
      const batch = pending;
      pending = [];
      setEvents((previous) => [...previous, ...batch]);
    };
    const refreshRun = () => {
      if (agentRunId)
        void apiRequest<AgentRun>(runPath, { signal: controller.signal })
          .then(setRun)
          .catch(() => {});
    };
    refreshRun();
    const timer = setInterval(refreshRun, 3000);
    let cursor = '0';
    const pause = () =>
      new Promise<void>((resolve) => {
        const done = () => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', done);
          resolve();
        };
        const timer = setTimeout(done, 1500);
        controller.signal.addEventListener('abort', done, { once: true });
      });
    void (async () => {
      while (!controller.signal.aborted) {
        let finished = false;
        try {
          const response = await activityStream(
            `${agentRunId ? runPath : `/api/documents/${documentId}/generations/${generationId}`}/events?after=${cursor}`,
            controller.signal,
          );
          if (controller.signal.aborted) return;
          setConnected(true);
          setError('');
          for await (const data of sseData(response.body!)) {
            if (controller.signal.aborted) return;
            const item = JSON.parse(data) as { event?: GenerationEvent; status?: string; error?: string };
            if (item.event) {
              const event = item.event;
              cursor = event.id;
              pending.push(event);
              flushTimer ??= setTimeout(flush, 80);
            }
            if (item.status) {
              setStatus(item.status);
              finished = !['queued', 'generating', 'running', 'pausing'].includes(item.status);
            }
            if (item.error) throw new Error(item.error);
          }
          if (finished) return;
        } catch {
          if (!controller.signal.aborted) setError('Connection interrupted. Retrying…');
        } finally {
          flush();
          if (!controller.signal.aborted) setConnected(false);
        }
        await pause();
      }
    })();
    return () => {
      clearInterval(timer);
      clearTimeout(flushTimer);
      controller.abort();
    };
  }, [documentId, generationId, agentRunId, open, revision]);
  const calls = useMemo(() => {
    const grouped = new Map<string, GenerationEvent[]>();
    for (const event of events)
      if (event.data.callId) {
        const id = String(event.data.callId);
        const group = grouped.get(id) ?? [];
        group.push(event);
        grouped.set(id, group);
      }
    return grouped;
  }, [events]);
  const rows = events.filter(
    (event) => ['model.started', 'tool.started'].includes(event.type) || (showSystem && !event.data.callId),
  );
  const selected = rows.find((event) => event.id === selectedId) ?? rows.at(-1);
  const selectedCall = selected?.data.callId ? (calls.get(String(selected.data.callId)) ?? []) : [];
  const replayedContext = selectedCall.find((event) => event.type === 'context.replayed');
  const preparedRequest = [...selectedCall].reverse().find((event) => event.type === 'model.prepared');
  const completion = selectedCall.find((event) => ['model.completed', 'tool.completed'].includes(event.type));
  const failure = completion ? undefined : [...selectedCall].reverse().find((event) => event.type === 'model.failed');
  const usageByCall = reportedUsage(events);
  const totals = usageByCall.size
    ? [...usageByCall.values()].reduce(
        (sum, value) => ({
          promptTokens: sum.promptTokens + value.promptTokens,
          completionTokens: sum.completionTokens + value.completionTokens,
          totalTokens: sum.totalTokens + value.totalTokens,
          ...(sum.cachedInputTokens !== undefined || value.cachedInputTokens !== undefined
            ? { cachedInputTokens: (sum.cachedInputTokens ?? 0) + (value.cachedInputTokens ?? 0) }
            : {}),
        }),
        { promptTokens: 0, completionTokens: 0, totalTokens: 0 } as TokenUsage,
      )
    : undefined;
  const isTool = selected?.type === 'tool.started';
  const isModel = selected?.type === 'model.started';
  const output =
    completion?.data.output ??
    failure?.data.output ??
    (selectedCall
      .filter((event) => event.type === 'model.delta')
      .map((event) => String(event.data.delta))
      .join('') ||
      'Waiting for model output…');
  const payload = selected
    ? !isModel && !isTool
      ? selected.data
      : tab === 'input'
        ? isTool
          ? selected.data.arguments
          : (preparedRequest?.data.messages ?? selected.data.messages)
        : tab === 'request'
          ? {
              ...selected.data,
              ...preparedRequest?.data,
              messages: undefined,
              ...(replayedContext && !preparedRequest
                ? { previousResponseId: undefined, historyMode: 'local', restoredSteps: replayedContext.data.steps }
                : {}),
              requestId: completion?.data.requestId,
              error: failure?.data,
            }
          : output
    : '';
  const text = view === 'details' ? payloadText(payload) : '';
  const title = (event: GenerationEvent) =>
    name(
      ['model.started', 'tool.started'].includes(event.type)
        ? event.data.name
        : event.type === 'step.started'
          ? event.data.stage
          : event.type.replaceAll('.', ' '),
    ).replace(/^paper /, '');
  return (
    <div className="generation-activity">
      <button type="button" className="activity-launch" onClick={() => setOpen(true)}>
        <AgentOrb active={working} />
        {label}
      </button>
      <dialog
        ref={dialog}
        className="activity-dialog"
        aria-label="Tour activity"
        onCancel={() => setOpen(false)}
        onClose={() => setOpen(false)}
      >
        <header className="activity-dialog-header">
          <div>
            <h2>Tour assistant</h2>
            <span>
              {run?.status ?? (status ? status.replaceAll('_', ' ') : connected ? 'Live' : 'Connecting…')} ·{' '}
              {diagnostics.modelCalls} model calls · {diagnostics.toolCalls} tools
            </span>
          </div>
          <div className="activity-run-actions">
            {run && !['completed', 'cancelled'].includes(run.status) && (
              <>
                <button
                  type="button"
                  disabled={controlling || run.status === 'pausing'}
                  onClick={() => void control(['paused', 'failed'].includes(run.status) ? 'resume' : 'pause')}
                >
                  {run.status === 'pausing'
                    ? 'Pausing…'
                    : ['paused', 'failed'].includes(run.status)
                      ? 'Resume'
                      : 'Pause'}
                </button>
                <button type="button" disabled={controlling} onClick={() => void control('cancel')}>
                  Cancel run
                </button>
              </>
            )}
            <button type="button" onClick={() => setOpen(false)} aria-label="Close activity">
              Close
            </button>
          </div>
        </header>
        {open && (
          <>
            <section className="activity-progress" aria-label="Current generation step">
              <AgentOrb active={working} />
              <div role="status" aria-live="polite">
                <strong>{progress.title}</strong>
                <p>{progress.detail}</p>
              </div>
              {actionSeconds !== null && (
                <span className="activity-step-time">
                  Current action: {Math.floor(actionSeconds / 60)}:{String(actionSeconds % 60).padStart(2, '0')}
                </span>
              )}
              <p className="activity-saved-work">
                {progress.observations || progress.chapters || progress.steps
                  ? `Saved: ${[progress.observations ? `${progress.observations} visual observations` : '', progress.chapters ? `${progress.chapters} chapters` : '', progress.steps ? `${progress.steps} steps` : ''].filter(Boolean).join(' · ')}`
                  : progress.drafts
                    ? `Narration drafted: ${progress.drafts} steps · validation follows`
                    : 'Preparing the first tour steps'}
              </p>
              {progress.warnings.length > 0 && (
                <details className="activity-efficiency">
                  <summary>Retries &amp; repeated work</summary>
                  <ul>
                    {progress.warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </details>
              )}
            </section>
            <div className="activity-view-switch" role="group" aria-label="Activity view">
              <button type="button" aria-pressed={view === 'stream'} onClick={() => setView('stream')}>
                Live activity
              </button>
              <button type="button" aria-pressed={view === 'details'} onClick={() => setView('details')}>
                Technical details
              </button>
            </div>
            {run?.status === 'paused' && (
              <p className="activity-run-note" role="status">
                {run.reason?.startsWith('no_progress:')
                  ? 'Paused because the same action repeated without new evidence or saved work. Your progress is kept. Check Technical details before resuming.'
                  : run.reason || 'Progress saved. Resume when ready.'}
              </p>
            )}
            {view === 'stream' ? (
              <>
                {error && <p role="status">{error}</p>}
                <AgentStream events={events} status={activityStatus} />
              </>
            ) : (
              <>
                <section className="activity-diagnostics" aria-label="Workflow timing">
                  <div className="activity-diagnostics-heading">
                    <strong>Where the time goes</strong>
                    <span>Recorded run · parallel requests overlap</span>
                  </div>
                  <dl>
                    <div>
                      <dt title="From the first model request to the latest completed action, or now while running. Intervening gaps and pauses may be included.">
                        Run elapsed
                      </dt>
                      <dd>{diagnostics.elapsedMs === undefined ? '—' : duration(diagnostics.elapsedMs)}</dd>
                    </div>
                    <div>
                      <dt title="Sum of recorded model request durations. Parallel requests overlap, so this can exceed elapsed time.">
                        Combined model time
                      </dt>
                      <dd>{diagnostics.timedModels ? duration(diagnostics.modelMs) : '—'}</dd>
                    </div>
                    <div>
                      <dt>Document tools</dt>
                      <dd>{diagnostics.timedTools ? duration(diagnostics.toolMs) : '—'}</dd>
                    </div>
                    <div>
                      <dt>First output · median</dt>
                      <dd>
                        {diagnostics.medianFirstOutputMs === undefined
                          ? '—'
                          : duration(diagnostics.medianFirstOutputMs)}
                      </dd>
                    </div>
                    <div>
                      <dt>Rejected / failed calls</dt>
                      <dd>{diagnostics.failedCalls}</dd>
                    </div>
                  </dl>
                  <p>
                    Elapsed starts at the first model request and includes gaps between actions. Combined model time
                    adds all request durations, including overlapping requests.
                  </p>
                  <p>{diagnostics.explanation}</p>
                  {diagnostics.phases.length > 0 && (
                    <p className="activity-timing-phases">
                      {diagnostics.phases.map((phase) => `${phase.label}: ${duration(phase.durationMs)}`).join(' · ')}
                    </p>
                  )}
                  {diagnostics.slowest.length > 0 && (
                    <details>
                      <summary>Slowest actions</summary>
                      <ol>
                        {diagnostics.slowest.map((action) => (
                          <li key={action.callId}>
                            <button
                              type="button"
                              onClick={() =>
                                setSelectedId(rows.find((event) => event.data.callId === action.callId)?.id ?? null)
                              }
                            >
                              <span>{action.name}</span>
                              <strong>{duration(action.durationMs)}</strong>
                            </button>
                          </li>
                        ))}
                      </ol>
                    </details>
                  )}
                  {diagnostics.direction && (
                    <details>
                      <summary>Tour presentation</summary>
                      <p>
                        {[
                          diagnostics.direction.steps === undefined ? null : `${diagnostics.direction.steps} steps`,
                          diagnostics.direction.words === undefined
                            ? null
                            : `${diagnostics.direction.words.toLocaleString()} narration words`,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                      <dl>
                        {diagnostics.direction.actions.map((action) => (
                          <div key={action.name}>
                            <dt>{name(action.name)}</dt>
                            <dd>{action.count}</dd>
                          </div>
                        ))}
                      </dl>
                      <p>Actions recorded in the published tour.</p>
                    </details>
                  )}
                </section>
                <div className="activity-summary">
                  <TokenCounts usage={totals} pending={connected && ['queued', 'generating'].includes(status)} />
                  <label>
                    <input
                      type="checkbox"
                      checked={showSystem}
                      onChange={(event) => setShowSystem(event.target.checked)}
                    />{' '}
                    System events
                  </label>
                </div>
                {run && ['paused', 'pausing'].includes(run.status) && (
                  <p className="activity-run-note" role="status">
                    {run.status === 'pausing'
                      ? 'Pausing at the next checkpoint. The current model call may finish first.'
                      : run.reason || 'Your progress is saved. Resume when ready.'}
                  </p>
                )}
                {error && <p role="status">{error}</p>}
                {!events.length && (
                  <p>
                    {connected || status
                      ? 'No activity recorded yet. Older tours may not have an activity log.'
                      : 'Connecting…'}
                  </p>
                )}
                <div className="activity-inspector-layout">
                  <nav className="activity-call-list" aria-label="Model calls and events">
                    {rows.map((event, index) => {
                      const group = calls.get(String(event.data.callId)) ?? [];
                      const done = group.find((item) => ['model.completed', 'tool.completed'].includes(item.type));
                      const failed =
                        !!(done?.data.output as { error?: unknown })?.error ||
                        (!done &&
                          group.some(
                            (item) =>
                              item.type === 'model.failed' ||
                              (item.type === 'tool.completed' && !!(item.data.output as { error?: unknown })?.error),
                          ));
                      const images = ((event.data.messages as { content: unknown }[] | undefined) ?? [])
                        .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
                        .filter((part) => ['image', 'input_image'].includes(part.type));
                      return (
                        <button
                          key={event.id}
                          type="button"
                          className="activity-call-row"
                          aria-pressed={selected?.id === event.id}
                          onClick={() => {
                            setSelectedId(event.id);
                            setCopied(false);
                          }}
                        >
                          <span className="activity-call-title">
                            <span
                              className={`activity-state-dot ${failed || event.type.endsWith('failed') ? 'failed' : event.type === 'model.started' && !done ? 'running' : ''}`}
                            />
                            <span>{title(event)}</span>
                          </span>
                          <span className="activity-call-meta">
                            #{index + 1} ·{' '}
                            {new Date(event.at).toLocaleTimeString([], {
                              hour12: false,
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                            })}
                            {done?.data.durationMs !== undefined
                              ? ` · ${(Number(done.data.durationMs) / 1000).toFixed(1)}s`
                              : failed
                                ? ' · Failed'
                                : event.type === 'model.started'
                                  ? ' · Streaming'
                                  : ''}
                            {images.length ? ` · ${images.length} visuals` : ''}
                          </span>
                          {event.type === 'model.started' && (
                            <TokenCounts usage={usageByCall.get(String(event.data.callId))} />
                          )}
                        </button>
                      );
                    })}
                  </nav>
                  <section className="activity-payload" aria-label="Selected event details">
                    {selected ? (
                      <>
                        <div className="activity-payload-heading">
                          <strong>{title(selected)}</strong>
                          <span>{isModel ? String(selected.data.model) : isTool ? 'Paper tool' : selected.type}</span>
                        </div>
                        <div className="activity-payload-toolbar">
                          <div role="group" aria-label="Inspect payload">
                            {(isModel || isTool ? (['input', 'output', 'request'] as const) : ([] as const)).map(
                              (value) => (
                                <button
                                  key={value}
                                  type="button"
                                  aria-pressed={tab === value}
                                  onClick={() => {
                                    setTab(value);
                                    setCopied(false);
                                  }}
                                >
                                  {value}
                                </button>
                              ),
                            )}
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              void navigator.clipboard
                                .writeText(text)
                                .then(() => setCopied(true))
                                .catch(() => setCopied(false));
                            }}
                          >
                            {copied ? 'Copied' : 'Copy'}
                          </button>
                        </div>
                        {failure && <p className="activity-failure">{String(failure.data.code)}</p>}
                        <pre tabIndex={0} aria-label={`${isModel || isTool ? tab : 'Event'} payload`}>
                          {text}
                        </pre>
                        <footer>
                          {isModel && tab === 'output'
                            ? completion
                              ? 'Response received · tour validation is recorded separately.'
                              : failure
                                ? 'Interrupted draft · not validated.'
                                : 'Live model output · not validated yet.'
                            : isModel && tab === 'input'
                              ? preparedRequest
                                ? 'Actual dispatched messages · images are identified by source references.'
                                : replayedContext
                                  ? 'Step input · the saved conversation was restored locally before dispatch; earlier messages are not repeated here.'
                                  : 'Actual messages · images are identified by source ID and page.'
                              : `Event ${selected.id} · ${selected.at}`}
                        </footer>
                      </>
                    ) : (
                      <p>Select a model call to inspect its inputs and output.</p>
                    )}
                  </section>
                </div>
              </>
            )}
          </>
        )}
      </dialog>
    </div>
  );
}
