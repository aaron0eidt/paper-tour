import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { DocumentSummary } from '../../../shared/contracts';
import { apiRequest } from './client';

export function DocumentDialog({
  document,
  mode,
  onClose,
  onChanged,
}: {
  document: DocumentSummary;
  mode: 'rename' | 'delete';
  onClose(): void;
  onChanged(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [title, setTitle] = useState(document.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (mode === 'rename')
        await apiRequest(`/api/documents/${document.id}`, {
          method: 'PATCH',
          body: JSON.stringify({ title: title.trim() }),
        });
      else await apiRequest(`/api/documents/${document.id}`, { method: 'DELETE' });
      onChanged();
      onClose();
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
        if (busy) event.preventDefault();
        else onClose();
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
              onChange={(event) => setTitle(event.target.value)}
              disabled={busy}
            />
          </label>
        ) : (
          <p>“{document.title}” and its saved tours and reading progress will be removed from your library.</p>
        )}
        {error && (
          <p className="library-error" role="alert">
            {error}
          </p>
        )}
        <div className="library-dialog-actions">
          <button className="library-button" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button
            className={`library-button ${mode === 'delete' ? 'danger' : 'primary'}`}
            disabled={busy || (mode === 'rename' && !title.trim())}
          >
            {busy ? 'Please wait…' : mode === 'rename' ? 'Save title' : 'Delete paper'}
          </button>
        </div>
      </form>
    </dialog>
  );
}
