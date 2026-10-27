import { config } from './config';
import { Database } from './db';
import { storageClient } from './storage';
import { createQueue, ANALYZE, DELETE, CLEANUP, GENERATE_TOUR } from './queue';
import { AnalysisWorker } from './worker';
import { TourWorker } from './tour-worker';
import { createMuseTourGenerator } from './muse/generator';
const c = config();
const db = new Database(c.databaseUrl);
const { storage } = storageClient(c.supabaseUrl, c.serviceKey);
const { boss, enqueue } = await createQueue(c.databaseUrl);
const worker = new AnalysisWorker(db, storage, c, enqueue);
const tourWorker = new TourWorker(db, storage, c, createMuseTourGenerator(c.muse));
await tourWorker.reconcile(enqueue);
await boss.work<{ documentId: string; analysisId: string; generationId: string }>(
  GENERATE_TOUR,
  { batchSize: 1, includeMetadata: true },
  async (jobs) => {
    for (const job of jobs)
      await tourWorker.generate(
        job.data.documentId,
        job.data.analysisId,
        job.data.generationId,
        job.retryCount >= 2,
        job.signal,
      );
  },
);
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
