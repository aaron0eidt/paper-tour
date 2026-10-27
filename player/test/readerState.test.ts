import { layoutPages } from '../src/layout';
import type { Layout } from '../src/layout';
import { initialView, MAX_USER_ZOOM, MIN_ZOOM } from '../src/camera';
import { positionFromView, viewFromPosition } from '../src/readerState';
import type { ReaderState } from '../../shared/contracts';

const results: string[] = [];
let failures = 0;
function test(name: string, fn: () => void) {
  try { fn(); results.push(`  ok    ${name}`); }
  catch (error) { failures++; results.push(`  FAIL  ${name}\n        ${(error as Error).message}`); }
}
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function close(actual: number, expected: number) {
  if (Math.abs(actual - expected) > 0.000001) throw new Error(`Expected ${expected}, got ${actual}`);
}
function saved(values: Partial<ReaderState> = {}): ReaderState {
  return { page: 1, pageOffset: 0, zoom: null, tourId: null, stepId: null, ...values };
}

const layout = layoutPages([{ width: 400, height: 600 }, { width: 800, height: 1000 }, { width: 500, height: 300 }]);
const viewport = { width: 900, height: 700 };

test('a position identifies the correct page and relative offset in a mixed-size PDF', () => {
  const page = layout.pages[1];
  equal(positionFromView(layout, { cx: 10, cy: page.y + page.height * 0.65, s: 1.8 }), { page: 2, pageOffset: 0.65, zoom: 1.8 });
});

test('page-relative position round-trips independently of viewport size', () => {
  const page = layout.pages[1];
  const stored = { ...saved(), ...positionFromView(layout, { cx: page.x + 10, cy: page.y + 430, s: 2.25 }) };
  const restored = viewFromPosition(layout, { width: 380, height: 850 }, stored);
  equal(positionFromView(layout, restored), { page: 2, pageOffset: 0.43, zoom: 2.25 });
  close(restored.cx, page.x + page.width / 2);
});

test('saved position survives a changed stage origin and different page dimensions', () => {
  const before = layout.pages[1];
  const stored = { ...saved(), ...positionFromView(layout, { cx: 300, cy: before.y + before.height / 4, s: 1.2 }) };
  const shifted: Layout = {
    ...layout,
    pages: layout.pages.map((page) => ({ ...page, x: page.x + 30, y: page.y + 100, height: page.height * 1.1 })),
  };
  const restored = viewFromPosition(shifted, viewport, stored);
  close(restored.cy, shifted.pages[1].y + shifted.pages[1].height / 4);
  close(restored.cx, shifted.pages[1].x + shifted.pages[1].width / 2);
});

test('document margins clamp to the first and last valid page positions', () => {
  equal(positionFromView(layout, { cx: 0, cy: -500, s: 1 }), { page: 1, pageOffset: 0, zoom: 1 });
  equal(positionFromView(layout, { cx: 0, cy: layout.height + 500, s: 1 }), { page: 3, pageOffset: 1, zoom: 1 });
});

test('a saved page outside the current range restores to a valid document boundary', () => {
  const first = viewFromPosition(layout, viewport, saved({ page: -3, pageOffset: -0.5 }));
  const last = viewFromPosition(layout, viewport, saved({ page: 999, pageOffset: 2 }));
  close(first.cy, layout.pages[0].y);
  close(last.cy, layout.pages[2].y + layout.pages[2].height);
});

test('restored zoom is constrained to the reader supported range', () => {
  close(viewFromPosition(layout, viewport, saved({ zoom: -1 })).s, MIN_ZOOM);
  close(viewFromPosition(layout, viewport, saved({ zoom: 100 })).s, MAX_USER_ZOOM);
});

test('missing or unusable zoom falls back to the initial reading scale', () => {
  const defaultScale = initialView(layout, viewport).s;
  for (const zoom of [null, 0, Number.NaN, Number.POSITIVE_INFINITY]) {
    close(viewFromPosition(layout, viewport, saved({ zoom })).s, defaultScale);
  }
});

test('empty documents and a missing checkpoint use a valid initial view', () => {
  const empty = layoutPages([]);
  equal(positionFromView(empty, { cx: 0, cy: 0, s: 1 }), { page: 1, pageOffset: 0, zoom: null });
  equal(viewFromPosition(layout, viewport, null), initialView(layout, viewport));
  equal(viewFromPosition(empty, viewport, saved()), initialView(empty, viewport));
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} reader state test(s) failed`);
console.log(`\nall ${results.length} reader state tests passed`);
