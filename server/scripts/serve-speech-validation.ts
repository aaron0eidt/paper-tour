/** Local-only live playback harness against a disposable database and the production speech routes. */
import Fastify from 'fastify';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { ROOT } from '../src/config';
import { Database } from '../src/db';
import { speechConfig } from '../src/speech/config';
import { SpeechService } from '../src/speech/service';
import { speechRoutes } from '../src/speech/routes';
if (process.env.NODE_ENV === 'production') throw new Error('The live validation harness is development-only.');
const { name, url } = JSON.parse(await readFile(resolve(ROOT, '.data/speech-test-database.json'), 'utf8'));
if (!/^paper_tour_tts_test_[a-f0-9]+$/.test(name)) throw new Error('Use the isolated speech test database.');
const db = new Database(url),
  owner = randomUUID();
await db.query('insert into auth.users(id,email) values($1,$2)', [owner, `${owner}@example.test`]);
const api = Fastify(),
  speech = new SpeechService(db, { ...speechConfig(), cacheDir: resolve(ROOT, '.data/speech-live-cache') });
api.addHook('preHandler', async (request, reply) => {
  if (request.headers.authorization !== 'Bearer speech-validation-only')
    reply.code(401).send({ error: 'unauthorized' });
});
await api.register(async (routes) => speechRoutes(routes, speech, () => owner), { prefix: '/api' });
const shutdown = async () => {
  await api.close();
  await db.query('delete from auth.users where id=$1', [owner]);
  await db.close();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
await api.listen({ host: '127.0.0.1', port: 3017 });
console.log('Isolated speech validation API: 127.0.0.1:3017 (no application DB/worker).');
