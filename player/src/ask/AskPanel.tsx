import { useVoiceInput } from './voice';
import { LanguagePicker } from './LanguagePicker';
// The ask bar: a field below the stage that opens into a tray with the tour's suggested questions
// when it ends, a waiting state, the answer's verdict and follow-ups, and errors in plain words. It does not play
// answers: the reader plays them as a second tour and sets the tour aside meanwhile ("Back to the tour").

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { answerText, askErrorMessage, askQuestion, isCancelled, MAX_HISTORY } from './api';
import type { Answerable, AskAnswer, AskSource, AskTurn } from './api';
import { openQuestions, waitingLabel } from './answer';
import { AlertIcon, AnswerIcon, MicrophoneIcon, PauseIcon, RegionIcon, ResumeIcon, SendIcon, SparkIcon, StopIcon } from './icons';
import type { RegionSelection } from './regionSelection';
import './ask.css';

/** Where the learner is when they ask: the tour step, and the figure, panel or equation on screen. */
export interface AskContext {
  analysisId?: string;
  stepId?: string;
  figureId?: string;
  selection?: RegionSelection;
}

export interface AskPanelProps {
  source: AskSource;
  tourId?: string | null;
  /** Read when a question is sent, so the answer builds on what the learner just heard and sees. */
  context?(): AskContext;
  /** The tour's suggested questions: offered when the tour ends, and when the empty field gets focus. */
  suggestions?: string[];
  /** The tour has ended, so the panel invites a question. */
  ended?: boolean;
  /** The tour is set aside for a question or an answer: offer "Back to the tour". */
  away?: boolean;
  /** An answer is playing: its follow-ups wait until it ends, so the tray covers less of what it shows. */
  answering?: boolean;
  /** A question was sent: set the tour aside. */
  onAsk?(question: string): void;
  /** Play the answer; the panel never drives an engine itself. */
  onAnswer(answer: AskAnswer, question: string): void;
  /** The learner stopped a question before its answer came. */
  onCancel?(): void;
  onResume?(): void;
  resumeLabel?: string;
  answerPaused?: boolean;
  onPauseAnswer?(): void;
  onContinueAnswer?(): void;
  selection?: RegionSelection | null;
  /** The region was snapped to the object inside it. */
  selectionSnapped?: boolean;
  selecting?: boolean;
  selectionPreview?: ReactNode;
  onSelectRegion?(): void;
  onClearRegion?(): void;
  onCancelSelection?(): void;
  className?: string;
  /** Reader-owned live generation or playback status, kept within the floating card. */
  tourStatus?: ReactNode;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'thinking'; question: string; since: number }
  | { kind: 'stopped'; question: string }
  | { kind: 'answered'; question: string; answer: AskAnswer }
  | { kind: 'failed'; question: string; message: string };

const VERDICT: Record<Answerable, string> = {
  yes: 'Answered from the document',
  partly: 'Partly covered by the document',
  no: 'The document does not cover this',
};
const MAX_LINES_PX = 120;
const sourceKey = (source: AskSource) =>
  'documentId' in source ? `document:${source.documentId}` : `demo:${source.paper}`;

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select'));
}

export function AskPanel(props: AskPanelProps) {
  const { source, tourId, suggestions, ended = false, away = false, answering = false, className } = props;
  const [draft, setDraft] = useState('');
  const [language, setLanguage] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [history, setHistory] = useState<AskTurn[]>([]);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const request = useRef<AbortController | null>(null);
  // The reader's callbacks as of now, for an answer that arrives after it re-rendered.
  const latest = useRef(props);
  latest.current = props;
  const voice = useVoiceInput(source, {
    onStart: () => latest.current.onAsk?.(''),
    onCancel: () => latest.current.onCancel?.(),
    onTranscript: (text) => {
      setDraft(text);
      setPhase({ kind: 'idle' });
      input.current?.focus();
    },
  });
  const voiceBusy = voice.phase !== 'idle';
  const busy = phase.kind === 'thinking';
  const key = sourceKey(source);

  // A new document or tour starts a new conversation.
  useEffect(() => {
    setDraft('');
    setPhase({ kind: 'idle' });
    setHistory([]);
    return () => {
      const pending = request.current;
      request.current = null;
      pending?.abort();
    };
  }, [key, tourId]);

  useEffect(() => {
    if (props.selection && !props.selecting) input.current?.focus();
  }, [props.selection, props.selecting]);

  // The reader went back to the tour on its own (a step picked in the sidebar, another tour): the answer is gone.
  useEffect(() => {
    if (!away) setPhase((current) => (current.kind === 'answered' ? { kind: 'idle' } : current));
  }, [away]);

  // While waiting, the status says what is happening, so a long wait does not look stuck.
  const [, tick] = useState(0);
  useEffect(() => {
    if (!busy) return;
    const timer = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  // The field grows with the question, up to a few lines.
  useLayoutEffect(() => {
    const el = input.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, MAX_LINES_PX)}px`;
  }, [draft]);

  // "/" focuses the field from anywhere in the reader.
  useEffect(() => {
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== '/' || event.altKey || event.ctrlKey || event.metaKey || isTyping(event.target)) return;
      event.preventDefault();
      input.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ask = useCallback(
    async (text: string) => {
      const question = text.replace(/\s+/g, ' ').trim();
      if (!question || busy || voiceBusy || latest.current.selecting) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setDraft(question);
      setPhase({ kind: 'thinking', question, since: Date.now() });
      // Where the learner is, read before the tour is set aside.
      const where = latest.current.context?.() ?? {};
      latest.current.onAsk?.(question);
      let answer: AskAnswer;
      try {
        answer = await askQuestion(
          source,
          { question, responseLanguage: language || undefined, tourId: tourId ?? undefined, ...where, history },
          controller.signal,
        );
      } catch (error) {
        if (request.current !== controller) return;
        request.current = null;
        // Stopped by the learner: back to the question, ready to edit or send again.
        if (isCancelled(error)) {
          setPhase({ kind: 'stopped', question });
          latest.current.onCancel?.();
        } else setPhase({ kind: 'failed', question, message: askErrorMessage(error) });
        return;
      }
      if (request.current !== controller) return;
      request.current = null;
      setHistory((turns) => [...turns, { question, answer: answerText(answer) }].slice(-MAX_HISTORY));
      setPhase({ kind: 'answered', question, answer });
      setDraft('');
      // The keyboard goes back to the player, so Space pauses the answer.
      input.current?.blur();
      latest.current.onAnswer(answer, question);
    },
    [busy, voiceBusy, source, tourId, history, language],
  );

  const stop = () => request.current?.abort();
  // Back to the tour folds the panel away and hands the keyboard back to the player; the conversation stays.
  const resumeTour = () => {
    setPhase({ kind: 'idle' });
    setDraft('');
    input.current?.blur();
    latest.current.onResume?.();
  };
  const askAnother = () => {
    setDraft('');
    input.current?.focus();
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (busy) stop();
    else void ask(draft);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (!busy) void ask(draft);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      if (busy) stop();
      else input.current?.blur();
    }
  };

  // What the tray above the field shows. Typing a new question hides the old answer's questions.
  const typing = draft.trim() !== '' && !busy && !(phase.kind === 'failed' && draft.trim() === phase.question);
  const asked = history.map((turn) => turn.question);
  const offered = openQuestions(suggestions, asked);
  const invite = phase.kind === 'idle' && !typing && ended && !away && offered.length > 0;
  const questions =
    typing || busy || phase.kind === 'failed'
      ? []
      : phase.kind === 'answered'
        ? answering
          ? []
          : openQuestions(phase.answer.followups, asked, 2)
        : // Questions about the whole document make no sense beside a chosen region: its chip is the context.
          invite || (focused && !history.length && !props.selection)
          ? offered
          : [];
  const back = away && !busy && !voiceBusy && !props.selecting;
  let status: ReactNode = null;
  if (phase.kind === 'thinking')
    status = (
      <p className="ask-status" role="status">
        <span className="ask-shimmer">{waitingLabel(Date.now() - phase.since)}</span>
      </p>
    );
  else if (phase.kind === 'stopped')
    status = <p className="ask-status" role="status">Answer stopped. Your playback position is saved.</p>;
  else if (phase.kind === 'answered' && !typing)
    status = (
      <p className={`ask-status ${phase.answer.answerable}`} role="status">
        <AnswerIcon answerable={phase.answer.answerable} />
        <span>{VERDICT[phase.answer.answerable]}</span>
      </p>
    );
  else if (phase.kind === 'failed' && !typing)
    status = (
      <p className="ask-status failed" role="alert">
        <AlertIcon />
        <span>{phase.message}</span>
      </p>
    );
  else if (invite)
    status = (
      <p className="ask-status invite" role="status">
        <SparkIcon />
        <span>That was the tour. Ask anything, or start with one of these.</span>
      </p>
    );
  // Chips keep the focus in the field, so a click lands before the tray reacts to a blur.
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  const actions: ReactNode[] = [];
  if (phase.kind === 'failed' && !typing)
    actions.push(
      <button
        type="button"
        className="ask-action"
        key="retry"
        onMouseDown={keepFocus}
        onClick={() => void ask(phase.question)}
      >
        Try again
      </button>,
    );
  if (phase.kind === 'answered' && !typing)
    actions.push(
      <button type="button" className="ask-action" key="another" onMouseDown={keepFocus} onClick={askAnother}>
        Ask another
      </button>,
    );
  if ((answering || props.answerPaused) && !busy && !voiceBusy && !props.selecting)
    actions.push(
      <button type="button" className="ask-action resume" key="answer-control" onMouseDown={keepFocus}
        onClick={() => answering ? props.onPauseAnswer?.() : props.onContinueAnswer?.()}>
        {answering ? <PauseIcon /> : <ResumeIcon />}
        <span>{answering ? 'Pause answer' : 'Continue answer'}</span>
      </button>,
    );
  if (back)
    actions.push(
      <button type="button" className="ask-action resume" key="back" onMouseDown={keepFocus} onClick={resumeTour}>
        <ResumeIcon />
        <span>{props.resumeLabel ?? 'Back to the tour'}</span>
      </button>,
    );
  const open = !!status || !!questions.length || actions.length > 0 || !!voice.error || voiceBusy;
  // Keep the last content while the tray folds away, so it does not vanish before it closes.
  const tray = useRef<ReactNode>(null);
  const order = (i: number) => ({ '--i': i }) as CSSProperties;
  if (open)
    tray.current = (
      <div className="ask-tray-body">
        {voice.error && (
          <p className="ask-status failed" role="alert">
            {voice.error}
          </p>
        )}
        {voiceBusy && (
          <p className="ask-status" role="status">
            {voice.phase === 'permission'
              ? 'Allow the microphone, then hold to record.'
              : voice.phase === 'recording'
                ? 'Listening… release to transcribe.'
                : 'Transcribing…'}
          </p>
        )}
        {(status || actions.length > 0) && (
          <div className="ask-head">
            {status}
            {actions.length > 0 && <div className="ask-actions">{actions}</div>}
          </div>
        )}
        {questions.length > 0 && (
          <div className="ask-chips" key={phase.kind === 'answered' ? `answer:${phase.question}` : 'suggested'}>
            {questions.map((q, i) => (
              <button
                type="button"
                className="ask-chip"
                key={`${i}:${q}`}
                title={q}
                style={order(i)}
                onMouseDown={keepFocus}
                onClick={() => void ask(q)}
              >
                <span>{q}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    );

  const empty = !draft.trim();
  const expanded = focused || busy || open || !empty;
  return (
    <section
      className={`ask${expanded ? ' expanded' : ''}${className ? ` ${className}` : ''}`}
      aria-label="Ask about this document"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className={`ask-card${focused ? ' focused' : ''}${busy ? ' busy' : ''}${away ? ' away' : ''}`}>
        {props.tourStatus}
        <div className={`ask-tray${open ? ' open' : ''}`}>
          <div className="ask-tray-clip">{tray.current}</div>
        </div>
        {props.selection && !props.selecting && (
          <div className="ask-selection-chip">
            {props.selectionPreview}
            <span><strong>Selected region</strong><small>Page {props.selection.page} · {props.selectionSnapped ? 'snapped to the object · ' : ''}included with your question</small></span>
            <button type="button" onClick={props.onSelectRegion} disabled={busy || voiceBusy} aria-label="Change selected region">Change</button>
            <button type="button" onClick={props.onClearRegion} disabled={busy || voiceBusy} aria-label="Remove selected region" title="Remove selected region">×</button>
          </div>
        )}
        <form className="ask-bar" onSubmit={submit}>
          <SparkIcon />
          <textarea
            ref={input}
            className="ask-input"
            rows={1}
            value={draft}
            readOnly={busy || voiceBusy || props.selecting}
            placeholder={props.selecting ? 'Select a region on the page…' : props.selection ? 'Ask about this region…' : phase.kind === 'answered' ? 'Ask a follow-up…' : 'Ask about this document…'}
            aria-label="Ask a question about this document"
            enterKeyHint="send"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {empty && !focused && !busy && <kbd className="ask-kbd">/</kbd>}
          <LanguagePicker value={language} disabled={busy || voiceBusy} onChange={setLanguage} />
          {props.onSelectRegion && (
            <button type="button" className={`ask-region${props.selecting || props.selection ? ' selected' : ''}`}
              disabled={busy || voiceBusy} aria-label={props.selecting ? 'Cancel region selection' : 'Select a region to ask about'}
              aria-pressed={!!props.selecting} title="Select a figure, equation or passage"
              onClick={props.selecting ? props.onCancelSelection : props.onSelectRegion}>
              <RegionIcon />
            </button>
          )}
          {voice.available && (
            <button
              type="button"
              className={`ask-mic${voice.phase === 'recording' ? ' recording' : ''}`}
              aria-label={voiceBusy ? 'Cancel voice input' : 'Hold to record a question'}
              title="Hold to record; release to transcribe with your Meta connection. Review the text before asking."
              disabled={busy}
              onPointerDown={(e) => {
                if (voiceBusy) {
                  voice.cancel();
                  return;
                }
                e.currentTarget.setPointerCapture(e.pointerId);
                void voice.begin();
              }}
              onPointerUp={() => voice.stop()}
              onPointerCancel={() => voice.cancel()}
              onKeyDown={(e) => {
                if (e.key === 'Escape') voice.cancel();
                else if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                  e.preventDefault();
                  void voice.begin();
                }
              }}
              onKeyUp={(e) => {
                if (e.key === ' ' || e.key === 'Enter') {
                  e.preventDefault();
                  voice.stop();
                }
              }}
              onClick={(e) => {
                if (e.detail === 0) {
                  if (voiceBusy) voice.stop();
                  else void voice.begin();
                }
              }}
            >
              {voice.phase === 'transcribing' ? '…' : <MicrophoneIcon />}
            </button>
          )}
          {/* Nothing to send yet: the bar stays quiet, and the controls before it do not move when it appears. */}
          {(busy || !empty) && (
            <button
              type="submit"
              className={`ask-send${busy ? ' stop' : ' ready'}`}
              disabled={voiceBusy || props.selecting}
              aria-label={busy ? 'Stop generating answer' : 'Ask'}
              title={busy ? 'Stop generating answer (Esc)' : 'Ask (Enter)'}
            >
              {busy ? <StopIcon /> : <SendIcon />}
            </button>
          )}
        </form>
      </div>
    </section>
  );
}
