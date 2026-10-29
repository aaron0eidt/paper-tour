import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { transformOf, unproject } from '../camera';
import type { Camera, ScreenRect, View } from '../camera';
import { nextPlan } from '../canvasPlan';
import type { Plan } from '../canvasPlan';
import type { Layout } from '../layout';
import type { PDFDocumentProxy } from '../pdf';
import type { Scene } from '../scene';
import { PageView } from './PageView';
import type { DebugPage } from './PageView';
import { ScreenLayer } from './ScreenLayer';
import { hasRegionArea, regionFromDrag } from '../ask/regionSelection';
import type { RegionSelection } from '../ask/regionSelection';
import type { PageBox } from '../layout';

interface Props {
  pdf: PDFDocumentProxy | null;
  layout: Layout;
  camera: Camera;
  scene: Scene;
  debugPages: Map<number, DebugPage> | null;
  onViewportChange(): void;
  onCopyId(id: string): void;
  selecting?: boolean;
  regionSelection?: RegionSelection | null;
  onSelectRegion?(region: RegionSelection): void;
  onCancelSelection?(): void;
}

const PLAN_THROTTLE_MS = 150;
// A pointer that moves less than this (px) is a click, not a drag.
const DRAG_SLOP = 4;

interface Point {
  x: number;
  y: number;
}

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

export function Stage({ pdf, layout, camera, scene, debugPages, onViewportChange, onCopyId, selecting = false, regionSelection, onSelectRegion, onCancelSelection }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef<Element | null>(null);
  // True from the moment a pointer gesture becomes a drag until the next pointer goes down.
  const draggedRef = useRef(false);
  const [draftRegion, setDraftRegion] = useState<RegionSelection | null>(null);
  const regionDrag = useRef<{ id: number; page: PageBox; start: [number, number] } | null>(null);
  const selectingRef = useRef(selecting);
  selectingRef.current = selecting;
  useEffect(() => {
    if (!selecting) { regionDrag.current = null; setDraftRegion(null); }
  }, [selecting]);
  const [plan, setPlan] = useState<Plan>({ scales: [], details: [] });
  const [occlusions, setOcclusions] = useState<ScreenRect[]>([]);
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  useLayoutEffect(() => camera.setLayout(layout), [camera, layout]);

  // Only the floating card occupies the PDF, not the full-width transparent ask lane.
  // Its live bounds include an expanded progress tray and adapt to a side-board resize.
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const host = viewport?.closest('.ask-stage');
    if (!viewport || !host) return;
    const observed = new Set<Element>();
    const measure = () => {
      const bounds = viewport.getBoundingClientRect();
      const cards = [...host.querySelectorAll('.ask-card, .ask-language-menu')];
      for (const card of cards) {
        if (!observed.has(card)) { observed.add(card); resize.observe(card); }
      }
      for (const card of observed) {
        if (!cards.includes(card)) { resize.unobserve(card); observed.delete(card); }
      }
      const next = cards.map((card) => card.getBoundingClientRect()).filter((r) => r.width && r.height).map((r) => ({
        left: r.left - bounds.left, right: r.right - bounds.left, top: r.top - bounds.top, bottom: r.bottom - bounds.top,
      }));
      setOcclusions((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next);
    };
    const resize = new ResizeObserver(measure);
    resize.observe(viewport);
    const changes = new MutationObserver(measure);
    changes.observe(host, { childList: true, subtree: true });
    measure();
    return () => { resize.disconnect(); changes.disconnect(); };
  }, []);

  // ID overlay: one delegated handler for hover tooltips and click-to-copy.
  const setHovered = useCallback((target: Element | null, x = 0, y = 0) => {
    const tip = tooltipRef.current;
    if (hoveredRef.current !== target) {
      hoveredRef.current?.classList.remove('dbg-hover');
      target?.classList.add('dbg-hover');
      hoveredRef.current = target;
    }
    if (!tip) return;
    if (!target) {
      tip.style.display = 'none';
      return;
    }
    tip.textContent = `${target.getAttribute('data-id')}  ·  ${target.getAttribute('data-kind')}`;
    tip.style.display = 'block';
    tip.style.transform = `translate(${x + 14}px, ${y + 16}px)`;
  }, []);

  // Apply camera moves straight to the DOM (no React render per frame) and plan canvas scales.
  useLayoutEffect(() => {
    let lastPlan = 0;
    const apply = (view: View, moving: boolean) => {
      // The content under the cursor changes when the camera moves.
      if (moving && hoveredRef.current) setHovered(null);
      const stage = stageRef.current;
      if (stage) {
        stage.style.transform = transformOf(view, camera.viewport);
        stage.style.setProperty('--zoom', String(view.s));
        stage.style.setProperty('--inv-zoom', String(1 / view.s));
      }
      const now = performance.now();
      if (!moving || now - lastPlan > PLAN_THROTTLE_MS) {
        lastPlan = now;
        setPlan((prev) => nextPlan(prev, layout, camera, view, moving, window.devicePixelRatio || 1));
      }
    };
    apply(camera.getView(), false);
    const unsubscribe = camera.subscribe(apply);

    // Re-plan when the device pixel ratio changes (the window moved to another display); the
    // query matches one ratio only, so it is renewed on every change.
    let ratio: MediaQueryList | null = null;
    const onRatio = () => {
      watchRatio();
      apply(camera.getView(), false);
    };
    const watchRatio = () => {
      ratio?.removeEventListener('change', onRatio);
      ratio = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
      ratio.addEventListener('change', onRatio);
    };
    watchRatio();
    return () => {
      unsubscribe();
      ratio?.removeEventListener('change', onRatio);
    };
  }, [camera, layout, setHovered]);

  // Track the viewport size.
  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const measure = () => {
      camera.setViewport({ width: el.clientWidth, height: el.clientHeight });
      onViewportChangeRef.current();
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [camera]);

  // Wheel pans, ctrl/cmd + wheel (and trackpad pinch) zooms around the cursor.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (selectingRef.current) return;
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const dx = e.deltaX * unit;
      const dy = e.deltaY * unit;
      if (e.ctrlKey || e.metaKey) {
        const box = el.getBoundingClientRect();
        const step = Math.max(-60, Math.min(60, dy));
        camera.zoomAt(Math.exp(-step * 0.01), e.clientX - box.left, e.clientY - box.top);
      } else if (e.shiftKey && dx === 0) {
        camera.panBy(dy, 0);
      } else {
        camera.panBy(dx, dy);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [camera]);

  // Dragging pans (touch, pen or mouse) and two fingers pinch-zoom around their midpoint. The
  // viewport sets touch-action: none, so the browser leaves these gestures to us.
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const pointers = new Map<number, Point>();
    let start: Point = { x: 0, y: 0 };
    const at = (e: PointerEvent): Point => {
      const box = el.getBoundingClientRect();
      return { x: e.clientX - box.left, y: e.clientY - box.top };
    };
    const onDown = (e: PointerEvent) => {
      if (selectingRef.current) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (!pointers.size) {
        draggedRef.current = false;
        start = at(e);
      }
      pointers.set(e.pointerId, at(e));
      if (draggedRef.current) el.setPointerCapture(e.pointerId);
    };
    const onUp = (e: PointerEvent) => void pointers.delete(e.pointerId);
    const onMove = (e: PointerEvent) => {
      if (selectingRef.current) { pointers.clear(); return; }
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      if (e.pointerType === 'mouse' && !(e.buttons & 1)) return onUp(e); // released where we did not see it
      const p = at(e);
      if (!draggedRef.current) {
        if (pointers.size < 2 && dist(p, start) < DRAG_SLOP) return;
        // Captured only once it is a drag, so a plain click still reaches the element under it.
        draggedRef.current = true;
        for (const id of pointers.keys()) el.setPointerCapture(id);
      }
      pointers.set(e.pointerId, p);
      const other = [...pointers].find(([id]) => id !== e.pointerId)?.[1];
      if (!other) return camera.panBy(prev.x - p.x, prev.y - p.y);
      // Two fingers: the stage point under their midpoint follows it, and their spread zooms.
      const before = mid(prev, other);
      const after = mid(p, other);
      camera.panBy(before.x - after.x, before.y - after.y);
      const spread = dist(prev, other);
      if (spread > 0) camera.zoomAt(dist(p, other) / spread, after.x, after.y);
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [camera]);

  useEffect(() => {
    if (!debugPages) setHovered(null);
  }, [debugPages, setHovered]);

  const debugTarget = (e: MouseEvent) => (debugPages ? (e.target as Element).closest?.('[data-id]') ?? null : null);
  const onMouseMove = (e: MouseEvent) => {
    const box = viewportRef.current!.getBoundingClientRect();
    setHovered(debugTarget(e), e.clientX - box.left, e.clientY - box.top);
  };
  const onClick = (e: MouseEvent) => {
    if (draggedRef.current) return; // the end of a drag, not a click
    const id = debugTarget(e)?.getAttribute('data-id');
    if (id) onCopyId(id);
  };

  const regionPoint = (event: ReactPointerEvent): [number, number] => {
    const bounds = viewportRef.current!.getBoundingClientRect();
    return unproject(event.clientX - bounds.left, event.clientY - bounds.top, camera.getView(), camera.viewport);
  };
  const beginRegion = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0) return;
    const start = regionPoint(event);
    const page = layout.pages.find((p) => start[0] >= p.x && start[0] <= p.x + p.width && start[1] >= p.y && start[1] <= p.y + p.height);
    if (!page) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    regionDrag.current = { id: event.pointerId, page, start };
    setDraftRegion(regionFromDrag(page, start, start));
  };
  const moveRegion = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = regionDrag.current;
    if (!drag || drag.id !== event.pointerId) return;
    setDraftRegion(regionFromDrag(drag.page, drag.start, regionPoint(event)));
  };
  const finishRegion = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = regionDrag.current;
    if (!drag || drag.id !== event.pointerId) return;
    regionDrag.current = null;
    setDraftRegion(null);
    const next = regionFromDrag(drag.page, drag.start, regionPoint(event));
    if (hasRegionArea(next, drag.page, camera.getView().s)) onSelectRegion?.(next);
  };
  const shownRegion = draftRegion ?? regionSelection;
  const regionPage = shownRegion && layout.pages.find((p) => p.n === shownRegion.page);

  return (
    <div
      className={`viewport${debugPages ? ' debug' : ''}`}
      ref={viewportRef}
      onMouseMove={debugPages ? onMouseMove : undefined}
      onMouseLeave={() => setHovered(null)}
      onClick={onClick}
    >
      <div className="stage" ref={stageRef} style={{ width: layout.width, height: layout.height }}>
        {layout.pages.map((box) => (
          <PageView
            key={box.n}
            box={box}
            pdf={pdf}
            scale={plan.scales[box.n - 1] ?? 0}
            detail={plan.details[box.n - 1] ?? null}
            shapes={scene.pages.get(box.n)}
            spotlight={scene.spotlight}
            debug={debugPages?.get(box.n) ?? null}
          />
        ))}
        {shownRegion && regionPage && (
          <div className="pdf-region-selection" style={{
            left: regionPage.x + shownRegion.rect[0] * regionPage.width,
            top: regionPage.y + shownRegion.rect[1] * regionPage.height,
            width: (shownRegion.rect[2] - shownRegion.rect[0]) * regionPage.width,
            height: (shownRegion.rect[3] - shownRegion.rect[1]) * regionPage.height,
          }} />
        )}
      </div>
      <ScreenLayer camera={camera} notes={scene.notes} labels={scene.labels} obstacles={scene.obstacles} occlusions={occlusions} />
      <div className="dbg-tooltip" ref={tooltipRef} />
      {selecting && <>
        <div className="pdf-region-picker" onPointerDown={beginRegion} onPointerMove={moveRegion} onPointerUp={finishRegion}
          onPointerCancel={() => { regionDrag.current = null; setDraftRegion(null); }} />
        <div className="pdf-region-instruction" role="status">
          <span>Drag over a figure, equation or passage</span>
          <button type="button" onClick={onCancelSelection}>Cancel <kbd>Esc</kbd></button>
        </div>
      </>}
    </div>
  );
}
