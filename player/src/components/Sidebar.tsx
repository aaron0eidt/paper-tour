import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { EngineState, FlatStep } from '../engine';
import type { Tour } from '../types';

interface Props {
  tour: Tour | null;
  steps: FlatStep[];
  state: EngineState;
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

export function Sidebar({ tour, steps, state, docTitle, onJump, children, header, navigation }: Props) {
  const started = state.status !== 'idle';
  const done = state.status === 'ended' ? steps.length : started ? state.index : 0;
  const progress = steps.length ? done / steps.length : 0;
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
        <h1 className="tour-title">{tour?.title ?? docTitle ?? 'Untitled paper'}</h1>
        {tour && (
          <div className="progress" aria-label={`${done} of ${steps.length} steps done`}>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress * 100}%` }} />
            </div>
            <span>
              {done} / {steps.length}
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
