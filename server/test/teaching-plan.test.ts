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

test('importance selects scope while unfamiliar readers keep prerequisite closure in dependency order', () => {
  assert.deepEqual(
    selectedTeachingConcepts(plan(), { ...prefs, structure: 'overview' }).map((c) => c.id),
    ['background', 'controller', 'results'],
  );
  assert.deepEqual(
    selectedTeachingConcepts(plan(), { ...prefs, audience: 'expert' }).map((c) => c.id),
    ['controller', 'results'],
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
});

test('the current style keeps its grammar and gains important concepts absent from repeated opening claims', () => {
  const held = plan();
  held.concepts.push(
    concept('cost', {
      role: 'evidence',
      evidence: ['p2.s2'],
      objective: 'Compare the separate yield and pumping outcomes.',
    }),
  );
  const existing = paperPlan(card, doc, 'standard');
  const result = teachingTourPlan(held, doc, prefs, card, existing);
  assert.ok(existing.beats.every((beat) => result.beats.some((next) => next.id === beat.id)));
  assert.equal(result.beats.filter((beat) => beat.id === 'teach-cost').length, 1);
  assert.deepEqual(
    result.beats,
    result.chapters.flatMap((chapter) => result.beats.filter((beat) => beat.arc === chapter.id)),
  );
});

test('a bounded evidence vocabulary samples every section instead of only the beginning', () => {
  const ids = teachingEvidence(doc, 4);
  assert.ok(ids.includes('eq1'));
  assert.ok(ids.some((id) => id.startsWith('p1.')));
  assert.ok(ids.some((id) => id.startsWith('p2.')));
  assert.equal(ids.length, 4);
  const schema = teachingPlanSchema(doc);
  assert.ok(schema.$defs!.source.enum.includes('p2.s3'));
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

test('profile generation actually uses the repaired teaching map and saves it with the published tour', async () => {
  const events: { type: string; data: Record<string, any> }[] = [];
  let calls = 0;
  const generator = new HarnessTourGenerator(
    settings,
    'standard',
    provider((request) => {
      if (request.name === 'paper_card') return card;
      if (request.name === 'teaching_plan') {
        calls++;
        if (calls === 1) {
          const invalid = plan();
          invalid.sections.pop();
          return raw(invalid);
        }
        assert.match(request.task, /section sec-2/);
        return raw(plan());
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
