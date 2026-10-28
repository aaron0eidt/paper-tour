import type { PgBoss } from 'pg-boss';
import { generationRecorder } from './activity';
import { Database } from './db';
import { GENERATE_TOUR } from './queue';

/** A live TourWorker owns this document's advisory lock for its entire run.
 * Recover only unlocked, interrupted runs; never replay a possibly paid request.
 */
export async function recoverInterruptedTours(
  db: Database,
  boss: Pick<PgBoss, 'cancel'>,
  startedBefore = new Date(),
): Promise<string[]> {
  const { rows } = await db.query(
    `select id,document_id from tour_generations
     where engine='legacy' and status='generating' and updated_at<$1`,
    [startedBefore],
  );
  const recovered: string[] = [];
  for (const candidate of rows) {
    const interrupted = await db.transaction(async (tx) => {
      const {
        rows: [lock],
      } = await tx.query('select pg_try_advisory_xact_lock(hashtextextended($1,0)) as acquired', [
        candidate.document_id,
      ]);
      if (!lock.acquired) return false;
      const {
        rows: [generation],
      } = await tx.query(
        `select id from tour_generations where id=$1 and engine='legacy'
         and status='generating' and updated_at<$2 for update`,
        [candidate.id, startedBefore],
      );
      if (!generation) return false;
      const { rows: jobs } = await tx.query(
        `select id from pgboss.job where name=$1 and state='active'
         and data->>'generationId'=$2`,
        [GENERATE_TOUR, candidate.id],
      );
      if (jobs.length) {
        await boss.cancel(
          GENERATE_TOUR,
          jobs.map((job) => job.id),
          {
            db: { executeSql: (text, values) => tx.query(text, values) },
          },
        );
      }
      const message = 'Tour creation was interrupted when the worker stopped. Retry to continue creating a new tour.';
      await tx.query(
        `update tour_generations set status='failed',error_code='worker_interrupted',
         error=$2,completed_at=now(),updated_at=now() where id=$1`,
        [candidate.id, message],
      );
      await generationRecorder(tx, candidate.id)('run.failed', {
        code: 'worker_interrupted',
        message,
        retrying: false,
      });
      return true;
    });
    if (interrupted) recovered.push(candidate.id);
  }
  return recovered;
}
