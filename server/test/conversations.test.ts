import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ConversationStore, conversationHistory } from '../src/conversations';
import { Database } from '../src/db';
import { createApp } from '../src/app';
import { DocumentService, type Library } from '../src/service';
import { currentSink, type AskAnswer, type AskRequest } from '../src/harness/ask';
import { answerKey } from '../src/ask-cache';
import type { FileStorage } from '../src/storage';
import type { SettingsService } from '../src/settings';
import type { Doc } from '../../shared/paper';

const answer: AskAnswer = {
  answerable: 'yes',
  steps: [{ id: 'a1', say: 'A document-grounded explanation.', actions: [] }],
  followups: ['Why?'],
};
const errorCode = (code: string) => (error: unknown) =>
  !!error && typeof error === 'object' && 'code' in error && error.code === code;

test('conversation history excludes interrupted/failed turns and retains only its last four completed answers', () => {
  const messages = Array.from({ length: 7 }, (_, i) => ({ question: `Q${i}`, answer, status: 'completed' as const }));
  assert.deepEqual(
    conversationHistory([
      ...messages,
      { question: 'Cancelled', answer, status: 'cancelled' },
      { question: 'Failed', answer: null, status: 'failed' },
    ]).map((m) => m.question),
    ['Q3', 'Q4', 'Q5', 'Q6'],
  );
  assert.equal(conversationHistory(messages)[0].answer, answer.steps[0].say);
});

test('answer cache isolates conversations and visual revisions', () => {
  const input = {
    scope: 'owner',
    documentId: 'doc',
    version: 'analysis',
    model: 'test',
    request: { question: 'Explain it', conversationId: 'first' },
  };
  const first = answerKey(input);
  assert.notEqual(first, answerKey({ ...input, request: { ...input.request, conversationId: 'second' } }));
  assert.notEqual(first, answerKey({ ...input, request: { ...input.request, visualId: 'v1', visualRevision: 2 } }));
});

test('conversation endpoints authenticate and validate source snapshots without requiring optional services', async () => {
  const owner = randomUUID(),
    documentId = randomUUID(),
    conversationId = randomUUID(),
    analysisId = randomUUID();
  const received: unknown[] = [];
  const service = {
    conversations: async (actualOwner: string, actualDocument: string) => {
      received.push([actualOwner, actualDocument]);
      return [];
    },
    createConversation: async (_owner: string, _doc: string, input: unknown) => {
      received.push(input);
      return { id: conversationId };
    },
    ask: async (_owner: string, _doc: string, request: AskRequest) => {
      received.push(request);
      return answer;
    },
  } as unknown as Library;
  const app = await createApp({
    service,
    demo: false,
    authenticate: async (token) => (token === 'owner' ? owner : null),
  });
  const headers = { authorization: 'Bearer owner' };
  try {
    assert.equal((await app.inject({ url: `/api/documents/${documentId}/conversations` })).statusCode, 401);
    assert.equal((await app.inject({ url: `/api/documents/${documentId}/conversations`, headers })).statusCode, 200);
    assert.deepEqual(received[0], [owner, documentId]);
    const valid = await app.inject({
      method: 'POST',
      url: `/api/documents/${documentId}/conversations`,
      headers,
      payload: { context: { analysisId, page: 2, selection: { page: 2, rect: [0.1, 0.2, 0.4, 0.5] } } },
    });
    assert.equal(valid.statusCode, 201, valid.body);
    for (const context of [{ ownerId: owner }, { analysisId: 'not-a-uuid' }, { page: 0 }, { question: 'Unexpected' }]) {
      assert.equal(
        (
          await app.inject({
            method: 'POST',
            url: `/api/documents/${documentId}/conversations`,
            headers,
            payload: { context },
          })
        ).statusCode,
        400,
      );
    }
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/documents/${documentId}/ask`,
          headers,
          payload: { question: 'Explain', conversationId, analysisId, page: 2 },
        })
      ).statusCode,
      200,
    );
    assert.equal((received.at(-1) as AskRequest).conversationId, conversationId);
    assert.equal(
      (
        await app.inject({
          method: 'GET',
          url: `/api/documents/${documentId}/conversations/${conversationId}`,
          headers,
        })
      ).statusCode,
      503,
    );
  } finally {
    await app.close();
  }
});

test(
  'persisted conversations isolate owners/documents/history, serialize turns and save cancelled steps',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = new Database(process.env.TEST_DATABASE_URL!);
    const store = new ConversationStore(db);
    const owner = randomUUID(),
      other = randomUUID(),
      documentId = randomUUID(),
      secondDoc = randomUUID(),
      analysisId = randomUUID();
    const doc: Doc = {
      schema: 'paper-tour/doc@0.1',
      source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
      pages: [{ n: 1, width: 600, height: 800 }],
      blocks: [],
      sentences: [],
      sections: [],
      figures: [],
      equations: [],
    };
    const storage = {} as FileStorage;
    const settings = {} as SettingsService;
    const service = new DocumentService(db, storage, async () => {}, undefined, 'test-model', undefined, settings);
    const seen: AskRequest[] = [];
    const stop = new AbortController();
    Object.defineProperty(service, 'answer', {
      value: async (_owner: string, input: { request: AskRequest }) => {
        seen.push(structuredClone(input.request));
        if (input.request.question === 'Stop this answer') {
          currentSink()?.('yes', answer.steps[0]);
          stop.abort();
          throw new DOMException('Stopped', 'AbortError');
        }
        return structuredClone(answer);
      },
    });
    try {
      await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [
        owner,
        `${owner}@example.test`,
        other,
        `${other}@example.test`,
      ]);
      await db.query(
        "insert into documents(id,owner_id,title,original_filename,upload_path,upload_size) values($1,$2,'Conversation test','paper.pdf',$3,1),($4,$2,'Other document','other.pdf',$5,1)",
        [documentId, owner, `test/${documentId}`, secondDoc, `test/${secondDoc}`],
      );
      await db.query("insert into analyses(id,document_id,status,doc) values($1,$2,'ready',$3)", [
        analysisId,
        documentId,
        doc,
      ]);
      await db.query('update documents set current_analysis_id=$2 where id=$1', [documentId, analysisId]);
      const thread = await store.create(owner, documentId, {
        context: { analysisId, page: 1 },
        title: 'Explain the paper',
      });
      const second = await store.create(owner, documentId, { context: { analysisId } });
      await t.test('foreign owners and documents cannot read, list, rename or append to a thread', async () => {
        await assert.rejects(store.get(other, documentId, thread.id), errorCode('not_found'));
        await assert.rejects(store.get(owner, secondDoc, thread.id), errorCode('not_found'));
        await assert.rejects(store.list(other, documentId), errorCode('not_found'));
        await assert.rejects(store.rename(other, documentId, thread.id, 'Bad title'), errorCode('not_found'));
        await assert.rejects(
          store.begin(other, documentId, thread.id, { question: 'Bad', analysisId }),
          errorCode('not_found'),
        );
        await assert.rejects(
          store.create(owner, secondDoc, { context: { analysisId } }),
          errorCode('analysis_not_ready'),
        );
        await db.transaction(async (tx) => {
          await tx.query('set local role authenticated');
          await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
          assert.equal((await tx.query('select id from document_conversations where id=$1', [thread.id])).rowCount, 0);
        });
      });
      await t.test('follow-up history comes from the selected server thread, never submitted history', async () => {
        const first = await service.ask(owner, documentId, {
          question: 'Original question',
          conversationId: thread.id,
          history: [{ question: 'Injected', answer: 'Wrong document' }],
        });
        assert.equal(first.conversationId, thread.id);
        assert.ok(first.messageId);
        assert.deepEqual(seen.at(-1)?.history, []);
        await service.ask(owner, documentId, { question: 'Follow up', conversationId: thread.id });
        assert.deepEqual(
          seen.at(-1)?.history?.map((m) => m.question),
          ['Original question'],
        );
        await service.ask(owner, documentId, { question: 'Unrelated', conversationId: second.id });
        assert.deepEqual(seen.at(-1)?.history, []);
        const saved = await store.get(owner, documentId, thread.id);
        assert.equal(saved.messages[0].question, 'Original question');
        assert.deepEqual(saved.messages[0].answer?.steps, answer.steps);
        assert.equal(saved.messages[0].context.analysisId, analysisId);
      });
      await t.test('only one in-flight turn may own a thread and its source analysis stays fixed', async () => {
        const turn = await store.begin(owner, documentId, thread.id, { question: 'Waiting', analysisId });
        await assert.rejects(
          store.begin(owner, documentId, thread.id, { question: 'Concurrent', analysisId }),
          errorCode('conversation_busy'),
        );
        await assert.rejects(
          store.begin(owner, documentId, thread.id, { question: 'Wrong source', analysisId: randomUUID() }),
          errorCode('conversation_analysis_mismatch'),
        );
        await store.finish(owner, documentId, thread.id, turn.messageId, 'failed', null, 'Interrupted');
      });
      await t.test(
        'cancelled streaming answers retain their usable steps and original question but do not enter successful history',
        async () => {
          await assert.rejects(
            service.ask(owner, documentId, { question: 'Stop this answer', conversationId: thread.id }, stop.signal),
          );
          const cancelled = (await store.get(owner, documentId, thread.id)).messages.at(-1)!;
          assert.equal(cancelled.status, 'cancelled');
          assert.deepEqual(cancelled.answer?.steps, answer.steps);
          assert.equal(cancelled.question, 'Stop this answer');
          await service.ask(owner, documentId, { question: 'Continue after cancellation', conversationId: thread.id });
          assert.deepEqual(
            seen.at(-1)?.history?.map((m) => m.question),
            ['Original question', 'Follow up'],
          );
          await db.transaction(async (tx) => {
            await tx.query('set local role authenticated');
            await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [other]);
            assert.equal(
              (await tx.query('select id from conversation_messages where id=$1', [cancelled.id])).rowCount,
              0,
            );
          });
        },
      );
      await t.test('stale pending turns recover after a process interruption', async () => {
        const stale = await store.begin(owner, documentId, second.id, { question: 'Interrupted process', analysisId });
        await db.query("update conversation_messages set created_at=now()-interval '6 minutes' where id=$1", [
          stale.messageId,
        ]);
        const next = await store.begin(owner, documentId, second.id, { question: 'Try again', analysisId });
        assert.equal(
          (await store.get(owner, documentId, second.id)).messages.find((m) => m.id === stale.messageId)?.status,
          'failed',
        );
        await store.finish(owner, documentId, second.id, next.messageId, 'completed', answer);
      });
    } finally {
      await db.query('delete from auth.users where id=any($1::uuid[])', [[owner, other]]);
      await db.close();
    }
  },
);
