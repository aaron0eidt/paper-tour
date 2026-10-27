import { PaperAgent } from './agent/runner';
import { config, type MuseConfig } from './config';
import { HarnessTourGenerator } from './harness/generator';
import { Database } from './db';
import { storageClient } from './storage';
import { createQueue, ANALYZE, DELETE, CLEANUP, GENERATE_TOUR, AGENT_TURN } from './queue';
import { AnalysisWorker } from './worker';
import { TourWorker } from './tour-worker';
import { MuseTourGenerator } from './muse/generator';
import { SettingsService } from './settings';
const c = config();
const db = new Database(c.databaseUrl);
const { storage } = storageClient(c.supabaseUrl, c.serviceKey);
const { boss, enqueue } = await createQueue(c.databaseUrl);
const worker = new AnalysisWorker(db, storage, c, enqueue);
const settings = new SettingsService(db, c.muse);
// Short main-idea tours by default; TOUR_WRITER=muse brings back the one-shot page-by-page writer.
const writer = (muse: MuseConfig) =>
  c.tours.writer === 'harness' ? new HarnessTourGenerator(muse, c.tours.preset) : new MuseTourGenerator(muse);
const tourWorker = new TourWorker(db, storage, c, writer(c.muse), undefined, async (owner, model) => {
  const resolved = await settings.resolveMuse(owner, model);
  return {
    generator: writer(resolved.config).withModel!(model),
    secret: resolved.config.apiKey,
    source: resolved.source,
    version: resolved.version,
  };
});
const agent = new PaperAgent(db, storage, c, enqueue, settings, (input, signal) =>
  tourWorker.loadImages(input, signal),
);
await tourWorker.reconcile(enqueue);
await agent.reconcile();
await boss.work<{ documentId: string; agentRunId: string; wakeIndex: number }>(
  AGENT_TURN,
  { batchSize: 1, includeMetadata: true },
  async (jobs) => {
    for (const job of jobs) await agent.turn(job.data.agentRunId, job.data.wakeIndex, job.signal);
  },
);
await boss.work<{ documentId: string; analysisId: string; generationId: string }>(
  GENERATE_TOUR,
  { batchSize: 1, includeMetadata: true },
  async (jobs) => {
    for (const job of jobs) {
      const {
        rows: [generation],
      } = await db.query('select engine from tour_generations where id=$1', [job.data.generationId]);
      if (generation?.engine === 'agent') {
        await agent.start(job.data.generationId);
        continue;
      }
      await tourWorker.generate(
        job.data.documentId,
        job.data.analysisId,
        job.data.generationId,
        job.retryCount >= 2,
        job.signal,
      );
    }
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
