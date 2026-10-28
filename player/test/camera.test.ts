import { Camera } from '../src/camera';
import { layoutPages } from '../src/layout';

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
