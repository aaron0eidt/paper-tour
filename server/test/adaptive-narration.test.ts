import test from 'node:test';
import assert from 'node:assert/strict';
import type { TeachingConcept, TeachingPlan } from '../../shared/teachingPlan';
import { BUILTIN_TOUR_PROFILES, profileSnapshot } from '../../shared/tourProfiles';
import { paperPlan, type Beat } from '../src/harness/beats';
import {
  beatTargets,
  cleanDirection,
  directOptions,
  directionSchema,
  lengthProblems,
  sayLimit,
} from '../src/harness/direct';
import { directTask } from '../src/harness/prompts';
import { claimsNumericExample } from '../src/harness/example';
import { teachingTourPlan } from '../src/harness/teaching-plan';
import { HarnessTourGenerator } from './harness-fixture';
import {
  EXPLAIN,
  card,
  checkReply,
  direct,
  doc,
  input,
  planFor,
  provider,
  settings,
  type Request,
} from './plan-fixture';

const profile = profileSnapshot(BUILTIN_TOUR_PROFILES[2]);

test('a computed adaptive plot demonstrates a numerical case without redundant example frames', () => {
  const beat: Beat = {
    id: 'computed-plot',
    kind: 'method',
    arc: 'method',
    point: 'Explain how the square responds to its input.',
    evidence: ['p1.s3'],
    flexibleNarration: true,
  };
  const visual = {
    visual: 'plot' as const,
    idea: 'Squared input',
    data: 'Illustrative input and its computed square.',
    flexible: true,
  };
  const say =
    'Consider this illustrative numerical example in the Squared input plot. At x equals 1 the output is 1, and at x equals 2 the output is 4. The curve shows why doubling this input multiplies the output by four.';
  assert.ok(claimsNumericExample(say));
  const direction = cleanDirection(
    {
      plan: 'Demonstrate the values on the computed curve.',
      say,
      cues: [],
      plot: {
        kind: 'plot',
        title: 'Squared input',
        source: 'illustrative',
        x: [-2, 2],
        y: [0, 4],
        curves: [{ expression: 'x^2', label: 'Squared input' }],
        marks: [{ type: 'value', curve: 1, at: 1 }],
      },
    },
    beat,
    beatTargets(beat, doc, visual),
    false,
    visual,
  );
  assert.ok(direction?.board, JSON.stringify(direction?.boardProblems));
  assert.deepEqual(direction?.exampleProblems, []);
});
const concept = (id: string, over: Partial<TeachingConcept> = {}): TeachingConcept => ({
  id,
  title: id,
  summary: 'A local measurement changes whether its valve supplies water.',
  role: 'contribution',
  evidence: ['p1.s3'],
  prerequisites: [],
  importance: 'high',
  importanceReason: 'This is the feedback mechanism behind the contribution.',
  difficulty: 'medium',
  difficultyReason: 'Follow a reading through the decision.',
  confidence: 'high',
  objective: 'Explain the relationship between a reading and a local watering decision.',
  misconception: '',
  visual: 'source',
  visualBenefit: 'Use the source passage.',
  visibleChange: '',
  ...over,
});
const teaching = (): TeachingPlan => ({
  version: 'teaching-plan@1',
  question: 'How does measured need change irrigation?',
  audienceAssumption: 'A reader familiar with measurement.',
  concepts: [
    concept('controller'),
    concept('evidence', {
      summary: 'Measured water savings and yield constrain the empirical conclusion.',
      role: 'evidence',
      evidence: ['p2.s1'],
      prerequisites: ['controller'],
    }),
  ],
  sections: doc.sections.map((section) => ({
    sectionId: section.id,
    treatment: 'teach',
    reason: 'Needed for the contribution and its empirical support.',
  })),
});
const raw = (plan: TeachingPlan) => {
  const { version: _, ...value } = plan;
  return { ...value, complete: true };
};
const firstPoint = teaching().concepts[0].summary;
const isController = (request: Request) =>
  new RegExp(`POINT TO MAKE: ${firstPoint.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\n|$)`).test(request.task);
const longExplanation = `${EXPLAIN} A controller can make a local decision because the measurement belongs to a particular patch rather than to the field as a whole. The same schedule treats those patches alike, even when their present conditions differ. Feedback changes that relationship by letting the observed condition influence the next action. A patch that is already wet therefore need not receive the same additional supply as a patch that is drying. This is a statement about the mechanism, not a guarantee that every measurement is representative. A sensor can be influenced by its placement, so the signal has to stand for the roots and surrounding soil that the decision is meant to serve. The threshold also has an interpretation: it turns a continuously varying observation into a decision about whether to open a valve. Neither the threshold nor the observation should be confused with a direct measurement of crop yield. That is why the empirical evaluation has to examine water use and yield separately. Reduced water use establishes one outcome, while stable yield checks whether the saving has an important cost in another outcome. The control loop connects these parts of the argument without making them interchangeable. The probe supplies evidence about the current local condition; the controller applies the decision rule; the valve changes the supply. A later reading can then reflect the effect of that action. Keeping these roles distinct helps explain both the promise of local feedback and the reason inaccurate placement can undermine it.`;

test('adaptive narration keeps its natural length while legacy beats retain their word caps', () => {
  const legacy: Beat = { id: 'test', kind: 'method', arc: 'method', point: firstPoint, evidence: ['p1.s3'] };
  const adaptive = { ...legacy, flexibleNarration: true, say: [20, 40] as [number, number] };
  const targets = beatTargets(adaptive, doc),
    value = { plan: 'Explain the mechanism.', say: longExplanation, cues: [] };
  assert.ok(longExplanation.split(/\s+/).length > 175);
  assert.equal(cleanDirection(value, adaptive, targets)?.say, longExplanation);
  assert.equal(cleanDirection(value, legacy, targets), null);
  assert.deepEqual(lengthProblems(longExplanation, adaptive), []);
  assert.ok(lengthProblems(longExplanation, legacy).length);
  assert.equal(sayLimit(adaptive), Infinity);
  assert.ok(!('maxLength' in directionSchema(adaptive, targets).properties.say));
  assert.ok('maxLength' in directionSchema(legacy, targets).properties.say);
  const prompt = directTask('en-US', 'SOURCE', directOptions(adaptive));
  assert.match(prompt, /natural length it needs/);
  assert.doesNotMatch(prompt, /"say" is \d+-\d+ spoken words|Infinity/);
});
test('all model-planned concepts, worked details and the final synthesis opt into flexible narration', () => {
  const plan = teaching();
  plan.concepts[0].difficulty = 'high';
  const generated = teachingTourPlan(plan, doc, { ...profile, depth: 'deep' }, card, paperPlan(card, doc, 'standard'));
  assert.ok(generated.beats.some((beat) => beat.detail));
  assert.ok(generated.beats.every((beat) => beat.flexibleNarration));
  assert.ok(!paperPlan(card, doc, 'standard').beats.some((beat) => beat.flexibleNarration));
});

function scripted(options: {
  held?: TeachingPlan;
  pick?: (id: string) => string;
  write: (request: Request) => unknown;
  depth?: 'deep';
}) {
  const requests: Request[] = [],
    events: { type: string; data: Record<string, any> }[] = [];
  const selected = { ...profile, ...(options.depth ? { depth: options.depth } : {}) };
  const generator = new HarnessTourGenerator(
    settings,
    selected.depth,
    provider((request) => {
      requests.push(request);
      if (request.name === 'paper_card') return card;
      if (request.name === 'teaching_plan') return raw(options.held ?? teaching());
      if (request.name === 'visual_plan') return planFor(request, options.pick ?? (() => 'none'));
      if (request.name === 'quick_check') return checkReply(request);
      return options.write(request);
    }),
  );
  return {
    requests,
    events,
    generate: () =>
      generator.generate({
        ...input,
        profile: selected,
        onEvent: async (type, data) => {
          events.push({ type, data });
        },
      }),
  };
}
test('the full adaptive path publishes a valid long explanation without a forced shortening repair', async () => {
  const model = scripted({ write: (request) => direct(request, isController(request) ? longExplanation : EXPLAIN) });
  const result = await model.generate();
  const step = result.tour.chapters.flatMap((chapter) => chapter.steps).find((step) => step.id === 'teach-controller');
  assert.equal(step?.say, longExplanation);
  assert.equal(
    model.requests.filter((request) => request.name === 'beat_direction' && isController(request)).length,
    1,
  );
  assert.ok(!model.events.some((event) => event.type === 'beat.fallback' || event.type === 'beat.omitted'));
});
test('exhausted invalid narration cannot publish the concept summary as a substitute', async () => {
  const model = scripted({
    write: (request) => (isController(request) ? { plan: 'invalid', say: '', cues: [] } : direct(request, EXPLAIN)),
  });
  await assert.rejects(
    model.generate(),
    (error: any) => error.code === 'invalid_tour_direction' && /teach-controller/.test(error.message),
  );
  const attempts = model.requests.filter((request) => request.name === 'beat_direction' && isController(request));
  assert.equal(attempts.length, 3);
  assert.match(attempts[1].task, /complete explanation/);
  assert.ok(!model.events.some((event) => ['beat.fallback', 'beat.omitted', 'beat.degraded'].includes(event.type)));
});
for (const broken of ['board', 'example'] as const)
  test(`an invalid adaptive ${broken} gets repair feedback and cannot be stripped for publication`, async () => {
    const model = scripted({
      pick: (id) => (id === 'teach-controller' ? (broken === 'board' ? 'bars' : 'flow') : 'none'),
      write: (request) => {
        if (!isController(request)) return direct(request, EXPLAIN);
        return direct(
          request,
          EXPLAIN,
          broken === 'board'
            ? { bars: { bars: [{ label: 'Invalid value', value: 'not a number' }] } }
            : {
                example: {
                  assumptions: 'Illustrative starting value.',
                  inputs: [{ name: 'input', value: 2 }],
                  calculations: [{ expression: '2+2', result: 5 }],
                  frames: [],
                },
              },
        );
      },
    });
    await assert.rejects(model.generate(), (error: any) => error.code === 'invalid_tour_direction');
    const attempts = model.requests.filter((request) => request.name === 'beat_direction' && isController(request));
    assert.equal(attempts.length, 3);
    assert.match(attempts[1].task, broken === 'board' ? /not a number/ : /example|frame|calculation/i);
    assert.ok(!model.events.some((event) => ['beat.fallback', 'beat.degraded'].includes(event.type)));
  });
test('a detail that repeats its overview fails after targeted repair rather than silently disappearing', async () => {
  const held = teaching();
  held.concepts[0].difficulty = 'high';
  const model = scripted({ held, depth: 'deep', write: (request) => direct(request, EXPLAIN) });
  await assert.rejects(
    model.generate(),
    (error: any) => error.code === 'invalid_tour_direction' && /worked/.test(error.message),
  );
  assert.ok(
    model.requests.some(
      (request) => request.name === 'beat_direction' && /This repeats the preceding overview/.test(request.task),
    ),
  );
  assert.ok(!model.events.some((event) => event.type === 'beat.omitted'));
});
test('an adaptive tour may reuse the same valid board with different spoken focus', async () => {
  const flow = {
    title: 'Sensor control loop',
    nodes: [
      { id: 'node-1', label: 'Probe reading' },
      { id: 'node-2', label: 'Controller' },
      { id: 'node-3', label: 'Valve opens' },
    ],
    edges: [
      { from: 'node-1', to: 'node-2' },
      { from: 'node-2', to: 'node-3' },
      { from: 'node-3', to: 'node-1' },
    ],
  };
  const say = `${EXPLAIN} A probe reading reaches the controller, which decides whether the valve opens. This sensor control loop links each local observation to the next action.`;
  const model = scripted({
    pick: (id) => (id.startsWith('teach-') ? 'flow' : 'none'),
    write: (request) => {
      if (/STEP KIND: takeaway\b/.test(request.task)) return direct(request, EXPLAIN);
      const value = direct(request, say, { flow });
      value.cues.push({
        action: 'board_focus',
        target: isController(request) ? 'node-1' : 'node-2',
        label: '',
        anchor: isController(request) ? 'probe reading' : 'controller',
      });
      return value;
    },
  });
  const result = await model.generate(),
    steps = result.tour.chapters.flatMap((chapter) => chapter.steps).filter((step) => step.id.startsWith('teach-'));
  assert.equal(steps.length, 2);
  assert.ok(
    steps.every((step) => step.actions.some((action) => action.type === 'board' && action.item.kind === 'flow')),
  );
  assert.deepEqual(
    steps
      .map((step) => step.actions.find((action) => action.type === 'board_focus'))
      .map((action) => (action?.type === 'board_focus' ? action.part : null)),
    [0, 1],
  );
  assert.ok(!model.events.some((event) => event.type === 'board.duplicate'));
});

test('a missing planned adaptive visual gets a targeted repair before publication', async () => {
  const flow = {
    title: 'Sensor control loop',
    nodes: [
      { id: 'node-1', label: 'Probe reading' },
      { id: 'node-2', label: 'Controller' },
      { id: 'node-3', label: 'Valve opens' },
    ],
    edges: [
      { from: 'node-1', to: 'node-2' },
      { from: 'node-2', to: 'node-3' },
      { from: 'node-3', to: 'node-1' },
    ],
  };
  let attempts = 0;
  const model = scripted({
    pick: (id) => (id === 'teach-controller' ? 'flow' : 'none'),
    write: (request) => {
      if (!isController(request)) return direct(request, EXPLAIN);
      attempts++;
      if (attempts === 1) return direct(request, EXPLAIN);
      assert.match(request.task, /no valid selected visual or worked example/);
      return direct(
        request,
        `${EXPLAIN} The probe reading reaches the controller, which decides whether the valve opens.`,
        { flow },
      );
    },
  });
  const result = await model.generate();
  assert.equal(attempts, 2);
  const step = result.tour.chapters.flatMap((chapter) => chapter.steps).find((step) => step.id === 'teach-controller');
  assert.ok(step?.actions.some((action) => action.type === 'board' && action.item.kind === 'flow'));
  assert.ok(!model.events.some((event) => event.type === 'beat.degraded'));
});
test('empty native placeholders cannot satisfy the selected adaptive visual', async () => {
  const model = scripted({
    pick: (id) => (id === 'teach-controller' ? 'flow' : 'none'),
    write: (request) => direct(request, EXPLAIN, isController(request) ? { flow: { nodes: [], edges: [] } } : {}),
  });
  await assert.rejects(
    model.generate(),
    (error: any) => error.code === 'invalid_tour_direction' && /no valid selected visual/.test(error.message),
  );
  assert.equal(
    model.requests.filter((request) => request.name === 'beat_direction' && isController(request)).length,
    3,
  );
  assert.ok(!model.events.some((event) => ['beat.fallback', 'beat.degraded'].includes(event.type)));
});
