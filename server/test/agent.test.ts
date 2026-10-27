import { reportedUsage } from '../../shared/activity';
import { createMuseTourGenerator } from '../src/muse/generator';
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
  name,
  arguments: JSON.stringify(args),
  call_id: id,
});
const result = (id: string, output: unknown[]) => ({
  id,
  status: 'completed',
  output,
  usage: { input_tokens: 3000, output_tokens: 100, total_tokens: 3100, input_tokens_details: { cached_tokens: 2048 } },
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), { headers: { 'content-type': 'application/json' } });

test('Responses streams text, tool arguments and stored response IDs with real usage', async () => {
  const events = [
    { type: 'response.created', response: { id: 'r1' } },
    { type: 'response.function_call_arguments.delta', delta: '{"ids":' },
    { type: 'response.output_text.delta', delta: '["fig1"]}' },
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
  assert.equal(observer.deltas.join(''), '{"ids":["fig1"]}');
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
      else if (b.input[0].type === 'message')
        output = [
          call('view_visuals', { ids: ['page1', 'fig1'] }, 'view-' + counter),
          call(
            'set_tour_plan',
            { title: 'Bars tour', chapters: [{ id: 'results', title: 'Results' }] },
            'plan-' + counter,
          ),
        ];
      else if (b.input.some((i: any) => i.call_id.startsWith('view-')))
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
        await new TourWorker(db, storage, c, createMuseTourGenerator(muse), images).reconcile(enqueue, f.id);
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
