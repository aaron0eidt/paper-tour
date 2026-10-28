import type { SceneItem, SceneObject } from '../../shared/scene';
import { sceneObjectGeometry } from '../../shared/scene';
import { BOARD_INK, BOARD_PALETTE } from './board';

export const SCENE_WIDTH = 600;
export const SCENE_HEIGHT = 400;

export type DrawnSceneObject = SceneObject & { opacity: number; ink: string };

/** Stable defaults follow object identity, never its changing array position. */
export function sceneInk(object: SceneObject): string {
  let hash = 0;
  for (const char of object.id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return BOARD_INK[object.color ?? BOARD_PALETTE[hash % BOARD_PALETTE.length]];
}

export function sceneObjects(item: SceneItem): DrawnSceneObject[] {
  return item.objects.map(object => ({ ...object, opacity: 1, ink: sceneInk(object) }));
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const colorAt = (a: string, b: string, t: number) => `#${[1, 3, 5].map(start =>
  Math.round(lerp(parseInt(a.slice(start, start + 2), 16), parseInt(b.slice(start, start + 2), 16), t)).toString(16).padStart(2, '0')).join('')}`;

/** A domain or coordinate-system change is an exact cut, not a numerical
 * transformation. Interpolating coordinates in different units invents a path
 * and can put a valid endpoint outside the intermediate coordinate plane. */
export function sceneTransitionAllowed(from: readonly SceneObject[], to: SceneItem): boolean {
  const bindings = (objects: readonly SceneObject[]) => objects.filter(object => object.plotId)
    .map(object => `${object.id}:${object.type}:${object.plotId}`).sort().join('|');
  if (bindings(from) !== bindings(to.objects)) return false;
  return to.objects.every(object => {
    if (object.type !== 'plot' || !object.plot) return true;
    const before = from.find(old => old.id === object.id && old.type === 'plot');
    return !before?.plot || JSON.stringify([before.plot.x, before.plot.y]) === JSON.stringify([object.plot.x, object.plot.y]);
  });
}

/** The model authors complete states, and only matching objects transform.
 * Matrix values interpolate only when their dimensions still describe the same
 * quantity. Newly added/removed objects fade, rather than borrowing another ID. */
export function interpolateScene(from: readonly DrawnSceneObject[], to: SceneItem, progress: number): DrawnSceneObject[] {
  const t = Math.max(0, Math.min(1, progress));
  if (t >= 1 || !sceneTransitionAllowed(from, to)) return sceneObjects(to);
  const previous = new Map(from.map(object => [`${object.id}:${object.type}`, object]));
  const next = new Set(to.objects.map(object => `${object.id}:${object.type}`));
  const objects = to.objects.map(object => {
    const old = previous.get(`${object.id}:${object.type}`);
    if (!old) return { ...object, opacity: t, ink: sceneInk(object) };
    const sameMatrix = object.values && old.values && object.values.length === old.values.length &&
      object.values.every((row, i) => row.length === old.values![i].length);
    return {
      ...object,
      x: lerp(old.x, object.x, t), y: lerp(old.y, object.y, t),
      w: lerp(old.w, object.w, t), h: lerp(old.h, object.h, t),
      ...(sameMatrix ? { values: object.values!.map((row, i) => row.map((value, j) => lerp(old.values![i][j], value, t))) } : {}),
      opacity: lerp(old.opacity, 1, t), ink: colorAt(old.ink, sceneInk(object), t),
    };
  });
  return [...objects, ...from.filter(object => !next.has(`${object.id}:${object.type}`)).map(object => ({ ...object, opacity: object.opacity * (1 - t) }))];
}

export const sceneNumber = (value: number) => Number(value.toPrecision(3)).toString();

/** Plot-bound geometry uses the exact data-to-scene projection shared with
 * validation. Vectors follow the axes when their coordinate plane moves. */
export function projectSceneObject<T extends SceneObject>(object: T, objects: readonly SceneObject[]): T {
  return object.plotId ? { ...object, ...sceneObjectGeometry(object, objects) } : object;
}

/** Arrow geometry is in the shared scene plane; signed deltas retain direction. */
export function sceneArrow(object: Pick<SceneObject, 'x' | 'y' | 'w' | 'h'>): { line: string; head: string } {
  const x = object.x * SCENE_WIDTH, y = object.y * SCENE_HEIGHT;
  const dx = object.w * SCENE_WIDTH, dy = object.h * SCENE_HEIGHT;
  const length = Math.hypot(dx, dy);
  if (length < 0.001) return { line: '', head: '' };
  const ux = dx / length, uy = dy / length, head = Math.min(11, length * 0.28);
  const ex = x + dx, ey = y + dy;
  return {
    line: `M${x},${y}L${ex},${ey}`,
    head: `M${ex - ux * head - uy * head * .45},${ey - uy * head + ux * head * .45}L${ex},${ey}L${ex - ux * head + uy * head * .45},${ey - uy * head - ux * head * .45}`,
  };
}
