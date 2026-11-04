import { AnimatedSlider } from '../ui/Slider';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { EngineState, FlatStep } from '../engine';
import { formatTime } from '../tourClock';
import type { TourClock } from '../tourClock';
import { writingLabel } from '../partialTour';
import type { Growth } from '../partialTour';
import { Timeline, elapsedAt } from './Timeline';
import { DEFAULT_SPEAKER } from '../types';
import type { Voice } from '../types';
import { isGoogleVoice, pickVoice, voiceId } from '../narration/voices';
import { rankVoiceChoices } from '../narration/voiceChoices';
import { KEY_HELP } from '../keys';
import { NotClear } from '../ask/NotClear';
import type { NotClearProps } from '../ask/NotClear';
import { KeyboardIcon, NextIcon, PauseIcon, PlayIcon, PrevIcon, VolumeIcon } from './icons';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { AnimatedPopover } from '../ui/controls';
import { ChoicePicker } from './ChoicePicker';
import '../voiceSettings.css';

interface Props {
  steps: FlatStep[];
  /** Chapter titles, by chapter index. */
  chapters: string[];
  clock: TourClock;
  state: EngineState;
  /** The tour is still being written (or stopped being written); null for a finished one. */
  growth?: Growth | null;
  readingSettings?: ReactNode;
  speechSettings?: ReactNode;
  showNarration?: boolean;
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
  voiceOrder?: readonly string[];
  onVoiceChange?(id: string): void;
  voiceConfig?: Voice;
  /** "Not clear?" beside the audio settings; none while there is no step to ask about. */
  unclear?: NotClearProps | null;
}

export function ControlBar({
  steps,
  chapters,
  clock,
  state,
  growth,
  readingSettings,
  speechSettings,
  showNarration = true,
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
  voiceOrder = [],
  onVoiceChange,
  voiceConfig,
  unclear,
}: Props) {
  const disabled = !steps.length;
  const current = steps[state.index];
  const playing = state.status === 'playing';
  const textRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<HTMLElement>(null);
  const [audioOpen, setAudioOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    const element = controlsRef.current;
    if (!element) return;
    const measure = () => element.style.setProperty('--audio-controls-height', `${element.getBoundingClientRect().height}px`);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => observer.disconnect();
  }, []);
  const automaticVoice = pickVoice(voices, voiceConfig);
  const selectedIsAvailable = voices.some((voice) => voiceId(voice) === selectedVoiceId);
  const language = (voiceConfig?.lang ?? automaticVoice?.lang ?? '').toLowerCase().replace(/_/g, '-').split('-')[0];
  const sameLanguage = voices.filter((voice) => voice.lang.toLowerCase().replace(/_/g, '-').split('-')[0] === language);
  const otherLanguages = voices.filter((voice) => !sameLanguage.includes(voice));
  const sortedVoices = (available: SpeechSynthesisVoice[]) => {
    const sorted = [...available].sort((a, b) => Number(isGoogleVoice(b)) - Number(isGoogleVoice(a)) || a.name.localeCompare(b.name));
    return rankVoiceChoices(sorted.map((voice) => ({ value: voiceId(voice), label: voice.name })), voiceOrder)
      .map((option) => sorted.find((voice) => voiceId(voice) === option.value)!);
  };
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
  }, [state.word, state.index, state.waiting, showNarration]);

  useEffect(() => {
    textRef.current?.scrollTo({ top: 0 });
  }, [state.index]);

  return (
    <footer ref={controlsRef} className={`controls${showNarration ? '' : ' without-captions'}`}>
      {state.speechError && <span className="speech-error-announcement" role="alert">{state.speechError}</span>}
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
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span className="ui-play-symbol" key={playing ? 'pause' : 'play'}
              initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.7 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.7 }} transition={{ duration: 0.12 }}>
              {playing ? <PauseIcon /> : <PlayIcon />}
            </motion.span>
          </AnimatePresence>
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
        {!showNarration && state.waiting && growth && growth.phase !== 'stopped' && (
          <span className="transport-waiting" role="status">
            {writingLabel(growth)}…
          </span>
        )}
      </div>

      {showNarration && (
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
            <div className="narration-text muted">Create a guided tour or choose Read aloud to start listening.</div>
          )}
        </div>
      )}

      <div className="settings">
        {unclear && <NotClear {...unclear} />}
        <AnimatedPopover open={audioOpen} onOpenChange={setAudioOpen} side="top" label="Audio settings" className="ui-audio-panel" trigger={
          <button type="button" className="ui-audio-trigger" aria-label={state.speechError ? 'Audio settings: playback needs attention' : 'Audio settings'} data-error={!!state.speechError || undefined} title={state.speechError ?? 'Voice and playback speed'}>
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
          </button>}>
          <div className="playback-panel">
            <div className="playback-panel-heading">
              <h3>Audio settings</h3>
              <button type="button" className="playback-panel-close" aria-label="Close audio settings" onClick={() => {
                setAudioOpen(false);
              }}>
                <svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
              </button>
            </div>
            {state.speechError && <p className="speech-error" role="alert">{state.speechError}</p>}
            {speechSettings}
            {onVoiceChange && !current?.step.audio && (
              <label className="voice-setting">
                <span>Voice</span>
                <ChoicePicker label="Narration voice" value={selectedVoiceId} disabled={disabled || !voices.length} searchable onChange={onVoiceChange}
                  options={[
                    { value: '', label: voicesLoading ? 'Loading voices…' : `Automatic${automaticVoice ? ` · ${automaticVoice.name}` : ' · browser default'}` },
                    ...(selectedVoiceId && !selectedIsAvailable ? [{ value: selectedVoiceId, label: 'Saved voice unavailable' }] : []),
                    ...sortedVoices(sameLanguage).map((voice) => ({ value: voiceId(voice), label: voice.name, badge: voice.lang, group: 'For this paper' })),
                    ...sortedVoices(otherLanguages).map((voice) => ({ value: voiceId(voice), label: voice.name, badge: voice.lang, group: 'Other languages' })),
                  ]} />
                <small>{voiceHint}</small>
              </label>
            )}
            <label className="speed">
              <span className="speed-heading">Speed <output>{speed.toFixed(2)}×</output></span>
              <AnimatedSlider label="Narration speed" valueText={`${speed.toFixed(2)} times normal speed`} min={0.5} max={2} step={0.05} value={speed} onChange={onSpeed} disabled={disabled} />
              <span className="speed-scale" aria-hidden="true"><span>0.5×</span><span>2×</span></span>
            </label>
            {readingSettings && <details className="audio-reading-settings"><summary>Reading options</summary>{readingSettings}</details>}
          </div>
        </AnimatedPopover>
        <AnimatedPopover open={helpOpen} onOpenChange={onHelp} side="top" label="Keyboard shortcuts" className="ui-key-help" trigger={
          <button
            className={`icon-btn key-help-button${helpOpen ? ' open' : ''}`}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <KeyboardIcon />
          </button>}>
            <div className="ui-key-help-content">
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
        </AnimatedPopover>
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
