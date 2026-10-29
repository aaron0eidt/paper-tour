import { project } from '../src/camera';
import type { ScreenRect } from '../src/camera';
import { labelWidths, layoutLabels, rectsOverlap } from '../src/labelLayout';
import type { LabelAnchor, LabelPlacement } from '../src/labelLayout';

let failures = 0;
function test(name: string, run: () => void) {
  try { run(); console.log(`  ok    ${name}`); }
  catch (error) { failures++; console.error(`  FAIL  ${name}\n        ${(error as Error).message}`); }
}
function ok(value: unknown, message: string): asserts value { if (!value) throw new Error(message); }
const rect = (left: number, top: number, right: number, bottom: number): ScreenRect => ({ left, top, right, bottom });
const size = (w: number, h = 26) => ({ w, h, maxWidth: w });
function assertClear(position: LabelPlacement | undefined, obstacles: ScreenRect[], width: number, height: number) {
  ok(position, 'an adjacent free position should exist');
  ok(position.left >= 10 && position.top >= 10 && position.right <= width - 10 && position.bottom <= height - 10, 'chip stays within viewport');
  ok(obstacles.every((obstacle) => !rectsOverlap(position, obstacle)), 'chip must not cover any source or UI');
}

test('a detail label remains outside the whole containing figure, with its real tail nearby', () => {
  const figure = rect(100, 100, 500, 400);
  const obstacles = [figure, rect(100, 10, 500, 92), rect(100, 408, 500, 590)];
  const item: LabelAnchor = { key: 'detail', rect: rect(350, 200, 400, 250), area: figure,
    pin: { x: 520, y: 230, side: 'right' }, sizes: [size(170)] };
  const result = layoutLabels([item], obstacles, { width: 800, height: 600 }).get(item.key);
  assertClear(result, obstacles, 800, 600);
  ok(result!.left > figure.right, 'detail chip belongs outside the parent diagram');
});

test('a measured wrapped chip fits a narrow free gutter without covering text', () => {
  const figure = rect(100, 100, 430, 300);
  const obstacles = [figure, rect(0, 0, 560, 100), rect(0, 300, 560, 420), rect(0, 100, 98, 300)];
  const item: LabelAnchor = { key: 'wrapped', rect: figure, area: figure,
    pin: { x: 438, y: 200, side: 'right' }, sizes: [size(180), size(132, 40), size(96, 60)] };
  const result = layoutLabels([item], obstacles, { width: 560, height: 420 }).get(item.key);
  assertClear(result, obstacles, 560, 420);
  ok(result!.maxWidth === 96 && result!.bottom - result!.top === 60, 'uses the actual height of the wrapped text');
});

test('an external figure label cannot cover its own short arrow outside the source', () => {
  const figure = rect(100, 100, 500, 400);
  const arrow = rect(255, 402, 315, 442);
  const item: LabelAnchor = { key: 'arrow', rect: arrow, area: figure,
    pin: { x: 285, y: 442, side: 'bottom' }, sizes: [size(150, 28), size(96, 44)] };
  const result = layoutLabels([item], [figure], { width: 800, height: 600 }).get(item.key);
  assertClear(result, [figure, arrow], 800, 600);
  ok(result!.top > arrow.bottom, 'chip remains beyond the tail instead of covering the whole arrow');
});

test('two simultaneous annotations reserve their measured rectangles for each other', () => {
  const figure = rect(100, 100, 430, 400);
  const items: LabelAnchor[] = ['one', 'two'].map((key) => ({ key, rect: figure,
    pin: { x: 440, y: 250, side: 'right' }, sizes: [size(150, 38)] }));
  const result = layoutLabels(items, [figure], { width: 800, height: 600 });
  assertClear(result.get('one'), [figure], 800, 600);
  assertClear(result.get('two'), [figure], 800, 600);
  ok(!rectsOverlap(result.get('one')!, result.get('two')!, 3), 'chips cannot overlap each other');
});

test('an expanded floating input is an obstacle, while the space beside it remains usable', () => {
  const figure = rect(80, 300, 420, 500);
  const dock = rect(180, 540, 780, 780);
  const item: LabelAnchor = { key: 'dock', rect: figure, pin: { x: 430, y: 520, side: 'bottom' }, sizes: [size(150, 36)] };
  const result = layoutLabels([item], [figure, dock], { width: 900, height: 800 }).get(item.key);
  assertClear(result, [figure, dock], 900, 800);
  ok(result!.bottom < dock.top, 'finds a nearby position above the expanded input');
  const margin = rect(20, 400, 130, 500);
  const narrow: LabelAnchor = { key: 'beside', rect: margin, side: 'bottom', sizes: [size(100, 36)] };
  const beside = layoutLabels([narrow], [margin, dock], { width: 900, height: 800 }).get(narrow.key);
  assertClear(beside, [margin, dock], 900, 800);
  ok(beside!.top > margin.bottom, 'does not reserve the dock’s entire horizontal lane');
});

test('a crowded or clipped figure omits its optional chip instead of clamping over the art', () => {
  const figure = rect(-100, -100, 800, 600);
  const item: LabelAnchor = { key: 'crowded', rect: rect(200, 200, 300, 300), area: figure,
    pin: { x: 810, y: 250, side: 'right' }, sizes: [size(170), size(96, 52)] };
  ok(!layoutLabels([item], [figure], { width: 640, height: 480 }).has(item.key), 'no empty space means no chip');
});

test('an offscreen source cannot leave a detached label at the viewport edge', () => {
  const offscreen = rect(-400, 200, -100, 400);
  const item: LabelAnchor = { key: 'offscreen', rect: offscreen, sizes: [size(100)] };
  ok(!layoutLabels([item], [offscreen], { width: 640, height: 480 }).has(item.key), 'offscreen label stays hidden');
});

test('PDF offsets and camera zoom preserve source clearance in screen coordinates', () => {
  for (const zoom of [0.5, 1, 2, 4, 6]) {
    const vp = { width: 1000, height: 800 };
    const view = { cx: 700, cy: 1300, s: zoom };
    const figure = project([650, 1260, 750, 1340], view, vp);
    const item: LabelAnchor = { key: `zoom-${zoom}`, rect: figure, area: figure, sizes: [size(150), size(96, 52)] };
    const result = layoutLabels([item], [figure], vp).get(item.key);
    assertClear(result, [figure], vp.width, vp.height);
  }
});

test('narrow viewports bound every measured wrapping option', () => {
  for (const width of [70, 180, 390]) {
    ok(labelWidths(width).every((value) => value > 0 && value <= width - 20), 'chip widths respect visible margins');
    ok(labelWidths(width, true).every((value) => value > 0 && value <= width - 20), 'note widths respect visible margins');
  }
});

if (failures) throw new Error(`${failures} label placement tests failed`);
console.log('Label placement tests passed.');
