import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import type { Doc } from '../../shared/paper';
import type { Database } from '../src/db';
import type { Config } from '../src/config';
import type { FileStorage } from '../src/storage';
import type { SettingsService } from '../src/settings';
import type { MuseClient } from '../src/muse/client';
import type { TourDraft } from '../src/muse/schema';
import { PaperAgent } from '../src/agent/runner';
import type { RunState, ToolScope } from '../src/agent/tools';
import { AGENT_INSTRUCTIONS, AGENT_VERSION } from '../src/agent/instructions';
import {
  authoredChapterAudits,
  assertReviewedState,
  prepareReviewedChapter,
  reviewedAudits,
  visualAuditHash,
} from '../src/agent/chapter-visuals';
import { attention } from './fixtures/authored-visuals';

const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test', title: 'Scaling' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  blocks: [
    {
      id: 'p1.b1',
      page: 1,
      type: 'paragraph',
      bbox: [0, 0, 100, 100],
      text: 'Scaling spreads attention weights.',
      sentences: ['p1.s1'],
    },
  ],
  sentences: [
    { id: 'p1.s1', page: 1, block: 'p1.b1', text: 'Scaling spreads attention weights.', rects: [[0, 0, 100, 20]] },
  ],
  figures: [
    {
      id: 'fig1',
      kind: 'figure',
      number: '1',
      page: 1,
      bbox: [0, 100, 200, 300],
      caption: 'Attention weights',
      image: 'figures/fig1.png',
      panels: [],
      referenced_by: ['p1.s1'],
    },
  ],
  equations: [],
};
const chapter: TourDraft['chapters'][number] = {
  id: 'scaling',
  title: 'Scaling',
  steps: [
    {
      id: 'weights',
      source: 'fig1',
      say: 'This illustrative example shows how scaling spreads attention weights and changes the mixture of the two values.',
      evidence: ['p1.s1', 'fig1'],
      actions: [
        { type: 'zoom', target: 'fig1', at_word: 0 },
        { type: 'box', target: 'fig1' },
        { type: 'highlight', targets: ['p1.s1'] },
        { type: 'board', item: { ...attention, sourceRefs: ['fig1'] } },
      ],
    },
  ],
};
const initial = (): RunState => ({
  title: 'Attention',
  plan: [{ id: 'scaling', title: 'Scaling' }],
  chapters: {},
  observations: { fig1: { readable: true, description: 'Scaling spreads weights.' } },
  presented: {},
});
const scope = {
  owner: 'owner',
  documentId: 'document',
  analysisId: 'analysis',
  doc,
  visuals: [],
  language: 'en-US',
  service: {},
} as unknown as ToolScope;

test('chapter preflight normalizes encoded JSON, reviews a clone and preserves state on failure', async () => {
  const state = initial(),
    before = JSON.stringify(state);
  let reviewed = 0;
  const prepared = await prepareReviewedChapter(scope, state, { chapter: JSON.stringify(chapter) }, async (item) => {
    reviewed++;
    return { ...item, title: 'Reviewed attention' };
  });
  assert.equal(reviewed, 1);
  assert.equal(prepared.args.chapter.steps[0].actions.find((a) => a.type === 'board')?.type, 'board');
  assert.equal(prepared.audits.length, 1);
  assert.equal(JSON.stringify(state), before);
  await assert.rejects(
    prepareReviewedChapter(scope, state, { chapter }, async () => {
      throw Error('Visible numerical output is wrong.');
    }),
    /numerical output/,
  );
  assert.equal(JSON.stringify(state), before);
  await assert.rejects(
    prepareReviewedChapter(scope, state, { chapter: '{bad' }, async (item) => item),
    /malformed/,
  );
});
test('durable audit identity binds source, analysis, narration, evidence, code and live parameters', async () => {
  const state = initial(),
    prepared = await prepareReviewedChapter(scope, state, { chapter }, async (item) => item);
  const saved = { ...state, chapters: { scaling: prepared.args.chapter } },
    hash = prepared.audits[0];
  const journal = [{ result: { output: [{ type: 'input_text', text: JSON.stringify({ reviewedVisuals: [hash] }) }] } }];
  const audits = reviewedAudits(journal);
  assert.doesNotThrow(() => assertReviewedState(scope, saved, audits));
  assert.throws(() => assertReviewedState(scope, saved, new Set()), /Resubmit.*upsert_tour_chapter/);
  assert.throws(() => assertReviewedState({ ...scope, analysisId: 'new-analysis' }, saved, audits), /not completed/);
  const changed = structuredClone(saved);
  changed.chapters.scaling.steps[0].say += ' More detail.';
  assert.throws(() => assertReviewedState(scope, changed, audits), /not completed/);
  const step = prepared.args.chapter.steps[0],
    action = step.actions.find((a) => a.type === 'board')!;
  assert.equal(action.type, 'board');
  if (action.type !== 'board') throw Error('board missing');
  assert.notEqual(visualAuditHash(scope, step, { ...attention, parameters: [] }), hash);
  assert.deepEqual(authoredChapterAudits(scope, prepared.args.chapter), [hash]);
  assert.equal(
    reviewedAudits([
      {
        result: {
          output: [{ type: 'input_text', text: JSON.stringify({ error: 'failed', reviewedVisuals: [hash] }) }],
        },
      },
    ]).size,
    0,
  );
  let repeated = 0;
  await prepareReviewedChapter(
    scope,
    state,
    { chapter: prepared.args.chapter },
    async (item) => {
      repeated++;
      return item;
    },
    audits,
  );
  assert.equal(repeated, 0, 'an identical trusted journal audit avoids paying for the same review again');
});

function runnerHarness(cancel = false, broken = false) {
  let inTransaction = false;
  const current = {
    id: 'run',
    generation_id: 'generation',
    owner_id: 'owner',
    document_id: 'document',
    analysis_id: 'analysis',
    model: 'test-model',
    status: 'running',
    state: initial(),
    output_tokens: 0,
    turns: 0,
  };
  const journal: { result: unknown }[] = [],
    events: { type: string; data: Record<string, unknown> }[] = [];
  const query = async (sql: string, values: unknown[] = []) => {
    if (sql.startsWith('select r.*,g.document_id')) return { rows: [structuredClone(current)], rowCount: 1 };
    if (sql.startsWith('select result from agent_tool_calls')) return { rows: journal, rowCount: journal.length };
    if (sql.startsWith('select 1 from agent_tool_calls')) return { rows: [], rowCount: 0 };
    if (sql.startsWith('select * from agent_runs')) return { rows: [current], rowCount: 1 };
    if (sql.startsWith('select 1 from documents')) return { rows: [{ ok: true }], rowCount: 1 };
    if (sql.startsWith('insert into agent_tool_calls')) journal.push({ result: JSON.parse(String(values[4])) });
    if (sql.startsWith('update agent_runs set state=')) current.state = JSON.parse(String(values[1]));
    return { rows: [], rowCount: 1 };
  };
  const db = {
    query,
    pool: { query },
    transaction: async (run: (tx: unknown) => Promise<unknown>) => {
      inTransaction = true;
      try {
        return await run({ query });
      } finally {
        inTransaction = false;
      }
    },
  } as unknown as Database;
  const record = async (type: string, data: Record<string, unknown>) => {
    events.push({ type, data });
  };
  const client = {
    complete: async (_messages: unknown, name: string) => {
      assert.equal(inTransaction, false, 'paid rendered review must run before the SQL transaction');
      if (broken) throw Error('Repair the visible numerical output before saving.');
      assert.equal(name, 'authored_visual_review');
      if (cancel) current.status = 'cancelled';
      return {
        value: { problems: [] },
        usage: { promptTokens: 10, completionTokens: 10, totalTokens: 20 },
        requestId: 'mock-review',
      };
    },
  } as unknown as MuseClient;
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=',
    'base64',
  );
  const storage = { download: async () => png } as unknown as FileStorage;
  const agent = new PaperAgent(
    db,
    storage,
    { muse: { language: 'en-US' } } as Config,
    async () => {},
    {} as SettingsService,
    async () => [],
  );
  const scoped = {
    ...scope,
    visuals: [
      {
        targetId: 'fig1',
        kind: 'figure' as const,
        page: 1,
        label: 'Attention',
        storagePath: 'source.png',
        sha256: createHash('sha256').update(png).digest('hex'),
        contentType: 'image/png',
      },
    ],
  };
  const run = async () => {
    const value = structuredClone(chapter);
    if (broken) {
      const action = value.steps[0].actions.find((a) => a.type === 'board');
      if (action?.type === 'board' && action.item.kind === 'program')
        action.item.code = '()=>{throw Error("invalid computation")}';
    }
    return (agent as unknown as { tool: (...args: unknown[]) => Promise<boolean> }).tool(
      current,
      scoped,
      {
        type: 'function_call',
        name: 'upsert_tour_chapter',
        call_id: 'save',
        arguments: JSON.stringify({ chapter: value }),
      },
      record,
      { client, signal: AbortSignal.timeout(10000) },
    );
  };
  return { run, current, journal, events };
}
test('runner records inspected code before saving, and cancellation during paid review prevents writes', async () => {
  const saved = runnerHarness();
  assert.equal(await saved.run(), false);
  assert.ok(saved.current.state.chapters.scaling);
  assert.equal(reviewedAudits(saved.journal).size, 1);
  assert.ok(saved.events.some((event) => event.type === 'model.completed'));
  assert.ok(saved.events.some((event) => event.type === 'tool.completed' && event.data.name === 'render_visual'));
  const cancelled = runnerHarness(true);
  assert.equal(await cancelled.run(), true);
  assert.deepEqual(cancelled.current.state.chapters, {});
  assert.equal(cancelled.journal.length, 0);
});
test('runner surfaces failed rendered repair as actionable tool feedback without changing saved state', async () => {
  const failed = runnerHarness(false, true);
  await failed.run();
  assert.deepEqual(failed.current.state.chapters, {});
  assert.equal(failed.journal.length, 1);
  assert.match(JSON.stringify(failed.journal[0].result), /Repair the visible numerical output/);
  assert.equal(reviewedAudits(failed.journal).size, 0);
});
test('agent context advertises authored live visual tools under a new durable context version', () => {
  assert.equal(AGENT_VERSION, 'paper-agent@10');
  assert.match(AGENT_INSTRUCTIONS, /AUTHORED LIVE VISUALS/);
  assert.match(AGENT_INSTRUCTIONS, /host narration/);
});
