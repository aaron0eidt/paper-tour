import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { encodeSegmentationMask } from '../node_modules/@meta-sam/parser/dist/mask-codec.js';
import type { MuseConfig } from '../src/config';
import { ProcessingError } from '../src/errors';
import {
  fillHoles,
  inkShare,
  maskComponent,
  maskOutline,
  normalizeRing,
  outerContour,
  parseSamMask,
  samPromptText,
  samRequestBody,
  segment,
  simplifyRing,
  type Point,
  type SamMask,
  type SamPrompt,
} from '../src/ai/sam';
import type { InkMap } from '../src/tour-generator';

const KEY = 'unit-test-key-never-logged';
const config: MuseConfig = {
  apiKey: KEY,
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en-US',
  timeoutMs: 5000,
};
const prompt: SamPrompt = {
  width: 200,
  height: 100,
  box: { left: 10, top: 20, right: 60, bottom: 70 },
  point: { x: 35, y: 45 },
};

/** A raster from rows of "#" and "."; its top-left pixel sits at (left, top) of the image. */
function maskOf(rows: string[], left = 0, top = 0, confidence: number | undefined = 0.9): SamMask {
  const width = rows[0].length;
  return {
    ...(confidence === undefined ? {} : { confidence }),
    bounds: { left, top, right: left + width, bottom: top + rows.length },
    width,
    height: rows.length,
    raster: Uint8Array.from(
      rows
        .join('')
        .split('')
        .map((c) => (c === '#' ? 1 : 0)),
    ),
  };
}

/** The text SAM 3.1 sends for one object: its box and mask, encoded with the parser's own encoder. */
function replyText(mask: SamMask, image: { width: number; height: number }, confidence: number | null = 0.9): string {
  const { left, top, right, bottom } = mask.bounds;
  const { payload } = encodeSegmentationMask(mask.raster, mask.width, mask.height);
  const c = confidence === null ? '' : `;c=${confidence}`;
  return (
    `<0f>0<|box;x1=${left};y1=${top};x2=${right - 1};y2=${bottom - 1};w=${image.width};h=${image.height}${c}|>` +
    `<|mask;x=0;y=0${c};data=${mask.height},${mask.width},${payload}|>\n`
  );
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const reply = (text: string) => json({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

const SHAPE = ['....#...', '..#####.', '.#######', '..#####.', '....#...'];

test('the object prompt is the drag box, its far corner inclusive, and a point inside it', () => {
  assert.equal(
    samPromptText(prompt),
    '<0f>0<|box;x1=10;y1=20;x2=59;y2=69;w=200;h=100|><|point;x=35;y=45;w=200;h=100|>',
  );
  assert.equal(samPromptText({ ...prompt, point: undefined }), '<0f>0<|box;x1=10;y1=20;x2=59;y2=69;w=200;h=100|>');
  assert.throws(() => samPromptText({ ...prompt, box: { ...prompt.box, right: 201 } }), { name: 'ObjectPromptError' });
});

test('the request asks for one 1-bit mask with a confidence and sends the crop as a data URL', () => {
  const body = samRequestBody(prompt, 'data:image/jpeg;base64,AAAA');
  assert.deepEqual(body, {
    model: 'sam-3.1',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: samPromptText(prompt) },
          { type: 'input_image', image_url: 'data:image/jpeg;base64,AAAA' },
        ],
      },
    ],
    stream: false,
    metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
  });
});

test('a reply parses to the mask, its bounds and its confidence', async () => {
  const mask = maskOf(SHAPE, 40, 12);
  const parsed = await parseSamMask(replyText(mask, { width: 200, height: 100 }));
  assert.ok(parsed);
  assert.deepEqual(parsed.bounds, { left: 40, top: 12, right: 48, bottom: 17 });
  assert.equal(parsed.confidence, 0.9);
  assert.deepEqual([parsed.width, parsed.height], [8, 5]);
  assert.deepEqual(Array.from(parsed.raster), Array.from(mask.raster));
  const unscored = await parseSamMask(replyText(mask, { width: 200, height: 100 }, null));
  assert.equal(unscored?.confidence, undefined, 'a missing confidence is not zero');
});

test('an empty reply, or one with no mask, finds nothing; a broken mask is an unusable reply', async () => {
  assert.equal(await parseSamMask(''), null);
  assert.equal(await parseSamMask('  \n'), null);
  assert.equal(await parseSamMask('No objects found.'), null);
  const good = replyText(maskOf(SHAPE, 0, 0), { width: 20, height: 20 });
  await assert.rejects(parseSamMask(good.replace(/data=5,8,!+/, 'data=5,8,!!')), {
    code: 'muse_invalid_response',
  });
  // The raster must be the size of the box it sits in.
  await assert.rejects(parseSamMask(good.replace('y2=4;', 'y2=9;')), { code: 'muse_invalid_response' });
});

/** A fake provider that records its requests and answers each from `answer`. */
function transport(answer: (request: Request, call: number) => Response | Promise<Response>) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const fetcher = (async (url: string | URL | Request, init: RequestInit = {}) => {
    calls.push({ url: String(url), init, body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined });
    return answer(new Request(String(url), { method: 'POST' }), calls.length);
  }) as typeof fetch;
  return { fetcher, calls };
}
/** A request that waits until its signal aborts, as a real fetch does. */
const hanging = (): typeof fetch =>
  ((_url: unknown, init: RequestInit = {}) =>
    new Promise((_resolve, reject) => {
      const stop = () => reject(init.signal?.reason ?? new Error('aborted'));
      if (init.signal?.aborted) stop();
      else init.signal?.addEventListener('abort', stop, { once: true });
    })) as typeof fetch;

test('segment posts to /responses with the key, the prompt and the image, and returns the mask', async () => {
  const mask = maskOf(SHAPE, 20, 30);
  const { fetcher, calls } = transport(() => reply(replyText(mask, { width: 200, height: 100 })));
  const found = await segment(config, fetcher, prompt, 'data:image/jpeg;base64,AAAA');
  assert.equal(found?.confidence, 0.9);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.meta.ai/v1/responses');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.redirect, 'error', 'a redirect would carry the key elsewhere');
  const headers = calls[0].init.headers as Record<string, string>;
  assert.equal(headers.Authorization, `Bearer ${KEY}`);
  assert.deepEqual(calls[0].body, samRequestBody(prompt, 'data:image/jpeg;base64,AAAA'));
});

test('segment resolves null for an empty reply and for a reply without text', async () => {
  assert.equal(await segment(config, transport(() => reply('')).fetcher, prompt, 'data:,'), null);
  await assert.rejects(segment(config, transport(() => json({ output: [] })).fetcher, prompt, 'data:,'), {
    code: 'muse_invalid_response',
  });
  await assert.rejects(segment(config, transport(() => new Response('not json')).fetcher, prompt, 'data:,'), {
    code: 'muse_invalid_response',
  });
});

test('segment maps statuses to failures that say whether to try again, and never repeats the key', async () => {
  mock.method(console, 'warn', () => undefined);
  try {
    const expected: [number, string, boolean][] = [
      [400, 'muse_request_rejected', false],
      [401, 'muse_auth_failed', false],
      [429, 'muse_rate_limited', true],
      [500, 'muse_unavailable', true],
      [503, 'muse_unavailable', true],
    ];
    for (const [status, code, transient] of expected) {
      const { fetcher } = transport(() => new Response(`${KEY} echoed`, { status }));
      const error = await segment(config, fetcher, prompt, 'data:,').catch((e) => e);
      assert.ok(error instanceof ProcessingError, String(status));
      assert.equal(error.code, code);
      assert.equal(error.transient, transient);
      assert.ok(!error.message.includes(KEY));
    }
  } finally {
    mock.restoreAll();
  }
  const refused = (async () => {
    throw new TypeError(`fetch failed for ${KEY}`);
  }) as typeof fetch;
  const error = await segment(config, refused, prompt, 'data:,').catch((e) => e);
  assert.equal(error.code, 'muse_network_error');
  assert.equal(error.transient, true);
  assert.ok(!error.message.includes(KEY));
});

test('segment gives up at its timeout, and at once for a cancelled request', async () => {
  const started = Date.now();
  await assert.rejects(segment(config, hanging(), prompt, 'data:,', { timeoutMs: 40 }), {
    code: 'muse_timeout',
    transient: true,
  });
  assert.ok(Date.now() - started < 2000);
  const controller = new AbortController();
  const pending = segment(config, hanging(), prompt, 'data:,', { signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'muse_cancelled' });
  await assert.rejects(segment({ ...config, baseUrl: 'http://example.com/v1' }, hanging(), prompt, 'data:,'), {
    code: 'muse_not_configured',
  });
});

test('the component under the seed is kept, and the largest one when the seed is on the background', () => {
  const mask = maskOf(['##....#', '##....#', '......#', '.#....#', '.#....#'], 100, 50);
  const first = maskComponent(mask, [101, 51])!;
  assert.equal(first.area, 4);
  assert.deepEqual(first.bbox, { left: 100, top: 50, right: 102, bottom: 52 });
  const second = maskComponent(mask, [106.4, 52.9])!;
  assert.equal(second.area, 5);
  assert.deepEqual(second.bbox, { left: 106, top: 50, right: 107, bottom: 55 });
  const fallback = maskComponent(mask, [103, 52])!;
  assert.equal(fallback.area, 5, 'the largest component');
  assert.equal(maskComponent(maskOf(['...', '...']), [0, 0]), null, 'an empty mask');
});

test('pixels that touch only at a corner are one component', () => {
  const mask = maskOf(['#...', '.#..', '..#.', '...#']);
  assert.equal(maskComponent(mask, [0, 0])!.area, 4);
});

test('the contour runs along the pixel edges, clockwise, and skips holes and strays', () => {
  const ring = maskOf([
    '..........',
    '.########.',
    '.#......#.',
    '.#.##...#.',
    '.#......#.',
    '.########.',
    '..........',
    '#.........',
  ]);
  const contour = outerContour(ring.raster, ring.width, ring.height);
  assert.equal(contour.length, 26, 'the 8 x 5 frame, not the hole');
  assert.deepEqual(simplifyRing(contour, 0.5), [
    [1, 1],
    [9, 1],
    [9, 6],
    [1, 6],
  ]);
  const isolated = maskOf(['#.', '..']);
  assert.deepEqual(outerContour(isolated.raster, 2, 2), [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ]);
  assert.deepEqual(outerContour(new Uint8Array(4), 2, 2), []);
});

test('a hole that meets the outside only at a corner stays out of the outline', () => {
  const frame = maskOf(['#####', '#...#', '#...#', '#...#', '####.']);
  const contour = outerContour(frame.raster, 5, 5);
  assert.deepEqual(normalizeRing(simplifyRing(contour, 0.5)), [
    [0, 0],
    [5, 0],
    [5, 4],
    [4, 4],
    [4, 5],
    [0, 5],
  ]);
});

test('simplification keeps a round shape within its tolerance with far fewer points', () => {
  const size = 120;
  const radius = 50;
  const rows = Array.from({ length: size }, (_, y) =>
    Array.from({ length: size }, (_, x) => ((x - 60) ** 2 + (y - 60) ** 2 <= radius ** 2 ? '#' : '.')).join(''),
  );
  const disc = maskOf(rows);
  const contour = outerContour(disc.raster, size, size);
  const simple = simplifyRing(contour, 1.5);
  assert.ok(contour.length > 300, `${contour.length}`);
  assert.ok(simple.length > 8 && simple.length < contour.length / 4, `${simple.length}`);
  // Every simplified point is on the pixel outline, and every outline point is near the simplified polygon.
  const near = (p: Point, polygon: Point[]) => {
    let best = Infinity;
    for (let i = 0; i < polygon.length; i++) {
      const [ax, ay] = polygon[i];
      const [bx, by] = polygon[(i + 1) % polygon.length];
      const t = Math.max(
        0,
        Math.min(1, ((p[0] - ax) * (bx - ax) + (p[1] - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2 || 1)),
      );
      best = Math.min(best, Math.hypot(p[0] - (ax + t * (bx - ax)), p[1] - (ay + t * (by - ay))));
    }
    return best;
  };
  for (const p of simple) assert.ok(contour.some(([x, y]) => x === p[0] && y === p[1]));
  for (const p of contour) assert.ok(near(p, simple) <= 1.5 + 1e-9);
  assert.deepEqual(
    simplifyRing([
      [0, 0],
      [1, 1],
      [2, 0],
    ]),
    [
      [0, 0],
      [1, 1],
      [2, 0],
    ],
  );
});

test('a ring is made clockwise and starts at its top-most, then left-most, point', () => {
  const clockwise: Point[] = [
    [4, 2],
    [9, 2],
    [9, 8],
    [4, 8],
  ];
  const counter = [...clockwise].reverse();
  const expected: Point[] = [
    [4, 2],
    [9, 2],
    [9, 8],
    [4, 8],
  ];
  assert.deepEqual(normalizeRing(clockwise), expected);
  assert.deepEqual(normalizeRing(counter), expected);
  assert.deepEqual(normalizeRing([...clockwise.slice(2), ...clockwise.slice(0, 2)]), expected);
});

test('the outline of a mask is in image pixels, offset by the mask bounds', () => {
  const mask = maskOf(['..........', '.########.', '.########.', '.########.', '.########.', '..........'], 300, 120);
  const outline = maskOutline(mask, [305.5, 123.5])!;
  assert.deepEqual(outline.polygon, [
    [301, 121],
    [309, 121],
    [309, 125],
    [301, 125],
  ]);
  assert.deepEqual(outline.bbox, { left: 301, top: 121, right: 309, bottom: 125 });
  assert.equal(outline.area, 32);
  assert.equal(maskOutline(maskOf(['..', '..']), [0, 0]), null, 'an empty mask');
  assert.equal(maskOutline(maskOf(['##', '##']), [0, 0]), null, 'a speck within the tolerance has no outline');
});

/** An ink map from rows of "#" (ink) and "." (paper): a bit a pixel, row by row, the high bit first. */
function inkOf(rows: string[]): InkMap {
  const width = rows[0].length;
  const bits = new Uint8Array(Math.ceil((width * rows.length) / 8));
  rows
    .join('')
    .split('')
    .forEach((c, i) => {
      if (c === '#') bits[i >> 3] |= 1 << (7 - (i & 7));
    });
  return { width, height: rows.length, bits };
}

test('the holes of a raster are filled, but an opening to the outside is not', () => {
  const filled = (rows: string[]) => {
    const { raster, width, height } = maskOf(rows);
    return Array.from({ length: height }, (_, y) =>
      Array.from(fillHoles(raster, width, height).slice(y * width, (y + 1) * width), (v) => (v ? '#' : '.')).join(''),
    );
  };
  assert.deepEqual(filled(['#####', '#...#', '#.#.#', '#...#', '#####']), [
    '#####',
    '#####',
    '#####',
    '#####',
    '#####',
  ]);
  assert.deepEqual(filled(['....', '.##.', '....']), ['....', '.##.', '....'], 'nothing to fill');
  assert.deepEqual(
    filled(['#####', '#...#', '#...#', '#....']),
    ['#####', '#...#', '#...#', '#....'],
    'a gap in the wall',
  );
  assert.deepEqual(
    filled(['.###.', '#...#', '#...#', '.###.']),
    ['.###.', '#####', '#####', '.###.'],
    'a ring that touches only at corners is closed',
  );
  assert.deepEqual(filled(['.#.', '#.#', '.#.']), ['.#.', '###', '.#.'], 'so is a diamond of single pixels');
  assert.deepEqual(filled(['###', '#.#', '###']), ['###', '###', '###'], 'a hole against the raster edge');
  assert.deepEqual(filled(['....', '....']), ['....', '....'], 'an empty raster');
  assert.deepEqual(filled(['#']), ['#']);
});

test('the share of ink is measured over the object with its holes filled, in image pixels', () => {
  // A box with its text left out of the mask (the holes), as SAM masks often are: the text is the ink.
  const mask = maskOf(['######', '#....#', '#....#', '######'], 2, 1);
  const component = maskComponent(mask, [3, 2])!;
  const ink = inkOf(['........', '........', '..#..#..', '...##...', '........', '........']);
  // The object covers 6 x 4 = 24 pixels at (2, 1); four of them are ink: (2, 2), (5, 2), (3, 3) and (4, 3).
  assert.equal(inkShare(component.pixels, mask, ink), 4 / 24);
  assert.equal(
    inkShare(component.pixels, mask, inkOf(['........', '........', '........', '........', '........', '........'])),
    0,
  );
  assert.equal(
    inkShare(component.pixels, mask, inkOf(['########', '########', '########', '########', '########', '########'])),
    1,
  );
  // An ink map of another image, or one the mask reaches out of, is no measure.
  assert.equal(inkShare(component.pixels, mask, inkOf(['....', '....', '....'])), undefined);
  assert.equal(inkShare(component.pixels, mask, { width: 8, height: 6, bits: new Uint8Array(2) }), undefined);
  // The outline carries the share when it is given the ink, and nothing otherwise.
  assert.equal(maskOutline(mask, [3, 2], undefined, ink)!.ink, 4 / 24);
  assert.equal('ink' in maskOutline(mask, [3, 2])!, false);
  assert.equal(
    'ink' in maskOutline(mask, [3, 2], undefined, inkOf(['....']))!,
    false,
    'a measure of another size is dropped',
  );
});
