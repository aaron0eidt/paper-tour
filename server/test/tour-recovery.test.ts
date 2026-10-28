import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/db';
import { createQueue, GENERATE_TOUR } from '../src/queue';
import { recoverInterruptedTours } from '../src/tour-recovery';

const url = process.env.TEST_DATABASE_URL;
test(
  'startup recovery fails only unlocked old legacy tours and cancels their active queue attempts',
  { skip: !url },
  async () => {
    const db = new Database(url!);
    const { boss } = await createQueue(url!);
    const owner = randomUUID();
    const jobIds: string[] = [];
    const cutoff = new Date('2000-01-01T00:00:00Z');
    const old = '1999-01-01T00:00:00Z';
    const recent = '2001-01-01T00:00:00Z';
    const fixture = async (status = 'generating', engine = 'legacy', updated = old) => {
      const document = randomUUID(),
        analysis = randomUUID(),
        generation = randomUUID();
      await db.query(
        'insert into documents(id,owner_id,title,original_filename,upload_path,upload_size) values($1,$2,$3,$3,$4,8)',
        [document, owner, 'Recovery test', `test/${document}.pdf`],
      );
      await db.query("insert into analyses(id,document_id,status,doc) values($1,$2,'ready','{}'::jsonb)", [
        analysis,
        document,
      ]);
      await db.query(
        'insert into tour_generations(id,document_id,analysis_id,status,model,engine,created_at,updated_at) values($1,$2,$3,$4,$5,$6,$7,$8)',
        [generation, document, analysis, status, 'recovery-test', engine, old, updated],
      );
      return { document, generation };
    };
    const activeJob = async (fixture: { document: string; generation: string }) =>
      db.transaction(async (tx) => {
        const id = await boss.send(
          GENERATE_TOUR,
          { documentId: fixture.document, generationId: fixture.generation },
          {
            db: { executeSql: (sql: string, values?: unknown[]) => tx.query(sql, values) },
          },
        );
        assert(id);
        // Commit already-active jobs so the development worker can never consume these fixtures.
        await tx.query("update pgboss.job set state='active',started_on=now() where id=$1 and name=$2", [
          id,
          GENERATE_TOUR,
        ]);
        jobIds.push(id);
        return id;
      });
    const held = await db.pool.connect();
    let liveDocument: string | undefined;
    try {
      await db.query('insert into auth.users(id,email) values($1,$2)', [owner, `${owner}@example.test`]);
      const orphan = await fixture();
      const live = await fixture();
      const ready = await fixture('ready');
      const agent = await fixture('generating', 'agent');
      const newAttempt = await fixture('generating', 'legacy', recent);
      const orphanJob = await activeJob(orphan);
      const liveJob = await activeJob(live);
      liveDocument = live.document;
      await held.query('select pg_advisory_lock(hashtextextended($1,0))', [live.document]);
      const recovered = await recoverInterruptedTours(db, boss, cutoff);
      assert(recovered.includes(orphan.generation));
      for (const fixture of [live, ready, agent, newAttempt]) assert(!recovered.includes(fixture.generation));
      const {
        rows: [failed],
      } = await db.query('select status,error_code from tour_generations where id=$1', [orphan.generation]);
      assert.deepEqual(failed, { status: 'failed', error_code: 'worker_interrupted' });
      const { rows: jobs } = await db.query('select id,state from pgboss.job where id=any($1::uuid[]) and name=$2', [
        [orphanJob, liveJob],
        GENERATE_TOUR,
      ]);
      assert.equal(jobs.find((job) => job.id === orphanJob)?.state, 'cancelled');
      assert.equal(jobs.find((job) => job.id === liveJob)?.state, 'active');
      for (const [fixture, status] of [
        [live, 'generating'],
        [ready, 'ready'],
        [agent, 'generating'],
        [newAttempt, 'generating'],
      ] as const) {
        assert.equal(
          (await db.query('select status from tour_generations where id=$1', [fixture.generation])).rows[0].status,
          status,
        );
      }
      const { rows: events } = await db.query(
        "select data from agent_events where generation_id=$1 and type='run.failed'",
        [orphan.generation],
      );
      assert.equal(events.length, 1);
      assert.equal(events[0].data.retrying, false);
      const again = await recoverInterruptedTours(db, boss, cutoff);
      assert(!again.includes(orphan.generation), 'Recovery is idempotent');
      assert.equal(
        (
          await db.query("select count(*)::int n from agent_events where generation_id=$1 and type='run.failed'", [
            orphan.generation,
          ])
        ).rows[0].n,
        1,
      );
    } finally {
      if (liveDocument) await held.query('select pg_advisory_unlock(hashtextextended($1,0))', [liveDocument]);
      held.release();
      if (jobIds.length)
        await db.query('delete from pgboss.job where id=any($1::uuid[]) and name=$2', [jobIds, GENERATE_TOUR]);
      await db.query('delete from documents where owner_id=$1', [owner]);
      await db.query('delete from auth.users where id=$1', [owner]);
      await boss.stop();
      await db.close();
    }
  },
);
