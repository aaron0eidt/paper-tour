import { PgBoss } from 'pg-boss';
import type { Enqueue } from './service';
export const ANALYZE = 'paper-analyze';
export const DELETE = 'paper-delete';
export const GENERATE_TOUR = 'paper-generate-tour';
export const AGENT_TURN = 'paper-agent-turn';
export const CLEANUP = 'paper-cleanup';
/** pg-boss requires an absolute expiry (max24h); heartbeat is liveness, not an extension of that expiry. */
export const TOUR_JOB_POLICY = { expireInSeconds: 86_400, heartbeatSeconds: 60 } as const;
export async function createQueue(url: string) {
  const boss = new PgBoss({ connectionString: url, schema: 'pgboss', max: 3 });
  boss.on('error', (error) => console.error('Queue error:', error.message));
  await boss.start();
  for (const name of [ANALYZE, DELETE, CLEANUP, GENERATE_TOUR, AGENT_TURN])
    await boss.createQueue(name, {
      retryLimit: 2,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 900,
      ...(name === GENERATE_TOUR ? TOUR_JOB_POLICY : {}),
    });
  // createQueue is idempotent; existing installations need an explicit policy update as well.
  await boss.updateQueue(GENERATE_TOUR, TOUR_JOB_POLICY);
  const enqueue: Enqueue = async (kind, data, db) => {
    await boss.send(
      kind === 'agent_turn'
        ? AGENT_TURN
        : kind === 'analyze'
          ? ANALYZE
          : kind === 'generate_tour'
            ? GENERATE_TOUR
            : DELETE,
      data,
      {
        ...(kind === 'generate_tour' ? TOUR_JOB_POLICY : {}),
        singletonKey: data.agentRunId
          ? `${data.agentRunId}:${data.wakeIndex}`
          : (data.generationId ?? data.analysisId ?? data.documentId),
        ...(db
          ? {
              db: {
                executeSql: (text: string, values?: unknown[]) => db.query(text, values),
              },
            }
          : {}),
      },
    );
  };
  return { boss, enqueue };
}
