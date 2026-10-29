import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { EngineState, FlatStep } from '../engine';
import { stoppedCopy, writingLabel } from '../partialTour';
import type { Growth } from '../partialTour';
import type { Tour } from '../types';

interface Props {
  tour: Tour | null;
  steps: FlatStep[];
  state: EngineState;
  /** The tour is still being written (or stopped being written); null for a finished one. */
  growth?: Growth | null;
  docTitle?: string;
  onJump(index: number): void;
  /** Rendered above the footer (the problems list). */
  children?: ReactNode;
  header?: ReactNode;
  navigation?: ReactNode;
}

function stepLabel(say: string): string {
  const words = say.split(/\s+/).filter(Boolean);
  return words.length > 9 ? `${words.slice(0, 9).join(' ')}…` : words.join(' ');
}

export function Sidebar({ tour, steps, state, growth, docTitle, onJump, children, header, navigation }: Props) {
  const started = state.status !== 'idle';
  const done = state.status === 'ended' || state.waiting ? steps.length : started ? state.index : 0;
  // A tour still being written measures its progress against the steps planned.
  const whole = growth?.phase === 'stopped' ? steps.length : Math.max(steps.length, growth?.planned ?? 0);
  const progress = whole ? done / whole : 0;
  const navRef = useRef<HTMLElement>(null);

  // Keep the current step in view as the tour moves through the chapters.
  useEffect(() => {
    const nav = navRef.current;
    const item = nav?.querySelector<HTMLElement>('.step.current');
    if (!nav || !item) return;
    const n = nav.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    if (r.top < n.top + 8 || r.bottom > n.bottom - 8) {
      nav.scrollBy({ top: r.top - n.top - n.height / 3, behavior: 'smooth' });
    }
  }, [state.index, started]);

  return (
    <aside id="reader-navigation" className="sidebar" aria-label="Paper navigation">
      <header className="sidebar-head">
        {header}
        <div className="brand">Paper Tour</div>
        <h1 className="tour-title">{tour?.title?.trim() || docTitle || 'Untitled paper'}</h1>
        {tour && (
          <div className="progress" aria-label={`${done} of ${whole} steps done`}>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <span>
              {done} / {whole}
              {growth && growth.phase !== 'stopped' ? '+' : ''}
            </span>
          </div>
        )}
      </header>

      {navigation ??
        (tour ? (
          <nav className="chapters" ref={navRef}>
            {tour.chapters.map((chapter, ci) => (
              <section key={chapter.id} className="chapter">
                <h2>
                  <span className="chapter-num">{ci + 1}</span>
                  {chapter.title}
                </h2>
                <ol>
                  {steps
                    .filter((s) => s.chapterIndex === ci)
                    .map((s) => {
                      const current = started && s.index === state.index;
                      const past = s.index < done && !current;
                      return (
                        <li key={s.step.id}>
                          <button
                            className={`step${current ? ' current' : ''}${past ? ' past' : ''}`}
                            onClick={() => onJump(s.index)}
                            title={s.step.say}
                          >
                            <span className="step-dot" />
                            <span className="step-text">{stepLabel(s.step.say)}</span>
                            {s.checkpoint && <span className="step-try" aria-label="Your turn">Try</span>}
                          </button>
                        </li>
                      );
                    })}
                </ol>
              </section>
            ))}
            {/* What the tour waits for, or why it will not go on, after the last step written. */}
            {growth &&
              (growth.phase === 'stopped' ? (
                <p className="chapter-pending stopped" role="status">
                  <strong>{stoppedCopy(growth).title}</strong>
                  <span>{stoppedCopy(growth).detail}</span>
                </p>
              ) : (
                <p className="chapter-pending">
                  <i aria-hidden="true" />
                  <span>
                    {writingLabel(growth)}
                    {growth.planned > steps.length ? <small>{growth.planned - steps.length} more planned</small> : null}
                  </span>
                </p>
              ))}
          </nav>
        ) : (
          <div className="sidebar-empty">
            <p>No tour loaded for this paper.</p>
            <p>
              Press <kbd>D</kbd> or use <b>IDs</b> to see every element ID. Click one to copy it into a tour.
            </p>
          </div>
        ))}

      {children}

      <footer className="sidebar-foot">
        <kbd>Space</kbd> play/pause · <kbd>←</kbd>
        <kbd>→</kbd> step · <kbd>D</kbd> IDs
      </footer>
    </aside>
  );
}
