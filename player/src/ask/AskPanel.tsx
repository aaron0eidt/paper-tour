// The ask bar: a question field, suggested questions when the tour ends, follow-ups after an answer, a short thinking
// state and errors in plain words. It does not play answers: it hands their steps to onAnswer, and the reader inserts
// them into the tour as a micro-tour.

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CSSProperties, FormEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import type { Step } from '../types';
import { answerText, askErrorMessage, askQuestion, isCancelled, MAX_HISTORY, MAX_QUESTION } from './api';
import type { Answerable, AskAnswer, AskTurn } from './api';
import { AlertIcon, AnswerIcon, ResumeIcon, SendIcon, SparkIcon, StopIcon } from './icons';
import './ask.css';

export interface AskPanelProps {
  documentId: string;
  tourId?: string | null;
  /** The step playing or paused on, so the answer builds on what the learner just heard. */
  stepId?: string | null;
  /** The figure, panel or equation on screen, for questions about "this". */
  figureId?: string | null;
  /** The tour's suggested questions: offered when the tour ends, and when the empty field gets focus. */
  suggestions?: string[];
  /** The tour has ended, so the panel invites a question. */
  ended?: boolean;
  /** Play the answer; the panel never drives the engine itself. */
  onAnswer(steps: Step[], answer: AskAnswer): void;
  /** A question was sent, for example to pause the tour. */
  onAsk?(question: string): void;
  /** Offered after an answer as "Back to the tour". */
  onResume?(): void;
  className?: string;
}

type Phase =
  | { kind: 'idle' }
  | { kind: 'thinking'; question: string }
  | { kind: 'answered'; question: string; answer: AskAnswer }
  | { kind: 'failed'; question: string; message: string };

const VERDICT: Record<Answerable, string> = {
  yes: 'Answered from the paper',
  partly: 'Partly covered by the paper',
  no: 'The paper does not cover this',
};
const MAX_LINES_PX = 120;

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || !!target.closest('input, textarea, select'));
}

export function AskPanel({
  documentId,
  tourId,
  stepId,
  figureId,
  suggestions = [],
  ended = false,
  onAnswer,
  onAsk,
  onResume,
  className,
}: AskPanelProps) {
  const [draft, setDraft] = useState('');
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [history, setHistory] = useState<AskTurn[]>([]);
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);
  const request = useRef<AbortController | null>(null);
  const busy = phase.kind === 'thinking';

  // A new document or tour starts a new conversation.
  useEffect(() => {
    setDraft('');
    setPhase({ kind: 'idle' });
    setHistory([]);
    return () => request.current?.abort();
  }, [documentId, tourId]);

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
      const question = text.replace(/\s+/g, ' ').trim().slice(0, MAX_QUESTION);
      if (!question || busy) return;
      request.current?.abort();
      const controller = new AbortController();
      request.current = controller;
      setDraft(question);
      setPhase({ kind: 'thinking', question });
      onAsk?.(question);
      let answer: AskAnswer;
      try {
        answer = await askQuestion(
          documentId,
          {
            question,
            tourId: tourId ?? undefined,
            stepId: stepId ?? undefined,
            figureId: figureId ?? undefined,
            history,
          },
          controller.signal,
        );
      } catch (error) {
        if (request.current !== controller) return;
        request.current = null;
        // Stopped by the learner: back to the question, ready to edit or send again.
        setPhase(isCancelled(error) ? { kind: 'idle' } : { kind: 'failed', question, message: askErrorMessage(error) });
        return;
      }
      if (request.current !== controller) return;
      request.current = null;
      setHistory((turns) => [...turns, { question, answer: answerText(answer) }].slice(-MAX_HISTORY));
      setPhase({ kind: 'answered', question, answer });
      setDraft('');
      onAnswer(answer.steps, answer);
    },
    [busy, documentId, tourId, stepId, figureId, history, onAsk, onAnswer],
  );

  const stop = () => request.current?.abort();
  // Back to the tour folds the panel away and hands the keyboard back to the player; the conversation stays.
  const resumeTour = () => {
    setPhase({ kind: 'idle' });
    input.current?.blur();
    onResume?.();
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

  // What the tray above the field shows. Typing a new question hides the old answer's suggestions.
  const typing = draft.trim() !== '' && !busy && !(phase.kind === 'failed' && draft.trim() === phase.question);
  const questions =
    typing || busy || phase.kind === 'failed'
      ? []
      : phase.kind === 'answered'
        ? phase.answer.followups
        : ended || (focused && !history.length)
          ? suggestions.filter((q) => q.trim()).slice(0, 3)
          : [];
  const resume = phase.kind === 'answered' && !typing && onResume;
  let status: ReactNode = null;
  if (busy)
    status = (
      <p className="ask-status" role="status">
        <span className="ask-shimmer">Thinking</span>
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
        <button type="button" className="ask-retry" onClick={() => void ask(phase.question)}>
          Try again
        </button>
      </p>
    );
  const open = !!status || !!questions.length || !!resume;
  // Keep the last content while the tray folds away, so it does not vanish before it closes.
  const tray = useRef<ReactNode>(null);
  // Chips keep the focus in the field, so a click lands before the tray reacts to a blur.
  const keepFocus = (event: MouseEvent) => event.preventDefault();
  const order = (i: number) => ({ '--i': i }) as CSSProperties;
  if (open)
    tray.current = (
      <div className="ask-tray-body">
        {status}
        {(questions.length > 0 || resume) && (
          <div className="ask-chips" key={phase.kind === 'answered' ? `answer:${phase.question}` : 'suggested'}>
            {resume && (
              <button
                type="button"
                className="ask-chip resume"
                style={order(0)}
                onMouseDown={keepFocus}
                onClick={resumeTour}
              >
                <ResumeIcon />
                <span>Back to the tour</span>
              </button>
            )}
            {questions.map((q, i) => (
              <button
                type="button"
                className="ask-chip"
                key={`${i}:${q}`}
                title={q}
                style={order(i + (resume ? 1 : 0))}
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
  const near = draft.length > MAX_QUESTION - 80;
  return (
    <section
      className={`ask${className ? ` ${className}` : ''}`}
      aria-label="Ask about this paper"
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className={`ask-card${focused ? ' focused' : ''}${busy ? ' busy' : ''}`}>
        <div className={`ask-tray${open ? ' open' : ''}`}>
          <div className="ask-tray-clip">{tray.current}</div>
        </div>
        <form className="ask-bar" onSubmit={submit}>
          <SparkIcon />
          <textarea
            ref={input}
            className="ask-input"
            rows={1}
            value={draft}
            maxLength={MAX_QUESTION}
            readOnly={busy}
            placeholder={phase.kind === 'answered' ? 'Ask a follow-up…' : 'Ask about this paper…'}
            aria-label="Ask a question about this paper"
            enterKeyHint="send"
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
          />
          {near && !busy && (
            <span className="ask-count" aria-live="polite">
              {draft.length}/{MAX_QUESTION}
            </span>
          )}
          {empty && !focused && !busy && <kbd className="ask-kbd">/</kbd>}
          <button
            type="submit"
            className={`ask-send${busy ? ' stop' : empty ? '' : ' ready'}`}
            disabled={!busy && empty}
            aria-label={busy ? 'Stop' : 'Ask'}
            title={busy ? 'Stop (Esc)' : 'Ask (Enter)'}
          >
            {busy ? <StopIcon /> : <SendIcon />}
          </button>
        </form>
      </div>
    </section>
  );
}
