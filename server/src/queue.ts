import { PgBoss } from 'pg-boss';
import type { Enqueue } from './service';
export const ANALYZE = 'paper-analyze';
export const DELETE = 'paper-delete';
export const CLEANUP = 'paper-cleanup';
export async function createQueue(url: string) {
  const boss = new PgBoss({ connectionString: url, schema: 'pgboss', max: 3 });
  boss.on('error', (error) => console.error('Queue error:', error.message));
  await boss.start();
  for (const name of [ANALYZE, DELETE, CLEANUP])
    await boss.createQueue(name, {
      retryLimit: 2,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 900,
    });
  const enqueue: Enqueue = async (kind, data, db) => {
    await boss.send(kind === 'analyze' ? ANALYZE : DELETE, data, {
      singletonKey: data.analysisId ?? data.documentId,
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
