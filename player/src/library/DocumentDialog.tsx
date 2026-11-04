import { useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type { DocumentSummary } from '../../../shared/contracts';
import { apiRequest } from './client';
import { AnimatedDialog, DialogTitle } from '../ui/controls';
import { ActionButton } from '../ui/ActionButton';
import { playInterfaceSound } from '../ui/sound';

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
  const [open, setOpen] = useState(true);
  const changed = useRef(false);
  const titleInput = useRef<HTMLInputElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const [title, setTitle] = useState(paper.title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  function close(updated = false) {
    changed.current = updated;
    setOpen(false);
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
      playInterfaceSound('success');
      close(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The document could not be updated. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AnimatedDialog
      className="library-dialog"
      open={open}
      onOpenChange={(next, details) => {
        if (busy) { details.cancel(); return; }
        setOpen(next);
      }}
      onOpenChangeComplete={(next) => { if (!next) onClose(); }}
      popupProps={{
        initialFocus: mode === 'rename' ? titleInput : cancelButton,
        finalFocus: () => {
          // Sorting or filtering can remove the card that opened this dialog.
          const target = changed.current ? fallbackFocus : returnFocus;
          return target?.isConnected ? target : fallbackFocus;
        },
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <DialogTitle>{mode === 'rename' ? 'Rename paper' : 'Delete paper?'}</DialogTitle>
        {mode === 'rename' ? (
          <label>
            Title
            <input
              ref={titleInput}
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
            ref={cancelButton}
            disabled={busy}
            onClick={() => close()}
          >
            Cancel
          </button>
          <ActionButton
            className={`library-button ${mode === 'delete' ? 'danger' : 'primary'}`}
            disabled={busy || (mode === 'rename' && (!title.trim() || title.trim() === paper.title))}
            busy={busy} label={busy ? 'Saving…' : mode === 'rename' ? 'Save title' : 'Delete paper'}
          />
        </div>
      </form>
    </AnimatedDialog>
  );
}
