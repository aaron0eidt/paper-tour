import { isPdfOpen, usePdfDocument, retirePdf } from './pdfLifetime';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, cameraView, fitWidthView, initialView, readingScale } from './camera';
import type { View } from './camera';
import { EMPTY_BOARD, TourEngine, boardPlayback } from './engine';
import type { CameraCommand, EngineState } from './engine';
import { layoutPages } from './layout';
import { loadManifest, loadPaper } from './load';
import type { Loaded } from './load';
import { createNarrator, SilentNarrator, useBrowserVoices } from './narration';
import { prepareTour, Resolver } from './resolve';
import { buildScene } from './scene';
import type { Scene } from './scene';
import type { Doc } from './types';
import { BoardSplit } from './components/Board';
import { ControlBar } from './components/ControlBar';
import type { DebugPage } from './components/PageView';
import { Problems } from './components/Problems';
import { Sidebar } from './components/Sidebar';
import { Stage } from './components/Stage';
import { TourGeneration } from './components/TourGeneration';
import { TourDockStatus } from './components/TourDockStatus';
import { isTourGenerationActive } from './library/tourGeneration';
import { apiRequest, ApiRequestError, getSupabase } from './library/client';
import type { DocumentManifest, ReaderState, SearchHit } from '../../shared/contracts';
import type { OverlayEntry } from './engine';
import { positionFromView, viewFromPosition } from './readerState';
import { AskPanel } from './ask/AskPanel';
import type { AskContext } from './ask/AskPanel';
import { answerTour, visualShown } from './ask/answer';
import type { AskAnswer, AskSource } from './ask/api';
import type { RegionSelection } from './ask/regionSelection';
import { SelectionPreview } from './ask/SelectionPreview';
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
  board: EMPTY_BOARD,
};
const EMPTY_SCENE: Scene = { pages: new Map(), spotlight: false, notes: [], labels: [], obstacles: [] };
const noSubscribe = () => () => {};
const idleState = () => IDLE;

/** Where the tour was when a question set it aside, so "Back to the tour" can bring it back exactly. */
interface Away {
  /** The target the camera showed, framed again for the stage size at return; null after a manual pan or zoom. */
  framed: { cmd: CameraCommand; view: View } | null;
  view: View;
  playing: boolean;
}

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
  const [activityRequest, setActivityRequest] = useState(0);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadedAnalysisId, setLoadedAnalysisId] = useState<string | undefined>();
  const [fatal, setFatal] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
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
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selection, setSelection] = useState<OverlayEntry[]>([]);
  const [regionSelection, setRegionSelection] = useState<RegionSelection | null>(null);
  const [selectingRegion, setSelectingRegion] = useState(false);
  const selectionCheckpoint = useRef<{ engine: TourEngine | null; playing: boolean } | null>(null);
  useEffect(() => {
    setRegionSelection(null);
    setSelectingRegion(false);
    selectionCheckpoint.current = null;
  }, [documentId, params.paper]);
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
    let needsRetry = false;
    let retryContent = false;
    const accept = (value: Loaded, analysisId?: string) => {
      if (!alive) {
        if (value.pdf !== loadedRef.current?.pdf) retirePdf(value.pdf);
        return;
      }
      const previousPdf = loadedRef.current?.pdf;
      loadedRef.current = value;
      setLoaded(value);
      setLoadedAnalysisId(analysisId);
      if (previousPdf !== value.pdf) retirePdf(previousPdf);
    };
    const refresh = async () => {
      if (loading) return;
      lastPoll = Date.now();
      loading = true;
      let fetchingManifest = !!documentId;
      try {
        if (!documentId) {
          accept(await loadPaper(params.paper));
          if (alive) setFatal(null);
          return;
        }
        const pinnedTour = activeTour ?? manifestRef.current?.selectedTour?.id;
        const next = await apiRequest<DocumentManifest>(
          `/api/documents/${documentId}/manifest${pinnedTour ? `?tourId=${encodeURIComponent(pinnedTour)}` : ''}`,
        );
        if (!alive) return;
        fetchingManifest = false;
        setRefreshError(null);
        const previous = manifestRef.current;
        const reloadPdf = !!loadedRef.current?.pdf && Date.now() - pdfOpenedAt.current > 45 * 60 * 1000;
        const changed =
          retryContent ||
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
          retryContent = true;
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
          accept(value, next.selectedTour?.analysisId ?? next.docAnalysisId ?? undefined);
          retryContent = false;
        }
        // Content failures force the reload above; validation problems remain on Loaded.
        setFatal(null);
        needsRetry = false;
      } catch (error) {
        if (alive && error instanceof ApiRequestError && [401, 403, 404].includes(error.status)) {
          setLoaded(null);
          loadedRef.current = null;
          onBack();
          return;
        }
        if (alive) {
          needsRetry = true;
          if (fetchingManifest && loadedRef.current) setRefreshError((error as Error).message);
          else setFatal((error as Error).message);
        }
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
          if (!document.hidden && (working || needsRetry || Date.now() - lastPoll > 60_000)) void refresh();
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
      setTimeout(() => {
        if (!readerMounted.current) retirePdf(latest);
      }, 0);
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

  // One narrator for the tour and its answers, so both speak with the same voice.
  const baseUrl = loaded?.baseUrl ?? '/';
  const narrator = useMemo(
    () => createNarrator({ baseUrl, muted, forceSilent: params.silent, voiceId: browserVoices.selectedVoiceId }),
    [baseUrl, muted, params.silent, browserVoices.selectedVoiceId],
  );

  // A question sets the tour aside and its answer plays as a second tour on the same narrator, camera, pen and board;
  // the stage, the board and the control bar show whichever is playing, the sidebar always the tour.
  const [answer, setAnswer] = useState<TourEngine | null>(null);
  const [away, setAway] = useState<Away | null>(null);
  const mainState = useSyncExternalStore(engine?.subscribe ?? noSubscribe, engine?.getState ?? idleState);
  const answerState = useSyncExternalStore(answer?.subscribe ?? noSubscribe, answer?.getState ?? idleState);
  const state = answer ? answerState : mainState;
  const active = answer ?? engine;

  const scene = useMemo(
    () =>
      resolver && layout
        ? buildScene(
            [...state.overlays, ...selection],
            resolver,
            layout,
            state.status === 'playing' ? state.camera.action : null,
          )
        : EMPTY_SCENE,
    [state.overlays, state.camera, state.status, selection, resolver, layout],
  );

  // Camera: frame the engine's current camera command; re-frame instantly on resize.
  // `framed` is the last command and the view chosen for it, so a resize can frame it again.
  const framed = useRef<{ cmd: CameraCommand; view: View; fitWidth?: boolean } | null>(null);
  const fitSourceWidth = useRef(false);
  fitSourceWidth.current = !!state.board.item;
  const frame = useCallback(
    (cmd: CameraCommand, instant: boolean, retarget = false) => {
      if (!layout || !resolver) return;
      // A target that cannot be framed leaves the camera where it is; it must not take the app down.
      try {
        const vp = camera.viewport;
        const fitWidth = retarget ? fitSourceWidth.current || !!framed.current?.fitWidth : fitSourceWidth.current;
        const view = cmd.action ? cameraView(cmd.action, resolver, layout, vp, { fitWidth }) : initialView(layout, vp);
        if (!view) return;
        if (instant) camera.jumpTo(view);
        else if (retarget) camera.retargetTo(view);
        else camera.animateTo(view);
        framed.current = { cmd, view: camera.targetView, fitWidth };
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
  useEffect(() => engine?.setNarrator(narrator), [engine, narrator]);
  useEffect(() => engine?.setRate(speed * params.rate), [engine, speed, params.rate]);
  useEffect(() => answer?.setNarrator(narrator), [answer, narrator]);
  useEffect(() => answer?.setRate(speed * params.rate), [answer, speed, params.rate]);

  // The latest of what the ask handlers read, since an answer arrives after the reader has rendered again.
  const now = useRef({ engine, answer, away, prepared, resolver, frame, narrator, rate: speed * params.rate });
  now.current = { engine, answer, away, prepared, resolver, frame, narrator, rate: speed * params.rate };

  const dropAnswer = useCallback(() => {
    now.current.answer?.destroy();
    now.current.answer = null;
    setAnswer(null);
  }, []);
  // A new tour (or none) ends any answer about the old one.
  useEffect(() => {
    dropAnswer();
    setAway(null);
  }, [prepared, dropAnswer]);
  useEffect(() => () => now.current.answer?.destroy(), []);

  /** Where the learner is: the tour step, and the figure, panel or equation the camera still shows. */
  const askContext = useCallback((): AskContext => {
    const { engine: main, resolver: ids } = now.current;
    const tour = main?.getState();
    const last = framed.current;
    const shown = last && camera.targetView === last.view ? last.cmd.action : null;
    return {
      stepId: tour && tour.status !== 'idle' ? main?.steps[tour.index]?.step.id : undefined,
      figureId: !regionSelection && ids ? visualShown(shown, (id) => ids.kind(id)) : undefined,
      selection: regionSelection ?? undefined,
      analysisId: loadedAnalysisId,
    };
  }, [camera, regionSelection, loadedAnalysisId]);

  // A question pauses whatever plays; the first one of a conversation remembers where the tour was.
  const setAside = useCallback(() => {
    const { engine: main, answer: playing, away: was } = now.current;
    const regionCheckpoint = selectionCheckpoint.current;
    selectionCheckpoint.current = null;
    setSelectingRegion(false);
    playing?.pause();
    if (!was) {
      const last = framed.current;
      const next: Away = {
        framed: last && camera.targetView === last.view ? last : null,
        view: camera.targetView,
        playing:
          main?.getState().status === 'playing' || (regionCheckpoint?.engine === main && regionCheckpoint.playing),
      };
      now.current.away = next;
      setAway(next);
    }
    main?.pause();
  }, [camera]);

  const onAnswer = useCallback(
    (reply: AskAnswer, question: string) => {
      const { engine: main, prepared: tour, resolver: ids, narrator: voice, rate } = now.current;
      if (!ids) return;
      const speaker = main?.steps[main.getState().index]?.step.speaker;
      const script = prepareTour(answerTour(reply, question, tour?.tour ?? null, speaker), ids).tour;
      dropAnswer();
      // Also when a new tour arrived meanwhile or the learner pressed play: an answer always has a way back.
      setAside();
      const e = new TourEngine(script, {
        narrator: voice,
        fallbackNarrator: new SilentNarrator(),
        rate,
        beforeNarration: (signal) => camera.whenSettled(signal),
        });
      // An answer step without a camera move keeps the view; it never jumps back to the first page.
      let lastCamera = 0;
      e.subscribe(() => {
        const command = e.getState().camera;
        if (command.seq === lastCamera) return;
        lastCamera = command.seq;
        if (command.action) now.current.frame(command, false);
      });
      now.current.answer = e;
      setAnswer(e);
      setSelection([]);
      e.play();
    },
    [camera, dropAnswer, setAside],
  );

  // Back to the tour: the answer goes, and the tour returns as it was: its marks and board (it only paused), the
  // camera on what it showed, and playing again if it was.
  const backToTour = useCallback(() => {
    const { engine: main, away: was, frame: show } = now.current;
    dropAnswer();
    setRegionSelection(null);
    now.current.away = null;
    setAway(null);
    if (!was) return;
    if (was.playing && main) main.play();
    else if (was.framed) show(was.framed.cmd, false);
    else {
      framed.current = null;
      camera.animateTo(was.view);
    }
  }, [camera, dropAnswer]);
  // Leaving the answer for somewhere else in the tour: no need to restore the view first.
  const leaveAnswer = useCallback(() => {
    dropAnswer();
    now.current.away = null;
    setAway(null);
  }, [dropAnswer]);

  // Selection pauses the visible narration without losing the main tour checkpoint.
  const beginRegionSelection = useCallback(() => {
    const current = now.current.answer ?? now.current.engine;
    if (!selectionCheckpoint.current)
      selectionCheckpoint.current = { engine: current, playing: current?.getState().status === 'playing' };
    current?.pause();
    camera.jumpTo(camera.getView());
    setSelectingRegion(true);
  }, [camera]);
  const cancelRegionSelection = useCallback(() => {
    setSelectingRegion(false);
    const checkpoint = selectionCheckpoint.current;
    selectionCheckpoint.current = null;
    if (checkpoint?.playing && checkpoint.engine === (now.current.answer ?? now.current.engine))
      checkpoint.engine?.play();
  }, []);
  const acceptRegionSelection = useCallback((region: RegionSelection) => {
    setRegionSelection(region);
    setSelectingRegion(false);
  }, []);
  const clearRegionSelection = useCallback(() => {
    setRegionSelection(null);
    cancelRegionSelection();
  }, [cancelRegionSelection]);
  useEffect(() => {
    if (!selectingRegion) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      cancelRegionSelection();
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, [selectingRegion, cancelRegionSelection]);

  const onViewportChange = useCallback(() => {
    if (!layout) return;
    if (!restoredView.current) {
      restoredView.current = true;
      camera.jumpTo(viewFromPosition(layout, camera.viewport, savedPosition.current));
      return;
    }
    // While the camera still shows the target it last framed, the new size (the board opening or
    // closing, a window resize) frames that target again, so it stays whole and in view. Otherwise
    // reflow preserves the page-relative reading position, including restored/manual navigation.
    const last = framed.current;
    if (fitSourceWidth.current || last?.fitWidth) {
      const wasFramed = last && camera.targetView === last.view;
      const view = fitWidthView(camera.targetView, layout, camera.viewport);
      if (camera.animating) camera.retargetTo(view);
      else camera.jumpTo(view);
      if (wasFramed) framed.current = { ...last, view: camera.targetView, fitWidth: true };
    } else if (last && camera.targetView === last.view) frame(last.cmd, !camera.animating, true);
    else camera.jumpTo(camera.getView());
  }, [camera, layout, frame]);

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
    stepId: mainState.status === 'idle' ? null : (engine?.steps[mainState.index]?.step.id ?? null),
  });
  tourCheckpoint.current = {
    tourId: selectedTourId,
    stepId: mainState.status === 'idle' ? null : (engine?.steps[mainState.index]?.step.id ?? null),
  };
  useEffect(() => {
    if (!layout) return;
    const update = () => {
      setZoomPercent(Math.round(camera.getView().s * 100));
      const position = positionFromView(layout, camera.getView());
      setCurrentPage(position.page);
      if (now.current.away) return;
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
    // A status change can arrive before the camera has returned from an answer. The settled
    // camera subscription records the new checkpoint; never flush an intermediate answer view.
    if (now.current.away || camera.animating) return;
    const value = { ...positionFromView(layout, camera.getView()), ...tourCheckpoint.current };
    checkpointRef.current = value;
    clearTimeout(pendingSave.current);
    pendingSave.current = setTimeout(() => void saveRef.current(value), 1000);
  }, [mainState.index, mainState.status, selectedTourId, layout, camera]);
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
      setNavigationOpen(false);
      active?.pause();
      const action = { type: 'focus' as const, target: id };
      frame({ seq: 1, key: id, action }, false);
      const overlay =
        kind === 'sentence' || kind === 'block'
          ? { type: 'highlight' as const, targets: [id], color: 'blue' as const }
          : { type: 'box' as const, target: id, color: 'blue' as const };
      setSelection([{ key: `selection:${id}`, step: -1, action: overlay, persist: false }]);
    },
    [resolver, layout, active, frame],
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

  // Keyboard: Space play/pause, arrows step (through an answer while one plays), D toggles the ID overlay. Nothing
  // fires while the learner types, in the ask bar or any other field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && navigationOpen) {
        setNavigationOpen(false);
        return;
      }
      if (selectingRegion || isInteractive(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === ' ') {
        e.preventDefault();
        active?.toggle();
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        active?.next();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        active?.prev();
      } else if (e.key === 'd' || e.key === 'D') {
        setDebug((d) => !d);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, navigationOpen, selectingRegion]);

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
    active?.pause();
    camera.animateTo({
      cx: p.x + p.width / 2,
      cy: p.y + camera.viewport.height / camera.getView().s / 2,
      s: camera.getView().s,
    });
  };
  const back = () => {
    active?.pause();
    if (checkpointRef.current) void save(checkpointRef.current).finally(onBack);
    else onBack();
  };
  // Asking is open wherever there is a document to ask about: a library document by its ID, a demo by its folder.
  const askSource = useMemo<AskSource>(
    () => (documentId ? { documentId } : { paper: params.paper }),
    [documentId, params.paper],
  );
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
    <div className={`app reader-app${navigationOpen ? ' navigation-open' : ''}`}>
      <header className="reader-app-toolbar">
        <button className="reader-library-button" onClick={back}>
          ‹ <span>Library</span>
        </button>
        <button
          type="button"
          className="reader-navigation-toggle"
          aria-controls="reader-navigation"
          aria-expanded={navigationOpen}
          aria-label={navigationOpen ? 'Close paper navigation' : 'Open paper navigation'}
          onClick={() => setNavigationOpen((open) => !open)}
        >
          Contents
        </button>
        <div className="reader-tour-actions">
          {' '}
          {documentId && manifest && (manifest.tourGeneration || !manifest.tours.length) && (
            <TourGeneration
              documentId={documentId}
              generation={manifest.tourGeneration}
              activityRequest={activityRequest}
              canGenerate={!!manifest.doc && manifest.document.fileStatus === 'uploaded'}
              onChanged={() => setManifestRefresh((value) => value + 1)}
              onOpenTour={
                tab === 'document'
                  ? (tourId) => {
                      leaveAnswer();
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
        state={mainState}
        docTitle={manifest?.document.title ?? loaded?.doc?.source.title}
        onJump={(i) => {
          setNavigationOpen(false);
          setSelection([]);
          leaveAnswer();
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
                    leaveAnswer();
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
                active?.pause();
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
                  active?.pause();
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
                active?.pause();
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
          <BoardSplit board={state.board} playback={boardPlayback(state, active?.steps ?? [])}>
            <div className="ask-stage">
              <Stage
                pdf={loaded?.pdf ?? null}
                layout={layout}
                camera={camera}
                scene={scene}
                debugPages={debug ? debugPages : null}
                onViewportChange={onViewportChange}
                onCopyId={onCopyId}
                selecting={selectingRegion}
                regionSelection={regionSelection}
                onSelectRegion={acceptRegionSelection}
                onCancelSelection={cancelRegionSelection}
              />
              {loaded?.doc && (
                <div className="ask-lane">
                  <AskPanel
                    className="ask-dock"
                    tourStatus={
                      <TourDockStatus
                        documentId={documentId}
                        generation={manifest?.tourGeneration}
                        state={state}
                        steps={active?.steps ?? []}
                        chapter={active?.tour.chapters[active.steps[state.index]?.chapterIndex ?? 0]?.title}
                        answering={!!answer}
                        onActivity={
                          manifest?.tourGeneration ? () => setActivityRequest((request) => request + 1) : undefined
                        }
                      />
                    }
                    source={askSource}
                    tourId={documentId ? selectedTourId : null}
                    context={askContext}
                    suggestions={prepared?.tour.suggested_questions}
                    ended={mainState.status === 'ended'}
                    away={!!away}
                    answering={answerState.status === 'playing'}
                    answerPaused={!!answer && answerState.status === 'paused'}
                    onPauseAnswer={() => now.current.answer?.pause()}
                    onContinueAnswer={() => now.current.answer?.play()}
                    resumeLabel={engine ? (answer ? 'Back to the tour' : 'Continue tour') : 'Back to the document'}
                    selection={regionSelection}
                    selecting={selectingRegion}
                    selectionPreview={
                      regionSelection && <SelectionPreview pdf={loaded.pdf} selection={regionSelection} />
                    }
                    onSelectRegion={beginRegionSelection}
                    onClearRegion={clearRegionSelection}
                    onCancelSelection={cancelRegionSelection}
                    onAsk={setAside}
                    onAnswer={onAnswer}
                    onResume={backToTour}
                  />
                </div>
              )}
            </div>
          </BoardSplit>
        ) : (
          <div className="viewport loading">{fatal ? `Could not load the paper: ${fatal}` : 'Loading paper…'}</div>
        )}

        {(errors.length > 0 || fatal || refreshError || saveError || manifest?.analysis?.error) && (
          <div className="banner" role="alert">
            {errors.map((p, i) => (
              <div key={i}>{p.message}</div>
            ))}
            {fatal && (
              <div>
                {fatal} <button onClick={back}>Back to library</button>
              </div>
            )}
            {refreshError && <div title={refreshError}>Could not refresh the document. Reconnecting…</div>}
            {saveError && <div>{saveError}</div>}
            {manifest?.analysis?.error && <div>{manifest.analysis.error} The PDF remains available to read.</div>}
          </div>
        )}

        {toast && (
          <div className="toast" key={toast.n}>
            {toast.text}
          </div>
        )}

        {active && (
          <ControlBar
            steps={active.steps}
            state={state}
            speed={speed}
            muted={muted || params.silent}
            onToggle={() => {
              setSelection([]);
              active.toggle();
            }}
            onPrev={() => active.prev()}
            onNext={() => active.next()}
            onSpeed={setSpeed}
            onMute={setMuted}
            voices={browserVoices.voices}
            voicesLoading={browserVoices.loading}
            selectedVoiceId={browserVoices.selectedVoiceId}
            onVoiceChange={browserVoices.setSelectedVoiceId}
            voiceConfig={active.tour.voices?.[active.steps[state.index]?.step.speaker ?? 'host']}
          />
        )}
      </main>
    </div>
  );
}
