import test from 'node:test';
import assert from 'node:assert/strict';
import type { MuseConfig } from '../src/config';
import type { Doc } from '../../shared/paper';
import type { TourGenerationInput, TourImage, TourProgress } from '../src/tour-generator';
import { ProcessingError } from '../src/errors';
import { MuseClient, providerFailureReason } from '../src/muse/client';
import { checkImages, paperContext } from '../src/muse/context';
import { MuseTourGenerator } from '../src/muse/generator';
import { materializeTour, TourValidationError } from '../src/muse/schema';
import { writingInstructions, PROMPT_VERSION } from '../src/muse/prompts';
import { walkthroughGoals } from '../src/muse/planning';

const settings: MuseConfig = {
  apiKey: 'unit-test-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en-US',
  timeoutMs: 1000,
};

test('provider diagnostics classify schema errors without exposing echoed content', async () => {
  const secret = 'private-question-and-api-key';
  const reason = await providerFailureReason(new Response(JSON.stringify({
    error: { message: `JSON schema exceeds the maximum nesting depth of 10 levels. ${secret}` },
  })));
  assert.equal(reason, 'schema_nesting_depth');
  assert.equal(await providerFailureReason(new Response('JSON schema exceeds maximum 3000 total enum values across enum properties. ' + secret)), 'schema_enum_budget');
  assert.equal(await providerFailureReason(new Response(secret)), 'request_rejected');
  assert.equal(await providerFailureReason(new Response('Invalid JSON schema: ' + secret)), 'invalid_schema');
  assert.equal(await providerFailureReason(new Response('x'.repeat(9000) + 'context length')), 'request_rejected');
});
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=';
const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test', title: 'Visual evidence' },
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
const images: TourImage[] = [
  { targetId: 'page1', kind: 'page', page: 1, label: 'Page 1', dataUrl: png },
  { targetId: 'fig1', kind: 'figure', page: 1, label: 'Figure 1', dataUrl: png },
];
const input: TourGenerationInput = { documentId: 'doc-test', analysisId: 'analysis-test', doc, images };
function draft(id = 'fig1') {
  return {
    title: 'An evidence-based tour',
    chapters: [
      {
        id: 'results',
        title: 'Results',
        steps: [
          {
            id: 'bars',
            source: 'fig1',
            say: 'The blue bar is larger than the red bar.',
            evidence: ['p1.s1', 'fig1'],
            actions: [
              { type: 'zoom', target: id, at_word: 0 },
              { type: 'box', target: 'fig1' },
              { type: 'highlight', targets: ['p1.s1'] },
            ],
          },
        ],
      },
    ],
  };
}
function response(value: unknown, finish = 'stop') {
  return new Response(
    JSON.stringify({
      choices: [{ finish_reason: finish, message: { content: JSON.stringify(value) } }],
      usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 },
    }),
    { headers: { 'x-request-id': 'request-test' } },
  );
}
function provider(fn: (request: any) => Response | Promise<Response>): typeof fetch {
  return (async (_url, init) => fn(JSON.parse(String(init?.body)))) as typeof fetch;
}
function assertCode(code: string) {
  return (error: unknown) => error instanceof ProcessingError && error.code === code;
}

test('Muse transport sends real inline image bytes and schema mode to Meta', async () => {
  let seen = false;
  const transport: typeof fetch = async (url, init) => {
    assert.equal(String(url), 'https://api.meta.ai/v1/chat/completions');
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer unit-test-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.response_format.json_schema.strict, false); // Canonical action schema uses oneOf.
    assert.equal(body.messages[0].content[0].image_url.url, png);
    assert.equal(init?.redirect, 'error');
    seen = true;
    return response({ description: 'A chart' });
  };
  const result = await new MuseClient(settings, transport).complete(
    [{ role: 'user', content: [{ type: 'image_url', image_url: { url: png } }] }],
    'inspection',
    { type: 'object' },
    512,
  );
  assert(seen);
  assert.equal(result.usage.totalTokens, 20);
});

test('provider errors stay safe and distinguish retryable failures', async () => {
  for (const [status, code, transient] of [
    [401, 'muse_auth_failed', false],
    [403, 'muse_auth_failed', false],
    [429, 'muse_rate_limited', true],
    [503, 'muse_unavailable', true],
    [400, 'muse_request_rejected', false],
  ] as const) {
    const client = new MuseClient(
      settings,
      async () => new Response('echo unit-test-key and private paper', { status }),
    );
    await assert.rejects(
      client.complete([], 'test', {}, 512),
      (error: unknown) =>
        error instanceof ProcessingError &&
        error.code === code &&
        error.transient === transient &&
        !error.message.includes('unit-test-key'),
    );
  }
});

test('truncated, refused and malformed responses cannot become saved tours', async () => {
  for (const envelope of [null, [], { choices: null }]) {
    await assert.rejects(
      new MuseClient(settings, async () => new Response(JSON.stringify(envelope))).complete([], 'test', {}, 512),
      assertCode('muse_invalid_response'),
    );
  }
  await assert.rejects(
    new MuseClient(
      settings,
      provider(() => response({}, 'length')),
    ).complete([], 'test', {}, 512),
    assertCode('muse_output_truncated'),
  );
  await assert.rejects(
    new MuseClient(settings, async () => new Response('not JSON')).complete([], 'test', {}, 512),
    assertCode('muse_invalid_response'),
  );
  await assert.rejects(
    new MuseClient(
      settings,
      async () => new Response(JSON.stringify({ choices: [{ message: { refusal: 'No' } }] })),
    ).complete([], 'test', {}, 512),
    assertCode('muse_refused'),
  );
});

test('missing credentials do not make a provider request; insecure endpoints are refused', async () => {
  let calls = 0;
  const client = new MuseClient({ ...settings, apiKey: '' }, async () => {
    calls++;
    return response({});
  });
  await assert.rejects(client.complete([], 'test', {}, 512), assertCode('muse_not_configured'));
  assert.equal(calls, 0);
  for (const baseUrl of [
    'http://public.example/v1',
    'https://key:secret@api.meta.ai/v1',
    'https://api.meta.ai/v1?key=secret',
  ])
    assert.throws(() => new MuseClient({ ...settings, baseUrl }), assertCode('muse_not_configured'));
});

test('complete paper context retains IDs, all text and figure links without geometry', () => {
  const context = paperContext(doc);
  for (const text of ['p1.s1', 'p1.b1', 'fig1', 'page1', 'The blue bar is larger.', 'referenced_by'])
    assert(context.includes(text));
  assert(!context.includes('bbox'));
  const oversized = structuredClone(doc);
  oversized.sentences[0].text = 'x'.repeat(600_001);
  assert.throws(() => paperContext(oversized), assertCode('context_limit'));
});

test('visual context requires every source page and figure as actual image bytes', () => {
  checkImages(input);
  for (const invalid of [
    images.slice(0, 1),
    images.slice(1),
    [...images, images[0]],
    images.map((image) => ({ ...image, dataUrl: 'https://private.invalid/crop.png' })),
  ])
    assert.throws(() => checkImages({ ...input, images: invalid }), assertCode('invalid_visual_context'));
  assert.throws(() => checkImages({ ...input, images: [] }), assertCode('context_limit'));
});

test('tour materialization binds identity and rejects fabricated references/timings/regions', () => {
  const valid = materializeTour(draft(), doc, 'private-document', 'de-DE');
  assert.equal(valid.tour.paper, 'private-document');
  assert.equal(valid.tour.doc_sha256, doc.source.sha256);
  assert.equal(valid.tour.voices?.host.lang, 'de-DE');
  assert(!('evidence' in valid.tour.chapters[0].steps[0]));
  assert(!('source' in valid.tour.chapters[0].steps[0]));
  assert.deepEqual(valid.evidence.bars, ['p1.s1', 'fig1']);
  assert.throws(() => materializeTour(draft('fig999'), doc, 'doc', 'en-US'), TourValidationError);
  const timing = draft();
  timing.chapters[0].steps[0].actions[0].at_word = 999;
  assert.throws(() => materializeTour(timing, doc, 'doc', 'en-US'), TourValidationError);
  const noEvidence = draft();
  noEvidence.chapters[0].steps[0].evidence = ['missing-source'];
  assert.throws(() => materializeTour(noEvidence, doc, 'doc', 'en-US'), TourValidationError);
  const inverted: any = draft();
  inverted.chapters[0].steps[0].actions[0].region = [0.8, 0.8, 0.2, 0.2];
  assert.throws(() => materializeTour(inverted, doc, 'doc', 'en-US'), TourValidationError);
  const longHold: any = draft();
  longHold.chapters[0].steps[0].hold_ms = 3_600_000;
  assert.throws(() => materializeTour(longHold, doc, 'doc', 'en-US'), TourValidationError);
});

test('walkthrough requires forward reading order, content coverage and precise highlights', () => {
  const pages = structuredClone(doc);
  pages.figures = [];
  pages.pages.push({ n: 2, width: 600, height: 800 });
  pages.blocks.push({ ...pages.blocks[0], id: 'p2.b1', page: 2, sentences: ['p2.s1'] });
  pages.sentences.push({ ...pages.sentences[0], id: 'p2.s1', page: 2, block: 'p2.b1' });
  const textStep = (page: number) => ({
    id: `text${page}`, source: `p${page}.s1`, say: 'Explain this important claim in the paper.',
    evidence: [`p${page}.s1`], actions: [
      { type: 'focus', target: `p${page}.s1` }, { type: 'highlight', targets: [`p${page}.s1`] },
    ],
  });
  const ordered = { title: 'Forward reading', chapters: [{ id: 'body', title: 'Body', steps: [textStep(1), textStep(2)] }] };
  materializeTour(ordered, pages, 'doc', 'en-US');
  const backward = structuredClone(ordered);
  backward.chapters[0].steps.reverse();
  assert.throws(() => materializeTour(backward, pages, 'doc', 'en-US'), /did not pass/);
  const missing = structuredClone(ordered);
  missing.chapters[0].steps.pop();
  assert.throws(() => materializeTour(missing, pages, 'doc', 'en-US'), TourValidationError);
  const noHighlight = structuredClone(ordered);
  noHighlight.chapters[0].steps[0].actions.pop();
  assert.throws(() => materializeTour(noHighlight, pages, 'doc', 'en-US'), TourValidationError);
  const crossPage = structuredClone(ordered);
  crossPage.chapters[0].steps[0].actions[1] = { type: 'highlight', targets: ['p2.s1'] };
  assert.throws(() => materializeTour(crossPage, pages, 'doc', 'en-US'), TourValidationError);
  const broad = structuredClone(ordered);
  broad.chapters[0].steps[0].actions[1] = { type: 'highlight', targets: ['p1.b1'] };
  assert.throws(() => materializeTour(broad, pages, 'doc', 'en-US'), TourValidationError);
});

test('source-derived prompt goals scale with real prose and leave image-only PDFs usable', () => {
  assert.equal(walkthroughGoals(doc).minimumSteps, 1);
  const long = structuredClone(doc);
  long.sentences = Array.from({ length: 180 }, (_, i) => ({ ...doc.sentences[0], id: `p1.s${i + 1}` }));
  assert.equal(walkthroughGoals(long).minimumSteps, 30);
  assert.equal(walkthroughGoals(long).targetSteps, 45);
  const prompt = writingInstructions('de-DE', long);
  for (const phrase of ['30', '45', 'printed order', 'highlight action', 'de-DE']) assert(prompt.includes(phrase));
  const scanned = structuredClone(doc);
  scanned.blocks = []; scanned.sentences = [];
  assert.equal(walkthroughGoals(scanned).minimumSteps, 1);
  assert.equal(PROMPT_VERSION, 'paper-tour-muse@4');
});

test('camera materialization pins a broad model focus to the declared source sentence', () => {
  const value: any = draft();
  value.chapters[0].steps[0].source = 'p1.s1';
  value.chapters[0].steps[0].actions[0] = { type: 'focus', target: 'p1.b1' };
  const result = materializeTour(value, doc, 'doc', 'en-US');
  assert.equal((result.tour.chapters[0].steps[0].actions[0] as any).target, 'p1.s1');
});

test('regeneration reuses visual evidence only when model, analysis and every image hash match', async () => {
  let inspections = 0, writings = 0;
  const generator = new MuseTourGenerator(settings, provider((request) => {
    if (request.response_format.json_schema.name === 'paper_visual_observations') {
      inspections++;
      return response({ observations: images.map((image) => ({ targetId: image.targetId, description: 'Verified visible chart.', readable: true, uncertainties: [] })) });
    }
    writings++; return response(draft());
  }));
  const original = await generator.generate(input);
  const regenerated = await generator.generate({ ...input, previousVisualInspection: original.metadata });
  assert.equal(inspections, 1); assert.equal(writings, 2);
  assert.equal(regenerated.metadata.reusedVisualInspection, true);
  for (const mutate of [
    (cached: any) => { cached.imagesReviewed.sources[0].sha256 = 'wrong'; },
    (cached: any) => { cached.analysisId = 'another-analysis'; },
    (cached: any) => { cached.model = 'another-model'; },
    (cached: any) => { cached.visualObservations.pop(); },
  ]) {
    const cached = structuredClone(original.metadata); mutate(cached);
    const result = await generator.generate({ ...input, previousVisualInspection: cached });
    assert.equal(result.metadata.reusedVisualInspection, false);
  }
  assert.equal(inspections, 5);
});

test('multimodal generation reviews all images, retains global paper context, and records evidence', async () => {
  const many = structuredClone(input);
  many.doc.pages = Array.from({ length: 15 }, (_, i) => ({ n: i + 1, width: 600, height: 800 }));
  many.doc.source.num_pages = 15;
  many.images = [
    ...many.doc.pages.map(
      (page): TourImage => ({
        targetId: `page${page.n}`,
        kind: 'page',
        page: page.n,
        label: `Page ${page.n}`,
        dataUrl: png,
      }),
    ),
    images[1],
  ];
  let calls = 0;
  const visualIds: string[] = [];
  const progress: TourProgress[] = [];
  const pageSteps = Array.from({ length: 14 }, (_, i) => ({
    id: `visual-page-${i + 2}`, source: `page${i + 2}`, say: 'Explain the visual content on this page.',
    evidence: [`page${i + 2}`], actions: [{ type: 'focus', target: `page${i + 2}` }],
  }));
  const completeDraft = {
    title: 'All content pages', chapters: [
      { ...draft().chapters[0], steps: [...draft().chapters[0].steps, ...pageSteps.slice(0, 7)] },
      { id: 'remaining-pages', title: 'Remaining pages', steps: pageSteps.slice(7) },
    ],
  };
  const generator = new MuseTourGenerator(
    settings,
    provider((request) => {
      calls++;
      assert(JSON.stringify(request.messages).includes('The blue bar is larger.'));
      const content = request.messages[1].content;
      assert(content.some((part: any) => part.type === 'image_url' && part.image_url.url === png));
      if (request.response_format.json_schema.name === 'paper_visual_observations') {
        const ids = request.response_format.json_schema.schema.properties.observations.items.properties.targetId
          .enum as string[];
        visualIds.push(...ids);
        return response({
          observations: ids.map((targetId) => ({
            targetId,
            description: 'Visible chart or paper page.',
            readable: true,
            uncertainties: [],
          })),
        });
      }
      return response(completeDraft);
    }),
  );
  const result = await generator.generate(many, async (value) => {
    progress.push(value);
  });
  assert.equal(calls, 3);
  assert.deepEqual(
    visualIds,
    many.images.map((image) => image.targetId),
  );
  assert.equal(result.metadata.fullPaperContext, true);
  assert.equal(result.metadata.promptVersion, PROMPT_VERSION);
  assert.equal((result.metadata.imagesReviewed as any).count, 16);
  assert.equal(result.tour.doc_sha256, doc.source.sha256);
  assert.equal(progress.at(-1)?.stage, 'validating');
  assert.equal((result.metadata.imagesReviewed as any).sources[0].sha256.length, 64);
});

test('over-limit page coverage is rejected before sending paper content to the provider', async () => {
  const scanned = structuredClone(input);
  scanned.doc.blocks = []; scanned.doc.sentences = []; scanned.doc.figures = [];
  scanned.doc.pages = Array.from({ length: 61 }, (_, i) => ({ n: i + 1, width: 600, height: 800 }));
  scanned.images = scanned.doc.pages.map((page) => ({ targetId: `page${page.n}`, kind: 'page', page: page.n, label: 'Scanned page', dataUrl: png }));
  let calls = 0;
  const generator = new MuseTourGenerator(settings, provider(() => { calls++; return response({}); }));
  await assert.rejects(generator.generate(scanned), assertCode('context_limit'));
  assert.equal(calls, 0);
});

test('a bounded missing-page completion fills coverage without rewriting valid explanations', async () => {
  const expanded = structuredClone(input);
  expanded.doc.pages.push({ n: 2, width: 600, height: 800 });
  expanded.images.push({ ...images[0], targetId: 'page2', page: 2 });
  expanded.doc.blocks[0].sentences.push('p1.s2', 'p1.s3');
  expanded.doc.sentences.push(
    { ...doc.sentences[0], id: 'p1.s2' }, { ...doc.sentences[0], id: 'p1.s3' },
    { ...doc.sentences[0], id: 'p2.s1', page: 2, block: 'p2.b1' },
  );
  expanded.doc.blocks.push({ ...doc.blocks[0], id: 'p2.b1', page: 2, sentences: ['p2.s1'] });
  const textStep = (id: string) => ({ id: `explain-${id}`, source: id, evidence: [id], say: 'Explain the important claim in its paper context.', actions: [{ type: 'focus', target: id }, { type: 'highlight', targets: [id] }] });
  const incomplete: any = draft();
  incomplete.chapters[0].steps.push(...['p1.s1', 'p1.s2', 'p1.s3'].map(textStep));
  const calls: string[] = [];
  const generator = new MuseTourGenerator(settings, provider((request) => {
    const name = request.response_format.json_schema.name;
    calls.push(name);
    if (name === 'paper_visual_observations') return response({ observations: expanded.images.map((image) => ({ targetId: image.targetId, description: 'Directly visible content.', readable: true, uncertainties: [] })) });
    if (name === 'paper_tour_coverage') {
      assert(JSON.stringify(request.messages).includes('p2.s1'));
      assert(request.messages[1].content.some((part: any) => part.type === 'image_url'));
      return response({ steps: [textStep('p2.s1')] });
    }
    return response(incomplete);
  }));
  const result = await generator.generate(expanded);
  assert.deepEqual(calls, ['paper_visual_observations', 'paper_tour_draft', 'paper_tour_coverage']);
  assert.equal(result.tour.chapters[0].steps.length, 5);
  assert.deepEqual(result.metadata.coverageRepairPages, [2]);
  assert.equal(result.tour.chapters[0].steps.at(-1)!.id, 'explain-p2.s1');
});

test('one invalid model draft is repaired against real IDs before publication', async () => {
  let drafts = 0;
  const generator = new MuseTourGenerator(
    settings,
    provider((request) => {
      if (request.response_format.json_schema.name === 'paper_visual_observations')
        return response({
          observations: images.map((image) => ({
            targetId: image.targetId,
            description: 'Visible chart.',
            readable: true,
            uncertainties: [],
          })),
        });
      drafts++;
      if (drafts === 1) return response(draft('fig999'));
      assert(JSON.stringify(request.messages).includes('unknown document element fig999'));
      return response(draft());
    }),
  );
  const generated = await generator.generate(input);
  assert.equal(drafts, 2);
  assert.equal(generated.tour.chapters[0].steps[0].actions[0].type, 'zoom');
});

test('a second invalid draft fails without manufacturing a replacement tour', async () => {
  let drafts = 0;
  const generator = new MuseTourGenerator(
    settings,
    provider((request) => {
      if (request.response_format.json_schema.name === 'paper_visual_observations')
        return response({
          observations: images.map((image) => ({
            targetId: image.targetId,
            description: 'Visible chart.',
            readable: true,
            uncertainties: [],
          })),
        });
      drafts++;
      return response(draft('fig999'));
    }),
  );
  await assert.rejects(generator.generate(input), TourValidationError);
  assert.equal(drafts, 2);
});

test('model switching routes image inspection and writing to the chosen reasoning model', async () => {
  for (const model of ['muse-wonder-1.0', 'muse-spark-1.3', 'muse-spark-1.2', 'muse-spark-1.1', 'muse-spark-1.3-contributor', 'muse-spark-1.2-contributor']) {
    const requested: string[] = [];
    const base = new MuseTourGenerator(settings, provider((request) => {
      requested.push(request.model);
      if (request.response_format.json_schema.name === 'paper_visual_observations')
        return response({ observations: images.map((image) => ({ targetId: image.targetId, description: 'Real image evidence.', readable: true, uncertainties: [] })) });
      return response(draft());
    }));
    const selected = base.withModel(model);
    const result = await selected.generate(input);
    assert.deepEqual(requested, [model, model]);
    assert.equal(result.metadata.model, model);
  }
  for (const unsupported of ['muse-image-1.0', 'muse-voice-transcribe-1.0', 'sam-3.1', 'made-up-model'])
    assert.throws(() => new MuseTourGenerator(settings).withModel(unsupported), assertCode('unsupported_model'));
});

test('streamed Muse output survives split UTF-8/CRLF frames and records real deltas and usage', async () => {
  const chunks: string[] = [];
  const usages: unknown[] = [];
  const text = JSON.stringify({ explanation: 'Größe β' });
  const wire = [
    ': heartbeat\r\n\r\n',
    ...[text.slice(0, 14), text.slice(14)].map((part) => `data: ${JSON.stringify({ choices: [{ delta: { content: part } }] })}\r\n\r\n`),
    `data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`,
    `data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, prompt_tokens_details: { cached_tokens: 8 } } })}\n\n`,
    'data: [DONE]\n\n',
  ].join('');
  const bytes = new TextEncoder().encode(wire);
  const transport: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    assert.equal(body.stream, true); assert.equal(body.stream_options.include_usage, true);
    return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i++) controller.enqueue(bytes.slice(i, i + 1)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
  };
  const completion = await new MuseClient(settings, transport).complete([], 'test', {}, 100, undefined, async (delta) => { chunks.push(delta); }, async (usage) => { usages.push(usage); });
  assert.deepEqual(usages, [{ promptTokens: 10, completionTokens: 5, totalTokens: 15, cachedInputTokens: 8 }]);
  assert.equal(completion.usage.cachedInputTokens, 8);
  assert.equal(chunks.join(''), text); assert.deepEqual(completion.value, { explanation: 'Größe β' }); assert.equal(completion.usage.totalTokens, 15);
});

test('interrupted or truncated streams cannot become accepted model responses', async () => {
  for (const suffix of ['', 'data: [DONE]\n\n', `data: ${JSON.stringify({ choices: [{ finish_reason: 'length' }] })}\n\n`, `data: ${JSON.stringify({ choices: [{ finish_reason: 'length' }] })}\n\ndata: [DONE]\n\n`]) {
    const wire = `data: ${JSON.stringify({ choices: [{ delta: { content: '{"ok":true}' } }] })}\n\n${suffix}`;
    await assert.rejects(new MuseClient(settings, async () => new Response(wire, { headers: { 'content-type': 'text/event-stream' } })).complete([], 'test', {}, 100, undefined, async () => {}), assertCode(suffix.includes('length') ? 'muse_output_truncated' : 'muse_invalid_response'));
  }
});

test('generation activity captures actual multimodal prompts without inline image bytes', async () => {
  const recorded: { type: string; data: Record<string, unknown> }[] = [];
  const generator = new MuseTourGenerator(settings, provider((request) => request.response_format.json_schema.name === 'paper_visual_observations'
    ? response({ observations: images.map((image) => ({ targetId: image.targetId, description: 'Blue bar larger than red bar', readable: true, uncertainties: [] })) })
    : response(draft())));
  await generator.generate({ ...input, onEvent: async (type, data) => { recorded.push({ type, data }); } });
  const started = recorded.find((event) => event.type === 'model.started');
  assert(started); assert(JSON.stringify(started.data).includes('p1.s1')); assert(JSON.stringify(started.data).includes('fig1'));
  assert(!JSON.stringify(recorded).includes('data:image')); assert(!JSON.stringify(recorded).includes(settings.apiKey));
  assert(recorded.some((event) => event.type === 'model.completed'));
});

test('validated visual batch checkpoints survive retries and invalidate on changed evidence', async () => {
  let inspections = 0;
  const events: { type: string; data: Record<string, unknown> }[] = [];
  const transport = provider((request) => {
    if (request.response_format.json_schema.name === 'paper_visual_observations') {
      inspections++;
      return response({ observations: images.map((image) => ({ targetId: image.targetId, description: 'Verified visible chart.', readable: true, uncertainties: [] })) });
    }
    return response(draft());
  });
  const generator = new MuseTourGenerator(settings, transport);
  const original = await generator.generate({ ...input, onEvent: async (type, data) => { events.push({ type, data }); } });
  const checkpoint = events.find((event) => event.type === 'inspection.batch.completed')!;
  assert(checkpoint);
  const batch = { cacheKey: String(checkpoint.data.cacheKey), observations: checkpoint.data.observations, generationId: 'previous-run' };
  const retried = await generator.generate({ ...input, previousVisualBatches: [batch] });
  assert.equal(inspections, 1); assert.equal(retried.metadata.reusedVisualBatches, 1);
  assert.deepEqual(retried.tour, original.tour);
  for (const changed of [
    { ...input, analysisId: 'different-analysis' },
    { ...input, doc: { ...doc, source: { ...doc.source, sha256: 'b'.repeat(64) } } },
    { ...input, images: images.map((image) => ({ ...image, label: image.label + ' changed' })) },
  ]) {
    const result = await generator.generate({ ...changed, previousVisualBatches: [batch] });
    assert.equal(result.metadata.reusedVisualBatches, 0);
  }
  const bad = await generator.generate({ ...input, previousVisualBatches: [{ ...batch, observations: [] }] });
  assert.equal(bad.metadata.reusedVisualBatches, 0);
  const differentModel = await new MuseTourGenerator({ ...settings, model: 'muse-wonder-1.0' }, transport).generate({ ...input, previousVisualBatches: [batch] });
  assert.equal(differentModel.metadata.reusedVisualBatches, 0);
  assert.equal(inspections, 6);
});
