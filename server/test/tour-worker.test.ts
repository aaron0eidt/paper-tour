import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/db';
import { DocumentService, type Enqueue } from '../src/service';
import { AnalysisWorker, type PreparedAnalysis } from '../src/worker';
import { TourWorker, imagePreparationFailure, isMissingStorageObject, safeTourDiagnostics } from '../src/tour-worker';
import { savePartial } from '../src/tour-partial';
import { ProcessingError, HttpError } from '../src/errors';
import type { Config } from '../src/config';
import type { FileStorage } from '../src/storage';
import type { TourGenerator, TourImage } from '../src/tour-generator';
import type { Doc, Tour } from '../../shared/paper';

const url = process.env.TEST_DATABASE_URL;
test(
  'durable tour lifecycle uses pinned analyses and never publishes partial or duplicate tours',
  { skip: !url },
  async (t) => {
    const db = new Database(url!);
    const owner = randomUUID(),
      other = randomUUID();
    const jobs: { kind: string; documentId: string; analysisId?: string; generationId?: string }[] = [];
    const enqueue: Enqueue = async (kind, data) => {
      jobs.push({ kind, ...data });
    };
    let downloads = 0;
    const storage: FileStorage = {
      info: async () => ({ size: 8 }),
      download: async () => {
        downloads++;
        return Buffer.from('%PDF-1.7');
      },
      upload: async () => {},
      sign: async (path) => `https://storage.invalid/${path}`,
      remove: async () => {},
      list: async () => [],
    };
    const service = new DocumentService(db, storage, enqueue, 26214400, 'test-model');
    const c = {
      muse: {
        apiKey: 'test-only-injected',
        baseUrl: 'https://never-called.invalid',
        model: 'test-model',
        language: 'en-US',
        timeoutMs: 1000,
      },
    } as Config;
    const doc: Doc = {
      schema: 'paper-tour/doc@0.1',
      source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
      pages: [{ n: 1, width: 600, height: 800 }],
      sections: [],
      blocks: [
        {
          id: 'p1.b1',
          page: 1,
          type: 'paragraph',
          bbox: [10, 10, 100, 40],
          text: 'Attention weights.',
          sentences: ['p1.s1'],
        },
      ],
      sentences: [{ id: 'p1.s1', page: 1, block: 'p1.b1', text: 'Attention weights.', rects: [[10, 10, 100, 40]] }],
      figures: [],
      equations: [],
    };
    const tour: Tour = {
      schema: 'paper-tour/tour@0.1',
      title: 'Generated test tour',
      paper: 'test',
      doc_sha256: doc.source.sha256,
      chapters: [
        {
          id: 'start',
          title: 'Start',
          steps: [{ id: 'hello', say: 'Attention weights.', actions: [{ type: 'highlight', targets: ['p1.s1'] }] }],
        },
      ],
    };
    const prepared = (manual = false): PreparedAnalysis => ({
      doc,
      tour: manual ? tour : null,
      sha: doc.source.sha256,
      folder: '',
      result: {
        parser_version: 'test',
        sha256: doc.source.sha256,
        page_count: 1,
        title: 'Test',
        status: 'ready',
        warnings: [],
        assets: [],
      },
    });
    const image: TourImage = {
      targetId: 'page1',
      kind: 'page',
      page: 1,
      label: 'Page 1',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    };
    const fixture = async (manual = false) => {
      const reservation = await service.reserve(owner, `${randomUUID()}.pdf`, 8);
      const { analysisId } = await service.complete(owner, reservation.documentId);
      await db.transaction((tx) =>
        new AnalysisWorker(db, storage, c, enqueue).publish(
          tx,
          reservation.documentId,
          analysisId,
          prepared(manual),
          [],
        ),
      );
      return { documentId: reservation.documentId, analysisId };
    };
    const generation = async (analysisId: string) =>
      (
        await db.query('select * from tour_generations where analysis_id=$1 order by created_at desc,id desc limit 1', [
          analysisId,
        ])
      ).rows[0];
    let calls = 0;
    const generator: TourGenerator = {
      configured: true,
      model: 'test-model',
      async generate(input, onProgress) {
        calls++;
        assert.equal(input.images.length, 1);
        assert.equal(input.doc.source.sha256, doc.source.sha256);
        await onProgress?.({ stage: 'images', imagesDone: 1, imagesTotal: 1 });
        await onProgress?.({ stage: 'writing', imagesDone: 1, imagesTotal: 1 });
        return {
          tour,
          metadata: {
            provider: 'test-double',
            model: 'test-model',
            sourceSha256: input.doc.source.sha256,
            analysisId: input.analysisId,
            fullPaperContext: true,
            imagesReviewed: { count: 1, targets: ['page1'] },
          },
        };
      },
    };
    const worker = new TourWorker(db, storage, c, generator, async () => [image]);
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [
      owner,
      `${owner}@example.test`,
      other,
      `${other}@example.test`,
    ]);
    try {
      const f = await fixture();
      const g = await generation(f.analysisId);
      await t.test(
        'analysis publication creates exactly one automatic task; requests and startup are idempotent',
        async () => {
          assert.equal(g.status, 'queued');
          assert.equal(jobs.filter((j) => j.kind === 'generate_tour' && j.analysisId === f.analysisId).length, 1);
          const requested = await Promise.all([
            service.generateTour(owner, f.documentId),
            service.generateTour(owner, f.documentId),
          ]);
          assert.equal(requested[0].generation.id, g.id);
          assert.equal(requested[1].generation.id, g.id);
          await worker.reconcile(enqueue, f.documentId);
          assert.equal(jobs.filter((j) => j.kind === 'generate_tour' && j.analysisId === f.analysisId).length, 1);
          await assert.rejects(
            () => service.generateTour(other, f.documentId),
            (error) => error instanceof HttpError && error.status === 404,
          );
          assert.equal((await service.manifest(owner, f.documentId)).tourGeneration?.id, g.id);
        },
      );
      await t.test('missing configuration performs no image preparation, download or model call', async () => {
        let preparedImages = 0;
        const unconfigured = new TourWorker(
          db,
          storage,
          c,
          {
            configured: false,
            model: 'test-model',
            generate: async () => {
              throw new Error('must not call');
            },
          },
          async () => {
            preparedImages++;
            return [image];
          },
        );
        await unconfigured.generate(f.documentId, f.analysisId, g.id);
        assert.equal((await generation(f.analysisId)).status, 'needs_configuration');
        assert.equal(preparedImages, 0);
        assert.equal(downloads, 0);
        assert.equal(calls, 0);
        await worker.reconcile(enqueue, f.documentId);
        assert.equal((await generation(f.analysisId)).status, 'queued');
      });
      await t.test('duplicate worker deliveries publish exactly once with provenance and pinning', async () => {
        await Promise.all([
          worker.generate(f.documentId, f.analysisId, g.id),
          worker.generate(f.documentId, f.analysisId, g.id),
        ]);
        assert.equal(calls, 1);
        const completed = await generation(f.analysisId);
        assert.equal(completed.status, 'ready');
        assert.equal(completed.images_done, 1);
        assert.equal(completed.metadata.provider, 'test-double');
        const m = await service.manifest(owner, f.documentId);
        assert.equal(m.selectedTour?.analysisId, f.analysisId);
        assert.equal(m.tourGeneration?.tourId, m.selectedTour?.id);
        await service.generateTour(owner, f.documentId);
        await worker.reconcile(enqueue, f.documentId);
        assert.equal((await db.query('select count(*) from tours where generation_id=$1', [g.id])).rows[0].count, '1');
        const { analysisId: next } = await service.analyze(owner, f.documentId);
        await db.transaction((tx) =>
          new AnalysisWorker(db, storage, c, enqueue).publish(tx, f.documentId, next, prepared(), []),
        );
        const after = await service.manifest(owner, f.documentId);
        assert.equal(after.tourGeneration?.analysisId, next);
        assert.equal(after.selectedTour?.analysisId, f.analysisId);
      });
      await t.test(
        'explicit regeneration preserves previous tours and latest selection while active requests stay idempotent',
        async () => {
          const fresh = await fixture();
          const first = await generation(fresh.analysisId);
          await worker.generate(fresh.documentId, fresh.analysisId, first.id);
          const original = (await service.manifest(owner, fresh.documentId)).selectedTour!;
          await service.saveState(owner, fresh.documentId, {
            page: 1,
            pageOffset: 0,
            zoom: 1,
            tourId: original.id,
            stepId: 'hello',
          });
          assert.equal((await service.generateTour(owner, fresh.documentId)).generation.id, first.id);
          const next = (await service.generateTour(owner, fresh.documentId, true)).generation;
          assert.notEqual(next.id, first.id);
          const requests = await Promise.all([
            service.generateTour(owner, fresh.documentId, true),
            service.generateTour(owner, fresh.documentId),
          ]);
          assert(requests.every((result) => result.generation.id === next.id));
          assert.equal((await service.manifest(owner, fresh.documentId)).selectedTour?.id, original.id);
          await worker.generate(fresh.documentId, fresh.analysisId, next.id);
          const latest = await service.manifest(owner, fresh.documentId);
          assert.equal(latest.tours.length, 2);
          assert.notEqual(latest.selectedTour?.id, original.id);
          assert.equal(latest.selectedTour?.id, latest.tourGeneration?.tourId);
          assert.equal((await service.manifest(owner, fresh.documentId, original.id)).selectedTour?.id, original.id);
          assert.equal((await service.generateTour(owner, fresh.documentId)).generation.id, next.id);
          const configRetry = (await service.generateTour(owner, fresh.documentId, true)).generation;
          const unconfigured = new TourWorker(db, storage, c, { ...generator, configured: false }, async () => [image]);
          await unconfigured.generate(fresh.documentId, fresh.analysisId, configRetry.id);
          await worker.reconcile(enqueue, fresh.documentId);
          assert.equal(
            (await generation(fresh.analysisId)).status,
            'queued',
            'configuration-blocked regeneration resumes even when older tours exist',
          );
          assert.equal(
            (await db.query('select count(*) from tour_generations where analysis_id=$1', [fresh.analysisId])).rows[0]
              .count,
            '3',
          );
          assert.equal(
            (await service.list(owner)).find((d) => d.id === fresh.documentId)?.tourGeneration?.id,
            configRetry.id,
          );
        },
      );
      await t.test(
        'invalid output fails cleanly, retry reuses the task, and transient exhaustion becomes failed',
        async () => {
          const fresh = await fixture();
          const task = await generation(fresh.analysisId);
          const bad = new TourWorker(
            db,
            storage,
            c,
            { ...generator, generate: async () => ({ tour: { ...tour, doc_sha256: 'b'.repeat(64) }, metadata: {} }) },
            async () => [image],
          );
          await bad.generate(fresh.documentId, fresh.analysisId, task.id);
          assert.equal((await generation(fresh.analysisId)).status, 'failed');
          const callsBeforeReplay = calls;
          await worker.generate(fresh.documentId, fresh.analysisId, task.id);
          assert.equal(calls, callsBeforeReplay, 'failed queue redelivery must not call the generator');
          assert.equal((await generation(fresh.analysisId)).status, 'failed');
          assert.equal(
            (await db.query('select count(*) from tours where document_id=$1', [fresh.documentId])).rows[0].count,
            '0',
          );
          await worker.reconcile(enqueue, fresh.documentId);
          assert.equal(
            (await generation(fresh.analysisId)).status,
            'failed',
            'restart must not silently retry failed model runs',
          );
          assert.equal((await service.generateTour(owner, fresh.documentId)).generation.id, task.id);
          const flaky = new TourWorker(
            db,
            storage,
            c,
            {
              ...generator,
              generate: async () => {
                throw new ProcessingError('muse_rate_limited', 'do not log credentials', true);
              },
            },
            async () => [image],
          );
          await assert.rejects(
            () => flaky.generate(fresh.documentId, fresh.analysisId, task.id, false),
            (error) => error instanceof ProcessingError && error.transient,
          );
          assert.equal((await generation(fresh.analysisId)).status, 'queued');
          await flaky.generate(fresh.documentId, fresh.analysisId, task.id, true);
          assert.equal((await generation(fresh.analysisId)).status, 'failed');
        },
      );
      await t.test('a model authentication error requests configuration and preserves the PDF', async () => {
        const fresh = await fixture();
        const task = await generation(fresh.analysisId);
        const unauthenticated = new TourWorker(
          db,
          storage,
          c,
          {
            ...generator,
            generate: async () => {
              throw new ProcessingError('muse_auth_failed', 'bad key');
            },
          },
          async () => [image],
        );
        await unauthenticated.generate(fresh.documentId, fresh.analysisId, task.id);
        const m = await service.manifest(owner, fresh.documentId);
        assert.equal(m.tourGeneration?.status, 'needs_configuration');
        assert.ok(m.pdfUrl);
        assert.ok(m.doc);
      });
      await t.test('manual imported tours are preserved and not automatically regenerated', async () => {
        const manual = await fixture(true);
        await worker.reconcile(enqueue, manual.documentId);
        assert.equal(await generation(manual.analysisId), undefined);
        assert.equal((await service.manifest(owner, manual.documentId)).tours.length, 1);
      });
      await t.test('deleting during generation prevents publication and cascades lifecycle data', async () => {
        const fresh = await fixture();
        const task = await generation(fresh.analysisId);
        const deleting = new TourWorker(
          db,
          storage,
          c,
          {
            ...generator,
            generate: async () => {
              await service.remove(owner, fresh.documentId);
              return { tour, metadata: {} };
            },
          },
          async () => [image],
        );
        await deleting.generate(fresh.documentId, fresh.analysisId, task.id);
        assert.equal(
          (await db.query('select count(*) from tours where document_id=$1', [fresh.documentId])).rows[0].count,
          '0',
        );
        await new AnalysisWorker(db, storage, c, enqueue).remove(fresh.documentId);
        assert.equal(await generation(fresh.analysisId), undefined);
      });
      await t.test('aborted jobs cannot publish a late result', async () => {
        const fresh = await fixture();
        const task = await generation(fresh.analysisId);
        const abort = new AbortController();
        abort.abort();
        await worker.generate(fresh.documentId, fresh.analysisId, task.id, true, abort.signal);
        assert.equal((await generation(fresh.analysisId)).status, 'failed');
        assert.equal(
          (await db.query('select count(*) from tours where document_id=$1', [fresh.documentId])).rows[0].count,
          '0',
        );
      });
      await t.test('profile jobs can outlast a provider request budget while legacy jobs and cancellation keep their bounds', async () => {
        const short = { ...c, muse: { ...c.muse, timeoutMs: 5 } };
        const slow = { ...generator, generate: async () => { await new Promise((resolve) => setTimeout(resolve, 35)); return { tour, metadata: {} }; } };
        const patient = new TourWorker(db, storage, short, slow, async () => [image]);
        const adaptive = await fixture();
        const adaptiveTask = await generation(adaptive.analysisId);
        assert(adaptiveTask.profile);
        await patient.generate(adaptive.documentId, adaptive.analysisId, adaptiveTask.id);
        assert.equal((await generation(adaptive.analysisId)).status, 'ready');
        const legacy = await fixture();
        const legacyTask = await generation(legacy.analysisId);
        await db.query('update tour_generations set profile=null where id=$1', [legacyTask.id]);
        await patient.generate(legacy.documentId, legacy.analysisId, legacyTask.id);
        assert.equal((await generation(legacy.analysisId)).status, 'failed');
        const cancelled = await fixture();
        const cancelledTask = await generation(cancelled.analysisId);
        const stop = new AbortController();
        const timer = setTimeout(() => stop.abort(), 10);
        try { await patient.generate(cancelled.documentId, cancelled.analysisId, cancelledTask.id, true, stop.signal); }
        finally { clearTimeout(timer); }
        assert.equal((await generation(cancelled.analysisId)).status, 'failed');
        assert.equal((await db.query('select id from tours where generation_id=$1', [cancelledTask.id])).rowCount, 0);
      });
      await t.test(
        'progressive tours: partials are kept for the running generation, never regress, and end with the finished tour',
        async () => {
          const fresh = await fixture();
          const task = await generation(fresh.analysisId);
          // A playable tour of the first n steps, as the generator emits it.
          const leading = (n: number, sha = doc.source.sha256): Tour => ({
            ...tour,
            doc_sha256: sha,
            chapters: [
              {
                id: 'start',
                title: 'Start',
                steps: Array.from({ length: n }, (_, i) => ({
                  id: `s${i + 1}`,
                  say: 'Attention weights.',
                  actions: [{ type: 'highlight' as const, targets: ['p1.s1'] }],
                })),
              },
            ],
          });
          const rows = async () =>
            (
              await db.query('select attempt,ready,planned,tour from tour_generation_partials where generation_id=$1', [
                task.id,
              ])
            ).rows;
          const seen: { ready: number; planned: number; steps: number | null; status: string }[] = [];
          const viewed = async (held?: { after: number; attempt: string }) => {
            const view = await service.partial(owner, fresh.documentId, task.id, held);
            return { view, steps: view.tour?.chapters.flatMap((c) => c.steps).length ?? null };
          };
          const writer = new TourWorker(
            db,
            storage,
            c,
            {
              ...generator,
              async generate(input) {
                const emit = (n: number, extra: Record<string, unknown> = {}) =>
                  input.onEvent!('tour.partial', { tour: leading(n), ready: n, planned: 3, ...extra });
                assert.equal((await rows()).length, 0, 'an attempt starts without a partial');
                assert.deepEqual(
                  await viewed().then(({ view }) => [view.status, view.ready, view.tour, view.attempt]),
                  ['generating', 0, null, null],
                );
                await emit(1);
                const first = await viewed();
                seen.push({
                  ready: first.view.ready,
                  planned: first.view.planned,
                  steps: first.steps,
                  status: first.view.status,
                });
                await emit(2);
                const second = await viewed();
                seen.push({
                  ready: second.view.ready,
                  planned: second.view.planned,
                  steps: second.steps,
                  status: second.view.status,
                });
                assert.equal(second.view.attempt, first.view.attempt, 'steps append within one attempt');
                // Late, repeated, foreign and malformed partials change nothing.
                await emit(1);
                await emit(2);
                await input.onEvent!('tour.partial', { tour: leading(3, 'b'.repeat(64)), ready: 3, planned: 3 });
                await input.onEvent!('tour.partial', { tour: { title: 'half' }, ready: 3, planned: 3 });
                await input.onEvent!('tour.partial', { tour: leading(3), ready: 0, planned: 3 });
                const stored = await rows();
                assert.equal(stored.length, 1);
                assert.equal(stored[0].ready, 2);
                assert.equal(stored[0].tour.chapters[0].steps.length, 2);
                // A client that holds this partial gets the counts only; another attempt or an older one gets the tour.
                const held = await viewed({ after: 2, attempt: second.view.attempt! });
                assert.equal(held.view.tour, null);
                assert.equal(held.view.ready, 2);
                assert.equal((await viewed({ after: 1, attempt: second.view.attempt! })).steps, 2);
                assert.equal((await viewed({ after: 2, attempt: randomUUID() })).steps, 2);
                await emit(3, { planned: 2 });
                const third = await viewed();
                assert.deepEqual(
                  [third.view.ready, third.view.planned, third.steps],
                  [3, 3, 3],
                  'planned is raised to ready',
                );
                return generator.generate(input);
              },
            },
            async () => [image],
          );
          await writer.generate(fresh.documentId, fresh.analysisId, task.id);
          assert.deepEqual(seen, [
            { ready: 1, planned: 3, steps: 1, status: 'generating' },
            { ready: 2, planned: 3, steps: 2, status: 'generating' },
          ]);
          // The finished tour replaces the partial: nothing of it is left or served, and it is the tour of record.
          assert.equal((await generation(fresh.analysisId)).status, 'ready');
          assert.equal((await rows()).length, 0);
          const done = await service.partial(owner, fresh.documentId, task.id);
          assert.deepEqual(
            [done.status, done.ready, done.planned, done.tour, done.attempt],
            ['ready', 0, 0, null, null],
          );
          const manifest = await service.manifest(owner, fresh.documentId);
          assert.equal(done.tourId, manifest.selectedTour?.id);
          assert.equal(manifest.selectedTour?.tour.chapters[0].steps.length, 1, 'the finished tour is the generator’s');
          assert.equal(
            (await db.query('select count(*) from tours where document_id=$1', [fresh.documentId])).rows[0].count,
            '1',
            'a partial is never a tours row',
          );
          // A late write cannot bring a partial back to a finished generation.
          assert.equal(await savePartial(db.pool, task.id, { tour: leading(2), ready: 2, planned: 3 }), false);
          assert.equal((await rows()).length, 0);
          // The journal says how far the tour was, never what it said.
          const journal = (await service.activity(owner, fresh.documentId, task.id, '0')).events.filter(
            (event) => event.type === 'tour.partial',
          );
          assert.deepEqual(
            journal.map((event) => event.data),
            [
              { ready: 1, planned: 3 },
              { ready: 2, planned: 3 },
              { ready: 3, planned: 3 },
            ],
          );
          // Only the owner, and only through the document the generation belongs to.
          await assert.rejects(
            () => service.partial(other, fresh.documentId, task.id),
            (error) => error instanceof HttpError && error.status === 404,
          );
          await assert.rejects(
            () => service.partial(owner, fresh.documentId, randomUUID()),
            (error) => error instanceof HttpError && error.status === 404,
          );
          const another = await fixture();
          await assert.rejects(
            () => service.partial(owner, another.documentId, task.id),
            (error) => error instanceof HttpError && error.status === 404,
          );
          await db.transaction(async (tx) => {
            await tx.query('set local role authenticated');
            await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
            await assert.rejects(() => tx.query('select * from tour_generation_partials'), /permission denied/);
          });
        },
      );
      await t.test(
        'progressive tours: a failed attempt serves nothing and the retry starts a new partial',
        async () => {
          const fresh = await fixture();
          const task = await generation(fresh.analysisId);
          const partialTour: Tour = { ...tour };
          const attempts: string[] = [];
          let attempt = 0;
          const flaky = new TourWorker(
            db,
            storage,
            c,
            {
              ...generator,
              async generate(input) {
                await input.onEvent!('tour.partial', { tour: partialTour, ready: 1, planned: 4 });
                const {
                  rows: [stored],
                } = await db.query('select attempt from tour_generation_partials where generation_id=$1', [task.id]);
                attempts.push(stored.attempt);
                if (!attempt++) throw new ProcessingError('muse_rate_limited', 'try again', true);
                return generator.generate(input);
              },
            },
            async () => [image],
          );
          await assert.rejects(() => flaky.generate(fresh.documentId, fresh.analysisId, task.id, false));
          assert.equal((await generation(fresh.analysisId)).status, 'queued');
          const waiting = await service.partial(owner, fresh.documentId, task.id);
          assert.deepEqual([waiting.status, waiting.tour, waiting.ready, waiting.attempt], ['queued', null, 0, null]);
          await flaky.generate(fresh.documentId, fresh.analysisId, task.id, true);
          assert.equal(attempts.length, 2);
          assert.notEqual(attempts[0], attempts[1], 'a retry is a new attempt');
          assert.equal((await generation(fresh.analysisId)).status, 'ready');
          assert.equal(
            (await db.query('select count(*) from tour_generation_partials where generation_id=$1', [task.id])).rows[0]
              .count,
            '0',
          );
        },
      );
      await t.test('progressive tours: partials written at the same time leave the longest one', async () => {
        const fresh = await fixture();
        const task = await generation(fresh.analysisId);
        const concurrent = new TourWorker(
          db,
          storage,
          c,
          {
            ...generator,
            async generate(input) {
              await Promise.all(
                [2, 1, 3, 1, 2].map((n) =>
                  input.onEvent!('tour.partial', {
                    tour: {
                      ...tour,
                      chapters: [
                        {
                          id: 'c',
                          title: 'C',
                          steps: Array.from({ length: n }, (_, i) => ({ ...tour.chapters[0].steps[0], id: `s${i}` })),
                        },
                      ],
                    },
                    ready: n,
                    planned: 3,
                  }),
                ),
              );
              const stored = (await service.partial(owner, fresh.documentId, task.id)).tour!;
              assert.equal(stored.chapters[0].steps.length, 3);
              return generator.generate(input);
            },
          },
          async () => [image],
        );
        await concurrent.generate(fresh.documentId, fresh.analysisId, task.id);
        assert.equal((await generation(fresh.analysisId)).status, 'ready');
      });
      await t.test("generation RLS hides another owner's progress and provenance", async () => {
        await db.transaction(async (tx) => {
          await tx.query('set local role authenticated');
          await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
          assert.equal(
            (await tx.query('select * from tour_generations where document_id=$1', [f.documentId])).rows.length,
            0,
          );
        });
      });
    } finally {
      await db.query('delete from documents where owner_id=any($1::uuid[])', [[owner, other]]);
      await db.query('delete from auth.users where id=any($1::uuid[])', [[owner, other]]);
      await db.close();
    }
  },
);

test('image preparation errors are whitelisted and missing storage crops are distinguishable', () => {
  const limited = imagePreparationFailure({
    stderr: 'warning\n' + JSON.stringify({ code: 'resource_limit', message: 'secret path must not leak' }),
  });
  assert.equal(limited.code, 'context_limit');
  assert.equal(limited.transient, false);
  assert(!limited.message.includes('secret'));
  const invalid = imagePreparationFailure({
    stderr: JSON.stringify({ code: 'invalid_pdf', message: 'secret details' }),
  });
  assert.equal(invalid.transient, false);
  assert(!invalid.message.includes('secret'));
  assert.equal(imagePreparationFailure({ stderr: 'native process failure' }).transient, true);
  assert.equal(isMissingStorageObject({ statusCode: '404', status: 400 }), true);
  assert.equal(isMissingStorageObject({ status: 404 }), true);
  assert.equal(isMissingStorageObject({ status: 503 }), false);
  assert.equal(isMissingStorageObject(new Error('Object not found')), false);
});

test('validation diagnostics are bounded and never log arbitrary provider error bodies', () => {
  const error = Object.assign(new ProcessingError('invalid_tour', 'safe'), {
    problems: [
      'Missing page 2',
      'Bearer secret-value data:image/png;base64,AAA\n' + 'x'.repeat(1000),
      ...Array(20).fill('extra'),
      'test-secret',
    ],
    responseBody: 'sensitive',
  });
  const diagnostics = safeTourDiagnostics(error, 'secret-value')!;
  assert.equal(diagnostics.length, 8);
  assert(diagnostics.every((item) => item.length <= 240));
  assert(!JSON.stringify(diagnostics).includes('secret-value'));
  assert(!JSON.stringify(diagnostics).includes('data:image'));
  assert.equal(safeTourDiagnostics({ problems: ['provider echo'], responseBody: 'sensitive' }), undefined);
});
