import { reportedUsage } from '../../shared/activity';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/db';
import { DocumentService } from '../src/service';
import { createApp } from '../src/app';
import { generationRecorder } from '../src/activity';
import type { FileStorage } from '../src/storage';
import { readActivityStream } from '../../player/src/library/activity';

test(
  'private generation events replay in order and stay isolated by document owner',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = new Database(process.env.TEST_DATABASE_URL!);
    const user = randomUUID(),
      other = randomUUID(),
      doc = randomUUID(),
      analysis = randomUUID(),
      generation = randomUUID();
    const storage: FileStorage = {
      info: async () => ({ size: 8 }),
      download: async () => Buffer.from(''),
      upload: async () => {},
      sign: async () => '',
      remove: async () => {},
      list: async () => [],
    };
    const service = new DocumentService(db, storage, async () => {});
    const app = await createApp({
      service,
      authenticate: async (token) => (token === 'owner' ? user : token === 'other' ? other : null),
    });
    const path = `/api/documents/${doc}/generations/${generation}/events`;
    try {
      await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [
        user,
        `${user}@example.test`,
        other,
        `${other}@example.test`,
      ]);
      await db.query(
        'insert into documents(id,owner_id,title,original_filename,upload_path,upload_size) values($1,$2,$3,$3,$4,8)',
        [doc, user, 'Activity fixture', `test/${doc}.pdf`],
      );
      await db.query("insert into analyses(id,document_id,status) values($1,$2,'failed')", [analysis, doc]);
      await db.query(
        "insert into tour_generations(id,document_id,analysis_id,status,model) values($1,$2,$3,'failed','muse-spark-1.3')",
        [generation, doc, analysis],
      );
      const record = generationRecorder(db.pool, generation, 'private-test-key');
      await record('model.started', { callId: 'a', prompt: 'actual input private-test-key' });
      await record('model.delta', { callId: 'a', delta: 'actual output β' });
      await record('run.failed', { code: 'validation_failed' });
      const headers = { authorization: 'Bearer owner' };
      const read = await app.inject({ method: 'GET', url: path, headers });
      assert.equal(read.statusCode, 200);
      assert.match(read.headers['content-type']!, /text\/event-stream/);
      assert(!read.body.includes('private-test-key'));
      assert(read.body.includes('[REDACTED]'));
      assert(read.body.includes('actual output β'));
      const ui = await app.inject({ method: 'GET', url: path + '?format=ui', headers });
      assert.equal(ui.statusCode, 200);
      assert.equal(ui.headers['x-vercel-ai-ui-message-stream'], 'v1');
      const sdkEvents = [];
      for await (const frame of readActivityStream(new Response(ui.body))) if (frame.event) sdkEvents.push(frame.event);
      assert.deepEqual(
        sdkEvents.map((event) => event.type),
        ['model.started', 'model.delta', 'run.failed'],
      );
      assert(!JSON.stringify(sdkEvents).includes('private-test-key'));
      assert.equal(
        (await app.inject({ method: 'GET', url: path + '?format=ui', headers: { authorization: 'Bearer other' } }))
          .statusCode,
        404,
      );
      const frames = read.body
        .split('\n\n')
        .filter(Boolean)
        .map((frame) => JSON.parse(frame.slice(6)));
      const events = frames.filter((item) => item.event).map((item) => item.event);
      assert.deepEqual(
        events.map((e) => e.type),
        ['model.started', 'model.delta', 'run.failed'],
      );
      const replay = await app.inject({ method: 'GET', url: `${path}?after=${events[0].id}`, headers });
      assert(!replay.body.includes('model.started'));
      assert(replay.body.includes('model.delta'));
      assert.equal((await app.inject({ method: 'GET', url: path })).statusCode, 401);
      assert.equal(
        (await app.inject({ method: 'GET', url: path, headers: { authorization: 'Bearer other' } })).statusCode,
        404,
      );
      assert.equal((await app.inject({ method: 'GET', url: `${path}?after=-1`, headers })).statusCode, 400);
      assert.equal(
        (await app.inject({ method: 'GET', url: path.replace(generation, randomUUID()), headers })).statusCode,
        404,
      );
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.query('set local role authenticated');
          await tx.query('select * from generation_events');
        }),
        /permission denied/,
      );
      await record('model.usage', { callId: 'a', usage: { promptTokens: 100, completionTokens: 5, totalTokens: 105 } });
      await record('model.completed', {
        callId: 'a',
        usage: { promptTokens: 100, completionTokens: 5, totalTokens: 105 },
      });
      await record('model.usage', { callId: 'b', usage: { promptTokens: 6, completionTokens: 3, totalTokens: 9 } });
      const usages = [...reportedUsage((await service.activity(user, doc, generation, '0')).events).values()];
      assert.equal(
        usages.reduce((sum, value) => sum + value.promptTokens, 0),
        106,
      );
      assert.equal(
        usages.reduce((sum, value) => sum + value.completionTokens, 0),
        8,
      );
      await db.query('delete from documents where id=$1', [doc]);
      assert.equal(
        (await db.query('select 1 from generation_events where generation_id=$1', [generation])).rowCount,
        0,
      );
    } finally {
      await app.close();
      await db.query('delete from auth.users where id=any($1::uuid[])', [[user, other]]);
      await db.close();
    }
  },
);
