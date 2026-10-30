import test from 'node:test';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { Action, BBox, Doc, Step, Tour } from '../../shared/paper';
import { createApp, demoAllowed } from '../src/app';
import { ROOT, type MuseConfig } from '../src/config';
import type { Database } from '../src/db';
import { HttpError, ProcessingError } from '../src/errors';
import { MuseClient } from '../src/muse/client';
import { DocumentService } from '../src/service';
import type { SettingsService } from '../src/settings';
import type { FileStorage } from '../src/storage';
import type { TourImage } from '../src/tour-generator';
import {
  answerQuestion,
  answerSchema,
  answerVisualProblems,
  askEffort,
  askError,
  askModel,
  boardFromAnswer,
  demoImage,
  evidenceText,
  loadDemo,
  retrieve,
  spoken,
  withSink,
  type AskRequest,
  type AskAnswer,
} from '../src/harness/ask';
import { BOARD_KINDS, boardSchema } from '../src/harness/board';
import { paperBlock } from '../src/harness/paper-block';
import { BOARD_EXAMPLES, SHARED_RULES } from '../src/harness/prompts';
import { ENUM_ROOM, enumValues } from '../src/harness/schema-budget';
import type { MeasuredTarget } from '../src/harness/visual-grounding';

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
const block = (
  id: string,
  type: 'heading' | 'paragraph' | 'equation' | 'table_text',
  sentences: string[],
  section: string,
) => ({
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
    // The cells of Table 2, inside its box.
    ...['Model EN-DE EN-FR', 'Big 28.4 41.8', 'Base 27.3 38.1'].map((text, i) => ({
      ...block(`p3.b${i + 3}`, 'table_text', [], 'sec-6'),
      bbox: [10, 310 + 25 * i, 390, 330 + 25 * i] as BBox,
      text,
    })),
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
const ask = (
  request: AskRequest,
  model: (r: Request) => unknown,
  extra: {
    tour?: Tour;
    image?: TourImage;
    images?: TourImage[];
    measureFigure?: (image: TourImage, signal?: AbortSignal) => Promise<MeasuredTarget[]>;
  } = {},
) =>
  answerQuestion({
    client: new MuseClient(settings, provider(model)),
    measureFigure: async () => [],
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
  assert.deepEqual(
    scale.ranked.slice(0, 2).map((p) => p.id),
    ['p2.s3', 'p2.s4'],
    'the best match ("To counteract this effect, …") comes with the sentence that says what the effect is',
  );
  assert.ok(scale.visuals.includes('eq1'), 'the equation is matched through the sentences around it');
  assert.ok(!scale.sentences.includes('p1.s1'));
});

test('a question for a number prefers passages that print one, and "how long" is not about length', () => {
  const ranked = retrieve(doc, {
    question: 'How long does the big model train, and how many BLEU does it get?',
  }).ranked;
  assert.equal(ranked[0].id, 'p3.s1');
  // Extracted captions often start with their own label; the model reads it once.
  const labelled = { ...doc, figures: doc.figures.map((f) => ({ ...f, caption: `Fig. ${f.number}. ${f.caption}` })) };
  assert.equal(
    retrieve(labelled, { question: 'What does Figure 1 show?' }).focus[0].text,
    'Figure 1: The Transformer model architecture with its encoder and decoder stacks.',
  );
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
  assert.equal(seen!.effort, 'minimal', 'a question answered from a passage needs no reasoning budget');
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
    '',
  );
  assert.equal(good?.item.kind, 'formula');
  assert.deepEqual(good?.item.kind === 'formula' ? good.item.terms.map((t) => t.latex) : [], ['QK^T', '\\sqrt{d_k}']);
  assert.deepEqual(good?.focus, [1, say.split(' ').indexOf('square')]);
  const notInFormula = formula(latex, [
    { latex: 'QK^T', label: 'scores', anchor: '' },
    { latex: '\\sqrt{d}', label: 'scale', anchor: '' },
  ]);
  assert.equal(boardFromAnswer(notInFormula, say, ''), null);
  const broken = formula('\\frac{QK^T}{\\sqrt{d_k}', [
    { latex: 'QK^T', label: 'scores', anchor: '' },
    { latex: '\\sqrt{d_k}', label: 'scale', anchor: '' },
  ]);
  assert.equal(boardFromAnswer(broken, say, ''), null);
  assert.equal(boardFromAnswer(NO_BOARD, say, ''), null);
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

test('bars keep only numbers printed in what the model was shown, and long labels are refused, not cut', () => {
  const bars = (values: number[], labels = ['Big', 'Base']) => ({
    ...NO_BOARD,
    kind: 'bars',
    unit: 'BLEU',
    bars: values.map((value, i) => ({ label: labels[i], value, anchor: i ? 'the base' : 'The big' })),
  });
  const evidence = 'The big model reaches 28.4 BLEU, the base model 27.3 BLEU (WMT 2014).';
  const say = 'The big model beats the base one.';
  const board = boardFromAnswer(bars([28.4, 27.3]), say, evidence);
  assert.deepEqual(board?.item, {
    kind: 'bars',
    unit: 'BLEU',
    higher_is_better: true,
    bars: [
      { label: 'Big', value: 28.4 },
      { label: 'Base', value: 27.3 },
    ],
  });
  assert.deepEqual(board?.focus, [0, 4]);
  assert.equal(boardFromAnswer(bars([28.4, 31.7]), say, evidence), null, 'an invented number');
  assert.equal(boardFromAnswer(bars([28.4, 27.3], ['Big', 'The base model with six layers']), say, evidence), null);
});

test('a flow keeps the arrows the model drew and lights each stage as the voice names it', () => {
  const say = 'Tokens are embedded, attend to each other, then pass a feed-forward layer or a skip connection.';
  const flow = (labels: string[], edges: [string, string][] = []) => ({
    ...NO_BOARD,
    kind: 'flow',
    title: 'One encoder layer',
    nodes: labels.map((label, i) => ({
      label,
      anchor: ['are embedded', 'attend to each', 'feed-forward layer', 'skip connection'][i],
    })),
    edges: edges.map(([from, to]) => ({ from, to })),
  });
  const branch: [string, string][] = [
    ['node-1', 'node-2'],
    ['node-2', 'node-3'],
    ['node-2', 'node-4'],
  ];
  const board = boardFromAnswer(flow(['Embed', 'Self-attention', 'Feed-forward', 'Skip'], branch), say, '');
  assert.deepEqual(board?.item, {
    kind: 'flow',
    title: 'One encoder layer',
    nodes: [
      { id: 'node-1', label: 'Embed' },
      { id: 'node-2', label: 'Self-attention' },
      { id: 'node-3', label: 'Feed-forward' },
      { id: 'node-4', label: 'Skip' },
    ],
    edges: branch,
  });
  assert.deepEqual(board?.focus, [1, 3, 10, 14]);
  const dropped: string[][] = [];
  const rules = { dropped: (_: string, problems: string[]) => dropped.push(problems) };
  // Without arrows the stages are a plain chain, which a list says as well as a flow: the visual rules of a tour step.
  assert.equal(boardFromAnswer(flow(['Embed', 'Self-attention', 'Feed-forward']), say, '', rules), null);
  assert.match(dropped[0][0], /simple chain/);
  assert.equal(boardFromAnswer(flow(['Embed', 'Attend']), say, ''), null, 'two stages are not a flow');
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
    { type: 'arrow', target: 'fig1.a', region: [0, 0, 0.4, 0.4], color: 'pink' },
    {
      type: 'circle',
      target: 'fig1',
      region: [0.5, 0, 1, 1],
      color: 'pink',
      at_word: say.split(' ').indexOf('decoder') - 1,
    },
  ]);
  await assert.rejects(ask({ question: 'What is on the left?', figureId: 'fig1' }, model), /no usable answer/);
  assert.deepEqual(regions, ['whole']);
});

test('Q&A repairs measured highlight and spotlight requests instead of dropping their geometry', async () => {
  const measured: MeasuredTarget = {
    id: 'measured:fig1:1',
    target: 'fig1',
    kind: 'component',
    label: 'Attention',
    region: [0.55, 0.4, 0.79, 0.47],
  };
  const image: TourImage = {
    targetId: 'fig1',
    kind: 'figure',
    page: 1,
    label: 'Figure 1',
    dataUrl: 'data:image/png;base64,AA==',
  };
  const say =
    'The middle orange block combines information from all input positions, so the decoder can select useful source features.';
  const value = (action: string, anchor = 'middle orange block') => ({
    plan: 'Explain the visible module.',
    answerable: 'yes',
    steps: [{ say, cues: [{ action, target: measured.id, region: 'whole', label: '', anchor }], board: NO_BOARD }],
    followups: [],
  });
  for (const wrong of ['highlight', 'spotlight', 'missing-anchor']) {
    let calls = 0;
    const result = await ask(
      { question: 'Highlight the attention module in Figure 1.', figureId: 'fig1' },
      (request) => {
        assert.ok(
          !request.schema.properties.steps.items.properties.cues.items.properties.action.enum.includes('spotlight'),
        );
        if (++calls === 1) return wrong === 'missing-anchor' ? value('box', 'words not spoken here') : value(wrong);
        assert.match(
          request.task,
          wrong === 'missing-anchor' ? /anchor copied from the spoken/ : /use box for a measured component/,
        );
        return value('box');
      },
      { image, measureFigure: async () => [measured] },
    );
    assert.equal(calls, 2);
    assert.deepEqual(result.answer.steps[0].actions, [
      { type: 'zoom', target: 'fig1' },
      { type: 'box', target: 'fig1', region: measured.region, color: 'pink', at_word: 1 },
    ]);
  }
  let failedCalls = 0;
  await assert.rejects(
    ask(
      { question: 'Highlight the module.', figureId: 'fig1' },
      () => {
        failedCalls++;
        return value('highlight');
      },
      { image, measureFigure: async () => [measured] },
    ),
    /no usable answer/,
  );
  assert.equal(
    failedCalls,
    2,
    'bad measured actions stop after one repair, rather than return narration without the requested mark',
  );
});

test('narration is cleaned for the voice and kept to 100 words, cut after a whole sentence', () => {
  assert.equal(
    spoken('The scale is $\\sqrt{d_k}$, and a run costs $5 in C#.'),
    'The scale is square root of d k, and a run costs $5 in C#.',
  );
  const sentence = 'Attention lets every token look at all the other tokens at once.'; // 12 words
  const said = spoken(Array(10).fill(sentence).join(' '));
  assert.equal(said, Array(8).fill(sentence).join(' '));
  assert.equal(said.split(' ').length, 96);
  // A first sentence too long to cut after is cut at 100 words and closed with a full stop.
  const rambling = spoken(Array(110).fill('word').join(' '));
  assert.equal(rambling, `${Array(100).fill('word').join(' ')}.`);
});

test('a task or part of an exercise sheet the question names comes into focus', () => {
  const sheet: Doc = {
    ...doc,
    exercises: [
      {
        id: 'ex1',
        number: '1',
        page: 2,
        block: 'p2.b1',
        blocks: ['p2.b1', 'p2.b2', 'p2.b4'],
        parts: [
          { id: 'ex1.a', label: 'a', page: 2, blocks: ['p2.b2'] },
          { id: 'ex1.b', label: 'b', page: 2, blocks: ['p2.b4'] },
        ],
      },
    ],
  };
  for (const question of ['How do I start task 1b?', 'Wie fange ich Aufgabe 1 (b) an?', 'Exercise 1.b: what is asked?'])
    assert.deepEqual(
      retrieve(sheet, { question }).focus.map((p) => p.id),
      ['p2.s3', 'p2.s4'],
      question,
    );
  assert.equal(retrieve(sheet, { question: 'What is task 1 about?' }).home, 'p2.s1');
  assert.deepEqual(retrieve(sheet, { question: 'Is task 2 harder?' }).focus, [], 'no task 2 on this sheet');
});

test('the narration never reads element IDs aloud', () => {
  assert.equal(
    spoken('The scale keeps the softmax soft [p2.s4], as Equation one shows (eq1).'),
    'The scale keeps the softmax soft, as Equation one shows.',
  );
  assert.equal(spoken('A display without a number (equ2) sets the dose.'), 'A display without a number sets the dose.');
});

test('a follow-up searches with the exchange it builds on', () => {
  const question = 'And why does that slow learning?';
  assert.deepEqual(retrieve(doc, { question }).ranked, [], 'alone, the follow-up matches nothing');
  const history = [
    {
      question: 'Why scale the dot products?',
      answer: 'Without the scale, large dot products push the softmax into regions with tiny gradients.',
    },
  ];
  const ranked = retrieve(doc, { question, history }).ranked.map((p) => p.id);
  assert.ok(ranked.slice(0, 2).includes('p2.s3'), ranked.join(', '));
});

test('a table in focus brings its cells, and a bars board may chart numbers from them', async () => {
  let task = '';
  const say =
    'Table two compares the big and the base model. On English to French the big model reaches the higher score.';
  const { answer } = await ask({ question: 'What does Table 2 compare?' }, (r) => {
    task = r.task;
    return {
      plan: 'p',
      answerable: 'yes',
      steps: [
        {
          say,
          cues: [
            { action: 'box', target: 'tab2', region: 'whole', label: 'BLEU scores', anchor: 'Table two compares' },
          ],
          board: {
            ...NO_BOARD,
            kind: 'bars',
            title: 'BLEU on English-French',
            unit: 'BLEU',
            bars: [
              { label: 'Big', value: 41.8, anchor: 'the big model reaches' },
              { label: 'Base', value: 38.1, anchor: 'the base model' },
            ],
          },
        },
      ],
      followups: [],
    };
  });
  assert.ok(task.includes('CELLS OF [tab2]') && task.includes('Big 28.4 41.8'), task);
  const [step] = answer.steps;
  assert.deepEqual(types(step), ['zoom', 'board', 'board_focus', 'board_focus', 'box']);
  const board = step.actions.find((a) => a.type === 'board');
  assert.deepEqual(board?.type === 'board' && board.item.kind === 'bars' ? board.item.bars : [], [
    { label: 'Big', value: 41.8 },
    { label: 'Base', value: 38.1 },
  ]);
});

test('an answer that says it cannot answer is retried once at medium effort', async () => {
  const efforts: string[] = [];
  const { answer, completions } = await ask({ question: 'How many GPUs did they use?' }, (r) => {
    efforts.push(r.effort);
    const answerable = r.effort === 'medium' ? 'partly' : 'no';
    return { plan: 'p', answerable, steps: [{ say: SCALE_SAY, cues: [], board: NO_BOARD }], followups: [] };
  });
  assert.deepEqual(efforts, ['minimal', 'medium']);
  assert.equal(answer.answerable, 'partly');
  assert.equal(completions.length, 2);
  // The first answer survives a failed retry.
  const kept = await ask({ question: 'How many GPUs did they use?' }, (r) =>
    r.effort !== 'medium'
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
function library(
  model: (r: Request) => unknown,
  options: { doc?: Doc; storage?: FileStorage; currentAnalysisId?: string; analysisQueries?: string[] } = {},
) {
  const query = async (text: string, values: unknown[] = []) => {
    if (text.startsWith('select * from documents'))
      return {
        rows:
          values[0] === DOCUMENT && values[1] === 'owner'
            ? [
                {
                  id: DOCUMENT,
                  owner_id: 'owner',
                  current_analysis_id: options.currentAnalysisId ?? ANALYSIS,
                  upload_path: `owner/${DOCUMENT}/original.pdf`,
                  tour_model: 'muse-spark-1.3',
                  tour_allow_training: false,
                },
              ]
            : [],
      };
    if (text.startsWith('select script,analysis_id from tours'))
      return { rows: values[0] === TOUR ? [{ script: tour, analysis_id: ANALYSIS }] : [] };
    if (text.startsWith('select id,doc from analyses')) {
      options.analysisQueries?.push(String(values[0]));
      return {
        rows: values[0] === ANALYSIS && values[1] === DOCUMENT ? [{ id: ANALYSIS, doc: options.doc ?? doc }] : [],
      };
    }
    if (text.includes('from assets')) return { rows: [] };
    throw new Error(`Unexpected query: ${text}`);
  };
  const db = { query, pool: { query } } as unknown as Database;
  const storage = options.storage ?? ({} as FileStorage);
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
    assert.equal((await post('owner', { question: 'Why scale the dot products? '.repeat(100) })).statusCode, 200);
    for (const payload of [
      { question: '' },
      { question: 'Why?', history: Array(5).fill({ question: 'a', answer: 'b' }) },
    ])
      assert.equal((await post('owner', payload)).statusCode, 400);
    assert.equal((await post('owner', { question: '   ' })).json().error.code, 'invalid_question');
  } finally {
    await app.close();
  }
});

// ------------------------------------------------------------ demo papers

/** A demo root like demo/: a paper, a paper that links to its files, and one whose doc.json links outside the root. */
async function demoFolders() {
  const root = await mkdtemp(join(tmpdir(), 'paper-tour-demo-'));
  const outside = await mkdtemp(join(tmpdir(), 'paper-tour-outside-'));
  await mkdir(join(root, 'paper', 'figures'), { recursive: true });
  await writeFile(join(root, 'paper', 'doc.json'), JSON.stringify(doc));
  await writeFile(join(root, 'paper', 'tour.json'), JSON.stringify(tour));
  await writeFile(join(root, 'paper', 'figures', 'fig1.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  await mkdir(join(root, 'linked'));
  await symlink('../paper/doc.json', join(root, 'linked', 'doc.json'));
  await writeFile(join(outside, 'doc.json'), JSON.stringify(doc));
  await mkdir(join(root, 'escape'));
  await symlink(join(outside, 'doc.json'), join(root, 'escape', 'doc.json'));
  return {
    root,
    async remove() {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    },
  };
}

/** The library with only what demo questions use: the server's own Meta settings, never the database or storage. */
function demoLibrary(model: (r: Request) => unknown, root: string, apiKey = settings.apiKey) {
  const never = async () => {
    throw new Error('Demo questions never touch the database.');
  };
  const db = { query: never, pool: { query: never } } as unknown as Database;
  const muse = { base: { ...settings, apiKey }, transport: provider(model) } as unknown as SettingsService;
  const service = new DocumentService(
    db,
    {} as FileStorage,
    async () => {},
    26214400,
    'muse-spark-1.3',
    undefined,
    muse,
  );
  service.demoRoot = root;
  return service;
}

test('demo papers load only from folders inside the demo root', async () => {
  const demo = await demoFolders();
  try {
    assert.equal((await loadDemo('paper', demo.root))?.tour?.title, 'A tour');
    const linked = await loadDemo('linked', demo.root);
    assert.equal(linked?.doc.source.title, doc.source.title, 'a link to another demo folder is fine');
    assert.equal(linked?.tour, undefined);
    for (const name of ['escape', 'missing', '..', '../paper', 'paper/../paper', '.hidden', ''])
      assert.equal(await loadDemo(name, demo.root), null, name);
    const image = await demoImage('paper', doc, 'fig1.a', demo.root);
    assert.equal(image?.targetId, 'fig1');
    assert.ok(image?.dataUrl.startsWith('data:image/png;base64,'));
    const escaping = { ...doc, figures: [{ ...doc.figures[0], image: '../escape/doc.json' }] };
    assert.equal(await demoImage('paper', escaping, 'fig1', demo.root), undefined);
  } finally {
    await demo.remove();
  }
});

test('asking needs a sign-in, and demo questions exist only in local development', async () => {
  assert.equal(demoAllowed({}), true, 'config.ts listens on 127.0.0.1 by default');
  assert.equal(demoAllowed({ HOST: 'localhost', NODE_ENV: 'development' }), true);
  assert.equal(demoAllowed({ NODE_ENV: 'production' }), false);
  assert.equal(demoAllowed({ HOST: '0.0.0.0' }), false, 'a server reachable from other machines');
  const app = await createApp({ service: library(() => ({})), authenticate: async () => null, demo: false });
  try {
    const anonymous = await app.inject({
      method: 'POST',
      url: `/api/documents/${DOCUMENT}/ask`,
      payload: { question: 'Why scale the dot products?' },
    });
    assert.equal(anonymous.statusCode, 401);
    const demo = await app.inject({ method: 'POST', url: '/api/demo/paper/ask', payload: { question: 'Why?' } });
    assert.equal(demo.statusCode, 404);
  } finally {
    await app.close();
  }
});

test('demo questions read demo/<paper>/ with the server’s key, answer only this machine and refuse other paths', async () => {
  const demo = await demoFolders();
  let task = '';
  const model = (r: Request) => {
    task = r.task;
    return {
      plan: 'p',
      answerable: 'yes',
      steps: [
        {
          say: SCALE_SAY,
          cues: [{ action: 'highlight', target: 'p2.s4', region: 'whole', label: '', anchor: 'The authors scale' }],
          board: NO_BOARD,
        },
      ],
      followups: ['What is d_k?', 'Does scaling change the results?'],
    };
  };
  const app = await createApp({ service: demoLibrary(model, demo.root), authenticate: async () => null, demo: true });
  const question = { question: 'Why scale the dot products?', stepId: 'method-1' };
  const post = (url: string, extra: { remoteAddress?: string; headers?: Record<string, string> } = {}) =>
    app.inject({ method: 'POST', url, payload: question, ...extra });
  try {
    const answered = await post('/api/demo/paper/ask');
    assert.equal(answered.statusCode, 200, answered.body);
    assert.deepEqual(answered.json().steps[0].actions[0], { type: 'focus', target: 'p2.s4' });
    assert.ok(task.includes('THE TOUR WAS SAYING: Attention compares'), 'the demo tour gives the step');
    task = '';
    assert.equal((await post('/api/demo/missing/ask')).statusCode, 404);
    assert.equal((await post('/api/demo/escape/ask')).statusCode, 404);
    for (const url of ['/api/demo/..%2F..%2Fserver/ask', '/api/demo/.hidden/ask', '/api/demo/a..b/ask'])
      assert.equal((await post(url)).statusCode, 400, url);
    // A dot-dot segment never reaches the route at all.
    assert.equal((await post('/api/demo/%2E%2E/ask')).statusCode, 404);
    assert.equal((await post('/api/demo/paper/ask', { remoteAddress: '10.0.0.7' })).statusCode, 404);
    assert.equal((await post('/api/demo/paper/ask', { headers: { host: 'rebound.example:5174' } })).statusCode, 404);
    assert.equal(task, '', 'no refused request reached the model');
  } finally {
    await app.close();
    await demo.remove();
  }
});

test('a demo question without a server key says where the key goes', async () => {
  const demo = await demoFolders();
  const app = await createApp({
    service: demoLibrary(() => assert.fail('no model call without a key'), demo.root, ''),
    authenticate: async () => null,
    demo: true,
  });
  try {
    const response = await app.inject({ method: 'POST', url: '/api/demo/paper/ask', payload: { question: 'Why?' } });
    assert.equal(response.statusCode, 409);
    assert.match(response.json().error.message, /MODEL_API_KEY/);
  } finally {
    await app.close();
    await demo.remove();
  }
});

test('an explicit answer language reaches the writer and the returned voice metadata', async () => {
  let task = '';
  const result = await ask(
    { question: 'Explain the scaling.', responseLanguage: 'uk-UA' },
    (request) => {
      task = request.task;
      return { answerable: 'yes', steps: [{ say: SCALE_SAY, cues: [], board: NO_BOARD }], followups: [] };
    },
    { tour: { ...tour, voices: { host: { lang: 'de-DE' } } } },
  );
  assert.match(task, /micro-tour in "uk-UA"/);
  assert.match(task, /quotations in the original document language/);
  assert.equal(result.answer.language, 'uk-UA');
});

test('a copied answer is repaired once instead of reading a long source sentence aloud', async () => {
  const source = structuredClone(doc);
  const copied =
    'The encoder transforms each input into a contextual representation which the decoder can use to generate an output sequence.';
  source.sentences[0].text = copied;
  let calls = 0;
  const result = await answerQuestion({
    doc: source,
    documentId: 'doc-test',
    request: { question: 'Explain the encoder.' },
    language: 'en-US',
    client: new MuseClient(
      settings,
      provider(() => ({
        answerable: 'yes',
        steps: [{ say: ++calls === 1 ? copied : SCALE_SAY, cues: [], board: NO_BOARD }],
        followups: [],
      })),
    ),
  });
  assert.equal(calls, 2);
  assert.notEqual(result.answer.steps[0].say, copied);
  await assert.rejects(
    answerQuestion({
      doc: source,
      documentId: 'doc-test',
      request: { question: 'Explain the encoder.' },
      language: 'en-US',
      client: new MuseClient(
        settings,
        provider(() => ({ answerable: 'yes', steps: [{ say: copied, cues: [], board: NO_BOARD }], followups: [] })),
      ),
    }),
    /no usable answer/,
  );
});

test('region questions prioritize intersecting real source IDs while preserving paper, history and current narration', async () => {
  const selection = { page: 2, rect: [0, 0.16, 0.5, 0.19] as BBox };
  const focused = retrieve(doc, { question: 'Explain this region.', selection }, tour.chapters[0].steps[0]);
  assert.equal(focused.home, 'eq1');
  assert.equal(focused.focus[0].id, 'eq1');
  const images: TourImage[] = ['page2', 'selection-page2'].map((targetId) => ({
    targetId,
    kind: 'page',
    page: 2,
    label: targetId,
    dataUrl: `data:image/jpeg;base64,${Buffer.from(targetId).toString('base64')}`,
  }));
  let seen: Request | undefined;
  const result = await ask(
    {
      // Saying so outright is what brings the history and the narration into a question about a selection.
      question: 'What did you say about this region?',
      selection,
      stepId: 'method-1',
      history: [{ question: 'How are weights calculated?', answer: 'Using normalized scores.' }],
    },
    (r) => {
      seen = r;
      return {
        plan: 'Explain selected formula.',
        answerable: 'yes',
        steps: [
          {
            say: SCALE_SAY,
            board: NO_BOARD,
            cues: [
              { action: 'box', target: 'eq1', region: 'whole', label: '', anchor: 'The authors scale' },
              { action: 'box', target: 'selection-page2', region: 'whole', label: '', anchor: 'The authors scale' },
            ],
          },
        ],
        followups: [],
      };
    },
    { images, tour },
  );
  assert.equal(seen!.messages[1].content, `<DOCUMENT>\n${paperBlock(doc)}\n</DOCUMENT>`);
  assert.match(seen!.task, /SELECTED REGION: page 2/);
  assert.match(seen!.task, /Q: How are weights calculated/);
  assert.match(seen!.task, /THE TOUR WAS SAYING: Attention compares/);
  assert.equal(seen!.messages.at(-1).content.filter((part: any) => part.type === 'image_url').length, 2);
  const cueSchema = seen!.schema.properties.steps.items.properties.cues.items.properties;
  assert.ok(cueSchema.target.enum.includes('eq1'));
  assert.ok(!cueSchema.target.enum.includes('selection-page2'));
  assert.deepEqual(cueSchema.region.enum, ['whole'], 'crop coordinates are not figure-relative annotation regions');
  assert.ok(result.answer.steps[0].actions.some((a) => a.type === 'box' && a.target === 'eq1'));
  assert.ok(!result.answer.steps[0].actions.some((a) => 'target' in a && a.target === 'selection-page2'));
});

test('invalid selection requests return 400 before image access or model calls', async () => {
  let calls = 0;
  const app = await createApp({
    service: library(() => {
      calls++;
      throw new Error('must not call model');
    }),
    authenticate: async () => 'owner',
  });
  try {
    for (const selection of [
      null,
      { page: 0, rect: [0, 0, 1, 1] },
      { page: 4, rect: [0, 0, 1, 1] },
      { page: 1, rect: [0, 0, 2, 1] },
      { page: 1, rect: [0.5, 0, 0.5, 1] },
      { page: 1, rect: [1, 0, 0, 1] },
      { page: 1, rect: [0, 0, 1] },
      { page: 1, rect: [0, 0, 1, 1], image: 'data:image/png;base64,private' },
    ]) {
      const response = await app.inject({
        method: 'POST',
        url: `/api/documents/${DOCUMENT}/ask`,
        headers: { authorization: 'Bearer owner' },
        payload: { question: 'Explain it', selection },
      });
      assert.equal(response.statusCode, 400, response.body);
      assert.ok(!response.body.includes(settings.apiKey));
      assert.ok(!response.body.includes('data:image'));
    }
    assert.equal(calls, 0);
  } finally {
    await app.close();
  }
});

const selectionPython = process.env.PYTHON_BIN ?? resolve(ROOT, 'ingest/.venv/bin/python');
test(
  'the owned ask route uses the pinned analysis and sends real page/crop images from its original PDF',
  { skip: !existsSync(selectionPython) },
  async () => {
    const { stdout } = await promisify(execFile)(
      selectionPython,
      [
        '-I',
        '-c',
        'import pymupdf,base64; d=pymupdf.open(); [d.new_page(width=600,height=800) for _ in range(3)]; d[1].insert_text((30,140),"Attention = normalized scores times values"); print(base64.b64encode(d.tobytes()).decode())',
      ],
      { timeout: 10000 },
    );
    const pdf = Buffer.from(stdout.trim(), 'base64');
    const original = { ...doc, source: { ...doc.source, sha256: createHash('sha256').update(pdf).digest('hex') } };
    const downloads: string[] = [],
      queried: string[] = [];
    let seen: Request | undefined;
    const storage = {
      download: async (path: string) => {
        downloads.push(path);
        return pdf;
      },
    } as unknown as FileStorage;
    const service = library(
      (r) => {
        seen = r;
        return { plan: 'p', answerable: 'yes', steps: [{ say: SCALE_SAY, cues: [], board: NO_BOARD }], followups: [] };
      },
      { doc: original, storage, currentAnalysisId: '11111111-1111-4111-8111-111111111111', analysisQueries: queried },
    );
    const app = await createApp({ service, authenticate: async (token) => token });
    const payload = {
      question: 'Explain this region',
      analysisId: ANALYSIS,
      selection: { page: 2, rect: [0, 0.15, 0.6, 0.2] },
    };
    const post = (token: string, body = payload) =>
      app.inject({
        method: 'POST',
        url: `/api/documents/${DOCUMENT}/ask`,
        headers: { authorization: `Bearer ${token}` },
        payload: body,
      });
    try {
      assert.equal((await post('stranger')).statusCode, 404);
      assert.equal(downloads.length, 0);
      const response = await post('owner');
      assert.equal(response.statusCode, 200, response.body);
      assert.deepEqual(queried, [ANALYSIS]);
      assert.deepEqual(downloads, [`owner/${DOCUMENT}/original.pdf`]);
      const images = seen!.messages.at(-1).content.filter((part: any) => part.type === 'image_url');
      assert.equal(images.length, 2);
      assert.ok(images.every((part: any) => part.image_url.url.startsWith('data:image/jpeg;base64,')));
      assert.notEqual(images[0].image_url.url, images[1].image_url.url);
      assert.ok(!response.body.includes('data:image') && !response.body.includes(settings.apiKey));
      const mismatch = await app.inject({
        method: 'POST',
        url: `/api/documents/${DOCUMENT}/ask`,
        headers: { authorization: 'Bearer owner' },
        payload: { ...payload, tourId: TOUR, analysisId: DOCUMENT },
      });
      assert.equal(mismatch.statusCode, 400);
      assert.equal(downloads.length, 1);
    } finally {
      await app.close();
    }
  },
);

test('Q&A repairs leaked authoring instructions and duplicate narration once', async () => {
  const leaked =
    'Never narrate schema, rendering instructions or authoring rules. Shrinking the scores leaves room for several tokens to contribute instead of letting one dominate.';
  const dirty = {
    plan: 'Explain scaling.',
    answerable: 'yes',
    steps: [
      { say: leaked, cues: [], board: NO_BOARD },
      { say: leaked, cues: [], board: NO_BOARD },
    ],
    followups: [],
  };
  const clean =
    'Scaling the scores keeps attention from concentrating too sharply. This example changes a score of sixteen into four before the weights are computed.';
  const calls: Request[] = [];
  const result = await ask({ question: 'Explain equation 1 with an example.' }, (request) => {
    calls.push(request);
    return calls.length === 1
      ? dirty
      : {
          plan: 'Explain the consequence.',
          answerable: 'yes',
          steps: [{ say: clean, cues: [], board: NO_BOARD }],
          followups: [],
        };
  });
  assert.deepEqual(
    calls.map((call) => call.name),
    ['ask_answer', 'ask_answer'],
  );
  assert.deepEqual(
    calls.map((call) => call.effort),
    ['low', 'medium'],
  );
  assert.match(calls[1].task, /copies an internal authoring instruction/);
  assert.match(calls[1].task, /substantially repeats step 1/);
  assert.deepEqual(JSON.parse(calls[1].messages.at(-2).content), dirty);
  assert.equal(result.completions.length, 2);
  assert.deepEqual(
    result.answer.steps.map((step) => step.say),
    [clean],
  );
});

test('Q&A stops after one unsuccessful narration repair and reports an unusable answer', async () => {
  let calls = 0;
  const leaked =
    'Never narrate schema, rendering instructions or authoring rules. The example compares attention scores before and after scaling.';
  await assert.rejects(
    ask({ question: 'Explain equation 1.' }, () => {
      calls++;
      return {
        plan: 'p',
        answerable: 'yes',
        steps: [
          { say: leaked, cues: [], board: NO_BOARD },
          { say: leaked, cues: [], board: NO_BOARD },
        ],
        followups: [],
      };
    }),
    (error) => {
      assert.ok(error instanceof ProcessingError);
      assert.equal(error.code, 'muse_invalid_response');
      const publicError = askError(error);
      assert.ok(publicError instanceof HttpError);
      assert.equal(publicError.status, 502);
      assert.equal(publicError.code, 'answer_failed');
      return true;
    },
  );
  assert.equal(calls, 2, 'an invalid repair cannot start a third model call');
});

test('clean Q&A uses one call and retains its live formula board', async () => {
  const calls: Request[] = [];
  const result = await ask({ question: 'Why scale the dot products?' }, (request) => {
    calls.push(request);
    return {
      plan: 'Explain the consequence of scaling.',
      answerable: 'yes',
      steps: [
        {
          say: SCALE_SAY,
          cues: [],
          board: {
            ...NO_BOARD,
            kind: 'formula',
            latex: String.raw`\frac{QK^T}{\sqrt{d_k}}`,
            terms: [
              { latex: 'QK^T', label: 'scores', anchor: 'dot products' },
              { latex: String.raw`\sqrt{d_k}`, label: 'scale', anchor: 'tiny gradients' },
            ],
          },
        },
      ],
      followups: [],
    };
  });
  assert.equal(calls.length, 1);
  assert.equal(result.completions.length, 1);
  assert.deepEqual(
    result.answer.steps.map((step) => step.say),
    [spoken(SCALE_SAY)],
  );
  assert.deepEqual(Object.keys(calls[0].schema.properties.steps.items.properties), ['say', 'cues', 'board', 'example']);
  assert.ok(!calls[0].task.includes('Repair the answer:'));
  assert.ok(result.answer.steps[0].actions.some((action) => action.type === 'board' && action.item.kind === 'formula'));
  assert.ok(result.answer.steps[0].actions.some((action) => action.type === 'board_focus'));
});

test('measured diagram stays in view while a supporting passage on another page is highlighted', async () => {
  const measured: MeasuredTarget = {
    id: 'measured:fig1:1',
    target: 'fig1',
    kind: 'component',
    label: 'Attention',
    region: [0.55, 0.4, 0.79, 0.47],
  };
  const image: TourImage = {
    targetId: 'fig1',
    kind: 'figure',
    page: 1,
    label: 'Figure 1',
    dataUrl: 'data:image/png;base64,AA==',
  };
  const say =
    'The attention module mixes information from the inputs. The supporting explanation states why scaling keeps the scores from becoming too large.';
  const result = await ask(
    { question: 'Explain the attention module in Figure 1 and why the scores are scaled.', figureId: 'fig1' },
    () => ({
      plan: 'Explain the diagram with textual evidence.',
      answerable: 'yes',
      followups: [],
      steps: [
        {
          say,
          board: NO_BOARD,
          cues: [
            { action: 'box', target: measured.id, region: 'whole', label: '', anchor: 'attention module' },
            { action: 'highlight', target: 'p2.s4', region: 'whole', label: '', anchor: 'supporting explanation' },
          ],
        },
      ],
    }),
    { image, measureFigure: async () => [measured] },
  );
  const actions = result.answer.steps[0].actions;
  assert.deepEqual(
    actions.filter((a) => a.type === 'zoom' || a.type === 'focus'),
    [{ type: 'zoom', target: 'fig1' }],
  );
  assert.ok(actions.some((a) => a.type === 'box' && a.target === 'fig1' && a.region?.[0] === 0.55));
  assert.ok(
    actions.some((a) => a.type === 'highlight' && a.targets.includes('p2.s4')),
    'supporting evidence is retained without redirecting the camera',
  );
});

test('Q&A corrects a narrated numerical example into actual timed native values', async () => {
  const { exampleSay, numericalExample } = await import('./example-fixture');
  let calls = 0;
  const result = await ask({ question: 'Show a small worked numerical example.' }, (request) => {
    calls++;
    if (calls === 2) assert.match(request.task, /needs example frames/);
    return {
      plan: 'Illustrate a transformation.',
      answerable: 'yes',
      followups: [],
      steps: [
        {
          say: exampleSay,
          cues: [],
          board: NO_BOARD,
          ...(calls === 2 ? { example: numericalExample() } : {}),
        },
      ],
    };
  });
  assert.equal(calls, 2);
  const boards = result.answer.steps[0].actions.filter((a) => a.type === 'board');
  assert.deepEqual(
    boards.map((a) => a.item.kind === 'formula' && a.item.latex),
    [false, '2+2=4'],
  );
  assert.ok((boards[1].at_word ?? 0) > (boards[0].at_word ?? 0));
  let failures = 0;
  await assert.rejects(
    ask({ question: 'Show a worked numerical example.' }, () => {
      failures++;
      return { plan: 'p', answerable: 'yes', followups: [], steps: [{ say: exampleSay, cues: [], board: NO_BOARD }] };
    }),
    /no usable answer/,
  );
  assert.equal(failures, 2, 'a failed example ends after its one correction, without narration-only fallback');
});

test('Q&A cannot downgrade a failed worked example to static prose in its correction', async () => {
  const { exampleSay } = await import('./example-fixture');
  let attempts = 0;
  await assert.rejects(
    ask({ question: 'Explain a worked case.' }, () => ({
      plan: 'p',
      answerable: 'yes',
      followups: [],
      steps: [
        {
          say:
            ++attempts === 1
              ? exampleSay
              : 'The transformation combines each input with itself to increase the magnitude of the result.',
          cues: [],
          board: NO_BOARD,
        },
      ],
    })),
    /no usable answer/,
  );
  assert.equal(attempts, 2);
});

// ---------------------------------------------------------------- every board kind

/** A board as the answer schema asks for it: the item of its kind under the kind's name, and its parts to light up. */
const boardOf = (kind: string, data: unknown, focus: { part: string; anchor: string }[] = []) => ({
  [kind]: { ...(data as object), ...(focus.length ? { focus } : {}) },
});
const dropReasons = () => {
  const reasons: string[] = [];
  return { reasons, rules: { dropped: (kind: string, problems: string[]) => reasons.push(`${kind}: ${problems[0]}`) } };
};

test('an answer can draw any kind of the board registry, with the tour’s checks and the words each part is lit at', () => {
  const printed = (...lines: string[]) => lines.join('\n');
  const say = 'Each word looks at the others; the cat row shows it. Size against error flattens. Shapes keep n.';
  const heat = boardFromAnswer(
    boardOf(
      'heatmap',
      {
        kind: 'heatmap',
        title: 'BLEU by model',
        rows: ['Big', 'Base'],
        cols: ['EN-DE', 'EN-FR'],
        values: [
          [28.4, 41.8],
          [27.3, 38.1],
        ],
        source: 'document',
      },
      [{ part: 'row-2', anchor: 'the cat row' }],
    ),
    say,
    printed('Big 28.4 41.8', 'Base 27.3 38.1'),
  );
  assert.equal(heat?.item.kind, 'heatmap');
  assert.deepEqual(heat?.focus, [null, 6], 'row 2 is lit at "the cat row", the seventh word');
  const scatter = boardFromAnswer(
    boardOf('scatter', BOARD_EXAMPLES.scatter.scatter, [{ part: 'point-4', anchor: 'Size against error' }]),
    say,
    printed('tiny 5 28', 'small 22 21', 'medium 60 17', 'large 300 15'),
  );
  assert.equal(scatter?.item.kind, 'scatter');
  assert.equal(scatter?.focus.length, 4);
  assert.deepEqual(scatter?.focus, [null, null, null, 11]);
  const shapes = boardFromAnswer(boardOf('shapes', BOARD_EXAMPLES.shapes.shapes), say, '');
  assert.equal(shapes?.item.kind, 'shapes');
  const distribution = boardFromAnswer(
    boardOf('distribution', BOARD_EXAMPLES.distribution.distribution, [{ part: 'region', anchor: 'Shapes keep' }]),
    say,
    '',
  );
  assert.equal(distribution?.item.kind, 'distribution');
  assert.equal(distribution?.focus.length, 3, 'two distributions and the shaded region');
  const timeline = boardFromAnswer(
    boardOf('timeline', BOARD_EXAMPLES.timeline.timeline),
    say,
    printed(
      'Free returns end 30 days after delivery.',
      'The refund is paid within 14 days.',
      'The warranty lasts 2 years.',
    ),
  );
  assert.equal(timeline?.item.kind, 'timeline');
  const plot = boardFromAnswer(
    boardOf('plot', BOARD_EXAMPLES.plotMarks.plot, [{ part: 'mark-1', anchor: 'Shapes keep' }]),
    say,
    '',
  );
  assert.equal(plot?.item.kind, 'plot');
  assert.equal(plot?.focus.length, 3, 'two curves and a mark');
  assert.deepEqual(plot?.focus, [null, null, 15]);
});

test('the tour’s checks decide which boards are drawn: grounding, visual rules and a kind chosen without its data', () => {
  const say = 'The scores differ by model.';
  const { reasons, rules } = dropReasons();
  const draw = (kind: string, data: unknown, evidence = '') =>
    boardFromAnswer(boardOf(kind, data), say, evidence, rules);
  // Document values must be printed in what the model was shown.
  const heat = { ...BOARD_EXAMPLES.heatmap.heatmap, source: 'document' };
  assert.equal(draw('heatmap', heat, 'Nothing printed here.'), null);
  assert.match(reasons.at(-1)!, /^heatmap: values: not printed in the evidence/);
  assert.equal(draw('heatmap', heat, '46 3 1 9 38 3 0 2 48')?.item.kind, 'heatmap');
  // A scatter is measured quantities only, and its points are named after real items.
  assert.equal(draw('scatter', { ...BOARD_EXAMPLES.scatter.scatter, source: 'illustrative' }), null);
  assert.match(reasons.at(-1)!, /^scatter: a scatter shows quantities measured in the document/);
  const numbered = { ...BOARD_EXAMPLES.scatter.scatter };
  numbered.points = numbered.points.map((p, i) => ({ ...p, label: `point ${i + 1}` }));
  assert.equal(draw('scatter', numbered, '5 28 22 21 60 17 300 15'), null);
  assert.match(reasons.at(-1)!, /numbered placeholders/);
  // The same rules as a tour step: no plot of straight lines, no formula in words.
  const straight = { kind: 'plot', x: [0, 4], y: [0, 8], curves: [{ expression: '2*x', label: 'double' }] };
  assert.equal(draw('plot', straight), null);
  assert.match(reasons.at(-1)!, /straight line/);
  // A kind chosen with nothing in its object, or with a bad dimension, is not drawn.
  assert.equal(boardFromAnswer({ ...NO_BOARD, kind: 'timeline' }, say, '', rules), null);
  assert.equal(reasons.at(-1), 'timeline: it has no timeline data; fill it or set the kind to none');
  const dropped = reasons.length;
  assert.equal(boardFromAnswer({}, say, '', rules), null, 'an empty board is no board');
  assert.equal(reasons.length, dropped, 'and not a dropped one');
  const wrong = JSON.parse(JSON.stringify(BOARD_EXAMPLES.shapes.shapes));
  wrong.terms[2].rows = 'k';
  assert.equal(draw('shapes', wrong), null);
  assert.equal(boardFromAnswer(NO_BOARD, say, '', rules), null);
  assert.equal(reasons.at(-1)?.startsWith('shapes'), true, 'a board of "none" is not a dropped board');
});

test('a made-up case is called illustrative in its title, and a results question gets only the document’s numbers', () => {
  const say = 'The weights differ by word.';
  const grid = {
    kind: 'heatmap',
    title: 'Attention weights',
    rows: ['The', 'cat'],
    cols: ['The', 'cat'],
    values: [
      [0.7, 0.3],
      [0.2, 0.8],
    ],
    source: 'illustrative',
  };
  const labelled = boardFromAnswer(boardOf('heatmap', grid), say, '');
  assert.equal((labelled?.item as { title: string }).title, 'Attention weights (illustrative)');
  const said = boardFromAnswer(boardOf('heatmap', { ...grid, title: 'An invented case' }), say, '');
  assert.equal((said?.item as { title: string }).title, 'An invented case', 'a title that says so is kept');
  const untitled = boardFromAnswer(boardOf('heatmap', { ...grid, title: undefined }), say, '');
  assert.equal((untitled?.item as { title: string }).title, 'Illustrative values');
  const plot = boardFromAnswer(
    boardOf('plot', { ...BOARD_EXAMPLES.plot.plot, title: 'Response to the scale' }),
    say,
    '',
  );
  assert.equal((plot?.item as { title: string }).title, 'Response to the scale (illustrative)');
  // A results question: made-up values show nothing real.
  const { reasons, rules } = dropReasons();
  assert.equal(boardFromAnswer(boardOf('heatmap', grid), say, '', { ...rules, results: true }), null);
  assert.match(reasons[0], /this step reports the document’s results/);
});

test('the answer schema offers every board kind within the provider’s limits', () => {
  const schema = answerSchema(retrieve(doc, { question: 'Why scale the dot products?' })) as any;
  const board = schema.properties.steps.items.properties.board;
  // The item sits under the name of its kind, so a kind always brings its own data, and {} is no board.
  assert.deepEqual(Object.keys(board.properties).sort(), [...BOARD_KINDS].sort());
  assert.equal(board.required, undefined, 'a step needs no board');
  assert.equal(board.additionalProperties, false);
  assert.deepEqual(board.properties.formula.required, ['latex', 'terms']);
  for (const kind of BOARD_KINDS.filter((k) => !['formula', 'flow', 'bars', 'scene'].includes(k))) {
    const variant = board.properties[kind];
    // The tour's own schema, so an item the answer fills is an item the tour board and the player accept, plus the parts to light up.
    const { focus, ...fields } = variant.properties;
    assert.deepEqual(
      JSON.parse(JSON.stringify({ ...variant, properties: fields })),
      JSON.parse(JSON.stringify(boardSchema(kind))),
      kind,
    );
    const parts: string[] = focus.items.properties.part.enum;
    assert.ok(parts.length > 0 && parts.every((id) => /-\d+$|region/.test(id)), kind);
  }
  assert.deepEqual(board.properties.heatmap.properties.focus.items.properties.part.enum.slice(0, 2), [
    'row-1',
    'row-2',
  ]);
  assert.ok(enumValues(schema) <= ENUM_ROOM, `${enumValues(schema)} enum values`);
  // The provider caps nesting at ten levels: count the objects and arrays on the deepest path.
  const levels = (node: unknown): number =>
    !node || typeof node !== 'object'
      ? 0
      : Array.isArray(node)
        ? Math.max(0, ...node.map(levels))
        : ((node as { type?: string }).type === 'object' || (node as { type?: string }).type === 'array' ? 1 : 0) +
          Math.max(0, ...Object.values(node).map(levels));
  assert.ok(levels(schema) <= 10, `${levels(schema)} levels`);
});

test('a question picks its first effort: no reasoning budget for a lookup, a little for a calculation or an exercise', () => {
  assert.equal(askEffort({ question: 'Why are the dot products scaled?' }, doc), 'minimal');
  assert.equal(askEffort({ question: 'What does the figure show?', figureId: 'fig1' }, doc), 'minimal');
  for (const question of [
    'Calculate the attention weights for two tokens.',
    'Can you derive the variance of the dot product?',
    'Show an example with numbers',
    'Walk me through it step by step',
    'Berechne das Skalarprodukt',
  ])
    assert.equal(askEffort({ question }, doc), 'low', question);
  assert.equal(askEffort({ question: 'What is asked in task 1?' }, { ...doc, exercises: [{} as never] }), 'low');
});

const EVIDENCE_TOUR: Tour = {
  ...tour,
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
            { type: 'board', item: BOARD_EXAMPLES.shapes.shapes as never },
          ],
        },
      ],
    },
  ],
};

test('an answer does not redraw the board the tour just showed, and is told which it was', async () => {
  const calls: Request[] = [];
  const again = { ...BOARD_EXAMPLES.shapes.shapes };
  const result = await ask(
    { question: 'And how do the shapes combine?', stepId: 'method-1' },
    (request) => {
      calls.push(request);
      return {
        plan: 'p',
        answerable: 'yes',
        steps: [{ say: SCALE_SAY, cues: [], board: boardOf('shapes', again) }],
        followups: [],
      };
    },
    { tour: EVIDENCE_TOUR },
  );
  assert.match(calls[0].task, /BOARDS THE TOUR JUST SHOWED: shapes "A linear layer with ReLU"\./);
  assert.ok(!result.answer.steps[0].actions.some((a) => a.type === 'board'), 'the same picture is not drawn again');
  assert.ok(result.answer.steps[0].say.length > 0, 'the narration stays');
  // Another aspect of the same idea is a different picture.
  const other = await ask(
    { question: 'And how do the shapes combine?', stepId: 'method-1' },
    () => ({
      plan: 'p',
      answerable: 'yes',
      steps: [
        {
          say: SCALE_SAY,
          cues: [],
          board: boardOf('shapes', {
            ...BOARD_EXAMPLES.shapes.shapes,
            terms: [
              { kind: 'matrix', name: 'Q', rows: 'n', cols: 'd_k' },
              { kind: 'op', op: 'times' },
              { kind: 'matrix', name: 'K^T', rows: 'd_k', cols: 'n' },
              { kind: 'op', op: 'equals' },
              { kind: 'matrix', name: 'S', rows: 'n', cols: 'n' },
            ],
          }),
        },
      ],
      followups: [],
    }),
    { tour: EVIDENCE_TOUR },
  );
  assert.ok(other.answer.steps[0].actions.some((a) => a.type === 'board' && a.item.kind === 'shapes'));
});

test('a question about a table gets the document’s own numbers on a board of any kind, never made-up ones', async () => {
  const grid = (source: string) =>
    boardOf('heatmap', {
      kind: 'heatmap',
      title: 'BLEU by model',
      rows: ['Big', 'Base'],
      cols: ['EN-DE', 'EN-FR'],
      values: [
        [28.4, 41.8],
        [27.3, 38.1],
      ],
      source,
    });
  const answered = (source: string) =>
    ask({ question: 'How do the models compare in Table 2?' }, () => ({
      plan: 'p',
      answerable: 'yes',
      steps: [
        {
          say: 'The big model scores higher in both languages, by about one point in German.',
          cues: [],
          board: grid(source),
        },
      ],
      followups: [],
    }));
  const boards = (answer: AskAnswer) => answer.steps.flatMap((s) => s.actions).filter((a) => a.type === 'board');
  assert.equal(boards((await answered('document')).answer).length, 1);
  assert.equal(boards((await answered('illustrative')).answer).length, 0);
});

// ------------------------------------------------------- reading the answer while it is written

const SECOND_SAY =
  'Dividing by the square root of d_k keeps the variance of the scores near one, so the softmax stays in a range where its gradients are useful and the model keeps learning.';
const highlight = { action: 'highlight', target: 'p2.s4', region: 'whole', label: '', anchor: 'The authors scale' };
/** The fields in the order the provider writes them (alphabetical): the verdict first, a step's say last. */
const written = (steps: unknown[], answerable = 'yes') => ({
  answerable,
  followups: ['What is d_k?', 'Does scaling change the results?'],
  plan: 'Explain the scaling.',
  steps,
});
const firstStep = { board: NO_BOARD, cues: [highlight], say: SCALE_SAY };
const secondStep = { board: NO_BOARD, cues: [], say: SECOND_SAY };

/**
 * A provider that streams the answer in three pieces (up to the end of the first step, the second step, the rest), the
 * pieces `gap` ms apart; a request that does not stream, such as a retry, gets the next value as one JSON reply.
 */
function streaming(first: unknown, ...retries: unknown[]) {
  const seen: { stream: boolean; task: string; effort: string }[] = [];
  const transport = (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const last = body.messages.at(-1).content;
    seen.push({
      stream: body.stream === true,
      task: typeof last === 'string' ? last : last.map((p: { text?: string }) => p.text ?? '').join('\n'),
      effort: body.reasoning_effort,
    });
    const value = seen.length === 1 ? first : retries[seen.length - 2];
    if (!body.stream) return reply(value);
    const text = JSON.stringify(value);
    const steps = (value as { steps: unknown[] }).steps;
    const ends = steps.slice(0, 2).map((step) => text.indexOf(JSON.stringify(step)) + JSON.stringify(step).length);
    const pieces = [text.slice(0, ends[0]), text.slice(ends[0], ends[1] ?? ends[0]), text.slice(ends[1] ?? ends[0])];
    const chunk = (delta: object, finish: string | null = null) =>
      `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const encoder = new TextEncoder();
    return new Response(
      new ReadableStream({
        async start(controller) {
          for (const [i, piece] of pieces.entries()) {
            // The client hands its text on every half second; the pieces are further apart than that.
            if (i) await new Promise((resolve) => setTimeout(resolve, 600));
            controller.enqueue(encoder.encode(chunk({ content: piece })));
          }
          controller.enqueue(encoder.encode(chunk({}, 'stop')));
          const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ choices: [], usage })}\n\ndata: [DONE]\n\n`));
          controller.close();
        },
      }),
      { headers: { 'content-type': 'text/event-stream' } },
    );
  }) as typeof fetch;
  return { transport, seen };
}
const askStreaming = (
  transport: typeof fetch,
  onStep?: (...a: unknown[]) => void,
  request = 'Why scale the dot products?',
) =>
  answerQuestion({
    client: new MuseClient(settings, transport),
    measureFigure: async () => [],
    doc,
    documentId: 'doc-test',
    request: { question: request },
    language: 'en-US',
    ...(onStep ? { onStep: onStep as never } : {}),
  });

test('each step reaches the sink as soon as it is whole and checked, and the answer begins with those steps', async () => {
  const { transport, seen } = streaming(written([firstStep, secondStep]));
  const shown: { at: number; verdict: unknown; step: Step }[] = [];
  const started = Date.now();
  const { answer } = await askStreaming(transport, (verdict, step) =>
    shown.push({ at: Date.now() - started, verdict, step: step as Step }),
  );
  const finished = Date.now() - started;
  assert.equal(seen.length, 1);
  assert.equal(seen[0].stream, true);
  assert.equal(seen[0].effort, 'minimal');
  assert.deepEqual(
    shown.map((s) => s.step.say),
    [spoken(SCALE_SAY), spoken(SECOND_SAY)],
  );
  assert.ok(shown.every((s) => s.verdict === 'yes'));
  assert.ok(shown[0].at < finished - 400, `the first step came at ${shown[0].at} ms of ${finished}`);
  assert.deepEqual(
    answer.steps.map((step) => step.id),
    shown.map((s) => s.step.id),
    'the answer is the steps already sent',
  );
  assert.deepEqual(
    answer.steps,
    shown.map((s) => s.step),
  );
  assert.deepEqual(answer.followups, ['What is d_k?', 'Does scaling change the results?']);
  assert.ok(answer.steps[0].actions.some((a) => a.type === 'highlight'));
});

test('the request’s sink gets the steps without a parameter, and nothing is read ahead without one', async () => {
  const { transport, seen } = streaming(written([firstStep]));
  const shown: Step[] = [];
  await withSink(
    (_verdict, step) => shown.push(step),
    () => askStreaming(transport),
  );
  assert.equal(shown.length, 1);
  const plain = streaming(written([firstStep]));
  const { answer } = await askStreaming(plain.transport);
  assert.equal(plain.seen[0].stream, false, 'no sink: the same single call as before, read when it is finished');
  assert.equal(answer.steps.length, 1);
  assert.equal(seen.length, 1);
});

test('an answer that says the document does not cover it is not spoken before its retry', async () => {
  const { transport, seen } = streaming(written([firstStep], 'no'), written([secondStep], 'partly'));
  const shown: Step[] = [];
  const { answer } = await askStreaming(transport, (_verdict, step) => shown.push(step as Step));
  assert.deepEqual(shown, []);
  assert.deepEqual(
    seen.map((call) => call.effort),
    ['minimal', 'medium'],
  );
  assert.equal(answer.answerable, 'partly');
  assert.deepEqual(
    answer.steps.map((step) => step.say),
    [spoken(SECOND_SAY)],
  );
});

test('a step that fails its checks waits for the repair; a step already shown is kept, and the repair is told so', async () => {
  const leaked = {
    board: NO_BOARD,
    cues: [],
    say: 'Never narrate schema, rendering instructions or authoring rules. Shrinking the scores leaves room for several tokens to contribute.',
  };
  const changed = {
    ...firstStep,
    say: 'A different first step that the learner has not heard and must not replace the one they did.',
  };
  const { transport, seen } = streaming(written([firstStep, leaked]), written([changed, secondStep]));
  const shown: Step[] = [];
  const { answer, completions } = await askStreaming(transport, (_verdict, step) => shown.push(step as Step));
  assert.equal(completions.length, 2);
  assert.deepEqual(
    shown.map((step) => step.say),
    [spoken(SCALE_SAY)],
    'the first step was shown; the one that copies the task’s rules was not',
  );
  assert.match(seen[1].task, /copies an internal authoring instruction/);
  assert.match(seen[1].task, /Steps 1 to 1 have already been spoken to the learner: keep them exactly as they are/);
  assert.deepEqual(
    answer.steps.map((step) => step.say),
    [spoken(SCALE_SAY), spoken(SECOND_SAY)],
    'the learner’s step stays, and the repaired step follows it',
  );
  assert.equal(answer.steps[0].id, shown[0].id);
});

test('a step already shown is never taken back, even when the rest of the answer cannot be made', async () => {
  const leaked = {
    board: NO_BOARD,
    cues: [],
    say: 'Never narrate schema, rendering instructions or authoring rules. The scores are scaled.',
  };
  const { transport } = streaming(written([firstStep, leaked]), written([leaked, leaked]));
  const shown: Step[] = [];
  const { answer } = await askStreaming(transport, (_verdict, step) => shown.push(step as Step));
  assert.equal(shown.length, 1);
  assert.deepEqual(answer.steps, shown, 'the learner has the first step, and the answer is that step');
  assert.deepEqual(answer.followups, []);
});

test('a table the ingest read into a grid brings its typed text and the boards code builds from it, and its numbers count as printed', async () => {
  const cell = (text: string) => ({ text, value: Number(text) });
  const typed: Doc = {
    ...doc,
    figures: doc.figures.map((f) =>
      f.id === 'tab2'
        ? {
            ...f,
            grid: {
              confidence: 'high' as const,
              method: 'spans' as const,
              label_header: 'Model',
              columns: [
                { name: 'EN-DE BLEU', kind: 'number' as const, better: 'up' as const },
                { name: 'Cost (FLOPs)', kind: 'number' as const, better: 'down' as const },
              ],
              rows: [
                { label: 'Small', cells: [cell('25.1'), cell('3.3')] },
                { label: 'Base', cells: [cell('27.3'), cell('9.2')] },
                { label: 'Big', cells: [cell('28.4'), cell('23')] },
              ],
            },
          }
        : f,
    ),
  };
  const retrieval = retrieve(typed, { question: 'How does cost relate to quality in Table 2?' });
  const [table] = retrieval.tables;
  assert.match(table.text!, /^TABLE 2 \[tab2\]/);
  assert.deepEqual(
    table.views!.map((view) => view.kind),
    ['scatter', 'heatmap', 'bars'].filter((kind) => table.views!.some((view) => view.kind === kind)),
  );
  assert.ok(
    table.views!.some((view) => view.kind === 'scatter'),
    'two columns make a trade-off',
  );
  let task = '';
  const result = await answerQuestion({
    client: new MuseClient(
      settings,
      provider((request) => {
        task = request.task;
        const scatter = table.views!.find((view) => view.kind === 'scatter')!.item;
        return {
          plan: 'p',
          answerable: 'yes',
          steps: [
            {
              say: 'Quality rises with cost, but each doubling buys less: the big model costs about seven times the small one for three BLEU.',
              cues: [],
              board: boardOf('scatter', scatter),
            },
          ],
          followups: [],
        };
      }),
    ),
    measureFigure: async () => [],
    doc: typed,
    documentId: 'doc-test',
    request: { question: 'How does cost relate to quality in Table 2?' },
    language: 'en-US',
  });
  assert.match(task, /TABLE AS READ \(typed rows and columns/);
  assert.match(task, /READY BOARDS BUILT FROM THE TABLE BY CODE/);
  assert.match(task, /- scatter, /);
  assert.ok(!task.includes('CELLS OF [tab2]'), 'the typed text replaces the loose cell lines');
  const board = result.answer.steps[0].actions.find((a) => a.type === 'board');
  assert.equal(board?.type === 'board' && board.item.kind, 'scatter', 'a ready board is drawn as it is');
});

test('a board that fails its checks is corrected while an earlier step is spoken, and only dropped when no step is', async () => {
  const timeline = (source: string) => boardOf('timeline', { ...BOARD_EXAMPLES.timeline.timeline, source });
  const withBoard = (source: string) => ({ ...secondStep, board: timeline(source) });
  // Streaming: the first step is spoken at once, the second is held back for its board's correction.
  const { transport, seen } = streaming(
    written([firstStep, withBoard('document')]),
    written([firstStep, withBoard('illustrative')]),
  );
  const shown: Step[] = [];
  const { answer, completions } = await askStreaming(transport, (_verdict, step) => shown.push(step as Step));
  assert.equal(completions.length, 2);
  assert.deepEqual(
    shown.map((step) => step.say),
    [spoken(SCALE_SAY)],
    'the step with the failing board waits for its correction',
  );
  assert.equal(seen[1].effort, 'low', 'a board correction does not need the reasoning of an unusable answer’s retry');
  assert.match(seen[1].task, /Correct the boards below/);
  assert.match(seen[1].task, /Step 2: board timeline: events: not printed in the evidence/);
  assert.match(seen[1].task, /Steps 1 to 1 have already been spoken to the learner/);
  assert.deepEqual(
    answer.steps.map((step) => step.say),
    [spoken(SCALE_SAY), spoken(SECOND_SAY)],
  );
  assert.equal(answer.steps[0].id, shown[0].id);
  assert.ok(answer.steps[1].actions.some((a) => a.type === 'board' && a.item.kind === 'timeline'));
  // Without a listener no wait is hidden, so the board is simply not drawn: one call, as before.
  const plain = streaming(written([firstStep, withBoard('document')]));
  const quiet = await askStreaming(plain.transport);
  assert.equal(plain.seen.length, 1);
  assert.deepEqual(
    quiet.answer.steps.map((step) => step.say),
    [spoken(SCALE_SAY), spoken(SECOND_SAY)],
  );
  assert.ok(!quiet.answer.steps[1].actions.some((a) => a.type === 'board'));
});

test('a number printed anywhere in the document the model read may be charted, one printed nowhere may not', async () => {
  const retrieval = retrieve(doc, { question: 'Why scale the dot products?' });
  assert.ok(!retrieval.ranked.some((p) => p.id === 'p3.s1'), 'the result sentence was not retrieved for this question');
  const evidence = evidenceText(doc, retrieval);
  assert.ok(evidence.includes('28.4 BLEU') && evidence.includes('Recurrent models'), 'the whole document text');
  const bars = (values: number[]) => ({
    ...NO_BOARD,
    kind: 'bars',
    title: 'BLEU',
    unit: 'BLEU',
    bars: values.map((value, i) => ({ label: ['Big', 'Base'][i], value, anchor: 'the scores' })),
  });
  const say = 'The big model beats the base model on the scores.';
  assert.equal(boardFromAnswer(bars([28.4, 27.3]), say, evidence)?.item.kind, 'bars');
  assert.equal(boardFromAnswer(bars([28.4, 29.9]), say, evidence), null, 'an invented number');
});

test('a board written with a kind, as answers once were, is still read', () => {
  const say = 'The weights differ by word.';
  const grid = {
    kind: 'heatmap',
    title: 'An invented case',
    rows: ['The', 'cat'],
    cols: ['The', 'cat'],
    values: [
      [0.7, 0.3],
      [0.2, 0.8],
    ],
    source: 'illustrative',
  };
  const board = boardFromAnswer({ ...NO_BOARD, kind: 'heatmap', heatmap: grid }, say, '');
  assert.equal(board?.item.kind, 'heatmap');
  assert.equal(
    boardFromAnswer(boardOf('heatmap', grid), say, '')?.item.kind,
    'heatmap',
    'and the item under its name is the same board',
  );
  assert.equal(
    boardFromAnswer({ ...NO_BOARD, ...grid }, say, '')?.item.kind,
    'heatmap',
    'and so are its fields written flat',
  );
});

test('a chosen answer language goes with every step shown early, so the first one is spoken in it', async () => {
  const { transport } = streaming(written([firstStep, secondStep]));
  const languages: unknown[] = [];
  const { answer } = await answerQuestion({
    client: new MuseClient(settings, transport),
    measureFigure: async () => [],
    doc,
    documentId: 'doc-test',
    request: { question: 'Why scale the dot products?', responseLanguage: 'uk-UA' },
    language: 'en-US',
    onStep: (_verdict, _step, language) => languages.push(language),
  });
  assert.deepEqual(languages, ['uk-UA', 'uk-UA']);
  assert.equal(answer.language, 'uk-UA');
  const plain = streaming(written([firstStep]));
  const none: unknown[] = [];
  await askStreaming(plain.transport, (_verdict, _step, language) => none.push(language));
  assert.deepEqual(none, [undefined], 'without a chosen language the tour’s voice speaks');
});

test('a scene under its kind’s name is checked and sent back for correction like any scene', () => {
  const retrieval = retrieve(doc, { question: 'Why scale the dot products?' });
  const context = { doc, retrieval, documentId: 'doc-test', question: 'Why?', history: [], evidence: '' };
  const words = {
    kind: 'scene',
    objects: [{ id: 'a', type: 'text', x: 0.1, y: 0.1, w: 0.5, h: 0.1, text: 'Only words' }],
  };
  const problems = answerVisualProblems({ steps: [{ say: SCALE_SAY, cues: [], board: { scene: words } }] }, context);
  assert.match(problems.join(' '), /Step 1: .*meaningful quantitative transformation/);
  assert.deepEqual(answerVisualProblems({ steps: [{ say: SCALE_SAY, cues: [], board: NO_BOARD }] }, context), []);
});
