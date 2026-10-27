import { resolve } from 'node:path';
import { config, ROOT } from './config';
import { Database } from './db';
import { storageClient } from './storage';
import { DocumentService } from './service';
import { createQueue } from './queue';
import { createApp } from './app';
const c = config();
const db = new Database(c.databaseUrl);
const { storage, authenticate } = storageClient(c.supabaseUrl, c.serviceKey);
const { boss, enqueue } = await createQueue(c.databaseUrl);
const app = await createApp({
  service: new DocumentService(db, storage, enqueue, c.maxBytes),
  authenticate,
  origins: c.origins,
  spaDir: resolve(ROOT, 'player/dist'),
  logger: true,
});
const shutdown = async () => {
  await app.close();
  await boss.stop();
  await db.close();
};
process.once('SIGTERM', () => void shutdown());
process.once('SIGINT', () => void shutdown());
await app.listen({ host: c.host, port: c.port });
