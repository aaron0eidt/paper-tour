import test from 'node:test';
import assert from 'node:assert/strict';
import type { MuseConfig } from '../src/config';
import type { BBox, BlockType, Doc, Tour } from '../../shared/paper';
import type { TourGenerationInput, TourImage } from '../src/tour-generator';
import { HarnessTourGenerator } from './harness-fixture';
import {
  claimContext,
  claimPlan,
  claimSentenceIds,
  claimsSchema,
  claimsTask,
  cleanClaims,
  frontElements,
  frontSentences,
  type Claim,
} from '../src/harness/claims';
import { backTravel, bestOrder, developedAt, readingOf } from '../src/harness/claim-anchors';
import type { Preset } from '../src/harness/beats';

// A claim tour reads forward through the paper. The authors state a claim in the abstract, the introduction and the
// conclusion, but each step points where the paper develops it: the method for how and why, the tables for the evidence,
// the discussion for the catch. A paper of eight pages whose claims are stated on the first page and developed later.

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
const heading = (id: string, page: number, section: string): Row => ({
  id,
  type: 'heading',
  page,
  section,
  sentences: {},
});
const rows: Row[] = [
  heading('p1.b1', 1, 'sec-abstract'),
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
      'p1.s3': 'We find that a batching controller lowers pumping cost by 18.2 percent.',
    },
  },
  heading('p1.b3', 1, 'sec-intro'),
  {
    id: 'p1.b4',
    type: 'paragraph',
    page: 1,
    section: 'sec-intro',
    sentences: {
      'p1.s4': 'Orchard growers water on a fixed schedule even though soil dries at very different speeds.',
      'p1.s5': 'We propose a network of probes that tells each valve when its patch of soil is dry.',
      'p1.s6':
        'Our first contribution is that measured need, not the calendar, sets the dose, which saves 31.4 percent of the water.',
      'p1.s7': 'Our second contribution is a controller that lowers pumping cost by 18.2 percent.',
    },
  },
  heading('p2.b1', 2, 'sec-related'),
  {
    id: 'p2.b2',
    type: 'paragraph',
    page: 2,
    section: 'sec-related',
    sentences: {
      'p2.s1': 'Earlier irrigation controllers follow fixed timers and never read the soil.',
      'p2.s2': 'Soil probes have been used in research plots for decades, but only to record the weather of the soil.',
    },
  },
  heading('p3.b1', 3, 'sec-method'),
  {
    id: 'p3.b2',
    type: 'paragraph',
    page: 3,
    section: 'sec-method',
    sentences: {
      'p3.s1': 'In this section a probe reading replaces the calendar as the thing that sets the dose of every valve.',
      'p3.s2': 'A valve opens only while its probe reads below a threshold, so wet patches receive nothing.',
      'p3.s3': 'Because the dose follows the reading, water is never spent on soil that is already wet.',
    },
  },
  { id: 'p3.b3', type: 'equation', page: 3, section: 'sec-method', sentences: {} },
  heading('p5.b1', 5, 'sec-pump'),
  {
    id: 'p5.b2',
    type: 'paragraph',
    page: 5,
    section: 'sec-pump',
    sentences: {
      'p5.s1': 'The pumping controller batches valve openings, so the pump no longer switches on for every valve.',
      'p5.s2': 'Batching keeps the pump in long cycles, which is where a pump is most efficient.',
    },
  },
  heading('p6.b1', 6, 'sec-results'),
  {
    id: 'p6.b2',
    type: 'paragraph',
    page: 6,
    section: 'sec-results',
    sentences: {
      'p6.s1': 'Across forty trees the probe network used 31.4 percent less water than the fixed schedule.',
      'p6.s2': 'Table 1 lists the water use per tree under both schedules.',
    },
  },
  {
    id: 'p7.b1',
    type: 'paragraph',
    page: 7,
    section: 'sec-results',
    sentences: { 'p7.s1': 'Pumping cost fell by 18.2 percent compared with the timer, as Table 2 shows.' },
  },
  heading('p8.b1', 8, 'sec-discussion'),
  {
    id: 'p8.b2',
    type: 'paragraph',
    page: 8,
    section: 'sec-discussion',
    sentences: {
      'p8.s1': 'However, all trials ran in one orchard over a single season, so other climates are untested.',
      'p8.s2': 'Probes near irrigation lines read wetter, which remains future work.',
    },
  },
  heading('p8.b3', 8, 'sec-conclusion'),
  {
    id: 'p8.b4',
    type: 'paragraph',
    page: 8,
    section: 'sec-conclusion',
    sentences: {
      'p8.s3': 'In conclusion, watering by measured need saves 31.4 percent of the water.',
      'p8.s4': 'The batching controller cut pumping cost by 18.2 percent.',
    },
  },
];
const rect = (i: number): BBox => [50, 40 + 20 * i, 500, 54 + 20 * i];
const titles: Record<string, string> = {
  'sec-abstract': 'Abstract',
  'sec-intro': '1 Introduction',
  'sec-related': '2 Related work',
  'sec-method': '3 Method',
  'sec-pump': '4 Pumping controller',
  'sec-results': '5 Results',
  'sec-discussion': '6 Discussion',
  'sec-conclusion': '7 Conclusion',
};
function makeDoc(list: Row[], names: Record<string, string> = titles): Doc {
  const firstBlock = new Map<string, string>();
  for (const row of list) if (row.section && !firstBlock.has(row.section)) firstBlock.set(row.section, row.id);
  return {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'paper.pdf', sha256: 'f'.repeat(64), num_pages: 8, generator: 'test', title: 'Watering by need' },
    pages: [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({ n, width: 600, height: 800 })),
    sections: Object.entries(names).map(([id, title]) => ({
      id,
      title,
      level: 1,
      page: list.find((r) => r.id === firstBlock.get(id))?.page ?? 1,
      block: firstBlock.get(id) ?? '',
    })),
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
        // A teaser: printed in the introduction, cited by the introduction only.
        id: 'fig0',
        kind: 'figure',
        number: '1',
        page: 1,
        bbox: [50, 300, 500, 400],
        caption: 'Overview of the probe network',
        image: 'figures/fig0.png',
        panels: [],
        referenced_by: ['p1.s5'],
      },
      {
        id: 'tab1',
        kind: 'table',
        number: '1',
        page: 6,
        bbox: [50, 400, 500, 480],
        caption: 'Water use per tree under both schedules',
        image: 'figures/tab1.png',
        panels: [],
        referenced_by: ['p6.s2'],
      },
      {
        id: 'tab2',
        kind: 'table',
        number: '2',
        page: 7,
        bbox: [50, 400, 500, 480],
        caption: 'Pumping cost under both schedules',
        image: 'figures/tab2.png',
        panels: [],
        referenced_by: ['p7.s1'],
      },
    ],
    equations: [{ id: 'eq1', number: '1', page: 3, bbox: [50, 300, 400, 320], block: 'p3.b3', text: 's = 1 - u / b' }],
  };
}
const doc = makeDoc(rows);
const input: TourGenerationInput = {
  documentId: 'doc',
  analysisId: 'a',
  doc,
  images: [
    ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => ({
      targetId: `page${n}`,
      kind: 'page' as const,
      page: n,
      label: `Page ${n}`,
      dataUrl: png,
    })),
    { targetId: 'fig0', kind: 'figure', page: 1, label: 'Figure 1', dataUrl: png },
    { targetId: 'tab1', kind: 'table', page: 6, label: 'Table 1', dataUrl: png },
    { targetId: 'tab2', kind: 'table', page: 7, label: 'Table 2', dataUrl: png },
  ] as TourImage[],
};

const card = {
  plan: 'p',
  doc_type: 'research_paper' as const,
  title: 'Watering by need',
  chapter_titles: {
    problem: 'The problem',
    idea: 'Idea',
    method: 'How',
    evidence: 'Evidence',
    limits: 'Where it stops',
    takeaway: 'Takeaway',
  },
  problem: { text: 'Fixed schedules waste water.', evidence: ['p1.s4'] },
  key_idea: { text: 'Probes tell each valve when the soil is dry.', evidence: ['p1.s5'] },
  method_steps: [{ text: 'A valve opens below a threshold.', evidence: ['p3.s2'] }],
  key_figures: [{ id: 'tab1', why: 'It reports water use.' }],
  key_formulas: [],
  results: [{ text: 'The network used 31.4 percent less water.', evidence: ['p6.s1'] }],
  limitations: [{ text: 'One orchard, one season.', evidence: ['p8.s1'] }],
  takeaway: { text: 'Watering by measured need saves water.', evidence: ['p8.s3'] },
  suggested_questions: ['Why probes?', 'How much is saved?', 'What still fails?'],
};
// The model lists the claims by importance, so the pumping claim, developed later in the paper, comes first. Both claims
// cite the front matter wherever it is allowed: the stated sentences, and, as a model sometimes does, the reasons.
const pumping = {
  title: 'Pumping gets cheaper',
  claim: 'Batching valve openings lowers pumping cost.',
  stated: [
    { place: 'abstract', sentence: 'p1.s3' },
    { place: 'introduction', sentence: 'p1.s7' },
    { place: 'conclusion', sentence: 'p8.s4' },
  ],
  changed: 'Batched openings replace constant switching of the pump.',
  why: { text: 'Batching keeps the pump in long, efficient cycles.', sentences: ['p5.s1', 'p5.s2'], elements: [] },
  evidence: { elements: ['tab2'], sentences: ['p7.s1'], scope: 'Compared with the timer, in one orchard.' },
  catches: [],
};
const watering = {
  title: 'Measured need saves water',
  claim: 'Letting a probe reading set each valve’s dose saves water.',
  stated: [
    { place: 'abstract', sentence: 'p1.s2' },
    { place: 'introduction', sentence: 'p1.s6' },
    { place: 'conclusion', sentence: 'p8.s3' },
  ],
  changed: 'The calendar no longer sets the dose; a reading does.',
  why: { text: 'Water is spent only where the soil is dry.', sentences: ['p3.s2', 'p3.s3'], elements: ['eq1'] },
  evidence: { elements: ['tab1'], sentences: ['p6.s1'], scope: 'Forty trees in one orchard over one season.' },
  catches: [{ text: 'It was tested in one orchard and one season only.', sentences: ['p8.s1'] }],
};
const claims = { plan: 'p', claims: [pumping, watering] };

/** Where each source stands, by page. */
const pages = new Map<string, number>([
  ...doc.sentences.map((s) => [s.id, s.page] as const),
  ...doc.figures.map((f) => [f.id, f.page] as const),
  ...doc.equations.map((e) => [e.id, e.page] as const),
]);
const context = claimContext(doc)!;
const front = frontSentences(doc);
const listed = (preset: Preset = 'standard') => cleanClaims(claims, doc, context, preset).claims!;
/** The page the camera of a planned beat goes to. */
const cameraPage = (beat: { target?: string; evidence: string[] }) => pages.get(beat.target ?? beat.evidence[0]) ?? 0;

// ------------------------------------------------------------------------------------------ the front matter

test('the front matter is the abstract, the introduction and the background, and not the conclusion', () => {
  assert.ok(['p1.s1', 'p1.s5', 'p2.s1'].every((id) => front.has(id)));
  assert.ok(['p3.s2', 'p6.s1', 'p8.s1', 'p8.s3'].every((id) => !front.has(id)));
  // Background titles in several forms, numbered by arabic or roman numbers, nested subsections included.
  const named = (title: string) => frontSentences(makeDoc(rows, { ...titles, 'sec-related': title })).has('p2.s1');
  for (const title of ['2 | Background', 'II | RELATED WORK', 'Background and Related Work', 'Verwandte Arbeiten'])
    assert.ok(named(title), title);
  assert.ok(!named('Theoretical background of the controller'), 'a section that develops the method is not background');
  assert.ok(!named('2 Method'));
});

test('an abstract without a heading is front matter however long it is; only the list offered to the model is capped', () => {
  const long = Object.fromEntries(
    Array.from({ length: 20 }, (_, i) => [
      `p1.s${i + 1}`,
      `Sentence number ${i + 1} of a long abstract that runs on and on.`,
    ]),
  );
  const unlabelled = rows
    .filter((r) => r.id !== 'p1.b1')
    .map((r) => (r.id === 'p1.b2' ? { ...r, section: undefined, sentences: long } : r))
    .map((r) =>
      r.id === 'p1.b4'
        ? { ...r, sentences: { 'p1.s21': 'We propose a network of probes.', 'p1.s22': r.sentences['p1.s7'] } }
        : r,
    );
  const { 'sec-abstract': _, ...names } = titles;
  const paper = makeDoc(unlabelled, names);
  const ctx = claimContext(paper)!;
  const ids = Array.from({ length: 20 }, (_, i) => `p1.s${i + 1}`);
  assert.ok(
    ids.every((id) => ctx.front.has(id)),
    'every sentence before the introduction is front matter',
  );
  assert.deepEqual(
    ctx.candidates.abstract.map((s) => s.id),
    ids.slice(0, 14),
  );
  const body = new Set((claimsSchema(paper, claimSentenceIds(paper, ctx), 'standard') as any).$defs.bodyId.enum);
  assert.ok(
    ids.every((id) => !body.has(id)),
    'none of it can be cited as a reason or evidence',
  );
  assert.ok(ctx.frontElements.has('fig0'), 'a teaser printed before the introduction stays front matter');
});

// -------------------------------------------------------------------------------------- where the front matter ends

/** The same paper with its related work printed late, just before the discussion. */
function lateRelated(): Doc {
  const kept = rows.filter((r) => r.section !== 'sec-related');
  const moved = rows
    .filter((r) => r.section === 'sec-related')
    .map((r) => ({
      ...r,
      id: r.id.replace('p2', 'p8x'),
      page: 8,
      sentences: Object.fromEntries(Object.entries(r.sentences).map(([id, text]) => [id.replace('p2', 'p8x'), text])),
    }));
  const at = kept.findIndex((r) => r.id === 'p8.b1');
  const order = ['sec-abstract', 'sec-intro', 'sec-method', 'sec-pump', 'sec-results', 'sec-related', 'sec-discussion'];
  const names = Object.fromEntries([...order, 'sec-conclusion'].map((id) => [id, titles[id]]));
  return makeDoc([...kept.slice(0, at), ...moved, ...kept.slice(at)], names);
}

test('related work printed late is left out of the body but does not move the front: every table and equation stays usable', () => {
  const late = lateRelated();
  const ctx = claimContext(late)!;
  assert.ok(ctx.front.has('p8x.s1'), 'a review of what others did is not taught from, wherever it stands');
  assert.deepEqual([...ctx.frontElements], ['fig0'], 'only the teaser belongs to the front');
  const [pump, water] = cleanClaims(claims, late, ctx, 'standard').claims!;
  assert.equal(water.why.element, 'eq1');
  assert.deepEqual(water.evidence.elements, ['tab1']);
  assert.deepEqual(pump.evidence.elements, ['tab2']);
  const plan = claimPlan([pump, water], card as never, late, 'standard');
  assert.deepEqual(
    plan.beats.filter((b) => b.move === 'evidence').map((b) => b.target),
    ['tab1', 'tab2'],
    'the plan has its tables and not only sentences',
  );
});

test('a background section is front matter only right after the introduction, and only when it holds no equation', () => {
  const front = (names: Record<string, string>, id: string) => frontSentences(makeDoc(rows, names)).has(id);
  // After the introduction and before the body: a review of what the paper builds on.
  assert.ok(front({ ...titles, 'sec-related': '2 Background' }, 'p2.s1'));
  // A subsection inside the method is the method.
  assert.ok(!front({ ...titles, 'sec-pump': '4.1 Background' }, 'p5.s1'));
  // Right after the introduction but with the equation the method builds on: body, and the equation a reason may use.
  const formal = makeDoc(rows, { ...titles, 'sec-method': '3 Background' });
  assert.ok(!frontSentences(formal).has('p3.s2'));
  assert.deepEqual([...claimContext(formal)!.frontElements], ['fig0']);
  assert.equal(cleanClaims(claims, formal, claimContext(formal)!, 'standard').claims![1].why.element, 'eq1');
  // Related work stays a review wherever it stands, and in its other forms.
  for (const title of [
    '2 | Related Work',
    'Background and Related Work',
    'II. PRIOR WORK',
    'Stand der Technik',
    'Related Works',
    'Previous Works',
    'Prior Art',
    'Related Research',
  ])
    assert.ok(front({ ...titles, 'sec-related': title }, 'p2.s1'), title);
});

const figure = (id: string, page: number, y: number, cites: string[]) => ({
  id,
  kind: 'figure' as const,
  number: id,
  page,
  bbox: [50, y, 500, y + 80] as BBox,
  caption: `Figure ${id}`,
  image: `figures/${id}.png`,
  panels: [],
  referenced_by: cites,
});

test('a figure belongs to the front matter only when the body does not cite it and it is printed before the body', () => {
  const spread: Doc = {
    ...doc,
    figures: [
      ...doc.figures,
      // At the top of the page where the introduction ends, but the method cites it (as in a two-column paper).
      figure('figA', 2, 40, ['p3.s1']),
      figure('figB', 2, 300, []),
      figure('figC', 6, 600, ['p1.s5']),
    ],
    equations: [
      ...doc.equations,
      { id: 'eq0', number: '0', page: 1, bbox: [50, 200, 400, 220], block: 'p1.b4', text: 'x' },
    ],
  };
  assert.deepEqual([...frontElements(spread, front)].sort(), ['eq0', 'fig0', 'figB']);
  const used = structuredClone(claims);
  used.claims[1].why.elements = ['figA'];
  used.claims[1].evidence.elements = ['figB', 'figC'];
  const water = cleanClaims(used, spread, claimContext(spread)!, 'standard').claims![1];
  assert.equal(water.why.element, 'figA', 'cited from the method: developed there, usable as a reason');
  assert.deepEqual(water.evidence.elements, ['figC'], 'printed in the results: evidence; the uncited teaser goes');
});

// ------------------------------------------------------------------------------------------------ the claims

test('the reason, the evidence and the catch rest on the body: sentences of the front matter are taken out', () => {
  const strays = structuredClone(claims);
  // The reason cites the introduction and the background, the evidence the abstract and a body sentence, the catch the intro.
  strays.claims[1].why.sentences = ['p1.s5', 'p2.s1', 'p3.s3'];
  strays.claims[1].evidence.sentences = ['p1.s2', 'p6.s1'];
  strays.claims[1].catches = [{ text: 'It was tested in one orchard only.', sentences: ['p1.s4'] }];
  const checked = cleanClaims(strays, doc, context, 'standard');
  const [, water] = checked.claims!;
  assert.deepEqual(water.why.sentences, ['p3.s3']);
  assert.deepEqual(water.evidence.sentences, ['p6.s1']);
  assert.equal(water.catch, undefined, 'a catch with nothing but front matter to cite is left out');
  // A claim whose evidence is all front matter has none.
  const bare = structuredClone(claims);
  bare.claims[0].evidence = { elements: [], sentences: ['p1.s3', 'p1.s7'], scope: 'x' };
  const dropped = cleanClaims(bare, doc, context, 'standard');
  assert.equal(dropped.claims, null, 'one claim left is no plan');
  assert.match(dropped.problems.join(' '), /no sentence of the abstract, the introduction or the background/);
});

test('the claims call states in the front and cites from the body: two lists of sentences', () => {
  const ids = claimSentenceIds(doc, context);
  const schema = claimsSchema(doc, ids, 'standard') as any;
  const claim = schema.properties.claims.items.properties;
  assert.equal(claim.stated.items.properties.sentence.$ref, '#/$defs/sentenceId');
  for (const part of [
    claim.why.properties.sentences,
    claim.evidence.properties.sentences,
    claim.catches.items.properties.sentences,
  ])
    assert.equal(part.items.$ref, '#/$defs/bodyId');
  const stated: string[] = schema.$defs.sentenceId.enum;
  const body: string[] = schema.$defs.bodyId.enum;
  assert.ok(['p1.s2', 'p1.s6', 'p8.s3'].every((id) => stated.includes(id)));
  assert.ok(
    ['p3.s2', 'p3.s1'].every((id) => !stated.includes(id)),
    'the body does not state a claim',
  );
  assert.ok(['p3.s2', 'p6.s1', 'p8.s1', 'p8.s3'].every((id) => body.includes(id)));
  assert.ok(
    ['p1.s1', 'p1.s5', 'p2.s1'].every((id) => !body.includes(id)),
    'no front matter to cite from',
  );
  // The code's own schema does not list them: cleanClaims judges the IDs itself.
  assert.equal((claimsSchema(doc, ids, 'standard', false) as any).$defs, undefined);
});

test('the limits listed for a catch are sentences it may cite: none of the abstract or the introduction', () => {
  const cue = rows.map((r) =>
    r.id === 'p1.b4'
      ? { ...r, sentences: { ...r.sentences, 'p1.s8': 'However, the approach cannot handle clay soils at all.' } }
      : r,
  );
  const clay = makeDoc(cue);
  const ctx = claimContext(clay)!;
  assert.ok(ctx.limits.length);
  assert.ok(ctx.limits.every((s) => !ctx.front.has(s.id)));
  assert.ok(ctx.limits.some((s) => s.id === 'p8.s1'));
  const body = new Set((claimsSchema(clay, claimSentenceIds(clay, ctx), 'standard') as any).$defs.bodyId.enum);
  assert.deepEqual(
    ctx.limits.filter((s) => !body.has(s.id)),
    [],
    'every listed limit is one the schema lets a catch cite',
  );
  const listed = claimsTask('en-US', ctx, 'standard').split("THE AUTHORS' OWN LIMITS")[1];
  assert.match(listed, /p8\.s1/);
  assert.doesNotMatch(listed, /clay soils/);
});

test('the cited sentences are kept in the order of the paper, so that a step points at the first and the rest follow', () => {
  const shuffled = structuredClone(claims);
  shuffled.claims[0].why.sentences = ['p5.s2', 'p5.s1'];
  shuffled.claims[1].evidence.sentences = ['p6.s2', 'p6.s1'];
  shuffled.claims[1].catches = [{ text: 'One orchard only.', sentences: ['p8.s2', 'p8.s1'] }];
  const [pump, water] = cleanClaims(shuffled, doc, context, 'standard').claims!;
  assert.deepEqual(pump.why.sentences, ['p5.s1', 'p5.s2']);
  assert.deepEqual(water.evidence.sentences, ['p6.s1', 'p6.s2']);
  assert.deepEqual(water.catch?.sentences, ['p8.s1', 'p8.s2']);
});

// ----------------------------------------------------------------------------------------------- the anchors

test('a claim is developed in the section of the earliest thing it rests on, before it, and not where another step points', () => {
  const reading = readingOf(doc, front);
  const query = 'Letting a probe reading set each valve’s dose saves water. The calendar no longer sets the dose.';
  // Its reason is in the method (the equation and p3.s2): the passage is the start of that section.
  assert.deepEqual(developedAt(reading, query, ['p3.s2', 'eq1', 'tab1'], new Set(['p3.s2', 'p3.s3'])), ['p3.s1']);
  // A table is developed where the text first cites it: the results, not wherever the table was placed.
  assert.deepEqual(developedAt(reading, 'Forty trees used less water.', ['tab1'], new Set(['p6.s2'])), ['p6.s1']);
  // The passage that matches the claim best wins, as far as the page after the earliest thing.
  const trees = 'Forty trees used less water than the fixed schedule.';
  assert.deepEqual(developedAt(reading, trees, ['p5.s2', 'tab1'], new Set(['p6.s2'])), ['p6.s1']);
  // Neighbours in a paragraph point together; without a thing to rest on there is no passage.
  assert.deepEqual(developedAt(reading, 'The pumping controller batches valve openings.', ['p5.s2'], new Set()), [
    'p5.s1',
    'p5.s2',
  ]);
  assert.deepEqual(developedAt(reading, query, [], new Set()), []);
  assert.deepEqual(developedAt(reading, query, ['p9.s9'], new Set()), [], 'a thing the document does not have');
  // With every sentence of the section pointed at by other steps, the passage is shared with them.
  assert.deepEqual(developedAt(reading, query, ['p3.s3'], new Set(['p3.s1', 'p3.s2', 'p3.s3'])).slice(0, 1), ['p3.s1']);
});

test('where nothing in the passage matches the claim, the step points at a sentence the claim itself cites, never at the lead of the section', () => {
  const reading = readingOf(doc, front);
  // A results claim whose reason is a method sentence: no sentence near it is about forty trees, and the section's own
  // lead (p3.s1) is not the claim's either. The step points at the sentence the claim cites for its reason.
  const trees = 'Forty trees used less water than the fixed schedule.';
  assert.deepEqual(developedAt(reading, trees, ['p3.s3', 'tab1'], new Set(['p6.s2', 'p3.s3'])), ['p3.s3']);
  assert.deepEqual(developedAt(reading, trees, ['p3.s3'], new Set()), ['p3.s3']);
  // The best match among the claim's own sentences wins, not the earliest, wherever the paper prints it.
  assert.deepEqual(developedAt(reading, trees, ['p3.s2', 'p3.s3'], new Set()), ['p3.s3']);
  const cost = 'Pumping cost fell compared with the timer.';
  assert.deepEqual(developedAt(reading, cost, ['p3.s3', 'p7.s1'], new Set()), ['p7.s1']);
  // Nothing is highlighted that the claim does not cite and that shares no words with it.
  assert.deepEqual(developedAt(reading, 'Wet corners are never watered.', ['tab1'], new Set()), []);
});

test('a step does not begin with the sentence the next step begins with, and never takes an uncited neighbour instead', () => {
  const reading = readingOf(doc, front);
  const batching = 'The pumping controller batches valve openings, so the pump no longer switches for every valve.';
  // Both sentences of the passage are the claim's own, and the next step begins with the first.
  assert.deepEqual(
    developedAt(reading, batching, ['p5.s1', 'p5.s2'], new Set(['p5.s1', 'p5.s2']), new Set(['p5.s1'])),
    ['p5.s2'],
  );
  // Only the one sentence is cited and the next step begins with it: the step is left to where the authors state the claim.
  assert.deepEqual(
    developedAt(reading, 'Wet corners are never watered.', ['p3.s3'], new Set(['p3.s3']), new Set(['p3.s3'])),
    [],
  );
  assert.deepEqual(developedAt(reading, 'Pumping.', ['p5.s1'], new Set(['p5.s1']), new Set(['p5.s1'])), []);
});

test('a figure printed in the front matter is no reason, and is evidence only when nothing else is left', () => {
  const teaser = structuredClone(claims);
  teaser.claims[1].why.elements = ['fig0'];
  teaser.claims[1].evidence = { elements: ['fig0', 'tab1'], sentences: [], scope: 'x' };
  const [, water] = cleanClaims(teaser, doc, context, 'standard').claims!;
  assert.equal(water.why.element, undefined, 'the teaser does not explain why it works');
  assert.deepEqual(water.evidence.elements, ['tab1']);
  const only = structuredClone(claims);
  only.claims[1].evidence = { elements: ['fig0'], sentences: [], scope: 'x' };
  assert.deepEqual(cleanClaims(only, doc, context, 'standard').claims![1].evidence.elements, ['fig0']);
  only.claims[1].evidence.sentences = ['p6.s1'];
  assert.deepEqual(cleanClaims(only, doc, context, 'standard').claims![1].evidence.elements, []);
  // Its passage is not in the front matter either: a claim resting on the teaser and a table is developed at the table.
  const reading = readingOf(doc, front);
  assert.deepEqual(developedAt(reading, 'Forty trees used less water.', ['fig0', 'tab1'], new Set(['p6.s2'])), [
    'p6.s1',
  ]);
  assert.deepEqual(developedAt(reading, 'Forty trees used less water.', ['fig0'], new Set()), []);
});

// -------------------------------------------------------------------------------------------------- the order

test('the camera cost counts jumps back by more than a page, and the order that costs least wins', () => {
  assert.deepEqual(backTravel([1, 3, 3, 6, 5, 5, 7, 8]), { jumps: 0, excess: 0 });
  assert.deepEqual(backTravel([1, 5, 7, 3, 3, 6]), { jumps: 1, excess: 3 });
  // Chapters 0 and 1 span pages 5 to 7 and 3 to 6: the one that starts earlier goes first.
  const spans = [
    [5, 5, 7],
    [3, 3, 6],
  ];
  assert.deepEqual(
    bestOrder(2, (i) => spans[i], [1], [8]),
    [1, 0],
  );
  // Equal costs keep the given order.
  assert.deepEqual(
    bestOrder(3, () => [4], [4], [4]),
    [0, 1, 2],
  );
  assert.deepEqual(
    bestOrder(0, () => [], [], []),
    [],
  );
});

// ---------------------------------------------------------------------------------------------- the plan

const hasFront = (beat: { target?: string; evidence: string[] }) =>
  !beat.target && beat.evidence.some((id) => front.has(id));

test('a claim plan reads forward: only the opening points at the front matter, and the chapters come in paper order', () => {
  for (const preset of ['quick', 'standard', 'deep'] as const) {
    const plan = claimPlan(listed(preset), card as never, doc, preset);
    const camera = plan.beats.map(cameraPage);
    assert.equal(backTravel(camera).jumps, 0, `${preset}: ${camera.join(' ')}`);
    assert.ok(hasFront(plan.beats[0]), 'the opening is where the problem is stated');
    plan.beats
      .slice(1)
      .forEach((beat) => assert.ok(!hasFront(beat), `${preset}: ${beat.id} points at the front matter`));
    // Two steps in a row never begin with the same sentence.
    plan.beats.slice(1).forEach((beat, i) => {
      const before = plan.beats[i];
      if (!beat.target && !before.target && beat.evidence[0])
        assert.notEqual(beat.evidence[0], before.evidence[0], `${preset}: ${before.id} and ${beat.id} begin alike`);
    });
    // The claim developed earlier in the paper is taught first, although the model listed it second.
    assert.deepEqual(
      plan.beats.filter((b) => b.move === 'change').map((b) => b.claim?.text.slice(0, 12)),
      ['Letting a pr', 'Batching val'],
    );
    assert.deepEqual(
      plan.beats.filter((b) => b.move === 'change').map((b) => b.claim?.n),
      [1, 2],
    );
  }
  const plan = claimPlan(listed(), card as never, doc, 'standard');
  const change = plan.beats.find((b) => b.move === 'change')!;
  // What changed is told at the start of the method, where the paper makes the change.
  assert.deepEqual(change.evidence.slice(0, 1), ['p3.s1']);
  assert.equal(pages.get(change.evidence[0]), 3);
  assert.match(plan.beats[0].notes!.join(), /1\) Letting a probe reading.*2\) Batching valve openings/);
  // The authors' own sentences for the claim go to the narration, not to the camera.
  assert.match(change.notes!.join(), /THE AUTHORS STATE THE CLAIM.*In conclusion, watering by measured need saves/);
  assert.ok(change.notes!.join().includes('Our first contribution is that measured need'));
  assert.ok(!change.evidence.some((id) => front.has(id)));
});

test('a results claim whose reason is a method sentence points at a sentence it cites, not at the lead of its section', () => {
  const results: Claim = {
    ...listed()[1],
    title: 'Less water',
    claim: 'Forty trees used less water than the fixed schedule.',
    changed: 'Trees are watered by measurement, not by the calendar.',
    why: { text: 'Water goes only where the soil is dry.', sentences: ['p3.s3'], element: undefined },
    catch: undefined,
  };
  const plan = claimPlan([results, listed()[0]], card as never, doc, 'standard');
  const change = plan.beats.find((b) => b.move === 'change' && b.claim?.text === results.claim)!;
  const why = plan.beats.find((b) => b.move === 'why' && b.claim?.text === results.claim)!;
  // The reason (p3.s3) is the next step's: the change step begins with the claim's results sentence, which it cites.
  assert.equal(change.evidence[0], 'p6.s1');
  assert.notEqual(change.evidence[0], why.evidence[0]);
  assert.match(change.notes!.join(), /THE AUTHORS STATE THE CLAIM/);
});

test('every change step highlights a sentence the claim cites or shares words with, whatever the preset', () => {
  const reading = readingOf(doc, front);
  for (const preset of ['quick', 'standard', 'deep'] as const) {
    const plan = claimPlan(listed(preset), card as never, doc, preset);
    for (const beat of plan.beats.filter((b) => b.move === 'change' && !hasFront(b))) {
      const claim = listed(preset).find((c) => c.claim === beat.claim?.text)!;
      const cited = new Set([...claim.why.sentences, ...claim.evidence.sentences, ...(claim.catch?.sentences ?? [])]);
      const words = reading.shared(`${claim.claim} ${claim.changed} ${claim.title}`);
      beat.evidence.forEach((id) =>
        assert.ok(cited.has(id) || (words.get(id) ?? 0) >= 3, `${preset}: ${id} is neither cited nor about the claim`),
      );
    }
  }
});

test('a reason sentence that no step shows (the step shows its element) is the claim’s own best sentence for the change step', () => {
  const query = 'Batching valve openings keeps the pump in long cycles, which is where a pump is most efficient.';
  // p5.s2 is cited for the reason but not shown, so another claim's step does not take it, and this one may.
  const pump: Claim = {
    ...listed()[0],
    claim: query,
    changed: '',
    why: { text: 'x', sentences: ['p5.s2'], element: 'tab2' },
    evidence: { elements: ['tab1'], sentences: [], scope: 'x' },
  };
  const plan = claimPlan([pump, listed()[1]], card as never, doc, 'standard');
  const change = plan.beats.find((b) => b.move === 'change' && b.claim?.text === query)!;
  assert.equal(change.evidence[0], 'p5.s2');
});

test('the catches a tour keeps belong to the claims the model lists first, wherever their chapters stand in the paper', () => {
  const both = structuredClone(claims);
  both.claims[0].catches = [{ text: 'Only one orchard was piped.', sentences: ['p8.s2'] }];
  const plan = claimPlan(cleanClaims(both, doc, context, 'quick').claims!, card as never, doc, 'quick');
  const caught = plan.beats.filter((b) => b.move === 'catch');
  // A quick tour keeps one catch. The pumping claim is listed first, although its chapter comes second.
  assert.equal(caught.length, 1);
  assert.equal(caught[0].claim?.text.slice(0, 8), 'Batching');
  assert.deepEqual(caught[0].evidence, ['p8.s2']);
});

test('a catch from the end of the paper is told after the last claim, naming its claim, when the next chapter starts earlier', () => {
  const plan = claimPlan(listed(), card as never, doc, 'standard');
  assert.deepEqual(
    plan.chapters.map((c) => [c.id, c.title]),
    [
      ['problem', 'The problem'],
      ['claim-1', 'Measured need saves water'],
      ['claim-2', 'Pumping gets cheaper'],
      ['limits', 'Where it stops'],
      ['takeaway', 'Takeaway'],
    ],
  );
  const catches = plan.beats.filter((b) => b.move === 'catch');
  assert.equal(catches.length, 1);
  assert.equal(catches[0].arc, 'limits');
  assert.deepEqual(catches[0].evidence, ['p8.s1']);
  assert.match(catches[0].notes!.join(), /named in your first words: Measured need saves water/);
  assert.deepEqual(
    plan.beats.map((b) => b.arc),
    ['problem', ...Array(3).fill('claim-1'), ...Array(3).fill('claim-2'), 'limits', 'takeaway'],
  );
  // Told in the claim's own chapter when the paper's next chapter does not start earlier: the last claim keeps its catch.
  const last = structuredClone(claims);
  last.claims[0].catches = [{ text: 'One orchard only.', sentences: ['p8.s1'] }];
  last.claims[1].catches = [];
  const kept = claimPlan(cleanClaims(last, doc, context, 'standard').claims!, card as never, doc, 'standard');
  const own = kept.beats.find((b) => b.move === 'catch')!;
  assert.equal(own.arc, 'claim-2');
  assert.ok(!kept.chapters.some((c) => c.id === 'limits'));
});

test('a reason the paper gives after its evidence is taught after it, and no step goes back for it', () => {
  const late: Claim = {
    ...listed()[1],
    claim: 'Forty trees used less water than the fixed schedule.',
    why: { text: 'Wet corners are not watered.', sentences: ['p8.s2'], element: undefined },
    evidence: { elements: ['tab1'], sentences: [], scope: 'Forty trees.' },
    catch: undefined,
  };
  const plan = claimPlan([late, listed()[0]], card as never, doc, 'standard');
  const first = plan.beats.filter((b) => b.claim?.text === late.claim);
  assert.deepEqual(
    first.map((b) => b.move),
    ['change', 'evidence', 'why'],
  );
  assert.deepEqual(first.map(cameraPage), [6, 6, 8]);
  // A reason on the same page or the page after is taught first, as the claim grammar has it.
  const near = claimPlan([{ ...late, why: { ...late.why, sentences: ['p7.s1'] } }], card as never, doc, 'standard');
  assert.deepEqual(
    near.beats.filter((b) => b.claim).map((b) => b.move),
    ['change', 'why', 'evidence'],
  );
});

test('a claim the body cannot point at falls back to where the authors state it, and a quick tour stays in the body', () => {
  // Without any body sentence (its reason is an equation in front of everything, its evidence a table nothing cites).
  const lone: Claim = {
    ...listed()[0],
    why: { text: '', sentences: [], element: undefined },
    evidence: { elements: [], sentences: [], scope: '' },
  };
  const plan = claimPlan([lone, listed()[1]], card as never, doc, 'quick');
  const changes = plan.beats.filter((b) => b.move === 'change');
  assert.equal(changes.length, 2);
  // The claim with nothing in the body keeps the sentences where its authors state it, the introduction first.
  assert.deepEqual(
    changes.filter(hasFront).map((b) => b.evidence),
    [['p1.s7', 'p1.s3']],
  );
  assert.ok(!changes.filter(hasFront)[0].notes!.join().includes('THE AUTHORS STATE'), 'they are on the page already');
  const quick = claimPlan(listed('quick'), card as never, doc, 'quick');
  const steps = quick.beats.filter((b) => b.move === 'change');
  assert.ok(
    steps.every((b) => !hasFront(b)),
    'a short tour points at the body too',
  );
  assert.ok(steps.every((b) => b.notes!.join().includes('ALSO SAY')));
});

// ------------------------------------------------------------------------------------------- the whole tour

type Request = { name: string; schema: any; task: string };
function provider(model: (r: Request) => unknown): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const parts = (content: any) => (typeof content === 'string' ? [{ type: 'text', text: content }] : content);
    const request: Request = {
      name: body.response_format.json_schema.name,
      schema: body.response_format.json_schema.schema,
      task: body.messages.flatMap((m: any) => parts(m.content).map((p: any) => p.text ?? '')).join('\n'),
    };
    const value = ['visual_plan', 'opening_visual'].includes(request.name)
      ? { plan: 'none', beats: [] }
      : model(request);
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
const scripted = (r: Request) => {
  if (r.name === 'paper_card') return card;
  if (r.name === 'claims') return claims;
  const cue = r.schema.properties.cues.items.properties;
  const target = cue.target.enum?.[0];
  return {
    plan: 'p',
    say: SAY,
    cues: target ? [{ action: cue.action.enum[0], target, label: '', anchor: 'only where the soil' }] : [],
  };
};

test('a whole claim tour reads forward, in every preset, and the steps after the opening leave the front matter alone', async () => {
  for (const preset of ['quick', 'standard', 'deep'] as const) {
    const { tour } = await new HarnessTourGenerator(settings, preset, provider(scripted)).generate(input);
    const camera = (tour as Tour).chapters.flatMap((chapter, c) =>
      chapter.steps
        .filter((step) => !/^check-/.test(step.id))
        .map((step) => {
          const move = step.actions.find((a) => a.type === 'focus' || a.type === 'zoom') as { target: string };
          return { c, page: pages.get(move.target) ?? 0, front: front.has(move.target) };
        }),
    );
    assert.equal(backTravel(camera.map((s) => s.page)).jumps, 0, `${preset}: ${camera.map((s) => s.page).join(' ')}`);
    assert.deepEqual(
      camera.filter((s) => s.c > 0 && s.front),
      [],
      `${preset}: a step after the first chapter points at the front matter`,
    );
  }
});
