import { exampleSay, numericalExample } from './example-fixture';
import test from 'node:test';
import assert from 'node:assert/strict';
import type { MuseConfig } from '../src/config';
import type { Doc, Step } from '../../shared/paper';
import type { TourGenerationInput, TourImage } from '../src/tour-generator';
import { ProcessingError } from '../src/errors';
import { HarnessTourGenerator } from './harness-fixture';
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
const sentence = (id: string) => ({
  id,
  page: Number(id[1]),
  block: `p${id[1]}.b2`,
  text: texts[id],
  rects: [[0, 0, 100, 10]] as [number, number, number, number][],
});
const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: {
    file: 'paper.pdf',
    sha256: 'b'.repeat(64),
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
      bbox: [0, 0, 100, 10],
      text: '1 Introduction',
      section: 'sec-1',
      sentences: [],
    },
    {
      id: 'p1.b2',
      page: 1,
      type: 'paragraph',
      bbox: [0, 20, 500, 120],
      text: '',
      section: 'sec-1',
      sentences: ['p1.s1', 'p1.s2', 'p1.s3', 'p1.s4'],
    },
    { id: 'p2.b1', page: 2, type: 'heading', bbox: [0, 0, 100, 10], text: '2 Method', section: 'sec-2', sentences: [] },
    {
      id: 'p2.b2',
      page: 2,
      type: 'paragraph',
      bbox: [0, 20, 500, 120],
      text: '',
      section: 'sec-2',
      sentences: ['p2.s1', 'p2.s2', 'p2.s3', 'p2.s4'],
    },
    { id: 'p2.b3', page: 2, type: 'equation', bbox: [0, 130, 300, 150], text: 'y = softmax(QK)V', sentences: [] },
  ],
  sentences: Object.keys(texts).map(sentence),
  figures: [
    {
      id: 'fig1',
      kind: 'figure',
      number: '1',
      page: 1,
      bbox: [0, 200, 400, 500],
      caption: 'The pipeline',
      image: 'figures/fig1.png',
      panels: [{ id: 'fig1.a', bbox: [0, 200, 200, 500], label: '(a)' }],
      referenced_by: ['p1.s4'],
    },
    {
      id: 'tab1',
      kind: 'table',
      number: '1',
      page: 2,
      bbox: [0, 300, 400, 400],
      caption: 'Accuracy results',
      image: 'figures/tab1.png',
      panels: [],
      referenced_by: ['p2.s2'],
    },
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
const SAY =
  'This step explains the point clearly so that a student can follow every part of it while the page moves along.';

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
    const text = (content: any) =>
      typeof content === 'string' ? content : content.map((p: any) => p.text ?? '').join('\n');
    const task = body.messages.map((m: any) => text(m.content)).join('\n');
    const result = fn({
      name: body.response_format.json_schema.name,
      schema: body.response_format.json_schema.schema,
      task,
    });
    return result instanceof Response ? result : reply(result);
  }) as typeof fetch;
}
/** A well-behaved model: the card above, and per beat a direction using its first allowed action and target. */
function goodModel(request: Request) {
  if (request.name === 'paper_card') return card;
  if (request.task.includes('STEP KIND: formula (a closer look'))
    return { plan: 'Compute the worked case.', say: exampleSay, example: numericalExample(), cues: [] };
  const cue = request.schema.properties.cues.items.properties;
  const target = cue.target.enum?.[0];
  const cues = target ? [{ action: cue.action.enum[0], target, label: 'Look here', anchor: 'explains the point' }] : [];
  return { plan: 'p', say: SAY, cues };
}
const steps = (tour: { chapters: { steps: Step[] }[] }) => tour.chapters.flatMap((c) => c.steps);

test('a standard tour follows the argument in a handful of steps and ends with questions', async () => {
  const names: string[] = [];
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const generator = new HarnessTourGenerator(
    settings,
    'standard',
    provider((r) => (names.push(r.name), goodModel(r))),
  );
  const { tour, metadata } = await generator.generate({
    ...input,
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
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
  const planned = events.find((event) => event.type === 'plan.ready')!.data.beats as { id: string; label: string }[];
  assert.ok(planned.every((beat) => beat.label.length > 0));
  assert.deepEqual(
    events
      .filter((event) => event.type === 'beat.started')
      .map((event) => event.data.beat)
      .sort(),
    planned.map((beat) => beat.id).sort(),
  );
  const completed = events.filter((event) => event.type === 'beat.completed');
  assert.equal(completed.length, planned.length);
  assert.ok(completed.every((event) => event.data.outcome === 'directed' && Number(event.data.durationMs) >= 0));
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
  assert.deepEqual(
    highlights.map((a) => (a.type === 'highlight' ? a.targets : [])),
    [['p1.s1']],
  );
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

test('fake transport sees the document language and copied narration receives one repair', async () => {
  const german = structuredClone(input);
  german.doc.blocks[1].text =
    'Die Funktion wird mit der Kettenregel berechnet. Für die Aufgabe müssen wir zuerst das innere Argument und dann die äußere Funktion betrachten.';
  let repaired = false;
  const copied =
    'The encoder transforms each input into a contextual representation which the decoder can use to generate an output sequence.';
  german.doc.sentences[0].text = copied;
  const result = await new HarnessTourGenerator(
    settings,
    'quick',
    provider((r) => {
      if (r.name === 'paper_card') {
        assert.match(r.task, /de-DE/);
        return card;
      }
      if (r.task.includes('Explain the mechanism, consequence or intuition')) repaired = true;
      return r.task.includes('Explain the mechanism, consequence or intuition')
        ? goodModel(r)
        : { plan: 'p', say: copied, cues: [] };
    }),
  ).generate(german);
  assert.equal(repaired, true);
  assert.equal(result.tour.voices?.host.lang, 'de-DE');
  assert(steps(result.tour).every((s) => s.say !== copied));
});

test('a failed repair cannot publish a verbatim fallback from the paper card', async () => {
  const source = structuredClone(input);
  const copied =
    'The encoder transforms each input into a contextual representation which the decoder can use to generate an output sequence.';
  source.doc.sentences.forEach((sentence) => {
    sentence.text = copied;
  });
  const run = new HarnessTourGenerator(
    settings,
    'quick',
    provider((r) => (r.name === 'paper_card' ? { plan: 'invalid card' } : { plan: 'p', say: copied, cues: [] })),
  ).generate(source);
  await assert.rejects(run, (error) => error instanceof ProcessingError && error.code === 'invalid_tour');
});

test('deep formula details repair their concrete sequence once and never publish a symbolic-only example', async () => {
  let attempts = 0;
  const run = (correct: boolean) =>
    new HarnessTourGenerator(
      settings,
      'deep',
      provider((request) => {
        if (request.name === 'beat_direction' && request.task.includes('STEP KIND: formula (a closer look')) {
          attempts++;
          assert.ok(request.task.includes('PRECEDING OVERVIEW'));
          assert.ok(request.task.includes(SAY));
          if (correct && attempts === 2) return goodModel(request);
          return { plan: 'p', say: exampleSay, cues: [] };
        }
        return goodModel(request);
      }),
    ).generate(input);
  const corrected = await run(true);
  assert.equal(attempts, 2);
  const detail = steps(corrected.tour).find((step) => step.id === 'formula-2')!;
  assert.deepEqual(
    detail.actions.filter((a) => a.type === 'board').map((a) => a.item.kind === 'formula' && a.item.latex),
    [false, '2+2=4'],
  );
  assert.ok(!(corrected.metadata.omittedDetails as string[]).includes('formula-2'));
  attempts = 0;
  await assert.rejects(
    run(false),
    (error) => error instanceof ProcessingError && error.code === 'worked_example_failed',
  );
  assert.equal(attempts, 2);
});

test('a fatal beat request records the failed planned item before rejecting the generation', async () => {
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const generator = new HarnessTourGenerator(
    settings,
    'quick',
    provider((request) => (request.name === 'paper_card' ? card : reply({}, 401))),
  );
  await assert.rejects(
    generator.generate({
      ...input,
      onEvent: async (type, data) => {
        events.push({ type, data });
      },
    }),
    (error) => error instanceof ProcessingError && error.code === 'muse_auth_failed',
  );
  const failed = events.find((event) => event.type === 'beat.failed');
  assert.ok(failed);
  assert.equal(failed.data.code, 'muse_auth_failed');
  assert.ok(events.some((event) => event.type === 'beat.started' && event.data.beat === failed.data.beat));
});

test('deep paper tours move forward through source pages and keep the final view for the recap', async () => {
  const { tour } = await new HarnessTourGenerator(settings, 'deep', provider(goodModel)).generate(input);
  const { indexElements } = await import('../src/elements');
  const elements = new Map(indexElements(doc).map((e) => [e.id, e]));
  const cameras = steps(tour).map((step) => step.actions.find((a) => a.type === 'focus' || a.type === 'zoom')!);
  const pages = cameras.map((a) => elements.get((a as any).target)!.page);
  assert.deepEqual(
    pages,
    [...pages].sort((a, b) => a - b),
  );
  assert.equal((cameras.at(-1) as any).target, (cameras.at(-2) as any).target);
});

test('fatal direction failure aborts siblings and drains their events before generation rejects', async () => {
  let requests = 0;
  let aborted = 0;
  const events: string[] = [];
  const transport: typeof fetch = async (_url, init) => {
    const request = JSON.parse(String(init?.body));
    if (request.response_format.json_schema.name === 'paper_card') return reply(card);
    requests++;
    if (requests === 1) return reply({}, 401);
    const signal = init!.signal!;
    return new Promise<Response>((_resolve, reject) => {
      const stop = () => {
        aborted++;
        reject(new Error('sibling transport cancelled'));
      };
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop, { once: true });
    });
  };
  const generator = new HarnessTourGenerator(settings, 'quick', transport);
  await assert.rejects(
    generator.generate({
      ...input,
      onEvent: async (type) => {
        if (type === 'beat.failed') await new Promise((resolve) => setImmediate(resolve));
        events.push(type);
      },
    }),
    (error) => error instanceof ProcessingError && error.code === 'muse_auth_failed',
  );
  assert.ok(requests > 1);
  assert.equal(aborted, requests - 1);
  assert.equal(events.filter((type) => type === 'beat.failed').length, requests);
  const settledCount = events.length;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(events.length, settledCount, 'no sibling events after generation returned');
});

test('deep chapter titles never use a heading below the first explained source', async () => {
  const { paperPlan } = await import('../src/harness/beats');
  const withLaterHeading = structuredClone(doc);
  withLaterHeading.blocks.push({
    id: 'late-heading',
    page: 1,
    type: 'heading',
    bbox: [0, 700, 500, 720],
    text: 'Later topic',
    sentences: [],
  });
  withLaterHeading.sections.push({
    id: 'late-section',
    title: 'Later topic',
    level: 1,
    page: 1,
    block: 'late-heading',
  });
  const plan = paperPlan(card, withLaterHeading, 'deep');
  assert.equal(plan.chapters.find((c) => c.id === 'page-1')?.title, 'Page 1 · Introduction');
});

test('formula detail prompts teach an actual consequence instead of repeating the overview template', async () => {
  const { directTask } = await import('../src/harness/prompts');
  const prompt = directTask('en', 'PRECEDING OVERVIEW: symbols already explained', {
    actions: ['board_focus'],
    board: 'formula',
    words: 150,
    detail: true,
  });
  assert.match(prompt, /concrete starting values/);
  assert.match(prompt, /90-150 spoken words/);
  assert.match(prompt, /not universal superiority/);
  assert.doesNotMatch(prompt, /tell what the formula computes, then explain the terms/);
  assert.doesNotMatch(prompt, /EXAMPLE from another document/);
});

test('decoder padding is repaired before a tour can publish it', async () => {
  let repair = false;
  const result = await new HarnessTourGenerator(
    settings,
    'quick',
    provider((request) => {
      if (request.name === 'paper_card') return card;
      if (request.task.includes('STEP KIND: formula (a closer look'))
        return { plan: 'Compute the worked case.', say: exampleSay, example: numericalExample(), cues: [] };
      if (request.task.includes('invisible formatting')) repair = true;
      return request.task.includes('STEP KIND: problem') && !request.task.includes('invisible formatting')
        ? { ...goodModel(request), say: SAY + '\u200b'.repeat(80) }
        : goodModel(request);
    }),
  ).generate(input);
  assert.equal(repair, true);
  assert.equal(steps(result.tour)[0].say, SAY);
  assert.ok(steps(result.tour).every((step) => !/\p{Cf}{8,}/u.test(step.say)));
});

test('a non-formula beat cannot silently remove its numerical example during repair', async () => {
  let attempts = 0;
  const generator = new HarnessTourGenerator(
    settings,
    'quick',
    provider((request) => {
      if (request.name === 'beat_direction' && request.task.includes('STEP KIND: method')) {
        attempts++;
        return { plan: 'p', say: attempts === 1 ? exampleSay : SAY, cues: [] };
      }
      return goodModel(request);
    }),
  );
  await assert.rejects(
    generator.generate(input),
    (error) => error instanceof ProcessingError && error.code === 'worked_example_failed',
  );
  assert.equal(attempts, 2);
});
