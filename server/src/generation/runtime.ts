import type { Config } from '../config';
import type { Database } from '../db';
import type { FileStorage } from '../storage';
import type { Enqueue } from '../service';
import type { SettingsService } from '../settings';
import { TourWorker } from '../tour-worker';
import { PaperAgent } from '../agent/runner';
import { recoverInterruptedTours } from '../tour-recovery';
import { createTourGenerator } from './writers';

export interface GenerationJob {
  documentId: string;
  analysisId: string;
  generationId: string;
}

/** Queue handlers share lifecycle routing; strategies retain their distinct authoring policies. */
export function createGenerationRuntime(
  db: Database,
  storage: FileStorage,
  config: Config,
  enqueue: Enqueue,
  settings: SettingsService,
) {
  const tours = new TourWorker(
    db,
    storage,
    config,
    createTourGenerator(config.muse, config.tours),
    undefined,
    async (owner, model) => {
      const access = await settings.resolveMuse(owner, model);
      return {
        generator: createTourGenerator(access.config, config.tours),
        secret: access.config.apiKey,
        source: access.source,
        version: access.version,
      };
    },
  );
  const agent = new PaperAgent(db, storage, config, enqueue, settings, (input, signal) =>
    tours.loadImages(input, signal),
  );
  return {
    async reconcile(queue: Parameters<typeof recoverInterruptedTours>[1], startedAt: Date) {
      const recovered = await recoverInterruptedTours(db, queue, startedAt);
      await tours.reconcile(enqueue);
      await agent.reconcile();
      return recovered;
    },
    async start(job: GenerationJob, finalAttempt = false, signal?: AbortSignal) {
      const {
        rows: [run],
      } = await db.query('select engine from tour_generations where id=$1', [job.generationId]);
      if (!run) return;
      if (run.engine === 'agent') return agent.start(job.generationId);
      return tours.generate(job.documentId, job.analysisId, job.generationId, finalAttempt, signal);
    },
    turn: (runId: string, wakeIndex: number, signal?: AbortSignal) => agent.turn(runId, wakeIndex, signal),
  };
}
