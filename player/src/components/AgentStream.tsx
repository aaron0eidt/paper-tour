import { useEffect, useMemo, useRef, useState } from 'react';
import type { GenerationEvent } from '../../../shared/activity';
import { generationTimeline } from '../../../shared/generationTimeline';
import { parseNote } from '../markup';
import './agentStream.css';

export function AgentOrb({ active = false }: { active?: boolean }) {
  return (
    <span className={`agent-orb${active ? ' is-active' : ''}`} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}
function AgentMessage({ text }: { text: string }) {
  return (
    <>
      {text.split(/\n\s*\n/).map((paragraph, index) => (
        <p key={index}>
          {parseNote(paragraph).map((token, i) =>
            token.kind === 'bold' ? (
              <strong key={i}>{token.text}</strong>
            ) : token.kind === 'code' ? (
              <code key={i}>{token.text}</code>
            ) : (
              token.text
            ),
          )}
        </p>
      ))}
    </>
  );
}
export function AgentStream({ events, status }: { events: GenerationEvent[]; status: string }) {
  const entries = useMemo(() => generationTimeline(events), [events]);
  const feed = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [following, setFollowing] = useState(true);
  const active = ['queued', 'running', 'generating', 'pausing'].includes(status);
  useEffect(() => {
    if (follow.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [events]);
  return (
    <section className="agent-stream" aria-label="Agent activity stream">
      <div
        className="agent-feed"
        ref={feed}
        role="log"
        aria-label="Tour actions and messages"
        aria-live="off"
        onScroll={() => {
          const el = feed.current!;
          follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          setFollowing(follow.current);
        }}
      >
        {!entries.length && (
          <p className="agent-empty">
            {active ? 'Waiting for the first step…' : 'No activity has been recorded for this tour.'}
          </p>
        )}
        {entries.map((entry) => (
          <article key={entry.id} className={`agent-entry ${entry.kind} ${entry.state}`}>
            <span className="agent-entry-mark" aria-hidden="true">
              {entry.kind === 'model' ? (
                <AgentOrb active={active && entry.state === 'running'} />
              ) : entry.state === 'done' ? (
                '✓'
              ) : entry.state === 'failed' ? (
                '!'
              ) : (
                '·'
              )}
            </span>
            <div className="agent-entry-content">
              <div className="agent-entry-title">
                <span>
                  {entry.kind === 'model' && entry.text && entry.title === 'Working with the paper'
                    ? 'Tour assistant'
                    : entry.title}
                </span>
                <small>
                  {entry.state === 'running'
                    ? active
                      ? 'In progress'
                      : 'Interrupted'
                    : entry.state === 'failed'
                      ? 'Needs attention'
                      : entry.durationMs !== undefined
                        ? `${(entry.durationMs / 1000).toFixed(1)}s`
                        : 'Done'}
                </small>
              </div>
              {entry.detail && <p className="agent-tool-detail">{entry.detail}</p>}
              {entry.text && (
                <div className="agent-speech">
                  {entry.state !== 'running' && entry.text.length > 280 ? (
                    <details className="agent-message-more">
                      <summary>
                        <span className="agent-message-preview">
                          {entry.text.slice(0, 220).replace(/\s+\S*$/, '')}…
                        </span>
                        <span className="agent-message-toggle">Read full message</span>
                      </summary>
                      <AgentMessage text={entry.text} />
                    </details>
                  ) : (
                    <AgentMessage text={entry.text} />
                  )}
                  {active && entry.state === 'running' && <span className="agent-caret" aria-hidden="true" />}
                </div>
              )}
            </div>
          </article>
        ))}
      </div>
      {!following && (
        <button
          type="button"
          className="agent-follow"
          onClick={() => {
            follow.current = true;
            setFollowing(true);
            if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
          }}
        >
          {active ? 'Follow live activity ↓' : 'Jump to latest ↓'}
        </button>
      )}
    </section>
  );
}
