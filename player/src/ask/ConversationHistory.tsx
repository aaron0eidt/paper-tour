import { useEffect, useId, useRef } from 'react';
import type { Conversation, ConversationMessage, ConversationSummary } from '../../../shared/conversations';
import { answerText } from './api';
import { conversationLabel } from './conversations';
import './conversations.css';

export function ConversationHistory({
  open,
  threads,
  active,
  loading,
  error,
  onClose,
  onSelect,
  onNew,
  onReplay,
  onRefresh,
}: {
  open: boolean;
  threads: ConversationSummary[];
  active: Conversation | null;
  loading: boolean;
  error: string;
  onClose(): void;
  onSelect(id: string): void;
  onNew(): void;
  onReplay(message: ConversationMessage): void;
  onRefresh(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const el = dialog.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    else if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="conversation-dialog"
      aria-labelledby={titleId}
      onCancel={onClose}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="conversation-shell">
        <header className="conversation-header">
          <div>
            <h2 id={titleId}>Conversations</h2>
            <p>Questions and explanations, separate from your saved tours.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close conversations">
            Close
          </button>
        </header>
        <div className="conversation-layout">
          <nav className="conversation-list" aria-label="Document conversations">
            <button type="button" className="conversation-new" onClick={onNew}>
              + New conversation
            </button>
            {threads.map((thread) => (
              <button
                type="button"
                key={thread.id}
                aria-current={thread.id === active?.id ? 'true' : undefined}
                onClick={() => onSelect(thread.id)}
              >
                <strong>{thread.title}</strong>
                <small>
                  {thread.messageCount} {thread.messageCount === 1 ? 'question' : 'questions'} ·{' '}
                  {conversationLabel(thread.context)}
                </small>
              </button>
            ))}
            {!threads.length && !loading && <p className="conversation-empty">Your questions will be saved here.</p>}
          </nav>
          <section className="conversation-content" aria-label="Conversation messages" aria-busy={loading}>
            {error && (
              <p role="alert" className="conversation-error">
                {error}{' '}
                <button type="button" onClick={onRefresh}>
                  Try again
                </button>
              </p>
            )}
            {loading && (
              <p role="status" className="conversation-empty">
                Loading conversations…
              </p>
            )}
            {active ? (
              <>
                <div className="conversation-title">
                  <h3>{active.title}</h3>
                  <span>Saved automatically</span>
                </div>
                {active.messages.map((message) => (
                  <article key={message.id} className="conversation-message">
                    <p className="conversation-question">{message.question}</p>
                    <small>{conversationLabel(message.context)}</small>
                    {message.answer && <p className="conversation-answer">{answerText(message.answer)}</p>}
                    {message.status !== 'completed' && (
                      <p className="conversation-note">
                        {message.status === 'pending'
                          ? 'An answer is being written. Refresh to see its progress.'
                          : (message.error ?? 'This answer was interrupted.')}
                      </p>
                    )}
                    {!!message.answer?.steps.length && (
                      <button type="button" className="conversation-replay" onClick={() => onReplay(message)}>
                        Replay explanation
                      </button>
                    )}
                  </article>
                ))}
                {!active.messages.length && (
                  <p className="conversation-empty">Ask your first question in the reader.</p>
                )}
              </>
            ) : (
              <div className="conversation-welcome">
                <h3>A place for your questions</h3>
                <p>
                  Open a conversation to continue it, or start a new one. Replaying an explanation leaves the saved tour
                  intact.
                </p>
              </div>
            )}
          </section>
        </div>
        <footer className="conversation-footer">
          <button type="button" onClick={onRefresh} disabled={loading}>
            Refresh
          </button>
          <button type="button" className="conversation-continue" onClick={onClose}>
            {active ? 'Continue this conversation' : 'Back to the document'}
          </button>
        </footer>
      </div>
    </dialog>
  );
}
