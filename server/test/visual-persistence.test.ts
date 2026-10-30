import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { BoardItem, Doc, Step, Tour } from '../../shared/paper';
import type { ProgramItem } from '../../shared/program';
import type { AskAnswer, AskRequest } from '../src/harness/ask-types';
import { activeBoard, withVisualParameters } from '../src/visuals/persistence';
import { VisualArtifactService } from '../src/visuals/artifacts';
import { Database } from '../src/db';
import { DocumentService } from '../src/service';
import { ConversationStore } from '../src/conversations';
import { createApp } from '../src/app';
import { AnalysisWorker, type PreparedAnalysis } from '../src/worker';
import { TourWorker } from '../src/tour-worker';
import { HttpError } from '../src/errors';
import type { Config } from '../src/config';
import type { SettingsService } from '../src/settings';
import type { FileStorage } from '../src/storage';

const program: ProgramItem = {
  kind: 'program',
  title: 'Change the input',
  objective: 'See how the output changes with the input.',
  source: 'illustrative',
  sourceRefs: [],
  data: [{ name: 'observations', values: [1, 2] }],
  parameters: [{ name: 'gain', label: 'Gain', value: 1, min: 0, max: 3, step: 0.1 }],
  code: '({svg,params})=>svg.scene(svg.circle(100+params.gain*20,100,12))',
};
const boardStep = (id: string, item: BoardItem): Step => ({
  id,
  say: 'Change the input and compare the output.',
  actions: [
    { type: 'focus', target: 'page1' },
    { type: 'board', item },
  ],
});
const answer = (item: BoardItem): AskAnswer => ({
  answerable: 'yes',
  language: 'en-US',
  steps: [boardStep('answer-1', item)],
  followups: [],
});
const board = (step: Step) => {
  const action = step.actions.find((action) => action.type === 'board');
  assert(action?.type === 'board');
  return action;
};
const status = (expected: number) => (error: unknown) => error instanceof HttpError && error.status === expected;

test('live parameters use saved code, data and bounds while accepting only finite in-range numeric values', () => {
  const forged = {
    ...program,
    code: 'malicious()',
    data: [{ name: 'observations', values: [900] }],
    parameters: [{ ...program.parameters[0], value: 2, min: -100, max: 100 }],
  };
  const merged = withVisualParameters(program, forged) as ProgramItem;
  assert.equal(merged.code, program.code);
  assert.deepEqual(merged.data, program.data);
  assert.deepEqual(merged.parameters, [{ ...program.parameters[0], value: 2 }]);
  assert.equal(program.parameters[0].value, 1);
  assert.throws(
    () => withVisualParameters(program, { ...forged, parameters: [{ name: 'gain', value: 900 }] }),
    status(400),
  );
  assert.throws(
    () => withVisualParameters(program, { ...forged, parameters: [{ name: 'gain', value: '2' }] }),
    status(400),
  );
  assert.deepEqual(withVisualParameters(program, { ...forged, kind: 'formula' }), program);
  const steps: Step[] = [
    boardStep('one', program),
    { id: 'two', say: 'Read the paper.', actions: [{ type: 'board_clear' }] },
  ];
  assert.deepEqual(activeBoard(steps, 'one')?.item, program);
  assert.equal(activeBoard(steps), undefined);
});

test('registered artifact routes require authentication and authenticated questions accept bounded large snapshots', async () => {
  const documentId = randomUUID(),
    visualId = randomUUID();
  const received: unknown[] = [];
  const artifacts = {
    get: async (...args: unknown[]) => (received.push(args), { id: visualId, revision: 1 }),
  } as unknown as VisualArtifactService;
  const service = {
    ask: async (...args: unknown[]) => (received.push(args), { answerable: 'no', steps: [], followups: [] }),
  } as unknown as DocumentService;
  const app = await createApp({
    service,
    visualArtifacts: artifacts,
    authenticate: async (token) => (token === 'valid' ? 'owner' : null),
  });
  try {
    const url = `/api/documents/${documentId}/visuals/${visualId}/1`;
    assert.equal((await app.inject({ url })).statusCode, 401);
    assert.equal((await app.inject({ url, headers: { authorization: 'Bearer valid' } })).statusCode, 200);
    assert.deepEqual(received.pop(), ['owner', documentId, { id: visualId, revision: 1 }]);
    const large = { ...program, data: [{ name: 'observations', values: Array(15000).fill(12345) }] };
    assert.equal(
      (
        await app.inject({
          method: 'POST',
          url: `/api/documents/${documentId}/ask`,
          headers: { authorization: 'Bearer valid' },
          payload: { question: 'Explain the selected visual', activeVisual: large },
        })
      ).statusCode,
      200,
    );
  } finally {
    await app.close();
  }
});

test(
  'published tours and conversation revisions retain immutable owner-bound visual provenance',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = new Database(process.env.TEST_DATABASE_URL!);
    const owner = randomUUID(),
      other = randomUUID();
    const artifacts = new VisualArtifactService(db);
    const storage: FileStorage = {
      info: async () => ({ size: 8 }),
      download: async () => Buffer.from(''),
      upload: async () => {},
      sign: async () => '',
      remove: async () => {},
      list: async () => [],
    };
    const settings = {
      get: async () => ({ defaultModel: 'test-model' }),
      validateModel: async () => 'test-model',
    } as unknown as SettingsService;
    const service = new DocumentService(
      db,
      storage,
      async () => {},
      undefined,
      'test-model',
      undefined,
      settings,
      false,
      artifacts,
    );
    const config = {
      muse: {
        apiKey: 'test-only',
        baseUrl: 'https://never-called.invalid',
        model: 'test-model',
        language: 'en-US',
        timeoutMs: 1000,
      },
    } as Config;
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
    const tour: Tour = {
      schema: 'paper-tour/tour@0.1',
      title: 'An authored tour',
      paper: 'test',
      doc_sha256: doc.source.sha256,
      chapters: [{ id: 'first', title: 'First', steps: [boardStep('one', program), boardStep('two', program)] }],
    };
    const prepared: PreparedAnalysis = {
      doc,
      tour: null,
      sha: doc.source.sha256,
      folder: '',
      result: {
        parser_version: 'test',
        sha256: doc.source.sha256,
        page_count: 1,
        title: tour.title,
        status: 'ready',
        warnings: [],
        assets: [],
      },
    };
    const image = {
      targetId: 'page1',
      kind: 'page' as const,
      page: 1,
      label: 'Page 1',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    };
    const conversations = new ConversationStore(db);
    const seen: AskRequest[] = [];
    let reply = answer({ ...program, title: 'Changed visual' });
    Object.defineProperty(service, 'answer', {
      value: async (_owner: string, input: { request: AskRequest }) => {
        seen.push(structuredClone(input.request));
        return structuredClone(reply);
      },
    });
    try {
      await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [
        owner,
        `${owner}@example.test`,
        other,
        `${other}@example.test`,
      ]);
      const reserved = await service.reserve(owner, 'visual.pdf', 8);
      const documentId = reserved.documentId;
      const { analysisId } = await service.complete(owner, documentId);
      await db.transaction((tx) =>
        new AnalysisWorker(db, storage, config, async () => {}).publish(tx, documentId, analysisId, prepared, []),
      );
      const generationId = (await db.query('select id from tour_generations where analysis_id=$1', [analysisId]))
        .rows[0].id;
      const worker = new TourWorker(
        db,
        storage,
        config,
        { model: 'test-model', configured: true, generate: async () => ({ tour, metadata: {} }) },
        async () => [image],
      );
      await worker.generate(documentId, analysisId, generationId);
      const published = (
        await db.query(
          'select t.id,t.script,g.status from tours t join tour_generations g on g.id=t.generation_id where g.id=$1',
          [generationId],
        )
      ).rows[0];
      const sourceRef = board(published.script.chapters[0].steps[0]).artifact!;
      await t.test('ready publication attaches exact refs atomically and preserves generated source data', async () => {
        assert.equal(published.status, 'ready');
        assert(sourceRef);
        assert.deepEqual(Object.keys(sourceRef).sort(), ['id', 'revision']);
        assert.deepEqual(board(published.script.chapters[0].steps[1]).artifact, sourceRef);
        assert.equal(board(tour.chapters[0].steps[0]).artifact, undefined);
        const stored = await artifacts.get(owner, documentId, sourceRef);
        assert.equal(stored.analysisId, analysisId);
        assert.equal(stored.tourId, published.id);
        await assert.rejects(artifacts.get(other, documentId, sourceRef), status(404));
      });
      const thread = await conversations.create(owner, documentId, { context: { analysisId } });
      let first: AskAnswer;
      await t.test(
        'a question forks a tour visual, ignores forged code/data and saves final refs in its conversation',
        async () => {
          first = await service.ask(owner, documentId, {
            question: 'Change the gain',
            conversationId: thread.id,
            visualId: sourceRef.id,
            visualRevision: sourceRef.revision,
            activeVisual: { ...program, code: 'forged()', parameters: [{ ...program.parameters[0], value: 2 }] },
          });
          assert.equal((seen.at(-1)!.activeVisual as ProgramItem).code, program.code);
          assert.equal((seen.at(-1)!.activeVisual as ProgramItem).parameters[0].value, 2);
          const ref = board(first.steps[0]).artifact!;
          assert.notEqual(ref.id, sourceRef.id);
          const saved = await artifacts.get(owner, documentId, ref);
          assert.equal(saved.conversationId, thread.id);
          assert.deepEqual(saved.parent, sourceRef);
          assert.deepEqual(
            (await conversations.get(owner, documentId, thread.id)).messages.at(-1)!.answer!.steps,
            first.steps,
          );
        },
      );
      await t.test('same-thread changes append a revision while another thread forks that exact revision', async () => {
        const ref = board(first!.steps[0]).artifact!;
        reply = answer({ ...program, title: 'Second change' });
        const second = await service.ask(owner, documentId, {
          question: 'Change this again',
          conversationId: thread.id,
          visualId: ref.id,
          visualRevision: ref.revision,
        });
        const revised = board(second.steps[0]).artifact!;
        assert.equal(revised.id, ref.id);
        assert.equal(revised.revision, 2);
        assert.equal((await artifacts.get(owner, documentId, ref)).item.title, 'Changed visual');
        const otherThread = await conversations.create(owner, documentId, { context: { analysisId } });
        const fork = await service.ask(owner, documentId, {
          question: 'Explain this differently',
          conversationId: otherThread.id,
          visualId: revised.id,
          visualRevision: revised.revision,
        });
        const forked = board(fork.steps[0]).artifact!;
        assert.notEqual(forked.id, revised.id);
        assert.deepEqual((await artifacts.get(owner, documentId, forked)).parent, revised);
        assert.deepEqual(
          (await db.query('select script from tours where id=$1', [published.id])).rows[0].script,
          published.script,
        );
      });
      await t.test('questions reject stale analyses and partial visual refs before a model call', async () => {
        const anotherAnalysis = randomUUID();
        await db.query("insert into analyses(id,document_id,status,doc) values($1,$2,'ready',$3)", [
          anotherAnalysis,
          documentId,
          doc,
        ]);
        const stale = await artifacts.create(owner, documentId, { analysisId: anotherAnalysis, item: program });
        const before = seen.length;
        await assert.rejects(
          service.ask(owner, documentId, {
            question: 'Wrong version',
            conversationId: thread.id,
            visualId: stale.id,
            visualRevision: 1,
          }),
          status(409),
        );
        await assert.rejects(
          service.ask(owner, documentId, { question: 'Missing revision', visualId: sourceRef.id }),
          status(400),
        );
        assert.equal(seen.length, before);
      });
      await t.test(
        'a failed visual write rolls back every artifact and tour row before ready publication',
        async () => {
          const next = await service.generateTour(owner, documentId, true);
          const bad: Tour = {
            ...tour,
            chapters: [
              {
                ...tour.chapters[0],
                steps: [
                  boardStep('valid', { ...program, title: 'Would roll back' }),
                  boardStep('invalid', { ...program, code: '' }),
                ],
              },
            ],
          };
          const failing = new TourWorker(
            db,
            storage,
            config,
            { model: 'test-model', configured: true, generate: async () => ({ tour: bad, metadata: {} }) },
            async () => [image],
          );
          const before = (await db.query('select count(*) from visual_artifacts where document_id=$1', [documentId]))
            .rows[0].count;
          await failing.generate(documentId, analysisId, next.generation.id);
          assert.equal(
            (await db.query('select status from tour_generations where id=$1', [next.generation.id])).rows[0].status,
            'failed',
          );
          assert.equal(
            (await db.query('select id from tours where generation_id=$1', [next.generation.id])).rowCount,
            0,
          );
          assert.equal(
            (await db.query('select count(*) from visual_artifacts where document_id=$1', [documentId])).rows[0].count,
            before,
          );
        },
      );
    } finally {
      await db.query('delete from auth.users where id=any($1::uuid[])', [[owner, other]]);
      await db.close();
    }
  },
);
