import { createHash } from 'node:crypto';
import type { Db } from '../db';
import type { ActivitySink } from '../activity';

export interface GenerationWorkspace {
  load(key: string): Promise<unknown | undefined>;
  save(key: string, value: unknown): Promise<void>;
}

/** Content-addressed work is reusable only with the same source, model, instructions and schema. */
export const workKey = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Reuse the private generation journal: work stays scoped to this generation and its existing access rules. */
export function generationWorkspace(db: Db, generationId: string, record: ActivitySink): GenerationWorkspace {
  return {
    async load(key) {
      const { rows } = await db.query(
        `select data->'value' as value from agent_events
         where generation_id=$1 and type='workspace.saved' and data->>'key'=$2 order by id desc limit 1`,
        [generationId, key],
      );
      return rows[0]?.value;
    },
    async save(key, value) {
      await record('workspace.saved', { key, value });
    },
  };
}
