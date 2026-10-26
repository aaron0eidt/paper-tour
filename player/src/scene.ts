// Turns the engine's active overlays into geometry: SVG shapes per page (in page points) and
// screen-space items (notes, box labels) anchored to stage rects.

import { DEFAULT_COLOR } from './types';
import type { BBox, Color, NoteAction } from './types';
import { stageRect } from './layout';
import type { Layout } from './layout';
import type { OverlayEntry } from './engine';
import { unionRect } from './resolve';
import type { Resolver } from './resolve';

export const BOX_PAD = 3;
export const SPOT_PAD = 5;

export interface PageShapes {
  markers: { key: string; rects: BBox[]; color: Color }[];
  underlines: { key: string; rects: BBox[]; color: Color }[];
  boxes: { key: string; rect: BBox; color: Color }[];
  /** Spotlight holes on this page. */
  holes: BBox[];
}

export interface SceneNote {
  key: string;
  text: string;
  side: NonNullable<NoteAction['side']>;
  /** Anchor in stage coordinates. */
  rect: BBox;
}

export interface SceneLabel {
  key: string;
  text: string;
  color: Color;
  rect: BBox;
}

export interface Scene {
  pages: Map<number, PageShapes>;
  /** Any spotlight active: every page dims except the holes. */
  spotlight: boolean;
  notes: SceneNote[];
  labels: SceneLabel[];
}

const pad = (r: BBox, d: number): BBox => [r[0] - d, r[1] - d, r[2] + d, r[3] + d];
const overlaps = (a: BBox, b: BBox) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

/**
 * The spotlight is one even-odd path, where two overlapping holes would cancel out and dim their
 * overlap. Overlapping holes are therefore merged into their bounding rect (exact for nested ones,
 * such as a panel inside its figure or a sentence inside its paragraph).
 */
export function mergeHoles(holes: BBox[]): BBox[] {
  const out: BBox[] = [];
  for (const hole of holes) {
    let r = hole;
    for (let i = 0; i < out.length; ) {
      if (overlaps(out[i], r)) {
        r = unionRect([out[i], r]);
        out.splice(i, 1);
        i = 0; // the grown rect may now overlap one that was checked already
      } else i++;
    }
    out.push(r);
  }
  return out;
}

export function buildScene(overlays: OverlayEntry[], resolver: Resolver, layout: Layout): Scene {
  const scene: Scene = { pages: new Map(), spotlight: false, notes: [], labels: [] };
  const page = (n: number) => {
    let shapes = scene.pages.get(n);
    if (!shapes) scene.pages.set(n, (shapes = { markers: [], underlines: [], boxes: [], holes: [] }));
    return shapes;
  };

  for (const { key, action: a } of overlays) {
    switch (a.type) {
      case 'highlight': {
        const color = a.color ?? DEFAULT_COLOR;
        const list = a.style === 'underline' ? 'underlines' : 'markers';
        a.targets.forEach((t, i) => {
          for (const g of resolver.resolve(t, { lines: true }) ?? []) {
            page(g.page)[list].push({ key: `${key}.${i}.${g.page}`, rects: g.rects, color });
          }
        });
        break;
      }
      case 'box': {
        const groups = resolver.resolveTarget(a.target, a.region);
        const color = a.color ?? DEFAULT_COLOR;
        const g = groups?.[0];
        if (!g) break;
        const rect = pad(stageRect(layout, [g])!.rect, BOX_PAD);
        const local = pad(unionRect(g.rects), BOX_PAD);
        page(g.page).boxes.push({ key, rect: local, color });
        if (a.label) scene.labels.push({ key, text: a.label, color, rect });
        break;
      }
      case 'spotlight': {
        scene.spotlight = true;
        for (const g of resolver.resolveTarget(a.target, a.region) ?? []) {
          page(g.page).holes.push(pad(unionRect(g.rects), SPOT_PAD));
        }
        break;
      }
      case 'note': {
        const groups = resolver.resolveTarget(a.anchor, a.region);
        const target = groups && stageRect(layout, groups);
        if (target) scene.notes.push({ key, text: a.text, side: a.side ?? 'auto', rect: target.rect });
        break;
      }
    }
  }
  for (const shapes of scene.pages.values()) {
    if (shapes.holes.length > 1) shapes.holes = mergeHoles(shapes.holes);
  }
  return scene;
}
