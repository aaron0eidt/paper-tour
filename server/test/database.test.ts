import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/db';
import { DocumentService, type Enqueue } from '../src/service';
import { HttpError } from '../src/errors';
import type { FileStorage } from '../src/storage';
import { AnalysisWorker, type PreparedAnalysis } from '../src/worker';
import type { Config } from '../src/config';
import type { Doc, Tour } from '../../shared/paper';

const url = process.env.TEST_DATABASE_URL;
const databaseTest = test(
  'PostgreSQL integration: ownership, RLS, atomic jobs, immutable versions and lifecycle',
  { skip: !url },
  async (t) => {
    const db = new Database(url!);
    const owner = randomUUID(),
      other = randomUUID();
    const queueName = `paper_test_${randomUUID().replaceAll('-', '')}`;
    const files = new Map<string, Buffer>();
    const storage: FileStorage = {
      info: async (path) => (files.has(path) ? { size: files.get(path)!.length } : null),
      download: async (path) => files.get(path)!,
      upload: async (path, data) => {
        files.set(path, data);
      },
      sign: async (path) => `https://storage.invalid/${path}`,
      remove: async (paths) => {
        paths.forEach((path) => files.delete(path));
      },
      list: async (prefix) => [...files.keys()].filter((path) => path.startsWith(prefix + '/')),
    };
    const enqueue: Enqueue = async (kind, data, tx) => {
      await (tx ?? db.pool).query(`insert into ${queueName}(kind,payload) values($1,$2)`, [kind, data]);
    };
    const service = new DocumentService(db, storage, enqueue);
    await db.query(`create table ${queueName}(kind text,payload jsonb)`);
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [
      owner,
      `${owner}@example.test`,
      other,
      `${other}@example.test`,
    ]);
    const doc: Doc = {
      schema: 'paper-tour/doc@0.1',
      source: {
        file: 'paper.pdf',
        sha256: 'a'.repeat(64),
        num_pages: 1,
        generator: 'test',
      },
      pages: [{ n: 1, width: 600, height: 800 }],
      sections: [
        {
          id: 'sec-method',
          title: 'Method',
          level: 1,
          page: 1,
          block: 'p1.b1',
        },
      ],
      blocks: [
        {
          id: 'p1.b1',
          page: 1,
          type: 'paragraph',
          bbox: [10, 10, 100, 40],
          text: 'Attention weights explain the figure.',
          sentences: ['p1.s1'],
        },
      ],
      sentences: [
        {
          id: 'p1.s1',
          page: 1,
          block: 'p1.b1',
          text: 'Attention weights explain the figure.',
          rects: [[10, 10, 100, 40]],
        },
      ],
      figures: [
        {
          id: 'fig1',
          kind: 'figure',
          number: '1',
          page: 1,
          bbox: [10, 50, 200, 200],
          caption: 'Attention matrix',
          caption_block: 'p1.b1',
          image: 'figures/fig1.png',
          panels: [],
          referenced_by: ['p1.s1'],
        },
      ],
      equations: [],
    };
    const tour: Tour = {
      schema: 'paper-tour/tour@0.1',
      title: 'Test tour',
      paper: 'test',
      doc_sha256: doc.source.sha256,
      chapters: [
        {
          id: 'start',
          title: 'Start',
          steps: [
            {
              id: 'hello',
              say: 'Attention weights.',
              actions: [{ type: 'highlight', targets: ['p1.s1'] }],
            },
          ],
        },
      ],
    };
    let id = '',
      analysisId = '';
    try {
      await t.test('reservation ownership and idempotent completion', async () => {
        const reservation = await service.reserve(owner, 'paper.pdf', 8);
        id = reservation.documentId;
        files.set(reservation.path, Buffer.from('%PDF-1.7'));
        analysisId = (await service.complete(owner, id)).analysisId;
        assert.equal((await service.complete(owner, id)).analysisId, analysisId);
        assert.equal((await db.query(`select count(*) from ${queueName}`)).rows[0].count, '1');
        for (const action of [
          () => service.manifest(other, id),
          () => service.complete(other, id),
          () => service.rename(other, id, 'stolen'),
          () => service.remove(other, id),
          () => service.elements(other, id, analysisId, ['p1.s1']),
        ])
          await assert.rejects(action, (e: unknown) => e instanceof HttpError && e.status === 404);
      });
      await t.test('job enqueue and analysis creation roll back together', async () => {
        const reservation = await service.reserve(owner, 'rollback.pdf', 8);
        files.set(reservation.path, Buffer.from('%PDF-1.7'));
        const broken = new DocumentService(db, storage, async () => {
          throw new Error('queue unavailable');
        });
        await assert.rejects(() => broken.complete(owner, reservation.documentId));
        assert.equal(
          (await db.query('select count(*) from analyses where document_id=$1', [reservation.documentId])).rows[0]
            .count,
          '0',
        );
        assert.equal(
          (await db.query('select file_status from documents where id=$1', [reservation.documentId])).rows[0]
            .file_status,
          'uploading',
        );
      });
      await t.test('publication creates searchable index and pinned tour', async () => {
        const worker = new AnalysisWorker(db, storage, {} as Config);
        const prepared: PreparedAnalysis = {
          doc,
          tour,
          sha: doc.source.sha256,
          folder: '',
          result: {
            parser_version: 'test1',
            sha256: doc.source.sha256,
            page_count: 1,
            title: 'Test',
            status: 'ready',
            warnings: [],
            assets: [],
          },
        };
        await db.transaction((tx) =>
          worker.publish(tx, id, analysisId, prepared, [
            {
              kind: 'figure',
              logicalPath: 'figures/fig1.png',
              storagePath: `${owner}/${id}/${analysisId}/figures/fig1.png`,
              contentType: 'image/png',
            },
          ]),
        );
        const manifest = await service.manifest(owner, id);
        assert.equal(manifest.docAnalysisId, analysisId);
        assert.equal(manifest.selectedTour?.analysisId, analysisId);
        assert.equal((await service.search(owner, id, analysisId, 'attention')).length, 2);
        const figure = await service.figure(owner, id, analysisId, 'fig1');
        assert.equal(figure.references[0].id, 'p1.s1');
        assert.equal(figure.caption?.id, 'p1.b1');
        assert.ok(figure.imageUrl);
        const a2 = (await service.analyze(owner, id)).analysisId;
        await db.query("update analyses set status='failed',error='test failure' where id=$1", [a2]);
        const after = await service.manifest(owner, id);
        assert.equal(after.analysis?.status, 'failed');
        assert.equal(after.docAnalysisId, analysisId);
        assert.equal(after.selectedTour?.analysisId, analysisId);
      });
      await t.test('RLS hides foreign rows and rejects unreserved storage inserts', async () => {
        await db.transaction(async (tx) => {
          await tx.query('set local role authenticated');
          await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
          assert.equal((await tx.query('select id from documents where id=$1', [id])).rows.length, 0);
          assert.equal((await tx.query('select id from analyses where document_id=$1', [id])).rows.length, 0);
          assert.equal(
            (await tx.query('select element_id from elements where analysis_id=$1', [analysisId])).rows.length,
            0,
          );
          assert.equal((await tx.query('select id from tours where document_id=$1', [id])).rows.length, 0);
        });
        await assert.rejects(() =>
          db.transaction(async (tx) => {
            await tx.query('set local role authenticated');
            await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
            await tx.query(
              "insert into documents(owner_id,title,original_filename,upload_path,upload_size) values($1,'x','x','x',1)",
              [other],
            );
          }),
        );
      });
      await t.test('storage policies allow only the reserved immutable original', async () => {
        const reservation = await service.reserve(owner, 'storage.pdf', 8);
        const asOwner = async (sql: string, values: unknown[]) =>
          db.transaction(async (tx) => {
            await tx.query('set local role authenticated');
            await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
            return tx.query(sql, values);
          });
        // Roll back the allowed insert so this test never creates a fake stored object.
        const rollback = Symbol('rollback');
        await assert.rejects(
          () =>
            db.transaction(async (tx) => {
              await tx.query('set local role authenticated');
              await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [owner]);
              await tx.query("insert into storage.objects(bucket_id,name) values('paper-files',$1)", [
                reservation.path,
              ]);
              const update = await tx.query(
                "update storage.objects set metadata='{}'::jsonb where bucket_id='paper-files' and name=$1",
                [reservation.path],
              );
              assert.equal(update.rowCount, 0, 'browser must not overwrite originals');
              throw rollback;
            }),
          (error) => error === rollback,
        );
        await assert.rejects(() =>
          asOwner("insert into storage.objects(bucket_id,name) values('paper-files',$1)", [
            `${owner}/${reservation.documentId}/figures/forged.png`,
          ]),
        );
        await assert.rejects(() =>
          db.transaction(async (tx) => {
            await tx.query('set local role authenticated');
            await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
            await tx.query("insert into storage.objects(bucket_id,name) values('paper-files',$1)", [reservation.path]);
          }),
        );
      });
      await t.test('reader positions are document-scoped; deletion hides immediately and removes files', async () => {
        const manifest = await service.manifest(owner, id);
        await service.saveState(owner, id, {
          page: 1,
          pageOffset: 0.3,
          zoom: 1,
          tourId: manifest.selectedTour!.id,
          stepId: 'hello',
        });
        assert.equal((await service.manifest(owner, id)).readerState?.stepId, 'hello');
        // A step of a saved tour must exist in it.
        await assert.rejects(
          () =>
            service.saveState(owner, id, {
              page: 1,
              pageOffset: 0,
              zoom: 1,
              tourId: manifest.selectedTour!.id,
              stepId: 'no-such-step',
            }),
          (error) => error instanceof HttpError && error.status === 400,
        );
        // The place in a tour still being written has no tour yet: the reader saves its step with no tour id.
        await service.saveState(owner, id, { page: 1, pageOffset: 0.2, zoom: 1, tourId: null, stepId: 'hello' });
        assert.deepEqual(
          [(await service.manifest(owner, id)).readerState?.tourId, (await service.manifest(owner, id)).readerState?.stepId],
          [null, 'hello'],
        );
        await service.remove(owner, id);
        await assert.rejects(() => service.manifest(owner, id));
        await new AnalysisWorker(db, storage, {} as Config).remove(id);
        assert.equal((await db.query('select 1 from documents where id=$1', [id])).rows.length, 0);
        assert.equal((await db.query('select 1 from elements where analysis_id=$1', [analysisId])).rows.length, 0);
        assert.equal([...files.keys()].filter((path) => path.startsWith(`${owner}/${id}/`)).length, 0);
      });
    } finally {
      // Assets are in-memory for this test; the E2E smoke test covers actual Supabase Storage.
      await db.query('delete from documents where owner_id=any($1::uuid[])', [[owner, other]]);
      await db.query('delete from auth.users where id=any($1::uuid[])', [[owner, other]]);
      await db.query(`drop table ${queueName}`);
      await db.close();
    }
  },
);
void databaseTest;
