import { Camera, fitWidthView, readingScale, cameraView, project, unproject, transformOf } from '../src/camera';
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
