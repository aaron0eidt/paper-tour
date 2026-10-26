import { useEffect, useRef } from 'react';
import type { EngineState, FlatStep } from '../engine';
import { DEFAULT_SPEAKER } from '../types';
import { NextIcon, PauseIcon, PlayIcon, PrevIcon, VolumeIcon } from './icons';

export const SPEEDS = [0.75, 1, 1.25, 1.5];

interface Props {
  steps: FlatStep[];
  state: EngineState;
  speed: number;
  muted: boolean;
  onToggle(): void;
  onPrev(): void;
  onNext(): void;
  onSpeed(speed: number): void;
  onMute(muted: boolean): void;
}

export function ControlBar({ steps, state, speed, muted, onToggle, onPrev, onNext, onSpeed, onMute }: Props) {
  const disabled = !steps.length;
  const current = steps[state.index];
  const playing = state.status === 'playing';
  const textRef = useRef<HTMLDivElement>(null);
  // A speed picked with the mouse or a finger hands focus back, so Space and the arrows control
  // the tour again; with the keyboard, focus stays for further arrow presses.
  const pickedByPointer = useRef(false);

  // Keep the word being spoken in view when the narration is longer than the box.
  useEffect(() => {
    const box = textRef.current;
    const word = box?.querySelector<HTMLElement>('.w.now');
    if (!box || !word) return;
    const top = word.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top + word.offsetHeight > box.scrollTop + box.clientHeight) {
      box.scrollTo({ top: top - box.clientHeight / 3, behavior: 'smooth' });
    }
  }, [state.word, state.index]);

  useEffect(() => {
    textRef.current?.scrollTo({ top: 0 });
  }, [state.index]);

  return (
    <footer className="controls">
      <div className="transport">
        <button className="icon-btn" onClick={onPrev} disabled={disabled || state.status === 'idle' || state.index === 0} aria-label="Previous step">
          <PrevIcon />
        </button>
        <button className="play-btn" onClick={onToggle} disabled={disabled} aria-label={playing ? 'Pause' : 'Play'}>
          {playing ? <PauseIcon /> : <PlayIcon />}
        </button>
        <button
          className="icon-btn"
          onClick={onNext}
          disabled={disabled || (state.status !== 'idle' && state.index >= steps.length - 1)}
          aria-label="Next step"
        >
          <NextIcon />
        </button>
        <span className="step-count">{disabled ? 'No tour' : `step ${state.index + 1} / ${steps.length}`}</span>
      </div>

      <div className="narration">
        {current ? (
          <>
            <span className="speaker">{current.step.speaker ?? DEFAULT_SPEAKER}</span>
            <div className="narration-text" ref={textRef} aria-live="off">
              {state.status === 'idle' && <span className="hint">Press play to start. </span>}
              {current.words.map((w, i) => (
                <span key={i} className={`w${i <= state.word ? ' spoken' : ''}${i === state.word && playing ? ' now' : ''}`}>
                  {w}{' '}
                </span>
              ))}
            </div>
          </>
        ) : (
          <div className="narration-text muted">Add a tour.json to this paper folder to get a narrated tour.</div>
        )}
      </div>

      <div className="settings">
        <label className="speed">
          <span>Speed</span>
          <select
            value={speed}
            onPointerDown={() => (pickedByPointer.current = true)}
            onKeyDown={() => (pickedByPointer.current = false)}
            onChange={(e) => {
              onSpeed(Number(e.target.value));
              if (pickedByPointer.current) e.currentTarget.blur();
              pickedByPointer.current = false;
            }}
            disabled={disabled}
          >
            {SPEEDS.map((s) => (
              <option key={s} value={s}>
                {s}×
              </option>
            ))}
          </select>
        </label>
        <button
          className={`icon-btn${muted ? ' active' : ''}`}
          onClick={() => onMute(!muted)}
          disabled={disabled}
          aria-pressed={muted}
          aria-label={muted ? 'Unmute' : 'Mute'}
          title={muted ? 'Unmute' : 'Mute (timed narration)'}
        >
          <VolumeIcon muted={muted} />
        </button>
      </div>
    </footer>
  );
}
