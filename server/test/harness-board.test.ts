import test from 'node:test';
import assert from 'node:assert/strict';
import type { MuseConfig } from '../src/config';
import type { Action, BBox, Doc, Step } from '../../shared/paper';
import type { TourGenerationInput, TourImage } from '../src/tour-generator';
import { HarnessTourGenerator } from '../src/harness/generator';
import { planBeats } from '../src/harness/beats';
import { findAnchor } from '../src/harness/assemble';
import { checkBars, checkFlow, checkFormula, numbersIn } from '../src/harness/board';
import { REGION_NAMES, regionOf } from '../src/harness/direct';
import { BOARD_EXAMPLES } from '../src/harness/prompts';

// Pen marks and the side board in the short-tour writer, end to end with a scripted model (no network).

const settings: MuseConfig = {
  apiKey: 'unit-test-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en-US',
  timeoutMs: 5000,
};
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=';
const texts: Record<string, string> = {
  'p1.s1': 'Reading a long paper alone is hard.',
  'p1.s2': 'We propose a tutor that points at the page while it explains.',
  'p1.s3': 'A planner sends each beat to a writer, then to a checker.',
  'p1.s4': 'Figure 1 shows the pipeline.',
  'p2.s1': 'Attention mixes the values by how well queries match keys.',
  'p2.s2': 'The tutor reaches 81.5% accuracy against 74.2% for plain reading (Table 1).',
  'p2.s3': 'However, messy layouts can still confuse the ingestion.',
  'p2.s4': 'In conclusion, short tours that point teach better.',
};
const rect = (x0: number, y0: number, x1: number, y1: number): BBox => [x0, y0, x1, y1];
const sentence = (id: string) => ({
  id,
  page: Number(id[1]),
  block: `p${id[1]}.b2`,
  text: texts[id],
  rects: [rect(0, 0, 100, 10)],
});
const cell = (id: string, y: number, text: string) => ({
  id,
  page: 2,
  type: 'table_text' as const,
  bbox: rect(10, y, 390, y + 18),
  text,
  sentences: [],
});
const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: {
    file: 'paper.pdf',
    sha256: 'c'.repeat(64),
    num_pages: 2,
    generator: 'test',
    title: 'Tutoring with pointers',
  },
  pages: [
    { n: 1, width: 600, height: 800 },
    { n: 2, width: 600, height: 800 },
  ],
  sections: [
    { id: 'sec-1', number: '1', title: 'Introduction', level: 1, page: 1, block: 'p1.b1' },
    { id: 'sec-2', number: '2', title: 'Method', level: 1, page: 2, block: 'p2.b1' },
  ],
  blocks: [
    {
      id: 'p1.b1',
      page: 1,
      type: 'heading',
      bbox: rect(0, 0, 100, 10),
      text: '1 Introduction',
      section: 'sec-1',
      sentences: [],
    },
    {
      id: 'p1.b2',
      page: 1,
      type: 'paragraph',
      bbox: rect(0, 20, 500, 120),
      text: '',
      section: 'sec-1',
      sentences: ['p1.s1', 'p1.s2', 'p1.s3', 'p1.s4'],
    },
    {
      id: 'p2.b1',
      page: 2,
      type: 'heading',
      bbox: rect(0, 0, 100, 10),
      text: '2 Method',
      section: 'sec-2',
      sentences: [],
    },
    {
      id: 'p2.b2',
      page: 2,
      type: 'paragraph',
      bbox: rect(0, 20, 500, 120),
      text: '',
      section: 'sec-2',
      sentences: ['p2.s1', 'p2.s2', 'p2.s3', 'p2.s4'],
    },
    {
      id: 'p2.b3',
      page: 2,
      type: 'equation',
      bbox: rect(0, 130, 300, 150),
      text: 'y = softmax(QKT √dk )V',
      sentences: [],
    },
    cell('p2.b4', 305, 'Reading mode Accuracy (%)'),
    cell('p2.b5', 325, 'Plain reading [12] 74.2'),
    cell('p2.b6', 345, 'Tutor tour (no pointing) 77.0'),
    cell('p2.b7', 365, 'Tutor tour 81.5'),
    // Table text outside the table's box belongs to something else: its numbers are not this table's evidence.
    cell('p2.b8', 600, 'Other system 99.9'),
  ],
  sentences: Object.keys(texts).map(sentence),
  figures: [
    {
      id: 'fig1',
      kind: 'figure',
      number: '1',
      page: 1,
      bbox: rect(0, 200, 400, 500),
      caption: 'The pipeline',
      image: 'figures/fig1.png',
      panels: [{ id: 'fig1.a', bbox: rect(0, 200, 200, 500), label: '(a)' }],
      referenced_by: ['p1.s4'],
    },
    {
      id: 'tab1',
      kind: 'table',
      number: '1',
      page: 2,
      bbox: rect(0, 300, 400, 400),
      caption: 'Accuracy of each reading mode',
      image: 'figures/tab1.png',
      panels: [],
      referenced_by: ['p2.s2'],
    },
  ],
  equations: [
    { id: 'eq1', number: '1', page: 2, bbox: rect(0, 130, 300, 150), block: 'p2.b3', text: 'y = softmax(QKT √dk )V' },
  ],
};
const images: TourImage[] = [
  { targetId: 'page1', kind: 'page', page: 1, label: 'Page 1', dataUrl: png },
  { targetId: 'page2', kind: 'page', page: 2, label: 'Page 2', dataUrl: png },
  { targetId: 'fig1', kind: 'figure', page: 1, label: 'Figure 1', dataUrl: png },
  { targetId: 'tab1', kind: 'table', page: 2, label: 'Table 1', dataUrl: png },
];
const input: TourGenerationInput = { documentId: 'doc-test', analysisId: 'analysis-test', doc, images };
const card = {
  plan: 'p',
  doc_type: 'research_paper' as const,
  title: 'Tutoring with pointers',
  chapter_titles: {
    problem: 'Problem',
    idea: 'Idea',
    method: 'How it works',
    evidence: 'Evidence',
    limits: 'Limits',
    takeaway: 'Takeaway',
  },
  problem: { text: 'Reading papers alone is hard.', evidence: ['p1.s1'] },
  key_idea: { text: 'A tutor points at the page while it explains.', evidence: ['p1.s2'] },
  method_steps: [{ text: 'A planner sends beats to a writer and a checker.', evidence: ['p1.s3'] }],
  key_figures: [
    { id: 'fig1', why: 'It shows the pipeline.' },
    { id: 'tab1', why: 'It compares reading modes.' },
  ],
  key_formulas: [{ id: 'eq1', why: 'It mixes values by attention.' }],
  results: [{ text: 'The tutor reaches 81.5% accuracy.', evidence: ['p2.s2'] }],
  limitations: [{ text: 'Messy layouts still confuse ingestion.', evidence: ['p2.s3'] }],
  takeaway: { text: 'Short tours that point teach better.', evidence: ['p2.s4'] },
  suggested_questions: ['Why point?', 'How short is a tour?', 'What still fails?'],
};

const SAY =
  'This step explains the point clearly so that a student can follow every part of it while the page moves along.';
const FORMULA_SAY =
  'This formula mixes the values by how well queries match keys. Q times K transposed scores every pair. Dividing by the square root of d k keeps those scores in range. The weights then mix the values V into the output.';
const FIGURE_SAY =
  'The figure shows the whole pipeline. The planner sits at the top left, the first panel holds the writer, and the checker waits at the bottom before anything is shown.';
const TABLE_SAY =
  'The table compares reading modes. Plain reading reaches 74.2 percent, while the full tutor tour reaches 81.5 percent, the best accuracy in the table.';
const METHOD_SAY =
  'A planner splits the tour into beats. Each beat goes to the writer, and then the checker decides whether the beat may be shown.';
const FORMULA = {
  title: 'Scaled attention',
  // Display wrappers, odd spacing in a term and the final full stop are tidied in code.
  latex: '$$y = \\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V.$$',
  terms: [
    { latex: 'Q K^T', label: 'how well queries match keys' },
    { latex: '\\sqrt{d_k}', label: 'keeps the scores in range' },
    { latex: 'V', label: 'the values being mixed' },
  ],
};
const FORMULA_CUES = [
  { action: 'board_focus', target: 'term-1', label: '', anchor: 'Q times K transposed' },
  { action: 'board_focus', target: 'term-2', label: '', anchor: 'square root of d k' },
  { action: 'board_focus', target: 'term-3', label: '', anchor: 'mix the values V' },
  { action: 'board_focus', target: 'term-3', label: '', anchor: 'a phrase nobody said' },
];
const FIGURE_CUES = [
  { action: 'arrow', target: 'fig1', region: 'top-left', label: 'The planner', anchor: 'planner sits at the top left' },
  { action: 'circle', target: 'fig1.a', region: 'whole', label: '', anchor: 'the first panel holds' },
  {
    action: 'arrow',
    target: 'fig1',
    region: 'bottom',
    label: 'the checker that waits at the bottom',
    anchor: 'the checker waits',
  },
  { action: 'box', target: 'tab1', region: 'whole', label: 'Not this beat', anchor: 'the whole pipeline' },
];
const TABLE_BARS = {
  title: 'Accuracy by reading mode',
  unit: '%',
  higher_is_better: true,
  bars: [
    { label: 'Plain reading [12]', value: 74.2 },
    { label: 'Tutor tour', value: 81.5 },
  ],
};
const TABLE_CUES = [
  { action: 'circle', target: 'tab1', region: 'bottom-half', label: 'Tutor rows', anchor: 'the full tutor tour' },
  { action: 'board_focus', target: 'bar-2', label: '', anchor: 'reaches 81.5 percent' },
];
const METHOD_FLOW = {
  title: 'From plan to checked beats',
  nodes: [
    { id: 'node-1', label: 'Planner' },
    { id: 'node-2', label: 'Writer' },
    { id: 'node-3', label: 'Checker' },
  ],
  edges: [
    { from: 'node-1', to: 'node-2' },
    { from: 'node-2', to: 'node-3' },
  ],
};
const METHOD_CUES = [
  { action: 'highlight', target: 'p1.s3', label: '', anchor: 'A planner splits' },
  { action: 'board_focus', target: 'node-2', label: '', anchor: 'goes to the writer' },
];
const noBars = { title: '', unit: '', higher_is_better: true, bars: [] };
const resultCues = [{ action: 'highlight', target: 'p2.s2', label: '', anchor: 'explains the point' }];

type Request = { name: string; schema: any; task: string; brief: string };
type Kind = 'formula' | 'figure' | 'table' | 'method' | 'result';
/** Per beat kind, the model's answer; `repair` is true once the conversation carries a board repair. */
type Script = Partial<Record<Kind, (repair: boolean) => unknown>>;

const good: Script = {
  formula: () => ({ plan: 'p', formula: FORMULA, say: FORMULA_SAY, cues: FORMULA_CUES }),
  figure: () => ({ plan: 'p', say: FIGURE_SAY, cues: FIGURE_CUES }),
  table: () => ({ plan: 'p', bars: TABLE_BARS, say: TABLE_SAY, cues: TABLE_CUES }),
  method: () => ({ plan: 'p', flow: METHOD_FLOW, say: METHOD_SAY, cues: METHOD_CUES }),
  result: () => ({ plan: 'p', bars: noBars, say: SAY, cues: resultCues }),
};

function kindOf(brief: string): Kind | null {
  if (brief.includes('STEP KIND: formula')) return 'formula';
  if (brief.includes('TABLE 1 [tab1], page')) return 'table';
  if (brief.includes('FIGURE 1 [fig1], page')) return 'figure';
  if (brief.includes('STEP KIND: method')) return 'method';
  return brief.includes('STEP KIND: result') ? 'result' : null;
}

/** A plain direction for the other beats: the first allowed page target, and no board. */
function plain(r: Request) {
  const cue = r.schema.properties.cues.items.properties;
  const target = cue.target.enum?.find((id: string) => !/^(term|node|bar)-/.test(id));
  const action = cue.action.enum.find((a: string) => a !== 'board_focus');
  const cues =
    target && action ? [{ action, target, region: 'whole', label: 'Look here', anchor: 'explains the point' }] : [];
  return { plan: 'p', say: SAY, cues };
}

function provider(script: Script, requests: Request[]): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const text = (content: any) =>
      typeof content === 'string' ? content : content.map((p: any) => p.text ?? '').join('\n');
    const messages: string[] = body.messages.map((m: any) => text(m.content));
    const request: Request = {
      name: body.response_format.json_schema.name,
      schema: body.response_format.json_schema.schema,
      task: messages.join('\n'),
      brief: messages.find((m) => m.startsWith('TASK: write ONE step')) ?? '',
    };
    requests.push(request);
    const kind = kindOf(request.brief);
    const value =
      request.name === 'paper_card'
        ? card
        : ((kind && script[kind]?.(request.task.includes('board cannot be shown'))) ?? plain(request));
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  }) as typeof fetch;
}

async function generate(script: Script = good) {
  const requests: Request[] = [];
  const result = await new HarnessTourGenerator(settings, 'standard', provider(script, requests)).generate(input);
  const steps = result.tour.chapters.flatMap((c) => c.steps);
  return { ...result, steps, requests, step: (id: string) => steps.find((s) => s.id === id)! };
}
/** The word index where a phrase starts in the narration, ignoring case and punctuation. */
const wordOf = (say: string, phrase: string) => {
  const tokens = (s: string) =>
    s.split(/\s+/).map((w) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''));
  const words = tokens(say),
    parts = tokens(phrase);
  const at = words.findIndex((_, i) => words.slice(i, i + parts.length).join(' ') === parts.join(' '));
  assert.ok(at >= 0, `"${phrase}" is not in the narration`);
  return at;
};
const types = (step: Step) => step.actions.map((a: Action) => a.type);

test('a formula board keeps LaTeX that KaTeX renders, with terms copied from it and short labels', () => {
  const kept = checkFormula(FORMULA);
  assert.deepEqual(kept, {
    item: {
      kind: 'formula',
      title: 'Scaled attention',
      latex: 'y = \\mathrm{softmax}\\left(\\frac{QK^T}{\\sqrt{d_k}}\\right)V',
      terms: [
        { latex: 'QK^T', label: 'how well queries match keys' },
        { latex: '\\sqrt{d_k}', label: 'keeps the scores in range' },
        { latex: 'V', label: 'the values being mixed' },
      ],
    },
    problems: [],
  });
  const dropped = (raw: object, problem: RegExp) => {
    const { item, problems } = checkFormula(raw);
    assert.equal(item, null);
    assert.ok(
      problems.some((p) => problem.test(p)),
      problems.join('; '),
    );
  };
  dropped({ ...FORMULA, latex: '\\softmax(QK^T)V' }, /cannot be rendered: Undefined control sequence/);
  dropped({ ...FORMULA, latex: '\\frac{QK^T}{\\sqrt{d_k}' }, /cannot be rendered/);
  dropped(
    { ...FORMULA, terms: [...FORMULA.terms.slice(0, 2), { latex: 'W_o', label: 'output weights' }] },
    /term 3: .*not copied/,
  );
  dropped(
    { ...FORMULA, terms: [FORMULA.terms[0], { latex: '\\frac{QK^T}', label: 'half a fraction' }] },
    /term 2: .*not a complete/,
  );
  // Terms are placed as the board places them: between tokens, so the x of \max is skipped for the input x.
  const ffn = {
    latex: '\\max(0, xW_1 + b_1)',
    terms: [
      { latex: 'x', label: 'input' },
      { latex: 'b_1', label: 'bias' },
    ],
  };
  assert.deepEqual(checkFormula(ffn).problems, []);
  dropped({ ...ffn, terms: [{ latex: 'ax', label: 'odd' }, ffn.terms[1]] }, /term 1: .*inside a longer command/);
  dropped({ ...ffn, terms: [ffn.terms[1], { latex: 'b_1', label: 'bias again' }] }, /term 2: it repeats term 1/);
  dropped(
    {
      latex: 'QK^T V',
      terms: [
        { latex: 'QK', label: 'scores' },
        { latex: 'K^T', label: 'keys' },
      ],
    },
    /term 2: .*cuts across term 1/,
  );
  // A term may sit inside another, as the board nests them.
  const nested = {
    latex: '\\frac{QK^T}{\\sqrt{d_k}}',
    terms: [
      { latex: '\\frac{QK^T}{\\sqrt{d_k}}', label: 'scaled match scores' },
      { latex: '\\sqrt{d_k}', label: 'the scale' },
    ],
  };
  assert.deepEqual(checkFormula(nested).problems, []);
  dropped(
    {
      ...FORMULA,
      terms: [FORMULA.terms[0], { latex: 'V', label: 'the values that every query mixes into its output' }],
    },
    /too long/,
  );
  dropped({ ...FORMULA, terms: [FORMULA.terms[0]] }, /2 to 6 terms/);
  dropped({ ...FORMULA, latex: '\\href{https://example.com}{QK^T}' }, /not allowed/);
  // Colours would paint over the board's own term colours.
  dropped({ ...FORMULA, latex: '\\textcolor{red}{QK^T} V' }, /colour commands are not allowed/);
  // A term may not change how the formula is typeset: an exponent cut from its symbol drops beside a tall bracket, and
  // a sum coloured alone moves its limits beside it.
  const squared = {
    latex: '\\left(\\frac{a}{b}\\right)^2 + c',
    terms: [
      { latex: '\\frac{a}{b}', label: 'the ratio' },
      { latex: '^2', label: 'squared' },
    ],
  };
  dropped(squared, /term 2: .*exponent or index without its symbol/);
  const sum = {
    latex: '\\sum_{i=1}^{N} \\alpha_i x_i',
    terms: [
      { latex: '\\sum', label: 'add up' },
      { latex: 'x_i', label: 'each input' },
    ],
  };
  dropped(sum, /term 1: .*leaves its limits behind/);
  const sumWithLimits = { ...sum, terms: [{ latex: '\\sum_{i=1}^{N}', label: 'add up' }, sum.terms[1]] };
  assert.deepEqual(checkFormula(sumWithLimits).problems, []);
  // A term longer than the tour contract allows (200 characters).
  const long = Array.from({ length: 30 }, (_, i) => `a_{${i}}`).join(' + ');
  const most = long.slice(0, long.indexOf(' + a_{24}'));
  dropped(
    {
      latex: long,
      terms: [
        { latex: most, label: 'most of it' },
        { latex: 'a_{29}', label: 'the last one' },
      ],
    },
    /term 1: .*longer than 200/,
  );
  // Nothing drawn is a choice, not a failure.
  assert.deepEqual(checkFormula({ title: '', latex: '', terms: [] }), { item: null, problems: [] });
});

test('numbers are read as printed, and bars keep only numbers their evidence prints', () => {
  assert.deepEqual(
    numbersIn('28.4 BLEU, 1,024 tokens, 0,5 s, −2.1 dB, pages 10-20, 100K steps'),
    [28.4, 1024, 0, 5, 0.5, -2.1, 10, 20, 100, 100000],
  );
  const evidence = 'Plain reading [12] 74.2\nTutor tour 81.5';
  assert.deepEqual(checkBars(TABLE_BARS, evidence), {
    item: {
      kind: 'bars',
      title: 'Accuracy by reading mode',
      unit: '%',
      higher_is_better: true,
      bars: [
        { label: 'Plain reading', value: 74.2 },
        { label: 'Tutor tour', value: 81.5 },
      ],
    },
    problems: [],
  });
  const invented = checkBars(
    { ...TABLE_BARS, bars: [...TABLE_BARS.bars, { label: 'Other system', value: 99.9 }] },
    evidence,
  );
  assert.equal(invented.item, null);
  assert.match(invented.problems.join(';'), /bar 3: 99\.9 does not appear in the evidence/);
  assert.equal(checkBars({ ...TABLE_BARS, bars: [TABLE_BARS.bars[0]] }, evidence).item, null);
  assert.deepEqual(checkBars(noBars, evidence), { item: null, problems: [] });
});

test('a flow points forward, keeps every node connected and drops broken arrows', () => {
  const shuffled = {
    ...METHOD_FLOW,
    nodes: [METHOD_FLOW.nodes[2], METHOD_FLOW.nodes[0], METHOD_FLOW.nodes[1]],
    edges: [
      ...METHOD_FLOW.edges,
      { from: 'node-2', to: 'node-2' },
      { from: 'node-9', to: 'node-1' },
      METHOD_FLOW.edges[0],
    ],
  };
  assert.deepEqual(checkFlow(shuffled), {
    item: {
      kind: 'flow',
      title: 'From plan to checked beats',
      nodes: METHOD_FLOW.nodes,
      edges: [
        ['node-1', 'node-2'],
        ['node-2', 'node-3'],
      ],
    },
    problems: [],
  });
  const loose = checkFlow({ ...METHOD_FLOW, edges: [METHOD_FLOW.edges[0]] });
  assert.equal(loose.item, null);
  assert.match(loose.problems.join(';'), /connect node-3/);
  assert.match(checkFlow({ ...METHOD_FLOW, nodes: METHOD_FLOW.nodes.slice(0, 2) }).problems.join(';'), /3 to 7 nodes/);
  assert.deepEqual(checkFlow({ title: '', nodes: [], edges: [] }), { item: null, problems: [] });
  // IDs come from the offered list (board_focus names them), and a dense web of arrows is not a flow.
  const renamed = checkFlow({ ...METHOD_FLOW, nodes: [{ id: 'the-planner', label: 'Planner' }, ...METHOD_FLOW.nodes] });
  assert.match(renamed.problems.join(';'), /node 1: the id must be one of node-1/);
  const ids = ['node-1', 'node-2', 'node-3', 'node-4', 'node-5'];
  const web = ids.flatMap((from) => ids.filter((to) => to !== from).map((to) => ({ from, to })));
  const dense = checkFlow({ nodes: ids.map((id) => ({ id, label: id })), edges: web });
  assert.equal(dense.item, null);
  assert.match(dense.problems.join(';'), /at most 12 arrows, not 20/);
  // A loop keeps its listed order and its arrow back, which the board draws beside the nodes.
  const loop = checkFlow({ ...METHOD_FLOW, edges: [...METHOD_FLOW.edges, { from: 'node-3', to: 'node-1' }] });
  assert.deepEqual(loop.item?.nodes, METHOD_FLOW.nodes);
  assert.deepEqual(loop.item?.edges.at(-1), ['node-3', 'node-1']);
});

test('named regions map to normalised boxes for pen marks', () => {
  assert.equal(regionOf('whole'), undefined);
  assert.equal(regionOf('somewhere'), undefined);
  assert.deepEqual(regionOf('top-left'), [0, 0, 0.4, 0.4]);
  assert.deepEqual(regionOf('center'), [0.3, 0.3, 0.7, 0.7]);
  assert.deepEqual(regionOf('bottom-right'), [0.6, 0.6, 1, 1]);
  assert.deepEqual(regionOf('right-half'), [0.5, 0, 1, 1]);
});

test('the plan gives formulas, methods, results and tables a board, and stays concise', () => {
  const beats = planBeats(card, doc, 'standard');
  assert.deepEqual(
    beats.map((b) => `${b.id}:${b.board ?? '-'}`),
    [
      'problem-1:-',
      'idea-1:-',
      'method-1:flow',
      'formula-1:formula',
      'figure-1:-',
      'figure-2:bars',
      'result-1:bars',
      'limitation-1:-',
      'takeaway-1:-',
    ],
  );
  const item = (i: number) => ({ text: `Point ${i}.`, evidence: ['p1.s3'] });
  const full = {
    ...card,
    method_steps: [1, 2, 3, 4].map(item),
    key_formulas: [
      { id: 'eq1', why: 'w' },
      { id: 'eq1', why: 'w' },
    ],
    key_figures: [
      { id: 'fig1', why: 'w' },
      { id: 'tab1', why: 'w' },
      { id: 'fig1', why: 'w' },
    ],
    results: [1, 2, 3].map(item),
    limitations: [1, 2].map(item),
  };
  assert.ok(planBeats(full, doc, 'standard').length <= 12);
  assert.ok(planBeats(full, doc, 'deep').length <= 30);
});

test('a formula step zooms, shows its board at word 0, boxes the equation and lights up each term as it is named', async () => {
  const { step, requests, metadata } = await generate();
  const formula = step('formula-1');
  assert.deepEqual(formula.actions.slice(0, 3), [
    { type: 'zoom', target: 'eq1' },
    { type: 'board', item: checkFormula(FORMULA).item },
    { type: 'box', target: 'eq1', color: 'blue' },
  ]);
  // One focus per named term, at the anchor's word; the cue whose anchor is not in the narration is dropped.
  assert.deepEqual(formula.actions.slice(3), [
    { type: 'board_focus', part: 0, at_word: wordOf(FORMULA_SAY, 'Q times K transposed') },
    { type: 'board_focus', part: 1, at_word: wordOf(FORMULA_SAY, 'square root of d k') },
    { type: 'board_focus', part: 2, at_word: wordOf(FORMULA_SAY, 'mix the values V') },
  ]);
  assert.ok((formula.hold_ms ?? 0) > 300);
  // The direction call saw the page with the typeset equation, and needed no repair.
  const calls = requests.filter((r) => r.brief.includes('STEP KIND: formula'));
  assert.equal(calls.length, 1);
  assert.match(calls[0].brief, /Visual source page2;/);
  assert.deepEqual((metadata.boards as { dropped: unknown[] }).dropped, []);
});

test('a formula KaTeX cannot render gets one repair; unrepaired, the step stays without a board', async () => {
  const bad = { ...FORMULA, latex: '\\softmax(QK^T)V' };
  const repaired = await generate({
    ...good,
    formula: (repair) => ({ plan: 'p', formula: repair ? FORMULA : bad, say: FORMULA_SAY, cues: FORMULA_CUES }),
  });
  const calls = repaired.requests.filter((r) => r.brief.includes('STEP KIND: formula'));
  assert.equal(calls.length, 2);
  assert.match(calls[1].task, /Undefined control sequence: \\softmax/);
  assert.deepEqual(types(repaired.step('formula-1')), [
    'zoom',
    'board',
    'box',
    'board_focus',
    'board_focus',
    'board_focus',
  ]);

  const dropped = await generate({
    ...good,
    formula: () => ({ plan: 'p', formula: bad, say: FORMULA_SAY, cues: FORMULA_CUES }),
  });
  const formula = dropped.step('formula-1');
  assert.equal(formula.say, FORMULA_SAY);
  // The flow of the step before is cleared; the equation is still zoomed and boxed.
  assert.deepEqual(formula.actions, [
    { type: 'zoom', target: 'eq1' },
    { type: 'board_clear' },
    { type: 'box', target: 'eq1', color: 'blue' },
  ]);
  const boards = dropped.metadata.boards as { dropped: { beat: string; problems: string[] }[] };
  assert.deepEqual(
    boards.dropped.map((d) => d.beat),
    ['formula-1'],
  );
  assert.match(boards.dropped[0].problems[0], /latex cannot be rendered/);
  assert.deepEqual(dropped.metadata.fallbackBeats, []);
});

test('pen marks on a figure map their named region, keep short labels and share the step colour', async () => {
  const { step } = await generate();
  const figure = step('figure-1');
  assert.deepEqual(figure.actions, [
    { type: 'zoom', target: 'fig1' },
    { type: 'board_clear' },
    {
      type: 'arrow',
      target: 'fig1',
      region: [0, 0, 0.4, 0.4],
      label: 'The planner',
      color: 'blue',
      at_word: wordOf(FIGURE_SAY, 'planner sits at the top left'),
    },
    { type: 'circle', target: 'fig1.a', color: 'blue', at_word: wordOf(FIGURE_SAY, 'the first panel holds') },
    // A label longer than four words is left off rather than cut; the box on another beat's table is dropped.
    {
      type: 'arrow',
      target: 'fig1',
      region: [0.3, 0.6, 0.7, 1],
      color: 'blue',
      at_word: wordOf(FIGURE_SAY, 'the checker waits'),
    },
  ]);
  // On the evidence table, marks are green like the results.
  const table = step('figure-2');
  assert.deepEqual(
    table.actions.find((a) => a.type === 'circle'),
    {
      type: 'circle',
      target: 'tab1',
      region: [0, 0.5, 1, 1],
      label: 'Tutor rows',
      color: 'green',
      at_word: wordOf(TABLE_SAY, 'the full tutor tour'),
    },
  );
});

test('bars show numbers from the table cells or the evidence, and are dropped when a number is invented', async () => {
  const { step, requests } = await generate({
    ...good,
    result: () => ({
      plan: 'p',
      bars: {
        ...TABLE_BARS,
        bars: [
          { label: 'Tutor tour', value: 81.5 },
          { label: 'Other system', value: 99.9 },
        ],
      },
      say: SAY,
      cues: [...resultCues, { action: 'board_focus', target: 'bar-1', label: '', anchor: 'a student can follow' }],
    }),
  });
  const table = step('figure-2');
  assert.deepEqual(table.actions.slice(0, 2), [
    { type: 'zoom', target: 'tab1' },
    { type: 'board', item: checkBars(TABLE_BARS, 'Plain reading 74.2 Tutor tour 81.5').item },
  ]);
  assert.deepEqual(table.actions.at(-1), {
    type: 'board_focus',
    part: 1,
    at_word: wordOf(TABLE_SAY, 'reaches 81.5 percent'),
  });
  // The table's cells reach the brief; text outside the table's box does not.
  const tableBrief = requests.find((r) => r.brief.includes('TABLE 1 [tab1], page'))!.brief;
  assert.match(tableBrief, /Tutor tour \(no pointing\) 77\.0/);
  assert.doesNotMatch(tableBrief, /99\.9/);
  // 99.9 is printed on the page, but not in this result's evidence: one repair, then the step plays without bars.
  const result = step('result-1');
  assert.equal(requests.filter((r) => r.brief.includes('STEP KIND: result')).length, 2);
  assert.deepEqual(types(result), ['focus', 'board_clear', 'highlight']);

  // A result may also chart a number that only its cited table prints.
  const fromTable = await generate({
    ...good,
    result: () => ({
      plan: 'p',
      bars: {
        ...TABLE_BARS,
        bars: [
          { label: 'Without pointing', value: 77 },
          { label: 'Tutor tour', value: 81.5 },
        ],
      },
      say: SAY,
      cues: resultCues,
    }),
  });
  assert.equal(fromTable.step('result-1').actions[1].type, 'board');
});

test('a step without its own board clears the one left on the board, right after the camera', async () => {
  const { steps } = await generate();
  const board = (s: Step) => types(s).filter((t) => t === 'board' || t === 'board_clear');
  assert.deepEqual(Object.fromEntries(steps.map((s) => [s.id, board(s).join(' ')])), {
    'problem-1': '',
    'idea-1': '',
    'method-1': 'board',
    'formula-1': 'board',
    'figure-1': 'board_clear',
    'figure-2': 'board',
    'result-1': 'board_clear',
    'limitation-1': '',
    'takeaway-1': '',
  });
  for (const s of steps) {
    const at = types(s).indexOf('board_clear');
    if (at >= 0) assert.equal(at, 1, s.id);
    // board_focus only after a board item of the same step.
    const shown = types(s).indexOf('board');
    for (const [i, t] of types(s).entries()) if (t === 'board_focus') assert.ok(shown >= 0 && shown < i, s.id);
  }
  const method = steps.find((s) => s.id === 'method-1')!;
  assert.deepEqual(method.actions.at(-1), {
    type: 'board_focus',
    part: 1,
    at_word: wordOf(METHOD_SAY, 'goes to the writer'),
  });
});

test('the direction schema puts the board before say and offers only the beat’s own parts and regions', async () => {
  const { requests } = await generate();
  const schema = (kind: Kind) => requests.find((r) => kindOf(r.brief) === kind)!.schema;
  const cue = (kind: Kind) => schema(kind).properties.cues.items.properties;
  assert.deepEqual(Object.keys(schema('formula').properties), ['plan', 'formula', 'plot', 'say', 'cues']);
  assert.deepEqual(cue('formula').action.enum, ['board_focus']);
  assert.deepEqual(cue('formula').target.enum, ['term-1', 'term-2', 'term-3', 'term-4', 'term-5', 'term-6', 'curve-1', 'curve-2', 'curve-3']);
  assert.deepEqual(cue('figure').action.enum, ['arrow', 'circle', 'box']);
  assert.deepEqual(cue('figure').target.enum.slice(0, 3), ['fig1', 'fig1.a']);
  assert.ok(cue('figure').region.enum.includes('bottom-half'));
  assert.deepEqual(cue('table').target.enum, ['tab1', 'bar-1', 'bar-2', 'bar-3', 'bar-4', 'bar-5', 'bar-6']);
  assert.deepEqual(Object.keys(schema('result').properties), ['plan', 'bars', 'say', 'cues']);
  assert.equal(cue('result').region, undefined);
  const problem = requests.find((r) => r.brief.includes('STEP KIND: problem'))!.schema;
  assert.deepEqual(Object.keys(problem.properties), ['plan', 'say', 'cues']);
});

test('the examples the model is shown pass the same checks as its own answers', () => {
  const { formula, bars, flow, pen } = BOARD_EXAMPLES;
  assert.deepEqual(checkFormula(formula.formula).problems, []);
  for (const cue of formula.cues) assert.notEqual(findAnchor(formula.say, cue.anchor), null, cue.anchor);
  assert.deepEqual(checkBars(bars.bars, bars.bars.bars.map((b) => b.value).join(' ')).problems, []);
  assert.deepEqual(checkFlow(flow.flow).problems, []);
  for (const cue of pen) assert.ok((REGION_NAMES as readonly string[]).includes(cue.region), cue.region);
});
