import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Camera, cameraView, initialView } from './camera';
import { TourEngine } from './engine';
import type { CameraCommand, EngineState } from './engine';
import { layoutPages } from './layout';
import { loadPaper } from './load';
import type { Loaded } from './load';
import { createNarrator, SilentNarrator } from './narration';
import { prepareTour, Resolver } from './resolve';
import { buildScene } from './scene';
import type { Scene } from './scene';
import type { Doc } from './types';
import { ControlBar } from './components/ControlBar';
import type { DebugPage } from './components/PageView';
import { Problems } from './components/Problems';
import { Sidebar } from './components/Sidebar';
import { Stage } from './components/Stage';

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

const IDLE: EngineState = { status: 'idle', index: 0, word: -1, overlays: [], camera: { seq: 0, key: null, action: null } };
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

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName));
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

export function App() {
  const params = useMemo(readParams, []);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [debug, setDebug] = useState(false);
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [engine, setEngine] = useState<TourEngine | null>(null);
  const camera = useMemo(() => new Camera(), []);

  useEffect(() => {
    let alive = true;
    loadPaper(params.paper).then(
      (l) => alive && setLoaded(l),
      (err) => alive && setFatal(String(err)),
    );
    return () => {
      alive = false;
    };
  }, [params.paper]);

  const layout = useMemo(() => (loaded ? layoutPages(loaded.sizes) : null), [loaded]);
  const resolver = useMemo(() => (loaded ? new Resolver(loaded.doc, loaded.sizes) : null), [loaded]);
  const prepared = useMemo(() => (loaded?.tour && resolver ? prepareTour(loaded.tour, resolver) : null), [loaded, resolver]);
  const problems = useMemo(() => [...(loaded?.problems ?? []), ...(prepared?.problems ?? [])], [loaded, prepared]);
  const debugPages = useMemo(() => (loaded?.doc ? debugIndex(loaded.doc) : new Map<number, DebugPage>()), [loaded]);

  const narrator = useCallback(
    (isMuted: boolean) => createNarrator({ baseUrl: loaded?.baseUrl ?? '/', muted: isMuted, forceSilent: params.silent }),
    [loaded, params.silent],
  );

  // One engine per loaded tour; narrator (mute) and speed are pushed into it without recreating it.
  useEffect(() => {
    if (!prepared) return;
    const e = new TourEngine(prepared.tour, { narrator: new SilentNarrator(), fallbackNarrator: new SilentNarrator() });
    setEngine(e);
    return () => {
      e.destroy();
      setEngine(null);
    };
  }, [prepared]);
  useEffect(() => engine?.setNarrator(narrator(muted)), [engine, narrator, muted]);
  useEffect(() => engine?.setRate(speed * params.rate), [engine, speed, params.rate]);

  const state = useSyncExternalStore(engine?.subscribe ?? noSubscribe, engine?.getState ?? (() => IDLE));

  const scene = useMemo(
    () => (resolver && layout ? buildScene(state.overlays, resolver, layout) : EMPTY_SCENE),
    [state.overlays, resolver, layout],
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
  const cameraCmd = useRef(state.camera);
  cameraCmd.current = state.camera;
  useEffect(() => {
    if (state.camera.seq > 0) frame(state.camera, false);
  }, [state.camera, frame]);

  const onViewportChange = useCallback(() => {
    if (camera.userMoved) camera.jumpTo(camera.getView());
    else frame(cameraCmd.current, true);
  }, [camera, frame]);

  useEffect(() => () => camera.destroy(), [camera]);

  // Keyboard: Space play/pause, arrows step, D toggles the ID overlay.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.altKey || e.ctrlKey || e.metaKey) return;
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

  return (
    <div className="app">
      <Sidebar tour={prepared?.tour ?? null} steps={steps} state={state} docTitle={loaded?.doc?.source.title} onJump={(i) => engine?.goTo(i)}>
        {loaded && <Problems problems={problems} defaultOpen />}
      </Sidebar>

      <main className="main">
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

        <div className="top-right">
          {/* The sidebar shows problems; this badge is for narrow screens without a sidebar. */}
          <div className="narrow-only">{loaded && <Problems problems={problems} />}</div>
          <button className={`chip${debug ? ' on' : ''}`} onClick={() => setDebug(!debug)} aria-pressed={debug} title="Show element IDs (D)">
            IDs
          </button>
        </div>

        {errors.length > 0 && (
          <div className="banner" role="alert">
            {errors.map((p, i) => (
              <div key={i}>{p.message}</div>
            ))}
          </div>
        )}

        {toast && (
          <div className="toast" key={toast.n}>
            {toast.text}
          </div>
        )}

        <ControlBar
          steps={steps}
          state={state}
          speed={speed}
          muted={muted || params.silent}
          onToggle={() => engine?.toggle()}
          onPrev={() => engine?.prev()}
          onNext={() => engine?.next()}
          onSpeed={setSpeed}
          onMute={setMuted}
        />
      </main>
    </div>
  );
}
