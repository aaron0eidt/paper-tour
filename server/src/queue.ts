import { PgBoss } from 'pg-boss';
import type { Enqueue } from './service';
export const ANALYZE = 'paper-analyze';
export const DELETE = 'paper-delete';
export const GENERATE_TOUR = 'paper-generate-tour';
export const CLEANUP = 'paper-cleanup';
export async function createQueue(url: string) {
  const boss = new PgBoss({ connectionString: url, schema: 'pgboss', max: 3 });
  boss.on('error', (error) => console.error('Queue error:', error.message));
  await boss.start();
  for (const name of [ANALYZE, DELETE, CLEANUP, GENERATE_TOUR])
    await boss.createQueue(name, {
      retryLimit: 2,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 900,
    });
  const enqueue: Enqueue = async (kind, data, db) => {
    await boss.send(kind === 'analyze' ? ANALYZE : kind === 'generate_tour' ? GENERATE_TOUR : DELETE, data, {
      singletonKey: data.generationId ?? data.analysisId ?? data.documentId,
      ...(db
        ? {
            db: {
              executeSql: (text: string, values?: unknown[]) => db.query(text, values),
            },
          }
        : {}),
    });
  };
  return { boss, enqueue };
}
