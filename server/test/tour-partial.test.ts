import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/app';
import { HttpError } from '../src/errors';
import type { Database, Db } from '../src/db';
import { DocumentService } from '../src/service';
import type { Library } from '../src/service';
import type { FileStorage } from '../src/storage';
import { clearPartial, partialFromEvent, partialSink, partialView, savePartial } from '../src/tour-partial';
import type { TourPartial } from '../src/tour-partial';
import type { Doc, Tour } from '../../shared/paper';
import type { TourPartialView } from '../../shared/contracts';

// Progressive tours on the server: the event the generator emits becomes a stored partial (tour-partial.ts), the worker's
// sink keeps it and journals counts only, and the reader polls GET /documents/:id/generations/:generationId/partial.
// These run against fake services; the same storage against a real database (never stepping back, never serving a
// finished generation, cleared when the tour is saved) is in tour-worker.test.ts, which skips without TEST_DATABASE_URL.

const documentId = '7694558d-f7e2-4cbd-9355-978ec677b254';
const generationId = '0e2b4a4c-5d3e-4a53-9d0b-6d8f0e3a8c11';
const attempt = 'b3f1c7de-9d1a-4c52-8f0e-2a6d7b5c9e44';
const SHA = 'a'.repeat(64);
const doc = { source: { sha256: SHA } } as unknown as Doc;

const step = (id: string) => ({ id, say: `Step ${id} says one thing.`, actions: [{ type: 'highlight', targets: ['p1.s1'] }] });
const leading = (count: number): Tour => {
  const all = ['a', 'b', 'c', 'd', 'e'].map(step);
  return {
    schema: 'paper-tour/tour@0.1',
    title: 'A tour',
    paper: documentId,
    doc_sha256: SHA,
    chapters: [{ id: 'c1', title: 'One', steps: all.slice(0, count) }],
  } as unknown as Tour;
};
const event = (over: Record<string, unknown> = {}) => ({ tour: leading(2), ready: 2, planned: 5, ...over });

/** A database that records what it is asked and answers from a script. */
function fakeDb(answer: (text: string, values: unknown[]) => unknown = () => ({ rowCount: 1, rows: [] })) {
  const calls: { text: string; values: unknown[] }[] = [];
  const db = {
    query: async (text: string, values: unknown[] = []) => {
      calls.push({ text: text.replace(/\s+/g, ' ').trim(), values });
      const result = answer(text, values);
      if (result instanceof Error) throw result;
      return result;
    },
  } as unknown as Db;
  return { db, calls };
}

// ------------------------------------------------------------------------------------------- the event

test('a partial is read from the generator event, and planned never falls below ready', () => {
  const partial = partialFromEvent(event(), doc)!;
  assert.deepEqual([partial.ready, partial.planned, partial.tour.chapters[0].steps.length], [2, 5, 2]);
  assert.equal(partialFromEvent(event({ planned: 1 }), doc)!.planned, 2, 'raised to ready');
  assert.equal(partialFromEvent(event({ planned: undefined }), doc)!.planned, 2, 'a missing plan is the ready count');
  assert.equal(partialFromEvent(event({ planned: 99999 }), doc)!.planned, 1000, 'and a plan beyond reason is capped');
});

test('what cannot be played is not kept: another document, no steps, a bad count or a broken shape', () => {
  const bad: [string, Record<string, unknown>][] = [
    ['another document', event({ tour: { ...leading(2), doc_sha256: 'b'.repeat(64) } })],
    ['another schema', event({ tour: { ...leading(2), schema: 'other' } })],
    ['no title', event({ tour: { ...leading(2), title: undefined } })],
    ['no chapters', event({ tour: { ...leading(2), chapters: [] } })],
    ['an empty chapter only', event({ tour: { ...leading(2), chapters: [{ id: 'c', title: 'C', steps: [] }] } })],
    ['a chapter without an id', event({ tour: { ...leading(2), chapters: [{ title: 'C', steps: [step('a')] }] } })],
    ['a step without narration', event({ tour: { ...leading(2), chapters: [{ id: 'c', title: 'C', steps: [{ id: 'a', actions: [] }] }] } })],
    ['a step without actions', event({ tour: { ...leading(2), chapters: [{ id: 'c', title: 'C', steps: [{ id: 'a', say: 'x' }] }] } })],
    ['no tour', event({ tour: undefined })],
    ['a tour that is a list', event({ tour: [] })],
    ['zero ready', event({ ready: 0 })],
    ['a fraction', event({ ready: 1.5 })],
    ['a text count', event({ ready: '2' })],
    ['more steps than any tour', event({ ready: 1001 })],
  ];
  for (const [what, data] of bad) assert.equal(partialFromEvent(data, doc), null, what);
  const huge = leading(1);
  huge.chapters[0].steps[0] = { ...huge.chapters[0].steps[0], say: 'x'.repeat(4 * 1024 * 1024 + 1) };
  assert.equal(partialFromEvent(event({ tour: huge }), doc), null, 'larger than a partial may be');
});

// ----------------------------------------------------------------------------------------------- storage

test('a partial is written in one statement, for a running generation, and replaces only an equal or longer one', async () => {
  const { db, calls } = fakeDb();
  const partial: TourPartial = { tour: leading(3), ready: 3, planned: 5 };
  assert.equal(await savePartial(db, generationId, partial), true);
  assert.equal(calls.length, 1, 'one statement: never half written');
  const [{ text, values }] = calls;
  assert.deepEqual(values, [generationId, JSON.stringify(partial.tour), 3, 5]);
  assert.match(text, /from tour_generations where id=\$1 and status='generating' and result_tour_id is null for share/);
  assert.match(text, /on conflict\(generation_id\) do update/);
  assert.match(text, /where tour_generation_partials\.ready<=excluded\.ready/, 'a late write cannot step back');
});

test('a partial that the store did not take (finished generation, or a longer one held) says so', async () => {
  const { db } = fakeDb(() => ({ rowCount: 0, rows: [] }));
  assert.equal(await savePartial(db, generationId, { tour: leading(1), ready: 1, planned: 5 }), false);
});

test('the sink keeps partials and journals counts only, once for each growth', async () => {
  const taken = [true, false, true];
  const { db, calls } = fakeDb(() => ({ rowCount: taken.shift() ? 1 : 0, rows: [] }));
  const journal: [string, Record<string, unknown>][] = [];
  const warnings: string[] = [];
  const sink = partialSink(
    db,
    generationId,
    doc,
    async (type, data) => void journal.push([type, data]),
    (name) => warnings.push(name),
  );
  await sink('tour.partial', event({ ready: 2, tour: leading(2) }));
  await sink('tour.partial', event({ ready: 2, tour: leading(2) }));
  await sink('tour.partial', event({ ready: 3, planned: 6, tour: leading(3) }));
  assert.equal(calls.length, 3, 'every partial is offered to the store');
  assert.deepEqual(journal, [
    ['tour.partial', { ready: 2, planned: 5 }],
    ['tour.partial', { ready: 3, planned: 6 }],
  ]);
  assert.ok(!JSON.stringify(journal).includes('chapters'), 'a tour is large and each replaces the last: not journalled');
  assert.deepEqual(warnings, []);
});

test('the sink passes every other event to the journal as it is', async () => {
  const { db, calls } = fakeDb();
  const journal: [string, Record<string, unknown>][] = [];
  const sink = partialSink(db, generationId, doc, async (type, data) => void journal.push([type, data]), () => {});
  await sink('beat.completed', { beat: 'abstract-1', outcome: 'directed' });
  assert.deepEqual(journal, [['beat.completed', { beat: 'abstract-1', outcome: 'directed' }]]);
  assert.equal(calls.length, 0, 'nothing is stored for it');
});

test('a partial that cannot be kept is logged and dropped, never failing the tour', async () => {
  const warnings: string[] = [];
  const journal: string[] = [];
  const unreachable = fakeDb(() => new Error('connection lost'));
  const sink = partialSink(unreachable.db, generationId, doc, async (type) => void journal.push(type), (name) => warnings.push(name));
  await assert.doesNotReject(() => sink('tour.partial', event()));
  assert.deepEqual(warnings, ['tour_partial_failed']);
  const rejecting = fakeDb();
  const other = partialSink(rejecting.db, generationId, doc, async (type) => void journal.push(type), (name) => warnings.push(name));
  await other('tour.partial', event({ tour: { ...leading(2), doc_sha256: 'c'.repeat(64) } }));
  assert.deepEqual(warnings, ['tour_partial_failed', 'tour_partial_rejected']);
  assert.equal(rejecting.calls.length, 0, 'a foreign tour is never stored');
  assert.deepEqual(journal, [], 'and nothing is journalled for either');
});

test('clearing forgets the generation\'s partial and survives a store that cannot be reached', async () => {
  const { db, calls } = fakeDb();
  await clearPartial(db, generationId);
  assert.deepEqual(calls.map((c) => [c.text, c.values]), [['delete from tour_generation_partials where generation_id=$1', [generationId]]]);
  await assert.doesNotReject(() => clearPartial(fakeDb(() => new Error('down')).db, generationId));
});

// ------------------------------------------------------------------------------------------------ the view

const stored = (over: Record<string, unknown> = {}) => ({
  status: 'generating',
  stage: 'writing',
  result_tour_id: null,
  attempt,
  ready: 3,
  planned: 5,
  tour: leading(3),
  ...over,
});

test('the view is the generation\'s status with the leading steps, in the contract\'s shape', async () => {
  const { db, calls } = fakeDb(() => ({ rows: [stored()] }));
  const view = await partialView(db, documentId, generationId);
  assert.deepEqual(view, {
    generationId,
    status: 'generating',
    stage: 'writing',
    tourId: null,
    attempt,
    ready: 3,
    planned: 5,
    tour: leading(3),
  } satisfies TourPartialView);
  assert.deepEqual(calls[0].values, [generationId, documentId, null, null], 'a client that holds nothing sends nothing');
  assert.match(calls[0].text, /g\.id=\$1 and g\.document_id=\$2/, 'only the document\'s own generation');
  assert.match(calls[0].text, /p\.generation_id=g\.id and g\.status='generating'/, 'a partial is served only while generating');
});

test('a client that holds a partial asks with its count and attempt, and gets counts alone while they match', async () => {
  const held = { after: 3, attempt };
  const same = fakeDb(() => ({ rows: [stored({ tour: null })] }));
  const view = await partialView(same.db, documentId, generationId, held);
  assert.deepEqual([view!.tour, view!.ready, view!.planned, view!.attempt], [null, 3, 5, attempt]);
  assert.deepEqual(same.calls[0].values, [generationId, documentId, 3, attempt]);
  assert.match(same.calls[0].text, /case when \$3::int>=p\.ready and \$4::uuid=p\.attempt then null else p\.tour end as tour/);
});

test('without a partial (queued, finished, failed) the view carries the status and zeros', async () => {
  const none = { attempt: null, ready: null, planned: null, tour: null };
  const queued = await partialView(fakeDb(() => ({ rows: [stored({ ...none, status: 'queued', stage: 'preparing' })] })).db, documentId, generationId);
  assert.deepEqual([queued!.status, queued!.stage, queued!.attempt, queued!.ready, queued!.planned, queued!.tour], ['queued', 'preparing', null, 0, 0, null]);
  const tourId = '5a1b3c4d-1111-4222-8333-444455556666';
  const done = await partialView(fakeDb(() => ({ rows: [stored({ ...none, status: 'ready', stage: 'validating', result_tour_id: tourId })] })).db, documentId, generationId);
  assert.deepEqual([done!.status, done!.tourId, done!.tour, done!.ready], ['ready', tourId, null, 0]);
});

test('another document\'s or an unknown generation has no view', async () => {
  assert.equal(await partialView(fakeDb(() => ({ rows: [] })).db, documentId, generationId), null);
});

// ---------------------------------------------------------------------------------------------- the endpoint

function service(overrides: Partial<Library> = {}): Library {
  return new Proxy(overrides, {
    get: (target, key) =>
      key in target
        ? target[key as keyof Library]
        : key === 'partial'
          ? undefined
          : async () => {
              throw new Error(`Unexpected service call: ${String(key)}`);
            },
  }) as Library;
}
const view: TourPartialView = {
  generationId,
  status: 'generating',
  stage: 'writing',
  tourId: null,
  attempt,
  ready: 2,
  planned: 5,
  tour: leading(2),
};
const url = (query = '') => `/api/documents/${documentId}/generations/${generationId}/partial${query}`;
const bearer = { authorization: 'Bearer valid' };

async function withApp(overrides: Partial<Library>, run: (app: Awaited<ReturnType<typeof createApp>>) => Promise<void>) {
  const app = await createApp({ service: service(overrides), authenticate: async (token) => (token === 'valid' ? 'the-owner' : null) });
  try {
    await run(app);
  } finally {
    await app.close();
  }
}

test('the endpoint needs the owner\'s token and is never cached', async () => {
  await withApp({ partial: async () => view }, async (app) => {
    const anonymous = await app.inject({ url: url() });
    assert.equal(anonymous.statusCode, 401);
    assert.equal(anonymous.json().error.code, 'unauthorized');
    const response = await app.inject({ url: url(), headers: bearer });
    assert.equal(response.statusCode, 200);
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.deepEqual(response.json(), view);
  });
});

test('the endpoint asks for the verified owner\'s generation, and for what is new only when told both count and attempt', async () => {
  const asked: unknown[][] = [];
  await withApp(
    {
      partial: async (...args) => {
        asked.push(args);
        return view;
      },
    },
    async (app) => {
      await app.inject({ url: url(), headers: bearer });
      await app.inject({ url: url(`?after=2&attempt=${attempt}`), headers: bearer });
      await app.inject({ url: url('?after=2'), headers: bearer });
      await app.inject({ url: url(`?attempt=${attempt}`), headers: bearer });
      await app.inject({ url: url(`?after=0&attempt=${attempt}`), headers: bearer });
    },
  );
  const held = (index: number) => asked[index][3];
  assert.deepEqual(asked.map((args) => args.slice(0, 3)), Array(5).fill(['the-owner', documentId, generationId]));
  assert.equal(held(0), undefined);
  assert.deepEqual(held(1), { after: 2, attempt });
  assert.equal(held(2), undefined, 'a count without the attempt cannot say what is held');
  assert.equal(held(3), undefined, 'nor can an attempt without a count');
  assert.deepEqual(held(4), { after: 0, attempt });
});

test('a malformed request fails before reaching the service', async () => {
  let called = false;
  await withApp(
    {
      partial: async () => {
        called = true;
        return view;
      },
    },
    async (app) => {
      for (const query of ['?after=-1', '?after=abc', '?after=1234567', '?after=1.5', `?after=1&attempt=nope`, '?attempt=nope', '?extra=1', `?after=1&attempt=${attempt}&more=1`]) {
        const response = await app.inject({ url: url(query), headers: bearer });
        assert.equal(response.statusCode, 400, query);
        assert.equal(response.json().error.code, 'invalid_request');
      }
      for (const path of [`/api/documents/not-a-uuid/generations/${generationId}/partial`, `/api/documents/${documentId}/generations/not-a-uuid/partial`]) {
        assert.equal((await app.inject({ url: path, headers: bearer })).statusCode, 400, path);
      }
    },
  );
  assert.equal(called, false);
});

test('a generation that is not the owner\'s is not found, and the store\'s failures are masked', async () => {
  await withApp(
    {
      partial: async (owner) => {
        if (owner === 'the-owner') throw new HttpError(404, 'not_found', 'Document or element not found.');
        throw new Error('password=never_expose');
      },
    },
    async (app) => {
      const missing = await app.inject({ url: url(), headers: bearer });
      assert.equal(missing.statusCode, 404);
      assert.equal(missing.json().error.code, 'not_found');
    },
  );
  const app = await createApp({
    service: service({
      partial: async () => {
        throw new Error('password=never_expose');
      },
    }),
    authenticate: async () => 'the-owner',
  });
  try {
    const failure = await app.inject({ url: url(), headers: bearer });
    assert.equal(failure.statusCode, 500);
    assert.ok(!failure.body.includes('password'));
  } finally {
    await app.close();
  }
});

test('a server without partial tours says so, and the reader falls back to the finished tour', async () => {
  await withApp({}, async (app) => {
    const response = await app.inject({ url: url(), headers: bearer });
    assert.equal(response.statusCode, 503);
    assert.equal(response.json().error.code, 'partial_unavailable');
  });
});

// ------------------------------------------------------------------------- the reader's place in a growing tour

/** A service over a script of answers: the document is the owner's, a tour is never found. */
function positions(pageCount: number | null = 8) {
  const seen: string[] = [];
  const query = async (text: string) => {
    seen.push(text.replace(/\s+/g, ' ').trim());
    if (text.includes('from documents')) return { rows: [{ id: documentId, page_count: pageCount }], rowCount: 1 };
    if (text.includes('from tours')) return { rows: [], rowCount: 0 };
    return { rows: [], rowCount: 1 };
  };
  const db = { pool: { query }, query, transaction: async (run: (tx: unknown) => unknown) => run({ query }) } as unknown as Database;
  return { seen, service: new DocumentService(db, {} as FileStorage, async () => {}) };
}
const place = (over: Record<string, unknown> = {}) => ({ page: 2, pageOffset: 0.4, zoom: 1, tourId: null, stepId: null, ...over });

test('the reader can save the step it is on in a tour that is still being written', async () => {
  // A partial is never a tours row, so its steps have no tour id: this used to answer 400 on every step and the reader
  // showed "Reading position could not be saved" for as long as the first steps played.
  const { seen, service } = positions();
  await service.saveState('the-owner', documentId, place({ stepId: 's3' }));
  assert.ok(seen.some((text) => text.startsWith('insert into reader_states')), 'the place is kept');
  assert.ok(!seen.some((text) => text.includes('from tours')), 'there is no saved tour to look the step up in');
});

test('a step of a saved tour is still checked against that tour, and a page outside the PDF is refused', async () => {
  const { seen, service } = positions();
  await assert.rejects(
    () => service.saveState('the-owner', documentId, place({ tourId: attempt, stepId: 's3' })),
    (error) => error instanceof HttpError && error.status === 404,
    'a tour of another document or a deleted one',
  );
  assert.ok(seen.some((text) => text.includes('from tours')));
  assert.ok(!seen.some((text) => text.startsWith('insert into reader_states')));
  await assert.rejects(
    () => positions(8).service.saveState('the-owner', documentId, place({ page: 9 })),
    (error) => error instanceof HttpError && error.status === 400,
  );
});
