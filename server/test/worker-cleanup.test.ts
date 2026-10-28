import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisWorker } from '../src/worker';
import type { Database } from '../src/db';
import type { FileStorage } from '../src/storage';
import type { Config } from '../src/config';

test('orphan cleanup preserves referenced assets and retired media without a retired database table', async () => {
  const prefix = 'owner/document';
  const document = { id: 'document', owner_id: 'owner', upload_path: `${prefix}/paper.pdf` };
  const files = [
    document.upload_path,
    `${prefix}/figure.png`,
    `${prefix}/animations/archived/video.mp4`,
    `${prefix}/animations/archived/poster.png`,
    `${prefix}/failed/figure.png`,
    `${prefix}/animations-other/stale.png`,
  ];
  const removed: string[] = [];
  let released = false;
  const db = {
    pool: {
      connect: async () => ({
        query: async () => ({ rows: [] }),
        release: () => {
          released = true;
        },
      }),
    },
    query: async (sql: string) => {
      if (sql.startsWith('update documents set deleted_at')) return { rows: [] };
      if (sql.startsWith('select id,owner_id,upload_path')) return { rows: [document] };
      if (sql.startsWith('select 1 from analyses')) return { rows: [] };
      if (sql.startsWith('select storage_path from assets'))
        return { rows: [{ storage_path: `${prefix}/figure.png` }] };
      throw new Error(`Unexpected cleanup query: ${sql}`);
    },
  } as unknown as Database;
  const storage = {
    list: async () => files,
    remove: async (paths: string[]) => {
      removed.push(...paths);
    },
  } as unknown as FileStorage;
  await new AnalysisWorker(db, storage, {} as Config).cleanup();
  assert.deepEqual(removed, [`${prefix}/failed/figure.png`, `${prefix}/animations-other/stale.png`]);
  assert.equal(released, true);
});
