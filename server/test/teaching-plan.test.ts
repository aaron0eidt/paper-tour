import test from 'node:test';
import assert from 'node:assert/strict';
import type { TeachingConcept, TeachingPlan, TeachingPreferences } from '../../shared/teachingPlan';
import {
  cleanTeachingPlan,
  selectedTeachingConcepts,
  teachingEvidence,
  teachingPlanSchema,
  teachingTourPlan,
} from '../src/harness/teaching-plan';
import { paperPlan } from '../src/harness/beats';
import { card, doc, direct, input, provider, planFor, settings, EXPLAIN, checkReply } from './plan-fixture';
import { HarnessTourGenerator } from './harness-fixture';
import Ajv2020 from 'ajv/dist/2020.js';
import { beatTargets, directionSchema } from '../src/harness/direct';
import { BUILTIN_TOUR_PROFILES, profileSnapshot } from '../../shared/tourProfiles';
import {
  allocateFrames,
  cleanVisualPlan,
  exampleRules,
  visualPlanBrief,
  visualPlanTask,
} from '../src/harness/visual-plan';

const prefs: TeachingPreferences = { structure: 'concepts', depth: 'standard', audience: 'general', instructions: '' };
const concept = (id: string, over: Partial<TeachingConcept> = {}): TeachingConcept => ({
  id,
  title: id,
  summary:
    'A controller opens the nearest valve when the measured moisture drops below the threshold. The decision follows measured need instead of a fixed schedule.',
  role: 'mechanism',
  evidence: ['p1.s3'],
  prerequisites: [],
  importance: 'high',
  importanceReason: 'The threshold determines the valve decision.',
  difficulty: 'medium',
  difficultyReason: 'Connect the sensor reading to the controller.',
  confidence: 'medium',
  objective: 'Explain how the threshold changes the valve decision.',
  misconception: '',
  visual: 'source',
  visualBenefit: 'Trace the actual signal path.',
  visibleChange: '',
  ...over,
});
const plan = (): TeachingPlan => ({
  version: 'teaching-plan@1',
  question: 'Can measured need save water?',
  audienceAssumption: 'General technical reader.',
  concepts: [
    concept('results', { role: 'evidence', evidence: ['p2.s1'], prerequisites: ['controller'] }),
    concept('controller', { role: 'contribution', evidence: ['p1.s2'], prerequisites: ['background'] }),
    concept('background', { role: 'prerequisite', evidence: ['p1.s1'], importance: 'low' }),
  ],
  sections: doc.sections.map((s) => ({ sectionId: s.id, treatment: 'teach', reason: 'Supports the main question.' })),
});
const raw = (held: TeachingPlan) => {
  const { version: _, ...value } = held;
  return value;
};

test('the concept map validates real evidence, complete section accounting and acyclic dependencies', () => {
  assert.ok(cleanTeachingPlan(raw(plan()), doc).plan);
  const missing = plan();
  missing.sections.pop();
  assert.match(cleanTeachingPlan(raw(missing), doc).problems.join(' '), /section sec-2/);
  const cycle = plan();
  cycle.concepts[2].prerequisites = ['results'];
  assert.match(cleanTeachingPlan(raw(cycle), doc).problems.join(' '), /Cyclic/);
  const ghost = plan();
  ghost.concepts[0].evidence = ['invented-result'];
  assert.match(cleanTeachingPlan(raw(ghost), doc).problems.join(' '), /unknown source/);
});

test('a new visualization must explain an actual relationship or change', () => {
  const held = plan();
  held.concepts[0].visual = 'new';
  held.concepts[0].visualBenefit = '';
  assert.match(cleanTeachingPlan(raw(held), doc).problems.join(' '), /concrete benefit/);
  held.concepts[0].visualBenefit = 'Compare water use at matched yield.';
  held.concepts[0].visibleChange = 'Reveal the fixed-schedule baseline and the measured reduction.';
  assert.ok(cleanTeachingPlan(raw(held), doc).plan);
});

test('model-planned background and prerequisites remain in dependency order for every audience', () => {
  assert.deepEqual(
    selectedTeachingConcepts(plan(), { ...prefs, structure: 'overview' }).map((c) => c.id),
    ['background', 'controller', 'results'],
  );
  assert.deepEqual(
    selectedTeachingConcepts(plan(), { ...prefs, audience: 'expert' }).map((c) => c.id),
    ['background', 'controller', 'results'],
  );
});

test('paper-order tours use actual source locations and headings, including late results', () => {
  const result = teachingTourPlan(
    plan(),
    doc,
    { ...prefs, structure: 'paper' },
    card,
    paperPlan(card, doc, 'standard'),
  );
  assert.deepEqual(
    result.beats.map((beat) => beat.id),
    ['teach-background', 'teach-controller', 'teach-results', 'takeaway-1'],
  );
  assert.deepEqual(
    result.chapters.map((chapter) => chapter.title),
    ['Introduction', 'Results', 'What to remember'],
  );
  assert.match(result.beats[2].notes!.join(' '), /LEARNING OBJECTIVE/);
  assert.equal(result.beats[2].point, plan().concepts[0].summary);
  assert.notEqual(
    result.beats[2].point,
    plan().concepts[0].objective,
    'a learner-facing summary is distinct from authoring instructions, even if the writer is unavailable',
  );
});

test('every tour structure is built from the actual model concepts instead of preserving canned beats', () => {
  const held = plan();
  held.concepts.push(
    concept('cost', {
      role: 'evidence',
      evidence: ['p2.s2'],
      importance: 'medium',
      objective: 'Compare the separate yield and pumping outcomes.',
    }),
  );
  const existing = paperPlan(card, doc, 'standard');
  const original = JSON.stringify(existing);
  for (const structure of ['concepts', 'overview', 'paper'] as const) {
    const result = teachingTourPlan(held, doc, { ...prefs, structure }, card, existing);
    assert.deepEqual(
      result.beats.map((beat) => beat.id),
      ['teach-background', 'teach-controller', 'teach-results', 'teach-cost', 'takeaway-1'],
      structure,
    );
    assert.ok(!result.beats.some((beat) => beat.notes?.some((note) => note.includes('BEFORE THE MAIN POINT'))));
    assert.deepEqual(
      result.beats,
      result.chapters.flatMap((chapter) => result.beats.filter((beat) => beat.arc === chapter.id)),
    );
    assert.equal(result.beats.find((beat) => beat.id === 'teach-cost')?.point, held.concepts.at(-1)?.summary);
  }
  assert.equal(JSON.stringify(existing), original, 'generating an adaptive plan never changes the original plan');
});

test('concept schemas do not impose a count cap for any selected profile', () => {
  const schema = teachingPlanSchema(doc);
  assert.ok('enum' in schema.$defs!.source && schema.$defs!.source.enum!.includes('p2.s3'));
  assert.ok(!('maxItems' in schema.properties.concepts));
  assert.ok(!('maxItems' in schema.properties.concepts.items.properties.evidence));
  assert.ok(!('maxItems' in schema.properties.concepts.items.properties.prerequisites));
  const held = plan();
  held.concepts.push(
    ...Array.from({ length: 40 }, (_, i) =>
      concept(`mechanism-${i}`, {
        importance: i % 2 ? 'medium' : 'low',
        summary: `Distinct mechanism ${i} explains another necessary operation at the same source passage.`,
      }),
    ),
  );
  assert.ok(
    cleanTeachingPlan(raw(held), doc).plan,
    'more than thirty distinct concepts sharing a valid source are accepted',
  );
  for (const structure of ['concepts', 'overview', 'paper'] as const)
    for (const depth of ['quick', 'standard', 'deep'] as const)
      for (const audience of ['general', 'familiar', 'expert'] as const) {
        const profile = { ...prefs, structure, depth, audience };
        assert.equal(selectedTeachingConcepts(held, profile).length, held.concepts.length);
        const result = teachingTourPlan(held, doc, profile, card, paperPlan(card, doc, 'standard'));
        assert.equal(result.beats.length, held.concepts.length + 1, `${structure}/${depth}/${audience}`);
        for (const entry of held.concepts)
          assert.ok(
            result.beats.some((beat) => beat.id === `teach-${entry.id}`),
            `retain ${entry.id}`,
          );
      }
});

test('all evidence remains citable beyond the old prose and visual budgets without overflowing enum limits', () => {
  const large = structuredClone(doc);
  const extra = Array.from({ length: 1000 }, (_, i) => ({
    id: `p1.extra-sentence-${i}`,
    block: 'p1.extra-paragraph',
    page: 1,
    text: `A distinct source observation ${i}.`,
    rects: [[0, 200, 500, 210] as [number, number, number, number]],
  }));
  large.blocks.push({
    id: 'p1.extra-paragraph',
    page: 1,
    type: 'paragraph',
    section: 'sec-1',
    bbox: [0, 200, 500, 700],
    text: '',
    sentences: extra.map((entry) => entry.id),
  });
  large.sentences.push(...extra);
  large.equations.push(
    ...Array.from({ length: 230 }, (_, i) => ({
      ...doc.equations[0],
      id: `extra-equation-${i}`,
      number: String(i + 2),
    })),
  );
  large.figures.push(
    ...Array.from({ length: 230 }, (_, i) => ({
      ...doc.figures[0],
      id: `extra-figure-${i}`,
      number: String(i + 2),
    })),
  );
  const ids = teachingEvidence(large);
  assert.equal(ids.length, large.sentences.length + large.equations.length + large.figures.length);
  for (const id of [extra.at(-1)!.id, large.equations.at(-1)!.id, large.figures.at(-1)!.id])
    assert.ok(ids.includes(id), id);
  const schema = teachingPlanSchema(large);
  assert.ok(
    !('enum' in schema.$defs!.source),
    'large source vocabularies use a validated string rather than a truncated enum',
  );
  const held = plan();
  held.concepts[0].evidence.push(large.equations.at(-1)!.id, large.figures.at(-1)!.id);
  held.concepts[1].evidence.push(extra.at(-1)!.id);
  assert.ok(cleanTeachingPlan(raw(held), large).plan, 'late known sources survive server-side validation');
  held.concepts[0].evidence.push('unknown-outside-the-document');
  assert.match(cleanTeachingPlan(raw(held), large).problems.join(' '), /unknown source unknown-outside/);
});

test('adaptive visual planning preserves useful repeated representations and permits dynamic worked examples', () => {
  const beats = paperPlan(card, doc, 'standard').beats;
  const result = cleanVisualPlan(
    {
      beats: beats.map((beat) => ({
        beat: beat.id,
        visual: 'plot',
        idea: `A different relationship for ${beat.id}`,
        data: 'Illustrative inputs.',
      })),
    },
    beats,
    { adaptive: true },
  );
  assert.equal(result.adjusted.length, 0);
  assert.ok([...result.plan!.values()].every((visual) => visual.visual === 'plot' && visual.flexible));
  const detail = { ...beats.find((beat) => beat.kind === 'formula')!, detail: true };
  assert.deepEqual(exampleRules(detail, result.plan!.get(detail.id)), { offered: true, required: true });
  const allocated = allocateFrames(result.plan!, beats);
  assert.ok(allocated.get(detail.id)!.frames!.includes('scene'));
  assert.match(visualPlanTask('en-US', { adaptive: true }), /no per-kind/);
  const taught = teachingTourPlan(plan(), doc, prefs, card, paperPlan(card, doc, 'standard'));
  assert.match(visualPlanBrief(card, taught.beats, doc), /LEARNING OBJECTIVE/);
});

test('sections marked teach need actual cited material rather than a coverage declaration alone', () => {
  const held = plan();
  held.concepts[0].evidence = ['p1.s3'];
  const missing = cleanTeachingPlan(raw(held), doc);
  assert.equal(missing.plan, null);
  assert.match(missing.problems.join(' '), /Section sec-2 is marked teach but no concept cites its material/);
  held.sections.find((section) => section.sectionId === 'sec-2')!.treatment = 'background';
  assert.ok(cleanTeachingPlan(raw(held), doc).plan, 'the model may explicitly account for material as background');
  held.sections.find((section) => section.sectionId === 'sec-2')!.treatment = 'teach';
  held.concepts.push(concept('yield-and-cost', { evidence: ['p2.s2'], role: 'evidence', importance: 'medium' }));
  assert.ok(cleanTeachingPlan(raw(held), doc).plan, 'citing an actual passage establishes section coverage');
});

test('profile generation actually uses the repaired teaching map and saves it with the published tour', async () => {
  const events: { type: string; data: Record<string, any> }[] = [];
  let calls = 0;
  const generator = new HarnessTourGenerator(
    settings,
    'standard',
    provider((request) => {
      assert.notEqual(request.name, 'opening_visual', 'paper-order profiles do not pay for a discarded opening plan');
      assert.notEqual(request.name, 'claims', 'paper-order profiles do not pay for a discarded claims plan');
      if (request.name === 'paper_card') return card;
      if (request.name === 'teaching_plan') {
        calls++;
        if (calls === 1) {
          const invalid = plan();
          invalid.sections.pop();
          return { ...raw(invalid), complete: true };
        }
        assert.match(request.task, /section sec-2/);
        return { ...raw(plan()), complete: true };
      }
      if (request.name === 'visual_plan' || request.name === 'opening_visual') return planFor(request);
      if (request.name === 'quick_check') return checkReply(request);
      return direct(request, EXPLAIN);
    }),
  );
  const result = await generator.generate({
    ...input,
    profile: profileSnapshot(BUILTIN_TOUR_PROFILES[2]),
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  assert.equal(calls, 2);
  assert.equal((result.metadata as any).planSource, 'adaptive-paper');
  assert.equal((result.metadata as any).teachingPlan.question, plan().question);
  assert.deepEqual(
    result.tour.chapters.slice(0, 2).map((chapter) => chapter.title),
    ['Introduction', 'Results'],
  );
  assert.ok(events.some((event) => event.type === 'teaching.ready'));
  assert.ok(events.some((event) => event.type === 'validation.failed' && event.data.stage === 'teaching_plan'));
});

test('an overview still teaches evidence when it is rated below the central contribution', () => {
  const held = plan();
  held.concepts[0].importance = 'medium';
  assert.ok(
    selectedTeachingConcepts(held, { ...prefs, structure: 'overview' }).some((concept) => concept.role === 'evidence'),
  );
  const result = teachingTourPlan(held, doc, prefs, card, paperPlan(card, doc, 'standard'));
  assert.ok(result.beats.some((beat) => beat.id === 'teach-background'));
  assert.ok(result.beats.some((beat) => beat.id === 'teach-results'));
  assert.ok(!result.beats.some((beat) => beat.notes?.some((note) => note.includes('BEFORE THE MAIN POINT'))));
});

test('paper order respects the ingested sequence of a two-column page rather than sorting by vertical position', () => {
  const twoColumn = structuredClone(doc);
  twoColumn.blocks[1].bbox = [0, 500, 280, 600];
  twoColumn.blocks.splice(2, 0, {
    id: 'right',
    page: 1,
    type: 'paragraph',
    bbox: [300, 20, 580, 100],
    text: 'Right column',
    section: 'sec-1',
    sentences: ['right.s1'],
  });
  twoColumn.sentences.push({
    id: 'right.s1',
    block: 'right',
    page: 1,
    text: 'Right column',
    rects: [[300, 20, 580, 100]],
  });
  const held = plan();
  held.concepts = [
    concept('right', { evidence: ['right.s1'], role: 'evidence' }),
    concept('left', { evidence: ['p1.s2'], role: 'contribution' }),
  ];
  const result = teachingTourPlan(
    held,
    twoColumn,
    { ...prefs, structure: 'paper' },
    card,
    paperPlan(card, twoColumn, 'standard'),
  );
  assert.deepEqual(
    result.beats.slice(0, 2).map((beat) => beat.id),
    ['teach-left', 'teach-right'],
  );
});

test('invalid teaching maps have bounded repair and cannot silently publish another plan', async () => {
  let calls = 0;
  const generator = new HarnessTourGenerator(
    settings,
    'standard',
    provider((request) => {
      if (request.name === 'paper_card') return card;
      if (request.name === 'teaching_plan') {
        calls++;
        return {};
      }
      if (request.name === 'visual_plan' || request.name === 'opening_visual') return planFor(request);
      return direct(request, EXPLAIN);
    }),
  );
  await assert.rejects(
    generator.generate({ ...input, profile: profileSnapshot(BUILTIN_TOUR_PROFILES[1]) }),
    (error: any) => error.code === 'invalid_teaching_plan',
  );
  assert.equal(calls, 2);
});

test('formula explanations on the PDF and empty cue sets never send an empty enum to the provider', () => {
  const beat = paperPlan(card, doc, 'standard').beats.find((beat) => beat.kind === 'formula')!;
  const none = { visual: 'none' as const, idea: '', data: '', flexible: true };
  const targets = beatTargets(beat, doc, none);
  const schema = directionSchema(beat, targets, true, none);
  const ajv = new Ajv2020({ strict: false });
  const check = ajv.compile(schema);
  assert.deepEqual(schema.properties.cues.items.properties.action.enum, ['box']);
  assert.ok(
    check({
      plan: 'Use the actual equation',
      say: 'The saving compares measured use to the baseline rather than an absolute amount.',
      cues: [{ action: 'box', target: beat.target, label: '', anchor: 'saving compares measured' }],
    }),
  );
  const empty = directionSchema(beat, { page: 1, sentences: [], visuals: [] }, true, none);
  const emptyCheck = ajv.compile(empty);
  assert.ok(
    emptyCheck({
      plan: 'Explain without invented targets',
      say: 'This explanation uses a valid empty list of visual cues.',
      cues: [],
    }),
  );
});
