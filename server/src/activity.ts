import type { Db } from './db';
export type ActivitySink = (type: string, data: Record<string, unknown>) => Promise<void>;

export function generationRecorder(db: Db, generationId: string, secret = '', agentRunId?: string): ActivitySink {
  return async (type, data) => {
    const json = JSON.stringify(data, (_key, value) =>
      typeof value === 'string' && secret ? value.split(secret).join('[REDACTED]') : value,
    );
    // Inputs contain source references instead of image data or signed URLs.
    await db.query('insert into agent_events(generation_id,type,data,agent_run_id) values($1,$2,$3,$4)', [
      generationId,
      type,
      json,
      agentRunId ?? null,
    ]);
  };
}
