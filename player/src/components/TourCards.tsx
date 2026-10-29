// The tour's two cards on the stage: a cover before the first play (what this is, how long it takes, what it covers) and a
// recap at the end (what each chapter established, questions to ask next). Both read only the tour; the reader decides
// when they show.

import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { chapterTakeaways, docTypeLabel, stepsLabel } from '../tourSummary';
import { stoppedCopy } from '../partialTour';
import type { Growth } from '../partialTour';
import type { Tour } from '../types';
import { PlayIcon } from './icons';
import './tourCards.css';

const MAX_LISTED = 8;

/** A list that scrolls on a short stage says so: true while there is more of it below. */
function useScrollCue<T extends HTMLElement>(deps: unknown): [RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setMore(el.scrollHeight - el.clientHeight > 2 && el.scrollTop + el.clientHeight < el.scrollHeight - 2);
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const resize = new ResizeObserver(measure);
    resize.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      resize.disconnect();
    };
  }, [deps]);
  return [ref, more];
}

interface CoverProps {
  tour: Tour;
  steps: number;
  /** "about 4 min". */
  length: string;
  /** A saved place in the tour (a step number from 1) the learner can pick up from. */
  resumeAt?: number | null;
  /** The tour is still being written: the cover counts the steps ready, not the whole. */
  growth?: Growth | null;
  onStart(): void;
  onResume(): void;
  /** Read the document first: the card goes, the tour waits. */
  onBrowse(): void;
}

export function TourCover({ tour, steps, length, resumeAt, growth, onStart, onResume, onBrowse }: CoverProps) {
  const type = docTypeLabel(tour.doc_type);
  const writing = !!growth && growth.phase !== 'stopped';
  const chapters = tour.chapters.map((chapter) => chapter.title);
  const resuming = !!resumeAt && resumeAt > 1;
  const [list, more] = useScrollCue<HTMLOListElement>(chapters.length);
  return (
    <div className="tour-layer">
      <section className="tour-card cover" role="region" aria-label="About this tour">
        {type && <p className="tour-eyebrow">{type}</p>}
        <h2 className="tour-title-text">{tour.title}</h2>
        <p className="tour-meta">
          <span>{writing ? `${steps} of about ${Math.max(steps, growth.planned)} steps` : stepsLabel(steps)}</span>
          <span aria-hidden="true">·</span>
          <span>{writing ? `${length} so far` : length}</span>
        </p>
        {growth && <GrowthNote growth={growth} />}
        {chapters.length > 1 && (
          <ol className={`tour-chapters${more ? ' more-below' : ''}`} aria-label="Chapters" ref={list}>
            {chapters.slice(0, MAX_LISTED).map((title, i) => (
              <li key={i}>
                <b>{i + 1}</b>
                <span>{title}</span>
              </li>
            ))}
            {chapters.length > MAX_LISTED && <li className="more">+ {chapters.length - MAX_LISTED} more</li>}
          </ol>
        )}
        <div className="tour-actions">
          <button type="button" className="tour-btn primary" onClick={resuming ? onResume : onStart}>
            <PlayIcon />
            <span>{resuming ? `Continue at step ${resumeAt}` : 'Start tour'}</span>
          </button>
          {resuming ? (
            <button type="button" className="tour-btn" onClick={onStart}>
              Start over
            </button>
          ) : (
            <button type="button" className="tour-btn" onClick={onBrowse}>
              Read the document first
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

/** What a tour still being written says about the rest: it is on its way, or it will not come. */
function GrowthNote({ growth }: { growth: Growth }) {
  const stopped = growth.phase === 'stopped';
  return (
    <p className={`tour-note${stopped ? ' stopped' : ''}`} role="status">
      {!stopped && <i aria-hidden="true" />}
      <span>
        {stopped
          ? stoppedCopy(growth).detail
          : growth.phase === 'retrying'
            ? 'The tour is being written again. These steps stay playable.'
            : 'The rest is still being written and joins the tour as you watch.'}
      </span>
    </p>
  );
}

interface EndProps {
  tour: Tour;
  /** The tour stopped being written: this is not all of it. */
  stopped?: Growth | null;
  /** Suggested questions the learner has not asked yet. */
  questions: string[];
  /** Play the tour again from a chapter's first step. */
  onReplayChapter(step: number): void;
  onReplay(): void;
  /** A question starts the ask flow. */
  onAsk(question: string): void;
  onClose(): void;
}

export function TourEnd({ tour, stopped, questions, onReplayChapter, onReplay, onAsk, onClose }: EndProps) {
  const takeaways = chapterTakeaways(tour);
  const [list, more] = useScrollCue<HTMLOListElement>(takeaways.length);
  // Escape closes the recap, unless a field or menu has just used it.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="tour-layer">
      <section className="tour-card end" role="region" aria-label="Tour recap">
        <button type="button" className="tour-close" onClick={onClose} aria-label="Close the recap" title="Close">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6.5 6.5l11 11m0-11l-11 11" />
          </svg>
        </button>
        <header className="tour-end-head">
          <div>
            <p className="tour-eyebrow">{stopped ? stoppedCopy(stopped).label : 'Tour complete'}</p>
            <h2 className="tour-title-text">{stopped ? 'What you know so far' : 'What you now know'}</h2>
          </div>
          <button type="button" className="tour-btn small" onClick={onReplay}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4.5 12a7.5 7.5 0 1 0 2.4-5.5M4.5 4.5v4h4" />
            </svg>
            <span>Replay tour</span>
          </button>
        </header>
        {stopped && (
          <p className="tour-note stopped" role="status">
            <span>{stoppedCopy(stopped).detail}</span>
          </p>
        )}
        <ol className={`tour-takeaways${more ? ' more-below' : ''}`} ref={list}>
          {takeaways.map((item) => (
            <li key={item.chapter}>
              <button type="button" onClick={() => onReplayChapter(item.step)} title="Play this chapter again">
                <b>{item.chapter + 1}</b>
                <span>
                  <strong>{item.title}</strong>
                  {item.point && <small>{item.point}</small>}
                </span>
                <i aria-hidden="true">Play again</i>
              </button>
            </li>
          ))}
        </ol>
        {questions.length > 0 && (
          <div className="tour-next">
            <h3>Keep exploring</h3>
            <div className="tour-chips">
              {questions.map((question) => (
                <button type="button" className="tour-chip" key={question} title={question} onClick={() => onAsk(question)}>
                  <span>{question}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
