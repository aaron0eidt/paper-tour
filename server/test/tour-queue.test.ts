import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/db';
import { createQueue, GENERATE_TOUR, TOUR_JOB_POLICY } from '../src/queue';

const url = process.env.TEST_DATABASE_URL;
test('tour queue uses the supported24h technical expiry, live heartbeats and fenced cancellation', { skip: !url }, async () => {
  const db = new Database(url!);
  const { boss } = await createQueue(url!);
  const name = `test-tour-heartbeat-${randomUUID()}`;
  let release = () => {};
  let started!: (job: { id: string; retryCount: number; signal: AbortSignal }) => void;
  const began = new Promise<{ id: string; retryCount: number; signal: AbortSignal }>((resolve) => { started = resolve; });
  const errors: unknown[] = [];
  const error = (failure: unknown) => errors.push(failure);
  boss.on('error', error);
  try {
    const queue = await boss.getQueue(GENERATE_TOUR);
    assert.equal(queue?.expireInSeconds, 86_400);
    assert.equal(queue?.heartbeatSeconds, 60);
    await boss.createQueue(name, { ...TOUR_JOB_POLICY, retryLimit: 0 });
    let calls = 0;
    await boss.work(name, { batchSize: 1, includeMetadata: true, heartbeatRefreshSeconds: 0.02 }, async ([job]) => {
      calls++;
      started(job);
      await new Promise<void>((resolve) => { release = resolve; });
    });
    await boss.send(name, { test: true });
    const job = await Promise.race([began, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Job did not start')), 2000))]);
    // A healthy job already beyond the former15-minute cap is still valid under the queue's new policy.
    await db.query("update pgboss.job set started_on=now()-interval '16 minutes',heartbeat_on=now()-interval '2 minutes' where id=$1 and name=$2", [job.id, name]);
    // Workers refresh heartbeats automatically; wait for a real refresh before checking the supervisor.
    for (let attempt = 0; attempt < 50; attempt++) {
      const row = (await db.query("select heartbeat_on > now()-interval '1 minute' as live from pgboss.job where id=$1 and name=$2", [job.id, name])).rows[0];
      if (row?.live) break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    await boss.supervise(name);
    const active = (await db.query('select state,heartbeat_on > now()-interval \'1 minute\' as live from pgboss.job where id=$1 and name=$2', [job.id, name])).rows[0];
    assert.equal(active.state, 'active'); assert.equal(active.live, true);
    await boss.cancel(name, { id: job.id, retryCount: job.retryCount });
    for (let attempt = 0; attempt < 50 && !job.signal.aborted; attempt++) await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(job.signal.aborted, true, 'The worker stops when its claim has been cancelled.');
    // pg-boss returns affected at runtime, but its published CommandResponse declaration is empty.
    const touched = await boss.touch(name, { id: job.id, retryCount: job.retryCount }) as { affected: number };
    assert.equal(touched.affected, 0);
    release();
    await boss.offWork(name, { wait: true });
    assert.equal(calls, 1);
    assert.deepEqual(errors, []);
  } finally {
    release();
    await boss.offWork(name, { wait: true });
    await boss.deleteQueue(name);
    boss.off('error', error);
    await boss.stop();
    await db.close();
  }
});
