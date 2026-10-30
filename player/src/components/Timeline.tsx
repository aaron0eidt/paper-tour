import { useRef, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import type { EngineState, FlatStep } from '../engine';
import { formatTime, timeAt, wordAt } from '../tourClock';
import type { TourClock } from '../tourClock';
import './timeline.css';

interface Props {
  steps: FlatStep[];
  /** Chapter titles, by chapter index. */
  chapters: string[];
  clock: TourClock;
  state: EngineState;
  onSeek(index: number, word: number): void;
  /** One sentence back or on. */
  onSkip(direction: 1 | -1): void;
  /** One step back or on. */
  onStep(direction: 1 | -1): void;
  /** What the timeline says while a tour still being written waits for its next step. */
  writingLabel?: string;
}

/** Where the tour is on the timeline: before it starts, in the step being spoken, or at its end. */
export function elapsedAt(clock: TourClock, state: EngineState, steps: readonly FlatStep[]): number {
  if (!steps.length || state.status === 'idle') return 0;
  if (state.status === 'ended' || state.waiting) return clock.total;
  return timeAt(clock, state.index, state.word, steps[state.index]?.words.length ?? 0);
}

/**
 * The tour's timeline above the controls: its chapters as segments with a tick at each step, the
 * time elapsed, and a thumb that shows where it is. A click or drag goes there (the narration
 * resumes at the start of that sentence), and with the keyboard the arrows go by sentence. A tour still being written ends
 * in a dashed stretch for what is expected, where nothing can be played yet.
 */
export function Timeline({ steps, chapters, clock, state, onSeek, onSkip, onStep, writingLabel }: Props) {
  const track = useRef<HTMLDivElement>(null);
  // The time under the pointer, while it is over the timeline or drags along it.
  const [aim, setAim] = useState<number | null>(null);
  const dragging = useRef(false);
  const total = clock.total;
  const span = Math.max(total, clock.span);
  const elapsed = elapsedAt(clock, state, steps);
  // Where the pointer is on the timeline, in time; past `total` it is over what is not written yet.
  const timeOf = (event: PointerEvent) => {
    const box = track.current!.getBoundingClientRect();
    return span * Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
  };
  const unwritten = aim !== null && aim > total;
  const shown = aim === null ? elapsed : Math.min(aim, total);
  const seek = (time: number) => {
    const { index, word } = wordAt(clock, time, steps.map((fs) => fs.words.length));
    onSeek(index, word);
  };
  const at = wordAt(clock, shown, steps.map((fs) => fs.words.length));
  const chapter = steps[at.index]?.chapterIndex ?? 0;
  const where = `${chapter + 1}. ${chapters[chapter] ?? ''}`;
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    const direction = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? -1 : 0;
    if (direction) (event.shiftKey ? onStep : onSkip)(direction);
    else if (event.key === 'Home') onSeek(0, 0);
    else if (event.key === 'End') onSeek(steps.length - 1, 0);
    else return;
    // The arrows are the timeline's own while it has the focus: the reader's step keys stay out of it.
    event.preventDefault();
    event.stopPropagation();
  };
  if (!steps.length || total <= 0) return null;
  return (
    <div
      className={`timeline${aim !== null ? ' aiming' : ''}${state.waiting ? ' waiting' : ''}`}
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label="Tour timeline"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(elapsed)}
      aria-valuetext={`Chapter ${chapter + 1} of ${chapters.length}, ${chapters[chapter] ?? ''}, ${formatTime(elapsed)} of ${formatTime(total)}${clock.pending > 0 ? ' so far' : ''}${state.waiting && writingLabel ? `, ${writingLabel.toLowerCase()}` : ''}`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        // Nothing to go to in the part that is not written yet.
        if (timeOf(event) > total) return;
        dragging.current = true;
        event.currentTarget.setPointerCapture(event.pointerId);
        setAim(timeOf(event));
      }}
      onPointerMove={(event) => {
        // A mouse hovering shows where a click would go; a pen or finger only while it is down.
        if (dragging.current || event.pointerType === 'mouse') setAim(timeOf(event));
      }}
      onPointerUp={(event) => {
        if (!dragging.current) return;
        dragging.current = false;
        seek(Math.min(timeOf(event), total));
        setAim(event.pointerType === 'mouse' ? timeOf(event) : null);
        // The keyboard goes back to the reader (Space plays, the arrows step); Tab brings it here again.
        event.currentTarget.blur();
      }}
      onPointerCancel={() => {
        dragging.current = false;
        setAim(null);
      }}
      onPointerLeave={() => {
        if (!dragging.current) setAim(null);
      }}
    >
      {clock.chapters.map((c) => {
        const fill = Math.min(1, Math.max(0, (shown - c.start) / c.length));
        return (
          <div
            key={c.index}
            className={`tl-chapter${shown >= c.start && shown < c.start + c.length ? ' current' : ''}`}
            style={{ left: `${(c.start / span) * 100}%`, width: `${(c.length / span) * 100}%` }}
          >
            <div className="tl-rail">
              <span className="tl-fill" style={{ width: `${fill * 100}%` }} />
              {steps
                .filter((fs) => fs.chapterIndex === c.index && fs.index > c.step)
                .map((fs) => (
                  <span key={fs.index} className="tl-tick" style={{ left: `${((clock.steps[fs.index].start - c.start) / c.length) * 100}%` }} />
                ))}
            </div>
            {/* A checkpoint pauses where its narration ends; the mark fills once the tour has come that far. */}
            {steps
              .filter((fs) => fs.chapterIndex === c.index && fs.checkpoint)
              .map((fs) => {
                const at = clock.steps[fs.index].start + clock.steps[fs.index].speech;
                return (
                  <span
                    key={fs.index}
                    className={`tl-pause${shown >= at ? ' reached' : ''}`}
                    style={{ left: `calc((100% - var(--tl-gap)) * ${Math.min(1, (at - c.start) / c.length)})` }}
                    aria-hidden="true"
                  />
                );
              })}
          </div>
        );
      })}
      {/* What is expected of a tour still being written: nothing to play there yet. */}
      {clock.pending > 0 && (
        <div
          className={`tl-chapter tl-pending${state.waiting ? ' waiting' : ''}`}
          style={{ left: `${(total / span) * 100}%`, width: `${(clock.pending / span) * 100}%` }}
          aria-hidden="true"
        >
          <div className="tl-rail" />
        </div>
      )}
      <span className="tl-thumb" style={{ left: `${(shown / span) * 100}%` }} />
      {aim !== null && (
        <span className="tl-tip" style={{ left: `clamp(90px, ${((unwritten ? aim : shown) / span) * 100}%, calc(100% - 90px))` }}>
          <strong>{unwritten ? writingLabel ?? 'Not written yet' : where}</strong>
          <span>{unwritten ? 'Not ready to play' : formatTime(shown)}</span>
        </span>
      )}
    </div>
  );
}
