import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, BBox, BlockType, Doc, DocExercise, Tour } from '../../shared/paper';
import type { ProgramItem } from '../../shared/program';
import type { TeachingConcept, TeachingPlan } from '../../shared/teachingPlan';
import { BUILTIN_TOUR_PROFILES, profileSnapshot } from '../../shared/tourProfiles';
import type { LineCheck, MathVerifier } from '../src/harness/verify';
import type { TourGenerationInput } from '../src/tour-generator';
import { HarnessTourGenerator } from './harness-fixture';
import {
  EXPLAIN,
  card,
  direct,
  doc,
  images,
  input,
  planFor,
  provider,
  reply,
  settings,
  type Request,
} from './plan-fixture';

// Every tour the app creates has a profile and runs in adaptive mode: more repairs and no time-based simplification,
// but one step, one visual or one auxiliary call never costs the tour. What cannot be made is left out and recorded
// (metadata.degraded, the tour's left_out), like in a tour that is not adaptive.

const profile = profileSnapshot(BUILTIN_TOUR_PROFILES[2]);
type Event = { type: string; data: Record<string, any> };
type Degraded = { beat: string; dropped: string[]; problems: string[]; causes?: Record<string, string> };

// ------------------------------------------------------------------------------------------------ a paper

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
const rawPlan = (plan: TeachingPlan) => {
  const { version: _, ...value } = plan;
  return { ...value, complete: true };
};
const firstPoint = teaching().concepts[0].summary;
const isController = (request: Request) => request.task.includes(`POINT TO MAKE: ${firstPoint}`);

/** A paper-specific construction with an explicitly illustrative threshold. */
const valve: ProgramItem = {
  kind: 'program',
  title: 'Illustrative moisture threshold',
  objective: 'Show how comparing a moisture reading with a threshold opens or closes the irrigation valve.',
  source: 'illustrative',
  sourceRefs: ['p1.s3'],
  parameters: [{ name: 'moisture', label: 'Illustrative moisture', value: 0.2, min: 0, max: 1, step: 0.1 }],
  data: [],
  code: `({t,params,math,svg,theme})=>{
    const threshold=0.5,open=math.record('valve_open',params.moisture<threshold?1:0);
    math.record('moisture',params.moisture);
    let out=svg.text(30,40,'Illustrative probe reading and valve control');
    out+=svg.line(60,145,500,145)+svg.rect(60,110,440*params.moisture,35,{fill:theme.blue});
    out+=svg.line(60+440*threshold,85,60+440*threshold,165,{stroke:theme.orange});
    out+=svg.text(60,195,'Moisture '+math.fmt(params.moisture))+svg.text(300,195,'Threshold '+threshold);
    out+=svg.circle(300,285,38,{fill:open?theme.green:theme.panel,stroke:theme.green});
    out+=svg.text(300,292,open?'OPEN':'SHUT',{'text-anchor':'middle',fill:theme.text});
    out+=svg.vector(150,285,250,285,{stroke:theme.blue});
    if(open&&t>.25)for(let i=0;i<3;i++)out+=svg.circle(370+((t*75+i*22)%150),285,7,{fill:theme.blue});
    out+=svg.text(60,380,open?'Below threshold: water reaches the dry patch':'Above threshold: no water is spent');
    return svg.scene(out);
  }`,
};
const broken: ProgramItem = { ...valve, code: '()=>{throw Error("The valve construction needs repair")}' };
const narration = `${EXPLAIN} The illustrative moisture threshold compares a reading with the controller's cutoff. A reading below that threshold opens the valve, while a reading above it keeps the valve shut. Follow the reading into the comparison, then the water flowing to the dry patch.`;

/** A response the client cannot read: the model's own fault, which it reports as muse_invalid_response. */
const unreadable = () =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: 'this is not a json object' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    }),
  );

/** A call that never answers: it ends when the generator gives up on it (its time limit, or the reader leaving). */
const hang = (init?: RequestInit) =>
  new Promise<Response>((_, reject) =>
    init?.signal?.addEventListener('abort', () => reject(init.signal!.reason), { once: true }),
  );

function scripted(options: {
  /** The reply to a call by name; undefined leaves the call to the default of the paper. */
  reply?: (request: Request) => unknown;
  visual?: (beat: string) => string | { visual: string; idea: string; data?: string };
  write?: (request: Request) => unknown;
  /** The calls that never answer, and the time the generator gives a call before it gives up on it. */
  hangs?: (request: Request) => boolean;
  timeoutMs?: number;
}) {
  const requests: Request[] = [],
    events: Event[] = [];
  const model = provider((request) => {
    requests.push(request);
    const own = options.reply?.(request);
    if (own !== undefined) return own;
    if (request.name === 'paper_card') return card;
    if (request.name === 'teaching_plan') return rawPlan(teaching());
    if (request.name === 'visual_plan') return planFor(request, options.visual ?? (() => 'none'));
    if (request.name === 'quick_check') return { plan: 'p', fits: false };
    return (options.write ?? ((r) => direct(r, EXPLAIN)))(request);
  });
  const transport: typeof fetch = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const text = (content: any) =>
      typeof content === 'string' ? content : content.map((part: any) => part.text ?? '').join('\n');
    const seen: Request = {
      name: body.response_format.json_schema.name,
      schema: body.response_format.json_schema.schema,
      task: body.messages.map((message: any) => text(message.content)).join('\n'),
      messages: [],
    };
    return options.hangs?.(seen) ? hang(init) : model(url as never, init);
  }) as typeof fetch;
  const generator = new HarnessTourGenerator(
    { ...settings, timeoutMs: options.timeoutMs ?? settings.timeoutMs },
    profile.depth,
    transport,
  );
  return {
    requests,
    events,
    generate: (signal?: AbortSignal) =>
      generator.generate(
        {
          ...input,
          profile,
          onEvent: async (type, data) => {
            events.push({ type, data });
          },
        },
        undefined,
        signal,
      ),
  };
}
type Generated = Awaited<ReturnType<ReturnType<typeof scripted>['generate']>>;
const stepsOf = (tour: Tour) => tour.chapters.flatMap((chapter) => chapter.steps);
const stepOf = (tour: Tour, id: string) => stepsOf(tour).find((step) => step.id === id);
const hasBoard = (tour: Tour, id: string) => Boolean(stepOf(tour, id)?.actions.some((a: Action) => a.type === 'board'));
const degradedOf = (result: Generated, beat: string) =>
  (result.metadata.degraded as Degraded[]).find((entry) => entry.beat === beat);
const planned = (id: string) =>
  id === 'teach-controller'
    ? { visual: 'program', idea: valve.objective, data: 'Illustrative normalized moisture reading and cutoff.' }
    : 'none';

test('an authored visual that always fails inspection is dropped and recorded; the step keeps its narration', async () => {
  const model = scripted({
    visual: planned,
    reply: (request) => (request.name === 'authored_visual_repair' ? broken : undefined),
    write: (request) =>
      isController(request) ? direct(request, narration, { program: broken }) : direct(request, EXPLAIN),
  });
  const result = await model.generate();
  assert.equal(model.requests.filter((request) => request.name === 'authored_visual_repair').length, 2);
  assert.equal(model.requests.filter((request) => request.name === 'authored_visual_review').length, 0);
  // The step is in the tour with its narration and without a board.
  const step = stepOf(result.tour, 'teach-controller');
  assert.equal(step?.say, narration);
  assert.ok(!hasBoard(result.tour, 'teach-controller'));
  assert.ok(!step?.actions.some((action) => action.type === 'board_focus'));
  assert.ok(
    stepsOf(result.tour)
      .filter((s) => s.id !== 'teach-controller')
      .every((s) => s.say === EXPLAIN),
  );
  // It is recorded, with the checks that failed and the cause.
  const degraded = degradedOf(result, 'teach-controller');
  assert.deepEqual(degraded?.dropped, ['board']);
  assert.deepEqual(degraded?.causes, { board: 'checks' });
  assert.match(degraded!.problems.join(' '), /The valve construction needs repair/);
  assert.deepEqual(result.tour.left_out, [{ step: 'teach-controller', part: 'board', cause: 'checks' }]);
  assert.ok(
    (result.metadata.boards as { dropped: { beat: string }[] }).dropped.some((d) => d.beat === 'teach-controller'),
  );
  assert.ok(!(result.metadata.boards as { shown: string[] }).shown.some((id) => id.startsWith('teach-controller')));
  // The events say the visual failed and the step still completed.
  assert.ok(
    model.events.some(
      (event) => event.type === 'tool.completed' && event.data.name === 'render_visual' && event.data.failed === true,
    ),
  );
  assert.ok(model.events.some((event) => event.type === 'visual.dropped' && event.data.beat === 'teach-controller'));
  assert.ok(model.events.some((event) => event.type === 'beat.degraded' && event.data.beat === 'teach-controller'));
  assert.ok(!model.events.some((event) => ['beat.failed', 'beat.fallback', 'beat.omitted'].includes(event.type)));
});

test('a visual that the model cannot correct is dropped with the model’s fault as its cause', async () => {
  const model = scripted({
    visual: planned,
    reply: (request) => (request.name === 'authored_visual_repair' ? unreadable() : undefined),
    write: (request) =>
      isController(request) ? direct(request, narration, { program: broken }) : direct(request, EXPLAIN),
  });
  const result = await model.generate();
  assert.equal(stepOf(result.tour, 'teach-controller')?.say, narration);
  assert.ok(!hasBoard(result.tour, 'teach-controller'));
  const degraded = degradedOf(result, 'teach-controller');
  assert.deepEqual(degraded?.dropped, ['board']);
  assert.deepEqual(degraded?.causes, { board: 'invalid' });
  assert.match(degraded!.problems.join(' '), /could not be corrected/);
  assert.deepEqual(result.tour.left_out, [{ step: 'teach-controller', part: 'board', cause: 'invalid' }]);
});

for (const [fault, review, code] of [
  ['an unreadable response', unreadable, 'muse_invalid_response'],
  ['a verdict that is no list of problems', () => ({ problems: 'looks fine' }), 'muse_invalid_response'],
  ['a verdict that is null', () => null, 'muse_invalid_response'],
  ['a rejected request', () => new Response('{}', { status: 400 }), 'muse_request_rejected'],
] as const)
  test(`a review call that fails (${fault}) leaves a visual that passed its rendering checks in the tour`, async () => {
    const model = scripted({
      visual: planned,
      reply: (request) => (request.name === 'authored_visual_review' ? review() : undefined),
      write: (request) =>
        isController(request) ? direct(request, narration, { program: valve }) : direct(request, EXPLAIN),
    });
    const result = await model.generate();
    assert.equal(model.requests.filter((request) => request.name === 'authored_visual_review').length, 1);
    assert.equal(model.requests.filter((request) => request.name === 'authored_visual_repair').length, 0);
    // The visual was rendered and checked by the code, so it stays; the missing review is told in an event.
    assert.ok(hasBoard(result.tour, 'teach-controller'));
    const board = stepOf(result.tour, 'teach-controller')!.actions.find((action) => action.type === 'board');
    assert.deepEqual(board?.type === 'board' ? board.item : null, valve);
    assert.equal(degradedOf(result, 'teach-controller'), undefined);
    assert.equal(result.tour.left_out, undefined);
    assert.ok(
      model.events.some(
        (event) =>
          event.type === 'visual.unreviewed' && event.data.beat === 'teach-controller' && event.data.code === code,
      ),
    );
    assert.ok(!model.events.some((event) => ['beat.failed', 'beat.degraded'].includes(event.type)));
  });

test('a direction that never validates keeps its narration and loses the board, with the repairs asked for', async () => {
  const model = scripted({
    visual: (id) => (id === 'teach-controller' ? 'bars' : 'none'),
    write: (request) =>
      isController(request)
        ? direct(request, EXPLAIN, { bars: { bars: [{ label: 'Invalid value', value: 'not a number' }] } })
        : direct(request, EXPLAIN),
  });
  const result = await model.generate();
  const attempts = model.requests.filter((request) => request.name === 'beat_direction' && isController(request));
  assert.equal(attempts.length, 3);
  assert.match(attempts[1].task, /not a number/);
  assert.equal(stepOf(result.tour, 'teach-controller')?.say, EXPLAIN);
  assert.ok(!hasBoard(result.tour, 'teach-controller'));
  const degraded = degradedOf(result, 'teach-controller');
  assert.deepEqual(degraded?.dropped, ['board']);
  assert.deepEqual(degraded?.causes, { board: 'checks' });
  assert.match(degraded!.problems.join(' '), /not a number/);
  assert.deepEqual(result.tour.left_out, [{ step: 'teach-controller', part: 'board', cause: 'checks' }]);
  assert.deepEqual(result.metadata.fallbackBeats, []);
});

test('a direction without any usable narration falls back to its summary and is recorded as a fallback', async () => {
  const model = scripted({
    write: (request) => (isController(request) ? { plan: 'invalid', say: '', cues: [] } : direct(request, EXPLAIN)),
  });
  const result = await model.generate();
  const attempts = model.requests.filter((request) => request.name === 'beat_direction' && isController(request));
  assert.equal(attempts.length, 3);
  assert.equal(stepOf(result.tour, 'teach-controller')?.say, firstPoint);
  assert.deepEqual(result.metadata.fallbackBeats, ['teach-controller']);
  assert.deepEqual(result.metadata.omittedDetails, []);
  assert.deepEqual(result.tour.left_out, [{ step: 'teach-controller', part: 'narration', cause: 'invalid' }]);
  assert.ok(model.events.some((event) => event.type === 'beat.fallback' && event.data.code === 'invalid'));
  assert.ok(!model.events.some((event) => event.type === 'beat.failed'));
});

test('a step whose answers the client cannot read costs the step its explanation, not the tour', async () => {
  const model = scripted({
    reply: (request) => (request.name === 'beat_direction' && isController(request) ? unreadable() : undefined),
  });
  const result = await model.generate();
  assert.equal(stepOf(result.tour, 'teach-controller')?.say, firstPoint);
  assert.deepEqual(result.tour.left_out, [{ step: 'teach-controller', part: 'narration', cause: 'invalid' }]);
  assert.ok(stepsOf(result.tour).length >= 2);
});

test('a teaching plan that cannot be validated falls back to the plan of a tour without a profile', async () => {
  const model = scripted({
    reply: (request) => (request.name === 'teaching_plan' ? { question: 'only a question' } : undefined),
  });
  const result = await model.generate();
  assert.equal(model.requests.filter((request) => request.name === 'teaching_plan').length, 2);
  assert.equal(result.metadata.planSource, 'code');
  assert.equal(result.metadata.teachingPlan, undefined);
  assert.equal((result.metadata.teachingPlanFailed as { code: string }).code, 'invalid_teaching_plan');
  const failed = model.events.find((event) => event.type === 'teaching.failed');
  assert.equal(failed?.data.code, 'invalid_teaching_plan');
  assert.equal(failed?.data.planSource, 'code');
  assert.equal(model.events.find((event) => event.type === 'plan.ready')?.data.planSource, 'code');
  assert.ok(!model.events.some((event) => event.type === 'teaching.ready'));
  // The tour is the paper’s own plan: its problem, idea, method, evidence and takeaway steps.
  const ids = stepsOf(result.tour).map((step) => step.id);
  assert.ok(ids.includes('problem-1') && ids.includes('takeaway-1'), ids.join());
  assert.ok(!ids.includes('teach-controller'));
  assert.ok(stepsOf(result.tour).every((step) => step.say === EXPLAIN));
});

test('a teaching plan call that keeps failing falls back the same way; the model’s own faults are not the tour’s', async () => {
  const model = scripted({ reply: (request) => (request.name === 'teaching_plan' ? unreadable() : undefined) });
  const result = await model.generate();
  assert.equal(result.metadata.planSource, 'code');
  assert.equal((result.metadata.teachingPlanFailed as { code: string }).code, 'invalid_teaching_plan');
  assert.ok(stepsOf(result.tour).length >= 4);
});

test('a cancelled tour is not degraded: the signal ends it, whatever the stage', async () => {
  const stop = new AbortController();
  const requests: string[] = [];
  const generator = new HarnessTourGenerator(
    settings,
    profile.depth,
    provider((request) => {
      requests.push(request.name);
      if (request.name === 'paper_card') return card;
      // The reader leaves while the teaching plan is made: the failure is the signal, not a fault to survive.
      stop.abort(new DOMException('Reader cancelled', 'AbortError'));
      throw stop.signal.reason;
    }),
  );
  await assert.rejects(generator.generate({ ...input, profile }, undefined, stop.signal), () => stop.signal.aborted);
  assert.ok(!requests.includes('beat_direction'));
});

test('a reader who leaves while a visual is being reviewed ends the tour: the visual is not merely dropped', async () => {
  const stop = new AbortController();
  const model = scripted({
    visual: planned,
    reply: (request) => {
      if (request.name !== 'authored_visual_review') return undefined;
      stop.abort(new DOMException('Reader cancelled', 'AbortError'));
      throw stop.signal.reason;
    },
    write: (request) =>
      isController(request) ? direct(request, narration, { program: valve }) : direct(request, EXPLAIN),
  });
  await assert.rejects(model.generate(stop.signal), () => stop.signal.aborted);
  assert.ok(!model.events.some((event) => event.type === 'visual.dropped' || event.type === 'visual.unreviewed'));
  assert.ok(model.events.some((event) => event.type === 'beat.failed' && event.data.code === 'cancelled'));
});

test('a visual plan that cannot be made leaves each step its own board, not the tour', async () => {
  const model = scripted({
    reply: (request) => (request.name === 'visual_plan' ? { plan: 'none', beats: [] } : undefined),
  });
  const result = await model.generate();
  assert.equal(result.tour.chapters.length > 0, true);
  assert.deepEqual(result.metadata.visualPlan, { source: 'fallback' });
  assert.ok(stepsOf(result.tour).length >= 2);
  assert.ok(model.events.some((event) => event.type === 'visual.plan' && event.data.source === 'fallback'));
});

test('a step whose model took too long on every try is explained by its summary and recorded as slow', async () => {
  const model = scripted({
    timeoutMs: 300,
    hangs: (request) => request.name === 'beat_direction' && isController(request),
  });
  const result = await model.generate();
  assert.equal(stepOf(result.tour, 'teach-controller')?.say, firstPoint);
  assert.deepEqual(result.tour.left_out, [{ step: 'teach-controller', part: 'narration', cause: 'slow' }]);
  assert.ok(model.events.some((event) => event.type === 'beat.fallback' && event.data.code === 'slow'));
});

test('a tour whose model took too long on every step is published with every step recorded as slow', async () => {
  const model = scripted({ timeoutMs: 300, hangs: (request) => request.name === 'beat_direction' });
  const result = await model.generate();
  const ids = stepsOf(result.tour).map((step) => step.id);
  assert.ok(ids.length >= 2);
  // The tour has a card and steps (the plan’s own words), and it says so for each one.
  const leftOut = result.tour.left_out ?? [];
  assert.deepEqual(leftOut.map((entry) => entry.step).sort(), [...ids].sort());
  assert.ok(leftOut.every((entry) => entry.part === 'narration' && entry.cause === 'slow'));
  assert.ok(model.events.some((event) => event.type === 'beat.fallback' && event.data.code === 'slow'));
  assert.ok(!model.events.some((event) => event.type === 'beat.failed'));
});

test('a tour whose steps all failed, one of them for being slow, is published like one whose steps all failed alike', async () => {
  const model = scripted({
    timeoutMs: 300,
    hangs: (request) => request.name === 'beat_direction' && isController(request),
    write: () => ({ plan: 'invalid', say: '', cues: [] }),
  });
  const result = await model.generate();
  const leftOut = result.tour.left_out ?? [];
  assert.deepEqual(
    leftOut.map((entry) => entry.step).sort(),
    stepsOf(result.tour)
      .map((step) => step.id)
      .sort(),
  );
  assert.equal(leftOut.find((entry) => entry.step === 'teach-controller')?.cause, 'slow');
  assert.ok(leftOut.filter((entry) => entry.step !== 'teach-controller').every((entry) => entry.cause === 'invalid'));
  assert.ok(!model.events.some((event) => event.type === 'beat.failed'));
});

test('a visual plan whose requests are rejected leaves each step its own board, not the tour', async () => {
  const model = scripted({
    reply: (request) => (request.name === 'visual_plan' ? new Response('{}', { status: 400 }) : undefined),
  });
  const result = await model.generate();
  // The batches are rejected once and the whole plan once: a rejected request is not asked again.
  assert.equal(model.requests.filter((request) => request.name === 'visual_plan').length, 2);
  assert.deepEqual(result.metadata.visualPlan, { source: 'fallback' });
  assert.ok(stepsOf(result.tour).length >= 2);
  assert.ok(model.events.some((event) => event.type === 'visual.plan' && event.data.source === 'fallback'));
  assert.ok(!model.events.some((event) => event.type === 'beat.failed'));
});

test('a quick check whose request is rejected costs the check, not the tour', async () => {
  // The paper’s own plan (the teaching plan fails) is long enough to stop for a check after its result.
  const model = scripted({
    reply: (request) =>
      request.name === 'teaching_plan'
        ? { question: 'only a question' }
        : request.name === 'quick_check'
          ? new Response('{}', { status: 400 })
          : undefined,
  });
  const result = await model.generate();
  assert.equal(model.requests.filter((request) => request.name === 'quick_check').length, 1);
  const skipped = model.events.filter((event) => event.type === 'check.skipped');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].data.reason, 'the check request was rejected');
  assert.ok(!stepsOf(result.tour).some((step) => step.id.startsWith('check-')));
  assert.ok(stepsOf(result.tour).length >= 6);
  assert.ok(!(result.metadata.quickChecks as unknown[] | undefined)?.length);
  assert.ok(!model.events.some((event) => event.type === 'beat.failed'));
});

// ------------------------------------------------------------------------------------------ an exercise sheet

const rect = (y: number): BBox => [50, y, 500, y + 14];
type Row = [string, BlockType, Record<string, string>];
function makeDoc(rows: Row[], exercises: DocExercise[]): Doc {
  return {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'doc.pdf', sha256: 'e'.repeat(64), num_pages: 1, generator: 'test', title: 'Problem Set 2' },
    pages: [{ n: 1, width: 600, height: 800 }],
    sections: [],
    blocks: rows.map(([id, type, sentences], i) => ({
      id,
      page: 1,
      type,
      bbox: rect(40 + 20 * i),
      text: Object.values(sentences).join(' '),
      sentences: Object.keys(sentences),
    })),
    sentences: rows.flatMap(([id, , sentences], i) =>
      Object.entries(sentences).map(([sid, text]) => ({
        id: sid,
        page: 1,
        block: id,
        text,
        rects: [rect(40 + 20 * i)],
      })),
    ),
    figures: [],
    equations: [],
    exercises,
  };
}
const sheet = makeDoc(
  [
    ['p1.b1', 'title', { 'p1.s1': 'Problem Set 2' }],
    ['p1.b2', 'paragraph', { 'p1.s2': 'Problem 1' }],
    [
      'p1.b3',
      'paragraph',
      { 'p1.s3': 'A test finds 99 of every 100 sick people and wrongly flags 1 of every 100 healthy people.' },
    ],
    ['p1.b4', 'paragraph', { 'p1.s4': 'One person in 100 is sick.' }],
    ['p1.b5', 'paragraph', { 'p1.s5': 'a) A person tests positive. What is the probability that the person is sick?' }],
  ],
  [
    {
      id: 'ex1',
      number: '1',
      page: 1,
      block: 'p1.b2',
      blocks: ['p1.b2', 'p1.b3', 'p1.b4', 'p1.b5'],
      parts: [{ id: 'ex1.a', label: 'a', page: 1, blocks: ['p1.b5'] }],
    },
  ],
);
const term = (latex: string, label: string, anchor: string) => ({ latex, label, anchor });
const METHOD =
  'We count natural frequencies: out of ten thousand people, look at the sick people and at the healthy people separately.';
const solution = () => ({
  plan: 'positives: 99 sick + 99 healthy',
  read: {
    say: 'We are given how accurate the test is and how rare the disease is, and we are asked for the chance that a positive person is sick.',
    given: ['p1.s3'],
    given_anchor: 'how accurate the test is',
    asked: ['p1.s5'],
    asked_anchor: 'the chance that',
    marks: [],
  },
  method: {
    say: METHOD,
    formula: {
      title: 'Bayes',
      latex: 'P(S\\mid +)=\\frac{P(+\\mid S)P(S)}{P(+)}',
      terms: [term('P(S\\mid +)', 'sick given positive', 'natural frequencies')],
    },
  },
  steps: [
    {
      title: 'Count positives',
      latex: '99 + 99 = 198',
      terms: [term('198', 'all positives', 'all positives')],
      say: 'Ninety-nine sick and ninety-nine healthy people test positive, so there are all positives to divide by.',
      sure: true,
    },
    {
      title: 'Divide',
      latex: 'P = \\frac{99}{198}',
      terms: [term('\\frac{99}{198}', 'sick share', 'sick share')],
      say: 'The sick share of the positives is ninety-nine out of those, which we simplify now.',
      sure: true,
    },
  ],
  answer: {
    title: 'Result',
    latex: 'P = 0.5',
    terms: [term('0.5', 'one half', 'one half')],
    say: 'So the chance is one half, which surprises most people.',
  },
  try: {
    prompt:
      'Before we count, how many people would you expect to be sick among ten thousand, and how many of them test positive?',
    hints: ['Start from the share of sick people.', 'Then ask how many sick people the test catches.'],
  },
  check_note: 'Please check this step yourself.',
  questions: ['Why natural frequencies?', 'What if the disease were rarer?'],
});
const titles = {
  problem: 'What it is',
  idea: 'Idea',
  method: 'How',
  evidence: 'Facts',
  limits: 'Catches',
  takeaway: 'Remember',
};
const sheetCard = {
  plan: 'p',
  doc_type: 'exercise_sheet' as const,
  title: 'A problem set',
  chapter_titles: titles,
  problem: { text: 'A sheet on conditional probability.', evidence: ['p1.s3'] },
  key_idea: { text: 'Count natural frequencies.', evidence: ['p1.s3'] },
  method_steps: [{ text: 'Count and divide.', evidence: ['p1.s3'] }],
  key_figures: [],
  key_formulas: [],
  results: [],
  limitations: [{ text: 'Check every step.', evidence: ['p1.s3'] }],
  takeaway: { text: 'Practise the method.', evidence: ['p1.s3'] },
  suggested_questions: ['Why natural frequencies?', 'How do I check?', 'What about a rarer disease?'],
};
const ok: LineCheck = { status: 'ok' };
const verifier: MathVerifier = async (lines) => lines.map(() => ok);
/** The construction of the paper, with a cutoff that is not the sheet's answer (a board never shows the result). */
const rendering = valve.code.replace('threshold=0.5', 'threshold=0.6');
/** The same construction as a method visual of the part: its title is what the method narration talks about. */
const frequencies = (code: string): ProgramItem => ({
  ...valve,
  title: 'Natural frequencies of ten thousand people',
  objective: 'Show how ten thousand people split into sick and healthy people who test positive.',
  sourceRefs: ['p1.s3'],
  code,
});

function sheetTour(options: {
  visual: ProgramItem;
  repair?: ProgramItem;
  review?: () => unknown;
  /** The reply to a call by name; undefined leaves the call to the default of the sheet. */
  reply?: (request: Request) => unknown;
}) {
  const requests: Request[] = [],
    events: Event[] = [];
  const generator = new HarnessTourGenerator(
    settings,
    'deep',
    provider((request) => {
      requests.push(request);
      const own = options.reply?.(request);
      if (own !== undefined) return own;
      if (request.name === 'paper_card') return sheetCard;
      if (request.name === 'visual_plan')
        return planFor(request, (id) =>
          id === 'exercise-ex1.a'
            ? { visual: 'program', idea: 'Ten thousand people sorted.', data: 'Illustrative counts.' }
            : 'none',
        );
      if (request.name === 'exercise_solution') return solution();
      if (request.name === 'exercise_visual') return { plan: 'p', program: options.visual, focus: [] };
      if (request.name === 'authored_visual_repair') return options.repair ?? options.visual;
      if (request.name === 'authored_visual_review') return options.review?.() ?? { problems: [] };
      return direct(request, EXPLAIN);
    }),
    verifier,
  );
  const generationInput: TourGenerationInput = {
    documentId: 'doc',
    analysisId: 'a',
    doc: sheet,
    images: images.slice(0, 1),
    profile,
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  };
  return { requests, events, generate: () => generator.generate(generationInput) };
}
const boardKinds = (tour: Tour, id: string) =>
  (stepOf(tour, id)?.actions ?? []).flatMap((action: Action) => (action.type === 'board' ? [action.item.kind] : []));

test('an exercise part whose method visual keeps failing inspection is taught without it, and the tour records the loss', async () => {
  const model = sheetTour({ visual: frequencies(broken.code) });
  const { tour, metadata } = await model.generate();
  assert.equal(model.requests.filter((request) => request.name === 'authored_visual_repair').length, 2);
  // The part keeps its steps: the checkpoint, the method with its rule, the lines and the answer.
  assert.deepEqual(
    stepsOf(tour)
      .filter((step) => step.id.startsWith('ex1.a'))
      .map((step) => step.id),
    ['ex1.a-task', 'ex1.a-try', 'ex1.a-method', 'ex1.a-step-1', 'ex1.a-step-2', 'ex1.a-answer'],
  );
  assert.ok(stepsOf(tour).every((step) => boardKinds(tour, step.id).every((kind) => kind === 'formula')));
  assert.deepEqual(boardKinds(tour, 'ex1.a-method'), ['formula']);
  const degraded = (metadata.degraded as Degraded[]).find((entry) => entry.beat === 'exercise-ex1.a');
  assert.deepEqual(degraded?.dropped, ['board']);
  assert.deepEqual(degraded?.causes, { board: 'checks' });
  assert.match(degraded!.problems.join(' '), /The valve construction needs repair/);
  assert.deepEqual(tour.left_out, [{ step: 'exercise-ex1.a', part: 'board', cause: 'checks' }]);
  // The part is solved, it only has no visual.
  const exercises = metadata.exercises as { id: string; solved: boolean; visual?: string }[];
  const record = exercises.find((e) => e.id === 'ex1.a')!;
  assert.equal(record.solved, true);
  assert.equal(record.visual, undefined);
  assert.ok(model.events.some((event) => event.type === 'visual.dropped' && event.data.beat === 'exercise-ex1.a'));
  assert.ok(model.events.some((event) => event.type === 'beat.degraded' && event.data.beat === 'exercise-ex1.a'));
  assert.ok(!model.events.some((event) => event.type === 'beat.failed'));
});

test('an exercise part whose visual cannot be reviewed keeps the visual that passed its rendering checks', async () => {
  const model = sheetTour({ visual: frequencies(rendering), review: unreadable });
  const { tour, metadata } = await model.generate();
  assert.equal(model.requests.filter((request) => request.name === 'authored_visual_review').length, 1);
  assert.deepEqual(boardKinds(tour, 'ex1.a-method'), ['program']);
  assert.deepEqual(metadata.degraded, []);
  assert.equal(tour.left_out, undefined);
  assert.ok(model.events.some((event) => event.type === 'visual.unreviewed' && event.data.beat === 'exercise-ex1.a'));
});

test('an exercise part whose method visual request is rejected is taught without it, and the tour records the loss', async () => {
  const model = sheetTour({
    visual: frequencies(rendering),
    reply: (request) => (request.name === 'exercise_visual' ? new Response('{}', { status: 400 }) : undefined),
  });
  const { tour, metadata } = await model.generate();
  // A rejected request would be rejected again: it is asked once.
  assert.equal(model.requests.filter((request) => request.name === 'exercise_visual').length, 1);
  assert.equal(model.requests.filter((request) => request.name === 'authored_visual_repair').length, 0);
  assert.deepEqual(
    stepsOf(tour)
      .filter((step) => step.id.startsWith('ex1.a'))
      .map((step) => step.id),
    ['ex1.a-task', 'ex1.a-try', 'ex1.a-method', 'ex1.a-step-1', 'ex1.a-step-2', 'ex1.a-answer'],
  );
  assert.ok(stepsOf(tour).every((step) => boardKinds(tour, step.id).every((kind) => kind === 'formula')));
  const degraded = (metadata.degraded as Degraded[]).find((entry) => entry.beat === 'exercise-ex1.a');
  assert.deepEqual(degraded?.dropped, ['board']);
  assert.deepEqual(degraded?.causes, { board: 'invalid' });
  assert.deepEqual(tour.left_out, [{ step: 'exercise-ex1.a', part: 'board', cause: 'invalid' }]);
  const record = (metadata.exercises as { id: string; solved: boolean }[]).find((e) => e.id === 'ex1.a')!;
  assert.equal(record.solved, true);
  assert.ok(!model.events.some((event) => event.type === 'beat.failed'));
});

test('an exercise part whose visual review returns null keeps the visual that passed its rendering checks', async () => {
  const model = sheetTour({ visual: frequencies(rendering), review: () => reply(null) });
  const { tour, metadata } = await model.generate();
  assert.equal(model.requests.filter((request) => request.name === 'authored_visual_review').length, 1);
  assert.deepEqual(boardKinds(tour, 'ex1.a-method'), ['program']);
  assert.deepEqual(metadata.degraded, []);
  assert.equal(tour.left_out, undefined);
  assert.ok(model.events.some((event) => event.type === 'visual.unreviewed' && event.data.beat === 'exercise-ex1.a'));
});
