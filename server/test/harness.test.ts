import test from 'node:test';
import assert from 'node:assert/strict';
import type { MuseConfig } from '../src/config';
import type { Doc, Step } from '../../shared/paper';
import type { TourGenerationInput, TourImage } from '../src/tour-generator';
import { ProcessingError } from '../src/errors';
import { HarnessTourGenerator } from '../src/harness/generator';
import { anchorWord } from '../src/harness/assemble';
import { paperBlock } from '../src/harness/paper-block';

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
  'p1.s3': 'Each beat of the tour is written separately.',
  'p1.s4': 'Figure 1 shows the pipeline.',
  'p2.s1': 'The model chooses element IDs and the code draws.',
  'p2.s2': 'Tours become 80% shorter than page-by-page walkthroughs.',
  'p2.s3': 'However, messy layouts can still confuse the ingestion.',
  'p2.s4': 'In conclusion, short tours that point teach better.',
};
const sentence = (id: string) => ({ id, page: Number(id[1]), block: `p${id[1]}.b2`, text: texts[id], rects: [[0, 0, 100, 10]] as [number, number, number, number][] });
const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: 'b'.repeat(64), num_pages: 2, generator: 'test', title: 'Tutoring with pointers' },
  pages: [
    { n: 1, width: 600, height: 800 },
    { n: 2, width: 600, height: 800 },
  ],
  sections: [
    { id: 'sec-1', number: '1', title: 'Introduction', level: 1, page: 1, block: 'p1.b1' },
    { id: 'sec-2', number: '2', title: 'Method', level: 1, page: 2, block: 'p2.b1' },
  ],
  blocks: [
    { id: 'p1.b1', page: 1, type: 'heading', bbox: [0, 0, 100, 10], text: '1 Introduction', section: 'sec-1', sentences: [] },
    { id: 'p1.b2', page: 1, type: 'paragraph', bbox: [0, 20, 500, 120], text: '', section: 'sec-1', sentences: ['p1.s1', 'p1.s2', 'p1.s3', 'p1.s4'] },
    { id: 'p2.b1', page: 2, type: 'heading', bbox: [0, 0, 100, 10], text: '2 Method', section: 'sec-2', sentences: [] },
    { id: 'p2.b2', page: 2, type: 'paragraph', bbox: [0, 20, 500, 120], text: '', section: 'sec-2', sentences: ['p2.s1', 'p2.s2', 'p2.s3', 'p2.s4'] },
    { id: 'p2.b3', page: 2, type: 'equation', bbox: [0, 130, 300, 150], text: 'y = softmax(QK)V', sentences: [] },
  ],
  sentences: Object.keys(texts).map(sentence),
  figures: [
    { id: 'fig1', kind: 'figure', number: '1', page: 1, bbox: [0, 200, 400, 500], caption: 'The pipeline', image: 'figures/fig1.png', panels: [{ id: 'fig1.a', bbox: [0, 200, 200, 500], label: '(a)' }], referenced_by: ['p1.s4'] },
    { id: 'tab1', kind: 'table', number: '1', page: 2, bbox: [0, 300, 400, 400], caption: 'Accuracy results', image: 'figures/tab1.png', panels: [], referenced_by: ['p2.s2'] },
  ],
  equations: [{ id: 'eq1', number: '1', page: 2, bbox: [0, 130, 300, 150], block: 'p2.b3', text: 'y = softmax(QK)V' }],
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
  title: 'Tutoring with pointers',
  chapter_titles: { problem: 'Problem', idea: 'Idea', method: 'How it works', evidence: 'Evidence', limits: 'Limits', takeaway: 'Takeaway' },
  problem: { text: 'Reading papers alone is hard.', evidence: ['p1.s1'] },
  key_idea: { text: 'A tutor points at the page while it explains.', evidence: ['p1.s2'] },
  method_steps: [
    { text: 'The model picks IDs and the code draws.', evidence: ['p2.s1'] },
    { text: 'Each beat is written on its own.', evidence: ['p1.s3'] },
  ],
  key_figures: [
    { id: 'fig1', why: 'It shows the pipeline.' },
    { id: 'tab1', why: 'It reports the accuracy results.' },
  ],
  key_formulas: [{ id: 'eq1', why: 'It mixes values by attention.' }],
  results: [{ text: 'Tours become 80% shorter.', evidence: ['p2.s2'] }],
  limitations: [{ text: 'Messy layouts still confuse ingestion.', evidence: ['p2.s3'] }],
  takeaway: { text: 'Short tours that point teach better.', evidence: ['p2.s4'] },
  suggested_questions: ['Why IDs?', 'How short is a tour?', 'What still fails?'],
};
const SAY = 'This step explains the point clearly so that a student can follow every part of it while the page moves along.';

function reply(value: unknown, status = 200) {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
    { status },
  );
}
type Request = { name: string; schema: any; task: string };
function provider(fn: (request: Request) => Response | unknown): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    // The whole conversation, so a repair turn still shows which beat it repairs.
    const text = (content: any) => (typeof content === 'string' ? content : content.map((p: any) => p.text ?? '').join('\n'));
    const task = body.messages.map((m: any) => text(m.content)).join('\n');
    const result = fn({ name: body.response_format.json_schema.name, schema: body.response_format.json_schema.schema, task });
    return result instanceof Response ? result : reply(result);
  }) as typeof fetch;
}
/** A well-behaved model: the card above, and per beat a direction using its first allowed action and target. */
function goodModel(request: Request) {
  if (request.name === 'paper_card') return card;
  const cue = request.schema.properties.cues.items.properties;
  const target = cue.target.enum?.[0];
  const cues = target ? [{ action: cue.action.enum[0], target, label: 'Look here', anchor: 'explains the point' }] : [];
  return { plan: 'p', say: SAY, cues };
}
const steps = (tour: { chapters: { steps: Step[] }[] }) => tour.chapters.flatMap((c) => c.steps);

test('a standard tour follows the argument in a handful of steps and ends with questions', async () => {
  const names: string[] = [];
  const generator = new HarnessTourGenerator(settings, 'standard', provider((r) => (names.push(r.name), goodModel(r))));
  const { tour, metadata } = await generator.generate(input);
  const all = steps(tour);
  assert.ok(all.length >= 6 && all.length <= 12, `${all.length} steps`);
  assert.deepEqual(
    tour.chapters.map((c) => c.id),
    ['problem', 'idea', 'method', 'evidence', 'limits', 'takeaway'],
  );
  assert.equal(names.filter((n) => n === 'paper_card').length, 1);
  assert.equal(names.filter((n) => n === 'beat_direction').length, all.length);
  assert.deepEqual(tour.suggested_questions, card.suggested_questions);
  assert.equal(tour.preset, 'standard');
  const figure = all.find((s) => s.id === 'figure-1')!;
  assert.deepEqual(figure.actions[0], { type: 'zoom', target: 'fig1' });
  const problem = all[0];
  assert.deepEqual(problem.actions[0], { type: 'focus', target: 'p1.s1' });
  assert.ok(problem.actions.some((a) => a.type === 'highlight' && a.targets[0] === 'p1.s1' && a.at_word === 2));
  assert.equal(metadata.cardSource, 'model');
  assert.deepEqual(metadata.fallbackBeats, []);
});

test('a quick tour stays at six steps or fewer', async () => {
  const { tour } = await new HarnessTourGenerator(settings, 'quick', provider(goodModel)).generate(input);
  assert.ok(steps(tour).length <= 6, `${steps(tour).length} steps`);
});

test('a beat that fails twice falls back to the card text and the tour still plays', async () => {
  const generator = new HarnessTourGenerator(
    settings,
    'standard',
    provider((r) => (r.task.includes('STEP KIND: idea') ? { plan: 'p', say: 'too short', cues: [] } : goodModel(r))),
  );
  const { tour, metadata } = await generator.generate(input);
  const idea = steps(tour).find((s) => s.id === 'idea-1')!;
  assert.equal(idea.say, card.key_idea.text);
  assert.ok(idea.actions.some((a) => a.type === 'highlight' && a.targets[0] === 'p1.s2'));
  assert.deepEqual(metadata.fallbackBeats, ['idea-1']);
});

test('cues outside the beat are dropped, the rest of the step is kept', async () => {
  const generator = new HarnessTourGenerator(
    settings,
    'quick',
    provider((r) =>
      r.task.includes('STEP KIND: problem')
        ? {
            plan: 'p',
            say: SAY,
            cues: [
              { action: 'highlight', target: 'p2.s4', label: '', anchor: 'the point' },
              { action: 'box', target: 'fig1', label: 'x', anchor: 'the point' },
              { action: 'highlight', target: 'p1.s1', label: '', anchor: 'a student' },
            ],
          }
        : goodModel(r),
    ),
  );
  const problem = steps((await generator.generate(input)).tour)[0];
  const highlights = problem.actions.filter((a) => a.type === 'highlight');
  assert.deepEqual(highlights.map((a) => (a.type === 'highlight' ? a.targets : [])), [['p1.s1']]);
  assert.ok(!problem.actions.some((a) => a.type === 'box'));
});

test('an unusable card falls back to the document’s own sentences', async () => {
  const generator = new HarnessTourGenerator(
    settings,
    'standard',
    provider((r) => (r.name === 'paper_card' ? { plan: 'p' } : goodModel(r))),
  );
  const { tour, metadata } = await generator.generate(input);
  assert.equal(metadata.cardSource, 'fallback');
  assert.ok(steps(tour).length >= 3);
});

test('a rejected API key fails the tour instead of hiding behind fallbacks', async () => {
  const generator = new HarnessTourGenerator(
    settings,
    'standard',
    provider((r) => (r.name === 'paper_card' ? card : new Response('denied', { status: 401 }))),
  );
  await assert.rejects(generator.generate(input), (e) => e instanceof ProcessingError && e.code === 'muse_auth_failed');
});

test('anchor phrases map to the word where the cue fires', () => {
  const say = 'The key idea is simple: attention replaces recurrence entirely.';
  assert.equal(anchorWord(say, 'attention replaces'), 5);
  assert.equal(anchorWord(say, 'Attention, replaces!'), 5);
  assert.equal(anchorWord(say, 'attention replaced recurrence'), 5);
  assert.equal(anchorWord(say, 'nothing like it'), 0);
});

test('the paper block lists every prose sentence by ID, and figures and equations', () => {
  const block = paperBlock(doc);
  for (const id of Object.keys(texts)) assert.ok(block.includes(`[${id}] ${texts[id]}`), id);
  assert.ok(block.includes('[fig1] figure 1, page 1: The pipeline'));
  assert.ok(block.includes('[eq1] (1), page 2: y = softmax(QK)V'));
  assert.ok(block.includes('## [sec-2] 2 Method'));
});
