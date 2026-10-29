import test from 'node:test';
import assert from 'node:assert/strict';
import type { MuseConfig } from '../src/config';
import type { BBox, BlockType, Doc, Step, Tour } from '../../shared/paper';
import type { TourGenerationInput, TourImage } from '../src/tour-generator';
import { HarnessTourGenerator } from './harness-fixture';
import {
  claimContext,
  claimPlan,
  claimsSchema,
  claimsTask,
  cleanClaims,
  sentencePlaces,
  type Claim,
} from '../src/harness/claims';
import { moveProblems } from '../src/harness/moves';
import { planBeats } from '../src/harness/beats';
import type { Preset } from '../src/harness/beats';

// A paper tour organised by claims: what the authors state in at least two of the abstract, the introduction and the
// conclusion, taught as what changed, why it works, the evidence with its scope and the catch. Scripted model.

const settings: MuseConfig = {
  apiKey: 'unit-test-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en-US',
  timeoutMs: 5000,
};
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=';

type Row = { id: string; type: BlockType; page: number; section?: string; sentences: Record<string, string> };
const rows: Row[] = [
  { id: 'p1.b1', type: 'heading', page: 1, section: 'sec-abstract', sentences: {} },
  {
    id: 'p1.b2',
    type: 'paragraph',
    page: 1,
    section: 'sec-abstract',
    sentences: {
      'p1.s1':
        'Irrigation on a fixed schedule wastes water because soil dries at very different speeds across a field.',
      'p1.s2':
        'We show that a network of cheap moisture probes cuts water use by 31.4 percent against the fixed schedule.',
      'p1.s3': 'We find that yield stays within 2.1 percent while pumping cost falls by 18.2 percent.',
      'p1.s4':
        'Probes near irrigation lines read wetter than the surrounding soil, which limits where they can be placed.',
    },
  },
  { id: 'p1.b3', type: 'heading', page: 1, section: 'sec-intro', sentences: {} },
  {
    id: 'p1.b4',
    type: 'paragraph',
    page: 1,
    section: 'sec-intro',
    sentences: {
      'p1.s5': 'Orchard growers water on a fixed schedule even though soil dries at very different speeds.',
      'p1.s6': 'We propose a network of probes that tells each valve when its patch of soil is dry.',
      'p1.s7':
        'Our first contribution is that measured need, not the calendar, sets the dose, which saves 31.4 percent of the water.',
      'p1.s8': 'Our second contribution is that yield is preserved, staying within 2.1 percent of the fixed schedule.',
      'p1.s9': 'Our third contribution is a controller that lowers pumping cost by 18.2 percent.',
    },
  },
  { id: 'p2.b1', type: 'heading', page: 2, section: 'sec-method', sentences: {} },
  {
    id: 'p2.b2',
    type: 'paragraph',
    page: 2,
    section: 'sec-method',
    sentences: {
      'p2.s1': 'Each probe reports a reading every ten minutes.',
      'p2.s2': 'A valve opens only while its probe reads below a threshold, so wet patches receive nothing.',
      'p2.s3': 'Because the dose follows the reading, water is never spent on soil that is already wet.',
      'p2.s4': 'The controller batches valve openings so that the pump runs in long, efficient cycles.',
    },
  },
  { id: 'p2.b3', type: 'equation', page: 2, section: 'sec-method', sentences: {} },
  { id: 'p2.b4', type: 'heading', page: 2, section: 'sec-results', sentences: {} },
  {
    id: 'p2.b5',
    type: 'paragraph',
    page: 2,
    section: 'sec-results',
    sentences: {
      'p2.s5': 'Across forty trees the probe network used 31.4 percent less water than the fixed schedule.',
      'p2.s6': 'Yield stayed within 2.1 percent of the fixed schedule.',
      'p2.s7': 'Pumping cost fell by 18.2 percent compared with the timer.',
      'p2.s8': 'All trials were run in one orchard over a single season.',
    },
  },
  { id: 'p3.b1', type: 'heading', page: 3, section: 'sec-conclusion', sentences: {} },
  {
    id: 'p3.b2',
    type: 'paragraph',
    page: 3,
    section: 'sec-conclusion',
    sentences: {
      'p3.s1': 'In conclusion, watering by measured need saves 31.4 percent of the water.',
      'p3.s2': 'Yield was preserved, staying within 2.1 percent of the fixed schedule.',
      'p3.s3': 'The controller cut pumping cost by 18.2 percent.',
      'p3.s4':
        'However, our experiments cover one orchard and one season, so they do not show the effect in other climates.',
      'p3.s5': 'Probes placed near irrigation lines need recalibration, which remains future work.',
    },
  },
];
const rect = (i: number): BBox => [50, 40 + 20 * i, 500, 54 + 20 * i];
function makeDoc(list: Row[], sections: Doc['sections']): Doc {
  return {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'paper.pdf', sha256: 'f'.repeat(64), num_pages: 3, generator: 'test', title: 'Watering by need' },
    pages: [1, 2, 3].map((n) => ({ n, width: 600, height: 800 })),
    sections,
    blocks: list.map((row, i) => ({
      id: row.id,
      page: row.page,
      type: row.type,
      bbox: rect(i),
      text: row.type === 'equation' ? 's = 1 - u / b' : Object.values(row.sentences).join(' '),
      ...(row.section ? { section: row.section } : {}),
      sentences: Object.keys(row.sentences),
    })),
    sentences: list.flatMap((row, i) =>
      Object.entries(row.sentences).map(([id, text]) => ({
        id,
        page: row.page,
        block: row.id,
        text,
        rects: [rect(i)],
      })),
    ),
    figures: [
      {
        id: 'tab1',
        kind: 'table',
        number: '1',
        page: 2,
        bbox: [50, 400, 500, 480],
        caption: 'Water use per tree under both schedules',
        image: 'figures/tab1.png',
        panels: [],
        referenced_by: ['p2.s5'],
      },
      {
        id: 'fig1',
        kind: 'figure',
        number: '1',
        page: 2,
        bbox: [50, 500, 500, 700],
        caption: 'Yield per tree against the fixed schedule',
        image: 'figures/fig1.png',
        panels: [],
        referenced_by: ['p2.s6'],
      },
    ],
    equations: [{ id: 'eq1', number: '1', page: 2, bbox: [50, 300, 400, 320], block: 'p2.b3', text: 's = 1 - u / b' }],
  };
}
const sections: Doc['sections'] = [
  { id: 'sec-abstract', title: 'Abstract', level: 1, page: 1, block: 'p1.b1' },
  { id: 'sec-intro', number: '1', title: 'Introduction', level: 1, page: 1, block: 'p1.b3' },
  { id: 'sec-method', number: '2', title: 'Method', level: 1, page: 2, block: 'p2.b1' },
  { id: 'sec-results', number: '3', title: 'Results', level: 1, page: 2, block: 'p2.b4' },
  { id: 'sec-conclusion', number: '4', title: 'Conclusion', level: 1, page: 3, block: 'p3.b1' },
];
const doc = makeDoc(rows, sections);
const images: TourImage[] = [
  ...[1, 2, 3].map((n) => ({ targetId: `page${n}`, kind: 'page' as const, page: n, label: `Page ${n}`, dataUrl: png })),
  { targetId: 'tab1', kind: 'table', page: 2, label: 'Table 1', dataUrl: png },
  { targetId: 'fig1', kind: 'figure', page: 2, label: 'Figure 1', dataUrl: png },
];
const input: TourGenerationInput = { documentId: 'doc', analysisId: 'a', doc, images };

const card = {
  plan: 'p',
  doc_type: 'research_paper' as const,
  title: 'Watering by need',
  chapter_titles: {
    problem: 'The problem',
    idea: 'Idea',
    method: 'How',
    evidence: 'Evidence',
    limits: 'Limits',
    takeaway: 'Takeaway',
  },
  problem: { text: 'Fixed schedules waste water.', evidence: ['p1.s1'] },
  key_idea: { text: 'Probes tell each valve when the soil is dry.', evidence: ['p1.s6'] },
  method_steps: [{ text: 'A valve opens below a threshold.', evidence: ['p2.s2'] }],
  key_figures: [{ id: 'tab1', why: 'It reports water use.' }],
  key_formulas: [],
  results: [{ text: 'The network used 31.4 percent less water.', evidence: ['p2.s5'] }],
  limitations: [{ text: 'One orchard, one season.', evidence: ['p2.s8'] }],
  takeaway: { text: 'Watering by measured need saves water.', evidence: ['p3.s1'] },
  suggested_questions: ['Why probes?', 'How much is saved?', 'What still fails?'],
};
const claims = {
  plan: 'p',
  claims: [
    {
      title: 'Measured need saves water',
      claim: 'Letting a probe reading set each valve’s dose saves water.',
      stated: [
        { place: 'abstract', sentence: 'p1.s2' },
        { place: 'introduction', sentence: 'p1.s7' },
        { place: 'conclusion', sentence: 'p3.s1' },
      ],
      changed: 'The calendar no longer sets the dose; a reading does.',
      why: { text: 'Water is spent only where the soil is dry.', sentences: ['p2.s2', 'p2.s3'], elements: ['eq1'] },
      evidence: { elements: ['tab1'], sentences: ['p2.s5'], scope: 'Forty trees in one orchard over one season.' },
      catches: [{ text: 'It was tested in one orchard and one season only.', sentences: ['p3.s4'] }],
    },
    {
      title: 'Yield is preserved',
      claim: 'The saving costs no visible yield.',
      stated: [
        { place: 'abstract', sentence: 'p1.s3' },
        { place: 'introduction', sentence: 'p1.s8' },
        { place: 'conclusion', sentence: 'p3.s2' },
      ],
      changed: 'Less water, yet the yield matches the fixed schedule.',
      why: { text: 'Dry patches still get their dose.', sentences: ['p2.s3'], elements: [] },
      evidence: { elements: ['fig1'], sentences: ['p2.s6'], scope: 'Yield per tree against the timer.' },
      catches: [],
    },
    {
      title: 'Pumping gets cheaper',
      claim: 'The controller lowers pumping cost.',
      stated: [
        { place: 'abstract', sentence: 'p1.s3' },
        { place: 'introduction', sentence: 'p1.s9' },
        { place: 'conclusion', sentence: 'p3.s3' },
      ],
      changed: 'Batched valve openings replace constant switching.',
      why: { text: 'Batching keeps the pump in long, efficient cycles.', sentences: ['p2.s4'], elements: [] },
      evidence: { elements: [], sentences: ['p2.s7'], scope: 'Compared with the timer.' },
      catches: [{ text: 'Probes near irrigation lines need recalibration.', sentences: ['p3.s5'] }],
    },
  ],
};

type Request = { name: string; schema: any; task: string; brief: string };
function provider(model: (r: Request) => unknown, requests: Request[] = []): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const parts = (content: any) => (typeof content === 'string' ? [{ type: 'text', text: content }] : content);
    const texts: string[] = body.messages.flatMap((m: any) => parts(m.content).map((p: any) => p.text ?? ''));
    const request: Request = {
      name: body.response_format.json_schema.name,
      schema: body.response_format.json_schema.schema,
      task: texts.join('\n'),
      brief: texts.find((t) => t.startsWith('TASK:') && !t.startsWith('TASK: understand')) ?? '',
    };
    requests.push(request);
    const value = request.name === 'visual_plan' ? { plan: 'none', beats: [] } : model(request);
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  }) as typeof fetch;
}
const SAY =
  'Water goes only where the soil is dry, so wet corners stop costing twice: once in the pump bill and again in the roots.';
function direct(r: Request, say = SAY) {
  const cue = r.schema.properties.cues.items.properties;
  const target = cue.target.enum?.[0];
  const cues = target ? [{ action: cue.action.enum[0], target, label: '', anchor: 'only where the soil' }] : [];
  return { plan: 'p', say, cues };
}
const model = (extra?: (r: Request) => unknown) => (r: Request) => {
  const special = extra?.(r);
  if (special !== undefined) return special;
  if (r.name === 'paper_card') return card;
  if (r.name === 'claims') return claims;
  return direct(r);
};
const steps = (tour: Tour) => tour.chapters.flatMap((c) => c.steps);
async function run(preset: Preset, fn: (r: Request) => unknown = model(), events: { type: string; data: any }[] = []) {
  const requests: Request[] = [];
  const result = await new HarnessTourGenerator(settings, preset, provider(fn, requests)).generate({
    ...input,
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  return { ...result, requests, all: steps(result.tour) };
}

// ----------------------------------------------------------------------------------------------- the places

test('the abstract, the introduction and the conclusion are found by their sections, with the subsections nested in them', () => {
  const places = sentencePlaces(doc);
  assert.equal(places.get('p1.s2'), 'abstract');
  assert.equal(places.get('p1.s7'), 'introduction');
  assert.equal(places.get('p3.s4'), 'conclusion');
  assert.equal(places.get('p2.s5'), undefined, 'the body is no place');
  // A numbered subsection belongs to the place of the section it is nested in, also when levels are all 1.
  const nested = makeDoc(rows, [
    ...sections.slice(0, 4),
    { id: 'sec-conclusion', title: '4 | DISCUSSION', level: 1, page: 3, block: 'p3.b1' },
    { id: 'sec-4-1', title: '4.1 | Limits', level: 1, page: 3, block: 'p3.b2' },
  ]);
  assert.equal(sentencePlaces(nested).get('p3.s4'), 'conclusion');
  // Without an abstract section, the prose before the introduction on the first pages is the abstract.
  const front = makeDoc(
    [
      {
        id: 'p1.b0',
        type: 'paragraph',
        page: 1,
        sentences: { 'p1.s0': 'We show that a cheap probe network saves water.' },
      },
      ...rows.slice(2),
    ],
    sections.slice(1),
  );
  assert.equal(sentencePlaces(front).get('p1.s0'), 'abstract');
});

test('claims can only be checked when the paper shows two places; the call is given the candidates of each', () => {
  const context = claimContext(doc)!;
  assert.deepEqual(
    Object.entries(context.candidates).map(([place, list]) => [place, list.length > 0]),
    [
      ['abstract', true],
      ['introduction', true],
      ['conclusion', true],
    ],
  );
  assert.ok(context.limits.some((s) => s.id === 'p3.s4'));
  const only = makeDoc(
    rows.slice(0, 4),
    sections.slice(0, 2).map((s) => ({ ...s, title: 'Background' })),
  );
  assert.equal(claimContext(only), null);
  const task = claimsTask('en-US', context, 'standard');
  assert.match(task, /ABSTRACT:\n\[p1\.s1\]/);
  assert.match(task, /CONCLUSION:\n.*\[p3\.s1\] In conclusion/s);
  assert.match(task, /THE AUTHORS' OWN LIMITS .*\[p3\.s4\]/s);
  const schema = claimsSchema(doc, ['p1.s1'], 'standard') as any;
  assert.equal(schema.properties.claims.maxItems, 3);
  assert.equal(schema.properties.claims.minItems, 2);
  assert.equal(schema.properties.claims.items.properties.stated.items.properties.sentence.$ref, '#/$defs/sentenceId');
  assert.deepEqual(schema.$defs.elementId.enum, ['tab1', 'fig1', 'eq1']);
});

// --------------------------------------------------------------------------------------------- the checks

test('a claim stays only when the authors state it in two places, each sentence from the place named', () => {
  const context = claimContext(doc)!;
  const checked = cleanClaims(claims, doc, context, 'standard');
  assert.deepEqual(checked.problems, []);
  assert.equal(checked.claims?.length, 3);
  const one = structuredClone(claims);
  // Claim 2 names an introduction sentence as an abstract one, and claim 3 states itself in one place only.
  one.claims[1].stated[0] = { place: 'abstract', sentence: 'p1.s8' };
  one.claims[2].stated = [{ place: 'abstract', sentence: 'p1.s3' }];
  const dropped = cleanClaims(one, doc, context, 'standard');
  assert.equal(dropped.claims?.length, 2, 'the claim with a wrong place keeps its other two places');
  assert.match(dropped.claims!.map((c) => c.title).join(), /^Measured need saves water,Yield is preserved$/);
  const none = structuredClone(claims);
  none.claims = none.claims.map((c) => ({ ...c, stated: [c.stated[0]] }));
  const bad = cleanClaims(none, doc, context, 'standard');
  assert.equal(bad.claims, null);
  assert.match(bad.problems.join(' '), /two different places/);
  // Fewer than two claims is no plan.
  assert.equal(cleanClaims({ ...claims, claims: claims.claims.slice(0, 1) }, doc, context, 'standard').claims, null);
});

test('a figure serves one claim, an unsupported catch is left out, and a repeated claim is dropped', () => {
  const context = claimContext(doc)!;
  const twice = structuredClone(claims);
  twice.claims[1].evidence.elements = ['tab1'];
  const owned = cleanClaims(twice, doc, context, 'standard').claims!;
  assert.deepEqual(owned[0].evidence.elements, ['tab1']);
  assert.deepEqual(owned[1].evidence.elements, [], 'the later claim keeps its sentences and loses the table');
  assert.deepEqual(owned[1].evidence.sentences, ['p2.s6']);
  // A catch has to cite a sentence in which the authors state a limit.
  const made = structuredClone(claims);
  made.claims[0].catches = [{ text: 'It fails in rain.', sentences: ['p2.s1'] }];
  const checked = cleanClaims(made, doc, context, 'standard');
  assert.equal(checked.claims![0].catch, undefined);
  const repeated = structuredClone(claims);
  repeated.claims[1] = { ...repeated.claims[0], title: 'Same again' };
  assert.equal(cleanClaims(repeated, doc, context, 'standard').claims?.length, 2);
});

// ---------------------------------------------------------------------------------------------- the plan

test('the plan has one chapter per claim: what changed, why it works, the evidence, the catch; sized by the preset', () => {
  const context = claimContext(doc)!;
  const list = cleanClaims(claims, doc, context, 'deep').claims!;
  const shape = (preset: Preset) => {
    const plan = claimPlan(list, card as never, doc, preset);
    return { plan, moves: plan.beats.map((b) => b.move), chapters: plan.chapters.map((c) => c.id) };
  };
  const standard = shape('standard');
  assert.ok(standard.plan.beats.length >= 10 && standard.plan.beats.length <= 12, `${standard.plan.beats.length}`);
  assert.deepEqual(standard.chapters, ['problem', 'claim-1', 'claim-2', 'claim-3', 'takeaway']);
  assert.deepEqual(standard.moves.slice(0, 5), ['thesis', 'change', 'why', 'evidence', 'catch']);
  assert.equal(standard.moves.at(-1), 'takeaway');
  // The why of the first claim is its equation, taught as a formula; its evidence is its table, taught on the page.
  const why = standard.plan.beats[2];
  assert.deepEqual([why.kind, why.target, why.board], ['formula', 'eq1', 'formula']);
  const evidence = standard.plan.beats[3];
  assert.deepEqual([evidence.kind, evidence.target, evidence.board], ['figure', 'tab1', 'bars']);
  assert.match(evidence.notes!.join('\n'), /SCOPE of the evidence: Forty trees/);
  const quick = shape('quick');
  assert.ok(quick.plan.beats.length <= 6, `${quick.plan.beats.length}`);
  // A short tour has one step per claim and tells the first catch inside the chapter of its claim.
  assert.deepEqual(quick.moves, ['thesis', 'change', 'catch', 'change', 'change', 'takeaway']);
  const deep = shape('deep');
  assert.ok(deep.plan.beats.length <= 22 && deep.plan.beats.length > standard.plan.beats.length);
  assert.ok(
    deep.plan.beats.some((b) => b.detail),
    'a deep tour works the equation through',
  );
  // Every beat names real sources, and the steps teaching one claim carry its text and scope.
  const known = new Set([
    ...doc.sentences.map((s) => s.id),
    ...doc.figures.map((f) => f.id),
    ...doc.equations.map((e) => e.id),
  ]);
  for (const beat of deep.plan.beats) {
    assert.ok(beat.evidence.every((id) => known.has(id)) && (!beat.target || known.has(beat.target)), beat.id);
    if (!beat.target) assert.ok(beat.evidence.length > 0, `${beat.id} has a sentence to point at`);
  }
  assert.equal(standard.plan.beats[1].claim?.n, 1);
  assert.equal(standard.plan.beats[1].claim?.of, 3);
  // The default plan is untouched.
  assert.deepEqual(
    planBeats(card as never, doc, 'standard').map((b) => b.move),
    planBeats(card as never, doc, 'standard').map(() => undefined),
  );
});

// ---------------------------------------------------------------------------------------- the whole tour

test('a standard paper tour is organised by its claims, and every step says its move and its claim', async () => {
  const events: { type: string; data: any }[] = [];
  const { tour, all, requests, metadata } = await run('standard', model(), events);
  assert.equal(tour.doc_type, 'research_paper');
  assert.equal(metadata.planSource, 'claims');
  assert.deepEqual(
    tour.chapters.map((c) => c.id),
    ['problem', 'claim-1', 'claim-2', 'claim-3', 'takeaway'],
  );
  assert.deepEqual(
    tour.chapters.map((c) => c.title),
    ['The problem', 'Measured need saves water', 'Yield is preserved', 'Pumping gets cheaper', 'Takeaway'],
  );
  assert.ok(all.length >= 10 && all.length <= 12, `${all.length} steps`);
  assert.equal(requests.filter((r) => r.name === 'paper_card').length, 1);
  assert.equal(requests.filter((r) => r.name === 'claims').length, 1);
  const calls = requests.filter((r) => r.name === 'beat_direction');
  assert.equal(calls.length, all.length);
  assert.ok(events.some((e) => e.type === 'claims.ready' && e.data.claims.length === 3));
  // The briefs name the claim, its scope and the move, and the rules carry the grammar of the moves.
  const second = calls.find((r) => r.brief.includes('CLAIM 2 OF 3: The saving costs no visible yield.'))!;
  assert.match(second.brief, /THIS STEP OF THE TOUR: What changed\./);
  assert.match(second.brief, /NARRATION MOVE: the conclusion comes first, then one "because"/);
  assert.match(
    calls.find((r) => r.brief.includes('THIS STEP OF THE TOUR: The evidence and how far it reaches'))!.brief,
    /SCOPE OF ITS EVIDENCE: Forty trees/,
  );
  assert.match(
    calls.find((r) => r.brief.includes('THIS STEP OF THE TOUR: Open the tour'))!.brief,
    /THE TOUR'S CLAIMS, in order: 1\) Letting a probe reading/,
  );
  assert.match(calls.find((r) => r.brief.includes('STEP KIND: takeaway'))!.brief, /End by inviting the learner/);
  // Narration is shorter than the usual step: each move has its own range.
  assert.match(calls[0].brief + calls[0].task, /spoken words/);
  assert.ok(metadata.claims && (metadata.claims as unknown[]).length === 3);
  // The camera of the claim steps: the opening and the catch point at sentences, the evidence at its table.
  const evidence = all.find((s) => s.actions[0].type === 'zoom' && (s.actions[0] as any).target === 'tab1');
  assert.ok(evidence);
});

test('a quick claim tour has about six steps and a deep one at most twenty-two, moving forward through the paper', async () => {
  const quick = await run('quick');
  assert.ok(quick.all.length <= 6, `${quick.all.length}`);
  assert.equal(quick.tour.preset, 'quick');
  const deep = await run('deep');
  assert.ok(deep.all.length <= 22 && deep.all.length > 12, `${deep.all.length}`);
  assert.equal(deep.tour.chapters.at(0)?.id, 'problem');
});

test('claims that cannot be found send the tour back to the paper’s argument, after one repair', async () => {
  const events: { type: string; data: any }[] = [];
  const bad = { plan: 'p', claims: [{ title: 'x' }] };
  const { tour, requests, metadata } = await run(
    'standard',
    model((r) => (r.name === 'claims' ? bad : undefined)),
    events,
  );
  assert.equal(requests.filter((r) => r.name === 'claims').length, 2);
  assert.ok(events.some((e) => e.type === 'validation.failed' && e.data.stage === 'claims'));
  assert.equal(metadata.planSource, 'code');
  assert.deepEqual(
    tour.chapters.map((c) => c.id),
    ['problem', 'idea', 'method', 'evidence', 'limits', 'takeaway'],
  );
  // A repair turn lists what was wrong, and a corrected answer is used.
  let calls = 0;
  const fixed = await run(
    'standard',
    model((r) =>
      r.name === 'claims'
        ? ++calls === 1
          ? { ...claims, claims: claims.claims.map((c) => ({ ...c, stated: [c.stated[0]] })) }
          : claims
        : undefined,
    ),
  );
  assert.equal(fixed.metadata.planSource, 'claims');
  assert.match(fixed.requests.filter((r) => r.name === 'claims')[1].task, /must state it in two different places/);
});

test('a paper without an abstract or a conclusion is toured as before, with no claims call', async () => {
  const plain = makeDoc(rows.slice(2, 8), [sections[1], sections[2]]);
  const { requests, metadata } = await (async () => {
    const requests: Request[] = [];
    const result = await new HarnessTourGenerator(settings, 'standard', provider(model(), requests)).generate({
      ...input,
      doc: plain,
    });
    return { ...result, requests };
  })();
  assert.equal(requests.filter((r) => r.name === 'claims').length, 0);
  assert.equal(metadata.planSource, 'code');
});

// --------------------------------------------------------------------------------------------- the moves

test('narration is held to its move: no "The authors" opener, and a measured value needs its comparison', () => {
  assert.deepEqual(moveProblems('The authors show that water falls.', undefined), []);
  assert.match(moveProblems('The authors show that water falls by a lot.', 'why').join(), /Do not open with/);
  assert.match(moveProblems('This paper reports a saving of 31.4 percent.', 'change').join(), /Do not open with/);
  assert.deepEqual(moveProblems('Water use falls by 31.4 percent against the fixed schedule.', 'evidence'), []);
  assert.deepEqual(moveProblems('Water use fell 31.4 percent compared with the timer.', 'evidence'), []);
  assert.match(moveProblems('Water use is 31.4 percent.', 'evidence').join(), /needs its comparison/);
  assert.deepEqual(moveProblems('Water use is 31.4 percent.', 'why'), []);
});

test('a step that opens with "The authors" is sent back once, with the grammar of its move', async () => {
  const seen: Request[] = [];
  const { all } = await run(
    'standard',
    model((r) => {
      if (r.name !== 'beat_direction') return undefined;
      seen.push(r);
      const first = r.brief.includes('THIS STEP OF THE TOUR: What changed.') && r.brief.includes('CLAIM 1 OF 3');
      if (first && !r.task.includes('Do not open with')) return direct(r, `The authors show that ${SAY}`);
      return direct(r);
    }),
  );
  const change = all.find((s) => s.id === 'idea-1')!;
  assert.ok(!change.say.startsWith('The authors'));
  const repaired = seen.filter((r) => r.brief.includes('CLAIM 1 OF 3') && r.brief.includes('What changed.'));
  assert.equal(repaired.length, 2);
  assert.ok(repaired[1].task.includes('lead with the point itself'));
  void ({} as Claim);
  void ({} as Step);
});
