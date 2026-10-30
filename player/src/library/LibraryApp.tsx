import { useEffect, useMemo, useRef, useState } from 'react';
import type { DocumentSummary } from '../../../shared/contracts';
import { AuthForm, PaperMark } from './AuthForm';
import { DocumentDialog } from './DocumentDialog';
import { UploadPanel } from './UploadPanel';
import { apiRequest, isLibraryConfigured, signOut } from './client';
import { useSession } from './useSession';
import { isTourGenerationActive } from './tourGeneration';
import { TourGeneration } from '../components/TourGeneration';
import { useModelCatalog } from './useModelCatalog';
import { useSettings } from './useSettings';
import { ProfileSettings } from './ProfileSettings';
import { canUseModel, modelDisplayName } from './modelChoices';
import { LIBRARY_FILTERS, matchesLibraryFilter, selectLibraryPapers } from './libraryView';
import type { LibraryView } from './libraryView';
import { useLibraryView } from './useLibraryView';
import { PaperActions } from './PaperActions';
import '../library.css';

interface Props {
  onOpenDocument(documentId: string): void;
  onOpenDemo(): void;
}

export function LibraryApp({ onOpenDocument, onOpenDemo }: Props) {
  const auth = useSession();
  if (!isLibraryConfigured())
    return (
      <div className="library">
        <header className="library-header">
          <PaperMark />
        </header>
        <main className="library-setup">
          <div className="library-setup-icon" aria-hidden="true">
            ⌁
          </div>
          <h1>A home for your papers.</h1>
          <p>Connect the library to save PDFs, prepare their contents, and keep your reading progress across visits.</p>
          <section>
            <h2>Connect your library</h2>
            <p>
              Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in{' '}
              <code>player/.env.local</code>, start the API and worker, then restart the app.
            </p>
            <p>The repository README includes the local setup and database migrations.</p>
          </section>
          {import.meta.env.DEV && (
            <button type="button" className="library-button primary" onClick={onOpenDemo}>
              Open local demo (deprecated)
            </button>
          )}
        </main>
      </div>
    );
  if (auth.loading)
    return (
      <div className="library">
        <header className="library-header">
          <PaperMark />
        </header>
        <main className="library-loading" role="status">
          Opening your library…
        </main>
      </div>
    );
  if (!auth.session || auth.recovering)
    return (
      <div className="library">
        <AuthForm
          key={auth.recovering ? 'recovery' : 'auth'}
          recovering={auth.recovering}
          onRecovered={auth.finishRecovery}
          onOpenDemo={onOpenDemo}
        />
        {auth.error && (
          <p className="library-error library-session-error" role="alert">
            {auth.error}
          </p>
        )}
      </div>
    );
  if (new URLSearchParams(location.search).get('settings') === 'profile')
    return <ProfileSettings key={auth.session.user.id} email={auth.session.user.email ?? 'Your account'} />;
  return (
    <AuthenticatedLibrary
      key={auth.session.user.id}
      accountId={auth.session.user.id}
      email={auth.session.user.email ?? 'Your account'}
      onOpenDocument={onOpenDocument}
      onOpenDemo={onOpenDemo}
    />
  );
}

function AuthenticatedLibrary({ accountId, email, onOpenDocument, onOpenDemo }: Props & {
  accountId: string;
  email: string;
}) {
  const [documents, setDocuments] = useState<DocumentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // `open` is a document the notice offers to open: one just uploaded, whose tour can play before it is finished.
  const [notice, setNotice] = useState<{ text: string; open?: string } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [view, setView] = useLibraryView(accountId);
  const { query, sort, filter } = view;
  const setQuery = (query: string) => setView((current) => ({ ...current, query }));
  const searchInput = useRef<HTMLInputElement>(null);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
    document: DocumentSummary;
    mode: 'rename' | 'delete';
    trigger: HTMLElement;
  } | null>(null);
  const models = useModelCatalog();
  const profile = useSettings();
  const model = profile.data?.defaultModel ?? '';
  const selectedModel = models.catalog?.models.find((candidate) => candidate.id === model);
  const allowTraining = selectedModel?.contributor === true;
  const uploadReady = !!profile.data && canUseModel(models.catalog, model, allowTraining) && !models.loading;
  const uploadReason = !profile.data
    ? profile.error
      ? 'Your settings could not be loaded. Open settings to try again.'
      : 'Loading your settings…'
    : models.loading
      ? 'Checking available models…'
      : !uploadReady
        ? 'Choose an available tour model in Settings to add a PDF.'
        : undefined;
  const refreshDocuments = () => setRefresh((count) => count + 1);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    async function load() {
      try {
        const result = await apiRequest<{ documents: DocumentSummary[] }>('/api/documents', {
          signal: controller.signal,
        });
        if (!alive) return;
        setDocuments(result.documents);
        setError(null);
        const processing = result.documents.some(
          (item) =>
            item.analysisStatus === 'queued' ||
            item.analysisStatus === 'processing' ||
            item.fileStatus === 'uploading' ||
            isTourGenerationActive(item.tourGeneration) ||
            ((item.analysisStatus === 'ready' || item.analysisStatus === 'limited') &&
              !item.tourCount &&
              !item.tourGeneration),
        );
        if (processing) timer = setTimeout(() => void load(), 3000);
      } catch (cause) {
        if (!alive) return;
        setError(cause instanceof Error ? cause.message : 'Could not load your papers. Try again.');
      } finally {
        if (alive) setLoading(false);
      }
    }
    void load();
    return () => {
      alive = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [refresh]);

  const visible = useMemo(() => selectLibraryPapers(documents, view), [documents, view]);

  async function logout() {
    setSigningOut(true);
    setError(null);
    try {
      await signOut();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not sign out. Try again.');
      setSigningOut(false);
    }
  }

  async function retryAnalysis(item: DocumentSummary) {
    setBusyId(item.id);
    setError(null);
    try {
      await apiRequest(`/api/documents/${item.id}/analyze`, { method: 'POST' });
      setNotice({ text: `Preparing “${item.title}” again.` });
      refreshDocuments();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not restart the analysis. Try again.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="library">
      <header className="library-header">
        <PaperMark />
        <div className="library-account">
          <span className="library-account-email" title={email}>
            {email}
          </span>
          <a
            className="library-settings-link"
            href={`${import.meta.env.BASE_URL}?settings=profile`}
            aria-label="Profile & Settings"
            title="Profile & Settings"
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m9.5 3-.6 2.2-2 .9-2-.6-2.4 4.1L4.1 11v2l-1.6 1.4 2.4 4.1 2-.6 2 .9.6 2.2h5l.6-2.2 2-.9 2 .6 2.4-4.1L19.9 13v-2l1.6-1.4-2.4-4.1-2 .6-2-.9L14.5 3z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>Settings</span>
          </a>
          <button
            type="button"
            className="library-sign-out"
            aria-label={signingOut ? 'Signing out…' : 'Sign out'}
            title="Sign out"
            onClick={() => void logout()}
            disabled={signingOut}
          >
            <svg
              width="19"
              height="19"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M9 5H5v14h4M10 12h11m-4-4 4 4-4 4" />
            </svg>
          </button>
        </div>
      </header>
      <main className="library-main">
        <div className="library-heading">
          <div>
            <h1>Your library</h1>
            <p>Pick up where you left off.</p>
          </div>
          {import.meta.env.DEV && (
            <button className="library-text-button" type="button" onClick={onOpenDemo}>
              Open local demo (deprecated)
            </button>
          )}
        </div>
        {models.error && (
          <div className="model-catalog-error" role="alert">
            <p>{models.error}</p>
            <button className="library-text-button" type="button" onClick={models.refresh}>
              Try again
            </button>
          </div>
        )}
        {profile.error && (
          <p className="library-error" role="alert">
            {profile.error}{' '}
            <button className="library-text-button" onClick={profile.refresh}>
              Retry settings
            </button>
          </p>
        )}
        <UploadPanel
          model={model}
          allowTraining={allowTraining}
          canUpload={uploadReady}
          unavailableReason={uploadReason}
          onChanged={refreshDocuments}
          onUploaded={(documentId) => {
            setNotice({
              text: 'PDF saved. We’ll prepare its contents, then write a guided tour; its first steps can play while the rest is still being written.',
              open: documentId,
            });
            refreshDocuments();
          }}
        />
        {error && (
          <div className="library-feedback library-error" role="alert">
            <span>{error}</span>
            <button className="library-text-button" type="button" onClick={refreshDocuments}>
              Try again
            </button>
          </div>
        )}
        {selectedModel && (
          <p className="library-upload-context">
            New tours use <strong>{modelDisplayName(selectedModel)}</strong>
            <a href={`${import.meta.env.BASE_URL}?settings=profile#tour-model`}>Change model</a>
          </p>
        )}
        {notice && (
          <div className="library-feedback library-notice" role="status">
            <span>{notice.text}</span>
            <span className="library-notice-actions">
              {notice.open && (
                <button type="button" className="library-text-button" onClick={() => onOpenDocument(notice.open!)}>
                  Open it now
                </button>
              )}
              <button
                type="button"
                className="library-text-button"
                onClick={() => setNotice(null)}
                aria-label="Dismiss notice"
              >
                Dismiss
              </button>
            </span>
          </div>
        )}
        <div className="library-toolbar">
          <label className="library-search">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-hidden="true">
              <circle cx="7.5" cy="7.5" r="5.25" stroke="currentColor" strokeWidth="1.5" />
              <path d="M11.5 11.5L16 16" stroke="currentColor" strokeWidth="1.5" />
            </svg>
            <input
              ref={searchInput}
              type="search"
              maxLength={300}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setQuery('');
              }}
              placeholder="Find a paper"
              aria-label="Find a paper by title or filename"
            />
            {query && (
              <button
                type="button"
                className="library-search-clear"
                onClick={() => {
                  setQuery('');
                  searchInput.current?.focus();
                }}
                aria-label="Clear search"
              >
                ×
              </button>
            )}
          </label>
          <label className="library-sort">
            Sort by
            <select
              value={sort}
              onChange={(event) => setView((current) => ({ ...current, sort: event.target.value as LibraryView['sort'] }))}
            >
              <option value="recent">Recently opened</option>
              <option value="added">Date added</option>
              <option value="title">Title</option>
            </select>
          </label>
        </div>
        <div className="library-filters" role="group" aria-label="Filter papers">
          {LIBRARY_FILTERS.map((option) => (
            <button
              type="button"
              key={option.id}
              aria-pressed={filter === option.id}
              onClick={() => setView((current) => ({ ...current, filter: option.id }))}
            >
              {option.label}
              {!loading && <span>{documents.filter((paper) => matchesLibraryFilter(paper, option.id)).length}</span>}
            </button>
          ))}
        </div>
        <div className="library-list-heading">
          <h2 ref={listHeading} tabIndex={-1}>
            {query.trim() ? 'Search results' : 'Papers'}
          </h2>
          <span aria-live="polite">
            {loading ? 'Loading…' : `${visible.length} ${visible.length === 1 ? 'paper' : 'papers'}`}
          </span>
        </div>
        {loading && (
          <div className="library-loading" role="status">
            Loading your papers…
          </div>
        )}
        {!loading && !documents.length && !error && (
          <div className="library-empty">
            <svg width="48" height="52" viewBox="0 0 28 30" fill="none" aria-hidden="true">
              <path d="M6 2H19L25 8V28H6V2Z" stroke="currentColor" />
              <path d="M19 2V8H25M2 7V26M10 13H21M10 17H21M10 21H17" stroke="currentColor" />
            </svg>
            <h3>Your first paper belongs here.</h3>
            <p>Upload a PDF above. Its pages, sections and figures will stay together in your library.</p>
          </div>
        )}
        {!loading && documents.length > 0 && !visible.length && (
          <div className="library-empty">
            <h3>{query.trim() ? `No papers match “${query.trim()}”.` : 'No papers in this view.'}</h3>
            <p>
              {query.trim() ? 'Try a different title, filename or filter.' : 'Choose another filter to see more of your library.'}
            </p>
            <button
              type="button"
              className="library-text-button"
              onClick={() => {
                setView((current) => ({ ...current, query: '', filter: 'all' }));
                listHeading.current?.focus();
              }}
            >
              Show all papers
            </button>
          </div>
        )}
        <div className="library-grid">
          {visible.map((item) => (
            <DocumentCard
              key={item.id}
              document={item}
              busy={busyId === item.id}
              onOpen={() => onOpenDocument(item.id)}
              onRename={(trigger) => setDialog({ document: item, mode: 'rename', trigger })}
              onDelete={(trigger) => setDialog({ document: item, mode: 'delete', trigger })}
              onRetry={() => void retryAnalysis(item)}
              onTourChanged={refreshDocuments}
            />
          ))}
        </div>
      </main>
      {dialog && (
        <DocumentDialog
          key={`${dialog.mode}:${dialog.document.id}`}
          document={dialog.document}
          mode={dialog.mode}
          returnFocus={dialog.trigger}
          fallbackFocus={listHeading.current}
          onClose={() => setDialog(null)}
          onChanged={refreshDocuments}
        />
      )}
    </div>
  );
}

function DocumentCard({
  document: item,
  busy,
  onOpen,
  onRename,
  onDelete,
  onRetry,
  onTourChanged,
}: {
  document: DocumentSummary;
  busy: boolean;
  onOpen(): void;
  onRename(trigger: HTMLElement): void;
  onDelete(trigger: HTMLElement): void;
  onRetry(): void;
  onTourChanged(): void;
}) {
  const status =
    item.fileStatus === 'invalid'
      ? { label: 'PDF unavailable', kind: 'failed' }
      : item.fileStatus === 'uploading'
        ? { label: 'Upload unfinished', kind: 'pending' }
        : item.analysisStatus === 'ready'
          ? { label: 'Ready to explore', kind: 'ready' }
          : item.analysisStatus === 'limited'
            ? { label: 'Limited text extraction', kind: 'limited' }
            : item.analysisStatus === 'processing'
              ? { label: 'Preparing contents', kind: 'pending' }
              : item.analysisStatus === 'queued'
                ? { label: 'Waiting to prepare', kind: 'pending' }
                : item.analysisStatus === 'failed'
                  ? { label: 'Analysis interrupted', kind: 'failed' }
                  : { label: 'PDF saved', kind: 'ready' };
  const canOpen = item.fileStatus === 'uploaded';
  const analysisReady = item.analysisStatus === 'ready' || item.analysisStatus === 'limited';
  return (
    <article className="library-document">
      <button
        type="button"
        className="library-preview"
        onClick={onOpen}
        disabled={!canOpen}
        aria-label={`Open ${item.title}`}
      >
        {item.thumbnailUrl ? (
          <img src={item.thumbnailUrl} alt="" loading="lazy" />
        ) : (
          <div className="library-preview-placeholder" aria-hidden="true">
            <svg width="36" height="42" viewBox="0 0 28 30" fill="none">
              <path d="M4 1H18L25 8V29H4V1Z" stroke="currentColor" />
              <path d="M18 1V8H25M8 14H21M8 18H21M8 22H17" stroke="currentColor" />
            </svg>
            <span>PDF</span>
          </div>
        )}
        {item.tourCount > 0 && (
          <span className="library-tour-badge">
            {item.tourCount} {item.tourCount === 1 ? 'tour' : 'tours'}
          </span>
        )}
      </button>
      <div className="library-document-body">
        <span className={`library-status ${status.kind}`}>{status.label}</span>
        <h3>
          <button type="button" onClick={onOpen} disabled={!canOpen}>
            {item.title}
          </button>
        </h3>
        <p className="library-filename" title={item.originalFilename}>
          {item.originalFilename}
        </p>
        <p className="library-document-meta">
          {item.pageCount === null
            ? 'Page count pending'
            : `${item.pageCount} ${item.pageCount === 1 ? 'page' : 'pages'}`}
          <span>Added {formatDate(item.createdAt)}</span>
        </p>
        {item.analysisError && <p className="library-document-error">{item.analysisError}</p>}
        {canOpen &&
          item.tourGeneration?.status !== 'ready' &&
          (item.tourGeneration || (analysisReady && !item.tourCount)) && (
            <TourGeneration
              documentId={item.id}
              generation={item.tourGeneration}
              onChanged={onTourChanged}
              canGenerate={analysisReady || !!item.tourGeneration}
              onOpenTour={() => onOpen()}
              compact
            />
          )}
        <div className="library-document-actions">
          <button type="button" className="library-text-button" disabled={!canOpen} onClick={onOpen}>
            Open paper
          </button>
          {item.analysisStatus === 'failed' && canOpen && (
            <button type="button" className="library-text-button" disabled={busy} onClick={onRetry}>
              {busy ? 'Restarting…' : 'Retry analysis'}
            </button>
          )}
          <PaperActions title={item.title} onRename={onRename} onDelete={onDelete} />
        </div>
      </div>
    </article>
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? '' : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}
