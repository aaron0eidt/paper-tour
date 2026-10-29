import { useEffect, useRef, useState } from 'react';
import { hintLabel, moreHints } from '../coach';
import type { Checkpoint } from '../types';
import './coach.css';

interface Props {
  checkpoint: Checkpoint;
  /** The learner is done trying (or gives up): the tour goes on and the next step reveals the answer. */
  onSolve(): void;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select'));
}

/**
 * The pause where the learner tries first: the prompt, a hint button that gives the hints one at a time, and "Show
 * solution", which lets the tour go on. The reader keys it by step, so each checkpoint starts without hints.
 */
export function CoachCard({ checkpoint, onSolve }: Props) {
  const [shown, setShown] = useState(0);
  const total = checkpoint.hints.length;
  const label = hintLabel(shown, total);
  const hint = () => setShown((n) => moreHints(n, total));
  const latest = useRef(hint);
  latest.current = hint;

  // H asks for the next hint from anywhere in the reader, like "/" focuses the question field.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.key !== 'h' && event.key !== 'H') || event.defaultPrevented) return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.repeat || isTyping(event.target)) return;
      event.preventDefault();
      latest.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <section className="coach-card" role="region" aria-label="Your turn">
      <header className="coach-head">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 20l4.2-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20z" />
          <path d="M13.5 7.5l3 3" />
        </svg>
        <span>Your turn</span>
      </header>
      <p className="coach-prompt">{checkpoint.prompt}</p>
      {/* The region is there from the start, so a hint that arrives in it is read out. */}
      <div className="coach-hints-live" aria-live="polite">
        {shown > 0 && (
          <ol className="coach-hints">
            {checkpoint.hints.slice(0, shown).map((text, i) => (
              <li key={i}>
                <b>Hint {i + 1}</b>
                <span>{text}</span>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="coach-actions">
        {label && (
          <button type="button" className="coach-btn" onClick={hint} title="Another hint (H)">
            <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.5 18h5M10 21h4M12 3.5a5.5 5.5 0 0 0-3.4 9.8c.6.5.9 1.2.9 1.9v.3h5v-.3c0-.7.3-1.4.9-1.9A5.5 5.5 0 0 0 12 3.5z" />
            </svg>
            <span>{label}</span>
          </button>
        )}
        <button type="button" className="coach-btn primary" onClick={onSolve} title="Show the solution (Space)">
          <span>Show solution</span>
        </button>
      </div>
    </section>
  );
}
