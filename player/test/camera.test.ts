import { Camera, MIN_TEXT_PX, READ_TEXT_PX, clampView, fitWidthView, flightDuration, freeArea, frameFor, focusView, readingScale, revealView, cameraView, project, unproject, transformOf } from '../src/camera';
import { layoutPages } from '../src/layout';
import { Resolver } from '../src/resolve';
import type { Doc } from '../src/types';

// Page-width is the reading default; detail zoom must be deliberate and yield to a side explanation.
{
  const sizes = [{ width: 600, height: 800 }, { width: 600, height: 800 }];
  const layout = layoutPages(sizes);
  const page = layout.pages[0];
  const vp = { width: 800, height: 600 };
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1', source: { file: 'test.pdf', sha256: '0'.repeat(64), num_pages: 2, generator: 'test' },
    pages: sizes.map((size, i) => ({ n: i + 1, ...size })), sections: [], figures: [],
    blocks: [{ id: 'b1', page: 1, type: 'paragraph', text: 'A small passage.', bbox: [200, 300, 240, 314], sentences: ['s1'] }],
    sentences: [{ id: 's1', page: 1, block: 'b1', text: 'A small passage.', rects: [[200, 300, 240, 314]] }],
    equations: [{ id: 'eq1', page: 1, block: 'b1', number: '1', text: 'x+y', bbox: [200, 300, 240, 314] }],
  };
  const resolver = new Resolver(doc, sizes);
  const focus = cameraView({ type: 'focus', target: 's1' }, resolver, layout, vp)!;
  if (focus.s !== readingScale(page.width, vp)) throw new Error('Text focus must keep the full page width');
  const zoom = cameraView({ type: 'zoom', target: 'eq1' }, resolver, layout, vp)!;
  if (zoom.s <= focus.s) throw new Error('Explicit detail zoom remains available');
  const besideBoard = cameraView({ type: 'zoom', target: 'eq1' }, resolver, layout, vp, { fitWidth: true })!;
  if (besideBoard.s !== focus.s || besideBoard.cy !== focus.cy) throw new Error('A side explanation keeps source context at reading width');
  const overview = cameraView({ type: 'focus', target: 'page1' }, resolver, layout, vp)!;
  if (overview.s !== readingScale(page.width, vp)) throw new Error('Explicit page focus must remain an overview');
  console.log('  ok    page-width reading and side explanations preserve deliberate detail zoom');
}

// Opening/closing a side panel refits an old 400% crop without losing the reading anchor.
{
  const layout = layoutPages([{ width: 600, height: 800 }, { width: 500, height: 900 }, { width: 600, height: 800 }]);
  const page = layout.pages[1];
  let current = { cx: page.x + 400, cy: page.y + 450, s: 4 };
  for (const width of [900, 760, 620, 480, 620, 760, 900]) {
    const vp = { width, height: 600 };
    current = fitWidthView(current, layout, vp);
    if (current.cy !== page.y + 450) throw new Error('Side panel reflow must preserve the vertical reading anchor');
    if (current.cx !== page.x + page.width / 2) throw new Error('Side panel reflow must centre the same page');
    const screen = project([page.x, page.y, page.x + page.width, page.y + page.height], current, vp);
    if (screen.left < 0 || screen.right > width) throw new Error('Side panel reflow must not crop the page horizontally');
  }
  console.log('  ok    side panel reflow preserves page and vertical anchor without a stale zoom crop');
}

// Pointer/selection coordinates and SVG/canvas stage transforms share one invertible mapping.
{
  for (const s of [0.25, 1, 2.5, 4, 6]) for (const vp of [{ width: 800, height: 600 }, { width: 420, height: 600 }]) {
    const view = { cx: 320, cy: 1120, s };
    const point: [number, number, number, number] = [175, 1023, 175, 1023];
    const screen = project(point, view, vp);
    const [x, y] = unproject(screen.left, screen.top, view, vp);
    if (Math.abs(x - point[0]) > 1e-9 || Math.abs(y - point[1]) > 1e-9) throw new Error('Overlay and pointer geometry must round-trip at every zoom');
    const matrix = transformOf(view, vp).match(/-?[\d.]+/g)!.map(Number);
    if (Math.abs(screen.left - (point[0] * matrix[2] + matrix[0])) > 1e-9 || Math.abs(screen.top - (point[1] * matrix[2] + matrix[1])) > 1e-9)
      throw new Error('CSS stage and overlay screen projection must agree');
  }
  console.log('  ok    overlay, canvas and selection transforms agree across resize and high zoom');
}

const assert = {
  equal(actual: unknown, expected: unknown, message = 'Values differ') {
    if (actual !== expected) throw new Error(`${message}: expected ${expected}, got ${actual}`);
  },
};

const originalRequest = globalThis.requestAnimationFrame;
const originalCancel = globalThis.cancelAnimationFrame;
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
globalThis.requestAnimationFrame = (callback) => {
  frames.set(++frameId, callback);
  return frameId;
};
globalThis.cancelAnimationFrame = (id) => {
  frames.delete(id);
};
function frame(now: number) {
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(now));
}
function camera() {
  const instance = new Camera();
  instance.setLayout(layoutPages([{ width: 600, height: 1600 }]));
  instance.setViewport({ width: 600, height: 400 });
  instance.jumpTo({ cx: 300, cy: 250, s: 1 });
  return instance;
}

try {
  const c = camera();
  let ready = false;
  const started = performance.now();
  c.animateTo({ cx: 300, cy: 1100, s: 1 }, 700);
  const waiting = c.whenSettled(new AbortController().signal).then(() => {
    ready = true;
  });
  frame(started + 350);
  await Promise.resolve();
  assert.equal(ready, false, 'speech stays blocked while the camera is in flight');
  frame(started + 701);
  await waiting;
  assert.equal(c.getView().cy, 1100);
  assert.equal(ready, true);
  c.destroy();
  console.log('  ok    narration readiness follows the actual camera completion');

  const paused = camera();
  paused.animateTo({ cx: 300, cy: 1100, s: 1 });
  const controller = new AbortController();
  const cancelled = paused.whenSettled(controller.signal);
  controller.abort();
  await cancelled;
  assert.equal(paused.animating, true, 'cancelling speech does not interrupt document navigation');
  paused.destroy();
  assert.equal(frames.size, 0);
  console.log('  ok    cancelling a camera wait releases it immediately');

  const unchanged = camera();
  unchanged.animateTo({ ...unchanged.getView() });
  await unchanged.whenSettled(new AbortController().signal);
  assert.equal(unchanged.animating, false);
  assert.equal(frames.size, 0, 'same-paragraph narration does not wait through an empty animation');
  unchanged.destroy();
  console.log('  ok    an already framed target requires no extra delay');

  const jumped = camera();
  jumped.animateTo({ cx: 300, cy: 1100, s: 1 });
  const jumping = jumped.whenSettled(new AbortController().signal);
  jumped.jumpTo({ cx: 300, cy: 700, s: 1 });
  await jumping;
  assert.equal(jumped.animating, false);
  jumped.destroy();
  console.log('  ok    instant navigation also releases pending narration');
} finally {
  globalThis.requestAnimationFrame = originalRequest;
  globalThis.cancelAnimationFrame = originalCancel;
}

// A board/ask resize during a flight must preserve continuity and the original completion time.
{
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  let now = 1000;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => now } });
  const oldRequest = globalThis.requestAnimationFrame, oldCancel = globalThis.cancelAnimationFrame;
  let callback: FrameRequestCallback | null = null;
  globalThis.requestAnimationFrame = (fn) => { callback = fn; return 1; };
  globalThis.cancelAnimationFrame = () => { callback = null; };
  try {
    const c = camera();
    c.animateTo({ cx: 300, cy: 1100, s: 1 }, 700);
    now = 1350; callback!(now);
    const before = c.getView();
    c.setViewport({ width: 400, height: 350 });
    c.retargetTo({ cx: 300, cy: 900, s: 0.8 });
    assert.equal(c.getView().cy, before.cy, 'retarget has no position jump');
    now = 1351; callback!(now);
    assert.equal(Math.abs(c.getView().cy - before.cy) < 10, true, 'velocity stays continuous');
    now = 1701; callback!(now);
    assert.equal(c.animating, false, 'resizing does not restart another 700ms flight');
    assert.equal(c.getView().cy, 900);
    c.destroy();
    console.log('  ok    resize retarget preserves continuity and the flight deadline');
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'performance', descriptor);
    globalThis.requestAnimationFrame = oldRequest; globalThis.cancelAnimationFrame = oldCancel;
  }
}

// ------------------------------------------------------------------------- the safe area, legibility and reveal

/** Two pages of small type and a figure in the lower middle of the first: the shapes the reader frames. */
function safeAreaDoc() {
  const sizes = [{ width: 600, height: 800 }, { width: 600, height: 800 }];
  const lineRects = (y: number): [number, number, number, number][] => [[72, y, 528, y + 9]];
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1', source: { file: 'test.pdf', sha256: '0'.repeat(64), num_pages: 2, generator: 'test' },
    pages: sizes.map((size, i) => ({ n: i + 1, ...size })), sections: [],
    figures: [{ id: 'fig1', kind: 'figure', number: '1', page: 1, bbox: [100, 420, 500, 700], caption: 'A figure.', image: 'f.png', panels: [], referenced_by: [] }],
    blocks: [{ id: 'b1', page: 1, type: 'paragraph', text: 'Small type. More small type.', bbox: [72, 100, 528, 130], sentences: ['s1', 's2'] }],
    sentences: [
      { id: 's1', page: 1, block: 'b1', text: 'Small type.', rects: lineRects(100) },
      { id: 's2', page: 1, block: 'b1', text: 'More small type.', rects: lineRects(112) },
    ],
    equations: [],
  };
  return { sizes, layout: layoutPages(sizes), resolver: new Resolver(doc, sizes) };
}

{
  const { layout, resolver } = safeAreaDoc();
  const vp = { width: 900, height: 700 };
  const dock = { top: 0, right: 0, bottom: 160, left: 0 };

  const free = freeArea(vp, dock);
  assert.equal(free.height, 540, 'the dock leaves the viewport above it');
  assert.equal(free.dy, -80, 'and the centre of what is left');
  assert.equal(freeArea(vp, { top: 0, right: 0, bottom: 900, left: 0 }).height, 420, 'a huge dock never takes more than 40%');

  // A figure is framed whole in the free area; without the dock it was centred in the whole viewport.
  const bare = cameraView({ type: 'zoom', target: 'fig1' }, resolver, layout, vp)!;
  const safe = cameraView({ type: 'zoom', target: 'fig1' }, resolver, layout, vp, { insets: dock })!;
  const rect = [layout.pages[0].x + 100, layout.pages[0].y + 420, layout.pages[0].x + 500, layout.pages[0].y + 700] as [number, number, number, number];
  const shown = project(rect, safe, vp);
  assert.equal(shown.bottom <= vp.height - dock.bottom, true, 'the figure ends above the dock');
  assert.equal(shown.top >= 0 && shown.left >= 0 && shown.right <= vp.width, true, 'and is whole');
  assert.equal(project(rect, bare, vp).bottom > vp.height - dock.bottom, true, 'it was under the dock before');
  console.log('  ok    a figure is framed whole above the ask dock');

  // Text on a narrow stage: the page's type would be unreadable at fit-width, so the camera zooms to the column.
  const phone = { width: 380, height: 360 };
  const lineHeight = 9;
  const fit = readingScale(layout.pages[0].width, phone);
  assert.equal(fit * lineHeight < READ_TEXT_PX, true, 'the fixture is too small to read at fit-width');
  const read = cameraView({ type: 'focus', target: 's1' }, resolver, layout, phone, { insets: { top: 0, right: 0, bottom: 100, left: 0 } })!;
  assert.equal(read.s > fit, true, 'zoomed in from the page width');
  assert.equal(read.s * lineHeight >= READ_TEXT_PX - 0.01 || read.s * 456 <= phone.width, true, 'to a readable size, or as far as the column fits');
  const column = project([layout.pages[0].x + 72, 0, layout.pages[0].x + 528, 1], read, phone);
  assert.equal(column.left >= -0.5 && column.right <= phone.width + 0.5, true, 'with the whole text column across the screen');
  // A roomy stage already reads well: nothing changes there.
  const roomy = { width: 1400, height: 800 };
  const wide = cameraView({ type: 'focus', target: 's1' }, resolver, layout, roomy)!;
  assert.equal(wide.s, readingScale(layout.pages[0].width, roomy), 'a wide stage keeps the page width');
  console.log('  ok    a small stage zooms to a legible size and keeps the column in view');

  // Marks that appear while the move holds come along when they fit.
  const alone = frameFor({ type: 'focus', target: 's1' }, resolver, layout, roomy)!;
  const together = frameFor({ type: 'focus', target: 's1' }, resolver, layout, roomy, { also: [{ target: 's2' }] })!;
  assert.equal(together.rect[3] > alone.rect[3], true, 'the later mark joins the frame');
  assert.equal(together.view.s, alone.view.s, 'without costing legibility');
  const far = frameFor({ type: 'zoom', target: 's1' }, resolver, layout, vp, { also: [{ target: 'fig1' }] })!;
  const only = frameFor({ type: 'zoom', target: 's1' }, resolver, layout, vp)!;
  assert.equal(far.view.s >= only.view.s * 0.7 - 1e-9, true, 'a far-off mark never costs more than a third of the zoom');
  console.log('  ok    marks of the same move are kept in frame without losing legibility');

  // A chosen region is brought clear of the dock: panned the least, or zoomed out to fit.
  const view = { cx: 300, cy: 400, s: 1 };
  const low: [number, number, number, number] = [layout.pages[0].x + 200, layout.pages[0].y + 500, layout.pages[0].x + 400, layout.pages[0].y + 620];
  assert.equal(revealView(low, { cx: 332, cy: 432, s: 1 }, layout, vp, dock) !== null, true, 'a region under the dock moves');
  const moved = revealView(low, { cx: 332, cy: 432, s: 1 }, layout, vp, dock)!;
  assert.equal(moved.s, 1, 'without zooming');
  assert.equal(project(low, moved, vp).bottom <= vp.height - dock.bottom, true, 'above the dock');
  assert.equal(revealView([layout.pages[0].x + 200, layout.pages[0].y + 380, layout.pages[0].x + 400, layout.pages[0].y + 440], view, layout, vp, dock), null, 'a region in view stays put');
  const tall: [number, number, number, number] = [layout.pages[0].x + 100, layout.pages[0].y + 100, layout.pages[0].x + 500, layout.pages[0].y + 700];
  const fitted = revealView(tall, { cx: 332, cy: 432, s: 1.3 }, layout, vp, dock)!;
  assert.equal(fitted.s < 1.3, true, 'a region too big for what is left zooms out');
  const seen = project(tall, fitted, vp);
  assert.equal(seen.top >= 0 && seen.bottom <= vp.height - dock.bottom && seen.left >= 0 && seen.right <= vp.width, true, 'to fit above the dock');
  console.log('  ok    a chosen region is revealed above the ask dock');

  // Views stay inside the document: the last lines can rise above the dock, never a page past its end.
  const end = clampView({ cx: 300, cy: 5000, s: 1 }, layout, vp, dock);
  assert.equal(project([0, layout.height, 1, layout.height], end, vp).top <= vp.height - dock.bottom + 1e-6, true, 'the document end can clear the dock');

  // Flights: a hop is quick, a long one takes its time, and none is longer than before.
  const a = { cx: 300, cy: 400, s: 1 };
  const hop = flightDuration(a, { cx: 300, cy: 440, s: 1 }, vp);
  const long = flightDuration(a, { cx: 300, cy: 1300, s: 1.8 }, vp);
  assert.equal(hop < long, true, 'distance and zoom lengthen a flight');
  assert.equal(hop >= 320 && long <= 700, true, 'between a quick hop and the standard flight');
  console.log('  ok    flights scale with distance and the document end clears the dock');

  void focusView; void MIN_TEXT_PX;
}
