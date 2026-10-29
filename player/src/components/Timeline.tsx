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
}

/** Where the tour is on the timeline: before it starts, in the step being spoken, or at its end. */
export function elapsedAt(clock: TourClock, state: EngineState, steps: readonly FlatStep[]): number {
  if (!steps.length || state.status === 'idle') return 0;
  if (state.status === 'ended') return clock.total;
  return timeAt(clock, state.index, state.word, steps[state.index]?.words.length ?? 0);
}

/**
 * The tour's timeline above the controls: its chapters as segments with a tick at each step, the
 * time elapsed, and a thumb that shows where it is. A click or drag goes there (the narration
 * resumes at the start of that sentence), and with the keyboard the arrows go by sentence.
 */
export function Timeline({ steps, chapters, clock, state, onSeek, onSkip, onStep }: Props) {
  const track = useRef<HTMLDivElement>(null);
  // The time under the pointer, while it is over the timeline or drags along it.
  const [aim, setAim] = useState<number | null>(null);
  const dragging = useRef(false);
  const total = clock.total;
  const elapsed = elapsedAt(clock, state, steps);
  const shown = aim ?? elapsed;
  const timeOf = (event: PointerEvent) => {
    const box = track.current!.getBoundingClientRect();
    return total * Math.min(1, Math.max(0, (event.clientX - box.left) / Math.max(1, box.width)));
  };
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
      className={`timeline${aim !== null ? ' aiming' : ''}`}
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label="Tour timeline"
      aria-orientation="horizontal"
      aria-valuemin={0}
      aria-valuemax={Math.round(total)}
      aria-valuenow={Math.round(elapsed)}
      aria-valuetext={`Chapter ${chapter + 1} of ${chapters.length}, ${chapters[chapter] ?? ''}, ${formatTime(elapsed)} of ${formatTime(total)}`}
      onKeyDown={onKeyDown}
      onPointerDown={(event) => {
        if (event.pointerType === 'mouse' && event.button !== 0) return;
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
        seek(timeOf(event));
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
            style={{ left: `${(c.start / total) * 100}%`, width: `${(c.length / total) * 100}%` }}
          >
            <div className="tl-rail">
              <span className="tl-fill" style={{ width: `${fill * 100}%` }} />
              {steps
                .filter((fs) => fs.chapterIndex === c.index && fs.index > c.step)
                .map((fs) => (
                  <span key={fs.index} className="tl-tick" style={{ left: `${((clock.steps[fs.index].start - c.start) / c.length) * 100}%` }} />
                ))}
            </div>
          </div>
        );
      })}
      <span className="tl-thumb" style={{ left: `${(shown / total) * 100}%` }} />
      {aim !== null && (
        <span className="tl-tip" style={{ left: `clamp(90px, ${(shown / total) * 100}%, calc(100% - 90px))` }}>
          <strong>{where}</strong>
          <span>{formatTime(shown)}</span>
        </span>
      )}
    </div>
  );
}
