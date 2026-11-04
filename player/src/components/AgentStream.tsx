import { AutoHeight } from '@animate-ui/react/primitives/effects/auto-height';
import { ActionButton } from '../ui/ActionButton';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
function ExpandableMessage({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const id = useId();
  const preview = `${text.slice(0, 220).replace(/\s+\S*$/, '')}…`;
  return (
    <div className="agent-message-more" data-expanded={expanded || undefined}>
      <AutoHeight className="agent-message-height" deps={[expanded, text]}>
        <div id={id}>
          <AgentMessage text={expanded ? text : preview} />
        </div>
      </AutoHeight>
      <ActionButton
        className="agent-message-toggle"
        label={expanded ? 'Show less' : 'Read full message'}
        aria-expanded={expanded}
        aria-controls={id}
        onClick={() => setExpanded((value) => !value)}
      />
    </div>
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
              {entry.kind === 'model' && entry.state === 'running' ? (
                <AgentOrb active={active && entry.state === 'running'} />
              ) : entry.state === 'done' ? (
                <svg
                  width="15"
                  height="15"
                  viewBox="0 0 20 20"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  aria-hidden="true"
                >
                  <path d="m4 10 4 4 8-9" />
                </svg>
              ) : entry.state === 'failed' ? (
                '!'
              ) : (
                '·'
              )}
            </span>
            <div className="agent-entry-content">
              <div className="agent-entry-title">
                <span title={entry.title}>
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
                    <ExpandableMessage text={entry.text} />
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
        <ActionButton
          type="button"
          className="library-button agent-follow"
          label={active ? 'Follow live activity ↓' : 'Jump to latest ↓'}
          onClick={() => {
            follow.current = true;
            setFollowing(true);
            if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
          }}
        />
      )}
    </section>
  );
}
