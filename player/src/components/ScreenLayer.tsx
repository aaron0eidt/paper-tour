import { useCallback, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { project } from '../camera';
import type { Camera, ScreenRect, Viewport } from '../camera';
import { STROKE } from '../colors';
import { parseNote } from '../markup';
import { labelWidths, layoutLabels } from '../labelLayout';
import type { LabelAnchor, LabelPlacement, MeasuredLabel } from '../labelLayout';
import type { PenLabelSide, PenSide, SceneLabel, SceneNote } from '../scene';
import type { BBox, Color } from '../types';

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

// Label text on each chip colour: dark on the light yellow and orange, where white is barely legible.
const CHIP_TEXT: Record<Color, string> = {
  yellow: '#211800',
  orange: '#2a1300',
  blue: '#fff',
  green: '#fff',
  pink: '#fff',
};
const chip = (color: Color): CSSProperties => ({ background: STROKE[color], color: CHIP_TEXT[color] });

/**
 * Where a box's label goes: just above the box when there is room, else inside its top edge and
 * kept on screen while the box is. A box that is off screen shows no label (null).
 */
export function labelPosition(
  r: ScreenRect,
  vp: Viewport,
  width = 110,
): { left: number; top: number; above: boolean } | null {
  if (!onScreen(r, vp)) return null;
  const above = r.top > 34;
  const top = above ? r.top - 6 : clamp(r.top + 6, EDGE, r.bottom - LABEL_H - 6);
  return { left: clamp(r.left, EDGE, vp.width - width - EDGE), top, above };
}

/**
 * Where a pen label goes, from the screen point it hangs from: on the given side of an arrow's
 * tail, or up and to the right of a circle. A label that would run off the viewport there takes
 * the arrow's other side (`alt`), or another corner of the circle around `center`, when that fits
 * better; it is always kept inside the viewport.
 */
export function penLabelPosition(
  x: number,
  y: number,
  side: PenLabelSide,
  size: { w: number; h: number },
  vp: Viewport,
  { alt, center }: { alt?: PenSide; center?: { x: number; y: number } } = {},
): { left: number; top: number } {
  const { w, h } = size;
  const at = (px: number, py: number, s: PenLabelSide): [number, number] =>
    s === 'left'
      ? [px - PEN_GAP - w, py - h / 2]
      : s === 'right'
        ? [px + PEN_GAP, py - h / 2]
        : s === 'top'
          ? [px - w / 2, py - PEN_GAP - h]
          : s === 'bottom'
            ? [px - w / 2, py + PEN_GAP]
            : [px + PEN_GAP, py - h - PEN_GAP];
  const spots: [number, number][] = [at(x, y, side)];
  if (alt && side !== 'upper-right') spots.push(at(x, y, alt));
  if (center && side === 'upper-right') {
    // The loop's other corners, by symmetry: upper left, lower right and lower left.
    const [mx, my] = [2 * center.x - x, 2 * center.y - y];
    spots.push([mx - PEN_GAP - w, y - h - PEN_GAP], [x + PEN_GAP, my + PEN_GAP], [mx - PEN_GAP - w, my + PEN_GAP]);
  }
  // How far a label would stick out of the viewport (past its edge margin).
  const out = ([l, t]: [number, number]) =>
    Math.max(0, EDGE - l) +
    Math.max(0, l + w - vp.width + EDGE) +
    Math.max(0, EDGE - t) +
    Math.max(0, t + h - vp.height + EDGE);
  const [left, top] = spots.reduce((best, s) => (out(s) < out(best) - 0.5 ? s : best));
  return { left: clamp(left, EDGE, vp.width - w - EDGE), top: clamp(top, EDGE, vp.height - h - EDGE) };
}

/**
 * Notes and box and pen labels live in screen space above the viewport, so they stay readable at
 * any zoom. They are re-projected through the camera on every camera frame.
 */
export function ScreenLayer({ camera, notes, labels, obstacles = [], occlusions = [] }: {
  camera: Camera;
  notes: SceneNote[];
  labels: SceneLabel[];
  obstacles: BBox[];
  occlusions?: ScreenRect[];
}) {
  const view = useSyncExternalStore(camera.subscribe, camera.getView);
  const vp = camera.viewport;
  const [measurements, setMeasurements] = useState<Record<string, { text: string; sizes: MeasuredLabel[] }>>({});
  const measure = useCallback((key: string, text: string, sizes: MeasuredLabel[]) => {
    setMeasurements((current) => {
      const previous = current[key];
      if (previous?.text === text && JSON.stringify(previous.sizes) === JSON.stringify(sizes)) return current;
      return { ...current, [key]: { text, sizes } };
    });
  }, []);
  const sizes = (key: string, text: string) => measurements[key]?.text === text ? measurements[key].sizes : [];
  // Notes have priority over optional chips. Both participate in the same collision layout.
  const anchors: LabelAnchor[] = [
    ...notes.map((note) => ({
      key: `note:${note.key}`, rect: project(note.rect, view, vp), side: note.side,
      sizes: sizes(`note:${note.key}`, note.text),
    })),
    ...labels.map((label) => {
      const rect = project(label.rect, view, vp);
      const point = label.pin && project([label.pin.x, label.pin.y, label.pin.x, label.pin.y], view, vp);
      const tiny = label.pin && Math.max(rect.right - rect.left, rect.bottom - rect.top) < PEN_MIN_MARK;
      return {
        key: `label:${label.key}`, rect,
        area: label.area && project(label.area, view, vp),
        pin: label.pin && point ? { ...label.pin, x: point.left, y: point.top } : undefined,
        sizes: tiny ? [] : sizes(`label:${label.key}`, label.text),
      };
    }),
  ];
  const placements = layoutLabels(anchors, [...obstacles.map((r) => project(r, view, vp)), ...occlusions], vp);
  return (
    <div className="screen-layer">
      {labels.map((label) => (
        <Annotation key={`label:${label.key}`} id={`label:${label.key}`} text={label.text}
          label={label} placement={placements.get(`label:${label.key}`)} vp={vp} onMeasure={measure} />
      ))}
      {notes.map((n) => (
        <Annotation key={`note:${n.key}`} id={`note:${n.key}`} text={n.text} note
          anchor={project(n.rect, view, vp)} placement={placements.get(`note:${n.key}`)} vp={vp} onMeasure={measure} />
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

/** One mounted element supplies real font/wrapping measurements at each useful width.
 * Hidden labels stay measured, but never flash over a figure while layout catches up. */
function Annotation({ id, text, label, note = false, anchor, placement, vp, onMeasure }: {
  id: string;
  text: string;
  label?: SceneLabel;
  note?: boolean;
  anchor?: ScreenRect;
  placement?: LabelPlacement;
  vp: Viewport;
  onMeasure(key: string, text: string, sizes: MeasuredLabel[]): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const widthOptions = labelWidths(vp.width, note).join(',');
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const previous = el.style.maxWidth;
      const sizes = widthOptions.split(',').map(Number).map((maxWidth) => {
        el.style.maxWidth = `${maxWidth}px`;
        return { maxWidth, w: el.offsetWidth, h: el.offsetHeight };
      });
      el.style.maxWidth = previous;
      onMeasure(id, text, sizes);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [id, text, widthOptions, onMeasure]);
  const side = placement?.side ?? 'top';
  // A small pointer is useful only while it actually touches the source-facing edge.
  // There are no extended leader lines across the PDF to compensate for a poor placement.
  const horizontal = side === 'left' || side === 'right';
  const along = placement && anchor ? horizontal
    ? (anchor.top + anchor.bottom) / 2 - placement.top
    : (anchor.left + anchor.right) / 2 - placement.left : null;
  const length = placement && (horizontal ? placement.bottom - placement.top : placement.right - placement.left);
  const arrow = along !== null && length && along > 12 && along < length - 12 ? along : null;
  return (
    <div ref={ref} className={note ? `note note-${side}` : `box-label${label?.pin ? ' pen-label' : ''}`}
      style={{ left: placement?.left ?? 0, top: placement?.top ?? 0,
        maxWidth: placement?.maxWidth ?? labelWidths(vp.width, note)[0],
        ...(label ? chip(label.color) : {}), visibility: placement ? undefined : 'hidden' }}
      role={note ? 'note' : undefined} aria-hidden={placement ? undefined : true}>
      {note ? parseNote(text).map((t, i) =>
        t.kind === 'bold' ? <strong key={i}>{t.text}</strong> : t.kind === 'code' ? <code key={i}>{t.text}</code> : <span key={i}>{t.text}</span>,
      ) : text}
      {note && arrow !== null && <span className="note-arrow" style={horizontal ? { top: arrow } : { left: arrow }} />}
    </div>
  );
}
