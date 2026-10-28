// Pen geometry tests: arrows and circles from scene.ts, and where their labels go. Run with
// `npm test` (esbuild bundles this file for Node, no test framework needed).

import { TourEngine } from '../src/engine';
import { layoutPages } from '../src/layout';
import { SilentNarrator } from '../src/narration/silent';
import { Resolver } from '../src/resolve';
import { ARROW_GAP, ARROW_MAX, ARROW_MIN, CIRCLE_PAD, buildScene, penArrow, penCircle, penRandom } from '../src/scene';
import type { PenArrowShape, PenSide } from '../src/scene';
import { penLabelPosition } from '../src/components/ScreenLayer';
import type { BBox, Doc, OverlayAction, Tour } from '../src/types';

// ------------------------------------------------------------------ harness

let failures = 0;
const results: string[] = [];

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push(`  ok    ${name}`);
  } catch (err) {
    failures++;
    results.push(`  FAIL  ${name}\n        ${(err as Error).message}`);
  }
}

function eq<T>(actual: T, expected: T, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

function ok(cond: boolean, what: string) {
  if (!cond) throw new Error(what);
}

type Point = [number, number];
const PAGE: BBox = [0, 0, 612, 792];
const INWARD: Record<PenSide, Point> = { left: [1, 0], right: [-1, 0], top: [0, 1], bottom: [0, -1] };
const length = (a: PenArrowShape) => Math.hypot(a.tip[0] - a.tail[0], a.tip[1] - a.tail[1]);

/** The arrow points into the region from its side: tip and tail outside, head facing in. */
function pointsInto(a: PenArrowShape, r: BBox, side: PenSide) {
  const [ix, iy] = INWARD[side];
  const outside = (p: Point) =>
    side === 'left' ? p[0] < r[0] : side === 'right' ? p[0] > r[2] : side === 'top' ? p[1] < r[1] : p[1] > r[3];
  ok(outside(a.tip) && outside(a.tail), `${side}: tip and tail lie outside the region`);
  const gap = { left: r[0] - a.tip[0], right: a.tip[0] - r[2], top: r[1] - a.tip[1], bottom: a.tip[1] - r[3] }[side];
  ok(Math.abs(gap - ARROW_GAP) < 0.01, `${side}: tip ${gap.toFixed(2)}pt from the region`);
  const facing = Math.cos((a.angle * Math.PI) / 180) * ix + Math.sin((a.angle * Math.PI) / 180) * iy;
  ok(facing > Math.cos(Math.PI / 4), `${side}: head faces the region (${facing.toFixed(2)})`);
  ok(length(a) >= ARROW_MIN * 0.99 && length(a) <= ARROW_MAX * 1.01, `${side}: shaft length ${length(a).toFixed(1)}`);
}

/** Points of a path made of M and C commands, sampled along its cubic segments. */
function sample(d: string): Point[] {
  const n = (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
  const pts: Point[] = [[n[0], n[1]]];
  for (let i = 2; i + 5 < n.length; i += 6) {
    const p0 = pts[pts.length - 1];
    for (let s = 1; s <= 12; s++) {
      const t = s / 12;
      const u = 1 - t;
      const b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      pts.push([
        b[0] * p0[0] + b[1] * n[i] + b[2] * n[i + 2] + b[3] * n[i + 4],
        b[0] * p0[1] + b[1] * n[i + 1] + b[2] * n[i + 3] + b[3] * n[i + 5],
      ]);
    }
  }
  return pts;
}

function inside([x, y]: Point, poly: Point[]) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}

// ------------------------------------------------------------------ tests

await test('pen randomness depends only on the key', () => {
  const a = penRandom('3:1');
  const b = penRandom('3:1');
  const seq = [a(), a(), a()];
  eq([b(), b(), b()], seq, 'same key, same numbers');
  ok(seq.every((v) => v >= 0 && v < 1), 'values in [0, 1)');
  ok(penRandom('3:2')() !== seq[0], 'another key, other numbers');
  const r: BBox = [200, 300, 260, 340];
  eq(penArrow('k', 'blue', r, PAGE, null), penArrow('k', 'blue', r, PAGE, null), 'arrow');
  eq(penCircle('k', 'pink', r).d, penCircle('k', 'pink', r).d, 'circle');
  ok(penCircle('k', 'pink', r).d !== penCircle('j', 'pink', r).d, 'keys vary the hand');
});

await test('arrows come from the side they are asked to', () => {
  const r: BBox = [250, 350, 330, 400];
  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    for (const key of ['0:0', '4:2', 'selection:fig1']) {
      const a = penArrow(key, 'blue', r, PAGE, null, side);
      eq(a.side, side, 'side');
      pointsInto(a, r, side);
      eq(a.labelSide, side, 'label beyond the tail');
    }
  }
});

await test('auto arrows take the side with room', () => {
  // Hugging the left edge of the page: not from the left.
  const nearLeft = penArrow('a', 'blue', [8, 300, 80, 330], PAGE, null);
  eq(nearLeft.side, 'right', 'away from the edge');
  pointsInto(nearLeft, [8, 300, 80, 330], 'right');
  // Plenty of room everywhere: ties go to the left.
  eq(penArrow('b', 'blue', [250, 350, 330, 400], PAGE, null).side, 'left', 'tie order');
  // In the top-left corner: from the right or below, and the tail stays on the page.
  const corner = penArrow('c', 'blue', [4, 4, 60, 30], PAGE, null);
  ok(corner.side === 'right' || corner.side === 'bottom', `corner side ${corner.side}`);
  ok(corner.tail.every((v) => v >= 0), 'tail on the page');
});

await test('an explicit side with no room gives way to the opposite side', () => {
  const r: BBox = [2, 300, 80, 330];
  const a = penArrow('a', 'green', r, PAGE, null, 'left');
  eq(a.side, 'right', 'flipped');
  pointsInto(a, r, 'right');
});

await test('inside a figure, arrows start at its nearest edge and stay near it', () => {
  const figure: BBox = [100, 100, 420, 260];
  // A part near the figure's right edge: from the right, its tail just past the edge.
  const part: BBox = [330, 160, 390, 180];
  const a = penArrow('p', 'orange', part, PAGE, figure);
  eq(a.side, 'right', 'nearest edge');
  ok(a.tail[0] <= figure[2] + 0.1 * (figure[2] - figure[0]), 'tail within the figure surroundings');
  eq(a.labelSide, 'right', 'label outside the figure');
  // A panel on the left: the only side that stays near the figure is into the figure, and the
  // label then sits above the tail instead of over the neighbouring panel.
  const panel: BBox = [100, 100, 220, 250];
  const b = penArrow('q', 'orange', panel, PAGE, figure);
  eq(b.side, 'right', 'into the gap');
  ok(b.tail[0] < figure[2] && b.tail[0] > panel[2], 'tail inside the figure');
  ok(b.labelSide === 'top' || b.labelSide === 'bottom', `label above or below a deep tail, got ${b.labelSide}`);
  // The whole figure: from outside it.
  const c = penArrow('r', 'orange', figure, PAGE, figure);
  pointsInto(c, figure, c.side);
});

await test('an auto arrow keeps its tail and label off the marks drawn before it', () => {
  const figure: BBox = [100, 100, 500, 300];
  const left: BBox = [100, 100, 290, 300];
  const right: BBox = [310, 100, 500, 300];
  // Into the gap between the panels, where the loop around the left one already is: from outside instead.
  eq(penArrow('q', 'blue', right, PAGE, figure).side, 'left', 'without marks');
  const loop = penCircle('l', 'pink', left);
  const a = penArrow('q', 'blue', right, PAGE, figure, 'auto', [loop.bounds]);
  ok(a.side !== 'left', `with the loop: ${a.side}`);
  const [x, y] = a.tail;
  ok(!(x > loop.bounds[0] && x < loop.bounds[2] && y > loop.bounds[1] && y < loop.bounds[3]), 'tail off the loop');
  pointsInto(a, right, a.side);
  // An explicit side is kept, mark or not.
  eq(penArrow('q', 'blue', right, PAGE, figure, 'left', [loop.bounds]).side, 'left', 'explicit');
});

await test('text arrows come in from the margin', () => {
  // A sentence ending near the right of its column [108, 504].
  const column: BBox = [108, 0, 504, 792];
  const a = penArrow('t', 'blue', [380, 600, 470, 610], PAGE, column);
  eq(a.side, 'right', 'nearest margin');
  ok(a.tail[0] > 470, 'tail to the right');
});

await test('circles enclose their region with padding, without ballooning', () => {
  const regions: BBox[] = [
    [100, 100, 130, 115], // a symbol
    [100, 100, 200, 200], // a square
    [108, 300, 504, 311], // a text line
    [220, 465, 390, 491], // an equation
    [150, 100, 180, 400], // a tall strip
    [196, 72, 416, 394], // a whole figure
  ];
  for (const r of regions) {
    for (const key of ['0:0', '7:3', 'x']) {
      const c = penCircle(key, 'green', r);
      const loop = sample(c.d);
      const p = CIRCLE_PAD;
      const corners: Point[] = [
        [r[0] - p, r[1] - p],
        [r[2] + p, r[1] - p],
        [r[2] + p, r[3] + p],
        [r[0] - p, r[3] + p],
      ];
      ok(corners.every((q) => inside(q, loop)), `padded corners of ${r} inside the loop (${key})`);
      const w = r[2] - r[0];
      const h = r[3] - r[1];
      const [bx0, by0, bx1, by1] = c.bounds;
      ok(loop.every(([x, y]) => x >= bx0 && x <= bx1 && y >= by0 && y <= by1), 'bounds hold the loop');
      const slack = 0.75 * Math.max(w, h) + 40;
      ok(bx1 - bx0 < w + slack && by1 - by0 < h + slack, `loop around ${r} is not huge`);
      // One stroke, a little past its start: the end runs close outside the start.
      const [sx, sy] = loop[0];
      const end = loop.slice(Math.floor(loop.length * 0.9));
      const gap = Math.min(...end.map(([x, y]) => Math.hypot(x - sx, y - sy)));
      ok(gap > 1 && gap < 6, `end passes ${gap.toFixed(1)}pt from the start`);
    }
  }
});

await test('a loop around a line or an equation hugs it above and below', () => {
  const clearance = (r: BBox, key: string) => {
    const loop = sample(penCircle(key, 'blue', r).d);
    const ys = loop.map(([, y]) => y);
    const xs = loop.map(([x]) => x);
    return { above: r[1] - Math.min(...ys), below: Math.max(...ys) - r[3], ends: Math.max(...xs) - r[2] };
  };
  for (const key of ['0:0', '7:3', 'x']) {
    // Lines of text sit about 12pt apart: the loop must not run through the ones around it.
    const line = clearance([108, 300, 504, 311], key);
    ok(line.above < 8 && line.below < 8, `around a line: ${line.above.toFixed(1)} and ${line.below.toFixed(1)}`);
    const equation = clearance([220, 465, 390, 491], key);
    ok(equation.above < 10 && equation.below < 10, `around an equation: ${equation.above.toFixed(1)} above`);
    ok(equation.ends < 30, `the white space at its ends takes the rest: ${equation.ends.toFixed(1)}`);
  }
});

await test('scene: arrows and circles become page shapes with pinned labels', () => {
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'paper.pdf', sha256: '0'.repeat(64), num_pages: 2, generator: 'test' },
    pages: [
      { n: 1, width: 600, height: 800 },
      { n: 2, width: 600, height: 800 },
    ],
    sections: [],
    blocks: [{ id: 'p2.b1', page: 2, type: 'paragraph', bbox: [100, 500, 500, 540], text: 'A.', sentences: ['p2.s1'] }],
    sentences: [{ id: 'p2.s1', page: 2, block: 'p2.b1', text: 'A.', rects: [[100, 500, 300, 510]] }],
    figures: [
      {
        id: 'fig1',
        kind: 'figure',
        number: '1',
        page: 2,
        bbox: [100, 200, 500, 400],
        caption: '',
        image: 'f.png',
        panels: [{ id: 'fig1.a', bbox: [100, 200, 260, 400] }],
        referenced_by: [],
      },
    ],
    equations: [],
  };
  const sizes = [
    { width: 600, height: 800 },
    { width: 600, height: 800 },
  ];
  const resolver = new Resolver(doc, sizes);
  const layout = layoutPages(sizes);
  const actions: OverlayAction[] = [
    { type: 'arrow', target: 'fig1.a', label: 'Here', color: 'pink' },
    { type: 'circle', target: 'fig1', region: [0.5, 0, 1, 0.5], label: 'And here' },
    { type: 'arrow', target: 'p2.s1' },
    { type: 'circle', target: 'nope' },
  ];
  const overlays = actions.map((action, i) => ({ key: `0:${i + 1}`, step: 0, persist: false, action }));
  const scene = buildScene(overlays, resolver, layout);
  const pens = scene.pages.get(2)?.pens ?? [];
  eq(
    pens.map((p) => [p.kind, p.key, p.color]),
    [
      ['arrow', '0:1', 'pink'],
      ['circle', '0:2', 'yellow'],
      ['arrow', '0:3', 'yellow'],
    ],
    'shapes, keys and colours',
  );
  const arrow = pens[0] as PenArrowShape;
  eq(arrow.side, 'right', 'a left panel is pointed at from inside its figure');
  const box = layout.pages[1];
  eq(
    scene.labels.map((l) => [l.key, l.text, l.pin?.side]),
    [
      ['0:1', 'Here', arrow.labelSide],
      ['0:2', 'And here', 'upper-right'],
    ],
    'labels',
  );
  const [label] = scene.labels;
  eq([label.pin?.x, label.pin?.y], [box.x + arrow.tail[0], box.y + arrow.tail[1]], 'label hangs from the tail');
  const [x0, y0, x1, y1] = arrow.bounds;
  eq(label.rect, [box.x + x0, box.y + y0, box.x + x1, box.y + y1], 'label rect is the mark');
  const again = buildScene(overlays, resolver, layout);
  eq(JSON.stringify(again.pages.get(2)), JSON.stringify(scene.pages.get(2)), 'rebuilt identically');
});

await test('pen marks persist and clear like other overlays', () => {
  const tour: Tour = {
    schema: 'paper-tour/tour@0.1',
    title: 'Pen',
    paper: 'test',
    chapters: [
      {
        id: 'c',
        title: 'C',
        steps: [
          {
            id: 'a',
            say: 'one two',
            actions: [
              { type: 'arrow', target: 'fig1', persist: true },
              { type: 'circle', target: 'fig1' },
            ],
          },
          { id: 'b', say: 'three', actions: [{ type: 'circle', target: 'fig1.a', at_word: 0 }] },
          { id: 'c', say: 'four', actions: [{ type: 'clear' }] },
        ],
      },
    ],
  };
  const engine = new TourEngine(tour, { narrator: new SilentNarrator() });
  const keys = () => engine.getState().overlays.map((o) => `${o.key}:${o.action.type}`);
  engine.goTo(0);
  eq(keys(), ['0:0:arrow', '0:1:circle'], 'step one');
  engine.goTo(1);
  eq(keys(), ['0:0:arrow', '1:0:circle'], 'the persistent arrow stays');
  engine.goTo(2);
  eq(keys(), [], 'clear removes it');
  engine.destroy();
});

await test('pen labels sit beside their point and inside the viewport', () => {
  const vp = { width: 800, height: 600 };
  const size = { w: 90, h: 22 };
  const left = penLabelPosition(400, 300, 'left', size, vp);
  ok(left.left + size.w < 400 && Math.abs(left.top + size.h / 2 - 300) < 0.01, 'left of the tail, centred');
  const top = penLabelPosition(400, 300, 'top', size, vp);
  ok(top.top + size.h < 300 && Math.abs(top.left + size.w / 2 - 400) < 0.01, 'above the tail, centred');
  const loop = penLabelPosition(400, 300, 'upper-right', size, vp);
  ok(loop.left > 400 && loop.top + size.h < 300, 'up and right of a circle');
  for (const [x, y] of [
    [-50, -40],
    [790, 590],
    [5, 300],
    [400, 2],
  ]) {
    for (const side of ['left', 'right', 'top', 'bottom', 'upper-right'] as const) {
      for (const more of [{}, { alt: 'top' as const, center: { x: 300, y: 300 } }]) {
        const p = penLabelPosition(x, y, side, size, vp, more);
        const within = p.left >= 0 && p.top >= 0 && p.left + size.w <= vp.width && p.top + size.h <= vp.height;
        ok(within, `inside at ${x},${y} ${side}`);
      }
    }
  }
  // A tail near the left edge: the label moves above it instead of being pushed back over it.
  const edge = penLabelPosition(40, 300, 'left', size, vp, { alt: 'top' });
  ok(edge.top + size.h < 300 && Math.abs(edge.left + size.w / 2 - 40) < 31, 'above the tail at the edge');
  eq(penLabelPosition(400, 300, 'left', size, vp, { alt: 'top' }), left, 'the first side when it fits');
  // A circle near the right edge: its label takes the upper-left corner.
  const corner = penLabelPosition(760, 200, 'upper-right', size, vp, { center: { x: 700, y: 260 } });
  ok(corner.left + size.w < 640 + 1 && corner.top + size.h < 200, `upper left of the loop: ${JSON.stringify(corner)}`);
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} pen tests passed`);
