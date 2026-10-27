import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/db';
import { DocumentService, type Enqueue } from '../src/service';
import { AnalysisWorker, type PreparedAnalysis } from '../src/worker';
import { TourWorker } from '../src/tour-worker';
import { MetaModelCatalog } from '../src/muse/models';
import { HttpError } from '../src/errors';
import type { Config, MuseConfig } from '../src/config';
import type { FileStorage } from '../src/storage';
import type { TourGenerator, TourImage } from '../src/tour-generator';
import type { Doc, Tour } from '../../shared/paper';

const url = process.env.TEST_DATABASE_URL;
test('document model preferences, explicit training consent and bound generation jobs', { skip: !url }, async (t) => {
  const db = new Database(url!);
  const owner = randomUUID();
  const jobs: unknown[] = [];
  const enqueue: Enqueue = async (kind, data) => {
    jobs.push({ kind, ...data });
  };
  let downloads = 0,
    preparations = 0;
  const storage: FileStorage = {
    info: async () => ({ size: 8 }),
    download: async () => {
      downloads++;
      return Buffer.from('%PDF-1.7');
    },
    upload: async () => {},
    sign: async (p) => `https://storage.invalid/${p}`,
    remove: async () => {},
    list: async () => [],
  };
  const settings: MuseConfig = {
    apiKey: '',
    baseUrl: 'https://example.invalid/v1',
    model: 'muse-spark-1.3',
    language: 'en-US',
    timeoutMs: 1000,
  };
  const c = { muse: settings } as Config;
  const catalog = new MetaModelCatalog(settings);
  const service = new DocumentService(db, storage, enqueue, 26214400, settings.model, catalog);
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
    pages: [{ n: 1, width: 600, height: 800 }],
    sections: [],
    blocks: [],
    sentences: [],
    figures: [],
    equations: [],
  };
  const tour: Tour = {
    schema: 'paper-tour/tour@0.1',
    title: 'Test tour',
    paper: 'test',
    doc_sha256: doc.source.sha256,
    chapters: [
      {
        id: 'c1',
        title: 'Intro',
        steps: [{ id: 's1', say: 'Paper page.', actions: [{ type: 'focus', target: 'page1' }] }],
      },
    ],
  };
  const prepared: PreparedAnalysis = {
    doc,
    tour: null,
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
  };
  const fixture = async (model?: string, allowTraining?: boolean) => {
    const reservation = await service.reserve(owner, `${randomUUID()}.pdf`, 8, { model, allowTraining });
    const { analysisId } = await service.complete(owner, reservation.documentId);
    await db.transaction((tx) =>
      new AnalysisWorker(db, storage, c, enqueue).publish(tx, reservation.documentId, analysisId, prepared, []),
    );
    return { documentId: reservation.documentId, analysisId };
  };
  const generation = async (analysisId: string) =>
    (
      await db.query('select * from tour_generations where analysis_id=$1 order by created_at desc,id desc limit 1', [
        analysisId,
      ])
    ).rows[0];
  const calls: string[] = [];
  const bind = (model: string): TourGenerator => ({
    model,
    configured: true,
    withModel: bind,
    generate: async (input) => {
      calls.push(model);
      return {
        tour,
        metadata: {
          provider: 'test-double',
          model,
          analysisId: input.analysisId,
          sourceSha256: input.doc.source.sha256,
        },
      };
    },
  });
  const image: TourImage = {
    targetId: 'page1',
    kind: 'page',
    page: 1,
    label: 'Page 1',
    dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
  };
  const worker = new TourWorker(db, storage, c, bind(settings.model), async () => {
    preparations++;
    return [image];
  });
  const rejects = (code: string) => (error: unknown) => error instanceof HttpError && error.code === code;
  await db.query('insert into auth.users(id,email) values($1,$2)', [owner, `${owner}@example.test`]);
  try {
    await t.test(
      'catalog rejects incompatible, unknown, unavailable and unacknowledged Contributor selections',
      async () => {
        for (const model of ['muse-image-1.0', 'untrusted-model'])
          await assert.rejects(() => service.reserve(owner, 'paper.pdf', 8, { model }), rejects('unsupported_model'));
        await assert.rejects(
          () => service.reserve(owner, 'paper.pdf', 8, { model: 'muse-spark-1.3-contributor' }),
          rejects('contributor_training_consent_required'),
        );
        const limited = new MetaModelCatalog(
          { ...settings, apiKey: 'test' },
          async () => new Response(JSON.stringify({ data: [{ id: 'muse-spark-1.3' }] }), { status: 200 }),
        );
        const restricted = new DocumentService(db, storage, enqueue, 26214400, settings.model, limited);
        await assert.rejects(
          () => restricted.reserve(owner, 'paper.pdf', 8, { model: 'muse-wonder-1.0' }),
          rejects('model_not_available'),
        );
        assert.equal((await service.models()).availability, 'not_configured');
      },
    );
    const wonder = await fixture('muse-wonder-1.0');
    await t.test('upload preference persists and automatic jobs execute their saved model', async () => {
      const g = await generation(wonder.analysisId);
      assert.equal(g.model, 'muse-wonder-1.0');
      const m = await service.manifest(owner, wonder.documentId);
      assert.equal(m.document.tourModel, 'muse-wonder-1.0');
      assert.equal(m.document.tourAllowTraining, false);
      const before = jobs.length;
      await assert.rejects(
        () =>
          service.generateTour(owner, wonder.documentId, true, {
            model: 'muse-spark-1.3-contributor',
            allowTraining: true,
          }),
        rejects('generation_in_progress'),
      );
      assert.equal(jobs.length, before);
      assert.equal((await service.manifest(owner, wonder.documentId)).document.tourAllowTraining, false);
      assert.equal(
        (await service.generateTour(owner, wonder.documentId, false, { model: 'muse-wonder-1.0', allowTraining: true }))
          .generation.id,
        g.id,
      );
      assert.equal(
        (await service.manifest(owner, wonder.documentId)).document.tourAllowTraining,
        false,
        'idempotent active reads do not change consent',
      );
      await worker.generate(wonder.documentId, wonder.analysisId, g.id);
      assert.equal(calls.at(-1), 'muse-wonder-1.0');
      const ready = await service.manifest(owner, wonder.documentId);
      assert.equal(ready.selectedTour?.model, 'muse-wonder-1.0');
      await assert.rejects(
        () => service.generateTour(owner, wonder.documentId, false, { model: 'muse-spark-1.3' }),
        rejects('regeneration_required'),
      );
    });
    await t.test(
      'Contributor opt-in is explicit for each new generation and historical models stay accurate',
      async () => {
        await assert.rejects(
          () => service.generateTour(owner, wonder.documentId, true, { model: 'muse-spark-1.3-contributor' }),
          rejects('contributor_training_consent_required'),
        );
        const g = (
          await service.generateTour(owner, wonder.documentId, true, {
            model: 'muse-spark-1.3-contributor',
            allowTraining: true,
          })
        ).generation;
        assert.equal(g.model, 'muse-spark-1.3-contributor');
        await worker.generate(wonder.documentId, wonder.analysisId, g.id);
        assert.equal(calls.at(-1), 'muse-spark-1.3-contributor');
        const ready = await service.manifest(owner, wonder.documentId);
        assert.equal(ready.tours.length, 2);
        assert.equal(ready.selectedTour?.model, 'muse-spark-1.3-contributor');
        const before = jobs.length;
        assert.equal(
          (await service.generateTour(owner, wonder.documentId)).generation.id,
          g.id,
          'reading a ready result does not need new consent',
        );
        await assert.rejects(
          () => service.generateTour(owner, wonder.documentId, true),
          rejects('contributor_training_consent_required'),
        );
        assert.equal(jobs.length, before);
        const standard = (
          await service.generateTour(owner, wonder.documentId, true, { model: 'muse-spark-1.3', allowTraining: false })
        ).generation;
        assert.equal((await service.manifest(owner, wonder.documentId)).document.tourAllowTraining, false);
        await worker.generate(wonder.documentId, wonder.analysisId, standard.id);
        assert.equal(calls.at(-1), 'muse-spark-1.3');
        assert.equal(
          (await service.manifest(owner, wonder.documentId, ready.selectedTour!.id)).selectedTour?.model,
          'muse-spark-1.3-contributor',
        );
      },
    );
    await t.test('legacy or unconsented Contributor jobs cannot prepare images or call a model', async () => {
      const f = await fixture('muse-spark-1.3-contributor', true);
      const g = await generation(f.analysisId);
      await db.query('update documents set tour_allow_training=false where id=$1', [f.documentId]);
      const before = calls.length,
        imagesBefore = preparations;
      await worker.generate(f.documentId, f.analysisId, g.id);
      assert.equal(calls.length, before);
      assert.equal(preparations, imagesBefore);
      assert.equal(downloads, 0);
      assert.equal((await generation(f.analysisId)).error_code, 'contributor_training_consent_required');
      const retried = (
        await service.generateTour(owner, f.documentId, false, {
          model: 'muse-spark-1.3-contributor',
          allowTraining: true,
        })
      ).generation;
      assert.equal(retried.id, g.id);
      await worker.generate(f.documentId, f.analysisId, g.id);
      assert.equal((await generation(f.analysisId)).status, 'ready');
    });
    await t.test(
      'failed and configuration-blocked runs can change models safely; unbound generators never fall back',
      async () => {
        const f = await fixture();
        let g = await generation(f.analysisId);
        await db.query("update tour_generations set status='failed' where id=$1", [g.id]);
        g = (await service.generateTour(owner, f.documentId, false, { model: 'muse-wonder-1.0' })).generation;
        const withoutBinding = new TourWorker(
          db,
          storage,
          c,
          {
            model: settings.model,
            configured: true,
            generate: async () => {
              throw new Error('must not fall back');
            },
          },
          async () => [image],
        );
        await withoutBinding.generate(f.documentId, f.analysisId, g.id);
        assert.equal((await generation(f.analysisId)).error_code, 'unsupported_model');
        await db.query("update tour_generations set status='needs_configuration' where id=$1", [g.id]);
        const selected = (await service.generateTour(owner, f.documentId, false, { model: 'muse-spark-1.2' }))
          .generation;
        assert.equal(selected.id, g.id);
        assert.equal(selected.model, 'muse-spark-1.2');
        await worker.generate(f.documentId, f.analysisId, g.id);
        assert.equal(calls.at(-1), 'muse-spark-1.2');
      },
    );
  } finally {
    await db.query('delete from documents where owner_id=$1', [owner]);
    await db.query('delete from auth.users where id=$1', [owner]);
    await db.close();
  }
});
