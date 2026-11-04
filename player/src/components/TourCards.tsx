// The tour's two cards on the stage: a cover before the first play (what this is, how long it takes, what it covers) and a
// recap at the end (what each chapter established, questions to ask next). Both read only the tour; the reader decides
// when they show.

import { useEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import { motion, useIsPresent, useReducedMotion } from 'motion/react';
import { UI_EXIT, UI_SPRING } from '../ui/motion';
import { coverageNote } from '../../../shared/coverage';
import { chapterTakeaways, docTypeLabel, stepsLabel } from '../tourSummary';
import { stoppedCopy } from '../partialTour';
import type { Growth } from '../partialTour';
import type { Tour } from '../types';
import { PlayIcon } from './icons';
import './tourCards.css';

/** Shared presence animation; the reader keeps exiting cards mounted until it finishes. */
function TourCardLayer({ children, className, label }: { children: ReactNode; className: string; label: string }) {
  const reducedMotion = useReducedMotion();
  const present = useIsPresent();
  return (
    <motion.div
      className="tour-layer"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: UI_EXIT }}
      transition={{ duration: 0.2 }}
      inert={!present}
      aria-hidden={!present || undefined}
    >
      <motion.section
        className={`tour-card ${className}`}
        role="region"
        aria-label={label}
        initial={{ scale: reducedMotion ? 1 : 0.96, y: reducedMotion ? 0 : 8 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: reducedMotion ? 1 : 0.96, y: reducedMotion ? 0 : 4, transition: UI_EXIT }}
        transition={UI_SPRING}
      >
        {children}
      </motion.section>
    </motion.div>
  );
}

const MAX_LISTED = 8;

/** A list that scrolls on a short stage says so: true while there is more of it below. */
function useScrollCue<T extends HTMLElement>(deps: unknown): [RefObject<T | null>, boolean] {
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
    <TourCardLayer className="cover" label="About this tour">
        {type && <p className="tour-eyebrow">{type}</p>}
        <h2 className="tour-title-text">{tour.title}</h2>
        <p className="tour-meta">
          <span>{writing ? `${steps} of about ${Math.max(steps, growth.planned)} steps` : stepsLabel(steps)}</span>
          <span aria-hidden="true">·</span>
          <span>{writing ? `${length} so far` : length}</span>
        </p>
        {growth && <GrowthNote growth={growth} />}
        <LeftOutNote tour={tour} />
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
    </TourCardLayer>
  );
}

/** What a finished tour says when it is not all of its plan: what was left out and why, as the writer recorded it. */
export function LeftOutNote({ tour }: { tour: Tour }) {
  const note = coverageNote(tour.left_out ?? []);
  return note ? (
    <p className="tour-note left-out" role="note">
      <span>
        <strong>Not everything planned is in this tour.</strong> {note}.
      </span>
    </p>
  ) : null;
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
  /** The ones among them whose answers are ready, and play at once. */
  ready?: readonly string[];
  /** Play the tour again from a chapter's first step. */
  onReplayChapter(step: number): void;
  onReplay(): void;
  /** A question starts the ask flow. */
  onAsk(question: string): void;
  onClose(): void;
}

export function TourEnd({ tour, stopped, questions, ready = [], onReplayChapter, onReplay, onAsk, onClose }: EndProps) {
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
    <TourCardLayer className="end" label="Tour recap">
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
        <LeftOutNote tour={tour} />
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
              {questions.map((question) => {
                const instant = ready.includes(question);
                return (
                  <button
                    type="button"
                    className={`tour-chip${instant ? ' ready' : ''}`}
                    key={question}
                    title={instant ? `${question} (answer ready)` : question}
                    aria-label={instant ? `${question} (answer ready)` : undefined}
                    onClick={() => onAsk(question)}
                  >
                    <span>{question}</span>
                    {instant && <i className="ready-dot" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
    </TourCardLayer>
  );
}
