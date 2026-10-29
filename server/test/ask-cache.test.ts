import test from 'node:test';
import assert from 'node:assert/strict';
import type { BBox, Doc, Step } from '../../shared/paper';
import { AnswerCache, answerKey } from '../src/ask-cache';
import { createApp } from '../src/app';
import type { MuseConfig } from '../src/config';
import type { Database } from '../src/db';
import type { AskAnswer, AskRequest } from '../src/harness/ask';
import { DocumentService } from '../src/service';
import type { SettingsService } from '../src/settings';
import type { FileStorage } from '../src/storage';

const answer = (say = 'Scores grow with d_k.', answerable: AskAnswer['answerable'] = 'yes'): AskAnswer => ({
  answerable,
  steps: [{ id: 'a1', say, actions: [] }],
  followups: ['What is d_k?'],
});
const tick = () => new Promise((resolve) => setImmediate(resolve));

// ------------------------------------------------------------------ the store

test('a stored answer is served at once, as its own copy', async () => {
  const cache = new AnswerCache();
  let calls = 0;
  const compute = async () => (calls++, answer());
  const first = await cache.serve('k', compute);
  assert.equal(first.source, 'model');
  first.answer.steps[0].say = 'changed by the caller';
  const second = await cache.serve('k', compute);
  assert.equal(second.source, 'cache');
  assert.equal(second.answer.steps[0].say, 'Scores grow with d_k.');
  assert.equal(calls, 1);
  assert.equal((await cache.serve('other', compute)).source, 'model');
  assert.equal(calls, 2);
});

test('answers expire, and the store never holds more than its limit', async () => {
  let now = 0;
  const cache = new AnswerCache(3, 1000, () => now);
  const computed: string[] = [];
  const get = (key: string) => cache.serve(key, async () => (computed.push(key), answer(key)));
  for (const key of ['a', 'b', 'c']) await get(key);
  await get('a'); // a is now the most recently used
  await get('d'); // evicts b, the least recently used
  assert.equal(cache.size, 3);
  computed.length = 0;
  for (const key of ['a', 'c', 'd']) assert.equal((await get(key)).source, 'cache', key);
  assert.equal((await get('b')).source, 'model');
  assert.deepEqual(computed, ['b']);
  now = 999;
  assert.equal((await get('d')).source, 'cache');
  now = 1000 + 1;
  computed.length = 0;
  for (const key of ['a', 'c', 'd']) assert.equal((await get(key)).source, 'model', key);
  assert.deepEqual(computed, ['a', 'c', 'd']);
  assert(cache.size <= 3);
  for (let i = 0; i < 50; i++) await get(`k${i}`);
  assert.equal(cache.size, 3);
  assert.equal(new AnswerCache(0).max, 1, 'a store always holds one answer');
});

test('a failure is never stored, nor an answer that says the document cannot answer', async () => {
  const cache = new AnswerCache();
  let calls = 0;
  const outcomes: (() => Promise<AskAnswer>)[] = [
    async () => Promise.reject(new Error('model down')),
    async () => answer('Maybe.', 'no'),
    async () => answer('Maybe.', 'no'),
    async () => answer('Yes.', 'partly'),
  ];
  const ask = () => cache.serve('k', () => outcomes[calls++]());
  await assert.rejects(ask(), /model down/);
  assert.equal(cache.size, 0);
  assert.equal((await ask()).answer.answerable, 'no');
  assert.equal(cache.size, 0, 'the learner can ask again and get another try');
  assert.equal((await ask()).answer.answerable, 'no');
  assert.equal((await ask()).answer.answerable, 'partly');
  assert.equal((await ask()).source, 'cache');
  assert.equal(calls, 4);
});

test('an identical question asked while it is being answered waits for that call', async () => {
  const cache = new AnswerCache();
  let calls = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const compute = async () => (calls++, await gate, answer());
  const both = Promise.all([cache.serve('k', compute), cache.serve('k', compute)]);
  await tick();
  release();
  const [first, second] = await both;
  assert.equal(calls, 1);
  assert.deepEqual([first.source, second.source], ['model', 'flight']);
  assert.deepEqual(first.answer, second.answer);
  assert.notEqual(first.answer, second.answer);
  assert.equal((await cache.serve('k', compute)).source, 'cache');
  // A failure reaches everyone who waited, and the next question starts over.
  const failing = Promise.allSettled([
    cache.serve('f', async () => (await tick(), Promise.reject(new Error('boom')))),
    cache.serve('f', async () => assert.fail('joins the first call')),
  ]);
  assert.deepEqual(
    (await failing).map((r) => r.status),
    ['rejected', 'rejected'],
  );
  assert.equal((await cache.serve('f', async () => answer())).source, 'model');
});

test('a learner who leaves stops waiting; the call goes on for the others and stops when nobody is left', async () => {
  const cache = new AnswerCache();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const signals: AbortSignal[] = [];
  const compute = async (signal: AbortSignal) => (signals.push(signal), await gate, answer());
  const leaving = new AbortController();
  const staying = new AbortController();
  const first = cache.serve('k', compute, leaving.signal);
  const second = cache.serve('k', compute, staying.signal);
  await tick();
  leaving.abort(new Error('closed the tab'));
  await assert.rejects(first, /closed the tab/);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].aborted, false, 'another learner still waits for it');
  release();
  assert.equal((await second).answer.steps[0].say, 'Scores grow with d_k.');

  const alone = new AbortController();
  const stopped = cache.serve(
    'j',
    (signal) => new Promise<AskAnswer>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    alone.signal,
  );
  await tick();
  alone.abort(new Error('gone'));
  await assert.rejects(stopped, /gone/);
  assert.equal(cache.size, 1);
  // The stopped call is forgotten at once: a new question starts its own.
  assert.equal((await cache.serve('j', async () => answer('Fresh.'))).answer.steps[0].say, 'Fresh.');
  // A question already cancelled never starts a call.
  const cancelled = AbortSignal.abort(new Error('already'));
  await assert.rejects(
    cache.serve('i', async () => assert.fail('not started'), cancelled),
    /already/,
  );
});

// ------------------------------------------------------------------- the key

const step: Step = { id: 'method-1', say: 'Attention compares every query with every key.', actions: [] };
const base = {
  scope: 'owner',
  documentId: 'doc-1',
  version: 'analysis-1',
  request: { question: 'Why scale the dot products?', tourId: 'tour-1', stepId: 'method-1' } as AskRequest,
  step,
  language: 'en-GB',
  model: 'muse-spark-1.3',
};

test('a question is the same up to spacing and case, and different in anything that changes the answer', () => {
  const key = answerKey(base);
  assert.match(key, /^[0-9a-f]{64}$/);
  const same = (request: Partial<AskRequest>) => answerKey({ ...base, request: { ...base.request, ...request } });
  assert.equal(same({ question: 'why SCALE the dot products?' }), key);
  assert.equal(same({ question: '  Why  scale\nthe dot products? ' }), key);
  assert.equal(same({ responseLanguage: undefined, history: [], selection: undefined }), same({}));
  const different = [
    same({ question: 'Why scale the dot products' }),
    same({ tourId: 'tour-2' }),
    same({ responseLanguage: 'uk-UA' }),
    same({ figureId: 'fig1' }),
    same({ selection: { page: 1, rect: [0.1, 0.1, 0.5, 0.5] } }),
    same({ selection: { page: 2, rect: [0.1, 0.1, 0.5, 0.5] } }),
    same({ selection: { page: 1, rect: [0.1, 0.1, 0.5, 0.6] } }),
    same({ history: [{ question: 'What is d_k?', answer: 'The key size.' }] }),
    same({ history: [{ question: 'What is d_k?', answer: 'The query size.' }] }),
    answerKey({ ...base, scope: 'other' }),
    answerKey({ ...base, documentId: 'doc-2' }),
    answerKey({ ...base, version: 'analysis-2' }),
    answerKey({ ...base, step: { ...step, say: 'Edited.' } }),
    answerKey({ ...base, step: undefined }),
    answerKey({ ...base, language: 'de-DE' }),
    answerKey({ ...base, model: 'muse-wonder-1.0' }),
  ];
  assert.equal(new Set([key, ...different]).size, different.length + 1);
  // The same selection spelled with its keys in another order is the same selection.
  const a = same({ selection: { page: 1, rect: [0.1, 0.1, 0.5, 0.5] } });
  const b = same({ selection: { rect: [0.1, 0.1, 0.5, 0.5], page: 1 } as AskRequest['selection'] });
  assert.equal(a, b);
});

// ---------------------------------------------------------- through the service

const settings: MuseConfig = {
  apiKey: 'unit-test-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en-US',
  timeoutMs: 5000,
};
const rect: BBox = [0, 0, 100, 10];
const texts = [
  'Recurrent models process tokens one after another, which limits parallel training.',
  'We propose a model that relies entirely on attention to draw global dependencies.',
  'Large values of d_k push the softmax into regions with tiny gradients.',
];
function makeDoc(sha: string): Doc {
  return {
    schema: 'paper-tour/doc@0.1',
    source: {
      file: 'paper.pdf',
      sha256: sha.repeat(64),
      num_pages: 1,
      generator: 'test',
      title: 'Attention for testing',
    },
    pages: [{ n: 1, width: 600, height: 800 }],
    sections: [{ id: 'sec-1', number: '1', title: 'Introduction', level: 1, page: 1, block: 'p1.b1' }],
    blocks: [
      { id: 'p1.b1', page: 1, type: 'heading', bbox: [0, 0, 500, 20], text: '', sentences: [] },
      {
        id: 'p1.b2',
        page: 1,
        type: 'paragraph',
        bbox: [0, 20, 500, 120],
        text: '',
        section: 'sec-1',
        sentences: texts.map((_, i) => `p1.s${i + 1}`),
      },
    ],
    sentences: texts.map((text, i) => ({ id: `p1.s${i + 1}`, page: 1, block: 'p1.b2', text, rects: [rect] })),
    figures: [],
    equations: [],
  };
}
const SAY =
  'The authors scale the dot products because they grow large when d_k is large. Large scores push the softmax into regions with tiny gradients, so learning slows down.';
const NO_BOARD = {
  kind: 'none',
  title: '',
  latex: '',
  terms: [],
  nodes: [],
  bars: [],
  unit: '',
  higher_is_better: true,
};
const modelAnswer = (answerable = 'yes') => ({
  plan: 'p',
  answerable,
  steps: [{ say: SAY, cues: [], board: NO_BOARD }],
  followups: ['What is d_k?', 'Does scaling change the results?'],
});

const OWNER = 'owner';
const DOCUMENT = '7694558d-f7e2-4cbd-9355-978ec677b254';
const OTHER_DOCUMENT = '0c8f3b0e-5a43-4e6c-8f02-0a1f2d3c4b5a';
const ANALYSIS = '1c3c4c62-0f45-4a4e-9a35-3d2b0c1d7e11';
const NEXT_ANALYSIS = '2d4d5d73-1056-4b5b-8b46-4e1c3d2e8f22';
const OTHER_ANALYSIS = '3e5e6e84-2167-4c6c-9c57-5f2d4e3f9a33';
const TOUR = '5a0d3f8e-7b8e-4c55-bb4c-0f2f1f8b9c3d';

/** The library over a fake database; `model` sees each question's task and may wait, fail or answer. */
function library(model: (task: string, call: number) => unknown | Promise<unknown>) {
  const state = { current: ANALYSIS, calls: 0 };
  const docs: Record<string, Doc> = {
    [ANALYSIS]: makeDoc('a'),
    [NEXT_ANALYSIS]: makeDoc('b'),
    [OTHER_ANALYSIS]: makeDoc('c'),
  };
  const tour = {
    schema: 'paper-tour/tour@0.1',
    title: 'A tour',
    paper: 'doc-test',
    voices: { host: { lang: 'en-GB' } },
    chapters: [
      {
        id: 'method',
        title: 'How it works',
        steps: [
          { id: 'method-1', say: 'Attention compares every query with every key.', actions: [] },
          { id: 'method-2', say: 'The scores become weights.', actions: [] },
        ],
      },
    ],
  };
  const query = async (text: string, values: unknown[] = []) => {
    if (text.startsWith('select * from documents')) {
      const known =
        [DOCUMENT, OTHER_DOCUMENT].includes(String(values[0])) && ['owner', 'second'].includes(String(values[1]));
      return {
        rows: known
          ? [
              {
                id: values[0],
                owner_id: values[1],
                current_analysis_id: values[0] === DOCUMENT ? state.current : OTHER_ANALYSIS,
                upload_path: `owner/${values[0]}/original.pdf`,
                tour_model: 'muse-spark-1.3',
                tour_allow_training: false,
              },
            ]
          : [],
      };
    }
    if (text.startsWith('select script,analysis_id from tours'))
      return { rows: values[0] === TOUR ? [{ script: tour, analysis_id: state.current }] : [] };
    if (text.startsWith('select id,doc from analyses')) {
      const wanted = String(values[0]);
      const owns = (wanted === OTHER_ANALYSIS) === (values[1] === OTHER_DOCUMENT);
      return { rows: docs[wanted] && owns ? [{ id: wanted, doc: docs[wanted] }] : [] };
    }
    if (text.includes('from assets')) return { rows: [] };
    throw new Error(`Unexpected query: ${text}`);
  };
  const db = { query, pool: { query } } as unknown as Database;
  const transport = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const last = body.messages.at(-1).content;
    const task = typeof last === 'string' ? last : last.map((p: { text?: string }) => p.text ?? '').join('\n');
    const result = await model(task, ++state.calls);
    if (result instanceof Response) return result;
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(result) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  }) as typeof fetch;
  const muse = {
    base: settings,
    resolveMuse: async (_owner: string, chosen?: string) => ({
      config: { ...settings, model: chosen ?? settings.model },
      source: 'app',
      version: 'v1',
    }),
    transport,
  } as unknown as SettingsService;
  const service = new DocumentService(
    db,
    {} as FileStorage,
    async () => {},
    26214400,
    'muse-spark-1.3',
    undefined,
    muse,
  );
  return { service, state };
}
const quiet = (t: { mock: { method: (o: object, m: 'log' | 'warn', f: () => void) => unknown } }) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
};

test('a question asked again about the same document version is answered without a model call', async (t) => {
  quiet(t);
  const { service, state } = library(() => modelAnswer());
  const question = { question: 'Why scale the dot products?' };
  const first = await service.ask(OWNER, DOCUMENT, question);
  assert.equal(first.steps.length, 1);
  assert.equal(state.calls, 1);
  const again = await service.ask(OWNER, DOCUMENT, { question: '  why SCALE the dot   products? ' });
  assert.deepEqual(again, first);
  assert.equal(state.calls, 1, 'trimmed and case-folded, the same question');
  // Another question, another answer language or another conversation is another answer.
  await service.ask(OWNER, DOCUMENT, { question: 'Why scale?' });
  await service.ask(OWNER, DOCUMENT, { ...question, responseLanguage: 'uk-UA' });
  await service.ask(OWNER, DOCUMENT, { ...question, history: [{ question: 'What is d_k?', answer: 'The key size.' }] });
  assert.equal(state.calls, 4);
  await service.ask(OWNER, DOCUMENT, { ...question, responseLanguage: 'uk-UA' });
  assert.equal(state.calls, 4, 'each of them is stored as well');
});

test('answers are kept per tour step, per document version, per document and per learner', async (t) => {
  quiet(t);
  const { service, state } = library(() => modelAnswer());
  const question = { question: 'Why scale the dot products?', tourId: TOUR };
  await service.ask(OWNER, DOCUMENT, { ...question, stepId: 'method-1' });
  await service.ask(OWNER, DOCUMENT, { ...question, stepId: 'method-1' });
  assert.equal(state.calls, 1);
  await service.ask(OWNER, DOCUMENT, { ...question, stepId: 'method-2' });
  await service.ask(OWNER, DOCUMENT, question);
  assert.equal(state.calls, 3, 'another step, or no step, is another context');
  // A new analysis of the document is a new version: nothing about the old one is reused.
  state.current = NEXT_ANALYSIS;
  await service.ask(OWNER, DOCUMENT, { question: question.question });
  await service.ask(OWNER, DOCUMENT, { question: question.question });
  assert.equal(state.calls, 4);
  state.current = ANALYSIS;
  await service.ask(OWNER, DOCUMENT, { question: question.question });
  assert.equal(state.calls, 5, 'the earlier version’s answer has gone with its version');
  // Other documents and other learners start empty, even with the same question word for word.
  await service.ask(OWNER, OTHER_DOCUMENT, { question: question.question });
  await service.ask('second', DOCUMENT, { question: question.question });
  assert.equal(state.calls, 7);
  await service.ask('second', DOCUMENT, { question: question.question });
  await service.ask(OWNER, OTHER_DOCUMENT, { question: question.question });
  assert.equal(state.calls, 7);
});

test('failed and unanswerable questions are asked again; a clicked question joins the prefetch of the same one', async (t) => {
  quiet(t);
  const failing = library((_task, call) => (call === 1 ? new Response('busy', { status: 503 }) : modelAnswer()));
  const question = { question: 'Why scale the dot products?' };
  await assert.rejects(
    failing.service.ask(OWNER, DOCUMENT, question),
    (e: { code?: string }) => e.code === 'model_unavailable',
  );
  const answered = await failing.service.ask(OWNER, DOCUMENT, question);
  assert.equal(failing.state.calls, 2);
  assert.deepEqual(await failing.service.ask(OWNER, DOCUMENT, question), answered);
  assert.equal(failing.state.calls, 2);

  // Medium effort gets the second try too, so the model is called twice per unanswerable question.
  const unanswerable = library(() => modelAnswer('no'));
  assert.equal((await unanswerable.service.ask(OWNER, DOCUMENT, question)).answerable, 'no');
  const calls = unanswerable.state.calls;
  await unanswerable.service.ask(OWNER, DOCUMENT, question);
  assert.equal(unanswerable.state.calls, calls * 2);

  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const slow = library(async () => (await gate, modelAnswer()));
  const prefetch = slow.service.ask(OWNER, DOCUMENT, question);
  await tick();
  const click = slow.service.ask(OWNER, DOCUMENT, { question: 'WHY scale the dot products?' });
  await tick();
  release();
  assert.deepEqual(await click, await prefetch);
  assert.equal(slow.state.calls, 1, 'one model call for both');
});

test('a stored answer needs no free question slot, a model call does', async (t) => {
  quiet(t);
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  const { service, state } = library(async (task) =>
    task.includes('hold') ? (await gate, modelAnswer()) : modelAnswer(),
  );
  const ready = { question: 'Why scale the dot products?' };
  await service.ask(OWNER, DOCUMENT, ready);
  const pending = ['hold one', 'hold two'].map((question) => service.ask(OWNER, DOCUMENT, { question }));
  await tick();
  await assert.rejects(
    service.ask(OWNER, DOCUMENT, { question: 'a third question' }),
    (e: { code?: string }) => e.code === 'too_many_questions',
  );
  const calls = state.calls;
  await service.ask(OWNER, DOCUMENT, ready);
  assert.equal(state.calls, calls, 'served from the store while both slots are busy');
  release();
  await Promise.all(pending);
  await service.ask(OWNER, DOCUMENT, { question: 'a third question' });
});

test('demo papers keep their answers apart from library documents', async (t) => {
  quiet(t);
  const { mkdtemp, mkdir, rm, writeFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'paper-tour-cache-'));
  try {
    for (const [name, sha] of [
      ['paper', 'd'],
      ['other', 'e'],
    ] as const) {
      await mkdir(join(root, name));
      await writeFile(join(root, name, 'doc.json'), JSON.stringify(makeDoc(sha)));
    }
    const { service, state } = library(() => modelAnswer());
    service.demoRoot = root;
    const question = { question: 'Why scale the dot products?' };
    await service.demoAsk('paper', question);
    await service.demoAsk('paper', { question: 'why scale the dot products?' });
    assert.equal(state.calls, 1);
    await service.demoAsk('other', question);
    await service.ask(OWNER, DOCUMENT, question);
    assert.equal(state.calls, 3);
    // A paper edited on disk is a new version.
    await writeFile(join(root, 'paper', 'doc.json'), JSON.stringify(makeDoc('f')));
    await service.demoAsk('paper', question);
    assert.equal(state.calls, 4);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the ask route serves the repeat from the store with the same body', async (t) => {
  quiet(t);
  const { service, state } = library(() => modelAnswer());
  const app = await createApp({ service, authenticate: async (token) => (token === 'owner' ? token : null) });
  const post = (question: string) =>
    app.inject({
      method: 'POST',
      url: `/api/documents/${DOCUMENT}/ask`,
      headers: { authorization: 'Bearer owner' },
      payload: { question },
    });
  try {
    const first = await post('Why scale the dot products?');
    const second = await post('why scale the dot products?  ');
    assert.equal(first.statusCode, 200);
    assert.equal(second.body, first.body);
    assert.equal(state.calls, 1);
  } finally {
    await app.close();
  }
});
