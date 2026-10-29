import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BBox, Doc } from '../../shared/paper';
import type { RegionSelection } from '../../shared/selection';
import { encodeSegmentationMask } from '../node_modules/@meta-sam/parser/dist/mask-codec.js';
import { createApp } from '../src/app';
import { ROOT, type MuseConfig } from '../src/config';
import { HttpError, missing } from '../src/errors';
import type { Library } from '../src/service';
import {
  cropRect,
  jpegSize,
  snapRejection,
  SnapService,
  snapService,
  validateSnap,
  type SnapLibrary,
  type SnapResult,
  type SnapSettings,
} from '../src/snap';
import type { TourImage } from '../src/tour-generator';

const KEY = 'unit-test-key-never-logged';
const config: MuseConfig = {
  apiKey: KEY,
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en-US',
  timeoutMs: 5000,
};
const DOCUMENT = '7694558d-f7e2-4cbd-9355-978ec677b254';
const ANALYSIS = '0b0c4b6e-6c2e-4d63-9d2d-7d3bd6c8a001';
const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: '0'.repeat(64), num_pages: 2, generator: 'test' },
  pages: [
    { n: 1, width: 612, height: 792 },
    { n: 2, width: 612, height: 792 },
  ],
  sections: [],
  blocks: [],
  sentences: [],
  figures: [],
  equations: [],
};

// ------------------------------------------------------------- pure checks

test('the guards pass an object inside the box and reject what the spike’s bad snaps did', () => {
  const drag = { left: 100, top: 100, right: 300, bottom: 200 };
  const bbox = (left: number, top: number, right: number, bottom: number) => ({ left, top, right, bottom });
  const inside = { confidence: 0.9, bbox: bbox(110, 105, 290, 195), area: 12000 };
  assert.equal(snapRejection(inside, drag), null);
  // Confidence below 0.6 (0.6 itself passes), or none at all.
  assert.equal(snapRejection({ ...inside, confidence: 0.6 }, drag), null);
  assert.equal(snapRejection({ ...inside, confidence: 0.59 }, drag), 'low_confidence');
  assert.equal(snapRejection({ ...inside, confidence: undefined }, drag), 'low_confidence');
  // Reaching past the box by more than 0.15 of its size on any side: 30 of 200 wide, 15 of 100 high.
  assert.equal(snapRejection({ ...inside, bbox: bbox(70, 105, 290, 195) }, drag), null);
  assert.equal(snapRejection({ ...inside, bbox: bbox(69, 105, 290, 195) }, drag), 'overshoot');
  assert.equal(snapRejection({ ...inside, bbox: bbox(110, 85, 290, 195) }, drag), null);
  assert.equal(snapRejection({ ...inside, bbox: bbox(110, 84, 290, 195) }, drag), 'overshoot');
  assert.equal(snapRejection({ ...inside, bbox: bbox(110, 105, 331, 195) }, drag), 'overshoot');
  assert.equal(snapRejection({ ...inside, bbox: bbox(110, 105, 290, 216) }, drag), 'overshoot');
  // More than 0.9 of the box is the background, not an object.
  assert.equal(snapRejection({ ...inside, area: 18000 }, drag), null);
  assert.equal(snapRejection({ ...inside, area: 18001 }, drag), 'too_large');
});

test('the crop is the box grown by 30 percent a side, at least 10 points, clamped to the page', () => {
  const page = { width: 612, height: 792 };
  assert.deepEqual(cropRect(page, [100, 200, 200, 260]), [70, 182, 230, 278]);
  assert.deepEqual(cropRect(page, [300, 300, 304, 304]), [290, 290, 314, 314], 'a tiny box keeps some context');
  assert.deepEqual(cropRect(page, [5, 5, 600, 790]), [0, 0, 612, 792]);
});

test('a request is checked against the page: an integer page and a finite, non-empty box inside it', () => {
  const ok = (page: unknown, box: unknown) => validateSnap(doc, { page, box } as never);
  assert.deepEqual(ok(2, [10, 20, 30, 40]), { page: doc.pages[1], box: [10, 20, 30, 40] });
  assert.deepEqual(ok(1, [-0.005, 0, 612.004, 792]).box, [0, 0, 612, 792], 'rounding at the edge is clamped');
  for (const [page, box] of [
    [0, [10, 20, 30, 40]],
    [3, [10, 20, 30, 40]],
    [1.5, [10, 20, 30, 40]],
    ['1', [10, 20, 30, 40]],
    [1, [10, 20, 30]],
    [1, [10, 20, 30, 40, 50]],
    [1, [10, 20, NaN, 40]],
    [1, [10, 20, Infinity, 40]],
    [1, [10, 20, '30', 40]],
    [1, [10, 20, null, 40]],
    [1, 'box'],
    [1, [-1, 20, 30, 40]],
    [1, [10, 20, 613, 40]],
    [1, [10, 20, 30, 793]],
    [1, [30, 20, 10, 40]],
    [1, [10, 40, 30, 20]],
    [1, [10, 20, 10, 40]],
    [1, [10, 20, 30, 20.5]],
  ] as [unknown, unknown][])
    assert.throws(() => ok(page, box), { status: 400, code: 'invalid_selection' }, JSON.stringify([page, box]));
});

/** The bytes of a JPEG up to its start-of-frame marker: all the size reader looks at. */
function jpegHeader(width: number, height: number): Buffer {
  const app = Buffer.from([0xff, 0xe0, 0x00, 0x06, 0x4a, 0x46, 0x49, 0x46]);
  const frame = Buffer.alloc(19);
  frame.set([0xff, 0xc0, 0x00, 0x11, 0x08]);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  frame.set([0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01], 9);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app, frame, Buffer.from([0xff, 0xd9])]);
}

test('the size of a crop is read from its JPEG header', () => {
  assert.deepEqual(jpegSize(jpegHeader(1408, 1024)), { width: 1408, height: 1024 });
  assert.equal(jpegSize(Buffer.from('not a jpeg')), null);
  assert.equal(jpegSize(jpegHeader(10, 10).subarray(0, 12)), null);
});

// ------------------------------------------------------------- the service

const POINTS_TO_PIXELS = 6;
/** The crop a renderer would make: the rectangle at 6 pixels to the point, as a JPEG with a real header. */
const cropImage = (selection: RegionSelection): TourImage[] => {
  const [x1, y1, x2, y2] = selection.rect;
  const header = jpegHeader(
    Math.round((x2 - x1) * 612 * POINTS_TO_PIXELS),
    Math.round((y2 - y1) * 792 * POINTS_TO_PIXELS),
  );
  return [
    { targetId: `page${selection.page}`, kind: 'page', page: selection.page, label: 'page', dataUrl: 'data:,' },
    {
      targetId: `selection-page${selection.page}`,
      kind: 'page',
      page: selection.page,
      label: 'crop',
      dataUrl: `data:image/jpeg;base64,${header.toString('base64')}`,
    },
  ];
};

/** What one request to SAM asked, read back from its body. */
interface Shot {
  key: string;
  box: { left: number; top: number; right: number; bottom: number };
  point: { x: number; y: number };
  image: { width: number; height: number };
  imageUrl: string;
}
function shotOf(init: RequestInit): Shot {
  const body = JSON.parse(String(init.body));
  const [text, image] = body.input[0].content;
  const n = (name: string, from: string) => Number(new RegExp(`${name}=(\\d+)`).exec(from)![1]);
  const box = /<\|box;[^|]*\|>/.exec(text.text)![0];
  const point = /<\|point;[^|]*\|>/.exec(text.text)![0];
  const key = String((init.headers as Record<string, string>).Authorization).replace('Bearer ', '');
  return {
    key,
    box: { left: n('x1', box), top: n('y1', box), right: n('x2', box) + 1, bottom: n('y2', box) + 1 },
    point: { x: n('x', point), y: n('y', point) },
    image: { width: n('w', box), height: n('h', box) },
    imageUrl: image.image_url,
  };
}
const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
const reply = (text: string) => json({ output: [{ type: 'message', content: [{ type: 'output_text', text }] }] });

/** The reply for a rectangular object: the drag box shrunk by `inset` of its size on every side (negative: grown). */
function objectReply(shot: Shot, inset = 0.1, confidence: number | null = 0.9): Response {
  const width = shot.box.right - shot.box.left;
  const height = shot.box.bottom - shot.box.top;
  const left = Math.round(shot.box.left + inset * width);
  const right = Math.round(shot.box.right - inset * width);
  const top = Math.round(shot.box.top + inset * height);
  const bottom = Math.round(shot.box.bottom - inset * height);
  const { payload } = encodeSegmentationMask(
    new Uint8Array((right - left) * (bottom - top)).fill(1),
    right - left,
    bottom - top,
  );
  const c = confidence === null ? '' : `;c=${confidence}`;
  return reply(
    `<0f>0<|box;x1=${left};y1=${top};x2=${right - 1};y2=${bottom - 1};w=${shot.image.width};h=${shot.image.height}${c}|>` +
      `<|mask;x=0;y=0${c};data=${bottom - top},${right - left},${payload}|>\n`,
  );
}

function fakeSam(answer: (shot: Shot, call: number) => Response | Promise<Response>) {
  const shots: Shot[] = [];
  const fetcher = (async (_url: unknown, init: RequestInit = {}) => {
    const shot = shotOf(init);
    shots.push(shot);
    const pending = answer(shot, shots.length);
    if (!init.signal) return pending;
    // Like a real fetch, a request in flight stops with its signal.
    return Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        const stop = () => reject(init.signal!.reason);
        if (init.signal!.aborted) stop();
        else init.signal!.addEventListener('abort', stop, { once: true });
      }),
    ]);
  }) as typeof fetch;
  return { fetcher, shots };
}

function setup(
  answer: Parameters<typeof fakeSam>[0],
  extra: { options?: ConstructorParameters<typeof SnapService>[2]; demoRoot?: string; apiKey?: string } = {},
) {
  const { fetcher, shots } = fakeSam(answer);
  const queries: unknown[][] = [];
  const library: SnapLibrary = {
    owned: async (owner, id) =>
      owner === 'alice' && id === DOCUMENT ? { upload_path: 'u/p.pdf', current_analysis_id: ANALYSIS } : missing(),
    db: {
      query: async (_text: string, values: unknown[] = []) => {
        queries.push(values);
        return { rows: values[0] === ANALYSIS ? [{ id: ANALYSIS, doc }] : [] };
      },
    } as unknown as SnapLibrary['db'],
    storage: { download: async () => assert.fail('the test renders without the PDF') },
    ...(extra.demoRoot ? { demoRoot: extra.demoRoot } : {}),
  };
  const settings: SnapSettings = {
    base: { ...config, apiKey: extra.apiKey ?? KEY },
    transport: fetcher,
    resolveMuse: async (owner) => ({ config: { ...config, apiKey: extra.apiKey === '' ? '' : `${owner}-key` } }),
  };
  const events: Record<string, unknown>[] = [];
  const rects: RegionSelection[] = [];
  const service = new SnapService(library, settings, {
    images: async (selection) => (rects.push(selection), cropImage(selection)),
    log: (event) => events.push(event),
    ...extra.options,
  });
  return { service, shots, queries, events, rects };
}

const BOX: BBox = [100, 200, 200, 260];
const own = (box: BBox = BOX, page = 1) => ({ page, box });
const okResult = (result: SnapResult) => {
  assert.ok(result.ok, JSON.stringify(result));
  return result;
};

test('a snap crops around the drag, asks SAM for the box and its centre, and returns the outline in PDF points', async () => {
  const { service, shots, rects, events } = setup((shot) => objectReply(shot, 0.1));
  const result = okResult(await service.snap('alice', DOCUMENT, own()));
  // The crop is the box plus 30 percent of its size a side: (70, 182)-(230, 278) points, 960 x 576 pixels.
  assert.deepEqual(
    rects[0].rect.map((n, i) => Math.round(n * (i % 2 ? 792 : 612) * 100) / 100),
    [70, 182, 230, 278],
  );
  assert.equal(rects[0].page, 1);
  assert.deepEqual(shots[0].image, { width: 960, height: 576 });
  assert.deepEqual(shots[0].box, { left: 180, top: 108, right: 780, bottom: 468 });
  assert.deepEqual(shots[0].point, { x: 480, y: 288 });
  assert.ok(shots[0].imageUrl.startsWith('data:image/jpeg;base64,'));
  assert.equal(shots[0].key, 'alice-key', 'the learner’s own connection is used');
  assert.deepEqual(result.polygon, [
    [110, 206],
    [190, 206],
    [190, 254],
    [110, 254],
  ]);
  assert.deepEqual(result.bbox, [110, 206, 190, 254]);
  assert.equal(result.confidence, 0.9);
  assert.ok(result.ms >= 0 && result.cached === undefined);
  assert.ok(!/alice-key|never-logged/.test(JSON.stringify([result, events])), 'no key in results or logs');
  assert.equal(events[0].event, 'snap_done');
  assert.equal(events[0].documentId, DOCUMENT);
});

test('boxes within about 2 points share one answer', async () => {
  const { service, shots } = setup((shot) => objectReply(shot, 0.1));
  const first = okResult(await service.snap('alice', DOCUMENT, own()));
  const again = okResult(await service.snap('alice', DOCUMENT, own([100.4, 200.4, 200.4, 260.4])));
  assert.equal(shots.length, 1);
  assert.equal(again.cached, true);
  assert.deepEqual(again.polygon, first.polygon);
  await service.snap('alice', DOCUMENT, own([103, 200, 200, 260]));
  await service.snap('alice', DOCUMENT, own(BOX, 2));
  assert.equal(shots.length, 3, 'another box, and another page');
  await service.snap('alice', DOCUMENT, own());
  assert.equal(shots.length, 3);
});

test('the guards turn bad snaps into reasons, and the same box is not asked again', async () => {
  const cases: [string, (shot: Shot) => Response][] = [
    ['low_confidence', (shot) => objectReply(shot, 0.1, 0.5)],
    ['low_confidence', (shot) => objectReply(shot, 0.1, null)],
    ['overshoot', (shot) => objectReply(shot, -0.2)],
    ['too_large', (shot) => objectReply(shot, 0)],
    ['no_object', () => reply('')],
    ['no_object', () => reply('Nothing found.')],
  ];
  for (const [reason, answer] of cases) {
    const { service, shots } = setup(answer);
    assert.deepEqual(await service.snap('alice', DOCUMENT, own()), { ok: false, reason });
    assert.deepEqual(await service.snap('alice', DOCUMENT, own()), { ok: false, reason });
    assert.equal(shots.length, 1, reason);
  }
});

test('the object kept is the one under the centre of the drag, not a stray beside it', async () => {
  const { service } = setup((shot) => {
    const { left, top, right, bottom } = shot.box;
    const width = right - left;
    const height = bottom - top;
    const raster = new Uint8Array(width * height);
    const put = (x0: number, y0: number, x1: number, y1: number) => {
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) raster[y * width + x] = 1;
    };
    put(60, 40, Math.floor(width * 0.8), Math.floor(height * 0.8)); // the object, around the centre
    put(0, 0, 20, 20); // a stray corner of something else inside the box
    const { payload } = encodeSegmentationMask(raster, width, height);
    return reply(
      `<0f>0<|box;x1=${left};y1=${top};x2=${right - 1};y2=${bottom - 1};w=${shot.image.width};h=${shot.image.height};c=0.9|>` +
        `<|mask;x=0;y=0;c=0.9;data=${height},${width},${payload}|>\n`,
    );
  });
  const result = okResult(await service.snap('alice', DOCUMENT, own()));
  assert.deepEqual(result.bbox, [110, 206.67, 180, 248], 'the stray corner is dropped');
});

test('failures that may pass are reported as reasons and asked again next time; a rejected request is final', async () => {
  const run = async (answer: (shot: Shot) => Response | Promise<Response>, options = {}) => {
    const { service, shots } = setup(answer, { options });
    const first = await service.snap('alice', DOCUMENT, own());
    const second = await service.snap('alice', DOCUMENT, own());
    return { first, second, calls: shots.length };
  };
  const warn = console.warn;
  console.warn = () => undefined; // the provider notes a rejected request
  try {
    const rejected = await run(() => new Response(KEY, { status: 400 }));
    assert.deepEqual(rejected.first, { ok: false, reason: 'rejected' });
    assert.equal(rejected.calls, 1, 'a 400 is permanent');
    for (const [status, reason] of [
      [429, 'busy'],
      [500, 'unavailable'],
      [503, 'unavailable'],
      [401, 'not_configured'],
    ] as const) {
      const failed = await run(() => new Response(KEY, { status }));
      assert.deepEqual(failed.first, { ok: false, reason }, String(status));
      assert.equal(failed.calls, 2, `${status} is tried again`);
    }
  } finally {
    console.warn = warn;
  }
  const unusable = await run(() => json({ output: [] }));
  assert.deepEqual(unusable.first, { ok: false, reason: 'invalid_response' });
  const slow = await run(() => new Promise<Response>(() => undefined), { timeoutMs: 30 });
  assert.deepEqual(slow.first, { ok: false, reason: 'timeout' });
  assert.equal(slow.calls, 2);
});

test('without a key there is no call, and a cancelled drag stops its call', async () => {
  const none = setup(() => assert.fail('no call without a key'), { apiKey: '' });
  assert.deepEqual(await none.service.snap('alice', DOCUMENT, own()), { ok: false, reason: 'not_configured' });
  const controller = new AbortController();
  const { service, shots } = setup(() => new Promise<Response>(() => undefined));
  const pending = service.snap('alice', DOCUMENT, own(), controller.signal);
  await new Promise((resolve) => setTimeout(resolve, 20));
  controller.abort();
  assert.deepEqual(await pending, { ok: false, reason: 'cancelled' });
  assert.equal(shots.length, 1);
});

test('three snaps may be in flight for one learner; a fourth waits for the model', async () => {
  const release: (() => void)[] = [];
  const { service, shots } = setup((shot, call) =>
    call > 3
      ? objectReply(shot, 0.1)
      : new Promise<Response>((resolve) => release.push(() => resolve(objectReply(shot, 0.1)))),
  );
  const boxes: BBox[] = [
    [100, 200, 200, 260],
    [300, 200, 400, 260],
    [100, 400, 200, 460],
    [300, 400, 400, 460],
  ];
  const first = boxes.slice(0, 3).map((box) => service.snap('alice', DOCUMENT, own(box)));
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.deepEqual(await service.snap('alice', DOCUMENT, own(boxes[3])), { ok: false, reason: 'busy' });
  assert.equal(shots.length, 3, 'the fourth never reached the model');
  release.forEach((go) => go());
  for (const result of await Promise.all(first)) assert.ok(result.ok);
  assert.ok((await service.snap('alice', DOCUMENT, own(boxes[3]))).ok, 'a free slot again');
});

test('a bad request or an unreadable document is an error, never a call', async () => {
  const { service, shots, queries } = setup(() => assert.fail('no call'));
  for (const request of [
    own(BOX, 0),
    own(BOX, 3),
    own([0, 0, 700, 10]),
    own([10, 10, 10, 50]),
    { page: 1, box: [1, 2, 3] as never },
  ])
    await assert.rejects(service.snap('alice', DOCUMENT, request as never), { status: 400, code: 'invalid_selection' });
  await assert.rejects(service.snap('mallory', DOCUMENT, own()), { status: 404 });
  await assert.rejects(service.snap('alice', DOCUMENT, { ...own(), analysisId: ANALYSIS.replace('001', '002') }), {
    status: 409,
    code: 'analysis_not_ready',
  });
  assert.equal(queries.at(-1)![0], ANALYSIS.replace('001', '002'), 'the reader’s analysis is the one read');
  assert.equal(shots.length, 0);
  await assert.rejects(service.demoSnap('missing-paper', own()), { status: 404 });
  await assert.rejects(service.demoSnap('../etc', own()), { status: 404 });
});

test('a crop that cannot be rendered leaves the rectangle; a mismatched original is an error', async () => {
  const warn = console.warn;
  console.warn = () => undefined;
  try {
    const broken = setup(() => assert.fail('no call'), {
      options: { images: async () => Promise.reject(new Error('pymupdf crashed')) },
    });
    assert.deepEqual(await broken.service.snap('alice', DOCUMENT, own()), { ok: false, reason: 'render_failed' });
    const empty = setup(() => assert.fail('no call'), { options: { images: async () => [] } });
    assert.deepEqual(await empty.service.snap('alice', DOCUMENT, own()), { ok: false, reason: 'render_failed' });
    const notJpeg = setup(() => assert.fail('no call'), {
      options: { images: async (s) => cropImage(s).map((i) => ({ ...i, dataUrl: 'data:image/jpeg;base64,AAAA' })) },
    });
    assert.deepEqual(await notJpeg.service.snap('alice', DOCUMENT, own()), { ok: false, reason: 'render_failed' });
  } finally {
    console.warn = warn;
  }
  const mismatch = setup(() => assert.fail('no call'), {
    options: {
      images: async () => {
        throw new HttpError(409, 'source_mismatch', 'The original PDF does not match this document analysis.');
      },
    },
  });
  await assert.rejects(mismatch.service.snap('alice', DOCUMENT, own()), { status: 409, code: 'source_mismatch' });
});

// ------------------------------------------------------------- real renderer

const python = process.env.PYTHON_BIN ?? resolve(ROOT, 'ingest/.venv/bin/python');
const attention = resolve(ROOT, 'demo/attention/paper.pdf');
test(
  'a demo snap crops the real PDF around the drag and maps the outline back to its points',
  { skip: !existsSync(python) || !existsSync(attention) },
  async () => {
    const { fetcher, shots } = fakeSam((shot) => objectReply(shot, 0.1));
    const settings: SnapSettings = { base: config, transport: fetcher, resolveMuse: async () => ({ config }) };
    const service = new SnapService({ demoRoot: undefined } as unknown as SnapLibrary, settings, {
      log: () => undefined,
    });
    // Figure 1 of "Attention Is All You Need" is on page 3 and spans (196.5, 72.5)-(415.5, 394).
    const box: BBox = [250, 120, 360, 200];
    const result = okResult(await service.demoSnap('attention', { page: 3, box }));
    const long = Math.max(shots[0].image.width, shots[0].image.height);
    assert.ok(long >= 1000 && long <= 2000, `${shots[0].image.width} x ${shots[0].image.height}`);
    // The mask is the box shrunk by a tenth, so its outline must come back to those points (to a pixel or two).
    const [x1, y1, x2, y2] = result.bbox;
    assert.ok(Math.abs(x1 - 261) < 1 && Math.abs(x2 - 349) < 1, `${result.bbox}`);
    assert.ok(Math.abs(y1 - 128) < 1 && Math.abs(y2 - 192) < 1, `${result.bbox}`);
    assert.equal(result.polygon.length, 4);
  },
);

// ------------------------------------------------------------- routes

const POSTER = { authorization: 'Bearer valid' };
const someResult: SnapResult = {
  ok: true,
  polygon: [
    [1, 2],
    [3, 2],
    [3, 4],
  ],
  bbox: [1, 2, 3, 4],
  confidence: 0.8,
  ms: 900,
};

test('the document route needs a sign-in and a strictly valid body', async () => {
  const seen: unknown[] = [];
  const snap = {
    snap: async (owner: string, id: string, request: unknown) => (seen.push([owner, id, request]), someResult),
  } as unknown as SnapService;
  const app = await createApp({
    service: {} as Library,
    authenticate: async (token) => (token === 'valid' ? 'alice' : null),
    snap,
  });
  const url = `/api/documents/${DOCUMENT}/snap`;
  const post = (payload: unknown, headers: Record<string, string> = POSTER) =>
    app.inject({
      method: 'POST',
      url,
      headers: { 'content-type': 'application/json', ...headers },
      payload: payload as never,
    });
  try {
    assert.equal((await post({ page: 1, box: BOX }, {})).statusCode, 401);
    const ok = await post({ page: 1, box: BOX });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.deepEqual(ok.json(), someResult);
    assert.deepEqual(seen, [['alice', DOCUMENT, { page: 1, box: BOX }]]);
    await post({ page: 2, box: BOX, analysisId: ANALYSIS });
    assert.deepEqual(seen[1], ['alice', DOCUMENT, { page: 2, box: BOX, analysisId: ANALYSIS }]);
    seen.length = 0;
    for (const bad of [
      {},
      { box: BOX },
      { page: 1 },
      { page: 0, box: BOX },
      { page: 1.5, box: BOX },
      { page: '1', box: BOX },
      { page: 1, box: [1, 2, 3] },
      { page: 1, box: [1, 2, 3, 4, 5] },
      { page: 1, box: [1, 2, 3, '4'] },
      { page: 1, box: [1, 2, 3, null] },
      { page: 1, box: 'box' },
      { page: 1, box: BOX, extra: true },
      { page: 1, box: BOX, analysisId: 'latest' },
      '{"page":1,"box":[0,0,1e999,5]}',
      '[1]',
      'null',
    ]) {
      const response = await post(bad);
      assert.equal(response.statusCode, 400, JSON.stringify(bad));
      assert.equal(response.json().error.code, 'invalid_request');
    }
    assert.equal(
      (
        await app.inject({
          url: `/api/documents/not-a-uuid/snap`,
          method: 'POST',
          headers: POSTER,
          payload: { page: 1, box: BOX },
        })
      ).statusCode,
      400,
    );
    assert.deepEqual(seen, [], 'nothing invalid reached the service');
  } finally {
    await app.close();
  }
});

test('the document route reads the learner’s own document and refuses boxes outside its page', async () => {
  const { service, shots } = setup((shot) => objectReply(shot, 0.1));
  const app = await createApp({
    service: {} as Library,
    authenticate: async (token) => (token === 'valid' ? 'alice' : token === 'other' ? 'mallory' : null),
    snap: service,
  });
  const post = (payload: unknown, token = 'valid') =>
    app.inject({
      method: 'POST',
      url: `/api/documents/${DOCUMENT}/snap`,
      headers: { authorization: `Bearer ${token}` },
      payload: payload as never,
    });
  try {
    const ok = await post({ page: 1, box: BOX });
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().ok, true);
    assert.equal(ok.json().polygon.length, 4);
    for (const bad of [
      { page: 9, box: BOX },
      { page: 1, box: [0, 0, 700, 100] },
      { page: 1, box: [50, 50, 50, 90] },
      { page: 1, box: [-5, 0, 100, 100] },
    ]) {
      const response = await post(bad);
      assert.equal(response.statusCode, 400, JSON.stringify(bad));
      assert.equal(response.json().error.code, 'invalid_selection');
    }
    const foreign = await post({ page: 1, box: BOX }, 'other');
    assert.equal(foreign.statusCode, 404, 'someone else’s document');
    assert.equal(shots.length, 1);
    assert.ok(!ok.body.includes(KEY) && !foreign.body.includes(KEY));
  } finally {
    await app.close();
  }
});

test('snapping says so when the server cannot do it', async () => {
  const app = await createApp({ service: {} as Library, authenticate: async () => 'alice' });
  try {
    const response = await app.inject({
      method: 'POST',
      url: `/api/documents/${DOCUMENT}/snap`,
      headers: POSTER,
      payload: { page: 1, box: BOX },
    });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'snap_unavailable');
  } finally {
    await app.close();
  }
  assert.equal(snapService({}), undefined);
  assert.equal(snapService({ owned: async () => ({}), db: {}, storage: {} }), undefined, 'no Meta connection');
  const settings = { base: config, transport: fetch, resolveMuse: async () => ({ config }) };
  assert.ok(snapService({ owned: async () => ({}), db: {}, storage: {}, settings }) instanceof SnapService);
  assert.ok(snapService({ owned: async () => ({}), db: {}, storage: {} }, settings) instanceof SnapService);
  // A library that answers every property with a function (a test double) is not mistaken for the real one.
  assert.equal(snapService(new Proxy({}, { get: () => async () => undefined })), undefined);
});

async function demoRoot() {
  const root = await mkdtemp(join(tmpdir(), 'paper-tour-snap-'));
  await mkdir(join(root, 'paper'));
  await writeFile(join(root, 'paper', 'doc.json'), JSON.stringify(doc));
  return { root, remove: () => rm(root, { recursive: true, force: true }) };
}

test('demo snaps need local development and this machine, like demo questions', async () => {
  const folder = await demoRoot();
  const { service, shots } = setup((shot) => objectReply(shot, 0.1), { demoRoot: folder.root });
  const production = await createApp({
    service: {} as Library,
    authenticate: async () => null,
    snap: service,
    demo: false,
  });
  const app = await createApp({ service: {} as Library, authenticate: async () => null, snap: service, demo: true });
  const post = (
    url: string,
    extra: { remoteAddress?: string; headers?: Record<string, string> } = {},
    payload: unknown = { page: 1, box: BOX },
  ) => app.inject({ method: 'POST', url, payload: payload as never, ...extra });
  try {
    const anonymous = await production.inject({
      method: 'POST',
      url: '/api/demo/paper/snap',
      payload: { page: 1, box: BOX },
    });
    assert.equal(anonymous.statusCode, 404, 'not exposed outside local development');
    assert.equal(shots.length, 0);
    const ok = await post('/api/demo/paper/snap');
    assert.equal(ok.statusCode, 200, ok.body);
    assert.equal(ok.json().ok, true);
    assert.equal(shots[0].key, KEY, 'a demo uses the server’s own key');
    shots.length = 0;
    assert.equal((await post('/api/demo/missing/snap')).statusCode, 404);
    for (const url of ['/api/demo/..%2F..%2Fserver/snap', '/api/demo/.hidden/snap', '/api/demo/a..b/snap'])
      assert.equal((await post(url)).statusCode, 400, url);
    assert.equal((await post('/api/demo/%2E%2E/snap')).statusCode, 404);
    assert.equal((await post('/api/demo/paper/snap', { remoteAddress: '10.0.0.7' })).statusCode, 404);
    assert.equal((await post('/api/demo/paper/snap', { headers: { host: 'rebound.example:5174' } })).statusCode, 404);
    for (const bad of [
      {},
      { page: 0, box: BOX },
      { page: 1, box: [1, 2, 3] },
      { page: 1, box: BOX, analysisId: ANALYSIS },
      { page: 1, box: [0, 0, 700, 9] },
    ]) {
      const response = await post('/api/demo/paper/snap', {}, bad);
      assert.equal(response.statusCode, 400, JSON.stringify(bad));
    }
    assert.equal(shots.length, 0, 'no refused request reached the model');
  } finally {
    await app.close();
    await production.close();
    await folder.remove();
  }
});
