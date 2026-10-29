import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, BoardItem, Step } from '../../shared/paper';
import { HarnessTourGenerator } from './harness-fixture';
import { EXPLAIN, card, direct, doc, input, planFor, provider, reply, settings, type Request } from './plan-fixture';
import { boardSignature, dropRepeatedBoards } from '../src/harness/assemble';
import { planBeats, type Beat } from '../src/harness/beats';
import { BOARD_KINDS } from '../src/harness/board';
import {
  beatBrief,
  beatTargets,
  cleanDirection,
  directOptions,
  directionSchema,
  exampleRules,
} from '../src/harness/direct';
import {
  BOARD_SHARE,
  cleanVisualPlan,
  plannableBeats,
  visualLine,
  visualPlanBrief,
  visualPlanSchema,
  visualPlanTask,
  type StepVisual,
} from '../src/harness/visual-plan';

const beats = planBeats(card, doc, 'standard');
const ids = beats.map((beat) => beat.id);
const beat = (id: string): Beat => beats.find((b) => b.id === id)!;
const entry = (id: string, visual: string, idea = 'Show how the parts relate.', data = '') => ({
  beat: id,
  visual,
  idea,
  data,
});
const steps = (tour: { chapters: { steps: Step[] }[] }) => tour.chapters.flatMap((c) => c.steps);
/** The generation metadata these tests read. */
type Meta = {
  visualPlan: { source: string };
  boards: { shown: string[]; dropped: { beat: string; problems: string[] }[] };
};
const meta = (metadata: unknown) => metadata as Meta;

test('the standard plan of the fixture has the beats the tests rely on', () => {
  assert.deepEqual(ids, [
    'problem-1',
    'idea-1',
    'method-1',
    'formula-1',
    'figure-1',
    'result-1',
    'limitation-1',
    'takeaway-1',
  ]);
});

test('the plan schema lists every step and every board kind; the task names the kinds and the rules', () => {
  const schema: any = visualPlanSchema(beats);
  const item = schema.properties.beats.items;
  assert.deepEqual(item.properties.beat.enum, ids);
  assert.deepEqual(item.properties.visual.enum, ['none', ...BOARD_KINDS]);
  assert.deepEqual(item.required, ['beat', 'visual', 'idea', 'data']);
  assert.equal(schema.properties.beats.maxItems, ids.length);
  const task = visualPlanTask('en-US');
  for (const kind of BOARD_KINDS) assert.match(task, new RegExp(`- ${kind}: `), kind);
  assert.match(task, /Fewer, stronger visuals beat many weak ones/);
  assert.match(task, /Never two visuals of the same data or idea/);
  assert.match(task, /each kind once \(formula and plot at most twice\)/);
});

test('the plan brief gives the card and, per step, its point, evidence sentences, figure and equation', () => {
  const brief = visualPlanBrief(card, beats, doc);
  assert.match(brief, /^DOCUMENT CARD \(type research_paper\):/);
  assert.match(brief, /key idea: Probes tell each valve when the soil is dry\./);
  assert.match(brief, /\[method-1\] method step\n {2}the point: A controller opens a valve/);
  assert.match(brief, /\[p1\.s3\] Each probe reports a reading every ten minutes/);
  assert.match(brief, /on figure 1, page 1: The layout of probes and valves/);
  assert.match(brief, /on equation \(1\), page 2: s = 1 - u \/ b/);
  assert.match(brief, /\[result-1\] result step\n {2}the point: The network used 31\.4 percent less water\./);
  assert.doesNotMatch(brief, /STEP KIND|POINT TO MAKE/);
});

test('a plan keeps known steps and kinds, one entry per step, and gives the steps it does not name none', () => {
  const { plan, problems } = cleanVisualPlan(
    {
      beats: [
        entry('method-1', 'flow', 'Show how a reading travels to a valve.', 'probe, controller, valve'),
        entry('method-1', 'bars', 'A second entry for the same step is ignored.'),
        entry('ghost-9', 'plot'),
        entry('result-1', 'diagram'),
        entry('idea-1', 'scatter', ''),
        entry('formula-1', 'plot', 'Show how the saving responds to the baseline.'),
      ],
    },
    beats,
  );
  assert.ok(plan);
  assert.deepEqual([...plan.keys()], ids);
  assert.equal(plan.get('method-1')!.visual, 'flow');
  assert.equal(plan.get('method-1')!.data, 'probe, controller, valve');
  assert.equal(plan.get('formula-1')!.visual, 'plot');
  // Unknown step, unknown kind and a visual without an idea: dropped, so those steps have none.
  for (const id of ['result-1', 'idea-1', 'problem-1']) assert.equal(plan.get(id)!.visual, 'none', id);
  assert.equal(problems.length, 3);
  assert.match(problems.join(' '), /ghost-9.*not a listed step/);
  assert.match(problems.join(' '), /result-1: visual must be none or one of/);
  assert.match(problems.join(' '), /idea-1: a scatter needs an idea/);
});

test('idea and data are cut to their word limits, and none carries neither', () => {
  const long = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const { plan } = cleanVisualPlan(
    { beats: [entry('method-1', 'flow', long(60), long(50)), entry('idea-1', 'none', 'ignored', 'ignored')] },
    beats,
  );
  assert.equal(plan!.get('method-1')!.idea.split(' ').length, 40);
  assert.equal(plan!.get('method-1')!.data.split(' ').length, 30);
  assert.deepEqual(plan!.get('idea-1'), { visual: 'none', idea: '', data: '' });
});

test('a kind appears once (a formula or a plot twice), and the earliest steps keep their visual', () => {
  const eight = beats.map((b) => b.id);
  const wanted = (kind: string) => ({ beats: eight.map((id) => entry(id, kind)) });
  const heat = cleanVisualPlan(wanted('heatmap'), beats);
  assert.deepEqual(
    [...heat.plan!].filter(([, v]) => v.visual === 'heatmap').map(([id]) => id),
    ['problem-1'],
  );
  assert.equal(heat.adjusted.length, 7);
  assert.match(heat.adjusted[0].reason, /at most 1 heatmap board$/);
  const formulas = cleanVisualPlan(wanted('formula'), beats);
  assert.deepEqual(
    [...formulas.plan!].filter(([, v]) => v.visual === 'formula').map(([id]) => id),
    ['problem-1', 'idea-1'],
  );
});

test('at most about 60 percent of the steps get a board; extras become none, keeping the earliest in tour order', () => {
  const kinds = ['heatmap', 'scatter', 'shapes', 'plot', 'formula', 'bars', 'flow', 'scene'];
  const { plan, adjusted } = cleanVisualPlan({ beats: ids.map((id, i) => entry(id, kinds[i])) }, beats);
  const boards = [...plan!].filter(([, v]) => v.visual !== 'none').map(([id]) => id);
  assert.equal(boards.length, Math.floor(beats.length * BOARD_SHARE));
  assert.deepEqual(boards, ids.slice(0, boards.length));
  assert.deepEqual(
    adjusted.map((a) => a.beat),
    ids.slice(boards.length),
  );
  assert.match(adjusted[0].reason, /60% of the steps/);
  // A tiny tour still gets one board.
  const one = cleanVisualPlan({ beats: [entry('problem-1', 'plot')] }, beats.slice(0, 1));
  assert.equal(one.plan!.get('problem-1')!.visual, 'plot');
});

test('a plan without a usable entry is null, with the reasons for one repair', () => {
  for (const value of [null, {}, { beats: [] }, { beats: [entry('ghost', 'plot'), entry('idea-1', 'rocket')] }]) {
    const { plan, problems } = cleanVisualPlan(value, beats);
    assert.equal(plan, null);
    assert.ok(problems.length);
  }
  // Exercise parts are taught from their own solutions, so the plan never covers them.
  const withUnit = [...beats, { ...beat('problem-1'), id: 'exercise-1', unit: {} as never }];
  assert.deepEqual(
    plannableBeats(withUnit).map((b) => b.id),
    ids,
  );
});

test('the brief line names the planned kind, idea and data, or says to teach on the page', () => {
  const visual: StepVisual = {
    visual: 'heatmap',
    idea: 'Each probe row shows which valves it feeds.',
    data: 'Illustrative.',
  };
  assert.equal(
    visualLine(visual),
    'VISUAL FOR THIS STEP: heatmap: Each probe row shows which valves it feeds. Data: Illustrative.',
  );
  assert.equal(
    visualLine({ visual: 'flow', idea: 'Show the loop', data: '' }),
    'VISUAL FOR THIS STEP: flow: Show the loop.',
  );
  assert.equal(
    visualLine({ visual: 'none', idea: '', data: '' }),
    'VISUAL FOR THIS STEP: none. Teach on the page with highlights and marks; no side board.',
  );
});

test('a planned step offers only its own board, and a step planned without one offers none', () => {
  const method = beat('method-1');
  const flow: StepVisual = { visual: 'flow', idea: 'Show the loop.', data: '' };
  const none: StepVisual = { visual: 'none', idea: '', data: '' };
  const heat: StepVisual = { visual: 'heatmap', idea: 'Show who feeds whom.', data: '' };
  const keys = (visual?: StepVisual) =>
    Object.keys(directionSchema(method, beatTargets(method, doc, visual), true, visual).properties);
  assert.deepEqual(keys(flow), ['plan', 'flow', 'example', 'say', 'cues']);
  assert.deepEqual(keys(heat), ['plan', 'heatmap', 'say', 'cues']);
  assert.deepEqual(keys(none), ['plan', 'say', 'cues']);
  assert.deepEqual(keys(), ['plan', ...BOARD_KINDS, 'example', 'say', 'cues']);
  const cue = (visual: StepVisual) =>
    (directionSchema(method, beatTargets(method, doc, visual), true, visual).properties as any).cues.items.properties;
  assert.deepEqual(cue(none).action.enum, ['highlight', 'note']);
  assert.deepEqual(cue(flow).action.enum, ['highlight', 'note', 'board_focus']);
  assert.ok(cue(flow).target.enum.includes('node-1'));
  assert.ok(!cue(flow).target.enum.includes('row-1'));
  assert.ok(cue(heat).target.enum.includes('row-1'));
  assert.ok(!cue(none).target.enum.some((id: string) => /^(node|row|bar|term)-/.test(id)));
  // The suggestion of the kind is replaced by the plan.
  assert.equal(directOptions(method, 'research_paper', undefined, heat).board, 'heatmap');
  assert.equal(directOptions(method, 'research_paper', undefined, none).board, undefined);
  // A method step suggests no board of its own: a chain of stages is a list.
  assert.equal(directOptions(method, 'research_paper').board, undefined);
  assert.equal(directOptions(beat('result-1'), 'research_paper').board, 'bars');
});

test('the brief of a planned step carries its visual line', () => {
  const method = beat('method-1');
  const visual: StepVisual = { visual: 'scatter', idea: 'Water saved against pumping cost.', data: 'Two points.' };
  const brief = beatBrief(method, doc, beatTargets(method, doc, visual), visual);
  assert.match(
    brief,
    /POINT TO MAKE: A controller opens a valve[^\n]*\nVISUAL FOR THIS STEP: scatter: Water saved against pumping cost\. Data: Two points\./,
  );
  assert.doesNotMatch(beatBrief(method, doc, beatTargets(method, doc)), /VISUAL FOR THIS STEP/);
  const none = { visual: 'none' as const, idea: '', data: '' };
  assert.match(
    beatBrief(method, doc, beatTargets(method, doc, none), none),
    /VISUAL FOR THIS STEP: none\. Teach on the page/,
  );
  // A formula detail must show its worked example even when the plan names no board.
  const detail = { ...beat('formula-1'), detail: true };
  assert.match(
    beatBrief(detail, doc, beatTargets(detail, doc, none), none),
    /none beyond the numerical worked example/,
  );
});

test('a worked example is not forced on a step planned as heatmap, scatter, shapes or plot', () => {
  const detail = { ...beat('formula-1'), detail: true };
  const say =
    'For example, with a baseline of 40 liters and 30 used, the saving is one quarter, which shows how the ratio behaves for small changes.';
  const visual = (kind: StepVisual['visual']): StepVisual => ({ visual: kind, idea: 'Show it.', data: '' });
  const ask = (kind?: StepVisual['visual']) => {
    const v = kind ? visual(kind) : undefined;
    return cleanDirection({ plan: 'p', say, cues: [] }, detail, beatTargets(detail, doc, v), false, v);
  };
  assert.ok(ask()!.exampleProblems!.length, 'without a plan the formula detail still needs its example');
  assert.ok(ask('formula')!.exampleProblems!.length);
  assert.ok(ask('none')!.exampleProblems!.length, 'a formula detail without a board must still show its example');
  for (const kind of ['heatmap', 'scatter', 'shapes', 'plot'] as const) {
    assert.deepEqual(ask(kind)!.exampleProblems, [], kind);
    assert.deepEqual(exampleRules(detail, visual(kind)), { offered: false, required: false });
  }
  // A text step that only talks about "for example" is not forced either once it is planned without a board.
  const text = beat('method-1');
  const claim = { plan: 'p', say, cues: [] };
  const targets = beatTargets(text, doc, visual('none'));
  assert.deepEqual(cleanDirection(claim, text, targets, false, visual('none'))!.exampleProblems, []);
  assert.ok(cleanDirection(claim, text, beatTargets(text, doc), false)!.exampleProblems!.length);
});

test('a planned step keeps only its planned board, and a step planned without one draws none', () => {
  const method = beat('method-1');
  const flow = {
    title: 'A reading reaches a valve',
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
  const bars = {
    bars: [
      { label: 'Water saved', value: 31.4 },
      { label: 'Cost cut', value: 18.2 },
    ],
  };
  const answer = { plan: 'p', say: EXPLAIN, cues: [], flow, bars };
  const planned: StepVisual = { visual: 'flow', idea: 'Show the loop.', data: '' };
  const none: StepVisual = { visual: 'none', idea: '', data: '' };
  const kept = cleanDirection(answer, method, beatTargets(method, doc, planned), false, planned)!;
  assert.equal(kept.board?.kind, 'flow');
  assert.deepEqual(kept.boardProblems, []);
  const dropped = cleanDirection(answer, method, beatTargets(method, doc, none), false, none)!;
  assert.equal(dropped.board, undefined);
  assert.deepEqual(dropped.boardProblems, []);
});

test('a numeric board may copy numbers from the sentences its plan names, not only from its own evidence', () => {
  const method = beat('method-1');
  const bars: StepVisual = { visual: 'bars', idea: 'Water against cost.', data: 'Saved 31.4 percent; cost cut 18.2.' };
  const targets = beatTargets(method, doc, bars);
  assert.deepEqual(targets.visualEvidence, ['p2.s1', 'p2.s2']);
  assert.match(targets.evidence!, /31\.4 percent less water/);
  assert.match(targets.evidence!, /pumping cost fell by 18\.2 percent/);
  assert.match(
    beatBrief(method, doc, targets, bars),
    /SENTENCES WITH THE NUMBERS OF THE PLANNED VISUAL[^\n]*\n\[p2\.s1\]/,
  );
  // Other kinds and small whole numbers add nothing.
  assert.equal(beatTargets(method, doc, { ...bars, visual: 'flow' }).visualEvidence, undefined);
  assert.equal(beatTargets(method, doc, { ...bars, data: 'Seven of nine.' }).visualEvidence, undefined);
  assert.doesNotMatch(beatTargets(method, doc).evidence!, /31\.4/);
});

/** A model that plans `plan` and directs every beat with EXPLAIN, with `extra` boards by beat. */
function model(
  plan: Record<string, string | { visual: string; idea: string; data?: string }>,
  boards: Record<string, object> = {},
) {
  return (request: Request) => {
    if (request.name === 'paper_card') return card;
    if (request.name === 'visual_plan') return planFor(request, (id) => plan[id] ?? 'none');
    const id = /STEP KIND: (\w+)/.exec(request.task)?.[1] ?? '';
    return direct(request, EXPLAIN, boards[id] ?? {});
  };
}
/** A flow with a loop: the valve's effect is read again by the probe. A chain of the same boxes would be rejected. */
const flowBoard = {
  flow: {
    title: 'A reading reaches a valve',
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
  },
};

test('a plan is used: each step gets its brief line and only its planned board', async () => {
  const requests: Request[] = [];
  const events: { type: string; data: Record<string, any> }[] = [];
  const barsBoard = {
    bars: {
      title: 'Savings',
      unit: '%',
      bars: [
        { label: 'Water saved', value: 31.4 },
        { label: 'Cost cut', value: 18.2 },
      ],
    },
  };
  const plan = {
    'method-1': { visual: 'flow', idea: 'Show how a reading travels to a valve.', data: 'Probe, controller, valve.' },
    'result-1': {
      visual: 'bars',
      idea: 'Compare what the network saved.',
      data: 'Water 31.4 percent, cost 18.2 percent.',
    },
  };
  const generator = new HarnessTourGenerator(
    settings,
    'standard',
    provider((r) => (requests.push(r), model(plan, { method: flowBoard, result: barsBoard })(r))),
  );
  const { tour, metadata } = await generator.generate({
    ...input,
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  const planCalls = requests.filter((r) => r.name === 'visual_plan');
  assert.equal(planCalls.length, 1);
  assert.deepEqual(planCalls[0].schema.properties.beats.items.properties.beat.enum, ids);
  const last = planCalls[0].messages.at(-1)!;
  assert.match(last, /design the side-board visuals/);
  assert.match(last, /\[p1\.s1\] Orchard growers water on a fixed schedule/);
  const brief = (id: string) =>
    requests.find((r) => r.name === 'beat_direction' && r.task.includes(`STEP KIND: ${id}`))!;
  const method = brief('method');
  assert.match(
    method.task,
    /VISUAL FOR THIS STEP: flow: Show how a reading travels to a valve\. Data: Probe, controller, valve\./,
  );
  assert.deepEqual(Object.keys(method.schema.properties), ['plan', 'flow', 'example', 'say', 'cues']);
  const problem = brief('problem');
  assert.match(
    problem.task,
    /VISUAL FOR THIS STEP: none\. Teach on the page with highlights and marks; no side board\./,
  );
  assert.deepEqual(Object.keys(problem.schema.properties), ['plan', 'say', 'cues']);
  const kinds = (id: string) =>
    steps(tour)
      .find((s) => s.id === id)!
      .actions.flatMap((a) => (a.type === 'board' ? [a.item.kind] : []));
  assert.deepEqual(kinds('method-1'), ['flow']);
  assert.deepEqual(kinds('result-1'), ['bars']);
  assert.deepEqual(kinds('problem-1'), []);
  assert.deepEqual(meta(metadata).boards.shown, ['method-1:flow', 'result-1:bars']);
  assert.equal(meta(metadata).visualPlan.source, 'model');
  const event = events.find((e) => e.type === 'visual.plan')!;
  assert.equal(event.data.source, 'model');
  assert.deepEqual(
    event.data.beats.map((b: { beat: string; visual: string }) => `${b.beat}:${b.visual}`),
    ids.map((id) => `${id}:${id === 'method-1' ? 'flow' : id === 'result-1' ? 'bars' : 'none'}`),
  );
  assert.ok(events.findIndex((e) => e.type === 'visual.plan') < events.findIndex((e) => e.type === 'beat.started'));
});

test('a plan that asks for more than the variety limits allow is cut back before the steps are directed', async () => {
  const events: { type: string; data: Record<string, any> }[] = [];
  const requests: Request[] = [];
  const generator = new HarnessTourGenerator(
    settings,
    'standard',
    provider((r) => (requests.push(r), model(Object.fromEntries(ids.map((id) => [id, 'heatmap'])))(r))),
  );
  await generator.generate({
    ...input,
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  const event = events.find((e) => e.type === 'visual.plan')!;
  const kept = event.data.beats.filter((b: { visual: string }) => b.visual === 'heatmap');
  assert.deepEqual(
    kept.map((b: { beat: string }) => b.beat),
    ['problem-1'],
  );
  assert.equal(event.data.adjusted.length, 7);
  const lines = requests
    .filter((r) => r.name === 'beat_direction')
    .map((r) => /VISUAL FOR THIS STEP: (\w+)/.exec(r.task)![1]);
  assert.equal(lines.filter((kind) => kind === 'heatmap').length, 1);
  assert.equal(lines.filter((kind) => kind === 'none').length, 7);
});

test('an invalid plan is repaired once and then falls back to the boards the steps suggest', async () => {
  const requests: Request[] = [];
  const events: { type: string; data: Record<string, any> }[] = [];
  const generator = new HarnessTourGenerator(
    settings,
    'standard',
    provider(
      (r) => (
        requests.push(r),
        r.name === 'visual_plan' ? { plan: 'p', beats: [entry('ghost-1', 'bars', 'Nothing.')] } : model({})(r)
      ),
    ),
  );
  const { tour, metadata } = await generator.generate({
    ...input,
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  const planCalls = requests.filter((r) => r.name === 'visual_plan');
  assert.equal(planCalls.length, 2);
  assert.match(planCalls[1].task, /ghost-1" is not a listed step/);
  assert.ok(events.some((e) => e.type === 'validation.failed' && e.data.stage === 'visuals'));
  const directions = requests.filter((r) => r.name === 'beat_direction');
  assert.ok(directions.every((r) => !r.task.includes('VISUAL FOR THIS STEP:')));
  assert.ok(directions.every((r) => 'formula' in r.schema.properties && 'bars' in r.schema.properties));
  assert.equal(steps(tour).length, ids.length);
  assert.equal(meta(metadata).visualPlan.source, 'fallback');
  const event = events.find((e) => e.type === 'visual.plan')!;
  assert.equal(event.data.source, 'fallback');
  assert.deepEqual(
    event.data.beats.find((b: { beat: string }) => b.beat === 'result-1'),
    { beat: 'result-1', suggested: 'bars' },
  );
});

test('a plan call that fails twice also falls back, and the tour still plays', async () => {
  const truncated = () =>
    new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'length', message: { content: '{"plan":' } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  let planCalls = 0;
  const generator = new HarnessTourGenerator(
    settings,
    'standard',
    provider((r) => {
      if (r.name !== 'visual_plan') return model({})(r);
      planCalls++;
      return truncated();
    }),
  );
  const { tour, metadata } = await generator.generate(input);
  assert.equal(planCalls, 2);
  assert.equal(steps(tour).length, ids.length);
  assert.equal(meta(metadata).visualPlan.source, 'fallback');
});

test('a rejected key still fails the tour at the plan call, before any step is directed', async () => {
  const names: string[] = [];
  const generator = new HarnessTourGenerator(
    settings,
    'standard',
    provider((r) => (names.push(r.name), r.name === 'paper_card' ? card : reply({}, 401))),
  );
  await assert.rejects(generator.generate(input), (e: { code?: string }) => e.code === 'muse_auth_failed');
  assert.deepEqual(names, ['paper_card', 'visual_plan']);
});

const move = (id: string, ...actions: Action[]): Step => ({ id, say: 'one two three four five six', actions });
const bars = (...values: number[]): BoardItem => ({
  kind: 'bars',
  bars: values.map((value, i) => ({ label: `bar ${i}`, value })),
});
const formula = (latex: string): BoardItem => ({ kind: 'formula', latex, terms: [{ latex: 'x', label: 'x' }] });

test('boards compare by kind and data: bars by their values in any order, formulas by latex, points by label and place', () => {
  assert.equal(boardSignature(bars(3, 1, 2)), boardSignature(bars(1, 2, 3)));
  assert.notEqual(boardSignature(bars(1, 2, 3)), boardSignature(bars(1, 2, 4)));
  assert.equal(boardSignature(formula('x ^ 2')), boardSignature(formula('x^2')));
  const scatter = (...points: [string, number, number][]): BoardItem => ({
    kind: 'scatter',
    x_label: 'cost',
    y_label: 'quality',
    source: 'illustrative',
    points: points.map(([label, x, y]) => ({ label, x, y })),
  });
  assert.equal(boardSignature(scatter(['a', 1, 2], ['b', 3, 4])), boardSignature(scatter(['b', 3, 4], ['a', 1, 2])));
  assert.notEqual(boardSignature(scatter(['a', 1, 2], ['b', 3, 4])), boardSignature(scatter(['a', 1, 2], ['b', 3, 5])));
  const heatmap = (values: number[][]): BoardItem => ({
    kind: 'heatmap',
    rows: ['a', 'b'],
    cols: ['x', 'y'],
    values,
    source: 'illustrative',
  });
  assert.equal(
    boardSignature(
      heatmap([
        [1, 2],
        [3, 4],
      ]),
    ),
    boardSignature(
      heatmap([
        [1, 2],
        [3, 4],
      ]),
    ),
  );
  assert.notEqual(
    boardSignature(
      heatmap([
        [1, 2],
        [3, 4],
      ]),
    ),
    boardSignature(
      heatmap([
        [1, 2],
        [4, 3],
      ]),
    ),
  );
  assert.notEqual(boardSignature(bars(1, 2)), boardSignature(formula('1 2')));
  assert.equal(boardSignature({ kind: 'scene', objects: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 1, h: 1 }] }), null);
});

test('a board that repeats an earlier step is dropped with its focus cues; the narration and the other cues stay', () => {
  const plain = (id: string) =>
    move(id, { type: 'focus', target: 'p1.s1' }, { type: 'highlight', targets: ['p1.s1'], color: 'yellow' });
  const first = move(
    'a',
    { type: 'focus', target: 'p1.s1' },
    { type: 'board', item: bars(3, 1, 2) },
    { type: 'board_focus', part: 0, at_word: 1 },
  );
  const again = move(
    'b',
    { type: 'focus', target: 'p1.s2' },
    { type: 'board', item: bars(1, 2, 3) },
    { type: 'board_focus', part: 1, at_word: 2 },
    { type: 'highlight', targets: ['p1.s2'], color: 'yellow', at_word: 1 },
  );
  const other = move(
    'c',
    { type: 'focus', target: 'p1.s3' },
    { type: 'board', item: bars(1, 2, 4) },
    { type: 'board_focus', part: 2, at_word: 2 },
  );
  const { steps: kept, dropped } = dropRepeatedBoards([[first], [plain('p')], [again], [other]]);
  assert.deepEqual(dropped, [{ step: 'b', kind: 'bars', repeats: 'a' }]);
  assert.equal(kept[0][0], first);
  assert.deepEqual(kept[2][0].actions, [
    { type: 'focus', target: 'p1.s2' },
    { type: 'highlight', targets: ['p1.s2'], color: 'yellow', at_word: 1 },
  ]);
  assert.equal(kept[2][0].say, again.say);
  assert.equal(kept[3][0], other);
  // Exempt beats are neither compared nor remembered.
  assert.deepEqual(dropRepeatedBoards([[first], [again]], new Set([1])).dropped, []);
  assert.deepEqual(dropRepeatedBoards([[first], [again]], new Set([0])).dropped, []);
});

test('only earlier steps count: the steps of one beat, and the frames of one example, may repeat each other', () => {
  const same = (id: string) => move(id, { type: 'board', item: formula('y = x') });
  assert.deepEqual(dropRepeatedBoards([[same('a'), same('b')]]).dropped, []);
  // A worked example whose first frame repeats an earlier board loses that frame and its cues, not the later frames.
  const example = move(
    'e',
    { type: 'focus', target: 'p1.s1' },
    { type: 'board', item: formula('y = x') },
    { type: 'board_focus', part: 0, at_word: 1 },
    { type: 'board', item: bars(5, 6), at_word: 3 },
    { type: 'board_focus', part: 1, at_word: 4 },
  );
  const { steps: kept, dropped } = dropRepeatedBoards([[same('a')], [example]]);
  assert.deepEqual(dropped, [{ step: 'e', kind: 'formula', repeats: 'a' }]);
  assert.deepEqual(kept[1][0].actions, [
    { type: 'focus', target: 'p1.s1' },
    { type: 'board', item: bars(5, 6), at_word: 3 },
    { type: 'board_focus', part: 1, at_word: 4 },
  ]);
});

/** The same plot for two steps: formula and plot may appear twice, so only the duplicate check can drop it. */
const plotBoard = {
  plot: { kind: 'plot', x: [0, 4], y: [0, 16], x_label: 'pump hours', y_label: 'litres', curves: [{ expression: 'x^2', label: 'x^2' }] },
};

test('a duplicate board is dropped when the tour is assembled, and recorded like any dropped board', async () => {
  const events: { type: string; data: Record<string, any> }[] = [];
  const answer = (request: Request) => {
    if (request.name === 'paper_card') return card;
    if (request.name === 'visual_plan')
      return planFor(request, (id) => (id === 'method-1' || id === 'limitation-1' ? 'plot' : 'none'));
    const kind = /STEP KIND: (\w+)/.exec(request.task)![1];
    const cues = [
      { action: 'highlight', target: kind === 'method' ? 'p1.s3' : 'p2.s3', label: '', anchor: 'wet corners the same' },
      ...(kind === 'method' || kind === 'limitation'
        ? [{ action: 'board_focus', target: 'curve-1', label: '', anchor: 'pump bill' }]
        : []),
    ];
    return { plan: 'p', say: EXPLAIN, cues, ...(kind === 'method' || kind === 'limitation' ? plotBoard : {}) };
  };
  const { tour, metadata } = await new HarnessTourGenerator(settings, 'standard', provider(answer)).generate({
    ...input,
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  const find = (id: string) => steps(tour).find((s) => s.id === id)!;
  const method = find('method-1');
  assert.ok(method.actions.some((a) => a.type === 'board'));
  assert.ok(method.actions.some((a) => a.type === 'board_focus'));
  const limitation = find('limitation-1');
  assert.equal(limitation.say, EXPLAIN);
  assert.ok(!limitation.actions.some((a) => a.type === 'board' || a.type === 'board_focus'));
  assert.ok(limitation.actions.some((a) => a.type === 'highlight' && a.targets[0] === 'p2.s3'));
  assert.deepEqual(events.find((e) => e.type === 'board.duplicate')!.data.dropped, [
    { step: 'limitation-1', kind: 'plot', repeats: 'method-1' },
  ]);
  assert.deepEqual(meta(metadata).boards.shown, ['method-1:plot']);
  assert.deepEqual(meta(metadata).boards.dropped, [
    { beat: 'limitation-1', problems: ['plot: it repeats the board of step method-1'] },
  ]);
});
