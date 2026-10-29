import { reportedUsage } from '../../shared/activity';
import { createTourGenerator } from '../src/generation/generator';
import { createApp } from '../src/app';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Database } from '../src/db';
import { DocumentService, type Enqueue } from '../src/service';
import { SettingsService } from '../src/settings';
import { TourWorker, ensureTourGeneration } from '../src/tour-worker';
import { PaperAgent } from '../src/agent/runner';
import { ResponsesClient, responseUsage } from '../src/agent/responses';
import { executeTool, type RunState } from '../src/agent/tools';
import { config, type Config } from '../src/config';
import type { FileStorage } from '../src/storage';
import type { Doc } from '../../shared/paper';

const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test', title: 'Bars' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  blocks: [
    {
      id: 'p1.b1',
      page: 1,
      type: 'paragraph',
      bbox: [0, 0, 100, 100],
      text: 'The blue bar is larger.',
      sentences: ['p1.s1'],
    },
  ],
  sentences: [{ id: 'p1.s1', page: 1, block: 'p1.b1', text: 'The blue bar is larger.', rects: [[0, 0, 100, 20]] }],
  figures: [
    {
      id: 'fig1',
      kind: 'figure',
      number: '1',
      page: 1,
      bbox: [0, 100, 200, 300],
      caption: 'Blue and red bars',
      image: 'figures/fig1.png',
      panels: [],
      referenced_by: ['p1.s1'],
    },
  ],
  equations: [],
};
const chapter = {
  id: 'results',
  title: 'Results',
  steps: [
    {
      id: 'bars',
      source: 'fig1',
      say: 'The blue bar is larger than the red bar.',
      evidence: ['p1.s1', 'fig1'],
      actions: [
        { type: 'zoom', target: 'fig1', at_word: 0 },
        { type: 'box', target: 'fig1' },
        { type: 'highlight', targets: ['p1.s1'] },
      ],
    },
  ],
};
const muse = {
  apiKey: 'test-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en-US',
  timeoutMs: 5000,
};
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=';
const call = (name: string, args: unknown, id = name) => ({
  type: 'function_call',
  id: `fc_${id}`,
  status: 'completed',
  name,
  arguments: JSON.stringify(args),
  call_id: id,
});
const result = (id: string, output: unknown[]) => ({
  id,
  status: 'completed',
  created_at: 1,
  model: 'muse-spark-1.3',
  output,
  usage: { input_tokens: 3000, output_tokens: 100, total_tokens: 3100, input_tokens_details: { cached_tokens: 2048 } },
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('Responses streams text, tool arguments and stored response IDs with real usage', async () => {
  const events = [
    { type: 'response.created', response: { id: 'r1', created_at: 1, model: 'muse-spark-1.3' } },

    {
      type: 'response.output_item.added',
      output_index: 0,
      item: { id: 'fc_tool1', type: 'function_call', call_id: 'tool1', name: 'view_visuals', arguments: '' },
    },
    { type: 'response.function_call_arguments.delta', item_id: 'fc_tool1', output_index: 0, delta: '{"ids":["fig1"]}' },
    { type: 'response.output_item.done', output_index: 0, item: call('view_visuals', { ids: ['fig1'] }, 'tool1') },
    { type: 'response.output_item.added', output_index: 1, item: { type: 'message', id: 'msg1' } },
    { type: 'response.output_text.delta', item_id: 'msg1', output_index: 1, delta: 'Inspecting the figure.' },
    { type: 'response.completed', response: result('r1', [call('view_visuals', { ids: ['fig1'] })]) },
  ];
  const requests: any[] = [];
  const observer = { ids: [] as string[], deltas: [] as string[] };
  const transport: typeof fetch = async (url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return String(url).endsWith('/input_tokens')
      ? json({ input_tokens: 123 })
      : new Response(events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join(''), {
          headers: { 'content-type': 'text/event-stream' },
        });
  };
  const client = new ResponsesClient(muse, transport);
  assert.equal(await client.count({ input: 'x', previous_response_id: 'root', max_output_tokens: 500 }), 123);
  const response = await client.create(
    { input: 'x', previous_response_id: 'root' },
    {
      created: async (id) => {
        observer.ids.push(id);
      },
      delta: async (delta) => {
        observer.deltas.push(delta);
      },
    },
  );
  assert.deepEqual(observer.ids, ['r1']);
  assert.equal(observer.deltas.join(''), 'Inspecting the figure.');
  assert.equal(requests[0].max_output_tokens, undefined);
  assert.equal(requests[1].previous_response_id, 'root');
  assert.equal(requests[1].store, true);
  assert.equal(responseUsage(response).cachedInputTokens, 2048);
});
test('recent history visibility errors retry token counting without generating', async () => {
  let attempts = 0;
  const client = new ResponsesClient(muse, async (url) => {
    assert.match(String(url), /input_tokens$/);
    attempts++;
    return attempts === 1
      ? new Response(JSON.stringify({ error: { message: 'referenced response not found or expired' } }), {
          status: 400,
        })
      : json({ input_tokens: 42 });
  });
  assert.equal(await client.count({ input: 'next', previous_response_id: 'recent' }), 42);
  assert.equal(attempts, 2);
});
test('tool sources require an image delivered in a previous turn', async () => {
  const state: RunState = { plan: [], chapters: {}, observations: {}, presented: {} };
  const scope = {
    owner: 'x',
    documentId: 'x',
    analysisId: 'x',
    doc,
    visuals: [{ targetId: 'fig1', kind: 'figure' as const, page: 1, label: 'Bars', sha256: 'hash', storagePath: 'x' }],
    language: 'en',
    availableSources: [],
    service: {} as DocumentService,
  };
  const view = await executeTool(scope, state, 'view_visuals', { ids: ['fig1'] });
  await assert.rejects(
    () =>
      executeTool(scope, view.state, 'record_visual_observations', {
        observations: [{ sourceId: 'fig1', description: 'Bars', readable: true, uncertainties: [] }],
      }),
    /Inspect/,
  );
  await assert.rejects(() => executeTool(scope, state, 'view_visuals', { ids: ['foreign'] }), /Unknown/);
});

test('JSON-encoded chapters retain all validation and save without a model retry', async () => {
  const state: RunState = {
    plan: [{ id: chapter.id, title: chapter.title }],
    chapters: {},
    observations: {},
    presented: {},
  };
  const scope = {
    owner: 'x',
    documentId: 'x',
    analysisId: 'x',
    doc,
    visuals: [],
    language: 'en',
    service: {} as DocumentService,
  };
  const saved = await executeTool(scope, state, 'upsert_tour_chapter', { chapter: JSON.stringify(chapter) });
  assert.equal(saved.state.chapters.results.steps.length, 1);
  assert.deepEqual(state.chapters, {});
  const mistimed = structuredClone(chapter) as any;
  mistimed.steps[0].actions[0] = { type: 'zoom', target: 'fig1', at_phrase: 'absent words' };
  const repaired = await executeTool(scope, state, 'upsert_tour_chapter', { chapter: mistimed });
  assert.equal(repaired.state.chapters.results.steps[0].actions[0].at_word, 0);
  assert.equal((repaired.output as any).timingAdjustments.length, 1);

  await assert.rejects(() => executeTool(scope, state, 'upsert_tour_chapter', { chapter: '{bad' }), /malformed/);
  await assert.rejects(
    () =>
      executeTool(scope, state, 'upsert_tour_chapter', {
        chapter: JSON.stringify({ ...chapter, steps: [{ ...chapter.steps[0], source: 'invented' }] }),
      }),
    (error: any) => error.problems?.some((problem: string) => problem.includes('unknown document element')),
  );
});

test(
  'durable agent lifecycle, continuation, scoped tools and checkpoints',
  { skip: !process.env.TEST_DATABASE_URL },
  async (t) => {
    const db = new Database(process.env.TEST_DATABASE_URL!);
    const owner = randomUUID(),
      other = randomUUID();
    const jobs: any[] = [];
    const enqueue: Enqueue = async (kind, data) => {
      jobs.push({ kind, ...data });
    };
    const files = new Map<string, Buffer>();
    const storage: FileStorage = {
      info: async (p) => (files.has(p) ? { size: files.get(p)!.length } : null),
      download: async (p) => files.get(p)!,
      upload: async (p, b) => {
        files.set(p, b);
      },
      sign: async (p) => 'https://storage.invalid/' + p,
      remove: async () => {},
      list: async () => [],
    };
    const c = {
      ...config(),
      muse,
      agent: { enabled: true, maxTurns: 64, maxOutputTokens: 128000, maxRuntimeMs: 1200000 },
    } as Config;
    const settings = new SettingsService(db, muse);
    const service = new DocumentService(db, storage, enqueue, 26214400, muse.model, undefined, settings, true);
    await db.query('insert into auth.users(id,email) values($1,$2),($3,$4)', [
      owner,
      owner + '@test.example',
      other,
      other + '@test.example',
    ]);
    const fixture = async () => {
      const id = randomUUID(),
        analysis = randomUUID();
      await db.query(
        "insert into documents(id,owner_id,title,original_filename,upload_path,upload_size,file_status) values($1,$2,'Bars','bars.pdf',$3,8,'uploaded')",
        [id, owner, owner + '/' + id + '/original.pdf'],
      );
      await db.query("insert into analyses(id,document_id,status,doc) values($1,$2,'ready',$3)", [analysis, id, doc]);
      await db.query('update documents set current_analysis_id=$2 where id=$1', [id, analysis]);
      const g = await db.transaction((tx) =>
        ensureTourGeneration(tx, enqueue, id, analysis, muse.model, false, false, 'agent'),
      );
      return { id, analysis, g, run: g.agent_run_id as string };
    };
    const images = async () => [
      { targetId: 'page1', kind: 'page' as const, page: 1, label: 'Page 1', dataUrl: png },
      { targetId: 'fig1', kind: 'figure' as const, page: 1, label: 'Bars', dataUrl: png },
    ];
    const requests: any[] = [];
    let counter = 0;
    let onPost: (() => Promise<void>) | undefined;
    let mode: 'normal' | 'disconnect' | 'unknown' | 'failed' = 'normal';
    let contextSize = 10000;
    const transport: typeof fetch = async (url, init) => {
      const path = String(url);
      if (path.endsWith('/input_tokens')) return json({ input_tokens: contextSize });
      if (!init?.body) return json(result('recovered', []));
      const b = JSON.parse(String(init.body));
      requests.push(b);
      counter++;
      if (onPost) {
        const hook = onPost;
        onPost = undefined;
        await hook();
      }
      if (mode === 'failed') return json({ id: 'failed', status: 'failed', output: [] });
      if (mode === 'unknown') throw new TypeError('Network disconnected');
      if (mode === 'disconnect')
        return new Response(
          'data: ' + JSON.stringify({ type: 'response.created', response: { id: 'stored' } }) + '\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      let output: unknown[];
      if (!b.previous_response_id) output = [];
      else if (!b.input.some((item: any) => item.type === 'function_call_output'))
        output = [
          call('view_visuals', { ids: ['page1', 'fig1'] }, 'view-' + counter),
          call(
            'set_tour_plan',
            { title: 'Bars tour', chapters: [{ id: 'results', title: 'Results' }] },
            'plan-' + counter,
          ),
        ];
      else if (b.input.some((i: any) => i.call_id?.startsWith('view-')))
        output = [
          call(
            'record_visual_observations',
            {
              observations: ['page1', 'fig1'].map((sourceId) => ({
                sourceId,
                components: [],
                description: 'Blue bar is larger.',
                readable: true,
                uncertainties: [],
              })),
            },
            'observe-' + counter,
          ),
          call('upsert_tour_chapter', { chapter }, 'chapter-' + counter),
        ];
      else output = [call('finish_tour', {}, 'finish-' + counter)];
      return json(result('resp-' + counter, output));
    };
    const agent = new PaperAgent(db, storage, c, enqueue, settings, images, transport);
    async function drive(run: string, n = 8) {
      for (let i = 0; i < n; i++) {
        const r = await service.agentRun(
          owner,
          (
            await db.query(
              'select document_id from tour_generations g join agent_runs r on r.generation_id=g.id where r.id=$1',
              [run],
            )
          ).rows[0].document_id,
          run,
        );
        if (['paused', 'completed', 'cancelled'].includes(r.status)) return r;
        await agent.turn(run);
      }
      return (await db.query('select * from agent_runs where id=$1', [run])).rows[0];
    }
    try {
      await t.test(
        'one paper upload supports incremental image tools, chronological publishing and a shared root',
        async () => {
          const f = await fixture();
          const done = await drive(f.run);
          assert.equal(done.status, 'completed', done.reason);
          assert.equal(requests.length, 4);
          assert.match(JSON.stringify(requests[0]), /PAPER SOURCE/);
          assert(requests.slice(1).every((r) => !JSON.stringify(r.input).includes('PAPER SOURCE')));
          assert.match(JSON.stringify(requests[2].input), /data:image\/(jpeg|png);base64/);
          assert.equal(
            (await db.query('select count(*) from tours where generation_id=$1', [f.g.id])).rows[0].count,
            '1',
          );
          await agent.turn(f.run);
          assert.equal(requests.length, 4);
          const newGeneration = await db.transaction((tx) =>
            ensureTourGeneration(tx, enqueue, f.id, f.analysis, muse.model, false, true, 'agent'),
          );
          await drive(newGeneration.agent_run_id);
          assert.equal(requests.length, 7);
          assert.equal(requests[4].previous_response_id, 'resp-1');
          const trace = await service.activity(owner, f.id, newGeneration.id, '0');
          assert(trace.events.some((e) => e.type === 'inspection.reused'));
          await assert.rejects(() => service.controlAgent(other, f.id, f.run, 'cancel'), /not found/i);
        },
      );
      await t.test(
        'pause and cancel preserve checkpoints, and known response IDs recover without a second POST',
        async () => {
          const f = await fixture();
          mode = 'disconnect';
          await agent.turn(f.run);
          assert.equal((await service.agentRun(owner, f.id, f.run)).status, 'paused');
          const posts = requests.length;
          mode = 'normal';
          await service.controlAgent(owner, f.id, f.run, 'resume');
          await agent.turn(f.run);
          assert.equal(requests.length, posts);
          assert.equal(
            (
              await db.query(
                'select root_response_id from paper_sessions where id=(select session_id from agent_runs where id=$1)',
                [f.run],
              )
            ).rows[0].root_response_id,
            'recovered',
          );
          await service.controlAgent(owner, f.id, f.run, 'pause');
          await agent.turn(f.run);
          assert.equal(requests.length, posts);
          await service.controlAgent(owner, f.id, f.run, 'cancel');
          await agent.turn(f.run);
          assert.equal((await service.agentRun(owner, f.id, f.run)).status, 'cancelled');
        },
      );
      await t.test('budgets pause with durable work and explicit resume grants a new budget segment', async () => {
        const f = await fixture();
        const bounded = new PaperAgent(
          db,
          storage,
          { ...c, agent: { ...c.agent!, maxTurns: 1 } },
          enqueue,
          settings,
          images,
          transport,
        );
        await bounded.turn(f.run);
        await bounded.turn(f.run);
        assert.equal((await service.agentRun(owner, f.id, f.run)).status, 'paused');
        await service.controlAgent(owner, f.id, f.run, 'resume');
        await bounded.turn(f.run);
        assert.equal((await service.agentRun(owner, f.id, f.run)).turns, 2);
      });
      await t.test('unknown provider dispatch pauses and never automatically repeats a paid request', async () => {
        const f = await fixture();
        mode = 'unknown';
        await agent.turn(f.run);
        mode = 'normal';
        const posts = requests.length;
        await agent.reconcile();
        await agent.turn(f.run);
        assert.equal(requests.length, posts);
        assert.equal((await service.agentRun(owner, f.id, f.run)).status, 'paused');
        await service.controlAgent(owner, f.id, f.run, 'resume');
        await agent.turn(f.run);
        assert.equal(requests.length, posts + 1);
      });
      await t.test('context rollover branches from the source root and retains saved artifacts', async () => {
        const f = await fixture();
        await agent.turn(f.run);
        const root = (await db.query('select head_response_id from agent_runs where id=$1', [f.run])).rows[0]
          .head_response_id;
        contextSize = 900000;
        await agent.turn(f.run);
        contextSize = 10000;
        const checkpoint = (await db.query('select input from agent_steps where run_id=$1 and step=1', [f.run])).rows[0]
          .input;
        assert.match(JSON.stringify(checkpoint), /Resume from this verified checkpoint/);
        await agent.turn(f.run);
        assert.equal(requests.at(-1).previous_response_id, root);
        assert.match(JSON.stringify(requests.at(-1).input), /Resume from this verified checkpoint/);
      });
      for (const rejectAt of ['count', 'create'] as const) {
        await t.test(
          `missing provider history during ${rejectAt} replays committed tools and preserves visual evidence`,
          async () => {
            const f = await fixture();
            await agent.turn(f.run); // Source root.
            await agent.turn(f.run); // View visuals and save plan.
            const before = (await db.query('select state from agent_runs where id=$1', [f.run])).rows[0].state;
            const accepted: any[] = [];
            const missing = () =>
              new Response(JSON.stringify({ error: { code: 'response_not_found', param: 'previous_response_id' } }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' },
              });
            const fallbackTransport: typeof fetch = async (url, init) => {
              const body = init?.body ? JSON.parse(String(init.body)) : {};
              if (String(url).endsWith('/input_tokens'))
                return body.previous_response_id && rejectAt === 'count' ? missing() : json({ input_tokens: 10000 });
              if (body.previous_response_id) return missing();
              accepted.push(body);
              assert.match(JSON.stringify(body.input), /data:image\/(jpeg|png);base64/);
              assert(body.input.some((item: any) => item.type === 'function_call' && item.name === 'view_visuals'));
              assert(body.input.some((item: any) => item.type === 'function_call_output'));
              const output =
                accepted.length === 1
                  ? [
                      call(
                        'record_visual_observations',
                        {
                          observations: ['page1', 'fig1'].map((sourceId) => ({
                            sourceId,
                            description: 'Blue bar is larger.',
                            readable: true,
                            uncertainties: [],
                            components: [],
                          })),
                        },
                        'local-observe',
                      ),
                      call('upsert_tour_chapter', { chapter }, 'local-chapter'),
                    ]
                  : [call('finish_tour', {}, 'local-finish')];
              return json(result('local-' + accepted.length, output));
            };
            const fallback = new PaperAgent(
              db,
              storage,
              { ...c, muse: { ...muse, timeoutMs: 15000 } },
              enqueue,
              settings,
              images,
              fallbackTransport,
            );
            await fallback.turn(f.run); // Explicit history rejection; no inference accepted.
            const recovered = (await db.query('select state,status from agent_runs where id=$1', [f.run])).rows[0];
            assert.equal(recovered.state.historyMode, 'local');
            assert.deepEqual(recovered.state.presented, before.presented);
            assert.deepEqual(recovered.state.plan, before.plan);
            assert.equal(recovered.status, 'queued');
            assert.equal(accepted.length, 0);
            await fallback.turn(f.run);
            const saved = (await db.query('select state from agent_runs where id=$1', [f.run])).rows[0].state;
            assert.equal(Object.keys(saved.observations).length, 2);
            assert.equal(Object.keys(saved.chapters).length, 1);
            await fallback.turn(f.run);
            assert.equal((await service.agentRun(owner, f.id, f.run)).status, 'completed');
            assert.equal(accepted.length, 2);
            assert.equal(
              (await db.query('select count(*) from tours where generation_id=$1', [f.g.id])).rows[0].count,
              '1',
            );
            const trace = await service.activity(owner, f.id, f.g.id, '0');
            assert.equal(
              trace.events.filter((e) => e.type === 'tool.started' && e.data.name === 'view_visuals').length,
              1,
            );
            assert.equal(trace.events.filter((e) => e.type === 'context.reset').length, 0);
            assert(trace.events.some((e) => e.type === 'context.fallback'));
            const preparedRequest = trace.events.find(
              (event) => event.type === 'model.prepared' && event.data.historyMode === 'local',
            );
            assert(preparedRequest, 'Record the actual local request after replay');
            assert.equal(preparedRequest.data.previousResponseId, null);
            const recordedInput = JSON.stringify(preparedRequest.data.messages);
            assert.match(recordedInput, /WORKFLOW CHECKPOINT/);
            assert.match(recordedInput, /storagePath/);
            assert(!recordedInput.includes('data:image/'), 'Keep hydrated image payloads out of diagnostics');
            assert(Array.isArray(preparedRequest.data.tools));
          },
        );
      }
      await t.test('a missing result for an already dispatched response pauses without another POST', async () => {
        const f = await fixture();
        mode = 'disconnect';
        await agent.turn(f.run);
        mode = 'normal';
        const posts = requests.length;
        await service.controlAgent(owner, f.id, f.run, 'resume');
        const retrieveMissing: typeof fetch = async (_url, init) => {
          assert.equal(init?.body, undefined);
          return new Response(JSON.stringify({ error: { code: 'response_not_found' } }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        };
        await new PaperAgent(
          db,
          storage,
          { ...c, muse: { ...muse, timeoutMs: 15000 } },
          enqueue,
          settings,
          images,
          retrieveMissing,
        ).turn(f.run);
        const stopped = await service.agentRun(owner, f.id, f.run);
        assert.equal(stopped.status, 'paused');
        assert.match(stopped.reason!, /outcome is unknown/);
        assert.equal(requests.length, posts);
        const step = (await db.query('select status,response_id from agent_steps where run_id=$1 and step=0', [f.run]))
          .rows[0];
        assert.equal(step.response_id, 'stored');
        assert.equal(step.status, 'dispatching');
      });
      await t.test('repeated unchanged tool actions pause and explicit resume resets the guard', async () => {
        const f = await fixture();
        await agent.turn(f.run);
        await agent.turn(f.run);
        let calls = 0;
        const loopingTransport: typeof fetch = async (url) => {
          if (String(url).endsWith('/input_tokens')) return json({ input_tokens: 10000 });
          calls++;
          return json(
            result('loop-response-' + calls, [call('search_paper', { query: 'blue bar' }, 'loop-search-' + calls)]),
          );
        };
        const looping = new PaperAgent(db, storage, c, enqueue, settings, images, loopingTransport);
        for (let i = 0; i < 6; i++) {
          await looping.turn(f.run);
          if ((await service.agentRun(owner, f.id, f.run)).status === 'paused') break;
        }
        const stopped = await service.agentRun(owner, f.id, f.run);
        assert.equal(stopped.status, 'paused');
        assert.match(stopped.reason!, /^no_progress:/);
        assert.equal(calls, 4); // First turn delivered new images, then three ineffective repetitions.
        const state = (await db.query('select state from agent_runs where id=$1', [f.run])).rows[0].state;
        assert.equal(state.plan.length, 1);
        await looping.turn(f.run);
        assert.equal(calls, 4);
        await service.controlAgent(owner, f.id, f.run, 'resume');
        await looping.turn(f.run);
        assert.equal(calls, 5);
        assert.notEqual((await service.agentRun(owner, f.id, f.run)).status, 'paused');
      });
      await t.test('credential rotation pauses before dispatch and explicitly starts a fresh session', async () => {
        const f = await fixture();
        await agent.turn(f.run);
        const before = await service.agentRun(owner, f.id, f.run),
          posts = requests.length;
        await db.query('update user_settings set credential_version=$2 where owner_id=$1', [owner, randomUUID()]);
        await agent.turn(f.run);
        assert.equal(requests.length, posts);
        assert.equal((await service.agentRun(owner, f.id, f.run)).reason, 'credentials_changed');
        await service.controlAgent(owner, f.id, f.run, 'resume');
        await agent.turn(f.run);
        assert.notEqual((await service.agentRun(owner, f.id, f.run)).sessionId, before.sessionId);
        assert.equal(requests.at(-1).previous_response_id, undefined);
      });
      await t.test('a missing personal key never falls back to the server key', async () => {
        const f = await fixture(),
          posts = requests.length;
        await db.query("update user_settings set credential_source='personal',secret_id=null where owner_id=$1", [
          owner,
        ]);
        try {
          await agent.turn(f.run);
          assert.equal(requests.length, posts);
          assert.equal((await service.agentRun(owner, f.id, f.run)).status, 'paused');
        } finally {
          await db.query("update user_settings set credential_source='app' where owner_id=$1", [owner]);
        }
      });
      await t.test('startup and repeated creation retain a run awaiting credentials', async () => {
        const f = await fixture();
        await db.query("update agent_runs set status='paused' where id=$1", [f.run]);
        await db.query("update tour_generations set status='needs_configuration' where id=$1", [f.g.id]);
        const before = jobs.length;
        await new TourWorker(db, storage, c, createTourGenerator(muse, 'deep'), images).reconcile(enqueue, f.id);
        assert.equal(jobs.length, before);
        assert.equal((await service.generateTour(owner, f.id)).generation.agentRunId, f.run);
        assert.equal(
          (await db.query('select count(*) from tour_generations where document_id=$1', [f.id])).rows[0].count,
          '1',
        );
      });
      await t.test('run endpoints and streamed journal enforce owner and document scope', async () => {
        const f = await fixture(),
          foreign = await fixture();
        await service.controlAgent(owner, f.id, f.run, 'pause');
        const app = await createApp({
          service,
          authenticate: async (token) => (token === 'owner' ? owner : token === 'other' ? other : null),
        });
        const path = `/api/documents/${f.id}/agent-runs/${f.run}`,
          headers = { authorization: 'Bearer owner' };
        try {
          assert.equal((await app.inject({ method: 'GET', url: path })).statusCode, 401);
          assert.equal(
            (await app.inject({ method: 'GET', url: path, headers: { authorization: 'Bearer other' } })).statusCode,
            404,
          );
          assert.equal(
            (await app.inject({ method: 'GET', url: path.replace(f.id, foreign.id), headers })).statusCode,
            404,
          );
          assert.equal(
            (await app.inject({ method: 'POST', url: path + '/resume', headers: { authorization: 'Bearer other' } }))
              .statusCode,
            404,
          );
          const stream = await app.inject({ method: 'GET', url: path + '/events', headers });
          assert.equal(stream.statusCode, 200);
          assert.match(stream.body, /run.control/);
          assert.equal(
            (await app.inject({ method: 'POST', url: path + '/cancel', headers })).json().status,
            'cancelled',
          );
        } finally {
          await app.close();
        }
      });
      await t.test('deletion during a model call prevents publishing a late result', async () => {
        const f = await fixture();
        onPost = async () => {
          await service.remove(owner, f.id);
        };
        await agent.turn(f.run);
        assert.equal((await db.query('select count(*) from tours where document_id=$1', [f.id])).rows[0].count, '0');
        await assert.rejects(() => service.agentRun(owner, f.id, f.run), /not found/i);
      });
      await t.test('orphaned running turns retain their response ID and account for elapsed budget', async () => {
        const f = await fixture();
        mode = 'disconnect';
        await agent.turn(f.run);
        mode = 'normal';
        const posts = requests.length;
        await db.query("update agent_runs set status='running' where id=$1", [f.run]);
        await db.query(
          "update agent_events set created_at=now()-interval '21 minutes' where agent_run_id=$1 and type='model.started'",
          [f.run],
        );
        await agent.turn(f.run);
        assert.equal((await service.agentRun(owner, f.id, f.run)).status, 'paused');
        assert.equal(requests.length, posts);
        await service.controlAgent(owner, f.id, f.run, 'resume');
        await agent.turn(f.run);
        assert.equal(requests.length, posts);
        assert.equal((await service.agentRun(owner, f.id, f.run)).status, 'queued');
      });
      await t.test('missing provider usage remains unknown and failed responses stay visibly failed', async () => {
        const f = await fixture();
        mode = 'failed';
        await agent.turn(f.run);
        mode = 'normal';
        const trace = await service.activity(owner, f.id, f.g.id, '0');
        assert(trace.events.some((event) => event.type === 'model.failed' && event.data.usageUnavailable === true));
        assert.equal(reportedUsage(trace.events).size, 0);
        assert.equal((await service.agentRun(owner, f.id, f.run)).status, 'paused');
      });
      await t.test('private agent journals are not accessible via Supabase client roles', async () => {
        for (const table of [
          'paper_sessions',
          'agent_runs',
          'agent_steps',
          'agent_tool_calls',
          'agent_events',
          'visual_observation_cache',
        ])
          await assert.rejects(
            () =>
              db.transaction(async (tx) => {
                await tx.query('set local role authenticated');
                await tx.query('select * from ' + table);
              }),
            /permission denied/,
          );
      });
    } finally {
      await db.query('delete from documents where owner_id=$1', [owner]);
      await db.query('delete from auth.users where id=any($1::uuid[])', [[owner, other]]);
      await db.close();
    }
  },
);

test('omitted uncertainty notes do not discard a 22-image observation batch or assert certainty', async () => {
  const ids = Array.from({ length: 22 }, (_, i) => `source${i}`);
  const state: RunState = {
    plan: [],
    chapters: {},
    observations: {},
    presented: Object.fromEntries(ids.map((id) => [id, 'hash'])),
  };
  const scope = {
    owner: 'owner',
    documentId: 'doc',
    analysisId: 'analysis',
    doc,
    visuals: ids.map((targetId) => ({
      targetId,
      kind: 'page' as const,
      page: 1,
      label: targetId,
      sha256: 'hash',
      storagePath: targetId,
    })),
    language: 'en',
    availableSources: ids,
    service: {} as DocumentService,
  };
  const observations = ids.map((sourceId) => ({
    sourceId,
    description: 'The visual contains a chart.',
    readable: true,
  }));
  const result = await executeTool(scope, state, 'record_visual_observations', { observations });
  assert.equal(Object.keys(result.state.observations).length, 22);
  assert.deepEqual(result.state.observations.source0, {
    ...observations[0],
    uncertainties: [],
    uncertaintiesReported: false,
  });
  const stated = await executeTool(scope, result.state, 'record_visual_observations', {
    observations: [{ ...observations[0], uncertainties: ['Axis label is unreadable.'] }],
  });
  const repeated = await executeTool(scope, stated.state, 'record_visual_observations', {
    observations: [observations[0]],
  });
  assert.deepEqual((repeated.state.observations.source0 as any).uncertainties, ['Axis label is unreadable.']);
  assert.equal((repeated.state.observations.source0 as any).uncertaintiesReported, true);
  await assert.rejects(
    () =>
      executeTool(scope, state, 'record_visual_observations', {
        observations: [{ ...observations[0], uncertainties: 'none' }],
      }),
    /Invalid tool arguments/,
  );
  await assert.rejects(
    () => executeTool({ ...scope, availableSources: [] }, state, 'record_visual_observations', { observations }),
    /Inspect/,
  );
  await assert.rejects(
    () =>
      executeTool(scope, state, 'record_visual_observations', { observations: [{ sourceId: ids[0], readable: true }] }),
    /description/,
  );
});

test('visual component corrections preserve other inspected parts and can explicitly replace them', async () => {
  const state: RunState = { plan: [], chapters: {}, observations: {}, presented: { fig1: 'hash' } };
  const scope = {
    owner: 'owner',
    documentId: 'doc',
    analysisId: 'analysis',
    doc,
    language: 'en',
    availableSources: ['fig1'],
    service: {} as DocumentService,
    visuals: [
      { targetId: 'fig1', kind: 'figure' as const, page: 1, label: 'Bars', sha256: 'hash', storagePath: 'fig1' },
    ],
  };
  const observe = (state: RunState, values: Record<string, unknown>) =>
    executeTool(scope, state, 'record_visual_observations', {
      observations: [{ sourceId: 'fig1', description: 'Two bars.', readable: true, uncertainties: [], ...values }],
    });
  const blue = { label: 'Blue bar', region: [0, 0, 0.3, 0.8] },
    red = { label: 'Red bar', region: [0.6, 0, 0.9, 0.4] };
  const first = await observe(state, { components: [blue, red] });
  const correction = { ...blue, region: [0.1, 0, 0.3, 0.8] };
  const updated = await observe(first.state, { components: [correction] });
  assert.deepEqual((updated.state.observations.fig1 as any).components, [correction, red]);
  assert.deepEqual((first.state.observations.fig1 as any).components, [blue, red], 'input checkpoint stays immutable');
  const repeated = await observe(updated.state, { components: [correction] });
  assert.deepEqual(repeated.state, updated.state, 'repeated corrections do not duplicate components');
  const empty = await observe(updated.state, { components: [] });
  assert.deepEqual((empty.state.observations.fig1 as any).components, [correction, red]);
  const replaced = await observe(updated.state, { components: [red], replaceComponents: true });
  assert.deepEqual((replaced.state.observations.fig1 as any).components, [red]);
  assert.equal(Object.hasOwn(replaced.state.observations.fig1 as object, 'replaceComponents'), false);
  await assert.rejects(() => observe(updated.state, { replaceComponents: true }), /components/);
  const full = await observe(updated.state, {
    replaceComponents: true,
    components: Array.from({ length: 24 }, (_, i) => ({ ...blue, label: `Part ${i}` })),
  });
  await assert.rejects(() => observe(full.state, { components: [red] }), /at most 24/);
  assert.equal(
    (full.state.observations.fig1 as any).components.length,
    24,
    'failed correction leaves checkpoint intact',
  );
});
