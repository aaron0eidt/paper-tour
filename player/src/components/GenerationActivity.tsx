import { TokenCounts } from './TokenCounts';
import { reportedUsage, type TokenUsage } from '../../../shared/activity';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationEvent } from '../../../shared/activity';
import { sseData } from '../../../shared/sse';
import { activityStream } from '../library/client';
import './generationActivity.css';

function payloadText(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value, null, 2) ?? '');
}
function name(value: unknown): string {
  return String(value ?? '').replaceAll('_', ' ');
}

export function GenerationActivity({ documentId, generationId, label = 'Activity & model output' }: { documentId: string; generationId: string; label?: string }) {
  const [open, setOpen] = useState(false);
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
  useEffect(() => {
    setEvents([]);
    setSelectedId(null);
    setCopied(false);
    setError('');
    setStatus('');
    setConnected(false);
    if (!open) return;
    const controller = new AbortController();
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
            `/api/documents/${documentId}/generations/${generationId}/events?after=${cursor}`,
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
              setEvents((previous) => [...previous, event]);
            }
            if (item.status) {
              setStatus(item.status);
              finished = !['queued', 'generating'].includes(item.status);
            }
            if (item.error) throw new Error(item.error);
          }
          if (finished) return;
        } catch {
          if (!controller.signal.aborted) setError('Connection interrupted. Retrying…');
        } finally {
          if (!controller.signal.aborted) setConnected(false);
        }
        await pause();
      }
    })();
    return () => controller.abort();
  }, [documentId, generationId, open]);
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
    (event) => event.type === 'model.started' || (showSystem && !event.type.startsWith('model.')),
  );
  const selected = rows.find((event) => event.id === selectedId) ?? rows.at(-1);
  const selectedCall = selected?.data.callId ? (calls.get(String(selected.data.callId)) ?? []) : [];
  const completion = selectedCall.find((event) => event.type === 'model.completed');
  const failure = selectedCall.find((event) => event.type === 'model.failed');
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
  const isModel = selected?.type === 'model.started';
  const output =
    completion?.data.output ??
    (selectedCall
      .filter((event) => event.type === 'model.delta')
      .map((event) => String(event.data.delta))
      .join('') ||
      'Waiting for model output…');
  const payload = selected
    ? !isModel
      ? selected.data
      : tab === 'input'
        ? selected.data.messages
        : tab === 'request'
          ? { ...selected.data, messages: undefined, requestId: completion?.data.requestId, error: failure?.data }
          : output
    : '';
  const text = payloadText(payload);
  const title = (event: GenerationEvent) =>
    name(
      event.type === 'model.started'
        ? event.data.name
        : event.type === 'step.started'
          ? event.data.stage
          : event.type.replaceAll('.', ' '),
    ).replace(/^paper /, '');
  return (
    <div className="generation-activity">
      <button type="button" onClick={() => setOpen(true)}>
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
            <h2>Tour activity</h2>
            <span>
              {status ? status.replaceAll('_', ' ') : connected ? 'Live' : 'Connecting…'} · {calls.size} model calls
            </span>
          </div>
          <button type="button" onClick={() => setOpen(false)} aria-label="Close activity">
            Close
          </button>
        </header>
        {open && (
          <>
            <div className="activity-summary">
              <TokenCounts usage={totals} pending={connected && ['queued', 'generating'].includes(status)} />
              <label>
                <input type="checkbox" checked={showSystem} onChange={(event) => setShowSystem(event.target.checked)} />{' '}
                System events
              </label>
            </div>
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
                  const done = group.find((item) => item.type === 'model.completed');
                  const failed = group.some((item) => item.type === 'model.failed');
                  const images = ((event.data.messages as { content: unknown }[] | undefined) ?? [])
                    .flatMap((message) => (Array.isArray(message.content) ? message.content : []))
                    .filter((part) => part.type === 'image');
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
                        {done
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
                      <span>{isModel ? String(selected.data.model) : selected.type}</span>
                    </div>
                    <div className="activity-payload-toolbar">
                      <div role="group" aria-label="Inspect payload">
                        {(isModel ? (['input', 'output', 'request'] as const) : ([] as const)).map((value) => (
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
                        ))}
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
                    <pre tabIndex={0} aria-label={`${isModel ? tab : 'Event'} payload`}>
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
                          ? 'Actual messages · images are identified by source ID and page.'
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
      </dialog>
    </div>
  );
}
