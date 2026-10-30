import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc, DocFigure, Tour } from '../../shared/paper';
import { ProcessingError } from '../src/errors';
import { HarnessTourGenerator } from './harness-fixture';
import {
  EXPLAIN,
  card,
  checkReply,
  direct,
  doc as base,
  input,
  planFor,
  provider,
  reply,
  settings,
  type Request,
} from './plan-fixture';
import { planBeats, type Beat } from '../src/harness/beats';
import {
  allocateFrames,
  cleanOpeningPlan,
  cleanVisualPlan,
  openingEntry,
  openingPlanTask,
  visualPlanBrief,
  visualPlanSchema,
  visualPlanTask,
  withTableBoard,
  type StepVisual,
  type VisualPlan,
} from '../src/harness/visual-plan';
import { tableViews } from '../src/harness/tables';
import { PACE, limited, type Pace } from '../src/harness/pace';

// The first step arrives sooner (notes/ROADMAP.md, "no waiting"): the opening step of a paper has its visual planned alone,
// ahead of the plan of the whole tour; the plan keeps that choice and counts it toward the tour's limits; a call that
// outlives its time is tried again lean, and a step stops repairing its board once it has used its time.

const beats = planBeats(card, base, 'standard');
const ids = beats.map((beat) => beat.id);
const opening: Beat = beats[0];
const entry = (beat: string, visual: string, idea = 'Show how the parts relate.', data = '') => ({
  beat,
  visual,
  idea,
  data,
});
const none: StepVisual = { visual: 'none', idea: '', data: '' };
const steps = (tour: Tour) => tour.chapters.flatMap((c) => c.steps);
const ahead = (visual: StepVisual['visual'], extra: Partial<StepVisual> = {}): VisualPlan =>
  new Map([['problem-1', { visual, idea: 'Show the setting.', data: 'illustrative values', ...extra }]]);

// ------------------------------------------------------------------------------------------ the plan keeps a step

test('a step planned ahead is kept as decided, counted toward the limits, and the model’s entry for it is ignored', () => {
  const settled = ahead('heatmap');
  const { plan, adjusted } = cleanVisualPlan(
    {
      beats: [
        entry('problem-1', 'scatter', 'A different picture for the opening.'),
        entry('method-1', 'heatmap'),
        entry('idea-1', 'scatter'),
      ],
    },
    beats,
    {},
    settled,
  );
  assert.ok(plan);
  assert.equal(plan.get('problem-1')!.visual, 'heatmap');
  assert.equal(plan.get('idea-1')!.visual, 'scatter');
  // The kind the opening uses is used up: the later step with it is left to the page, and the reason says so.
  assert.equal(plan.get('method-1')!.visual, 'none');
  assert.deepEqual(adjusted, [{ beat: 'method-1', visual: 'heatmap', reason: 'at most 1 heatmap board' }]);
});

test('a step planned ahead counts toward the share of steps that get a board', () => {
  const settled = ahead('flow');
  const { plan, adjusted } = cleanVisualPlan(
    {
      beats: [
        entry('idea-1', 'heatmap'),
        entry('method-1', 'scatter'),
        entry('formula-1', 'plot'),
        entry('figure-1', 'timeline'),
        entry('result-1', 'bars'),
      ],
    },
    beats,
    {},
    settled,
  );
  const drawn = [...plan!.values()].filter((e) => e.visual !== 'none');
  assert.equal(drawn.length, 4, 'six in ten of eight steps, the opening included');
  assert.equal(plan!.get('problem-1')!.visual, 'flow');
  assert.deepEqual(
    adjusted.map((a) => a.beat),
    ['figure-1', 'result-1'],
  );
});

test('an answer with no entry of its own is no plan, even when a step was planned ahead', () => {
  const { plan, problems } = cleanVisualPlan({ beats: [entry('problem-1', 'bars')] }, beats, {}, ahead('heatmap'));
  assert.equal(plan, null);
  assert.deepEqual(problems, ['beats: no entry']);
});

test('the plan call leaves the step planned ahead out of its schema and brief, and the task tells it to count it', () => {
  const rest = beats.filter((b) => b.id !== 'problem-1');
  const schema: any = visualPlanSchema(rest);
  assert.deepEqual(
    schema.properties.beats.items.properties.beat.enum,
    ids.filter((id) => id !== 'problem-1'),
  );
  assert.equal(schema.properties.beats.maxItems, ids.length - 1);
  const brief = visualPlanBrief(card, beats, base, ahead('heatmap'));
  assert.match(
    brief,
    /\[problem-1\] problem step\n {2}already planned \(leave it out of your answer; it counts toward the limits\): VISUAL FOR THIS STEP: heatmap: Show the setting\./,
  );
  assert.doesNotMatch(visualPlanBrief(card, beats, base), /already planned/);
  assert.match(visualPlanTask('en-US', { settled: true }), /A step marked "already planned" keeps its visual/);
  assert.doesNotMatch(visualPlanTask('en-US'), /already planned/);
});

test('example frames are not allotted again to a step that was written with its own', () => {
  const planned: VisualPlan = new Map(beats.map((b) => [b.id, none]));
  planned.set('problem-1', { visual: 'bars', idea: 'Show the setting.', data: 'illustrative', frames: ['bars'] });
  planned.set('method-1', { visual: 'bars', idea: 'Show the readings.', data: 'illustrative' });
  const out = allocateFrames(planned, beats, new Set(['problem-1']));
  assert.deepEqual(out.get('problem-1')!.frames, ['bars'], 'no formula frame is added after the fact');
  assert.ok(out.get('method-1')!.frames!.includes('formula'));
  // Without the set, the opening would be allotted like any other step.
  assert.ok(allocateFrames(planned, beats).get('problem-1')!.frames!.includes('formula'));
});

test('the opening step’s example frames stay in its own kind; a relationship or none carries none', () => {
  const flow = openingEntry({ visual: 'flow', idea: 'x', data: '' });
  assert.deepEqual(flow.frames, ['flow']);
  for (const visual of ['none', 'heatmap', 'scatter', 'plot', 'timeline', 'distribution', 'shapes'] as const)
    assert.equal(openingEntry({ visual, idea: 'x', data: '' }).frames, undefined, visual);
});

test('the opening answer is checked like a plan of one step: the first entry counts, nothing usable is no choice', () => {
  const good = cleanOpeningPlan({ beats: [entry('problem-1', 'flow', 'Show the problem.', 'a, b')] }, opening);
  assert.equal(good.visual!.visual, 'flow');
  assert.deepEqual(good.visual!.frames, ['flow']);
  assert.equal(cleanOpeningPlan({ beats: [entry('problem-1', 'none')] }, opening).visual!.visual, 'none');
  for (const value of [
    { beats: [] },
    { beats: [entry('idea-1', 'flow')] },
    { beats: [entry('problem-1', 'flow', '')] },
    null,
  ])
    assert.equal(cleanOpeningPlan(value, opening).visual, null);
  const task = openingPlanTask('en-US');
  assert.match(task, /OPENING step/);
  assert.match(task, /each kind is used at most once in the whole tour/);
  assert.match(task, /The learner is waiting for this step to start/);
});

// -------------------------------------------------------------- a table board never takes a step planned ahead

const num = (name: string) => ({ name, kind: 'number' as const });
const cell = (text: string) => ({ text, value: Number(text) });
const table: DocFigure = {
  id: 'tab1',
  kind: 'table',
  number: '1',
  page: 2,
  bbox: [0, 160, 400, 300],
  caption: 'Table 1: Water saved and cost of four irrigation methods',
  image: 'figures/tab1.png',
  panels: [],
  referenced_by: ['p2.s2'],
  grid: {
    confidence: 'high',
    method: 'spans',
    label_header: 'Method',
    columns: [num('Water saved (%)'), num('Pump cost (EUR)'), num('Yield (t)')],
    rows: [
      { label: 'Fixed schedule', cells: ['0', '480', '9.8'].map(cell) },
      { label: 'Timer + rain stop', cells: ['12.5', '430', '9.7'].map(cell) },
      { label: 'Probe network', cells: ['31.4', '392.5', '9.6'].map(cell) },
      { label: 'Probe network (cheap)', cells: ['27.2', '350', '9.5'].map(cell) },
    ],
  },
};
const tableDoc: Doc = { ...base, figures: [...base.figures, table] };
const tableCard = { ...card, key_figures: [{ id: 'tab1', why: 'It compares the methods.' }], key_formulas: [] };

test('a results step on a table never takes the board of a step planned ahead, however much it needs the kind', () => {
  const tableBeats = planBeats(tableCard, tableDoc, 'standard');
  const kinds = [...new Set(tableViews(table).map((view) => view.kind))];
  const busy: VisualPlan = new Map(tableBeats.map((b) => [b.id, none]));
  // Every kind the table can draw is in use, the first one by the opening step.
  const holders = ['problem-1', 'idea-1', 'method-1', 'limitation-1'];
  kinds
    .slice(0, holders.length)
    .forEach((kind, i) => busy.set(holders[i], { visual: kind, idea: 'Show the idea.', data: 'illustrative' }));
  const taken = withTableBoard(busy, tableBeats, tableDoc, new Set(['problem-1']));
  assert.equal(taken.plan.get('problem-1')!.visual, kinds[0], 'the opening step keeps its board');
  const loose = withTableBoard(busy, tableBeats, tableDoc);
  assert.equal(loose.plan.get('problem-1')!.visual, 'none', 'without the protection it is the one that goes');
});

// ------------------------------------------------------------------------------------------- the opening step

type Seen = { type: string; data: Record<string, any>; at: number };

/**
 * A scripted paper model. `plan` answers the call that plans every step but the opening, `opening` the call that plans the
 * opening, and `hold` keeps the first of the two answers back until the test lets it go.
 */
function model(options: {
  opening?: (request: Request) => unknown;
  plan?: (request: Request) => unknown;
  direction?: (request: Request) => unknown;
  gate?: Promise<void>;
}) {
  const requests: Request[] = [];
  const fetch = provider(async (request) => {
    requests.push(request);
    if (request.name === 'paper_card') return card;
    if (request.name === 'opening_visual') return (options.opening ?? ((r) => planFor(r)))(request);
    if (request.name === 'visual_plan') {
      await options.gate;
      return (options.plan ?? ((r) => planFor(r)))(request);
    }
    if (request.name === 'quick_check') return checkReply(request, { fits: false });
    return options.direction?.(request) ?? direct(request, EXPLAIN);
  });
  return { requests, fetch };
}
const run = async (fetch: typeof globalThis.fetch, events: Seen[] = [], pace?: Pace) =>
  new HarnessTourGenerator(settings, 'standard', fetch, undefined, undefined, pace).generate({
    ...input,
    onEvent: async (type, data) => {
      events.push({ type, data, at: events.length });
    },
  });
const latch = () => {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
};

test('the opening step is written and announced while the plan of the other steps is still being made', async () => {
  const gate = latch();
  const { requests, fetch } = model({
    gate: gate.opened,
    opening: (r) => planFor(r, (id) => (id === 'problem-1' ? 'heatmap' : 'none')),
  });
  const events: Seen[] = [];
  const done = run(fetch, events);
  // The plan call is held back: the first step must still be announced.
  const announced = new Promise<void>((resolve) => {
    const timer = setInterval(() => {
      if (events.some((e) => e.type === 'tour.partial')) (clearInterval(timer), resolve());
    }, 5);
  });
  await Promise.race([
    announced,
    new Promise((_, fail) => setTimeout(() => fail(new Error('the first step waited for the plan')), 3000)),
  ]);
  assert.ok(!events.some((e) => e.type === 'visual.plan'), 'the plan was still being made');
  const first = events.find((e) => e.type === 'tour.partial')!;
  assert.equal(first.data.ready, 1);
  assert.equal(steps(first.data.tour as Tour)[0].id, 'problem-1');
  gate.open();
  const { tour, metadata } = await done;

  // The opening step was briefed with the visual it was planned with, and with example frames in that kind only.
  const problem = requests.find((r) => r.name === 'beat_direction' && r.task.includes('STEP KIND: problem'))!;
  assert.match(problem.task, /VISUAL FOR THIS STEP: heatmap: Show the idea\./);
  // The plan of the others answers for the other steps, and is told about the opening one.
  const plan = requests.find((r) => r.name === 'visual_plan')!;
  assert.deepEqual(
    plan.schema.properties.beats.items.properties.beat.enum,
    ids.filter((id) => id !== 'problem-1'),
  );
  assert.match(plan.task, /already planned/);
  assert.match(plan.task, /VISUAL FOR THIS STEP: heatmap/);
  // The tour has all its steps, the opening's choice stays in the plan, and no step waited for its own visual twice.
  assert.equal(steps(tour).length, ids.length);
  const planned = (metadata as any).visualPlan.beats as { beat: string; visual: string }[];
  assert.equal(planned.find((b) => b.beat === 'problem-1')!.visual, 'heatmap');
  assert.equal(requests.filter((r) => r.name === 'opening_visual').length, 1);
  assert.equal(requests.filter((r) => r.name === 'visual_plan').length, 1);
  const order = events.map((e) => e.type);
  assert.ok(order.indexOf('tour.partial') < order.indexOf('visual.plan'));
  const choice = events.find((e) => e.type === 'visual.opening')!;
  assert.equal(choice.data.source, 'model');
  assert.equal(choice.data.visual, 'heatmap');
});

test('the tour’s limits count the opening step’s kind: a later step with the same kind is left to the page', async () => {
  const { fetch } = model({
    opening: (r) => planFor(r, (id) => (id === 'problem-1' ? 'heatmap' : 'none')),
    plan: (r) => planFor(r, (id) => (id === 'method-1' ? 'heatmap' : id === 'figure-1' ? 'scatter' : 'none')),
  });
  const events: Seen[] = [];
  const { metadata } = await run(fetch, events);
  const planned = events.find((e) => e.type === 'visual.plan')!.data;
  const byBeat = Object.fromEntries(planned.beats.map((b: { beat: string; visual: string }) => [b.beat, b.visual]));
  assert.equal(byBeat['problem-1'], 'heatmap');
  assert.equal(byBeat['method-1'], 'none');
  assert.equal(byBeat['figure-1'], 'scatter');
  assert.deepEqual(planned.adjusted, [{ beat: 'method-1', visual: 'heatmap', reason: 'at most 1 heatmap board' }]);
  assert.equal((metadata as any).visualPlan.source, 'model');
});

test('without a usable opening choice the opening step waits for the plan, which then plans every step', async () => {
  const { requests, fetch } = model({ opening: () => ({ plan: 'p', beats: [] }) });
  const events: Seen[] = [];
  const { tour } = await run(fetch, events);
  assert.equal(requests.filter((r) => r.name === 'opening_visual').length, 2, 'one repair');
  const plan = requests.find((r) => r.name === 'visual_plan')!;
  assert.deepEqual(plan.schema.properties.beats.items.properties.beat.enum, ids);
  assert.doesNotMatch(plan.task, /already planned/);
  const order = events.map((e) => e.type);
  assert.ok(order.indexOf('visual.plan') < order.indexOf('beat.started'), 'the first step started after the plan');
  assert.equal(events.find((e) => e.type === 'visual.opening')!.data.source, 'fallback');
  assert.equal(steps(tour).length, ids.length);
});

test('a refused opening call costs nothing: the tour is planned as a whole, a slow one is not waited for twice', async () => {
  const refused = model({ opening: () => reply({}, 401) });
  const { tour } = await run(refused.fetch);
  assert.equal(steps(tour).length, ids.length);
  assert.equal(refused.requests.filter((r) => r.name === 'visual_plan').length, 1);

  const slow = (name: string, effort: string) => (name === 'opening_visual' ? 60 : PACE.callMs(name, effort as never));
  const hangs: typeof fetch = (async (url: unknown, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format.json_schema.name;
    if (name !== 'opening_visual') return refused.fetch(url as never, init);
    return new Promise<Response>((_, reject) =>
      init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
    );
  }) as typeof fetch;
  const events: Seen[] = [];
  const { tour: again } = await run(hangs, events, { ...PACE, callMs: slow });
  assert.equal(steps(again).length, ids.length);
  const failed = events.filter((e) => e.type === 'model.failed');
  assert.equal(failed.length, 1, 'the slow call is given up once');
});

// ------------------------------------------------------------------------------------- slow calls and slow steps

/** A bars board whose number the evidence does not print, which the checks always reject. */
const invented = {
  title: 'Water used',
  unit: 'percent',
  higher_is_better: false,
  bars: [
    { label: 'Fixed schedule', value: 77.7 },
    { label: 'Probe network', value: 54.3 },
  ],
};
const plannedBars = (r: Request) => planFor(r, (id) => (id === 'result-1' ? 'bars' : 'none'));
const isResult = (r: Request) => r.name === 'beat_direction' && r.task.includes('STEP KIND: result');

test('a step whose board keeps failing is repaired twice, and at once when it has used its time', async () => {
  const wrong = (r: Request) => (isResult(r) ? direct(r, EXPLAIN, { bars: invented }) : undefined);
  const patient = model({ plan: plannedBars, opening: plannedBars, direction: wrong });
  const events: Seen[] = [];
  const { tour } = await run(patient.fetch, events);
  assert.equal(patient.requests.filter(isResult).length, 3);

  const hurried = model({ plan: plannedBars, opening: plannedBars, direction: wrong });
  const quick: Seen[] = [];
  const { tour: short, metadata } = await run(hurried.fetch, quick, { ...PACE, stepMs: 0 });
  assert.equal(hurried.requests.filter(isResult).length, 1, 'no repair once the time is used');
  // Both tours play and say the same; the step lost its board either way and says so.
  const board = (t: Tour) =>
    steps(t)
      .find((s) => s.id === 'result-1')!
      .actions.some((a) => a.type === 'board');
  assert.equal(board(tour), false);
  assert.equal(board(short), false);
  assert.deepEqual((metadata as any).degraded.find((d: any) => d.beat === 'result-1').dropped, ['board']);
  assert.equal(quick.filter((e) => e.type === 'beat.degraded' && e.data.beat === 'result-1').length, 1);
});

test('a repair after a first try that gave nothing usable is held to the step’s time like any other repair', async () => {
  const { requests, fetch } = model({});
  let asked = 0;
  let waited = 0;
  const hangs: typeof globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (
      body.response_format.json_schema.name !== 'beat_direction' ||
      !JSON.stringify(body.messages).includes('STEP KIND: result')
    )
      return fetch(url as never, init);
    // The first try says too little to use; the repair that follows it hangs until it is given up on.
    if (!asked++) return reply({ plan: 'p', say: 'too short', cues: [] });
    if (asked > 2) return fetch(url as never, init);
    const since = Date.now();
    return new Promise<Response>((_, reject) =>
      init!.signal!.addEventListener('abort', () => {
        waited = Date.now() - since;
        reject(new Error('aborted'));
      }),
    );
  }) as typeof globalThis.fetch;
  const slow = (name: string, effort: string) =>
    name === 'beat_direction' ? 2000 : PACE.callMs(name, effort as never);
  const events: Seen[] = [];
  const { tour } = await run(hangs, events, { ...PACE, callMs: slow, stepMs: 0, repairMs: 60 });
  assert.ok(
    waited >= 50 && waited < 1000,
    `the repair was given up on after the least time a repair gets, not ${waited} ms`,
  );
  assert.equal(asked, 3, 'a try, the repair that hung, and another');
  assert.equal(requests.filter(isResult).length, 1, 'only the last try reached the model');
  assert.ok(
    steps(tour).some((s) => s.id === 'result-1'),
    'the step was written by the next try',
  );
  assert.equal(steps(tour).length, ids.length);
  assert.equal(events.filter((e) => e.type === 'model.failed').length, 1);
});

test('a call that outlives its time is tried again lean: lightly reasoned and without the board it was planned to draw', async () => {
  let first = true;
  const slow = (name: string, effort: string) => (name === 'beat_direction' ? 400 : PACE.callMs(name, effort as never));
  const { requests, fetch } = model({ plan: plannedBars, opening: plannedBars });
  const hangs: typeof globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const task = JSON.stringify(body.messages);
    if (body.response_format.json_schema.name === 'beat_direction' && task.includes('STEP KIND: result') && first) {
      first = false;
      return new Promise<Response>((_, reject) =>
        init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    }
    return fetch(url as never, init);
  }) as typeof globalThis.fetch;
  const events: Seen[] = [];
  const started = Date.now();
  const { tour, metadata } = await run(hangs, events, { ...PACE, callMs: slow });
  assert.ok(Date.now() - started < 4000, 'no pause after a call that was too slow');
  const asked = requests.filter(isResult);
  assert.equal(asked.length, 1, 'the call that hung never reached the model; the retry did');
  assert.match(asked[0].task, /VISUAL FOR THIS STEP: none\./);
  const lean = events.find((e) => e.type === 'beat.lean')!;
  assert.deepEqual([lean.data.beat, lean.data.visual], ['result-1', 'bars']);
  const result = steps(tour).find((s) => s.id === 'result-1')!;
  assert.ok(!result.actions.some((a) => a.type === 'board'));
  const flagged = (metadata as any).degraded.find((d: any) => d.beat === 'result-1');
  assert.deepEqual(flagged.dropped, ['board']);
  assert.match(flagged.problems.join(' '), /bars took too long to write/);
  assert.equal(steps(tour).length, ids.length);
});

test('a call that outlives its time fails with a fault of the model, not of the caller', async () => {
  const quiet = new AbortController();
  await assert.rejects(
    limited(
      quiet.signal,
      20,
      (within) => new Promise((_, reject) => within.addEventListener('abort', () => reject(new Error('aborted')))),
    ),
    (error) => error instanceof ProcessingError && error.code === 'muse_slow' && !error.transient,
  );
  // Cancelling the generation is not slow, and a fast call is untouched.
  const stop = new AbortController();
  const waiting = limited(
    stop.signal,
    5000,
    (within) => new Promise((_, reject) => within.addEventListener('abort', () => reject(new Error('cancelled')))),
  );
  stop.abort();
  await assert.rejects(waiting, /cancelled/);
  assert.equal(await limited(quiet.signal, 20, async () => 'done'), 'done');
});

test('a card that is too slow is asked for again at once, and the tour still plays', async () => {
  const { fetch } = model({});
  let hung = 0;
  const hangs: typeof globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const name = JSON.parse(String(init?.body)).response_format.json_schema.name;
    if (name === 'paper_card' && !hung++)
      return new Promise<Response>((_, reject) =>
        init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))),
      );
    return fetch(url as never, init);
  }) as typeof globalThis.fetch;
  const events: Seen[] = [];
  const started = Date.now();
  const { tour, metadata } = await run(hangs, events, {
    ...PACE,
    callMs: (name, effort) => (name === 'paper_card' ? 150 : PACE.callMs(name, effort)),
  });
  assert.ok(Date.now() - started < 1400, 'a slow call is not followed by the pause a provider error gets');
  assert.equal((metadata as any).cardSource, 'model');
  assert.equal(steps(tour).length, ids.length);
  assert.equal(events.filter((e) => e.type === 'model.failed').length, 1);
});

test('the first try of the card and the opening reasons as little as the API allows, the plan and its repair reason at medium', async () => {
  const bad = model({ plan: () => ({ plan: 'p', beats: [entry('ghost', 'bars', 'x')] }) });
  const events: Seen[] = [];
  await run(bad.fetch, events);
  const efforts = (name: string) =>
    events.filter((e) => e.type === 'model.started' && e.data.name === name).map((e) => e.data.reasoningEffort);
  assert.deepEqual(efforts('paper_card'), ['minimal']);
  assert.deepEqual(efforts('opening_visual'), ['minimal']);
  assert.deepEqual(efforts('visual_plan'), ['medium', 'medium'], 'the plan and its repair both reason at medium');
});
