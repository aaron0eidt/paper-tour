import type { Db } from './db';
export type ActivitySink = (type: string, data: Record<string, unknown>) => Promise<void>;

export function generationRecorder(db: Db, generationId: string, secret = ''): ActivitySink {
  return async (type, data) => {
    const json = JSON.stringify(data, (_key, value) =>
      typeof value === 'string' && secret ? value.split(secret).join('[REDACTED]') : value,
    );
    // Inputs contain source references instead of image data or signed URLs.
    await db.query('insert into generation_events(generation_id,type,data) values($1,$2,$3)', [
      generationId,
      type,
      json,
    ]);
  };
}
