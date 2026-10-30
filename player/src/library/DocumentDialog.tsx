import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { DocumentSummary } from '../../../shared/contracts';
import { apiRequest } from './client';

export function DocumentDialog({
  document: paper,
  mode,
  returnFocus,
  fallbackFocus,
  onClose,
  onChanged,
}: {
  document: DocumentSummary;
  mode: 'rename' | 'delete';
  returnFocus: HTMLElement;
  fallbackFocus: HTMLElement | null;
  onClose(): void;
  onChanged(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(paper.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);

  function close(changed = false) {
    dialog.current?.close();
    // A renamed card can disappear from the active search or move when sorted by title.
    const target = changed ? fallbackFocus : returnFocus;
    (target?.isConnected ? target : fallbackFocus)?.focus();
    onClose();
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy || (mode === 'rename' && (!title.trim() || title.trim() === paper.title))) return;
    setBusy(true);
    setError(null);
    try {
      if (mode === 'rename')
        await apiRequest(`/api/documents/${paper.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: title.trim() }),
        });
      else await apiRequest(`/api/documents/${paper.id}`, { method: 'DELETE' });
      onChanged();
      close(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The document could not be updated. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <dialog
      className="library-dialog"
      ref={dialog}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) close();
      }}
      aria-labelledby="document-dialog-title"
    >
      <form onSubmit={(event) => void submit(event)}>
        <h2 id="document-dialog-title">{mode === 'rename' ? 'Rename paper' : 'Delete paper?'}</h2>
        {mode === 'rename' ? (
          <label>
            Title
            <input
              autoFocus
              value={title}
              maxLength={300}
              required
              onFocus={(event) => event.target.select()}
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
            />
          </label>
        ) : (
          <p>“{paper.title}” and its saved tours and reading progress will be removed from your library.</p>
        )}
        {error && (
          <p className="library-error" role="alert">
            {error}
          </p>
        )}
        <div className="library-dialog-actions">
          <button
            className="library-button"
            type="button"
            autoFocus={mode === 'delete'}
            disabled={busy}
            onClick={() => close()}
          >
            Cancel
          </button>
          <button
            className={`library-button ${mode === 'delete' ? 'danger' : 'primary'}`}
            disabled={busy || (mode === 'rename' && (!title.trim() || title.trim() === paper.title))}
          >
            {busy ? 'Please wait…' : mode === 'rename' ? 'Save title' : 'Delete paper'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
