import { config } from './config';
import { Database } from './db';
import { storageClient } from './storage';
import { createQueue, ANALYZE, DELETE, CLEANUP } from './queue';
import { AnalysisWorker } from './worker';
const c = config();
const db = new Database(c.databaseUrl);
const { storage } = storageClient(c.supabaseUrl, c.serviceKey);
const { boss } = await createQueue(c.databaseUrl);
const worker = new AnalysisWorker(db, storage, c);
await boss.work<{ documentId: string; analysisId: string }>(
  ANALYZE,
  { batchSize: 1, includeMetadata: true },
  async (jobs) => {
    for (const job of jobs) await worker.analyze(job.data.documentId, job.data.analysisId, job.retryCount >= 2);
  },
);
await boss.work<{ documentId: string }>(DELETE, { batchSize: 1 }, async (jobs) => {
  for (const job of jobs) await worker.remove(job.data.documentId);
});
await boss.work(CLEANUP, { batchSize: 1 }, async () => worker.cleanup());
await boss.schedule(CLEANUP, '0 * * * *', {});
console.log('Paper Tour analysis worker ready.');
const stop = async () => {
  await boss.stop({ graceful: true });
  await db.close();
};
process.once('SIGTERM', () => void stop());
process.once('SIGINT', () => void stop());
