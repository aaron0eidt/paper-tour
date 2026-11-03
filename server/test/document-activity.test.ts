import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createUIMessageStreamResponse } from 'ai';
import { ActivityChannel, activityTask, currentActivity, withActivity } from '../src/ai/activity-context';
import { DocumentActivityStore } from '../src/document-activity';
import { activityUIStream } from '../src/ai/activity-stream';
import { readActivityStream } from '../../player/src/library/activity';
import {
  mergeActivity,
  preferredActivity,
  type ActivityOperation,
  type ActivityRun,
  type DocumentActivityFrame,
} from '../../shared/agentActivity';
import { AnswerCache } from '../src/ask-cache';
import { MuseClient } from '../src/muse/client';
import { Database } from '../src/db';
import { DocumentService } from '../src/service';
import { generationRecorder } from '../src/activity';
import { VisualValidationError, HttpError } from '../src/errors';
import { askError } from '../src/harness/ask';
import { createApp } from '../src/app';
import type { FileStorage } from '../src/storage';

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
const listen = (channel: ActivityChannel) => {
  const operations = new Map<string, ActivityOperation>();
  channel.subscribe(async (op) => {
    operations.set(op.id, structuredClone(op));
  });
  return operations;
};
const run = (id: string, kind: ActivityRun['kind']): ActivityRun => ({
  id,
  kind,
  title: kind,
  status: 'running',
  startedAt: '2026-11-03T10:00:00Z',
  updatedAt: '2026-11-03T10:00:01Z',
  operations: [],
  controllable: true,
});

test('rejected visuals expose an actionable public error, retain diagnostics and never become ready work', async () => {
  const channel = new ActivityChannel(),
    operations = listen(channel);
  const rejected = new VisualValidationError(['Frame 0: private render diagnostic']);
  await assert.rejects(
    withActivity(channel, () =>
      activityTask('Render the illustration', 'validation', async () => {
        throw rejected;
      }),
    ),
    rejected,
  );
  const mapped = askError(rejected);
  assert.ok(mapped instanceof HttpError);
  assert.equal(mapped.status, 422);
  assert.equal(mapped.code, 'visual_validation_failed');
  assert.match(rejected.message, /private render diagnostic/);
  const publicOperation = [...operations.values()][0];
  assert.equal(publicOperation.state, 'failed');
  assert.match(publicOperation.detail!, /Retry/);
  assert.doesNotMatch(JSON.stringify(publicOperation), /private render/);
});

test('SDK custom data parts survive fragmented UTF-8 and reconcile operation snapshots on replay', async () => {
  const operation: ActivityOperation = {
    id: 'model-1',
    label: 'Explain α',
    kind: 'model',
    state: 'running',
    startedAt: run('x', 'answer').startedAt,
    draft: 'Public explanation β',
  };
  const frames: DocumentActivityFrame[] = [
    { runs: [run('answer', 'answer')], cursor: '1' },
    { operations: [{ runId: 'answer', value: operation }], cursor: '2' },
    { operations: [{ runId: 'answer', value: { ...operation, state: 'completed' } }], cursor: '3' },
  ];
  const source = async function* () {
    yield* frames;
  };
  const sdk = createUIMessageStreamResponse({ stream: activityUIStream(source(), 'document-1') });
  const bytes = new Uint8Array(await sdk.arrayBuffer());
  const fragmented = new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += 7) controller.enqueue(bytes.slice(offset, offset + 7));
      controller.close();
    },
  });
  const received: DocumentActivityFrame[] = [];
  let runs: ActivityRun[] = [];
  for await (const frame of readActivityStream<DocumentActivityFrame>(new Response(fragmented))) {
    received.push(frame);
    runs = mergeActivity(runs, frame);
  }
  assert.deepEqual(received, frames);
  runs = mergeActivity(runs, frames[2]);
  assert.equal(runs[0].operations.length, 1);
  assert.equal(runs[0].operations[0].state, 'completed');
  assert.match(runs[0].operations[0].draft!, /β/);
  const previous: ActivityOperation = { ...operation, id: 'earlier', startedAt: '2026-11-03T09:59:59Z' };
  runs = mergeActivity(runs, { operations: [{ runId: 'answer', value: previous }] });
  assert.equal(runs[0].operations[0].id, 'earlier', 'a late replay retains its actual start time');
  assert.equal(
    preferredActivity([run('tour', 'tour'), run('reading', 'reading'), run('answer', 'answer')])?.id,
    'answer',
  );
  assert.equal(preferredActivity([run('tour', 'tour'), run('reading', 'reading')], 'reading')?.id, 'reading');
});

test('joined answers observe one computation, including late replay, without one cancellation stopping another', async () => {
  const cache = new AnswerCache();
  const firstChannel = new ActivityChannel(),
    secondChannel = new ActivityChannel();
  const firstOperations = listen(firstChannel),
    secondOperations = listen(secondChannel);
  let finish!: () => void,
    calls = 0;
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const stop = new AbortController();
  const compute = async (signal: AbortSignal) => {
    calls++;
    await activityTask('Load source images', 'source', async () => {});
    const op = currentActivity()!.start('Write explanation', 'model');
    await op.draft('This is public narration.');
    await gate;
    assert.equal(signal.aborted, false);
    await op.finish();
    return {
      answerable: 'yes' as const,
      steps: [{ id: 'a', say: 'A checked explanation.', actions: [] }],
      followups: [],
    };
  };
  const first = withActivity(firstChannel, () => cache.serve('same', compute, stop.signal));
  await tick();
  const second = withActivity(secondChannel, () => cache.serve('same', compute));
  await tick();
  assert.ok([...secondOperations.values()].some((op) => op.draft === 'This is public narration.'));
  stop.abort();
  await assert.rejects(first);
  finish();
  await second;
  assert.equal(calls, 1);
  assert.ok([...secondOperations.values()].some((op) => op.label === 'Write explanation' && op.state === 'completed'));
  const cached = new ActivityChannel(),
    cachedOps = listen(cached);
  await withActivity(cached, () => cache.serve('same', compute));
  assert.deepEqual(
    [...cachedOps.values()].map((op) => op.label),
    ['Use saved answer'],
  );
  assert.equal(calls, 1);
  assert.ok(firstOperations.size > 0);
});

test('model activity uses SDK structured partials and never exposes planning fields or provider requests', async () => {
  const channel = new ActivityChannel(),
    operations = listen(channel);
  const value = { plan: 'private-plan-do-not-stream', steps: [{ say: 'Explain the source α.' }] };
  let calls = 0;
  const client = new MuseClient(
    {
      apiKey: 'private-test-key',
      baseUrl: 'https://api.meta.ai/v1',
      model: 'muse-spark-1.3',
      language: 'en',
      timeoutMs: 5000,
    },
    async () => {
      calls++;
      return new Response(
        JSON.stringify({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        }),
        { headers: { 'content-type': 'application/json' } },
      );
    },
  );
  await withActivity(channel, () =>
    client.complete(
      [{ role: 'user', content: 'private-source-content' }],
      'ask_answer',
      {
        type: 'object',
        properties: {
          plan: { type: 'string' },
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: { say: { type: 'string' } },
              required: ['say'],
              additionalProperties: false,
            },
          },
        },
        required: ['plan', 'steps'],
        additionalProperties: false,
      },
      1000,
    ),
  );
  assert.equal(calls, 1);
  const serialized = JSON.stringify([...operations.values()]);
  assert.match(serialized, /Explain the source α/);
  assert.doesNotMatch(serialized, /private-plan|private-test-key|private-source-content/);
  assert.equal([...operations.values()][0].state, 'completed');
});

test(
  'document history is durable and private; controls do not regenerate work and paused queues finish their current operation',
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const db = new Database(process.env.TEST_DATABASE_URL!);
    const owner = randomUUID(),
      other = randomUUID(),
      documentId = randomUUID(),
      analysisId = randomUUID();
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
      authenticate: async (token) => (token === 'owner' ? owner : token === 'other' ? other : null),
    });
    try {
      await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [
        owner,
        `${owner}@example.test`,
        other,
        `${other}@example.test`,
      ]);
      await db.query(
        'insert into documents(id,owner_id,title,original_filename,upload_path,upload_size) values($1,$2,$3,$3,$4,8)',
        [documentId, owner, 'Activity fixture', `test/${documentId}.pdf`],
      );
      await db.query("insert into analyses(id,document_id,status) values($1,$2,'failed')", [analysisId, documentId]);
      const readingId = randomUUID();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const pending = service.documentActivity.run(
        owner,
        documentId,
        { id: readingId, kind: 'reading', title: 'Prepare read aloud', analysisId },
        undefined,
        async () => {
          await activityTask('Read page context', 'source', async () => {}, ['p1.b1']);
          await gate;
          return 'saved';
        },
      );
      await tick();
      await tick();
      // Wait on durable evidence rather than an assumed scheduling delay.
      for (let n = 0; n < 30 && !(await service.documentActivity.list(owner, documentId)).runs.length; n++)
        await tick();
      const headers = { authorization: 'Bearer owner' };
      const path = `/api/documents/${documentId}/activity`;
      const before = (await app.inject({ method: 'GET', url: path, headers })).json();
      assert.equal(before.runs[0].kind, 'reading');
      assert.equal((await app.inject({ method: 'GET', url: path })).statusCode, 401);
      assert.equal(
        (await app.inject({ method: 'GET', url: path, headers: { authorization: 'Bearer other' } })).statusCode,
        404,
      );
      assert.equal((await app.inject({ method: 'GET', url: path + '/events?after=-1', headers })).statusCode, 400);
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: `${path}/${readingId}/control`,
            headers,
            payload: { action: 'pause' },
          })
        ).statusCode,
        204,
      );
      release();
      assert.equal(await pending, 'saved');
      const persisted = await new DocumentActivityStore(db).list(owner, documentId);
      assert.equal(persisted.runs[0].status, 'paused');
      assert.equal(persisted.runs[0].operations[0].state, 'completed');
      await service.documentActivity.control(owner, documentId, readingId, 'resume');
      await service.documentActivity.readingProgress(owner, documentId, readingId, {
        completed: 1,
        total: 3,
        preview: 'fig1',
        previewState: 'completed',
      });
      const changes = await service.documentActivity.changes(owner, documentId, before.cursor);
      assert.ok(changes.operations?.some((update) => update.value.kind === 'preview'));
      await assert.rejects(
        service.documentActivity.readingProgress(owner, documentId, readingId, { completed: 4, total: 3 }),
      );
      const answerId = randomUUID();
      let started!: () => void;
      const active = new Promise<void>((resolve) => {
        started = resolve;
      });
      const answer = service.documentActivity.run(
        owner,
        documentId,
        { id: answerId, kind: 'answer', title: 'Explain', analysisId },
        undefined,
        (signal) => {
          started();
          return new Promise<void>((_, reject) =>
            signal.addEventListener('abort', () => reject(signal.reason), { once: true }),
          );
        },
      );
      await active;
      const rejected = assert.rejects(answer);
      await service.documentActivity.control(owner, documentId, answerId, 'cancel');
      await rejected;
      assert.equal(
        (await service.documentActivity.list(owner, documentId)).runs.find((r) => r.id === answerId)?.status,
        'cancelled',
      );
      await assert.rejects(
        service.documentActivity.run(
          owner,
          documentId,
          { id: answerId, kind: 'answer', title: 'again', analysisId },
          undefined,
          async () => assert.fail('must not regenerate'),
        ),
      );
      await assert.rejects(
        db.transaction(async (tx) => {
          await tx.query('set local role authenticated');
          await tx.query('select * from document_activity_runs');
        }),
        /permission denied/,
      );
      const generationId = randomUUID();
      await db.query(
        "insert into tour_generations(id,document_id,analysis_id,status,model) values($1,$2,$3,'ready','muse-spark-1.3')",
        [generationId, documentId, analysisId],
      );
      const record = generationRecorder(db.pool, generationId);
      await record('model.started', {
        callId: 'model-1',
        name: 'paper_card',
        prompt: 'private-request',
        task: { label: 'private-plan' },
      });
      await record('model.delta', { callId: 'model-1', delta: '{"plan":"private-JSON"}' });
      await record('model.narration', { callId: 'model-1', text: 'Public explanation.' });
      await record('model.completed', {
        callId: 'model-1',
        output: { say: 'Public explanation.', reasoning: 'private-reasoning' },
      });
      const tour = (await service.documentActivity.list(owner, documentId)).runs.find((r) => r.id === generationId)!;
      assert.equal(tour.operations[0].label, 'Understand the document');
      assert.equal(tour.operations[0].draft, 'Public explanation.');
      assert.doesNotMatch(JSON.stringify(tour), /private-/);
      const tourAgentId = randomUUID();
      await db.query("insert into agent_runs(id,generation_id,status) values($1,$2,'paused')", [
        tourAgentId,
        generationId,
      ]);
      await db.query("update tour_generations set agent_run_id=$2,status='paused' where id=$1", [
        generationId,
        tourAgentId,
      ]);
      await db.query(
        `insert into document_activity_runs(id,document_id,analysis_id,kind,title,status)
        select gen_random_uuid(),$1,$2,'answer',concat('History fixture ',i),'completed' from generate_series(1,25) i`,
        [documentId, analysisId],
      );
      const firstPage = await service.documentActivity.list(owner, documentId);
      assert.equal(firstPage.hasMore, true);
      assert.equal(
        firstPage.runs.some((r) => r.id === generationId),
        false,
      );
      const historyIds = new Set(firstPage.runs.map((r) => r.id));
      let page = firstPage;
      for (let n = 0; page.hasMore && n < 5; n++) {
        page = await service.documentActivity.list(owner, documentId, page.before);
        for (const item of page.runs) historyIds.add(item.id);
      }
      assert.equal(historyIds.size, 28);
      const tourControl = `${path}/${generationId}/control`;
      assert.equal(
        (await app.inject({ method: 'POST', url: tourControl, headers, payload: { action: 'resume' } })).statusCode,
        204,
      );
      assert.equal((await service.agentRun(owner, documentId, tourAgentId)).status, 'queued');
      assert.equal(
        (await app.inject({ method: 'POST', url: tourControl, headers, payload: { action: 'cancel' } })).statusCode,
        204,
      );
      assert.equal((await service.agentRun(owner, documentId, tourAgentId)).status, 'cancelled');
      await db.query('delete from documents where id=$1', [documentId]);
      assert.equal((await db.query('select 1 from document_activity_runs where id=$1', [readingId])).rowCount, 0);
    } finally {
      await app.close();
      await db.query('delete from auth.users where id=any($1::uuid[])', [[owner, other]]);
      await db.close();
    }
  },
);
