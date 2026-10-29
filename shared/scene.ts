import type { Color } from './paper';
import { PLOT_SCHEMA, plotProblems, type PlotItem } from './plot';

export const SCENE_MAX_OBJECTS = 24;
export const SCENE_TYPES = ['text', 'math', 'rect', 'circle', 'arrow', 'vector', 'matrix', 'plot'] as const;
export type SceneObjectType = (typeof SCENE_TYPES)[number];
export interface SceneGeometry {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface SceneObject extends SceneGeometry {
  id: string;
  type: SceneObjectType;
  color?: Color;
  /** Plain text, except type math where this is trusted-disabled KaTeX. */
  text?: string;
  values?: number[][];
  plot?: PlotItem;
  /** Deliberate unlabeled background geometry, or a coordinate-plane plot. */
  background?: boolean;
  /** Arrow/vector/circle coordinates use this plot's domain instead of normalized canvas units. */
  plotId?: string;
}
export interface SceneItem {
  kind: 'scene';
  title?: string;
  objects: SceneObject[];
}

/** Inner axes use the same relative margins in validation and rendering. */
export function scenePlotBounds(object: SceneGeometry): SceneGeometry {
  return { x: object.x + object.w * 0.12, y: object.y + object.h * 0.04, w: object.w * 0.84, h: object.h * 0.8 };
}
export function projectScenePoint(object: SceneObject, x: number, y: number): [number, number] {
  if (object.type !== 'plot' || !object.plot) throw new Error('Scene coordinate binding requires a plot.');
  const area = scenePlotBounds(object);
  return [
    area.x + ((x - object.plot.x[0]) / (object.plot.x[1] - object.plot.x[0])) * area.w,
    area.y + ((object.plot.y[1] - y) / (object.plot.y[1] - object.plot.y[0])) * area.h,
  ];
}
/** Canvas geometry for a validated object. Circles use a lower-left domain origin. */
export function sceneObjectGeometry(object: SceneObject, objects: readonly SceneObject[]): SceneGeometry {
  if (!object.plotId) return { x: object.x, y: object.y, w: object.w, h: object.h };
  const parent = objects.find((other) => other.id === object.plotId && other.type === 'plot');
  if (!parent) throw new Error(`Scene plot ${object.plotId} does not exist.`);
  const [x0, y0] = projectScenePoint(parent, object.x, object.y);
  const [x1, y1] = projectScenePoint(parent, object.x + object.w, object.y + object.h);
  return object.type === 'circle' ? { x: x0, y: y1, w: x1 - x0, h: y0 - y1 } : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

const colors = ['blue', 'green', 'pink', 'orange', 'yellow'];
const coordinate = { type: 'number', minimum: -1e6, maximum: 1e6 };
export const SCENE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'objects'],
  properties: {
    kind: { type: 'string', enum: ['scene'] },
    title: { type: 'string', maxLength: 80 },
    objects: {
      type: 'array',
      minItems: 1,
      maxItems: SCENE_MAX_OBJECTS,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'type', 'x', 'y', 'w', 'h'],
        properties: {
          id: { type: 'string', minLength: 1, maxLength: 48, pattern: '^[A-Za-z][A-Za-z0-9_-]*$' },
          type: { type: 'string', enum: [...SCENE_TYPES] },
          x: coordinate,
          y: coordinate,
          w: coordinate,
          h: coordinate,
          color: { type: 'string', enum: colors },
          text: { type: 'string', minLength: 1, maxLength: 280, description: 'Required readable content for text/math objects; math text supports LaTeX. Shapes may use text as their own label, avoiding a separate overlapping text object.' },
          values: {
            type: 'array',
            minItems: 1,
            maxItems: 6,
            items: { type: 'array', minItems: 1, maxItems: 6, items: { type: 'number', minimum: -1e6, maximum: 1e6 } },
          },
          plot: {
            ...PLOT_SCHEMA,
            properties: {
              ...PLOT_SCHEMA.properties,
              kind: { type: 'string', enum: ['plot'] },
              curves: {
                ...PLOT_SCHEMA.properties.curves,
                items: {
                  ...PLOT_SCHEMA.properties.curves.items,
                  properties: {
                    ...PLOT_SCHEMA.properties.curves.items.properties,
                    color: { type: 'string', enum: colors },
                  },
                },
              },
            },
          },
          background: { type: 'boolean' },
          plotId: { type: 'string', minLength: 1, maxLength: 48, description: 'Bind arrow/vector/circle to this plot object using data coordinates. Arrow/vector x,y start and w,h are signed endpoint deltas. Circle x,y is its LOWER-LEFT bounding corner; w,h are positive diameters, so center (u,v) needs x=u-w/2,y=v-h/2.' },
        },
      },
    },
  },
};

const raw = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e6;
const line = (object: SceneObject) => object.type === 'arrow' || object.type === 'vector';
const EPS = 1e-8;
const inside = (value: number, lo: number, hi: number) => value >= lo - EPS && value <= hi + EPS;
const box = (g: SceneGeometry) => ({
  x0: Math.min(g.x, g.x + g.w),
  y0: Math.min(g.y, g.y + g.h),
  x1: Math.max(g.x, g.x + g.w),
  y1: Math.max(g.y, g.y + g.h),
});
const overlaps = (a: ReturnType<typeof box>, b: ReturnType<typeof box>) =>
  a.x0 < b.x1 - EPS && a.x1 > b.x0 + EPS && a.y0 < b.y1 - EPS && a.y1 > b.y0 + EPS;
/** Intersect the actual segment, not its enclosing rectangle; boundary contact is allowed. */
function crosses(g: SceneGeometry, target: ReturnType<typeof box>): boolean {
  let lo = 0,
    hi = 1;
  const r = { x0: target.x0 + EPS, y0: target.y0 + EPS, x1: target.x1 - EPS, y1: target.y1 - EPS };
  if (r.x0 >= r.x1 || r.y0 >= r.y1) return false;
  for (const [p, q] of [
    [-g.w, g.x - r.x0],
    [g.w, r.x1 - g.x],
    [-g.h, g.y - r.y0],
    [g.h, r.y1 - g.y],
  ]) {
    if (Math.abs(p) < EPS) {
      if (q < 0) return false;
    } else if (p < 0) lo = Math.max(lo, q / p);
    else hi = Math.min(hi, q / p);
    if (lo > hi) return false;
  }
  return hi - lo > EPS;
}

/** Keep exact small numbers, and mark a shortened matrix value as approximate. */
export function sceneMatrixText(value: number): string {
  const text = String(value);
  if (Number.isInteger(value) || (!/[eE]/.test(text) && (text.split('.')[1]?.length ?? 0) <= 4)) return text;
  const rounded = Number(value.toPrecision(3));
  return `${rounded === value ? '' : '≈'}${rounded}`;
}

/** Font-independent minimums for the 600×400 scene. They keep a 400px-wide
 * board readable instead of asking the renderer to shrink text indefinitely.
 * Text width is a conservative character estimate; KaTeX validity is checked
 * separately by the authoring pipeline. No bounds are changed here. */
function readabilityProblem(object: SceneObject, geometry: SceneGeometry): string | null {
  const width = Math.abs(geometry.w) * 600,
    height = Math.abs(geometry.h) * 400;
  const name = `Scene object ${object.id}`;
  if (object.type === 'matrix' && object.values) {
    const rows = object.values.length,
      columns = object.values[0].length;
    const longest = Math.max(...object.values.flat().map((value) => sceneMatrixText(value).length));
    const labelHeight = object.text ? Math.min(28, height * 0.23) : 0;
    const cellWidth = (width - 20) / columns,
      cellHeight = (height - labelHeight - 8) / rows;
    const fontSize = Math.min(21, cellWidth / (longest * 0.64), cellHeight * 0.48);
    if (fontSize < 16 - EPS)
      return `${name} is too small for a readable ${rows}×${columns} matrix; enlarge its bounds so each cell fits its displayed values at 16px or larger.`;
    if (object.text && estimatedTextWidth(object.text, 17) > width - 10)
      return `${name} matrix label does not fit; shorten the label or widen the matrix.`;
    return null;
  }
  if (!object.text || !['text', 'math', 'rect', 'circle'].includes(object.type)) return null;
  if (object.type === 'math') {
    const glyphs = object.text
      .replace(/\\(?:left|right|displaystyle|textstyle)\b/g, '')
      .replace(/\\[A-Za-z]+/g, 'M')
      .replace(/[{}_^]/g, '');
    const stacked = /\\(?:[dt]?frac|binom|begin)\b/.test(object.text);
    const neededWidth = estimatedTextWidth(glyphs, 22) + 10;
    const neededHeight = (stacked ? 56 : /[_^]/.test(object.text) ? 36 : 28) + 10;
    if (width + EPS < Math.max(40, neededWidth) || height + EPS < neededHeight)
      return `${name} is too small for readable math; enlarge its bounds (at least ${Math.ceil(neededWidth)}×${neededHeight} in the 600×400 scene) or use a shorter expression.`;
    return null;
  }
  const available = width - 10;
  let lines = 1,
    used = 0;
  for (const word of object.text.trim().split(/\s+/)) {
    const wordWidth = estimatedTextWidth(word, 20),
      space = used ? 6 : 0;
    if (used && used + space + wordWidth > available) {
      lines++;
      used = 0;
    }
    if (available > 0 && wordWidth > available) {
      const count = Math.ceil(wordWidth / available);
      lines += count - 1;
      used = wordWidth - (count - 1) * available;
    } else used += (used ? space : 0) + wordWidth;
  }
  if (available < 30 || height + EPS < lines * 25 + 10)
    return `${name} is too small for readable text; widen it or allow at least ${lines * 25 + 10}px height in the 600×400 scene for its ${lines} text line(s).`;
  return null;
}

function estimatedTextWidth(text: string, fontSize: number): number {
  return Array.from(text).reduce(
    (width, char) =>
      width +
      fontSize *
        (/\s/.test(char)
          ? 0.3
          : /[ilI1.,'`!:;]/.test(char)
            ? 0.32
            : /[MW@%]/.test(char)
              ? 0.9
              : /[\u2E80-\uFFFF]/.test(char)
                ? 1
                : 0.62),
    0,
  );
}

/** Reject an invalid authored scene as a whole: never drop, clamp or reposition its objects. */
export function sceneProblems(value: unknown): string[] {
  if (!raw(value)) return ['Scene must be an object.'];
  const problems: string[] = [];
  if (value.kind !== 'scene') problems.push('Unknown scene kind.');
  if (Object.keys(value).some((key) => !['kind', 'title', 'objects'].includes(key)))
    problems.push('Scene contains unsupported fields.');
  if (value.title !== undefined && (typeof value.title !== 'string' || value.title.length > 80))
    problems.push('Scene title must be at most 80 characters.');
  if (!Array.isArray(value.objects) || !value.objects.length || value.objects.length > SCENE_MAX_OBJECTS)
    return [...problems, `Scene needs 1–${SCENE_MAX_OBJECTS} objects.`];
  const ids = new Set<string>();
  const objects: SceneObject[] = [];
  for (const [i, entry] of value.objects.entries()) {
    const name = `Scene object ${i + 1}`;
    const before = problems.length;
    if (!raw(entry)) {
      problems.push(`${name} must be an object.`);
      continue;
    }
    if (Object.keys(entry).some((key) => !Object.keys(SCENE_SCHEMA.properties.objects.items.properties).includes(key)))
      problems.push(`${name} contains unsupported fields.`);
    if (typeof entry.id !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(entry.id))
      problems.push(`${name} needs a stable alphanumeric ID.`);
    else if (ids.has(entry.id)) problems.push(`${name} repeats ID ${entry.id}.`);
    else ids.add(entry.id);
    if (!SCENE_TYPES.includes(entry.type as SceneObjectType)) problems.push(`${name} has an unsupported type.`);
    if (!['x', 'y', 'w', 'h'].every((key) => finite(entry[key])))
      problems.push(`${name} needs finite bounded x/y/w/h coordinates.`);
    if (entry.color !== undefined && !colors.includes(entry.color as string))
      problems.push(`${name} has an unsupported color.`);
    if (entry.background !== undefined && typeof entry.background !== 'boolean')
      problems.push(`${name} background must be a boolean.`);
    if (entry.text !== undefined && (typeof entry.text !== 'string' || !entry.text.trim() || entry.text.length > 280))
      problems.push(`${name} text must contain 1–280 characters.`);
    if (['text', 'math'].includes(entry.type as string) && !entry.text) problems.push(`${name} needs text.`);
    if (
      entry.type === 'math' &&
      typeof entry.text === 'string' &&
      /\\(?:href|url|includegraphics|html[A-Za-z]*|class|style|require)\b/.test(entry.text)
    )
      problems.push(`${name} math cannot use HTML, styles, links or external resources.`);
    if (entry.values !== undefined && entry.type !== 'matrix')
      problems.push(`${name} values are only supported by matrices.`);
    if (entry.type === 'matrix') {
      const values = entry.values;
      if (
        !Array.isArray(values) ||
        !values.length ||
        values.length > 6 ||
        !Array.isArray(values[0]) ||
        !values[0].length ||
        values[0].length > 6 ||
        !values.every((row) => Array.isArray(row) && row.length === values[0].length && row.every(finite))
      )
        problems.push(`${name} needs a rectangular 1×1 to 6×6 matrix of finite values.`);
    }
    if (entry.plot !== undefined && entry.type !== 'plot')
      problems.push(`${name} plot data is only supported by plot objects.`);
    if (entry.type === 'plot') {
      problems.push(...plotProblems(entry.plot).map((problem) => `${name}: ${problem}`));
      if (entry.text !== undefined) problems.push(`${name} uses plot title/axis labels instead of text.`);
    }
    if (
      entry.background &&
      (!['rect', 'circle', 'arrow', 'vector', 'plot'].includes(entry.type as string) || entry.text !== undefined)
    )
      problems.push(`${name} background is reserved for unlabeled geometry or a plot.`);
    if (
      entry.plotId !== undefined &&
      (typeof entry.plotId !== 'string' ||
        !entry.plotId ||
        !['arrow', 'vector', 'circle'].includes(entry.type as string))
    )
      problems.push(`${name} plotId is supported only by arrows, vectors and circles.`);
    if (['x', 'y', 'w', 'h'].every((key) => finite(entry[key]))) {
      const object = entry as unknown as SceneObject;
      if (line(object) ? Math.hypot(object.w, object.h) < EPS : object.w <= 0 || object.h <= 0)
        problems.push(`${name} must have a positive area, or a nonzero directed length.`);
      if (
        !object.plotId &&
        (![object.x, object.x + object.w].every((n) => inside(n, 0, 1)) ||
          ![object.y, object.y + object.h].every((n) => inside(n, 0, 1)))
      )
        problems.push(`${name} lies outside the normalized scene bounds.`);
    }
    if (before === problems.length) objects.push(entry as unknown as SceneObject);
  }
  const geometries = new Map<string, SceneGeometry>();
  for (const object of objects) {
    if (object.plotId) {
      const parent = objects.find((other) => other.id === object.plotId && other.type === 'plot');
      if (!parent?.plot) {
        problems.push(`Scene object ${object.id} references a missing or invalid plot ${object.plotId}.`);
        continue;
      }
      if (
        ![object.x, object.x + object.w].every((n) => inside(n, ...parent.plot!.x)) ||
        ![object.y, object.y + object.h].every((n) => inside(n, ...parent.plot!.y))
      ) {
        problems.push(`Scene object ${object.id} lies outside plot ${object.plotId}'s domain.`);
        continue;
      }
    }
    const geometry = sceneObjectGeometry(object, objects);
    geometries.set(object.id, geometry);
    const unreadable = readabilityProblem(object, geometry);
    if (unreadable) problems.push(unreadable);
  }
  for (let i = 0; i < objects.length; i++)
    for (let j = i + 1; j < objects.length; j++) {
      const a = objects[i],
        b = objects[j],
        ag = geometries.get(a.id),
        bg = geometries.get(b.id);
      if (!ag || !bg || a.plotId === b.id || b.plotId === a.id) continue;
      // Free normalized overlays cannot pretend to align with a plot's padded axes.
      const unbound =
        a.type === 'plot' && ['arrow', 'vector', 'circle'].includes(b.type) && !b.plotId
          ? ([b, bg, ag] as const)
          : b.type === 'plot' && ['arrow', 'vector', 'circle'].includes(a.type) && !a.plotId
            ? ([a, ag, bg] as const)
            : null;
      if (
        unbound &&
        (line(unbound[0]) ? crosses(unbound[1], box(unbound[2])) : overlaps(box(unbound[1]), box(unbound[2])))
      ) {
        problems.push(`Scene object ${unbound[0].id} overlaps a plot without plotId coordinate binding.`);
        continue;
      }
      if (a.background || b.background || (line(a) && line(b))) continue;
      const collision = line(a) ? crosses(ag, box(bg)) : line(b) ? crosses(bg, box(ag)) : overlaps(box(ag), box(bg));
      if (collision)
        problems.push(
          `Scene objects ${a.id} and ${b.id} overlap; author separate readable bounds or explicit unlabeled background geometry.`,
        );
    }
  return problems;
}
