import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { project } from '../camera';
import type { Camera, ScreenRect, View, Viewport } from '../camera';
import { STROKE } from '../colors';
import { parseNote } from '../markup';
import type { PenLabelSide, SceneLabel, SceneNote } from '../scene';

type Side = 'right' | 'left' | 'top' | 'bottom';

const GAP = 14;
const EDGE = 10;
// A label chip is about this tall; inside a box it stays this far above the box's bottom.
const LABEL_H = 22;
// Between a pen label and the point it hangs from.
const PEN_GAP = 6;
// A pen mark smaller than this on screen (zoomed far out) shows no label.
const PEN_MIN_MARK = 32;
const SIDES: Side[] = ['right', 'left', 'bottom', 'top'];
const OPPOSITE: Record<Side, Side> = { right: 'left', left: 'right', top: 'bottom', bottom: 'top' };
const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(lo, hi), Math.max(lo, v));

const onScreen = (r: ScreenRect, vp: Viewport) => r.right > 0 && r.left < vp.width && r.bottom > 0 && r.top < vp.height;

/**
 * Where a box's label goes: just above the box when there is room, else inside its top edge and
 * kept on screen while the box is. A box that is off screen shows no label (null).
 */
export function labelPosition(r: ScreenRect, vp: Viewport): { left: number; top: number; above: boolean } | null {
  if (!onScreen(r, vp)) return null;
  const above = r.top > 34;
  const top = above ? r.top - 6 : clamp(r.top + 6, EDGE, r.bottom - LABEL_H - 6);
  return { left: clamp(r.left, EDGE, vp.width - 120), top, above };
}

/**
 * Where a pen label goes, from the screen point it hangs from: on the given side of an arrow's
 * tail, or up and to the right of a circle. Always inside the viewport.
 */
export function penLabelPosition(
  x: number,
  y: number,
  side: PenLabelSide,
  size: { w: number; h: number },
  vp: Viewport,
): { left: number; top: number } {
  const { w, h } = size;
  const [left, top] =
    side === 'left'
      ? [x - PEN_GAP - w, y - h / 2]
      : side === 'right'
        ? [x + PEN_GAP, y - h / 2]
        : side === 'top'
          ? [x - w / 2, y - PEN_GAP - h]
          : side === 'bottom'
            ? [x - w / 2, y + PEN_GAP]
            : [x + PEN_GAP, y - h - PEN_GAP];
  return { left: clamp(left, EDGE, vp.width - w - EDGE), top: clamp(top, EDGE, vp.height - h - EDGE) };
}

/**
 * Notes and box and pen labels live in screen space above the viewport, so they stay readable at
 * any zoom. They are re-projected through the camera on every camera frame.
 */
export function ScreenLayer({ camera, notes, labels }: { camera: Camera; notes: SceneNote[]; labels: SceneLabel[] }) {
  const view = useSyncExternalStore(camera.subscribe, camera.getView);
  const vp = camera.viewport;
  return (
    <div className="screen-layer">
      {labels.map((l) => {
        if (l.pin) return <PenLabel key={l.key} label={l} pin={l.pin} view={view} vp={vp} />;
        const pos = labelPosition(project(l.rect, view, vp), vp);
        if (!pos) return null;
        return (
          <div
            key={l.key}
            className={`box-label ${pos.above ? 'above' : 'inside'}`}
            style={{ left: pos.left, top: pos.top, background: STROKE[l.color] }}
          >
            {l.text}
          </div>
        );
      })}
      {notes.map((n) => (
        <NoteCard
          key={n.key}
          note={n}
          anchor={project(n.rect, view, vp)}
          destination={project(n.rect, camera.targetView, vp)}
          userMoved={camera.userMoved}
          vp={vp}
        />
      ))}
    </div>
  );
}

/**
 * The side of the anchor a note card goes on. An explicit side is a preference: it is used when
 * the card fits there, else the opposite side when that fits, else the automatic choice (the
 * card would otherwise be pushed back over its anchor).
 */
export function chooseSide(pref: SceneNote['side'], a: ScreenRect, size: { w: number; h: number }, vp: Viewport, current: Side | null): Side {
  const room: Record<Side, number> = { right: vp.width - a.right, left: a.left, top: a.top, bottom: vp.height - a.bottom };
  const need: Record<Side, number> = {
    right: size.w + GAP + EDGE,
    left: size.w + GAP + EDGE,
    top: size.h + GAP + EDGE,
    bottom: size.h + GAP + EDGE,
  };
  const fits = (s: Side) => room[s] >= need[s];
  if (pref !== 'auto') {
    if (fits(pref)) return pref;
    if (fits(OPPOSITE[pref])) return OPPOSITE[pref];
  }
  if (current && fits(current)) return current;
  return SIDES.reduce((best, s) => (room[s] / need[s] > room[best] / need[best] ? s : best));
}

interface PenLabelProps {
  label: SceneLabel;
  pin: NonNullable<SceneLabel['pin']>;
  view: View;
  vp: Viewport;
}

/** A pen mark's label, measured so it can be kept inside the viewport. */
function PenLabel({ label, pin, view, vp }: PenLabelProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: LABEL_H });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const at = project([pin.x, pin.y, pin.x, pin.y], view, vp);
  const { left, top } = penLabelPosition(at.left, at.top, pin.side, size, vp);
  // Stays mounted while its mark is off screen or tiny, so it fades in once rather than on every return.
  const mark = project(label.rect, view, vp);
  const hidden = !onScreen(mark, vp) || Math.max(mark.right - mark.left, mark.bottom - mark.top) < PEN_MIN_MARK;
  return (
    <div
      ref={ref}
      className="box-label pen-label"
      style={{ left, top, background: STROKE[label.color], visibility: hidden ? 'hidden' : undefined }}
    >
      {label.text}
    </div>
  );
}

function placeCard(side: Side, a: ScreenRect, size: { w: number; h: number }, vp: Viewport) {
  const cx = (a.left + a.right) / 2;
  const cy = (a.top + a.bottom) / 2;
  let x = side === 'right' ? a.right + GAP : side === 'left' ? a.left - GAP - size.w : cx - size.w / 2;
  let y = side === 'bottom' ? a.bottom + GAP : side === 'top' ? a.top - GAP - size.h : cy - size.h / 2;
  x = clamp(x, EDGE, vp.width - size.w - EDGE);
  y = clamp(y, EDGE, vp.height - size.h - EDGE);

  // The arrow points at the anchor only while the card really sits on that side of it.
  const horizontal = side === 'left' || side === 'right';
  const along = horizontal ? cy - y : cx - x;
  const length = horizontal ? size.h : size.w;
  const besides =
    (side === 'right' && x >= a.right) ||
    (side === 'left' && x + size.w <= a.left) ||
    (side === 'bottom' && y >= a.bottom) ||
    (side === 'top' && y + size.h <= a.top);
  const arrow = besides && along > 12 && along < length - 12 ? along : null;
  return { x, y, arrow };
}

interface NoteProps {
  note: SceneNote;
  /** Anchor at the current camera view. */
  anchor: ScreenRect;
  /** Anchor at the view the camera is animating to; the side is chosen from this. */
  destination: ScreenRect;
  userMoved: boolean;
  vp: Viewport;
}

function NoteCard({ note, anchor, destination, userMoved, vp }: NoteProps) {
  const ref = useRef<HTMLDivElement>(null);
  const sideRef = useRef<Side | null>(null);
  const [size, setSize] = useState({ w: 280, h: 72 });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Pick the side for where the camera is going, so the card does not flip at the end of a move.
  // While the user pans, keep the current side as long as it fits.
  const side = chooseSide(note.side, destination, size, vp, userMoved ? sideRef.current : null);
  sideRef.current = side;
  const { x, y, arrow } = placeCard(side, anchor, size, vp);
  // With its anchor off screen the card would sit at the edge pointing at nothing; it stays
  // mounted (and measured) but hidden.
  const hidden = !onScreen(anchor, vp);

  return (
    <div ref={ref} className={`note note-${side}`} style={{ left: x, top: y, visibility: hidden ? 'hidden' : undefined }} role="note">
      {parseNote(note.text).map((t, i) =>
        t.kind === 'bold' ? <strong key={i}>{t.text}</strong> : t.kind === 'code' ? <code key={i}>{t.text}</code> : <span key={i}>{t.text}</span>,
      )}
      {arrow !== null && <span className="note-arrow" style={side === 'left' || side === 'right' ? { top: arrow } : { left: arrow }} />}
    </div>
  );
}
