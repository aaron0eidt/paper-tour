import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { Upload } from 'tus-js-client';
import type { UploadReservation } from '../../../shared/contracts';
import { apiRequest, getAccessToken, storageUploadEndpoint } from './client';
import { UploadValidationError, uploadErrorMessage } from './uploadErrors';

const MAX_BYTES = 25 * 1024 * 1024;
type UploadStage = 'idle' | 'checking' | 'uploading' | 'finishing' | 'canceling' | 'failed';
interface PendingUpload {
  file: File;
  reservation: UploadReservation | null;
  transferred: boolean;
  model: string;
  allowTraining: boolean;
}

interface UploadPanelProps {
  onUploaded(): void;
  onChanged(): void;
  model: string;
  allowTraining: boolean;
  canUpload: boolean;
}

export function UploadPanel({ onUploaded, onChanged, model, allowTraining, canUpload }: UploadPanelProps) {
  const [stage, setStage] = useState<UploadStage>('idle');
  const [progress, setProgress] = useState(0);
  const [filename, setFilename] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef<PendingUpload | null>(null);
  const transfer = useRef<Upload | null>(null);
  const rejectTransfer = useRef<((error: Error) => void) | null>(null);
  const run = useRef(0);
  const busy = ['checking', 'uploading', 'finishing', 'canceling'].includes(stage);

  useEffect(
    () => () => {
      run.current++;
      rejectTransfer.current?.(new Error('Upload canceled.'));
      void transfer.current?.abort();
    },
    [],
  );

  async function start(file: File, resume = false) {
    if (!resume && busy) return;
    if (!resume && !canUpload) { setError('Check your model in Profile & Settings and confirm any Contributor permission before uploading.'); return; }
    const token = ++run.current;
    const active = () => token === run.current;
    setError(null);
    setFilename(file.name);
    setStage('checking');
    if (!resume) {
      pending.current = { file, reservation: null, transferred: false, model, allowTraining };
      setProgress(0);
    }
    const upload = pending.current!;
    try {
      if (file.size > MAX_BYTES)
        throw new UploadValidationError('This PDF is larger than 25 MiB. Choose a smaller file.');
      if (!file.size) throw new UploadValidationError('This file is empty. Choose a PDF with content.');
      const header = new TextDecoder().decode(await file.slice(0, 1024).arrayBuffer());
      if (!header.includes('%PDF-'))
        throw new UploadValidationError('This file does not look like a PDF. Choose a PDF file.');
      if (!active()) return;
      if (!upload.reservation) {
        upload.reservation = await apiRequest<UploadReservation>('/api/documents', {
          method: 'POST',
          body: JSON.stringify({ filename: file.name, size: file.size, model: upload.model, allowTraining: upload.allowTraining }),
        });
        if (!active()) {
          // Cancellation can precede the reservation response. Remove the newly created row too.
          await apiRequest(`/api/documents/${upload.reservation.documentId}`, { method: 'DELETE' }).catch(
            () => undefined,
          );
          onChanged();
          return;
        }
        onChanged();
      }
      if (!active()) return;
      const reservation = upload.reservation;
      if (!upload.transferred) {
        setStage('uploading');
        await new Promise<void>((resolve, reject) => {
          rejectTransfer.current = reject;
          const tus = new Upload(file, {
            endpoint: storageUploadEndpoint(),
            headers: { 'x-upsert': 'false' },
            chunkSize: 6 * 1024 * 1024,
            retryDelays: [0, 1000, 3000, 5000],
            uploadDataDuringCreation: true,
            removeFingerprintOnSuccess: true,
            fingerprint: async () => `paper-tour:${reservation.documentId}:${file.size}:${file.lastModified}`,
            metadata: {
              bucketName: reservation.bucket,
              objectName: reservation.path,
              contentType: 'application/pdf',
              cacheControl: '3600',
            },
            onBeforeRequest: async (request) => {
              if (!active()) throw new Error('Upload canceled.');
              // Set once per XHR: repeated setHeader calls append, corrupting the JWT.
              request.setHeader('authorization', `Bearer ${await getAccessToken()}`);
            },
            onProgress: (sent, total) => {
              if (active()) setProgress(total ? Math.round((sent / total) * 100) : 0);
            },
            onError: reject,
            onSuccess: () => {
              upload.transferred = true;
              resolve();
            },
          });
          transfer.current = tus;
          tus
            .findPreviousUploads()
            .then((previous) => {
              if (!active()) return;
              if (previous.length) tus.resumeFromPreviousUpload(previous[0]);
              tus.start();
            })
            .catch(reject);
        });
      }
      if (!active()) return;
      setStage('finishing');
      setProgress(100);
      await apiRequest(`/api/documents/${reservation.documentId}/complete`, { method: 'POST' });
      if (!active()) return;
      pending.current = null;
      transfer.current = null;
      rejectTransfer.current = null;
      setStage('idle');
      setFilename('');
      if (input.current) input.current.value = '';
      onUploaded();
    } catch (cause) {
      if (!active()) return;
      setError(uploadErrorMessage(cause));
      setStage('failed');
      onChanged();
    }
  }

  async function cancel() {
    if (stage === 'canceling') return;
    run.current++;
    setStage('canceling');
    rejectTransfer.current?.(new Error('Upload canceled.'));
    rejectTransfer.current = null;
    await transfer.current?.abort().catch(() => undefined);
    const reservation = pending.current?.reservation;
    pending.current = null;
    transfer.current = null;
    setError(null);
    if (reservation) {
      try {
        await apiRequest(`/api/documents/${reservation.documentId}`, { method: 'DELETE' });
      } catch (cause) {
        setError(
          cause instanceof Error
            ? cause.message
            : 'The unfinished upload could not be removed. Remove it from your library.',
        );
      }
      onChanged();
    }
    setStage('idle');
    setFilename('');
    setProgress(0);
    if (input.current) input.current.value = '';
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (busy) return;
    if (stage === 'failed') {
      setError('Retry or cancel this upload before choosing another PDF.');
      return;
    }
    const files = event.dataTransfer.files;
    if (files.length !== 1) {
      setError('Upload one PDF at a time.');
      return;
    }
    void start(files[0]);
  }

  return (
    <section
      className={`library-upload${dragging ? ' dragging' : ''}${busy ? ' busy' : ''}`}
      aria-label="Upload a PDF"
      onDragOver={(event) => {
        event.preventDefault();
        if (!busy) setDragging(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
      }}
      onDrop={drop}
    >
      <div className="library-upload-icon" aria-hidden="true">
        <svg width="28" height="30" viewBox="0 0 28 30" fill="none">
          <path d="M4 20V27H24V20M14 21V3M7 10L14 3L21 10" stroke="currentColor" strokeWidth="1.5" />
        </svg>
      </div>
      <div className="library-upload-copy">
        <h2>{stage === 'idle' ? 'Add a paper' : filename}</h2>
        <p aria-live="polite">
          {stage === 'idle'
            ? 'Drop a PDF here, or choose a file. Up to 25 MiB and 100 pages.'
            : stage === 'checking'
              ? 'Checking your file…'
              : stage === 'uploading'
                ? `Uploading ${progress}%`
                : stage === 'finishing'
                  ? 'Saving your PDF…'
                  : stage === 'canceling'
                    ? 'Canceling upload…'
                    : 'Upload needs attention'}
        </p>
        {busy && <progress value={progress} max="100" aria-label="Upload progress" />}
        {error && (
          <p className="library-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="application/pdf,.pdf"
        className="library-file-input"
        aria-label="Choose a PDF"
        disabled={busy || !canUpload}
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void start(file);
        }}
      />
      <div className="library-upload-actions">
        {stage === 'failed' && pending.current && (
          <button
            type="button"
            className="library-button primary"
            onClick={() => void start(pending.current!.file, true)}
          >
            Retry upload
          </button>
        )}
        {stage === 'idle' && (
          <button type="button" className="library-button primary" disabled={!canUpload} onClick={() => input.current?.click()}>
            Choose PDF
          </button>
        )}
        {stage !== 'idle' && (
          <button
            type="button"
            className="library-button"
            disabled={stage === 'canceling'}
            onClick={() => void cancel()}
          >
            Cancel
          </button>
        )}
      </div>
    </section>
  );
}
