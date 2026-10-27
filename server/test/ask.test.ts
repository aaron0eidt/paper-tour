import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, BBox, Doc, Step, Tour } from '../../shared/paper';
import { createApp } from '../src/app';
import type { MuseConfig } from '../src/config';
import type { Database } from '../src/db';
import { HttpError, ProcessingError } from '../src/errors';
import { MuseClient } from '../src/muse/client';
import { DocumentService } from '../src/service';
import type { SettingsService } from '../src/settings';
import type { FileStorage } from '../src/storage';
import type { TourImage } from '../src/tour-generator';
import {
  answerQuestion,
  askError,
  askModel,
  boardFromAnswer,
  retrieve,
  spoken,
  type AskRequest,
} from '../src/harness/ask';
import { paperBlock } from '../src/harness/paper-block';
import { SHARED_RULES } from '../src/harness/prompts';

const settings: MuseConfig = {
  apiKey: 'unit-test-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en-US',
  timeoutMs: 5000,
};
const texts: Record<string, string> = {
  'p1.s1': 'Recurrent models process tokens one after another, which limits parallel training.',
  'p1.s2': 'We propose the Transformer, which relies entirely on attention to draw global dependencies.',
  'p1.s3': 'Figure 1 shows the encoder and decoder stacks.',
  'p2.s1': 'An attention function maps a query and a set of key-value pairs to an output.',
  'p2.s2': 'We compute the dot products of the query with all keys and apply a softmax to obtain the weights.',
  'p2.s3':
    'For large values of d_k, the dot products grow large in magnitude and push the softmax into regions with tiny gradients.',
  'p2.s4': 'To counteract this effect, we scale the dot products by one over the square root of d_k.',
  'p3.s1': 'The big model reaches 28.4 BLEU on English-to-German translation.',
  'p3.s2': 'The base model reaches 27.3 BLEU at a fraction of the training cost.',
  'p3.s3': 'However, the cost of attention grows quadratically with the sequence length.',
};
const rect: BBox = [0, 0, 100, 10];
const sentence = (id: string) => ({
  id,
  page: Number(id[1]),
  block: id.startsWith('p2.s3') || id.startsWith('p2.s4') ? 'p2.b4' : `p${id[1]}.b2`,
  text: texts[id],
  rects: [rect],
});
const block = (id: string, type: 'heading' | 'paragraph' | 'equation', sentences: string[], section: string) => ({
  id,
  page: Number(id[1]),
  type,
  bbox: [0, 20, 500, 120] as BBox,
  text: '',
  section,
  sentences,
});
const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: {
    file: 'paper.pdf',
    sha256: 'c'.repeat(64),
    num_pages: 3,
    generator: 'test',
    title: 'Attention for testing',
  },
  pages: [1, 2, 3].map((n) => ({ n, width: 600, height: 800 })),
  sections: [
    { id: 'sec-1', number: '1', title: 'Introduction', level: 1, page: 1, block: 'p1.b1' },
    { id: 'sec-3.2', number: '3.2', title: 'Scaled Dot-Product Attention', level: 2, page: 2, block: 'p2.b1' },
    { id: 'sec-6', number: '6', title: 'Results', level: 1, page: 3, block: 'p3.b1' },
  ],
  blocks: [
    block('p1.b1', 'heading', [], 'sec-1'),
    block('p1.b2', 'paragraph', ['p1.s1', 'p1.s2', 'p1.s3'], 'sec-1'),
    block('p2.b1', 'heading', [], 'sec-3.2'),
    block('p2.b2', 'paragraph', ['p2.s1', 'p2.s2'], 'sec-3.2'),
    block('p2.b3', 'equation', [], 'sec-3.2'),
    block('p2.b4', 'paragraph', ['p2.s3', 'p2.s4'], 'sec-3.2'),
    block('p3.b1', 'heading', [], 'sec-6'),
    block('p3.b2', 'paragraph', ['p3.s1', 'p3.s2', 'p3.s3'], 'sec-6'),
  ],
  sentences: Object.keys(texts).map(sentence),
  figures: [
    {
      id: 'fig1',
      kind: 'figure',
      number: '1',
      page: 1,
      bbox: [0, 200, 400, 500],
      caption: 'The Transformer model architecture with its encoder and decoder stacks.',
      image: 'figures/fig1.png',
      panels: [
        { id: 'fig1.a', bbox: [0, 200, 200, 500], label: '(a)' },
        { id: 'fig1.b', bbox: [200, 200, 400, 500], label: '(b)' },
      ],
      referenced_by: ['p1.s3'],
    },
    {
      id: 'tab2',
      kind: 'table',
      number: '2',
      page: 3,
      bbox: [0, 300, 400, 400],
      caption: 'BLEU scores of the base and big models on the WMT 2014 test sets.',
      image: 'figures/tab2.png',
      panels: [],
      referenced_by: ['p3.s1'],
    },
  ],
  equations: [
    {
      id: 'eq1',
      number: '1',
      page: 2,
      bbox: [0, 130, 300, 150],
      block: 'p2.b3',
      text: 'Attention(Q, K, V) = softmax(QK^T / sqrt(d_k)) V',
    },
  ],
};
const tour: Tour = {
  schema: 'paper-tour/tour@0.1',
  title: 'A tour',
  paper: 'doc-test',
  voices: { host: { lang: 'en-GB' } },
  chapters: [
    {
      id: 'method',
      title: 'How it works',
      steps: [
        {
          id: 'method-1',
          say: 'Attention compares every query with every key and turns the scores into weights.',
          actions: [
            { type: 'focus', target: 'p2.s2' },
            { type: 'highlight', targets: ['p2.s2'] },
          ],
        },
      ],
    },
  ],
};

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
const SCALE_SAY =
  'The authors scale the dot products because they grow large when d_k is large. Large scores push the softmax into regions with tiny gradients, so learning slows down.';
type Request = { name: string; schema: any; effort: string; messages: any[]; task: string };
function reply(value: unknown) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  );
}
function provider(fn: (request: Request) => unknown): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const text = (content: any) =>
      typeof content === 'string' ? content : content.map((p: any) => p.text ?? '').join('\n');
    const result = fn({
      name: body.response_format.json_schema.name,
      schema: body.response_format.json_schema.schema,
      effort: body.reasoning_effort,
      messages: body.messages,
      task: text(body.messages.at(-1).content),
    });
    return result instanceof Response ? result : reply(result);
  }) as typeof fetch;
}
const ask = (request: AskRequest, model: (r: Request) => unknown, extra: { tour?: Tour; image?: TourImage } = {}) =>
  answerQuestion({
    client: new MuseClient(settings, provider(model)),
    doc,
    documentId: 'doc-test',
    request,
    language: 'en-US',
    ...extra,
  });
const types = (step: Step) => step.actions.map((a) => a.type);
const highlighted = (step: Step) => step.actions.flatMap((a) => (a.type === 'highlight' ? a.targets : []));

test('retrieval ranks the passage that answers the question first', () => {
  assert.equal(retrieve(doc, { question: 'What BLEU score does the big model reach?' }).ranked[0].id, 'p3.s1');
  const scale = retrieve(doc, { question: 'Why do they scale the dot products by the square root of d_k?' });
  assert.equal(scale.ranked[0].id, 'p2.s4');
  assert.ok(scale.visuals.includes('eq1'), 'the equation is matched through the sentences around it');
  assert.ok(!scale.sentences.includes('p1.s1'));
});

test('retrieval adds the current step’s evidence with its neighbours, and elements the question names', () => {
  const step = tour.chapters[0].steps[0];
  const during = retrieve(doc, { question: 'Why is that?' }, step);
  assert.deepEqual(
    during.focus.map((p) => p.id),
    ['p2.s1', 'p2.s2', 'p2.s3'],
  );
  assert.equal(during.home, 'p2.s2');
  const named = retrieve(doc, { question: 'What does Table 2 compare?' });
  assert.equal(named.focus[0].id, 'tab2');
  assert.equal(named.home, 'tab2');
  const looking = retrieve(doc, { question: 'What is on the left?', figureId: 'fig1.a' });
  assert.equal(looking.home, 'fig1');
  assert.ok(looking.visuals.includes('fig1.a') && looking.sentences.includes('p1.s3'));
});

test('the call shares the tour writer’s cached prefix and sends the question, history and narration', async () => {
  let seen: Request | undefined;
  await ask(
    {
      question: 'And why does that slow learning?',
      stepId: 'method-1',
      history: [{ question: 'Why scale the dot products?', answer: 'Because they grow large with d_k.' }],
    },
    (r) => {
      seen = r;
      return { plan: 'p', answerable: 'yes', steps: [{ say: SCALE_SAY, cues: [], board: NO_BOARD }], followups: [] };
    },
    { tour },
  );
  assert.equal(seen!.name, 'ask_answer');
  assert.equal(seen!.effort, 'low');
  assert.deepEqual(seen!.messages.slice(0, 2), [
    { role: 'developer', content: SHARED_RULES },
    { role: 'user', content: `<DOCUMENT>\n${paperBlock(doc)}\n</DOCUMENT>` },
  ]);
  assert.ok(seen!.task.startsWith('TASK: answer the learner'), 'the fixed instructions come first, so they cache too');
  for (const part of [
    'QUESTION: And why does that slow learning?',
    'Q: Why scale the dot products?',
    'A: Because they grow large',
    'THE TOUR WAS SAYING: Attention compares',
  ])
    assert.ok(seen!.task.includes(part), part);
  const targets = seen!.schema.properties.steps.items.properties.cues.items.properties.target.enum as string[];
  assert.ok(targets.includes('p2.s2') && targets.includes('p2.s3'));
  assert.ok(!targets.includes('p1.s1'), 'the model can only choose retrieved IDs');
});

test('cues outside the retrieved IDs are dropped and the camera opens on the main target', async () => {
  const { answer } = await ask({ question: 'Why do they scale the dot products by the square root of d_k?' }, () => ({
    plan: 'p',
    answerable: 'yes',
    steps: [
      {
        say: SCALE_SAY,
        cues: [
          { action: 'highlight', target: 'p1.s1', label: '', anchor: 'The authors scale' },
          { action: 'highlight', target: 'p2.s3', label: '', anchor: 'push the softmax' },
          { action: 'box', target: 'fig1', label: 'model', anchor: 'dot products' },
          { action: 'highlight', target: 'p2.s4', label: '', anchor: 'scale the dot products' },
          { action: 'box', target: 'p2.s4', label: 'not a visual', anchor: 'tiny gradients' },
        ],
        board: NO_BOARD,
      },
    ],
    followups: ['What is d_k?', '  What is d_k?  ', 'How big is d_k in the base model'],
  }));
  assert.equal(answer.answerable, 'yes');
  const [step] = answer.steps;
  assert.match(step.id, /^ask-[0-9a-f]{8}-1$/);
  assert.deepEqual(step.actions[0], { type: 'focus', target: 'p2.s4' });
  assert.deepEqual(highlighted(step), ['p2.s4', 'p2.s3']);
  assert.ok(!types(step).includes('box'));
  assert.ok(step.say.includes('when d k is large'), 'narration reads d_k aloud as "d k"');
  const push = step.actions.find((a) => a.type === 'highlight' && a.targets[0] === 'p2.s3');
  assert.equal(push?.at_word, step.say.split(' ').indexOf('push'));
  assert.deepEqual(answer.followups, ['What is d_k?', 'How big is d_k in the base model?']);
});

test('a formula board is kept only when it passes the board check, with its terms lit as the voice explains them', () => {
  const say =
    'The scores QK transpose are divided by the square root of d k before the softmax turns them into weights.';
  const formula = (latex: string, terms: { latex: string; label: string; anchor: string }[]) => ({
    ...NO_BOARD,
    kind: 'formula',
    title: 'Scaled attention',
    latex,
    terms,
  });
  const latex = '\\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V';
  const good = boardFromAnswer(
    formula(latex, [
      { latex: 'QK^T', label: 'similarity scores', anchor: 'scores QK transpose' },
      { latex: '\\sqrt{d_k}', label: 'scale', anchor: 'square root of' },
    ]),
    say,
    [],
  );
  assert.equal(good?.item.kind, 'formula');
  assert.deepEqual(good?.item.kind === 'formula' ? good.item.terms.map((t) => t.latex) : [], ['QK^T', '\\sqrt{d_k}']);
  assert.deepEqual(good?.focus, [1, say.split(' ').indexOf('square')]);
  const notInFormula = formula(latex, [
    { latex: 'QK^T', label: 'scores', anchor: '' },
    { latex: '\\sqrt{d}', label: 'scale', anchor: '' },
  ]);
  assert.equal(boardFromAnswer(notInFormula, say, []), null);
  const broken = formula('\\frac{QK^T}{\\sqrt{d_k}', [
    { latex: 'QK^T', label: 'scores', anchor: '' },
    { latex: '\\sqrt{d_k}', label: 'scale', anchor: '' },
  ]);
  assert.equal(boardFromAnswer(broken, say, []), null);
  assert.equal(boardFromAnswer(NO_BOARD, say, []), null);
});

test('a valid board becomes board and board_focus actions; an invalid one leaves the step without a board', async () => {
  const board = {
    ...NO_BOARD,
    kind: 'formula',
    latex: '\\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V',
    terms: [
      { latex: 'QK^T', label: 'scores', anchor: 'dot products' },
      { latex: '\\sqrt{d_k}', label: 'scale', anchor: 'tiny gradients' },
    ],
  };
  const model = (b: object) => () => ({
    plan: 'p',
    answerable: 'yes',
    steps: [
      {
        say: SCALE_SAY,
        cues: [{ action: 'box', target: 'eq1', label: 'the scaling', anchor: 'The authors scale' }],
        board: b,
      },
    ],
    followups: [],
  });
  const question = { question: 'What does Equation (1) compute?' };
  const [step] = (await ask(question, model(board))).answer.steps;
  assert.deepEqual(types(step), ['zoom', 'board', 'board_focus', 'board_focus', 'box']);
  assert.deepEqual(step.actions[0], { type: 'zoom', target: 'eq1' });
  const focus = step.actions.filter((a): a is Extract<Action, { type: 'board_focus' }> => a.type === 'board_focus');
  assert.deepEqual(
    focus.map((a) => [a.part, a.at_word]),
    [
      [0, step.say.split(' ').indexOf('dot')],
      [1, step.say.split(' ').indexOf('tiny')],
    ],
  );
  const [plain] = (await ask(question, model({ ...board, latex: '\\frac{QK^T}{' }))).answer.steps;
  assert.deepEqual(types(plain), ['zoom', 'box']);
});

test('bars keep only numbers written in the retrieved passages', () => {
  const bars = (values: number[]) => ({
    ...NO_BOARD,
    kind: 'bars',
    unit: 'BLEU',
    bars: values.map((value, i) => ({ label: i ? 'Base' : 'Big', value, anchor: '' })),
  });
  const numbers = [28.4, 27.3, 2014];
  assert.deepEqual(boardFromAnswer(bars([28.4, 27.3]), 'Big beats base.', numbers)?.item, {
    kind: 'bars',
    unit: 'BLEU',
    higher_is_better: true,
    bars: [
      { label: 'Big', value: 28.4 },
      { label: 'Base', value: 27.3 },
    ],
  });
  assert.equal(boardFromAnswer(bars([28.4, 31.7]), 'Big beats base.', numbers), null);
});

test('pen marks point at a region only on the figure the model saw, and long labels are left off', async () => {
  const say = 'The encoder on the left reads the input sentence, and the decoder on the right writes the output.';
  const model = (r: Request) => {
    regions = r.schema.properties.steps.items.properties.cues.items.properties.region.enum;
    return {
      plan: 'p',
      answerable: 'yes',
      steps: [
        {
          say,
          cues: [
            { action: 'arrow', target: 'fig1.a', region: 'top-left', label: 'encoder', anchor: 'The encoder' },
            {
              action: 'circle',
              target: 'fig1',
              region: 'right-half',
              label: 'the decoder that writes it',
              anchor: 'the decoder',
            },
          ],
          board: NO_BOARD,
        },
      ],
      followups: [],
    };
  };
  let regions: string[] = [];
  const image: TourImage = {
    targetId: 'fig1',
    kind: 'figure',
    page: 1,
    label: 'Figure 1',
    dataUrl: 'data:image/png;base64,AA==',
  };
  const [seen] = (await ask({ question: 'What is on the left?', figureId: 'fig1' }, model, { image })).answer.steps;
  assert.ok(regions.includes('top-left') && regions.includes('whole'));
  assert.deepEqual(seen.actions[0], { type: 'zoom', target: 'fig1' });
  assert.deepEqual(seen.actions.slice(1), [
    { type: 'arrow', target: 'fig1.a', region: [0, 0, 0.4, 0.4], color: 'pink', label: 'encoder' },
    {
      type: 'circle',
      target: 'fig1',
      region: [0.5, 0, 1, 1],
      color: 'pink',
      at_word: say.split(' ').indexOf('decoder') - 1,
    },
  ]);
  const [blind] = (await ask({ question: 'What is on the left?', figureId: 'fig1' }, model)).answer.steps;
  assert.deepEqual(regions, ['whole']);
  assert.ok(
    blind.actions.every((a) => !('region' in a)),
    'without the image, marks go around the whole target',
  );
});

test('narration is cleaned for the voice and kept to 60 words, cut after a whole sentence', () => {
  assert.equal(
    spoken('The scale is $\\sqrt{d_k}$, and a run costs $5 in C#.'),
    'The scale is square root of d k, and a run costs $5 in C#.',
  );
  const sentence = 'Attention lets every token look at all the other tokens at once.'; // 12 words
  const said = spoken(Array(6).fill(sentence).join(' '));
  assert.equal(said, Array(5).fill(sentence).join(' '));
  assert.equal(said.split(' ').length, 60);
  // A first sentence too long to cut after is cut at 60 words and closed with a full stop.
  const rambling = spoken(Array(70).fill('word').join(' '));
  assert.equal(rambling, `${Array(60).fill('word').join(' ')}.`);
});

test('an answer that says it cannot answer is retried once at medium effort', async () => {
  const efforts: string[] = [];
  const { answer, completions } = await ask({ question: 'How many GPUs did they use?' }, (r) => {
    efforts.push(r.effort);
    const answerable = r.effort === 'low' ? 'no' : 'partly';
    return { plan: 'p', answerable, steps: [{ say: SCALE_SAY, cues: [], board: NO_BOARD }], followups: [] };
  });
  assert.deepEqual(efforts, ['low', 'medium']);
  assert.equal(answer.answerable, 'partly');
  assert.equal(completions.length, 2);
  // The first answer survives a failed retry.
  const kept = await ask({ question: 'How many GPUs did they use?' }, (r) =>
    r.effort === 'low'
      ? { plan: 'p', answerable: 'no', steps: [{ say: SCALE_SAY, cues: [], board: NO_BOARD }], followups: [] }
      : new Response('busy', { status: 503 }),
  );
  assert.equal(kept.answer.answerable, 'no');
});

test('an unusable answer is retried once, then reported as a model failure', async () => {
  let calls = 0;
  await assert.rejects(
    ask(
      { question: 'What is attention?' },
      () => (
        calls++,
        { plan: 'p', answerable: 'yes', steps: [{ say: 'Yes.', cues: [], board: NO_BOARD }], followups: [] }
      ),
    ),
    (e) => e instanceof ProcessingError && e.code === 'muse_invalid_response',
  );
  assert.equal(calls, 2);
  const failure = askError(new ProcessingError('muse_auth_failed', 'denied'));
  assert.ok(failure instanceof HttpError && failure.status === 409 && failure.code === 'model_not_configured');
});

test('questions use the document’s model, and a Contributor model only with the paper’s consent', () => {
  assert.equal(askModel('muse-wonder-1.0', false, 'muse-spark-1.3'), 'muse-wonder-1.0');
  assert.equal(askModel('muse-spark-1.2-contributor', false, 'muse-spark-1.3'), 'muse-spark-1.2');
  assert.equal(askModel('muse-spark-1.2-contributor', true, 'muse-spark-1.3'), 'muse-spark-1.2-contributor');
  assert.equal(askModel('muse-image-1.0', true, 'muse-spark-1.3'), 'muse-spark-1.3');
  assert.equal(askModel(null, false, 'muse-spark-1.3'), 'muse-spark-1.3');
});

// ------------------------------------------------------------------ route

const DOCUMENT = '7694558d-f7e2-4cbd-9355-978ec677b254';
const ANALYSIS = '1c3c4c62-0f45-4a4e-9a35-3d2b0c1d7e11';
const TOUR = '5a0d3f8e-7b8e-4c55-bb4c-0f2f1f8b9c3d';
function library(model: (r: Request) => unknown) {
  const query = async (text: string, values: unknown[] = []) => {
    if (text.startsWith('select * from documents'))
      return {
        rows:
          values[0] === DOCUMENT && values[1] === 'owner'
            ? [
                {
                  id: DOCUMENT,
                  owner_id: 'owner',
                  current_analysis_id: ANALYSIS,
                  tour_model: 'muse-spark-1.3',
                  tour_allow_training: false,
                },
              ]
            : [],
      };
    if (text.startsWith('select script,analysis_id from tours'))
      return { rows: values[0] === TOUR ? [{ script: tour, analysis_id: ANALYSIS }] : [] };
    if (text.startsWith('select id,doc from analyses'))
      return { rows: values[0] === ANALYSIS ? [{ id: ANALYSIS, doc }] : [] };
    if (text.includes('from assets')) return { rows: [] };
    throw new Error(`Unexpected query: ${text}`);
  };
  const db = { query, pool: { query } } as unknown as Database;
  const storage = {} as FileStorage;
  const muse = {
    resolveMuse: async (_owner: string, chosen?: string) => ({
      config: { ...settings, model: chosen ?? settings.model },
      source: 'app',
      version: 'v1',
    }),
    transport: provider(model),
  } as unknown as SettingsService;
  return new DocumentService(db, storage, async () => {}, 26214400, 'muse-spark-1.3', undefined, muse);
}

test('only the document’s owner may ask, and the answer comes back as steps', async () => {
  let language = '';
  const app = await createApp({
    service: library((r) => {
      language = /micro-tour in "([^"]+)"/.exec(r.task)?.[1] ?? '';
      return {
        plan: 'p',
        answerable: 'yes',
        steps: [
          {
            say: SCALE_SAY,
            cues: [{ action: 'highlight', target: 'p2.s4', label: '', anchor: 'The authors scale' }],
            board: NO_BOARD,
          },
        ],
        followups: ['What is d_k?', 'Does scaling change the results?'],
      };
    }),
    authenticate: async (token) => (token === 'owner' || token === 'stranger' ? token : null),
  });
  const post = (token: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/api/documents/${DOCUMENT}/ask`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  try {
    const question = { question: 'Why scale the dot products?', tourId: TOUR, stepId: 'method-1' };
    const denied = await post('stranger', question);
    assert.equal(denied.statusCode, 404);
    assert.equal(denied.json().error.code, 'not_found');
    const answered = await post('owner', question);
    assert.equal(answered.statusCode, 200);
    const body = answered.json();
    assert.equal(body.answerable, 'yes');
    assert.deepEqual(body.followups, ['What is d_k?', 'Does scaling change the results?']);
    assert.deepEqual(body.steps[0].actions[0], { type: 'focus', target: 'p2.s4' });
    assert.equal(language, 'en-GB', 'answers speak the tour’s language');
    const unknownTour = await post('owner', { ...question, tourId: ANALYSIS });
    assert.equal(unknownTour.statusCode, 404);
    for (const payload of [
      { question: '' },
      { question: 'x'.repeat(501) },
      { question: 'Why?', history: Array(5).fill({ question: 'a', answer: 'b' }) },
    ])
      assert.equal((await post('owner', payload)).statusCode, 400);
    assert.equal((await post('owner', { question: '   ' })).json().error.code, 'invalid_question');
  } finally {
    await app.close();
  }
});
