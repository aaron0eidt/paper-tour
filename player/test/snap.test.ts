// Snapping a region to the object inside it: the coordinates the server and the reader exchange, the morph from the
// rectangle to the outline, and a request that never throws or blocks. Bundled for Node like the other player tests.

import { snapObject } from '../src/ask/snap';
import {
  boxInPoints,
  boxPolygon,
  canSnap,
  mix,
  pairOutlines,
  parseSnapped,
  regionFromSnap,
  resample,
  signedArea,
  snapBody,
} from '../src/ask/snapGeometry';
import type { Point } from '../src/ask/snapGeometry';
import { regionFromDrag } from '../src/ask/regionSelection';
import type { RegionSelection } from '../src/ask/regionSelection';

const results: string[] = [];
let failures = 0;

async function test(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    results.push(`  ok    ${name}`);
  } catch (error) {
    failures++;
    results.push(`  FAIL  ${name}\n        ${(error as Error).message}`);
  }
}

function eq<T>(actual: T, expected: T, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

function near(actual: number, expected: number, what: string, tolerance = 1e-6) {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

// A page of 600 x 800 points, as layout.ts stacks it (stage units are points).
const page = { width: 600, height: 800 };
const selection: RegionSelection = { page: 2, rect: [0.25, 0.125, 0.75, 0.5] };

/** An ellipse as an outline, clockwise from its top-most point, like the server's. */
function ellipse(cx: number, cy: number, rx: number, ry: number, n = 40): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const a = (i / n) * 2 * Math.PI;
    return [cx + rx * Math.sin(a), cy - ry * Math.cos(a)] as Point;
  });
}

const reply = (polygon: Point[], extra: Record<string, unknown> = {}) => ({
  ok: true,
  polygon,
  bbox: [150, 120, 450, 380],
  confidence: 0.93,
  ms: 1400,
  ...extra,
});

await test('a region in fractions becomes the box in PDF points the server checks, and the object\'s box comes back', () => {
  eq(boxInPoints(selection, page), [150, 100, 450, 400], 'points');
  eq(snapBody(selection, page), { page: 2, box: [150, 100, 450, 400] }, 'no analysis, none sent');
  eq(snapBody(selection, page, 'a-1'), { page: 2, box: [150, 100, 450, 400], analysisId: 'a-1' }, 'analysis');
  // A drag the reader made (stage coordinates on a page offset in the stack) goes through the same fractions.
  const box = { n: 2, x: 32, y: 860, width: 600, height: 800 };
  const drag = regionFromDrag(box, [32 + 150, 860 + 100], [32 + 450, 860 + 400]);
  eq(boxInPoints(drag, page), [150, 100, 450, 400], 'a drag over the page');
  // The object's box, in points, as a selection the question carries.
  const region = regionFromSnap({ bbox: [180, 120, 420, 380] }, 2, page)!;
  eq(region.page, 2);
  eq(region.rect.map((n) => Math.round(n * 1e6) / 1e6), [0.3, 0.15, 0.7, 0.475], 'fractions of the page');
  eq(boxInPoints(region, page), [180, 120, 420, 380], 'and back to points');
});

await test('the object\'s box is clamped to the page and never empty', () => {
  eq(regionFromSnap({ bbox: [-5, -5, 610, 810] }, 1, page)!.rect, [0, 0, 1, 1], 'past the edges');
  eq(regionFromSnap({ bbox: [700, 100, 710, 200] }, 1, page), null, 'entirely off the page');
  eq(regionFromSnap({ bbox: [100, 100, 100, 200] }, 1, page), null, 'no width');
});

await test('only a drag that can hold an object is sent: not a speck, not the whole page', () => {
  eq(canSnap(selection, page), true, 'a figure-sized drag');
  eq(canSnap({ page: 1, rect: [0.1, 0.1, 0.11, 0.11] }, page), false, 'a speck');
  eq(canSnap({ page: 1, rect: [0.1, 0.1, 0.5, 0.11] }, page), false, 'a hairline');
  eq(canSnap({ page: 1, rect: [0, 0, 1, 1] }, page), false, 'the whole page');
  eq(canSnap({ page: 1, rect: [0.02, 0.02, 0.98, 0.98] }, page), false, 'nearly the whole page');
});

await test('the reply is checked: only a real outline passes, clamped to the page', () => {
  const polygon = ellipse(300, 250, 150, 130);
  const good = parseSnapped(reply(polygon), page)!;
  eq(good.polygon.length, 40, 'every point');
  eq(good.bbox, [150, 120, 450, 380], 'box');
  eq([good.confidence, good.ms], [0.93, 1400]);
  eq(parseSnapped({ ok: false, reason: 'low_confidence' }, page), null, 'ok false');
  eq(parseSnapped(null, page), null, 'nothing');
  eq(parseSnapped('nope', page), null, 'a string');
  eq(parseSnapped(reply(polygon, { ok: 'yes' }), page), null, 'ok must be true');
  eq(parseSnapped(reply(polygon.slice(0, 2)), page), null, 'two points are no outline');
  eq(parseSnapped(reply([...polygon.slice(0, 5), [Number.NaN, 3]]), page), null, 'a point that is not a number');
  eq(parseSnapped(reply([...polygon.slice(0, 5), [1, 2, 3] as unknown as Point]), page), null, 'a point of three');
  eq(parseSnapped(reply(polygon, { bbox: [10, 10] }), page), null, 'a box of two');
  eq(parseSnapped(reply(polygon, { bbox: [200, 200, 100, 300] }), page), null, 'a box turned inside out');
  eq(parseSnapped(reply(polygon, { bbox: [-20, -20, 700, 900] }), page)!.bbox, [0, 0, 600, 800], 'a box past the page');
  const outside = parseSnapped(reply([[-10, 5], [700, 5], [300, 900]]), page)!;
  eq(outside.polygon, [[0, 5], [600, 5], [300, 800]], 'points past the page edge');
});

await test('resampling spaces points evenly along the outline and keeps a rectangle\'s corners', () => {
  const rect = boxPolygon([0, 0, 100, 50]);
  const points = resample(rect, 96);
  eq(points.length, 96);
  eq(points[0], [0, 0]);
  for (const corner of rect) {
    if (!points.some(([x, y]) => Math.abs(x - corner[0]) < 1e-9 && Math.abs(y - corner[1]) < 1e-9)) throw new Error(`corner ${corner} lost`);
  }
  const gaps = points.map(([x, y], i) => Math.hypot(points[(i + 1) % 96][0] - x, points[(i + 1) % 96][1] - y));
  near(Math.max(...gaps), Math.min(...gaps), 'gap between neighbours', 1e-9);
  eq(resample([[5, 5]], 4), [[5, 5], [5, 5], [5, 5], [5, 5]], 'a single point');
});

await test('the morph pairs both outlines clockwise and starts where they are nearest, so nothing twists', () => {
  const rect = boxPolygon([150, 100, 450, 400]);
  const clockwise = ellipse(300, 250, 150, 150);
  eq(signedArea(rect) > 0 && signedArea(clockwise) > 0, true, 'both run clockwise on a screen');
  const counter = [...clockwise].reverse();
  for (const outline of [clockwise, counter, [...clockwise.slice(13), ...clockwise.slice(0, 13)]]) {
    const [a, b] = pairOutlines(rect, outline, 96);
    eq([a.length, b.length], [96, 96], 'the same number of points');
    eq([signedArea(a) > 0, signedArea(b) > 0], [true, true], 'orientation');
    // The pairing moves each point the shortest way: a worse start would cost more.
    const travel = (shift: number) => a.reduce((sum, p, i) => sum + Math.hypot(p[0] - b[(i + shift) % 96][0], p[1] - b[(i + shift) % 96][1]), 0);
    for (let shift = 1; shift < 96; shift++) if (travel(shift) < travel(0) - 1e-6) throw new Error(`a start ${shift} points on is nearer`);
  }
  const [a, b] = pairOutlines(rect, clockwise, 96);
  eq(mix(a, b, 0), a, 'the start is the rectangle');
  eq(mix(a, b, 1), b, 'the end is the outline');
  const half = mix(a, b, 0.5);
  for (const [x, y] of half) if (x < 150 - 1e-9 || x > 450 + 1e-9 || y < 100 - 1e-9 || y > 400 + 1e-9) throw new Error('the morph leaves the rectangle');
});

// ----------------------------------------------------------------------------------- the request

type FetchCall = { url: string; init: RequestInit };
const calls: FetchCall[] = [];
const realFetch = globalThis.fetch;
function fakeFetch(handler: (call: FetchCall) => Response | Promise<Response>) {
  calls.length = 0;
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    const call = { url: String(url), init };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

await test('a demo paper is snapped through its own endpoint with the box in points', async () => {
  fakeFetch(() => json(reply(ellipse(300, 250, 150, 130))));
  const snapped = await snapObject({ paper: 'attention-short' }, selection, page);
  eq(calls.length, 1, 'one request');
  eq(calls[0].url, '/api/demo/attention-short/snap');
  eq(calls[0].init.method, 'POST');
  eq(JSON.parse(String(calls[0].init.body)), { page: 2, box: [150, 100, 450, 400] }, 'body');
  eq(snapped?.bbox, [150, 120, 450, 380], 'the outline comes back');
});

await test('no outline never throws: the rectangle stays for every failure', async () => {
  fakeFetch(() => json({ ok: false, reason: 'low_confidence' }));
  eq(await snapObject({ paper: 'p' }, selection, page), null, 'ok false');
  fakeFetch(() => json({ error: { message: 'Snapping is not available on this server.' } }, 503));
  eq(await snapObject({ paper: 'p' }, selection, page), null, 'server error');
  fakeFetch(() => json({}, 404));
  eq(await snapObject({ paper: 'p' }, selection, page), null, 'no API running');
  fakeFetch(() => {
    throw new TypeError('network down');
  });
  eq(await snapObject({ paper: 'p' }, selection, page), null, 'network error');
  fakeFetch(() => new Response('<html>', { status: 200 }));
  eq(await snapObject({ paper: 'p' }, selection, page), null, 'a reply that is not JSON');
  fakeFetch(() => json({ ok: true, polygon: 'x', bbox: 3 }));
  eq(await snapObject({ paper: 'p' }, selection, page), null, 'a reply that is not an outline');
});

await test('a library document without a session does not snap; a drag that holds no object is not sent', async () => {
  fakeFetch(() => json(reply(ellipse(300, 250, 150, 130))));
  eq(await snapObject({ documentId: 'doc-1' }, selection, page, 'a-1'), null, 'not signed in');
  eq(calls.length, 0, 'nothing is sent without a session');
  eq(await snapObject({ paper: 'p' }, { page: 1, rect: [0, 0, 1, 1] }, page), null, 'the whole page');
  eq(await snapObject({ paper: 'p' }, { page: 1, rect: [0.1, 0.1, 0.11, 0.11] }, page), null, 'a speck');
  eq(calls.length, 0, 'and no model call is spent on them');
});

await test('a snap that is no longer wanted can be abandoned', async () => {
  const controller = new AbortController();
  fakeFetch(
    (call) =>
      new Promise<Response>((_, reject) => {
        (call.init.signal as AbortSignal).addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      }),
  );
  const pending = snapObject({ paper: 'p' }, selection, page, undefined, controller.signal);
  controller.abort();
  eq(await pending, null, 'aborted');
});

globalThis.fetch = realFetch;
console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} snap tests passed`);
