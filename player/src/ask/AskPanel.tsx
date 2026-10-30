import { useVoiceInput } from './voice';
import { ConversationHistory } from './ConversationHistory';
import { useConversations } from './useConversations';
import { latestAnswer, threadContext } from './conversations';
import type { ConversationContext, ConversationMessage } from '../../../shared/conversations';
import { isLibraryConfigured } from '../library/client';
import { LanguagePicker } from './LanguagePicker';
// The ask bar: a field below the stage that opens into a tray with the tour's suggested questions
// when it ends, a waiting state, the answer's verdict and follow-ups, and errors in plain words. It does not play
// answers: the reader plays them as a second tour and sets the tour aside meanwhile ("Back to the tour").

import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { answerText, askErrorMessage, askQuestion, isCancelled, MAX_HISTORY } from './api';
import type { Answerable, AskAnswer, AskRequest, AskSource, AskTurn } from './api';
import { openQuestions, waitingLabel } from './answer';
import { AnswerKeeper, prefetchPossible } from './prefetch';
import {
  AlertIcon,
  AnswerIcon,
  MicrophoneIcon,
  PauseIcon,
  RegionIcon,
  ResumeIcon,
  SendIcon,
  SparkIcon,
  StopIcon,
} from './icons';
import type { RegionSelection } from './regionSelection';
import './ask.css';

/** Where the learner is when they ask: the tour step, and the figure, panel or equation on screen. */
export type AskContext = ConversationContext;

export interface AskPanelProps {
  source: AskSource;
  onRestoreContext?(context: ConversationContext): void | Promise<void>;
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
  /** A question to ask now, from outside the field (a suggestion on the tour's end card); a new id asks again. */
  request?: { id: number; question: string } | null;
  /**
   * Questions to have answered in the background now (the tour is on its last step), so that picking one plays at once.
   * `stamp` changes when where the learner is changes, so what was asked for is checked against it again.
   */
  prefetch?: { questions: readonly string[]; stamp: string } | null;
  /** The questions among the suggested ones whose answers are kept, as the end card marks them. */
  onReady?(questions: string[]): void;
  /** A question was sent: set the tour aside. */
  onAsk?(question: string): void;
  /** Play the answer; the panel never drives an engine itself. */
  onAnswer(answer: AskAnswer, question: string): void;
  /**
   * Play the answer while it is still written: called with the answer so far each time another step is whole (the first
   * call starts it), and last with `open` false and the whole answer. Without it an answer plays when it is complete.
   */
  onAnswerPart?(answer: AskAnswer, question: string, open: boolean): void;
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
  const [streaming, setStreaming] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const sessions = useConversations('documentId' in source && isLibraryConfigured() ? source.documentId : undefined);
  const persistent = 'documentId' in source && isLibraryConfigured();
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [history, setHistory] = useState<AskTurn[]>([]);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const request = useRef<AbortController | null>(null);
  // An answer is playing while the rest of it is still written.
  const writing = useRef(false);
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
  const busy = phase.kind === 'thinking' || streaming;
  const key = sourceKey(source);
  // Answers asked for ahead of the learner (prefetch.ts); the panel redraws when one is kept, to mark its chip.
  const keeper = useMemo(() => new AnswerKeeper(askQuestion), []);
  const [, redraw] = useReducer((n: number) => n + 1, 0);
  useEffect(() => keeper.subscribe(redraw), [keeper]);

  // Changing tours leaves document conversations intact. Leaving the document stops background questions.
  useEffect(() => {
    setDraft('');
    setPhase({ kind: 'idle' });
    setHistory([]);
    setStreaming(false);
    setHistoryOpen(false);
    return () => {
      const pending = request.current;
      request.current = null;
      pending?.abort();
      keeper.clear();
    };
  }, [key, keeper]);

  // Reopening a document restores the selected thread and its question, but never starts playback.
  const restoredThread = sessions.active?.id;
  useEffect(() => {
    if (request.current) return;
    const last = latestAnswer(sessions.current.current);
    if (last?.answer) setPhase({ kind: 'answered', question: last.question, answer: last.answer });
  }, [restoredThread, sessions.current]);

  useEffect(() => {
    if (props.selection && !props.selecting) input.current?.focus();
  }, [props.selection, props.selecting]);

  // The reader went back to the tour on its own (a step picked in the sidebar, another tour): the answer is gone, and an
  // answer still being written has nowhere to play.
  useEffect(() => {
    if (away) return;
    setPhase((current) => (current.kind === 'answered' ? { kind: 'idle' } : current));
    if (writing.current) {
      writing.current = false;
      setStreaming(false);
      request.current?.abort();
      request.current = null;
    }
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

  // What a question sends. The questions asked in the background are built the same way, so a kept answer is the one a
  // click would have waited for.
  const requestFor = useCallback(
    (question: string, where: AskContext): AskRequest => ({
      question,
      responseLanguage: language || undefined,
      tourId: tourId ?? undefined,
      ...threadContext(where, sessions.current.current),
      conversationId: sessions.current.current?.id,
      history: persistent ? undefined : history,
    }),
    [language, tourId, history, persistent, sessions.current],
  );

  // An answer is here, from the network or kept ahead: remember it, show its verdict and hand it to the reader to play.
  const deliver = useCallback((question: string, answer: AskAnswer) => {
    setHistory((turns) => [...turns, { question, answer: answerText(answer) }].slice(-MAX_HISTORY));
    setPhase({ kind: 'answered', question, answer });
    setDraft('');
    // The keyboard goes back to the player, so Space pauses the answer.
    input.current?.blur();
    latest.current.onAnswer(answer, question);
  }, []);

  // The answer that began playing while it was written is complete (or ends where it stopped): remember it and close it.
  const finish = useCallback((question: string, answer: AskAnswer) => {
    writing.current = false;
    setHistory((turns) => [...turns, { question, answer: answerText(answer) }].slice(-MAX_HISTORY));
    setPhase({ kind: 'answered', question, answer });
    latest.current.onAnswerPart?.(answer, question, false);
  }, []);

  const ask = useCallback(
    async (text: string) => {
      const question = text.replace(/\s+/g, ' ').trim();
      if (!question || busy || voiceBusy || latest.current.selecting) return;
      request.current?.abort();
      writing.current = false;
      const controller = new AbortController();
      request.current = controller;
      setDraft(question);
      setStreaming(true);
      // Where the learner is, read before the tour is set aside.
      const sent = requestFor(question, latest.current.context?.() ?? {});
      const early = persistent ? null : keeper.take(source, sent);
      if (early) {
        // Answered ahead of time: the tour is set aside and the answer plays, with no wait to show.
        request.current = null;
        setStreaming(false);
        latest.current.onAsk?.(question);
        deliver(question, early);
        return;
      }
      setPhase({ kind: 'thinking', question, since: Date.now() });
      latest.current.onAsk?.(question);
      // The answer as far as it is written, once its first step is here: it plays from then on, and the field is free.
      let begun: AskAnswer | null = null;
      const progress = (part: AskAnswer) => {
        if (request.current !== controller) return;
        if (!begun) {
          writing.current = true;
          setDraft('');
          input.current?.blur();
          setPhase({ kind: 'answered', question, answer: part });
        }
        begun = part;
        latest.current.onAnswerPart?.(part, question, true);
      };
      let answer: AskAnswer;
      try {
        if (persistent) {
          const thread = await sessions.ensure(
            {
              analysisId: sent.analysisId,
              tourId: sent.tourId,
              stepId: sent.stepId,
              page: sent.page,
              figureId: sent.figureId,
              selection: sent.selection,
              visualId: sent.visualId,
              visualRevision: sent.visualRevision,
            },
            question,
            controller.signal,
          );
          if (thread) {
            sent.conversationId = thread.id;
            sent.analysisId = thread.context.analysisId;
          }
        }
        const transport = persistent ? askQuestion : keeper.answer.bind(keeper);
        answer = await transport(source, sent, controller.signal, latest.current.onAnswerPart ? progress : undefined);
      } catch (error) {
        if (request.current !== controller) return;
        request.current = null;
        setStreaming(false);
        if (persistent) void sessions.refresh();
        // Close the usable partial answer, while keeping the interruption visible and the question editable.
        if (begun) {
          finish(question, begun);
          setDraft(question);
          setPhase(isCancelled(error)
            ? { kind: 'stopped', question }
            : { kind: 'failed', question, message: askErrorMessage(error) });
          return;
        }
        // Stopped by the learner: back to the question, ready to edit or send again.
        if (isCancelled(error)) {
          setPhase({ kind: 'stopped', question });
          latest.current.onCancel?.();
        } else setPhase({ kind: 'failed', question, message: askErrorMessage(error) });
        return;
      }
      if (request.current !== controller) return;
      request.current = null;
      setStreaming(false);
      if (persistent) void sessions.refresh();
      if (begun) finish(question, answer);
      else deliver(question, answer);
    },
    [busy, voiceBusy, source, keeper, requestFor, deliver, finish, persistent, sessions.ensure, sessions.refresh],
  );

  // The tour's last step asks for the answers to its suggested questions, one at a time, with the request a click on
  // each would send. Nothing is asked for while the learner is in a conversation or the list is empty.
  const wanted = props.prefetch;
  const prefetchKey = wanted ? `${wanted.stamp}\n${wanted.questions.join('\n')}` : '';
  useEffect(() => {
    const now = latest.current.prefetch;
    if (persistent || !now?.questions.length || !prefetchPossible(source, import.meta.env)) {
      keeper.hold();
      return;
    }
    const where = latest.current.context?.() ?? {};
    keeper.prefetch(
      source,
      now.questions.map((question) => requestFor(question, where)),
    );
  }, [prefetchKey, keeper, source, requestFor, persistent]);

  // A question picked outside the field goes through the same flow as one typed in it.
  const askNow = useRef(ask);
  askNow.current = ask;
  const requestedId = props.request?.id;
  useEffect(() => {
    const question = latest.current.request?.question;
    if (requestedId !== undefined && question) void askNow.current(question);
  }, [requestedId]);

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
  // A suggested question whose answer is kept plays at once: its chip says so, and so does the tour's end card.
  const ready = keeper.size ? offered.filter((q) => keeper.has(source, requestFor(q, props.context?.() ?? {}))) : [];
  const readyKey = ready.join('\n');
  useEffect(() => {
    latest.current.onReady?.(readyKey ? readyKey.split('\n') : []);
  }, [readyKey]);
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
    status = (
      <p className="ask-status" role="status">
        Answer stopped. Your playback position is saved.
      </p>
    );
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
      <button
        type="button"
        className="ask-action resume"
        key="answer-control"
        onMouseDown={keepFocus}
        onClick={() => (answering ? props.onPauseAnswer?.() : props.onContinueAnswer?.())}
      >
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
        {phase.kind !== 'idle' && <p className="ask-question">{phase.question}</p>}
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
            {questions.map((q, i) => {
              const instant = ready.includes(q);
              return (
                <button
                  type="button"
                  className={`ask-chip${instant ? ' ready' : ''}`}
                  key={`${i}:${q}`}
                  title={instant ? `${q} (answer ready)` : q}
                  aria-label={instant ? `${q} (answer ready)` : undefined}
                  style={order(i)}
                  onMouseDown={keepFocus}
                  onClick={() => void ask(q)}
                >
                  <span>{q}</span>
                  {instant && <i className="ready-dot" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );

  const replay = async (message: ConversationMessage) => {
    if (!message.answer) return;
    try {
      await latest.current.onRestoreContext?.(message.context);
      setHistoryOpen(false);
      latest.current.onAsk?.(message.question);
      setPhase({ kind: 'answered', question: message.question, answer: message.answer });
      setDraft('');
      latest.current.onAnswer(message.answer, message.question);
    } catch (error) {
      setHistoryOpen(false);
      setPhase({ kind: 'failed', question: message.question, message: askErrorMessage(error) });
    }
  };

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
            <span>
              <strong>Selected region</strong>
              <small>
                Page {props.selection.page} · {props.selectionSnapped ? 'snapped to the object · ' : ''}included with
                your question
              </small>
            </span>
            <button
              type="button"
              onClick={props.onSelectRegion}
              disabled={busy || voiceBusy}
              aria-label="Change selected region"
            >
              Change
            </button>
            <button
              type="button"
              onClick={props.onClearRegion}
              disabled={busy || voiceBusy}
              aria-label="Remove selected region"
              title="Remove selected region"
            >
              ×
            </button>
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
            placeholder={
              props.selecting
                ? 'Select a region on the page…'
                : props.selection
                  ? 'Ask about this region…'
                  : phase.kind === 'answered'
                    ? 'Ask a follow-up…'
                    : 'Ask about this document…'
            }
            aria-label="Ask a question about this document"
            enterKeyHint="send"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {empty && !focused && !busy && <kbd className="ask-kbd">/</kbd>}
          {persistent && (
            <button
              type="button"
              className="ask-conversations"
              aria-label="Open document conversations"
              aria-pressed={!!sessions.active}
              title={sessions.active ? `Conversation: ${sessions.active.title}` : 'Saved conversations'}
              disabled={busy || voiceBusy}
              onClick={() => {
                setHistoryOpen(true);
                void sessions.refresh();
              }}
            >
              <svg
                width="17"
                height="17"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.7"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7A8.4 8.4 0 0 1 4 11.5a8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8v.5Z" />
                <path d="M8 9h8M8 13h5" />
              </svg>
            </button>
          )}
          <LanguagePicker value={language} disabled={busy || voiceBusy} onChange={setLanguage} />
          {props.onSelectRegion && (
            <button
              type="button"
              className={`ask-region${props.selecting || props.selection ? ' selected' : ''}`}
              disabled={busy || voiceBusy}
              aria-label={props.selecting ? 'Cancel region selection' : 'Select a region to ask about'}
              aria-pressed={!!props.selecting}
              title="Select a figure, equation or passage"
              onClick={props.selecting ? props.onCancelSelection : props.onSelectRegion}
            >
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
      {persistent && (
        <ConversationHistory
          open={historyOpen}
          threads={sessions.threads}
          active={sessions.active}
          loading={sessions.loading}
          error={sessions.error}
          onClose={() => setHistoryOpen(false)}
          onSelect={(id) => {
            void sessions.open(id).then((thread) => {
              if (!thread) return;
              const last = latestAnswer(thread);
              latest.current.onResume?.();
              setHistory([]);
              setDraft('');
              setPhase(
                last?.answer ? { kind: 'answered', question: last.question, answer: last.answer } : { kind: 'idle' },
              );
            });
          }}
          onNew={() => {
            sessions.startNew();
            setHistory([]);
            setPhase({ kind: 'idle' });
            setDraft('');
            setHistoryOpen(false);
            latest.current.onResume?.();
            input.current?.focus();
          }}
          onReplay={(message) => void replay(message)}
          onRefresh={() => void sessions.refresh()}
        />
      )}
    </section>
  );
}
