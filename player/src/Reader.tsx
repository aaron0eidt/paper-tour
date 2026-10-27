import { isPdfOpen, usePdfDocument, retirePdf } from './pdfLifetime';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, cameraView, initialView, readingScale } from './camera';
import { TourEngine } from './engine';
import type { CameraCommand, EngineState } from './engine';
import { layoutPages } from './layout';
import { loadManifest, loadPaper } from './load';
import type { Loaded } from './load';
import { createNarrator, SilentNarrator, useBrowserVoices } from './narration';
import { prepareTour, Resolver } from './resolve';
import { buildScene } from './scene';
import type { Scene } from './scene';
import type { Doc } from './types';
import { ControlBar } from './components/ControlBar';
import type { DebugPage } from './components/PageView';
import { Problems } from './components/Problems';
import { Sidebar } from './components/Sidebar';
import { Stage } from './components/Stage';
import { TourGeneration } from './components/TourGeneration';
import { isTourGenerationActive } from './library/tourGeneration';
import { apiRequest, ApiRequestError, getSupabase } from './library/client';
import type { DocumentManifest, ReaderState, SearchHit } from '../../shared/contracts';
import type { OverlayEntry } from './engine';
import { positionFromView, viewFromPosition } from './readerState';
import './reader.css';

interface Params {
  paper: string;
  silent: boolean;
  /** URL speed multiplier, for testing (?rate=4). */
  rate: number;
}

function readParams(): Params {
  const q = new URLSearchParams(location.search);
  const paper = q.get('paper') ?? 'attention';
  const rate = Number(q.get('rate'));
  return {
    paper: /^[\w.-]+$/.test(paper) && !paper.startsWith('.') ? paper : 'attention',
    silent: q.get('silent') === '1',
    rate: Number.isFinite(rate) && rate > 0 ? Math.min(8, Math.max(0.1, rate)) : 1,
  };
}

const IDLE: EngineState = {
  status: 'idle',
  index: 0,
  word: -1,
  overlays: [],
  camera: { seq: 0, key: null, action: null },
};
const EMPTY_SCENE: Scene = { pages: new Map(), spotlight: false, notes: [], labels: [] };
const noSubscribe = () => () => {};

function debugIndex(doc: Doc): Map<number, DebugPage> {
  const pages = new Map<number, DebugPage>();
  const page = (n: number) => {
    let p = pages.get(n);
    if (!p) pages.set(n, (p = { blocks: [], sentences: [], figures: [], panels: [], equations: [] }));
    return p;
  };
  for (const b of doc.blocks) page(b.page).blocks.push(b);
  for (const s of doc.sentences) page(s.page).sentences.push(s);
  for (const f of doc.figures) {
    page(f.page).figures.push(f);
    page(f.page).panels.push(...f.panels);
  }
  for (const e of doc.equations) page(e.page).equations.push(e);
  return pages;
}

function isInteractive(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || !!el.closest('input, textarea, select, button, a, summary, dialog'));
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}

export function Reader({ documentId, onBack }: { documentId?: string; onBack(): void }) {
  const params = useMemo(readParams, []);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const browserVoices = useBrowserVoices();
  const [speed, setSpeed] = useState(1);
  const [debug, setDebug] = useState(false);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [engine, setEngine] = useState<TourEngine | null>(null);
  const camera = useMemo(() => new Camera(), []);
  const [manifest, setManifest] = useState<DocumentManifest | null>(null);
  const [activeTour, setActiveTour] = useState<string | null>(new URLSearchParams(location.search).get('tour'));
  const [tab, setTab] = useState<'document' | 'tour'>('document');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selection, setSelection] = useState<OverlayEntry[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoomPercent, setZoomPercent] = useState(100);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [manifestRefresh, setManifestRefresh] = useState(0);
  const restoredView = useRef(false);
  const savedPosition = useRef<ReaderState | null>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const manifestRef = useRef<DocumentManifest | null>(null);
  const checkpointRef = useRef<ReaderState | null>(null);
  const accessTokenRef = useRef<string | null>(null);
  const pdfOpenedAt = useRef(0);
  const saveRun = useRef<Promise<void> | null>(null);
  const nextSave = useRef<ReaderState | null>(null);

  useEffect(() => {
    let alive = true;
    let loading = false;
    let lastPoll = 0;
    const accept = (value: Loaded) => {
      if (!alive) {
        if (value.pdf !== loadedRef.current?.pdf) retirePdf(value.pdf);
        return;
      }
      const previousPdf = loadedRef.current?.pdf;
      loadedRef.current = value;
      setLoaded(value);
      if (previousPdf !== value.pdf) retirePdf(previousPdf);
    };
    const refresh = async () => {
      if (loading) return;
      lastPoll = Date.now();
      loading = true;
      try {
        if (!documentId) {
          accept(await loadPaper(params.paper));
          return;
        }
        const pinnedTour = activeTour ?? manifestRef.current?.selectedTour?.id;
        const next = await apiRequest<DocumentManifest>(
          `/api/documents/${documentId}/manifest${pinnedTour ? `?tourId=${encodeURIComponent(pinnedTour)}` : ''}`,
        );
        if (!alive) return;
        const previous = manifestRef.current;
        const reloadPdf = !!loadedRef.current?.pdf && Date.now() - pdfOpenedAt.current > 45 * 60 * 1000;
        const changed =
          !previous ||
          !isPdfOpen(loadedRef.current?.pdf) ||
          next.docAnalysisId !== previous.docAnalysisId ||
          next.selectedTour?.id !== previous.selectedTour?.id ||
          reloadPdf;
        const published = !changed && previous ? { ...next, assets: previous.assets } : next;
        manifestRef.current = published;
        setManifest(published);
        if (!previous) {
          savedPosition.current = next.readerState;
          if (next.selectedTour) setTab('tour');
        }
        if (changed) {
          if (previous && checkpointRef.current) savedPosition.current = checkpointRef.current;
          const previousPdf = loadedRef.current?.pdf;
          const value = await loadManifest(next, reloadPdf ? undefined : (loadedRef.current ?? undefined));
          if (!alive) {
            if (value.pdf !== previousPdf && value.pdf !== loadedRef.current?.pdf) retirePdf(value.pdf);
            return;
          }
          if (reloadPdf && !value.pdf && previousPdf)
            throw new Error('The PDF connection could not be refreshed. Your current document is still open.');
          if (reloadPdf) restoredView.current = false;
          if (value.pdf && value.pdf !== previousPdf) pdfOpenedAt.current = Date.now();
          accept(value);
        }
        setFatal(null);
      } catch (error) {
        if (alive && error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
          setLoaded(null);
          loadedRef.current = null;
          onBack();
          return;
        }
        if (alive) setFatal((error as Error).message);
      } finally {
        loading = false;
      }
    };
    void refresh();
    const interval = documentId
      ? setInterval(() => {
          const current = manifestRef.current;
          const working =
            !current ||
            !isPdfOpen(loadedRef.current?.pdf) ||
            current.document.fileStatus === 'uploading' ||
            ['queued', 'processing'].includes(current.analysis?.status ?? '') ||
            isTourGenerationActive(current.tourGeneration) ||
            (!!current.doc && !current.tours.length && !current.tourGeneration);
          if (!document.hidden && (working || Date.now() - lastPoll > 60_000)) void refresh();
        }, 4000)
      : undefined;
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [params.paper, documentId, activeTour, onBack, manifestRefresh]);

  useEffect(() => {
    if (!documentId) return;
    const client = getSupabase();
    let identity: string | undefined;
    const subscription = client?.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT' || (identity && session?.user.id !== identity)) {
        setLoaded(null);
        loadedRef.current = null;
        onBack();
      }
      accessTokenRef.current = session?.access_token ?? null;
      if (session) identity ??= session.user.id;
    });
    return () => subscription?.data.subscription.unsubscribe();
  }, [documentId, onBack]);

  const readerMounted = useRef(false);
  useEffect(() => {
    readerMounted.current = true;
    return () => {
      readerMounted.current = false;
      // Also release an accepted PDF whose React update never committed before unmount.
      const latest = loadedRef.current?.pdf;
      setTimeout(() => { if (!readerMounted.current) retirePdf(latest); }, 0);
    };
  }, []);

  // Dispose only after React stops using the old PDF. Request cancellation must not close
  // a PDF borrowed by another refresh, and StrictMode's effect replay must keep it alive.
  usePdfDocument(loaded?.pdf);

  const layout = useMemo(() => (loaded?.pdf && loaded.sizes.length ? layoutPages(loaded.sizes) : null), [loaded]);
  const resolver = useMemo(() => (loaded ? new Resolver(loaded.doc, loaded.sizes) : null), [loaded]);
  const prepared = useMemo(
    () => (loaded?.tour && resolver ? prepareTour(loaded.tour, resolver) : null),
    [loaded, resolver],
  );
  const problems = useMemo(() => [...(loaded?.problems ?? []), ...(prepared?.problems ?? [])], [loaded, prepared]);
  const debugPages = useMemo(() => (loaded?.doc ? debugIndex(loaded.doc) : new Map<number, DebugPage>()), [loaded]);

  const narrator = useCallback(
    (isMuted: boolean) =>
      createNarrator({
        baseUrl: loaded?.baseUrl ?? '/',
        muted: isMuted,
        forceSilent: params.silent,
        voiceId: browserVoices.selectedVoiceId,
      }),
    [loaded, params.silent, browserVoices.selectedVoiceId],
  );

  const state = useSyncExternalStore(engine?.subscribe ?? noSubscribe, engine?.getState ?? (() => IDLE));

  const scene = useMemo(
    () => (resolver && layout ? buildScene([...state.overlays, ...selection], resolver, layout) : EMPTY_SCENE),
    [state.overlays, selection, resolver, layout],
  );

  // Camera: frame the engine's current camera command; re-frame instantly on resize.
  const frame = useCallback(
    (cmd: CameraCommand, instant: boolean) => {
      if (!layout || !resolver) return;
      // A target that cannot be framed leaves the camera where it is; it must not take the app down.
      try {
        const vp = camera.viewport;
        const view = cmd.action ? cameraView(cmd.action, resolver, layout, vp) : initialView(layout, vp);
        if (!view) return;
        if (instant) camera.jumpTo(view);
        else camera.animateTo(view);
      } catch (err) {
        console.warn('[camera] could not frame', cmd.action, err);
      }
    },
    [camera, layout, resolver],
  );
  // Dispatch camera commands synchronously, before narration waits for the flight.
  // A React effect would start the animation only after speech has already begun.
  useEffect(() => {
    if (!prepared) return;
    const e = new TourEngine(prepared.tour, {
      narrator: new SilentNarrator(),
      fallbackNarrator: new SilentNarrator(),
      beforeNarration: (signal) => camera.whenSettled(signal),
    });
    let lastCamera = 0;
    const unsubscribe = e.subscribe(() => {
      const command = e.getState().camera;
      if (command.seq === lastCamera) return;
      lastCamera = command.seq;
      frame(command, false);
    });
    setEngine(e);
    return () => {
      unsubscribe();
      e.destroy();
      setEngine(null);
    };
  }, [prepared, camera, frame]);
  useEffect(() => engine?.setNarrator(narrator(muted)), [engine, narrator, muted]);
  useEffect(() => engine?.setRate(speed * params.rate), [engine, speed, params.rate]);

  const onViewportChange = useCallback(() => {
    if (!layout) return;
    if (!restoredView.current) {
      restoredView.current = true;
      camera.jumpTo(viewFromPosition(layout, camera.viewport, savedPosition.current));
      return;
    }
    // Reflow preserves the page-relative reading position, including restored/manual navigation.
    camera.jumpTo(camera.getView());
  }, [camera, layout]);

  useEffect(() => {
    if (!engine) return;
    const saved = savedPosition.current;
    if (saved?.stepId && manifest?.selectedTour?.id === saved.tourId) {
      const index = engine.steps.findIndex((step) => step.step.id === saved.stepId);
      if (index >= 0) engine.goTo(index);
    }
  }, [engine, manifest?.selectedTour?.id]);

  const selectedTourId = manifest?.selectedTour?.id ?? null;
  const save = useCallback(
    (value: ReaderState): Promise<void> => {
      if (!documentId) return Promise.resolve();
      nextSave.current = value;
      // Coalesce slow saves and serialize requests so an older checkpoint cannot overtake a newer one.
      if (saveRun.current) return saveRun.current;
      saveRun.current = (async () => {
        while (nextSave.current) {
          const checkpoint = nextSave.current;
          nextSave.current = null;
          try {
            await apiRequest(`/api/documents/${documentId}/reader-state`, {
              method: 'PUT',
              keepalive: true,
              body: JSON.stringify(checkpoint),
            });
            setSaveError(null);
          } catch {
            setSaveError('Reading position could not be saved.');
          }
        }
      })().finally(() => {
        saveRun.current = null;
      });
      return saveRun.current;
    },
    [documentId],
  );
  const saveRef = useRef(save);
  saveRef.current = save;
  const pendingSave = useRef<ReturnType<typeof setTimeout>>();
  const tourCheckpoint = useRef({
    tourId: selectedTourId,
    stepId: state.status === 'idle' ? null : (engine?.steps[state.index]?.step.id ?? null),
  });
  tourCheckpoint.current = {
    tourId: selectedTourId,
    stepId: state.status === 'idle' ? null : (engine?.steps[state.index]?.step.id ?? null),
  };
  useEffect(() => {
    if (!layout) return;
    const update = () => {
      setZoomPercent(Math.round(camera.getView().s * 100));
      const position = positionFromView(layout, camera.getView());
      setCurrentPage(position.page);
      checkpointRef.current = { ...position, ...tourCheckpoint.current };
      clearTimeout(pendingSave.current);
      pendingSave.current = setTimeout(() => {
        if (checkpointRef.current) void saveRef.current(checkpointRef.current);
      }, 1000);
    };
    const unsubscribe = camera.subscribe((_view, moving) => {
      if (!moving) update();
    });
    update();
    return () => {
      unsubscribe();
      clearTimeout(pendingSave.current);
    };
  }, [layout, camera]);
  useEffect(() => {
    if (!layout || !restoredView.current) return;
    const value = { ...positionFromView(layout, camera.getView()), ...tourCheckpoint.current };
    checkpointRef.current = value;
    clearTimeout(pendingSave.current);
    pendingSave.current = setTimeout(() => void saveRef.current(value), 1000);
  }, [state.index, state.status, selectedTourId, layout, camera]);
  useEffect(() => {
    const flush = () => {
      if (!checkpointRef.current || !documentId || !accessTokenRef.current) return;
      if (saveRun.current) {
        nextSave.current = checkpointRef.current;
        return;
      }
      // Stop a debounced older save from following the final checkpoint.
      clearTimeout(pendingSave.current);
      nextSave.current = null;
      const base = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '');
      void fetch(`${base}/api/documents/${documentId}/reader-state`, {
        method: 'PUT',
        keepalive: true,
        headers: { Authorization: `Bearer ${accessTokenRef.current}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(checkpointRef.current),
      }).catch(() => {});
    };
    const visibility = () => {
      if (document.hidden) flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', visibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', visibility);
    };
  }, [documentId]);

  const navigateTo = useCallback(
    (id: string, kind?: string) => {
      if (!resolver || !layout) return;
      engine?.pause();
      const action = { type: 'focus' as const, target: id };
      frame({ seq: 1, key: id, action }, false);
      const overlay =
        kind === 'sentence' || kind === 'block'
          ? { type: 'highlight' as const, targets: [id], color: 'blue' as const }
          : { type: 'box' as const, target: id, color: 'blue' as const };
      setSelection([{ key: `selection:${id}`, step: -1, action: overlay, persist: false }]);
    },
    [resolver, layout, engine, frame],
  );

  useEffect(() => {
    let alive = true;
    const q = query.trim();
    if (!q || !loaded?.doc) {
      setHits([]);
      setSearchError(null);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const analysisId = manifest?.docAnalysisId;
        const results =
          documentId && analysisId
            ? (
                await apiRequest<{ hits: SearchHit[] }>(
                  `/api/documents/${documentId}/search?analysisId=${encodeURIComponent(analysisId)}&q=${encodeURIComponent(q)}`,
                )
              ).hits
            : loaded
                .doc!.sentences.filter((sentence) => sentence.text.toLowerCase().includes(q.toLowerCase()))
                .slice(0, 30)
                .map(
                  (sentence): SearchHit => ({
                    ref: { documentId: params.paper, analysisId: 'demo', elementId: sentence.id },
                    kind: 'sentence',
                    page: sentence.page,
                    text: sentence.text,
                  }),
                );
        if (alive) {
          setHits(results);
          setSearchError(null);
        }
      } catch (error) {
        if (alive) setSearchError((error as Error).message);
      }
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [query, loaded?.doc, documentId, manifest?.docAnalysisId, params.paper]);

  useEffect(() => () => camera.destroy(), [camera]);

  // Keyboard: Space play/pause, arrows step, D toggles the ID overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isInteractive(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        engine?.toggle();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        engine?.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        engine?.prev();
      } else if (e.key === 'd' || e.key === 'D') {
        setDebug((d) => !d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [engine]);

  const onCopyId = useCallback((id: string) => {
    void copyText(id);
    setToast((t) => ({ text: `Copied ${id}`, n: (t?.n ?? 0) + 1 }));
  }, []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(t);
  }, [toast]);

  useEffect(() => {
    const title = loaded?.tour?.title ?? loaded?.doc?.source.title;
    if (title) document.title = `${title} · Paper Tour`;
  }, [loaded]);

  const errors = problems.filter((p) => p.level === 'error');
  const steps = engine?.steps ?? [];
  const goPage = (page: number) => {
    if (!layout) return;
    const p = layout.pages[Math.max(0, Math.min(layout.pages.length - 1, page - 1))];
    if (!p) return;
    engine?.pause();
    camera.animateTo({
      cx: p.x + p.width / 2,
      cy: p.y + camera.viewport.height / camera.getView().s / 2,
      s: camera.getView().s,
    });
  };
  const back = () => {
    engine?.pause();
    if (checkpointRef.current) void save(checkpointRef.current).finally(onBack);
    else onBack();
  };
  const documentNavigation = (
    <div className="document-navigation">
      <label className="reader-search">
        <span>Search this paper</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a passage…"
          disabled={!loaded?.doc}
        />
      </label>
      {searchError && <p role="alert">{searchError}</p>}
      {query.trim() ? (
        <div className="reader-results" aria-live="polite">
          {hits.map((hit) => (
            <button key={hit.ref.elementId} onClick={() => navigateTo(hit.ref.elementId, hit.kind)}>
              <small>Page {hit.page}</small>
              <span>{hit.text}</span>
            </button>
          ))}
          {!hits.length && <p className="reader-muted">No matching passages.</p>}
        </div>
      ) : (
        <>
          <h2>Contents</h2>
          {loaded?.doc?.sections.map((section) => (
            <button className="reader-outline-item" key={section.id} onClick={() => navigateTo(section.id)}>
              <span>{section.title}</span>
              <small>{section.page}</small>
            </button>
          ))}
          {!loaded?.doc?.sections.length && (
            <p className="reader-muted">
              {manifest?.analysis?.status === 'processing' || manifest?.analysis?.status === 'queued'
                ? 'Contents will appear when analysis finishes.'
                : 'No sections detected. Use the page controls to navigate.'}
            </p>
          )}
          {!!loaded?.doc?.figures.length && <h2>Figures and tables</h2>}
          {loaded?.doc?.figures.map((figure) => (
            <button className="reader-figure-item" key={figure.id} onClick={() => navigateTo(figure.id)}>
              {(manifest?.assets[figure.image] || !documentId) && (
                <img src={manifest?.assets[figure.image] ?? `${loaded.baseUrl}${figure.image}`} alt="" loading="lazy" />
              )}
              <span>
                <strong>
                  {figure.kind === 'figure' ? 'Figure' : 'Table'} {figure.number}
                </strong>
                <span>{figure.caption}</span>
              </span>
            </button>
          ))}
        </>
      )}
    </div>
  );

  return (
    <div className="app reader-app">
      <header className="reader-app-toolbar">
        <button className="reader-library-button" onClick={back}>
          ‹ <span>Library</span>
        </button>
        <div className="reader-tour-actions">
          {' '}
          {documentId && manifest && (manifest.tourGeneration || !manifest.tours.length) && (
            <TourGeneration
              documentId={documentId}
              generation={manifest.tourGeneration}
              canGenerate={!!manifest.doc && manifest.document.fileStatus === 'uploaded'}
              onChanged={() => setManifestRefresh((value) => value + 1)}
              onOpenTour={
                tab === 'document'
                  ? (tourId) => {
                      engine?.pause();
                      setSelection([]);
                      setActiveTour(tourId);
                      setTab('tour');
                    }
                  : undefined
              }
              compact
              toolbar
            />
          )}
        </div>
        {documentId && (
          <a
            className="reader-settings-button"
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
          </a>
        )}
      </header>
      <Sidebar
        tour={tab === 'tour' ? (prepared?.tour ?? null) : null}
        steps={steps}
        state={state}
        docTitle={manifest?.document.title ?? loaded?.doc?.source.title}
        onJump={(i) => {
          setSelection([]);
          engine?.goTo(i);
        }}
        header={
          <>
            <div className="reader-tabs">
              <button className={tab === 'document' ? 'active' : ''} onClick={() => setTab('document')}>
                Document
              </button>
              <button
                disabled={!prepared?.tour}
                className={tab === 'tour' ? 'active' : ''}
                onClick={() => setTab('tour')}
              >
                Tour
              </button>
            </div>
            {(manifest?.tours.length ?? 0) > 1 && manifest && (
              <label className="reader-tour-picker">
                Saved tour
                <select
                  title={manifest.tours.find((tour) => tour.id === manifest.selectedTour?.id)?.title}
                value={manifest.selectedTour?.id ?? ''}
                  onChange={(event) => {
                    engine?.pause();
                    setSelection([]);
                    savedPosition.current = null;
                    setActiveTour(event.target.value);
                    setTab('tour');
                  }}
                >
                  <option value="" disabled>
                    Select a tour
                  </option>
                  {manifest.tours.map((tour, index) => (
                    <option key={tour.id} value={tour.id}>
                      {manifest.tours.length > 1 ? `v${manifest.tours.length - index} · ` : ''}
                      {tour.title}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        }
        navigation={tab === 'document' ? documentNavigation : undefined}
      >
        {loaded && <Problems problems={problems} defaultOpen />}
      </Sidebar>

      <main className="main">
        <div className="reader-toolbar">
          <button
            disabled={!layout || currentPage <= 1}
            onClick={() => goPage(currentPage - 1)}
            aria-label="Previous page"
          >
            ‹
          </button>
          <label>
            Page{' '}
            <input
              aria-label="Page number"
              type="number"
              key={currentPage}
              defaultValue={currentPage}
              min={1}
              max={loaded?.sizes.length ?? 1}
              onKeyDown={(event) => {
                if (event.key === 'Enter') goPage(Number(event.currentTarget.value));
              }}
              onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isInteger(value) && value !== currentPage) goPage(value);
              }}
            />{' '}
            / {loaded?.sizes.length || '–'}
          </label>
          <button
            disabled={!layout || currentPage >= (loaded?.sizes.length ?? 0)}
            onClick={() => goPage(currentPage + 1)}
            aria-label="Next page"
          >
            ›
          </button>
          <div className="reader-zoom-controls" role="group" aria-label="PDF zoom">
            <button
              disabled={!layout || zoomPercent <= 10}
              aria-label="Zoom out"
              title="Zoom out"
              onClick={() => {
                engine?.pause();
                camera.zoomAt(1 / 1.2, camera.viewport.width / 2, camera.viewport.height / 2);
              }}
            >
              −
            </button>
            <input
              aria-label="Zoom percentage"
              title="Zoom percentage"
              type="number"
              key={`zoom-${zoomPercent}`}
              defaultValue={zoomPercent}
              min={10}
              max={600}
              disabled={!layout}
              onKeyDown={(event) => {
                if (event.key === 'Enter') event.currentTarget.blur();
              }}
              onBlur={(event) => {
                const value = Number(event.currentTarget.value);
                if (Number.isFinite(value) && value >= 10 && value <= 600) {
                  engine?.pause();
                  camera.zoomAt(
                    value / 100 / camera.getView().s,
                    camera.viewport.width / 2,
                    camera.viewport.height / 2,
                  );
                } else event.currentTarget.value = String(zoomPercent);
              }}
            />
            <span>%</span>
            <button
              disabled={!layout || zoomPercent >= 600}
              aria-label="Zoom in"
              title="Zoom in"
              onClick={() => {
                engine?.pause();
                camera.zoomAt(1.2, camera.viewport.width / 2, camera.viewport.height / 2);
              }}
            >
              +
            </button>
          </div>
          <button
            disabled={!layout}
            onClick={() => {
              if (!layout) return;
              const p = layout.pages[currentPage - 1];
              if (p)
                camera.animateTo({
                  ...camera.getView(),
                  cx: p.x + p.width / 2,
                  s: readingScale(p.width, camera.viewport),
                });
            }}
          >
            Fit width
          </button>
          {!!selection.length && <button onClick={() => setSelection([])}>Clear selection</button>}
          {manifest?.analysis && (
            <span className="reader-status" role="status" title={manifest.analysis.warnings.join('\n')}>
              {manifest.analysis.status === 'processing'
                ? 'Analyzing…'
                : manifest.analysis.status === 'queued'
                  ? 'Analysis queued'
                  : manifest.analysis.status === 'limited'
                    ? 'Analysis notes'
                    : manifest.analysis.status === 'failed'
                      ? 'Analysis failed'
                      : 'Ready'}
            </span>
          )}
          <button
            className={`reader-ids-button${debug ? ' active' : ''}`}
            onClick={() => setDebug(!debug)}
            aria-pressed={debug}
            title="Show element IDs (D)"
          >
            IDs
          </button>
        </div>
        {layout ? (
          <Stage
            pdf={loaded?.pdf ?? null}
            layout={layout}
            camera={camera}
            scene={scene}
            debugPages={debug ? debugPages : null}
            onViewportChange={onViewportChange}
            onCopyId={onCopyId}
          />
        ) : (
          <div className="viewport loading">{fatal ? `Could not load the paper: ${fatal}` : 'Loading paper…'}</div>
        )}

        {(errors.length > 0 || fatal || saveError || manifest?.analysis?.error) && (
          <div className="banner" role="alert">
            {errors.map((p, i) => (
              <div key={i}>{p.message}</div>
            ))}
            {fatal && (
              <div>
                {fatal} <button onClick={back}>Back to library</button>
              </div>
            )}
            {saveError && <div>{saveError}</div>}
            {manifest?.analysis?.error && <div>{manifest.analysis.error} The PDF remains available to read.</div>}
          </div>
        )}

        {toast && (
          <div className="toast" key={toast.n}>
            {toast.text}
          </div>
        )}

        {prepared?.tour && (
          <ControlBar
            steps={steps}
            state={state}
            speed={speed}
            muted={muted || params.silent}
            onToggle={() => {
              setSelection([]);
              engine?.toggle();
            }}
            onPrev={() => engine?.prev()}
            onNext={() => engine?.next()}
            onSpeed={setSpeed}
            onMute={setMuted}
            voices={browserVoices.voices}
            voicesLoading={browserVoices.loading}
            selectedVoiceId={browserVoices.selectedVoiceId}
            onVoiceChange={browserVoices.setSelectedVoiceId}
            voiceConfig={prepared.tour.voices?.[steps[state.index]?.step.speaker ?? 'host']}
          />
        )}
      </main>
    </div>
  );
}
