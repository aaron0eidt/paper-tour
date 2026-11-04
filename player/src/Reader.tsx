import { ReaderNavigation, ReaderNavigationProvider, ReaderNavigationToggle, useReaderNavigation } from './ui/ReaderNavigation';
import { AnimatedSwitch } from './ui/controls';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { setNarrationSoundGate } from './ui/sound';
import { UI_SPRING } from './ui/motion';
import { StatusBadge } from './ui/StatusBadge';
import { ChoicePicker } from './components/ChoicePicker';
import { isPdfOpen, usePdfDocument, retirePdf } from './pdfLifetime';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, fitWidthView, frameFor, initialView, project, readingScale, revealView, slideView } from './camera';
import type { View } from './camera';
import { readingTour, readingStepOnPage, readingStepForTarget, DEFAULT_READING_OPTIONS } from './readAloud';
import { useReadingSpeech } from './useReadingSpeech';
import { AgentActivity } from './activity/AgentActivity';
import { getMaxAutoZoom, getNarrationDisplay, narrationSurfaces, subscribeReadingPreferences } from './readerPreferences';
import { EMPTY_BOARD, TourEngine, boardPlayback } from './engine';
import type { CameraCommand, EngineState, OverlayEntry } from './engine';
import { layoutDeck, layoutPages } from './layout';
import { clampSlide, readerMode, stepSlides, stepsBySlide } from './deck';
import { coverVisible, lengthLabel, readerTitle, recapVisible } from './tourSummary';
import { loadManifest } from './load';
import type { Loaded } from './load';
import { createNarrator, SilentNarrator, useBrowserVoices, speechAvailable } from './narration';
import { useSpeechSettings } from './narration/useSpeechSettings';
import { SpeechProviderSelect } from './narration/SpeechSettings';
import { AudioVoiceControl } from './narration/SpeechVoiceControl';
import { audioChunks } from './narration/remote';
import type { SpeechPreferences } from '../../shared/speech';
import { prepareTour, Resolver } from './resolve';
import { buildScene } from './scene';
import type { Scene } from './scene';
import type { BBox, Doc, Tour, Step } from './types';
import type { BoardItem } from '../../shared/paper';
import { markPlayback } from './marks';
import { keyBelongsTo, keyCommand } from './keys';
import type { KeyTarget } from './keys';
import { buildClock } from './tourClock';
import { BoardSplit } from './components/Board';
import { CoachCard } from './components/CoachCard';
import { checkpointKind } from './components/checkpointWords';
import { ControlBar } from './components/ControlBar';
import { Filmstrip } from './components/Filmstrip';
import type { DebugPage } from './components/PageView';
import { Problems } from './components/Problems';
import { Sidebar } from './components/Sidebar';
import { Stage } from './components/Stage';
import { TourGeneration } from './components/TourGeneration';
import { TourCover, TourEnd } from './components/TourCards';
import { isTourGenerationActive } from './library/tourGeneration';
import { apiRequest, ApiRequestError, getSupabase } from './library/client';
import { usePartialTour } from './library/usePartialTour';
import type { PartialSource } from './library/usePartialTour';
import {
  currentStatus,
  growsInPlace,
  growthOf,
  partialPath,
  playablePartial,
  tourSourceKey,
  withPlayableSteps,
} from './partialTour';
import type { DocumentManifest, ReaderState, SearchHit, TourPartialView } from '../../shared/contracts';
import { positionFromView, viewFromPosition } from './readerState';
import { AskPanel } from './ask/AskPanel';
import type { AskContext } from './ask/AskPanel';
import type { ConversationContext } from '../../shared/conversations';
import { answerTour, openQuestions, visualShown } from './ask/answer';
import type { AskAnswer, AskSource } from './ask/api';
import { prefetchWanted } from './ask/prefetch';
import { unclearOffered, unclearQuestion } from './ask/unclear';
import type { Unclear } from './ask/unclear';
import type { RegionSelection } from './ask/regionSelection';
import { useRegionSnap } from './ask/useRegionSnap';
import { SelectionPreview } from './ask/SelectionPreview';
import './reader.css';

type Prepared = ReturnType<typeof prepareTour>;

interface Params {
  silent: boolean;
  /** URL speed multiplier, for testing (?rate=4). */
  rate: number;
}

function readParams(): Params {
  const q = new URLSearchParams(location.search);
  const rate = Number(q.get('rate'));
  return {
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

export function Reader(props: { documentId: string; onBack(): void }) {
  return <ReaderNavigationProvider><ReaderContent {...props} /></ReaderNavigationProvider>;
}

function ReaderContent({ documentId, onBack }: { documentId: string; onBack(): void }) {
  const params = useMemo(readParams, []);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loadedAnalysisId, setLoadedAnalysisId] = useState<string | undefined>();
  const [fatal, setFatal] = useState<string | null>(null);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const browserVoices = useBrowserVoices();
  const speech = useSpeechSettings(true, !documentId);
  const [speechUpdateError, setSpeechUpdateError] = useState<string | null>(null);
  const [speechUpdatePending, setSpeechUpdatePending] = useState(false);
  const speechUpdating = useRef(false);
  const [speed, setSpeed] = useState(1);
  const [readAloud, setReadAloud] = useState(false);
  const [readingOptions, setReadingOptions] = useState(DEFAULT_READING_OPTIONS);
  const playbackPlaces = useRef(new Map<string, string>());
  const guidedCheckpoint = useRef<{ tourId: string | null; stepId: string | null }>({ tourId: null, stepId: null });
  const [debug, setDebug] = useState(false);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [engine, setEngine] = useState<TourEngine | null>(null);
  const camera = useMemo(() => new Camera(), []);
  const maxAutoZoom = useSyncExternalStore(subscribeReadingPreferences, getMaxAutoZoom) / 100;
  const narrationDisplay = useSyncExternalStore(subscribeReadingPreferences, getNarrationDisplay);
  const captions = narrationSurfaces(narrationDisplay);
  const [manifest, setManifest] = useState<DocumentManifest | null>(null);
  const [activeTour, setActiveTour] = useState<string | null>(new URLSearchParams(location.search).get('tour'));
  const [tab, setTab] = useState<'document' | 'tour'>('document');
  const { isMobile: navigationMobile, openMobile, setOpenMobile: setNavigationOpen } = useReaderNavigation();
  const navigationOpen = navigationMobile && openMobile;
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [selection, setSelection] = useState<OverlayEntry[]>([]);
  const [regionSelection, setRegionSelection] = useState<RegionSelection | null>(null);
  const [selectingRegion, setSelectingRegion] = useState(false);
  // Questions belong to the current private library document.
  const askSource = useMemo<AskSource>(
    () => ({ documentId }),
    [documentId],
  );
  const readingSpeech = useReadingSpeech(askSource, loadedAnalysisId, readingOptions.removeCitations);
  const prepareReading = useRef(readingSpeech.prepare);
  prepareReading.current = readingSpeech.prepare;
  const selectionCheckpoint = useRef<{ engine: TourEngine | null; playing: boolean } | null>(null);
  useEffect(() => {
    setRegionSelection(null);
    setSelectingRegion(false);
    selectionCheckpoint.current = null;
  }, [documentId]);
  const [currentPage, setCurrentPage] = useState(1);
  const currentPageRef = useRef(1);
  currentPageRef.current = currentPage;
  const [zoomPercent, setZoomPercent] = useState(100);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [manifestRefresh, setManifestRefresh] = useState(0);
  const restoredView = useRef(false);
  const savedPosition = useRef<ReaderState | null>(null);
  const loadedRef = useRef<Loaded | null>(null);
  const loadedAnalysisRef = useRef<string | undefined>(undefined);
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
    const accept = (result: Loaded, analysisId?: string) => {
      let value = result;
      if (!alive) {
        if (value.pdf !== loadedRef.current?.pdf) retirePdf(value.pdf);
        return;
      }
      const previous = loadedRef.current;
      const previousPdf = previous?.pdf;
      // The same analysis of the same PDF keeps its document and sizes, so that a tour arriving (the finished one, after
      // its first steps played) neither rebuilds the page layout nor the target lookup under the learner.
      if (
        previous?.doc && value.doc && previous.pdf === value.pdf && analysisId === loadedAnalysisRef.current &&
        previous.doc.source.sha256 === value.doc.source.sha256
      )
        value = { ...value, doc: previous.doc, sizes: previous.sizes };
      loadedRef.current = value;
      loadedAnalysisRef.current = analysisId;
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
            isTourGenerationActive(current.tourGeneration);
          if (!document.hidden && (working || needsRetry || Date.now() - lastPoll > 60_000)) void refresh();
        }, 4000)
      : undefined;
    return () => {
      alive = false;
      clearInterval(interval);
    };
  }, [documentId, documentId, activeTour, onBack, manifestRefresh]);

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

  // A tour still being written plays from its first steps. While its generation runs, the leading steps come from the
  // partial endpoint and the reader follows them; the finished tour comes through
  // the manifest and takes their place without a break.
  const generation = manifest?.tourGeneration ?? null;
  // A saved tour on screen is never taken over by one being written: the learner opens that one when it is done.
  const tourOnScreen = !!manifest?.selectedTour;
  const hasDoc = !!loaded?.doc;
  const generationId = generation?.id;
  const following = !!documentId && !!generationId && !tourOnScreen && hasDoc && isTourGenerationActive(generation);
  const source = useMemo<PartialSource | null>(() => {
    if (!following || !documentId || !generationId) return null;
    return {
      key: generationId,
      fetch: (held, signal) =>
        apiRequest<TourPartialView>(partialPath(documentId, generationId, held), { signal }),
    };
  }, [following, documentId, generationId]);
  const follow = usePartialTour(source, `${generation?.status}:${generation?.stage}`, () => {
    setManifestRefresh((value) => value + 1);
  });
  const status = currentStatus(generation?.status, follow.status);
  const finishedTour = loaded?.tour ?? null;
  const partialTour = useMemo(
    () => (tourOnScreen ? null : playablePartial(follow.held, loaded?.doc ?? null)),
    [tourOnScreen, follow.held, loaded?.doc],
  );
  const spokenDocument = useMemo(() => loaded?.doc ? readingTour(loaded.doc, readingOptions) : null, [loaded?.doc, readingOptions]);
  const tourSource: Tour | null = readAloud ? spokenDocument : finishedTour ?? partialTour;
  const fromPartial = !readAloud && !finishedTour && !!partialTour;
  const growth = fromPartial ? growthOf(follow.held, status) : null;
  const growing = !!growth && growth.phase !== 'stopped';
  const sourceKey = readAloud ? `reading:${loadedAnalysisId ?? documentId}|${readingOptions.removeCitations}|${readingOptions.includeReferences}` : tourSourceKey(manifest?.selectedTour?.id, !!finishedTour, generationId);

  // The tour says what the document is: a lecture plays as a deck, one slide at a time; anything else as a paper.
  const deck = useMemo(() => readerMode(tourSource, loaded?.sizes ?? []) === 'deck', [tourSource?.doc_type, loaded?.sizes]);
  const layout = useMemo(
    () => (loaded?.pdf && loaded.sizes.length ? (deck ? layoutDeck(loaded.sizes) : layoutPages(loaded.sizes)) : null),
    [loaded?.pdf, loaded?.sizes, deck],
  );
  // A deck shows one slide: the page the camera last went to.
  const [slide, setSlide] = useState(1);
  const slideRef = useRef(1);
  const slideNow = deck && layout ? clampSlide(slide, layout.pages.length) : undefined;
  // The chosen region snaps to the object inside it; a question about it carries the object's box once that is found.
  const regionSnap = useRegionSnap(askSource, regionSelection, (page) => layout?.pages[page - 1], loadedAnalysisId);
  const resolver = useMemo(() => (loaded ? new Resolver(loaded.doc, loaded.sizes) : null), [loaded?.doc, loaded?.sizes]);
  const prepared = useMemo(() => (tourSource && resolver ? prepareTour(tourSource, resolver) : null), [tourSource, resolver]);
  const problems = useMemo(() => [...(loaded?.problems ?? []), ...(prepared?.problems ?? [])], [loaded, prepared]);
  const debugPages = useMemo(() => (loaded?.doc ? debugIndex(loaded.doc) : new Map<number, DebugPage>()), [loaded]);

  // One narrator for the tour and its answers, so both speak with the same voice.
  const baseUrl = loaded?.baseUrl ?? '/';
  const narrator = useMemo(
    () => createNarrator({ baseUrl, muted, forceSilent: params.silent, voiceId: browserVoices.selectedVoiceId, speech: speech.data, cache: speech.cache,
      settingsError: documentId ? speech.error ?? (speech.loading && !speech.data ? 'Speech settings are loading. Press Play again when ready.' : undefined) : undefined }),
    [baseUrl, muted, params.silent, browserVoices.selectedVoiceId, documentId, speech.data, speech.cache, speech.error, speech.loading],
  );

  useEffect(() => () => narrator.dispose?.(), [narrator]);

  // A question sets the tour aside and its answer plays as a second tour on the same narrator, camera, pen and board;
  // the stage, the board and the control bar show whichever is playing, the sidebar always the tour.
  const [answer, setAnswer] = useState<TourEngine | null>(null);
  const [away, setAway] = useState<Away | null>(null);
  // "Not clear?": the step the choices are open for (the tour is held there), and whether it was playing.
  const [unclearAt, setUnclearAt] = useState<number | null>(null);
  const unclearHold = useRef<{ playing: boolean } | null>(null);
  const mainState = useSyncExternalStore(engine?.subscribe ?? noSubscribe, engine?.getState ?? idleState);
  const answerState = useSyncExternalStore(answer?.subscribe ?? noSubscribe, answer?.getState ?? idleState);
  const state = answer ? answerState : mainState;
  const reduceMotion = useReducedMotion();
  useEffect(() => {
    setNarrationSoundGate(state.status === 'playing');
    return () => setNarrationSoundGate(false);
  }, [state.status]);
  const active = answer ?? engine;
  const applySpeechPreferences = useCallback(async (preferences: SpeechPreferences) => {
    if (speechUpdating.current) return;
    speechUpdating.current = true;
    active?.pause(); setSpeechUpdateError(null); setSpeechUpdatePending(true);
    try { await speech.update(preferences); }
    catch (error) {
      setSpeechUpdateError(error instanceof Error ? error.message : 'Could not save speech settings.');
      throw error;
    } finally { speechUpdating.current = false; setSpeechUpdatePending(false); }
  }, [active, speech.update]);
  useEffect(() => {
    if (!active || state.status !== 'playing' || state.speechStatus !== 'playing' || !narrator.preload) return;
    // Prime the next passage during the penultimate clip, giving short final phrases
    // enough lead time. At most two upcoming clips are prepared across the step boundary.
    const chunks = audioChunks(active.steps[state.index]?.words ?? []);
    const lookahead = chunks.at(-2) ?? chunks[0];
    if (lookahead && state.word < lookahead.start) return;
    const next = active.steps[state.index + 1];
    if (!next) return;
    // Reuse a prepared read-aloud script, never start a language-model call for audio lookahead.
    const prepared = readAloud && !answer ? readingSpeech.cached(next.step) : undefined;
    if (readAloud && !answer && !prepared) return;
    const text = prepared?.speech ?? next.step.say;
    void narrator.preload({ text, words: text.trim().split(/\s+/), speaker: next.step.speaker ?? 'host',
      voice: prepared?.language ? { ...active.tour.voices?.[next.step.speaker ?? 'host'], lang: prepared.language } : active.tour.voices?.[next.step.speaker ?? 'host'], rate: speed * params.rate }).catch(() => {});
  }, [active, answer, narrator, readAloud, readingSpeech.cached, state.status, state.speechStatus, state.index, state.word, speed, params.rate]);

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

  // Which mark the voice is on. The list of keys is kept as long as it holds the same keys, so a word that does
  // not change it re-renders no page.
  const playback = markPlayback(state, active?.steps ?? []);
  const currentKey = playback.current?.join('|') ?? null;
  const currentMarks = useMemo(() => (currentKey === null ? null : currentKey.split('|')), [currentKey]);
  const marks = useMemo(() => ({ current: currentMarks, sweep: playback.sweep }), [currentMarks, playback.sweep]);

  // Camera: frame the engine's current camera command; re-frame instantly on resize.
  // `framed` is the last command and the view chosen for it, so a resize can frame it again.
  const framed = useRef<{ cmd: CameraCommand; view: View; fitWidth?: boolean; rect?: BBox } | null>(null);
  const fitSourceWidth = useRef(false);
  fitSourceWidth.current = !!state.board.item;
  const frame = useCallback(
    (cmd: CameraCommand, instant: boolean, retarget = false) => {
      if (!layout || !resolver) return;
      // A target that cannot be framed leaves the camera where it is; it must not take the app down.
      try {
        const vp = camera.viewport;
        const fitWidth = retarget ? fitSourceWidth.current || !!framed.current?.fitWidth : fitSourceWidth.current;
        // Targets are framed above the ask dock, together with the other marks the step shows meanwhile. In a deck a
        // target is framed as its whole slide.
        const target = cmd.action
          ? frameFor(cmd.action, resolver, layout, vp, { fitWidth, insets: camera.insets, also: cmd.also, slide: layout.deck, maxZoom: maxAutoZoom })
          : null;
        // Before any camera move a deck shows its first slide whole, a paper the top of its first page.
        const first = layout.pages[0];
        const rect: BBox | undefined = target?.rect ?? (layout.deck && first ? [first.x, first.y, first.x + first.width, first.y + first.height] : undefined);
        const view = cmd.action ? target?.view : layout.deck && first ? slideView(first, layout, vp, camera.insets, maxAutoZoom) : initialView(layout, vp, camera.insets, maxAutoZoom);
        if (!view) return;
        if (layout.deck) {
          slideRef.current = cmd.action ? (target?.page ?? 1) : 1;
          setSlide(slideRef.current);
        }
        if (instant) camera.jumpTo(view);
        else if (retarget) camera.retargetTo(view);
        else camera.animateTo(view);
        framed.current = { cmd, view: camera.targetView, fitWidth, rect };
      } catch (err) {
        console.warn('[camera] could not frame', cmd.action, err);
      }
    },
    [camera, layout, resolver, maxAutoZoom],
  );
  // The engine plays the tour. While the tour is written it grows in place (TourEngine.extend), so the learner's place,
  // the camera and the board stay as they are. Only another tour (one written again with other steps, or one picked from
  // the saved ones) gets an engine of its own; a learner who was in the old one's lineage stays on the step they were on.
  // Which is which is decided by where the tour comes from (growsInPlace), not by its step IDs.
  const handle = useRef<{ engine: TourEngine; unsubscribe(): void; partial: boolean; key: string } | null>(null);
  // The saved tour the learner just picked: when it arrives it replaces what plays, even a tour being written.
  const picked = useRef<string | null>(null);
  const carry = useRef<{ stepId: string; playing: boolean; after: boolean } | null>(null);
  const [incoming, setIncoming] = useState<{ prepared: Prepared; growing: boolean; partial: boolean; key: string } | null>(
    null,
  );
  const adopt = useCallback(
    (next: Prepared, open: boolean, partial: boolean, key: string) => {
      const held = handle.current;
      const e = new TourEngine(next.tour, {
        narrator: new SilentNarrator(),
        fallbackNarrator: new SilentNarrator(),
        beforeNarration: (signal) => camera.whenSettled(signal),
        ...(key.startsWith('reading:') ? { prepareNarration: (step: Step, signal: AbortSignal) => prepareReading.current(step, signal) } : {}),
        open,
      });
      // Dispatch camera commands synchronously, before narration waits for the flight.
      // A React effect would start the animation only after speech has already begun.
      let lastCamera = 0;
      const unsubscribe = e.subscribe(() => {
        const command = e.getState().camera;
        if (command.seq === lastCamera) return;
        lastCamera = command.seq;
        now.current.frame(command, false);
      });
      if (held) {
        const was = held.engine.getState();
        if (was.status !== 'idle') playbackPlaces.current.set(held.key.split('|')[0], held.engine.steps[was.index]?.step.id ?? '');
        carry.current =
          held.partial && !key.startsWith('reading:') && was.status !== 'idle'
            ? {
                stepId: held.engine.steps[was.index]?.step.id ?? '',
                playing: was.status === 'playing',
                after: !!was.waiting || was.status === 'ended',
              }
            : null;
        held.unsubscribe();
        held.engine.destroy();
      }
      handle.current = { engine: e, unsubscribe, partial, key };
      setEngine(e);
    },
    [camera],
  );
  useEffect(() => {
    const held = handle.current;
    if (!prepared) {
      setIncoming(null);
      if (held) {
        held.unsubscribe();
        held.engine.destroy();
        handle.current = null;
        setEngine(null);
      }
      return;
    }
    const chosen = picked.current !== null && sourceKey === tourSourceKey(picked.current, true, null);
    if (chosen) picked.current = null;
    if (held && growsInPlace(held, sourceKey, chosen) && held.engine.extend(prepared.tour, growing)) {
      held.partial = fromPartial;
      held.key = sourceKey;
      setIncoming(null);
      return;
    }
    // A tour written again with other steps than the ones that play: what plays goes on to its end, and then the new one
    // takes over. Any other tour (one picked from the saved ones) replaces it at once.
    const playing = held?.engine.getState();
    if (!chosen && held?.partial && playing?.status === 'playing' && !playing.waiting) {
      held.engine.close();
      setIncoming({ prepared, growing, partial: fromPartial, key: sourceKey });
      return;
    }
    adopt(prepared, growing, fromPartial, sourceKey);
    if (held?.partial && !chosen)
      setToast((t) => ({ text: 'The tour was written again; this is the new version', n: (t?.n ?? 0) + 1 }));
  }, [prepared, growing, fromPartial, sourceKey, adopt]);
  useEffect(() => {
    if (!incoming || (mainState.status === 'playing' && !mainState.waiting)) return;
    setIncoming(null);
    adopt(incoming.prepared, incoming.growing, incoming.partial, incoming.key);
    setToast((t) => ({ text: 'The tour was written again; this is the new version', n: (t?.n ?? 0) + 1 }));
  }, [incoming, mainState.status, mainState.waiting, adopt]);
  useEffect(
    () => () => {
      const held = handle.current;
      handle.current = null;
      held?.unsubscribe();
      held?.engine.destroy();
    },
    [],
  );
  useEffect(() => engine?.setNarrator(narrator), [engine, narrator]);
  useEffect(() => engine?.setRate(speed * params.rate), [engine, speed, params.rate]);
  useEffect(() => answer?.setNarrator(narrator), [answer, narrator]);
  useEffect(() => answer?.setRate(speed * params.rate), [answer, speed, params.rate]);

  // The latest of what the ask handlers read, since an answer arrives after the reader has rendered again.
  const now = useRef({ engine, answer, away, prepared, resolver, frame, narrator, rate: speed * params.rate });
  now.current = { engine, answer, away, prepared, resolver, frame, narrator, rate: speed * params.rate };

  // The answer that is still being written, so that its next steps join the engine that plays it.
  const writing = useRef<{ question: string; engine: TourEngine } | null>(null);
  const visualDraft = useRef<{ engine: TourEngine; key: string | null; item: BoardItem } | null>(null);
  useEffect(() => {
    const changed = (event: Event) => {
      const current = now.current.answer ?? now.current.engine;
      const board = current?.getState().board;
      const item = (event as CustomEvent<{ item?: BoardItem }>).detail?.item;
      if (current && board?.item && item?.kind === board.item.kind)
        visualDraft.current = { engine: current, key: board.key, item };
    };
    window.addEventListener('paper-tour:visual-revision', changed);
    return () => window.removeEventListener('paper-tour:visual-revision', changed);
  }, []);
  const dropAnswer = useCallback(() => {
    now.current.answer?.destroy();
    now.current.answer = null;
    writing.current = null;
    setAnswer(null);
  }, []);
  // A new tour (or none) ends any answer about the old one. A tour that only grows keeps it.
  useEffect(() => {
    dropAnswer();
    setAway(null);
    unclearHold.current = null;
    setUnclearAt(null);
  }, [engine, dropAnswer]);
  useEffect(() => () => now.current.answer?.destroy(), []);

  /** Where the learner is: the tour step, and the figure, panel or equation the camera still shows. */
  const askContext = useCallback((): AskContext => {
    const { engine: main, resolver: ids } = now.current;
    const tour = main?.getState();
    const last = framed.current;
    const shown = last && camera.targetView === last.view ? last.cmd.action : null;
    const visualEngine = now.current.answer ?? main;
    const board = visualEngine?.getState().board;
    const draft = visualDraft.current;
    return {
      stepId: !readAloud && tour && tour.status !== 'idle' ? main?.steps[tour.index]?.step.id : undefined,
      figureId: !regionSelection && ids ? visualShown(shown, (id) => ids.kind(id)) : undefined,
      selection: regionSnap.region ?? undefined,
      analysisId: loadedAnalysisId,
      page: currentPageRef.current,
      activeVisual: draft?.engine === visualEngine && draft?.key === board?.key ? draft?.item : board?.item ?? undefined,
      ...(board?.artifact ? { visualId: board.artifact.id, visualRevision: board.artifact.revision } : {}),
    };
  }, [camera, regionSelection, regionSnap.region, loadedAnalysisId, readAloud]);

  // A question pauses whatever plays; the first one of a conversation remembers where the tour was.
  const setAside = useCallback(() => {
    const { engine: main, answer: playing, away: was } = now.current;
    const regionCheckpoint = selectionCheckpoint.current;
    selectionCheckpoint.current = null;
    // "Not clear?" holds the tour while it is open; a question asked from it goes on from where the tour was playing.
    const held = unclearHold.current;
    unclearHold.current = null;
    setUnclearAt(null);
    setSelectingRegion(false);
    playing?.pause();
    if (!was) {
      const last = framed.current;
      const next: Away = {
        framed: last && camera.targetView === last.view ? last : null,
        view: camera.targetView,
        playing:
          main?.getState().status === 'playing' ||
          (regionCheckpoint?.engine === main && regionCheckpoint.playing) ||
          !!held?.playing,
      };
      now.current.away = next;
      setAway(next);
    }
    main?.pause();
  }, [camera]);

  const playAnswer = useCallback(
    (reply: AskAnswer, question: string, open: boolean) => {
      const { engine: main, prepared: tour, resolver: ids, narrator: voice, rate } = now.current;
      if (!ids) return;
      const speaker = main?.steps[main.getState().index]?.step.speaker;
      const script = prepareTour(answerTour(reply, question, tour?.tour ?? null, speaker), ids).tour;
      const held = writing.current;
      if (held && now.current.answer === held.engine && held.question === question) {
        // The next steps of the answer being played: it goes on with them, and ends after the last one once it is whole.
        held.engine.extend(script, open);
        if (!open) writing.current = null;
        return;
      }
      dropAnswer();
      // Also when a new tour arrived meanwhile or the learner pressed play: an answer always has a way back.
      setAside();
      const e = new TourEngine(script, {
        narrator: voice,
        fallbackNarrator: new SilentNarrator(),
        rate,
        beforeNarration: (signal) => camera.whenSettled(signal),
        open,
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
      writing.current = open ? { question, engine: e } : null;
      setAnswer(e);
      setSelection([]);
      e.play();
    },
    [camera, dropAnswer, setAside],
  );
  const onAnswer = useCallback((reply: AskAnswer, question: string) => playAnswer(reply, question, false), [playAnswer]);

  // Back to the tour: the answer goes, and the tour returns as it was: its marks and board (it only paused), the
  // camera on what it showed. The explicit return button resumes a tour that was playing before the question.
  const backToTour = useCallback(() => {
    const { engine: main, away: was, frame: show } = now.current;
    dropAnswer();
    setRegionSelection(null);
    now.current.away = null;
    setAway(null);
    if (!was) return;
    if (was.framed) show(was.framed.cmd, false);
    else {
      framed.current = null;
      camera.animateTo(was.view);
    }
    if (was.playing) main?.play();
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
      if (layout.deck) {
        // A deck comes back on the slide it was left on, shown whole.
        const page = clampSlide(savedPosition.current?.page ?? 1, layout.pages.length);
        frame({ seq: 0, key: null, action: page > 1 ? { type: 'focus', target: `page${page}` } : null }, true);
      } else camera.jumpTo(viewFromPosition(layout, camera.viewport, savedPosition.current, camera.insets));
      return;
    }
    // While the camera still shows the target it last framed, the new size (the board opening or
    // closing, a window resize) frames that target again, so it stays whole and in view. Otherwise
    // reflow preserves the page-relative reading position, including restored/manual navigation.
    const last = framed.current;
    if (last && camera.targetView === last.view) frame(last.cmd, !camera.animating, true);
    else if (!layout.deck && (fitSourceWidth.current || last?.fitWidth)) {
      const view = fitWidthView(camera.targetView, layout, camera.viewport, camera.insets);
      if (camera.animating) camera.retargetTo(view);
      else camera.jumpTo(view);
    } else camera.jumpTo(camera.getView());
  }, [camera, layout, frame]);

  // A chosen region stays in view above the ask dock, which opens over the bottom of the stage as it is chosen.
  const revealRegion = useCallback(() => {
    const page = layout && regionSelection && layout.pages[regionSelection.page - 1];
    if (!layout || !regionSelection || !page) return false;
    const [x0, y0, x1, y1] = regionSelection.rect;
    const rect: BBox = [page.x + x0 * page.width, page.y + y0 * page.height, page.x + x1 * page.width, page.y + y1 * page.height];
    const view = revealView(rect, camera.targetView, layout, camera.viewport, camera.insets);
    if (view) camera.animateTo(view);
    return true;
  }, [camera, layout, regionSelection]);
  useEffect(() => {
    revealRegion();
  }, [revealRegion]);

  // The ask dock grew over the stage (the learner opened it, an answer began): when it now covers part of
  // what the camera shows, frame that again above it. A dock that shrinks again leaves the view alone.
  const onInsetsChange = useCallback(() => {
    if (revealRegion()) return;
    const last = framed.current;
    if (!layout || !restoredView.current || !last?.rect || camera.targetView !== last.view) return;
    const { bottom } = camera.insets;
    const shown = project(last.rect, last.view, camera.viewport);
    if (shown.bottom <= camera.viewport.height - bottom + 1) return;
    frame(last.cmd, false, camera.animating);
  }, [camera, layout, frame, revealRegion]);

  // The cover shows before the first play; the end card after the last step. `restored` is the step a saved place brought
  // the tour to, so the cover can offer to continue there.
  const [coverGone, setCoverGone] = useState(false);
  const [restored, setRestored] = useState<number | null>(null);
  const [endGone, setEndGone] = useState(false);
  const [asked, setAsked] = useState<string[]>([]);
  const [askRequest, setAskRequest] = useState<{ id: number; question: string } | null>(null);
  useEffect(() => {
    if (!engine) return;
    setCoverGone(false);
    setEndGone(false);
    // The tour was written again: the learner stays on the step they were on, or goes on after it.
    const carried = carry.current;
    carry.current = null;
    const found = carried?.stepId ? engine.steps.findIndex((step) => step.step.id === carried.stepId) : -1;
    if (carried && found >= 0) {
      const index = carried.after && found + 1 < engine.steps.length ? found + 1 : found;
      engine.goTo(index);
      if (carried.playing) engine.play();
      setCoverGone(true);
      setRestored(null);
      return;
    }
    setAsked([]);
    let at: number | null = null;
    const remembered = playbackPlaces.current.get(handle.current?.key.split('|')[0] ?? '');
    if (remembered) {
      const index = engine.steps.findIndex((s) => s.step.id === remembered);
      if (index >= 0) { engine.goTo(index); setRestored(index); return; }
    }
    if (readAloud && loaded?.doc) {
      const index = readingStepOnPage(engine.tour, loaded.doc, currentPageRef.current);
      engine.goTo(index);
      setCoverGone(true);
      setRestored(index);
      return;
    }
    const saved = savedPosition.current;
    // A place saved in a tour still being written has no tour of its own yet.
    if (saved?.stepId && (saved.tourId === null || saved.tourId === (manifestRef.current?.selectedTour?.id ?? null))) {
      const index = engine.steps.findIndex((step) => step.step.id === saved.stepId);
      if (index >= 0) {
        engine.goTo(index);
        at = index;
      }
    }
    setRestored(at);
  }, [engine]);
  // Run after restoring the reading position. Entering the mode is enough; speech need not have started.
  useEffect(() => {
    const preparing = readAloud && !answer && engine && handle.current?.engine === engine
      && handle.current.key === sourceKey && engine.getState().status !== 'ended';
    const index = engine?.getState().index ?? 0;
    readingSpeech.plan(preparing ? engine.steps[index]?.step ?? null : null,
      preparing ? engine.steps.slice(index + 1).map((s) => s.step) : [], !!preparing);
  }, [readAloud, answer, engine, sourceKey, mainState.index, mainState.status, readingSpeech.plan]);
  // The first steps of a tour still being written open the tour's side of the reader, unless the learner is searching.
  const openedGrowing = useRef(false);
  useEffect(() => {
    if (!engine || !fromPartial || openedGrowing.current) return;
    openedGrowing.current = true;
    if (!query.trim()) setTab('tour');
  }, [engine, fromPartial, query]);
  useEffect(() => {
    if (mainState.status === 'playing') setCoverGone(true);
    if (mainState.status !== 'ended') setEndGone(false);
  }, [mainState.status]);

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
  const pendingSave = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const tourCheckpoint = useRef({
    tourId: selectedTourId,
    stepId: mainState.status === 'idle' ? null : (engine?.steps[mainState.index]?.step.id ?? null),
  });
  if (!readAloud && !handle.current?.key.startsWith('reading:')) guidedCheckpoint.current = {
    tourId: selectedTourId,
    stepId: mainState.status === 'idle' ? null : (engine?.steps[mainState.index]?.step.id ?? null),
  };
  tourCheckpoint.current = readAloud ? guidedCheckpoint.current : { ...guidedCheckpoint.current };
  useEffect(() => {
    if (!layout) return;
    const update = () => {
      setZoomPercent(Math.round(camera.getView().s * 100));
      const position = positionFromView(layout, camera.getView(), slideRef.current);
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
    const value = { ...positionFromView(layout, camera.getView(), slideRef.current), ...tourCheckpoint.current };
    checkpointRef.current = value;
    clearTimeout(pendingSave.current);
    pendingSave.current = setTimeout(() => void saveRef.current(value), 1000);
  }, [mainState.index, mainState.status, selectedTourId, layout, camera]);
  // A slide change moves nothing on the stage, so the camera never settles on it: the counter and the saved place follow it here.
  useEffect(() => {
    if (!layout?.deck || slideNow === undefined) return;
    setCurrentPage(slideNow);
    if (!restoredView.current || now.current.away) return;
    const value = { ...positionFromView(layout, camera.getView(), slideNow), ...tourCheckpoint.current };
    checkpointRef.current = value;
    clearTimeout(pendingSave.current);
    pendingSave.current = setTimeout(() => void saveRef.current(value), 1000);
  }, [layout, camera, slideNow]);
  // The tour arrived and says how to read the document (a deck, or a paper): frame where the learner is in that layout.
  const shownAs = useRef(deck);
  useEffect(() => {
    if (shownAs.current === deck) return;
    shownAs.current = deck;
    if (!layout || !restoredView.current) return;
    framed.current = null;
    if (deck) {
      const page = clampSlide(currentPageRef.current, layout.pages.length);
      frame({ seq: 0, key: null, action: page > 1 ? { type: 'focus', target: `page${page}` } : null }, true);
    } else {
      const saved = { page: slideRef.current, pageOffset: 0, zoom: null, tourId: null, stepId: null };
      camera.jumpTo(viewFromPosition(layout, camera.viewport, saved, camera.insets));
    }
  }, [deck, layout, camera, frame]);
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
      if (readAloud && loaded?.doc && engine) {
        leaveAnswer();
        const block = loaded.doc.sections.find((s) => s.id === id)?.block
          ?? loaded.doc.sentences.find((s) => s.id === id)?.block ?? id;
        const index = readingStepForTarget(engine.tour, loaded.doc, block);
        if (index >= 0) engine.goTo(index);
      }
      const action = { type: 'focus' as const, target: id };
      frame({ seq: 1, key: id, action }, false);
      const overlay =
        kind === 'sentence' || kind === 'block'
          ? { type: 'highlight' as const, targets: [id], color: 'blue' as const }
          : { type: 'box' as const, target: id, color: 'blue' as const };
      setSelection([{ key: `selection:${id}`, step: -1, action: overlay, persist: false }]);
    },
    [resolver, layout, active, frame, readAloud, loaded?.doc, engine, leaveAnswer],
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
                    ref: { documentId: documentId, analysisId: manifest?.docAnalysisId ?? '', elementId: sentence.id },
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
  }, [query, loaded?.doc, documentId, manifest?.docAnalysisId]);

  useEffect(() => () => camera.destroy(), [camera]);

  // "Not clear?" is offered on a step of the tour that is under way: not before it starts, after it ends, while the
  // learner is asked to try, or while a question has set it aside. Opening it holds the tour on the step; Escape goes on
  // from there, and a choice asks about the step through the ask flow, so its answer plays as a short tour and "Back to
  // the tour" returns to the step.
  const canUnclear = !readAloud && unclearOffered({
    asking: !!loaded?.doc && !!engine,
    status: mainState.status,
    awaiting: mainState.awaiting,
    aside: !!answer || !!away || selectingRegion,
  });
  const openUnclear = useCallback(() => {
    const { engine: main } = now.current;
    if (!main || main.getState().status === 'idle') return;
    unclearHold.current = { playing: main.getState().status === 'playing' };
    main.pause();
    setUnclearAt(main.getState().index);
  }, []);
  const closeUnclear = useCallback((resume: boolean) => {
    const held = unclearHold.current;
    unclearHold.current = null;
    setUnclearAt(null);
    const { engine: main, answer: playing, away: aside } = now.current;
    if (resume && held?.playing && main && !playing && !aside) main.play();
  }, []);
  const chooseUnclear = useCallback(
    (kind: Unclear) => {
      const { engine: main } = now.current;
      const here = main?.steps[main.getState().index];
      if (!here) return closeUnclear(false);
      setUnclearAt(null);
      // The hold stays: asking sets the tour aside and remembers whether it was playing.
      setAskRequest((last) => ({ id: (last?.id ?? 0) + 1, question: unclearQuestion(kind, here.step.say) }));
    },
    [closeUnclear],
  );
  // The learner moved on (played, picked a step, asked something else, a new tour): the choices go without a say.
  useEffect(() => {
    if (unclearAt === null) return;
    if (canUnclear && mainState.status === 'paused' && mainState.index === unclearAt) return;
    unclearHold.current = null;
    setUnclearAt(null);
  }, [unclearAt, canUnclear, mainState.status, mainState.index]);

  // The last step of a finished tour asks for the answers to its suggested questions in the background (AskPanel keeps
  // them), so that picking one plays at once; the end card marks the ones that are ready.
  const [readyQuestions, setReadyQuestions] = useState<string[]>([]);
  const onReady = useCallback(
    (list: string[]) => setReadyQuestions((was) => (was.join('\n') === list.join('\n') ? was : list)),
    [],
  );
  const prefetchOn = prefetchWanted({
    finished: !readAloud && !!loaded?.doc && !!engine && !growing && !fromPartial,
    steps: engine?.steps.length ?? 0,
    index: mainState.index,
    status: mainState.status,
    preview: mainState.preview,
    aside: !!answer || !!away || selectingRegion || !!regionSelection,
  });
  const prefetchQuestions = useMemo(
    () => (prefetchOn && engine ? openQuestions(engine.tour.suggested_questions, asked) : []),
    [prefetchOn, engine, asked],
  );

  // Keyboard (keys.ts): Space plays and pauses, the arrows step (Shift: by sentence), [ and ] jump chapters, R replays the
  // sentence, U asks "Not clear?". They steer an answer while one plays. Nothing fires while the learner types, and a focused button keeps only
  // Space and Enter, so the arrows work after a click on Play.
  const [helpOpen, setHelpOpen] = useState(false);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && (navigationOpen || helpOpen)) {
        setNavigationOpen(false);
        setHelpOpen(false);
        return;
      }
      // The choices of "Not clear?" hold the tour on its step: only they (and Escape) act while they are open.
      if (e.defaultPrevented || selectingRegion || unclearAt !== null || e.altKey || e.ctrlKey || e.metaKey) return;
      if (keyBelongsTo(e.target as KeyTarget | null, e.key)) return;
      const command = keyCommand(e.key, e.shiftKey);
      if (!command) return;
      e.preventDefault();
      const tour = active;
      if (command === 'unclear') {
        if (canUnclear) openUnclear();
      } else if (command === 'ids') setDebug((d) => !d);
      else if (command === 'mute') setMuted((m) => !m);
      else if (command === 'help') setHelpOpen((open) => !open);
      else if (tour) {
        const here = tour.getState();
        if (command === 'toggle') tour.toggle();
        else if (command === 'next') tour.next();
        else if (command === 'prev') tour.prev();
        else if (command === 'nextSentence') tour.skip(1);
        else if (command === 'prevSentence') tour.skip(-1);
        else if (command === 'nextChapter') tour.goTo(tour.chapterStart(1));
        else if (command === 'prevChapter') tour.goTo(tour.chapterStart(-1));
        else if (command === 'first') tour.goTo(0);
        else if (command === 'last') tour.goTo(tour.total - 1);
        else if (command === 'replay') {
          tour.seekTo(here.index, Math.max(0, here.word));
          tour.play();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, navigationOpen, helpOpen, selectingRegion, unclearAt, canUnclear, openUnclear]);

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
    const title =
      tourSource?.title?.trim() ||
      readerTitle({ doc: loaded?.doc?.source.title, file: manifest?.document.originalFilename ?? loaded?.doc?.source.file });
    if (title) document.title = `${title} · Paper Tour`;
  }, [loaded, tourSource?.title, manifest?.document.originalFilename]);

  // A chapter chip names the chapter the tour has just entered; it stays a moment, then goes.
  const [chip, setChip] = useState<{ number: number; title: string } | null>(null);
  const lastChapter = useRef<number | null>(null);
  useEffect(() => {
    lastChapter.current = null;
    setChip(null);
  }, [engine]);
  useEffect(() => {
    const entered = engine?.steps[mainState.index];
    if (!engine || answer || !entered || mainState.status !== 'playing' || lastChapter.current === entered.chapterIndex) return;
    lastChapter.current = entered.chapterIndex;
    setChip({ number: entered.chapterIndex + 1, title: engine.tour.chapters[entered.chapterIndex]?.title ?? '' });
  }, [engine, answer, mainState.index, mainState.status]);
  useEffect(() => {
    if (!chip) return;
    const timer = setTimeout(() => setChip(null), 2800);
    return () => clearTimeout(timer);
  }, [chip]);

  // The time the steps still to be written are expected to take shows on the timeline as a stretch of its own.
  const pending = growing && !answer ? Math.max(1, (growth?.planned ?? 0) - (engine?.steps.length ?? 0)) : 0;
  // The learner can play what the engine holds, which after a retry can be more than the new attempt has written so far.
  const playable = withPlayableSteps(growth, engine?.steps.length ?? 0);
  const clock = useMemo(
    () => (active ? buildClock(active.steps, { rate: speed * params.rate, voices: active.tour.voices, pending }) : null),
    [active, state.revision, speed, params.rate, pending],
  );

  const cardState = { hasTour: !!engine, status: mainState.status, index: mainState.index, preview: mainState.preview, restored, aside: !!answer || !!away };
  const coverOpen = !readAloud && coverVisible({ ...cardState, dismissed: coverGone });
  const endOpen = !readAloud && recapVisible({ ...cardState, dismissed: endGone });
  // A step that asks the learner to try first: its card shows while the tour waits.
  const coachStep = state.awaiting ? active?.steps[state.index] : undefined;
  const restoreConversationContext = useCallback(
    (context: ConversationContext) => {
      if (context.analysisId && context.analysisId !== loadedAnalysisId)
        throw new ApiRequestError(
          'This conversation uses another document analysis. Open its original saved tour before replaying the explanation.',
          409,
          'conversation_analysis_mismatch',
        );
      setAside();
      setRegionSelection(context.selection ?? null);
      setSelection([]);
      const page = context.page ?? context.selection?.page;
      if (page && layout) {
        framed.current = null;
        camera.jumpTo(
          viewFromPosition(
            layout,
            camera.viewport,
            { page: clampSlide(page, layout.pages.length), pageOffset: 0, zoom: null, tourId: null, stepId: null },
            camera.insets,
          ),
        );
      }
    },
    [loadedAnalysisId, setAside, layout, camera],
  );

  const onAsked = useCallback(
    (question: string) => {
      if (question) setAsked((list) => [...list, question]);
      setAside();
    },
    [setAside],
  );

  const errors = problems.filter((p) => p.level === 'error');
  const steps = engine?.steps ?? [];
  // A deck's slides, with the tour's steps on each (the filmstrip's dots), and the one step the tour is on.
  const slidesOfSteps = useMemo(
    () => (deck && engine && resolver ? stepSlides(engine.steps, resolver) : []),
    [deck, engine, resolver, mainState.revision],
  );
  const stepsOn = useMemo(() => stepsBySlide(slidesOfSteps), [slidesOfSteps]);
  const tourStep = mainState.status === 'idle' ? null : mainState.index;
  // The slide the tour goes to next is drawn ahead, so the change to it finds it ready.
  const ahead = useMemo(() => {
    const next = slidesOfSteps[(tourStep ?? -1) + 1];
    return next === undefined ? [] : [next];
  }, [slidesOfSteps, tourStep]);
  // A slide picked in the deck: the tour goes to the first step there, or the slide is just shown.
  const pickSlide = (page: number) => {
    if (!layout) return;
    const n = clampSlide(page, layout.pages.length);
    setSelection([]);
    leaveAnswer();
    const first = stepsOn.get(n)?.[0];
    if (engine && first !== undefined) return engine.goTo(first);
    engine?.pause();
    frame({ seq: 1, key: `page${n}`, action: { type: 'focus', target: `page${n}` } }, false);
  };
  const goPage = (page: number) => {
    if (!layout) return;
    if (readAloud && engine && loaded?.doc) {
      leaveAnswer();
      engine.pause();
      engine.goTo(readingStepOnPage(engine.tour, loaded.doc, page));
      return;
    }
    if (layout.deck) return pickSlide(page);
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
            <button data-sidebar="menu-button" className="reader-outline-item" key={section.id} onClick={() => navigateTo(section.id)}>
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
        <ReaderNavigationToggle />
        <div className="reader-tour-actions">
          {' '}
          {documentId && manifest && (manifest.tourGeneration || !manifest.tours.length) && (
            <TourGeneration
              documentId={documentId}
              generation={manifest.tourGeneration}
              promptOnOpen={!readAloud && !manifest.tours.length}
              canGenerate={!!manifest.doc && manifest.document.fileStatus === 'uploaded'}
              onChanged={() => setManifestRefresh((value) => value + 1)}
              onOpenTour={
                tab === 'document'
                  ? (tourId) => {
                      leaveAnswer();
                      engine?.pause();
                      setSelection([]);
                      if (tourId !== manifest.selectedTour?.id) picked.current = tourId;
                      setReadAloud(false);
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
      <ReaderNavigation>
      <Sidebar
        tour={tab === 'tour' ? (engine?.tour ?? null) : null}
        steps={steps}
        state={mainState}
        growth={playable}
        docTitle={readerTitle({
          doc: manifest?.document.title ?? loaded?.doc?.source.title,
          tour: tourSource?.title,
          file: manifest?.document.originalFilename ?? loaded?.doc?.source.file,
        })}
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
                {tab === 'document' && <motion.span className="ui-reader-tab-indicator" layoutId="reader-active-tab" transition={reduceMotion ? { duration: 0 } : UI_SPRING} />}
                Document
              </button>
              <button
                disabled={!prepared?.tour}
                className={tab === 'tour' ? 'active' : ''}
                onClick={() => { setReadAloud(false); setTab('tour'); }}
              >
                {tab === 'tour' && <motion.span className="ui-reader-tab-indicator" layoutId="reader-active-tab" transition={reduceMotion ? { duration: 0 } : UI_SPRING} />}
                Tour
              </button>
            </div>
            {!readAloud && (manifest?.tours.length ?? 0) > 1 && manifest && (
              <label className="reader-tour-picker">
                Saved tour
                <ChoicePicker label="Saved tour" value={manifest.selectedTour?.id ?? ''}
                  options={[
                    { value: '', label: 'Select a tour', disabled: true },
                    ...manifest.tours.map((tour, index) => ({ value: tour.id, label: `${manifest.tours.length > 1 ? `v${manifest.tours.length - index} · ` : ''}${tour.title}`,
                      detail: tour.profile ? `${tour.profile.name} · ${tour.profile.depth}` : undefined })),
                  ]} onChange={(id) => {
                    leaveAnswer(); engine?.pause(); setSelection([]); savedPosition.current = null;
                    picked.current = id; setReadAloud(false); setActiveTour(id); setTab('tour');
                  }} />
              </label>
            )}
          </>
        }
        navigation={tab === 'document' ? documentNavigation : undefined}
      >
        {loaded && <Problems problems={problems} defaultOpen />}
      </Sidebar>
      </ReaderNavigation>

      <main className="main">
        <div className="reader-toolbar">
          <button
            disabled={!layout || currentPage <= 1}
            onClick={() => goPage(currentPage - 1)}
            aria-label={deck ? 'Previous slide' : 'Previous page'}
          >
            ‹
          </button>
          <label>
            {deck ? 'Slide' : 'Page'}{' '}
            <input
              aria-label={deck ? 'Slide number' : 'Page number'}
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
            aria-label={deck ? 'Next slide' : 'Next page'}
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
              // A deck fits the whole slide; a paper, its width.
              if (layout.deck) return frame({ seq: 0, key: null, action: { type: 'focus', target: `page${currentPage}` } }, false);
              const p = layout.pages[currentPage - 1];
              if (p)
                camera.animateTo({
                  ...camera.getView(),
                  cx: p.x + p.width / 2,
                  s: readingScale(p.width, camera.viewport),
                });
            }}
          >
            {deck ? 'Fit slide' : 'Fit width'}
          </button>
          {!!selection.length && <button onClick={() => setSelection([])}>Clear selection</button>}
          {manifest?.analysis && manifest.analysis.status !== 'ready' && (
            <span className="reader-status" role="status"><StatusBadge
              label={manifest.analysis.status === 'processing' ? 'Analyzing…' : manifest.analysis.status === 'queued' ? 'Analysis queued' : manifest.analysis.status === 'limited' ? 'Analysis notes' : 'Analysis failed'}
              tone={manifest.analysis.status === 'failed' ? 'failed' : manifest.analysis.status === 'limited' ? 'limited' : 'pending'}
              busy={manifest.analysis.status === 'processing'} detail={manifest.analysis.warnings.join('\n') || undefined} />
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
          <button className={`reader-reading-toggle${readAloud ? ' active' : ''}`} aria-pressed={readAloud}
            disabled={!loaded?.doc} onClick={() => {
              leaveAnswer(); engine?.pause(); setSelection([]);
              setReadAloud((reading) => !reading); setTab('document');
            }} title={readAloud ? 'Return to the guided tour' : 'Read the original paper aloud'}>
            {readAloud ? 'Exit read aloud' : 'Read aloud'}
          </button>
          {chip && (
            <div className="chapter-chip" key={`${chip.number}:${chip.title}`} role="status">
              <b>{chip.number}</b>
              <span>{chip.title}</span>
            </div>
          )}
        </div>
        {layout ? (
          <>
          <BoardSplit board={state.board} playback={boardPlayback(state, active?.steps ?? [])}
            activity={documentId && (readAloud || tab === 'tour' || mainState.status === 'playing' || !!away || !!answer || isTourGenerationActive(manifest?.tourGeneration)) ? <AgentActivity
              documentId={documentId}
              showNarration={captions.agent}
              playerVisible={!!active && !!clock}
              mode={answer || away ? 'answer' : readAloud ? 'reading' : 'tour'}
              playback={{
                playing: state.status === 'playing',
                preparingText: readAloud && !answer && !away && readingSpeech.busy,
                preparationError: readAloud && !answer && !away ? readingSpeech.error ?? undefined : undefined,
                generating: state.status === 'playing' && state.speechStatus === 'generating',
                speaking: state.status === 'playing' && state.speechStatus !== 'generating' && state.word >= 0 && !state.preview,
                canPlay: !!active?.steps.length && (!away || !!answer),
                words: active?.steps[state.index]?.words ?? [],
                word: state.word,
                page: currentPage,
                title: active?.tour.chapters[active.steps[state.index]?.chapterIndex ?? 0]?.title,
                step: active?.steps.length ? { current: state.index + 1, total: active.steps.length } : undefined,
              }}
              onSource={navigateTo}
              onTogglePlayback={() => active?.toggle()}
              onAsk={() => {
                setAside();
                requestAnimationFrame(() => document.querySelector<HTMLTextAreaElement>('.ask-bar textarea')?.focus());
              }}
            /> : undefined}>
            <div className="ask-stage">
              <Stage
                pdf={loaded?.pdf ?? null}
                layout={layout}
                camera={camera}
                scene={scene}
                debugPages={debug ? debugPages : null}
                marks={marks}
                slide={slideNow}
                ahead={ahead}
                onViewportChange={onViewportChange}
                onInsetsChange={onInsetsChange}
                onCopyId={onCopyId}
                selecting={selectingRegion}
                regionSelection={regionSelection}
                regionSnap={regionSnap}
                onSelectRegion={acceptRegionSelection}
                onCancelSelection={cancelRegionSelection}
              />
              <AnimatePresence>
                {coverOpen && engine && clock && (
                  <TourCover
                    key="tour-cover"
                    tour={engine.tour}
                    steps={engine.steps.length}
                    length={lengthLabel(clock.total)}
                    resumeAt={restored !== null ? restored + 1 : null}
                    growth={growth}
                    onStart={() => {
                      setSelection([]);
                      if (restored !== null && restored > 0) engine.goTo(0);
                      engine.play();
                    }}
                    onResume={() => engine.play()}
                    onBrowse={() => setCoverGone(true)}
                  />
                )}
                {endOpen && engine && (
                  <TourEnd
                    key="tour-end"
                    tour={engine.tour}
                    stopped={playable?.phase === 'stopped' ? playable : null}
                    questions={loaded?.doc ? openQuestions(engine.tour.suggested_questions, asked) : []}
                    ready={readyQuestions}
                    onReplayChapter={(step) => {
                      setSelection([]);
                      engine.goTo(step);
                      engine.play();
                    }}
                    onReplay={() => {
                      setSelection([]);
                      engine.play();
                    }}
                    onAsk={(question) => setAskRequest((last) => ({ id: (last?.id ?? 0) + 1, question }))}
                    onClose={() => setEndGone(true)}
                  />
                )}
              </AnimatePresence>
              {loaded?.doc && (!readAloud || !!away) && (
                <div className="ask-lane">
                  {coachStep?.checkpoint && (
                    <CoachCard key={coachStep.step.id} checkpoint={coachStep.checkpoint} kind={checkpointKind(coachStep.step.id)} onSolve={() => active?.reveal()} />
                  )}
                  <AskPanel
                    className="ask-dock"
                    source={askSource}
                    tourId={documentId && !readAloud ? selectedTourId : null}
                    context={askContext}
                    onRestoreContext={restoreConversationContext}
                    suggestions={prepared?.tour.suggested_questions}
                    ended={mainState.status === 'ended' && !endOpen}
                    request={askRequest}
                    prefetch={prefetchOn ? { questions: prefetchQuestions, stamp: `${mainState.index}:${mainState.status}` } : null}
                    onReady={onReady}
                    away={!!away}
                    answering={answerState.status === 'playing'}
                    answerPaused={!!answer && answerState.status === 'paused'}
                    onPauseAnswer={() => now.current.answer?.pause()}
                    onContinueAnswer={() => now.current.answer?.play()}
                    resumeLabel={readAloud ? 'Continue reading' : engine ? (answer ? 'Back to the tour' : 'Continue tour') : 'Back to the document'}
                    selection={regionSnap.region}
                    selectionSnapped={regionSnap.phase === 'snapped'}
                    selecting={selectingRegion}
                    selectionPreview={
                      regionSnap.region && <SelectionPreview pdf={loaded.pdf} selection={regionSnap.region} />
                    }
                    onSelectRegion={beginRegionSelection}
                    onClearRegion={clearRegionSelection}
                    onCancelSelection={cancelRegionSelection}
                    onAsk={onAsked}
                    onAnswer={onAnswer}
                    onAnswerPart={playAnswer}
                    onResume={backToTour}
                  />
                </div>
              )}
            </div>
          </BoardSplit>
          {layout.deck && (
            <Filmstrip
              pdf={loaded?.pdf ?? null}
              sizes={loaded?.sizes ?? []}
              slide={slideNow ?? 1}
              stepsOn={stepsOn}
              step={tourStep}
              onPick={pickSlide}
            />
          )}
          </>
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

        {active && clock && (
          <ControlBar
            showNarration={captions.player || !documentId}
            steps={active.steps}
            chapters={active.tour.chapters.map((chapter) => chapter.title)}
            clock={clock}
            state={state}
            growth={answer ? null : growth}
            speechSettings={<div className="voice-setting">
              <span>Speech provider</span>
              <SpeechProviderSelect local={!documentId} value={speech.data?.preferences.provider ?? 'browser'} disabled={!speech.data || speech.loading || speechUpdatePending} onChange={(provider) => {
                if (speech.data) void applySpeechPreferences({ ...speech.data.preferences, provider }).catch(() => {});
              }} />
              {speech.data && <AudioVoiceControl local={!documentId} settings={speech.data} pending={speechUpdatePending || speech.loading} onSave={async (voice) => {
                const preferences = speech.data!.preferences;
                if (preferences.provider === 'browser') return;
                await applySpeechPreferences({ ...preferences, connections: { ...preferences.connections,
                  [preferences.provider]: { ...preferences.connections[preferences.provider], voice } } });
              }} />}
              {speech.data && speech.data.preferences.provider !== 'browser' && speech.data.preferences.provider !== 'siri' && <small>{speech.data.providers[speech.data.preferences.provider].message}</small>}
              {state.speechTiming === 'estimated' && <small>Word highlighting and word seeking use estimated audio timing.</small>}
              {state.speechTiming === 'provider' && <small>Word highlighting follows provider timestamps.</small>}
              {(speech.error || speechUpdateError) && <small role="alert">{speechUpdateError ?? speech.error}</small>}
              <div className="ui-audio-links">
                <a href={`${import.meta.env.BASE_URL}?settings=profile#speech`}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M3 6h14M3 14h14M7 3v6m6 2v6" /></svg>Voice settings</a>
                <a href={`${import.meta.env.BASE_URL}?settings=voices`}><svg width="15" height="15" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M4 7v6m4-9v12m4-14v16m4-11v6" /></svg>Voice library</a>
              </div>
            </div>}
            readingSettings={readAloud ? (
              <div className="reader-reading-options">
                <strong>Original paper text</strong>
                <p>The model prepares the original prose word for word, cleaning layout and citation markers only. Equations, tables and figures receive detailed explanations and visual annotations using the PDF and context. Authors, affiliations and page metadata are skipped.</p>
                {!speechAvailable() && (!speech.data || speech.data.preferences.provider === 'browser') && <p role="alert">Speech synthesis is unavailable in this browser. Open this document in a browser with text-to-speech to hear it.</p>}
                <label><span>Skip citation markers</span><AnimatedSwitch checked={readingOptions.removeCitations}
                  onCheckedChange={(removeCitations) => setReadingOptions((o) => ({ ...o, removeCitations }))} /></label>
                <label><span>Read bibliography</span><AnimatedSwitch checked={readingOptions.includeReferences}
                  onCheckedChange={(includeReferences) => setReadingOptions((o) => ({ ...o, includeReferences }))} /></label>
                <button onClick={() => {
                  leaveAnswer();
                  if (engine && loaded?.doc) { engine.goTo(readingStepOnPage(engine.tour, loaded.doc, currentPageRef.current)); engine.play(); }
                }}>Read from this page</button>
              </div>
            ) : null}
            speed={speed}
            muted={muted || params.silent}
            onToggle={() => {
              setSelection([]);
              active.toggle();
            }}
            onPrev={() => active.prev()}
            onNext={() => active.next()}
            onSeek={(index, word) => {
              setSelection([]);
              active.seekTo(index, word);
            }}
            onSkip={(direction) => active.skip(direction)}
            helpOpen={helpOpen}
            onHelp={setHelpOpen}
            onSpeed={setSpeed}
            onMute={setMuted}
            voices={browserVoices.voices}
            voicesLoading={browserVoices.loading}
            selectedVoiceId={browserVoices.selectedVoiceId}
            voiceOrder={speech.data?.preferences.voiceOrder?.browser}
            onVoiceChange={!speech.data || speech.data.preferences.provider === 'browser' ? browserVoices.setSelectedVoiceId : undefined}
            voiceConfig={active.tour.voices?.[active.steps[state.index]?.step.speaker ?? 'host']}
            unclear={
              canUnclear ? { open: unclearAt !== null, onOpen: openUnclear, onClose: closeUnclear, onChoose: chooseUnclear } : null
            }
          />
        )}
      </main>
    </div>
  );
}
