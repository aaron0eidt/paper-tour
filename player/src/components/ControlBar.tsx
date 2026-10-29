import { useEffect, useRef } from 'react';
import type { EngineState, FlatStep } from '../engine';
import { formatTime } from '../tourClock';
import type { TourClock } from '../tourClock';
import { writingLabel } from '../partialTour';
import type { Growth } from '../partialTour';
import { Timeline, elapsedAt } from './Timeline';
import { DEFAULT_SPEAKER } from '../types';
import type { Voice } from '../types';
import { isGoogleVoice, pickVoice, voiceId } from '../narration/voices';
import { KEY_HELP } from '../keys';
import { KeyboardIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, VolumeIcon } from './icons';
import '../voiceSettings.css';

interface Props {
  steps: FlatStep[];
  /** Chapter titles, by chapter index. */
  chapters: string[];
  clock: TourClock;
  state: EngineState;
  /** The tour is still being written (or stopped being written); null for a finished one. */
  growth?: Growth | null;
  speed: number;
  muted: boolean;
  onToggle(): void;
  onPrev(): void;
  onNext(): void;
  onSeek(index: number, word: number): void;
  onSkip(direction: 1 | -1): void;
  helpOpen: boolean;
  onHelp(open: boolean): void;
  onSpeed(speed: number): void;
  onMute(muted: boolean): void;
  voices?: SpeechSynthesisVoice[];
  voicesLoading?: boolean;
  selectedVoiceId?: string;
  onVoiceChange?(id: string): void;
  voiceConfig?: Voice;
}

export function ControlBar({
  steps,
  chapters,
  clock,
  state,
  growth,
  speed,
  muted,
  onToggle,
  onPrev,
  onNext,
  onSeek,
  onSkip,
  helpOpen,
  onHelp,
  onSpeed,
  onMute,
  voices = [],
  voicesLoading = false,
  selectedVoiceId = '',
  onVoiceChange,
  voiceConfig,
}: Props) {
  const disabled = !steps.length;
  const current = steps[state.index];
  const playing = state.status === 'playing';
  const textRef = useRef<HTMLDivElement>(null);
  const audioPanel = useRef<HTMLDetailsElement>(null);
  const helpPanel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (audioPanel.current?.open && !audioPanel.current.contains(event.target as Node))
        audioPanel.current.open = false;
      if (helpOpen && !helpPanel.current?.contains(event.target as Node)) onHelp(false);
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && audioPanel.current?.open) {
        audioPanel.current.open = false;
        audioPanel.current.querySelector('summary')?.focus();
      }
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', escape);
    };
  }, [helpOpen, onHelp]);
  // A speed picked with the mouse or a finger hands focus back, so Space and the arrows control
  // the tour again; with the keyboard, focus stays for further arrow presses.
  const pickedByPointer = useRef(false);
  const automaticVoice = pickVoice(voices, voiceConfig);
  const selectedIsAvailable = voices.some((voice) => voiceId(voice) === selectedVoiceId);
  const language = (voiceConfig?.lang ?? automaticVoice?.lang ?? '').toLowerCase().replace(/_/g, '-').split('-')[0];
  const sameLanguage = voices.filter((voice) => voice.lang.toLowerCase().replace(/_/g, '-').split('-')[0] === language);
  const otherLanguages = voices.filter((voice) => !sameLanguage.includes(voice));
  const sortedVoices = (available: SpeechSynthesisVoice[]) =>
    [...available].sort((a, b) => Number(isGoogleVoice(b)) - Number(isGoogleVoice(a)) || a.name.localeCompare(b.name));
  const voiceHint = voicesLoading
    ? 'Loading this browser’s voices…'
    : !voices.length
      ? 'This browser lists no voices.'
      : selectedVoiceId && !selectedIsAvailable
        ? 'Saved voice unavailable; using Automatic.'
        : !sameLanguage.some(isGoogleVoice)
          ? 'No Google voice for this language in this browser.'
          : selectedVoiceId
            ? 'Using your selected voice.'
            : 'Google voice preferred automatically.';

  // Keep the word being spoken in view when the narration is longer than the box. The caption moves by whole lines, so
  // no half line shows at its edges: the line being spoken sits second, with the next one already in view below it.
  useEffect(() => {
    const box = textRef.current;
    const word = box?.querySelector<HTMLElement>('.w.now');
    // A tour that waits for its next step shows that line last, under as much of what was said as fits.
    const waiting = box?.querySelector<HTMLElement>('.writing-status');
    if (!box || !(waiting ?? word)) return;
    const line = parseFloat(getComputedStyle(box).lineHeight) || 23;
    const first = Math.round(box.scrollTop / line);
    if (waiting) {
      const rows = Math.max(1, Math.floor(box.clientHeight / line + 0.1));
      const at = Math.round((waiting.offsetTop - box.offsetTop) / line);
      if (at !== first + rows - 1) box.scrollTo({ top: Math.max(0, at - rows + 1) * line, behavior: 'smooth' });
      return;
    }
    const spoken = Math.round((word!.offsetTop - box.offsetTop) / line);
    if (spoken < first || spoken > first + 1) box.scrollTo({ top: Math.max(0, spoken - 1) * line, behavior: 'smooth' });
  }, [state.word, state.index, state.waiting]);

  useEffect(() => {
    textRef.current?.scrollTo({ top: 0 });
  }, [state.index]);

  return (
    <footer className="controls">
      <Timeline
        steps={steps}
        chapters={chapters}
        clock={clock}
        state={state}
        onSeek={onSeek}
        onSkip={onSkip}
        onStep={(direction) => (direction > 0 ? onNext() : onPrev())}
        writingLabel={growth && growth.phase !== 'stopped' ? writingLabel(growth) : undefined}
      />
      <div className="transport">
        <button
          className="icon-btn"
          onClick={onPrev}
          disabled={disabled || state.status === 'idle' || state.index === 0}
          aria-label="Previous step"
        >
          <PrevIcon />
        </button>
        <button
          className="play-btn"
          onClick={onToggle}
          disabled={disabled}
          aria-label={playing ? 'Pause' : state.awaiting ? 'Show solution' : 'Play'}
          title={state.awaiting ? 'Show the solution' : undefined}
        >
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
        <span
          className="step-count"
          title={
            clock.pending > 0
              ? 'More of the tour is still being written'
              : clock.measured || muted
                ? undefined
                : 'Estimated from the narration; a voice may be quicker or slower'
          }
        >
          {disabled
            ? 'No tour'
            : `${formatTime(elapsedAt(clock, state, steps))} / ${clock.measured || muted ? '' : '~'}${formatTime(clock.total)}${clock.pending > 0 ? '+' : ''}`}
        </span>
      </div>

      <div className="narration">
        {current ? (
          <>
            <span className="speaker">{current.step.speaker ?? DEFAULT_SPEAKER}</span>
            <div className="narration-text" ref={textRef} aria-live="off">
              {state.status === 'idle' && <span className="hint">Press play to start. </span>}
              {current.words.map((w, i) => (
                <span
                  key={i}
                  className={`w${i <= state.word ? ' spoken' : ''}${i === state.word && playing ? ' now' : ''}`}
                >
                  {w}{' '}
                </span>
              ))}
              {/* Everything written has been played: say what the tour waits for, on the line after the last word. */}
              {state.waiting && growth && growth.phase !== 'stopped' && (
                <span className="writing-status" role="status">
                  <i aria-hidden="true" />
                  {writingLabel(growth)}…
                </span>
              )}
            </div>
          </>
        ) : (
          <div className="narration-text muted">Add a tour.json to this paper folder to get a narrated tour.</div>
        )}
      </div>

      <div className="settings">
        <details className="playback-options" ref={audioPanel}>
          <summary aria-label="Audio settings" title="Voice and playback speed">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M4 7h16M4 17h16M8 4v6M16 14v6" />
            </svg>
            <span>Audio</span>
            <span className="playback-speed">{speed}×</span>
          </summary>
          <div className="playback-panel">
            <h3>Audio settings</h3>
            {onVoiceChange && !current?.step.audio && (
              <label className="voice-setting">
                <span>Voice</span>
                <select
                  aria-label="Narration voice"
                  value={selectedVoiceId}
                  title={voiceHint}
                  disabled={disabled || !voices.length}
                  onPointerDown={() => (pickedByPointer.current = true)}
                  onKeyDown={() => (pickedByPointer.current = false)}
                  onChange={(event) => {
                    onVoiceChange(event.target.value);
                    if (pickedByPointer.current) event.currentTarget.blur();
                    pickedByPointer.current = false;
                  }}
                >
                  <option value="">
                    {voicesLoading
                      ? 'Loading voices…'
                      : `Automatic${automaticVoice ? ` · ${automaticVoice.name}` : ' · browser default'}`}
                  </option>
                  {selectedVoiceId && !selectedIsAvailable && (
                    <option value={selectedVoiceId} disabled>
                      Saved voice unavailable
                    </option>
                  )}
                  {sameLanguage.length > 0 && (
                    <optgroup label="For this paper">
                      {sortedVoices(sameLanguage).map((voice) => (
                        <option value={voiceId(voice)} key={voiceId(voice)}>
                          {voice.name} ({voice.lang})
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {otherLanguages.length > 0 && (
                    <optgroup label="Other languages">
                      {sortedVoices(otherLanguages).map((voice) => (
                        <option value={voiceId(voice)} key={voiceId(voice)}>
                          {voice.name} ({voice.lang})
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
                <small>{voiceHint}</small>
              </label>
            )}
            <label className="speed">
              <span className="speed-heading">Speed <output>{speed.toFixed(2)}×</output></span>
              <input type="range" aria-label="Narration speed" aria-valuetext={`${speed.toFixed(2)} times normal speed`} min={0.5} max={2} step={0.05} value={speed} onChange={(event) => onSpeed(Number(event.target.value))} disabled={disabled} />
              <span className="speed-scale" aria-hidden="true"><span>0.5×</span><span>2×</span></span>
            </label>
          </div>
        </details>
        <div className="key-help-wrap" ref={helpPanel}>
          <button
            className={`icon-btn key-help-button${helpOpen ? ' open' : ''}`}
            onClick={() => onHelp(!helpOpen)}
            aria-expanded={helpOpen}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <KeyboardIcon />
          </button>
          {helpOpen && (
            <div className="key-help" role="dialog" aria-label="Keyboard shortcuts">
              <h3>Keyboard</h3>
              <dl>
                {KEY_HELP.map((row) => (
                  <div key={row.does}>
                    <dt>
                      {row.keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </dt>
                    <dd>{row.does}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
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
