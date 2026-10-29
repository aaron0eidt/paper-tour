// Pen geometry tests: arrows and circles from scene.ts, and where their labels go. Run with
// `npm test` (esbuild bundles this file for Node, no test framework needed).

import { TourEngine } from '../src/engine';
import { layoutPages, toStage } from '../src/layout';
import { project } from '../src/camera';
import { SilentNarrator } from '../src/narration/silent';
import { Resolver } from '../src/resolve';
import { ARROW_GAP, ARROW_MAX, ARROW_MIN, BOX_PAD, CIRCLE_PAD, buildScene, externalArrow, penArrow, penCircle, paddedBox, penRandom } from '../src/scene';
import type { PenArrowShape, PenSide } from '../src/scene';
import { penLabelPosition } from '../src/components/ScreenLayer';
import { DEFAULT_COLOR } from '../src/types';
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
  eq(arrow.side, 'left', 'a left panel is pointed at from outside its figure');
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

await test('external leaders avoid printed content even when an explicit side would cross it', () => {
  const area: BBox = [100, 100, 500, 400];
  const target: BBox = [120, 120, 160, 140];
  const obstacles: BBox[] = [[80, 110, 116, 150]];
  const a = externalArrow('external', 'blue', target, PAGE, area, obstacles, 'left');
  ok(!!a, 'an unobstructed route exists');
  if (!a) return;
  ok(a.side !== 'left', 'preferred side yields to printed content');
  ok(a.tail[0] < area[0] || a.tail[0] > area[2] || a.tail[1] < area[1] || a.tail[1] > area[3], 'tail and label pin are outside the parent figure');
  for (let n = 0; n <= 100; n++) {
    const t = n / 100, x = a.tail[0] + (a.tip[0] - a.tail[0]) * t, y = a.tail[1] + (a.tip[1] - a.tail[1]) * t;
    ok(obstacles.every(r => x < r[0] - 2 || x > r[2] + 2 || y < r[1] - 2 || y > r[3] + 2), 'shaft clears the printed obstacle with stroke padding');
  }
  ok(length(a) <= ARROW_MAX, 'boundary leaders stay short');
  eq(externalArrow('central', 'blue', [280, 230, 320, 250], PAGE, area), null, 'empty extracted text does not license a long leader across unknown diagram artwork');
  eq(externalArrow('external', 'blue', target, PAGE, area, obstacles, 'left'), a, 'route is stable between renders');
});

await test('exact boxes keep at most two points of padding and share neighbouring clearance', () => {
  const target: BBox = [100, 100, 200, 150];
  eq(paddedBox(target, []), [98, 98, 202, 152], 'empty surroundings use two points');
  eq(paddedBox(target, [[0, 0, 500, 500], [110, 110, 180, 140]]), [98, 98, 202, 152], 'parent figure and interior text do not alter target bounds');
  eq(paddedBox(target, [[201, 100, 250, 150], [100, 151, 200, 190], [50, 100, 99, 150]]),
    [99.5, 98, 200.5, 150.5], 'padding uses no more than half the measured neighbour gap');
  eq(paddedBox(target, [[200, 100, 250, 150]]), [98, 98, 200, 152], 'touching components receive no extra padding at their shared edge');
});

await test('blocked legacy arrows retain the authored arrow, while exact figure text gets an exterior leader', () => {
  const target: BBox = [260, 220, 300, 260], area: BBox = [100, 100, 500, 400];
  const ring: BBox[] = [[0, 0, 612, 216], [0, 264, 612, 792], [0, 0, 256, 792], [304, 0, 612, 792]];
  eq(externalArrow('blocked', 'pink', target, PAGE, area, ring), null, 'no route is invented through occupied content');
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1', source: { file: 'paper.pdf', sha256: '0'.repeat(64), num_pages: 1, generator: 'test' },
    pages: [{ n: 1, width: 612, height: 792 }], sections: [], equations: [], sentences: [],
    blocks: ring.map((bbox, i) => ({ id: `p1.b${i}`, page: 1, type: 'paragraph', text: 'Printed content', bbox, sentences: [] })),
    figures: [{ id: 'fig1', kind: 'figure', number: '1', page: 1, bbox: area, panels: [{ id: 'fig1.a', bbox: target }], caption: '', image: '', referenced_by: [] }],
  };
  const layout = layoutPages(doc.pages);
  const overlays = [{ key: 'blocked', step: 0, persist: false, action: { type: 'arrow' as const, target: 'fig1.a', label: 'Component' } }];
  const scene = buildScene(overlays, new Resolver(doc, doc.pages), layout);
  eq(scene.pages.get(1)?.pens[0], penArrow('blocked', DEFAULT_COLOR, target, PAGE, area), 'legacy geometry is not silently replaced with an outline or dropped');
  eq(scene.labels.length, 1, 'authored label remains available to the measured placement layer');

  const precise: Doc = { ...doc, blocks: [{ id: 'component', page: 1, type: 'figure_text', text: 'Operation', bbox: [120, 170, 160, 184], sentences: [] }] };
  const exact = buildScene([{ ...overlays[0], action: { type: 'arrow', target: 'component', label: 'Operation' } }], new Resolver(precise, precise.pages), layout);
  const arrow = exact.pages.get(1)?.pens[0] as PenArrowShape;
  eq(arrow.kind, 'arrow', 'grounded component gets a safe leader');
  ok(arrow.tail[0] < area[0], 'figure_text target uses parent figure, not a text-column heuristic');
  eq(exact.labels[0].area, toStage(layout, 1, area), 'label carries the full parent figure exclusion');
  ok(exact.obstacles.some(r => JSON.stringify(r) === JSON.stringify(toStage(layout, 1, area))), 'screen labels receive the parent figure as occupied content');
});

await test('legacy grid marks are never silently reinterpreted as whole-figure overviews', () => {
  const figure: BBox = [100, 120, 500, 440];
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1', source: { file: 'raster.pdf', sha256: '0'.repeat(64), num_pages: 1, generator: 'test' },
    pages: [{ n: 1, width: 612, height: 792 }], blocks: [], sentences: [], equations: [], sections: [],
    figures: [{ id: 'fig1', kind: 'figure', number: '1', page: 1, bbox: figure, caption: '', image: 'raster.png', referenced_by: [],
      panels: [{ id: 'fig1.a', bbox: [150, 180, 250, 280] }] }],
  };
  const resolver = new Resolver(doc, doc.pages), layout = layoutPages(doc.pages);
  const entries = (actions: OverlayAction[]) => actions.map((action, i) => ({ key: `legacy:${i}`, step: 0, persist: false, action }));
  const scene = buildScene(entries([
    { type: 'arrow', target: 'fig1', region: [0, 0.6, 0.4, 1], label: 'Input' },
    { type: 'circle', target: 'fig1', region: [0, 0.3, 0.4, 0.7], label: 'Mixing' },
    { type: 'box', target: 'fig1', region: [0.5, 0, 1, 1], label: 'Output' },
    { type: 'circle', target: 'fig1.a', region: [0.3, 0.3, 0.7, 0.7], label: 'Inside panel' },
  ]), resolver, layout);
  eq(scene.pages.get(1)?.pens.length, 3, 'the three authored pen actions stay distinct');
  eq(scene.pages.get(1)?.pens.map(pen => pen.kind), ['arrow', 'circle', 'circle'], 'authored action types are preserved');
  eq(scene.pages.get(1)?.boxes[0].rect, [298, 118, 502, 442], 'legacy box remains its authored region and needs regeneration');
  eq(scene.labels.length, 4, 'labels are not discarded by shape substitution');
  eq(scene.pages.get(1)?.pens[1], penCircle('legacy:1', DEFAULT_COLOR, [100, 216, 260, 344]), 'broad circle retains canonical circle geometry');
  const precise = buildScene(entries([{ type: 'circle', target: 'fig1', region: [0.12, 0.24, 0.36, 0.49] }]), resolver, layout);
  eq(precise.pages.get(1)?.pens[0], penCircle('legacy:0', DEFAULT_COLOR, [148, 196.8, 244, 276.8]), 'circle stays anchored to the authored region without a rectangle substitution');
  const panel = buildScene(entries([{ type: 'circle', target: 'fig1.a' }]), resolver, layout);
  eq(panel.pages.get(1)?.pens[0], penCircle('legacy:0', DEFAULT_COLOR, [150, 180, 250, 280]), 'exact panel keeps the authored circle');
});

await test('measured component regions publish as separate exact boxes with local clearance', () => {
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1', source: { file: 'measured.pdf', sha256: '0'.repeat(64), num_pages: 1, generator: 'test' },
    pages: [{ n: 1, width: 612, height: 792 }], blocks: [], sentences: [], equations: [], sections: [],
    figures: [{ id: 'fig1', kind: 'figure', number: '1', page: 1, bbox: [100, 100, 500, 400], caption: '',
      image: 'raster.png', panels: [], referenced_by: [] }],
  };
  const scene = buildScene([
    { key: 'one', step: 0, persist: false, action: { type: 'box', target: 'fig1', region: [0.1, 0.2, 0.3, 0.4] } },
    { key: 'two', step: 0, persist: false, action: { type: 'box', target: 'fig1', region: [0.3025, 0.2, 0.5025, 0.4] } },
  ], new Resolver(doc, doc.pages), layoutPages(doc.pages));
  const boxes = scene.pages.get(1)?.boxes ?? [];
  eq(boxes.length, 2, 'disjoint components remain two boxes, never a union or whole-frame overview');
  eq(boxes[0].rect, [138, 158, 220.5, 222], 'first measured component respects the neighbouring component');
  ok(Math.abs(boxes[1].rect[0] - 220.5) < 1e-8, 'second box shares only the available gap');
  eq(scene.pages.get(1)?.pens.length, 0, 'player adds no inferred arrows or circle outlines');
  eq(scene.labels.length, 0, 'empty authored labels do not duplicate component names');
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

await test('boxes and arrow endpoints retain their source alignment across zoom and side-panel widths', () => {
  const sizes = [{ width: 600, height: 800 }, { width: 500, height: 800 }];
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1', source: { file: 'alignment.pdf', sha256: '0'.repeat(64), num_pages: 2, generator: 'test' },
    pages: sizes.map((size, i) => ({ n: i + 1, ...size })), sections: [], blocks: [], sentences: [], equations: [],
    figures: [{ id: 'fig1', kind: 'figure', number: '1', page: 2, bbox: [80, 200, 240, 400], panels: [], caption: '', image: '', referenced_by: [] }],
  };
  const layout = layoutPages(sizes), resolver = new Resolver(doc, sizes);
  const region: [number, number, number, number] = [0.05, 0.2, 0.55, 0.7];
  const overlays = [
    { type: 'box' as const, target: 'fig1', region },
    { type: 'arrow' as const, target: 'fig1', region, from: 'left' as const },
  ].map((action, i) => ({ key: `calibrate:${i}`, step: 0, persist: false, action }));
  const shapes = buildScene(overlays, resolver, layout).pages.get(2)!;
  const target: BBox = [88, 240, 168, 340];
  eq(shapes.boxes[0].rect, [86, 238, 170, 342], 'box stays in the exact page coordinate system');
  const arrow = buildScene(overlays.slice(1), resolver, layout).pages.get(2)!.pens[0] as PenArrowShape;
  pointsInto(arrow, target, 'left');
  for (const s of [0.5, 1, 2.5, 4, 6]) for (const width of [900, 480]) {
    const vp = { width, height: 600 }, view = { cx: layout.pages[1].x + 250, cy: layout.pages[1].y + 300, s };
    const source = project(toStage(layout, 2, target), view, vp);
    const outline = project(toStage(layout, 2, shapes.boxes[0].rect), view, vp);
    ok(Math.abs(source.left - outline.left - BOX_PAD * s) < 1e-8, 'box padding scales once, with the PDF');
    ok(Math.abs(outline.bottom - source.bottom - BOX_PAD * s) < 1e-8, 'vertical geometry includes the page offset once');
    const tip = project(toStage(layout, 2, [...arrow.tip, ...arrow.tip] as BBox), view, vp);
    ok(Math.abs(source.left - tip.left - ARROW_GAP * s) < 1e-8, 'arrow endpoint retains its intended gap at high zoom');
    ok(Math.abs(tip.top - (source.top + source.bottom) / 2) < 1e-8, 'arrow still points at the same region centre');
  }
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

await test('prose stays undimmed while visual emphasis retains its deliberate spotlight', () => {
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'reading.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
    pages: [{ n: 1, width: 600, height: 800 }], sections: [], figures: [], equations: [],
    blocks: [{ id: 'p1.b1', type: 'paragraph', page: 1, bbox: [50, 100, 550, 220], text: 'One. Two.', sentences: ['p1.s1', 'p1.s2'] }],
    sentences: [
      { id: 'p1.s1', block: 'p1.b1', page: 1, text: 'One.', rects: [[50, 100, 200, 120]] },
      { id: 'p1.s2', block: 'p1.b1', page: 1, text: 'Two.', rects: [[50, 200, 300, 220]] },
    ],
  };
  const resolver = new Resolver(doc, doc.pages);
  const layout = layoutPages(doc.pages);
  const highlights = [{ key: 'claim', step: 0, persist: false, action: { type: 'highlight' as const, targets: ['p1.s2'] } }];
  const reading = buildScene([], resolver, layout, { type: 'focus', target: 'p1.s1' });
  ok(!reading.spotlight, 'ordinary prose focus never dims surrounding lines');
  ok(!buildScene([], resolver, layout, { type: 'zoom', target: 'p1.b1', region: [0, 0, 1, 0.5] }).spotlight, 'a text zoom region does not create a veil');
  const emphasized = buildScene(highlights, resolver, layout, { type: 'focus', target: 'p1.s1' });
  ok(!emphasized.spotlight, 'spoken highlight replaces automatic dimming');
  const untouched = buildScene([], resolver, layout, { type: 'focus', target: 'page1' });
  ok(!untouched.spotlight, 'overview never dims the whole page');
  ok(!buildScene([], resolver, layout, { type: 'focus', target: 'missing' }).spotlight, 'missing focus never dims the whole page');
  ok(!buildScene(highlights, resolver, layout).spotlight, 'manual selection outside narration remains unchanged');
  const figureDoc: Doc = { ...doc, figures: [{ id: 'fig1', kind: 'figure', number: '1', page: 1, bbox: [50, 300, 550, 600], caption: '', image: 'f.png', panels: [], referenced_by: [] }] };
  const visualResolver = new Resolver(figureDoc, figureDoc.pages);
  const zoom = { type: 'zoom' as const, target: 'fig1' };
  const whole = buildScene([], visualResolver, layout, zoom);
  eq(whole.pages.get(1)?.holes, [[42, 292, 558, 608]], 'visual overview initially stays bright');
  const directed = buildScene([
    { key: 'overview-box', step: 0, persist: false, action: { type: 'box', target: 'fig1' } },
    { key: 'part-arrow', step: 0, persist: false, action: { type: 'arrow', target: 'fig1', region: [0, 0, 0.5, 1], label: 'Input path' } },
  ], visualResolver, layout, zoom);
  ok(!directed.spotlight, 'spoken component marks replace automatic visual dimming');
  eq(directed.pages.get(1)?.pens[0].kind, 'arrow', 'old authored arrow remains an arrow and needs regeneration for measured geometry');
  eq(directed.labels.length, 1, 'player does not conceal legacy authoring with another shape');
  const explicit = buildScene([{ key: 'spot', step: 0, persist: false, action: { type: 'spotlight', target: 'p1.s2' } }], resolver, layout, { type: 'focus', target: 'p1.s1' });
  ok(!explicit.spotlight, 'legacy text spotlight becomes a line highlight');
  eq(explicit.pages.get(1)?.markers[0].rects, [[50, 200, 300, 220]], 'highlight uses the extracted sentence line');
  const paragraph = buildScene([{ key: 'paragraph', step: 0, persist: false, action: { type: 'spotlight', target: 'p1.b1', region: [0, 0.1, 1, 0.15] } }], resolver, layout);
  ok(!paragraph.spotlight, 'a guessed paragraph region cannot darken or slice lines');
  eq(paragraph.pages.get(1)?.markers[0].rects, [[50, 100, 200, 120], [50, 200, 300, 220]], 'paragraph emphasis follows separate line rectangles rather than the bounding box');
  const explicitFigure = buildScene([{ key: 'figure', step: 0, persist: false, action: { type: 'spotlight', target: 'fig1', region: [0, 0, 0.5, 1] } }], visualResolver, layout, zoom);
  ok(explicitFigure.spotlight && !explicitFigure.pages.get(1)?.readingSpotlight, 'authored figure spotlight remains deliberate');
  eq(explicitFigure.pages.get(1)?.holes, [[45, 295, 305, 605]], 'figure spotlight keeps its exact region');
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} pen tests passed`);
