import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { transformOf } from '../camera';
import type { Camera, View } from '../camera';
import { nextPlan } from '../canvasPlan';
import type { Plan } from '../canvasPlan';
import type { Layout } from '../layout';
import type { PDFDocumentProxy } from '../pdf';
import type { Scene } from '../scene';
import { PageView } from './PageView';
import type { DebugPage } from './PageView';
import { ScreenLayer } from './ScreenLayer';

interface Props {
  pdf: PDFDocumentProxy | null;
  layout: Layout;
  camera: Camera;
  scene: Scene;
  debugPages: Map<number, DebugPage> | null;
  onViewportChange(): void;
  onCopyId(id: string): void;
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

export function Stage({ pdf, layout, camera, scene, debugPages, onViewportChange, onCopyId }: Props) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef<Element | null>(null);
  // True from the moment a pointer gesture becomes a drag until the next pointer goes down.
  const draggedRef = useRef(false);
  const [plan, setPlan] = useState<Plan>({ scales: [], details: [] });
  const onViewportChangeRef = useRef(onViewportChange);
  onViewportChangeRef.current = onViewportChange;

  useLayoutEffect(() => camera.setLayout(layout), [camera, layout]);

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
      </div>
      <ScreenLayer camera={camera} notes={scene.notes} labels={scene.labels} />
      <div className="dbg-tooltip" ref={tooltipRef} />
    </div>
  );
}
