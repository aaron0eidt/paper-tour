import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, BoardItem, Step, Tour } from '../../shared/paper';
import { HarnessTourGenerator } from './harness-fixture';
import { EXPLAIN, card, direct, doc, input, planFor, provider, settings, type Request } from './plan-fixture';
import { settleBoards } from '../src/harness/assemble';
import { HARNESS_VERSION, directTask } from '../src/harness/prompts';
import { planBeats, type Beat } from '../src/harness/beats';
import { checkBoard } from '../src/harness/board';
import { boardStepsOf, degradeDirection, withoutBoards } from '../src/harness/degrade';
import { beatTargets, cleanDirection, type Direction } from '../src/harness/direct';
import { visualPlanTask, type StepVisual } from '../src/harness/visual-plan';
import { groundedCheck, groundedProblems, reportsResults } from '../src/harness/visual-rules';

// The rules a tour step's board must meet (visual-rules.ts) and the ladder that keeps one bad visual from failing a tour
// (degrade.ts), with scripted models (no network).

const beats = planBeats(card, doc, 'standard');
const beat = (id: string): Beat => beats.find((b) => b.id === id)!;
const steps = (tour: { chapters: { steps: Step[] }[] }) => tour.chapters.flatMap((c) => c.steps);
const has = (problems: string[], pattern: RegExp) =>
  assert.ok(
    problems.some((p) => pattern.test(p)),
    problems.join(' | '),
  );
const heatmap = (change: Record<string, unknown> = {}) => ({
  kind: 'heatmap',
  rows: ['Water saved', 'Cost cut'],
  cols: ['Network', 'Yield gap'],
  values: [
    [31.4, 2.1],
    [18.2, 2.1],
  ],
  source: 'document',
  ...change,
});
const scatter = (change: Record<string, unknown> = {}) => ({
  kind: 'scatter',
  x_label: 'cost cut (%)',
  y_label: 'water saved (%)',
  points: [
    { label: 'fixed schedule', x: 0, y: 0 },
    { label: 'probe network', x: 18.2, y: 31.4 },
    { label: 'timer valves', x: 2.1, y: 18.2 },
  ],
  source: 'document',
  ...change,
});
const bars = (...labels: string[]) => ({
  kind: 'bars' as const,
  bars: labels.map((label, i) => ({ label, value: i + 1 })),
});
const plot = (...expressions: string[]) => ({
  kind: 'plot',
  x: [0, 4],
  y: [-5, 20],
  curves: expressions.map((expression) => ({ expression, label: expression })),
});
const node = (id: number) => ({ id: `node-${id}`, label: `Stage ${id}` });
const flow = (count: number, edges: [number, number][]): BoardItem => ({
  kind: 'flow',
  nodes: Array.from({ length: count }, (_, i) => node(i + 1)),
  edges: edges.map(([a, b]) => [`node-${a}`, `node-${b}`]),
});
/** The board as the checks leave it: through its own check first, then the step rules. */
const rules = (kind: Parameters<typeof checkBoard>[0], raw: unknown, results = false, evidence = '31.4 18.2 2.1 0') => {
  const checked = groundedCheck(checkBoard(kind, raw, evidence), results);
  return checked.problems;
};

// ------------------------------------------------------------------------------------------------------- results

test('a step reports the document’s results when it is a result step or sits on a table', () => {
  assert.equal(reportsResults(beat('result-1')), true);
  assert.equal(reportsResults({ ...beat('figure-1'), target: 'tab1' }, 'tab1'), true);
  assert.equal(reportsResults(beat('figure-1'), undefined), false, 'a figure that is not a table');
  // A text step whose numbers happen to match a table is not a step on that table.
  assert.equal(reportsResults(beat('method-1'), 'tab1'), false);
  assert.equal(reportsResults(beat('method-1')), false);
});

test('on a results step a heatmap or scatter must use the document’s own numbers', () => {
  assert.deepEqual(rules('heatmap', heatmap(), true), []);
  assert.deepEqual(rules('scatter', scatter(), true), []);
  for (const source of ['illustrative', 'formula'])
    has(
      rules(
        'heatmap',
        source === 'formula' ? heatmap({ source, values: undefined, expression: 'x*a' }) : heatmap({ source }),
        true,
      ),
      /reports the document’s results, so the grid must use its own numbers: set source to document/,
    );
  // Away from results, illustrative and formula grids explain a mechanism and are fine.
  assert.deepEqual(rules('heatmap', heatmap({ source: 'illustrative' }), false), []);
  assert.deepEqual(rules('heatmap', heatmap({ source: 'formula', values: undefined, expression: 'x*a' }), false), []);
});

test('bars always copy the document’s numbers, so results steps need nothing more from them', () => {
  const evidence = 'Water saved 31.4, cost cut 18.2.';
  const raw = {
    bars: [
      { label: 'Water saved', value: 31.4 },
      { label: 'Cost cut', value: 18.2 },
    ],
  };
  assert.deepEqual(rules('bars', raw, true, evidence), []);
  const invented = {
    bars: [
      { label: 'Water saved', value: 31.4 },
      { label: 'Cost cut', value: 20 },
    ],
  };
  has(rules('bars', invented, true, evidence), /bar 2: 20 does not appear in the evidence/);
});

test('a step’s direction drops a results board of illustrative values, with the instruction to fix it', () => {
  const result = beat('result-1');
  const visual: StepVisual = { visual: 'heatmap', idea: 'Show the grid.', data: 'Water saved 31.4, cost cut 18.2.' };
  const ask = (board: object) =>
    cleanDirection(
      { plan: 'p', say: EXPLAIN, cues: [], heatmap: board },
      result,
      beatTargets(result, doc, visual),
      false,
      visual,
    )!;
  const kept = ask(heatmap());
  assert.deepEqual(kept.boardProblems, []);
  assert.equal(kept.board?.kind, 'heatmap');
  const refused = ask(heatmap({ source: 'illustrative' }));
  assert.equal(refused.board, undefined);
  assert.equal(refused.say, EXPLAIN, 'the narration stays');
  has(refused.boardProblems!, /^heatmap: this step reports the document’s results/);
  // A step that is not about results may use the same grid as an illustration.
  const method = beat('method-1');
  const illustration = cleanDirection(
    { plan: 'p', say: EXPLAIN, cues: [], heatmap: heatmap({ source: 'illustrative' }) },
    method,
    beatTargets(method, doc, { ...visual, data: '' }),
    false,
    { ...visual, data: '' },
  )!;
  assert.deepEqual(illustration.boardProblems, []);
  assert.equal(illustration.board?.kind, 'heatmap');
});

// ------------------------------------------------------------------------------------------------------ scatter

test('a scatter shows measured quantities only: illustrative is refused on any step', () => {
  assert.deepEqual(rules('scatter', scatter(), false), []);
  for (const results of [false, true])
    has(
      rules('scatter', scatter({ source: 'illustrative' }), results),
      /a scatter shows quantities measured in the document: set source to document/,
    );
});

test('a document scatter must still print its coordinates', () => {
  has(rules('scatter', scatter(), false, '18.2 31.4'), /points: not printed in the evidence/);
});

// ----------------------------------------------------------------------------------------------------- placeholders

test('a grid, scatter or bar chart named only by numbered placeholders is refused', () => {
  const numbered = (word: string) => Array.from({ length: 4 }, (_, i) => `${word} ${i + 1}`);
  for (const labels of [
    numbered('pos'),
    numbered('item'),
    numbered('token'),
    ['x1', 'x2', 'x3'],
    ['Row 4', 'row_5', 'row-6'],
    ['point #1', 'point 2'],
  ]) {
    const rows = labels.length;
    const grid = heatmap({
      rows: labels,
      cols: ['Network', 'Yield gap'],
      values: labels.map((_, r) => [r + 1, r * 2]),
      source: 'illustrative',
    });
    assert.ok(rows > 1);
    has(rules('heatmap', grid), /all rows are numbered placeholders such as "pos 1" or "item 2"; use real items/);
  }
  const heat = (rows: string[], cols: string[], source = 'illustrative') =>
    heatmap({ rows, cols, values: rows.map((_, r) => cols.map((_, c) => r + c)), source });
  has(rules('heatmap', heat(['the', 'cat', 'sat'], numbered('pos'))), /all columns are numbered placeholders/);
  const both = rules('heatmap', heat(numbered('token'), numbered('token')));
  has(both, /all rows are/);
  has(both, /all columns are/);
  has(
    rules(
      'scatter',
      scatter({ source: 'document', points: numbered('point').map((label, i) => ({ label, x: i, y: i * 2 })) }),
      false,
      '0 1 2 3 4 6',
    ),
    /all points are numbered placeholders/,
  );
  has(groundedProblems(bars(...numbered('item')), { results: false }), /all bars are numbered placeholders/);
});

test('real items are accepted, even with numbers in their names, and so is a mix', () => {
  const heat = (rows: string[], cols: string[]) =>
    heatmap({ rows, cols, values: rows.map((_, r) => cols.map((_, c) => r + c)), source: 'illustrative' });
  assert.deepEqual(rules('heatmap', heat(['the', 'cat', 'sat'], ['the', 'cat', 'sat'])), []);
  assert.deepEqual(rules('heatmap', heat(['GPT-2', 'GPT-3', 'GPT-4'], ['Q1', 'Q2', 'Q3'])), []);
  assert.deepEqual(rules('heatmap', heat(['layer 1', 'layer 2'], ['head 1', 'head 2'])), []);
  assert.deepEqual(rules('heatmap', heat(['pos 1', 'the', 'pos 3'], ['1', '2', '3'])), [], 'one real label is enough');
  assert.deepEqual(groundedProblems(bars('ResNet-50', 'ResNet-101'), { results: false }), []);
});

test('a formula grid is labelled by its indices, which are not placeholders', () => {
  const grid = heatmap({
    source: 'formula',
    rows: ['pos 1', 'pos 2', 'pos 3'],
    cols: ['dim 1', 'dim 2', 'dim 3'],
    values: undefined,
    expression: 'sin(x*a)',
  });
  assert.deepEqual(rules('heatmap', grid), []);
});

// ----------------------------------------------------------------------------------------------------------- plots

test('a plot of straight lines is refused, with or without its parameter', () => {
  for (const board of [
    plot('2*x+1'),
    plot('x'),
    plot('x', '3*x-2', '0.5*x+4'),
    plot('(x+1)*2'),
    plot('3'),
    plot('a*x'),
    plot('x/a'),
    plot('a*x+1', '2*x'),
    { ...plot('a*x'), parameter: { from: 0.5, to: 2 } },
    { ...plot('x/a+1'), parameter: { from: 1, to: 4 } },
    // Without its parameter the exponent is 1.
    plot('x^a'),
  ])
    has(rules('plot', board), /every curve is a straight line in x, which a sentence says as well as a plot/);
});

test('a plot whose shape matters is accepted: saturation, decay, periodicity, a crossover or a sweep that bends it', () => {
  for (const board of [
    plot('sigmoid(x)*10'),
    plot('10*exp(-x)'),
    plot('5*sin(2*x)'),
    plot('x^2', '4*x'),
    plot('x', 'x^2'),
    plot('sqrt(x)*5'),
    plot('relu(x-2)*3'),
    plot('min(x*5,10)'),
    { ...plot('x^a'), parameter: { from: 0.5, to: 2 } },
    { ...plot('sigmoid(x/a)'), x: [-4, 4], y: [0, 1], parameter: { from: 0.5, to: 2 } },
    // A curve that cannot be evaluated everywhere is not a line.
    { ...plot('log(x)'), x: [-1, 3] },
  ])
    assert.deepEqual(rules('plot', board), [], JSON.stringify(board));
});

// ------------------------------------------------------------------------------------------------------------ flows

test('a simple chain of boxes is refused as a list', () => {
  const problems = groundedProblems(
    flow(4, [
      [1, 2],
      [2, 3],
      [3, 4],
    ]),
    { results: false },
  );
  has(problems, /this flow is a simple chain \(no node has more than one arrow in or out\), which a list says as well/);
  has(problems, /needs a branch, a merge or a loop/);
  // However the arrows are listed.
  has(
    groundedProblems(
      flow(3, [
        [2, 3],
        [1, 2],
      ]),
      { results: false },
    ),
    /simple chain/,
  );
});

test('a flow with a branch, a merge or a loop is accepted', () => {
  const none = { results: false };
  assert.deepEqual(
    groundedProblems(
      flow(4, [
        [1, 2],
        [1, 3],
        [3, 4],
      ]),
      none,
    ),
    [],
    'a branch',
  );
  assert.deepEqual(
    groundedProblems(
      flow(4, [
        [1, 3],
        [2, 3],
        [3, 4],
      ]),
      none,
    ),
    [],
    'a merge',
  );
  assert.deepEqual(
    groundedProblems(
      flow(4, [
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 2],
      ]),
      none,
    ),
    [],
    'a loop back',
  );
  assert.deepEqual(
    groundedProblems(
      flow(3, [
        [1, 2],
        [2, 3],
        [3, 1],
      ]),
      none,
    ),
    [],
    'a ring is a loop',
  );
  assert.deepEqual(
    groundedProblems(
      flow(4, [
        [1, 2],
        [1, 3],
        [2, 4],
        [3, 4],
      ]),
      none,
    ),
    [],
    'a branch and its merge',
  );
});

test('the flow rule is only for a step’s own board: a worked example’s frames may be a chain', () => {
  const frame = flow(3, [
    [1, 2],
    [2, 3],
  ]);
  assert.deepEqual(checkBoard('flow', frame).problems, []);
  assert.ok(checkBoard('flow', frame).item);
});

test('a step’s direction drops a chain, a straight plot and placeholder labels, keeps the narration, and tells how to fix them', () => {
  const method = beat('method-1');
  const ask = (kind: string, board: unknown) => {
    const visual: StepVisual = { visual: kind as StepVisual['visual'], idea: 'Show it.', data: '' };
    return cleanDirection(
      { plan: 'p', say: EXPLAIN, cues: [], [kind]: board },
      method,
      beatTargets(method, doc, visual),
      false,
      visual,
    )!;
  };
  const chain = ask('flow', {
    nodes: [node(1), node(2), node(3)],
    edges: [
      { from: 'node-1', to: 'node-2' },
      { from: 'node-2', to: 'node-3' },
    ],
  });
  assert.equal(chain.board, undefined);
  has(chain.boardProblems!, /^flow: this flow is a simple chain/);
  const loop = ask('flow', {
    nodes: [node(1), node(2), node(3)],
    edges: [
      { from: 'node-1', to: 'node-2' },
      { from: 'node-2', to: 'node-3' },
      { from: 'node-3', to: 'node-1' },
    ],
  });
  assert.equal(loop.board?.kind, 'flow');
  const line = ask('plot', plot('2*x+1'));
  assert.equal(line.board, undefined);
  has(line.boardProblems!, /^plot: every curve is a straight line in x/);
  assert.equal(ask('plot', plot('x^2')).board?.kind, 'plot');
  const toy = ask(
    'heatmap',
    heatmap({
      source: 'illustrative',
      rows: ['pos 1', 'pos 2'],
      cols: ['pos 1', 'pos 2'],
      values: [
        [1, 2],
        [3, 4],
      ],
    }),
  );
  assert.equal(toy.board, undefined);
  assert.equal(toy.boardProblems!.length, 2);
  for (const direction of [chain, line, toy]) assert.equal(direction.say, EXPLAIN);
});

// ------------------------------------------------------------------------------------------------------- the ladder

const direction = (change: Partial<Direction> = {}): Direction => ({
  plan: 'p',
  say: EXPLAIN,
  cues: [],
  exampleProblems: [],
  boardProblems: [],
  visualProblems: [],
  ...change,
});

test('a direction without faults comes back as it is', () => {
  const clean = direction({ board: bars('a', 'b') });
  const settled = degradeDirection(clean);
  assert.equal(settled.direction, clean);
  assert.equal(settled.degraded, undefined);
});

test('a board that failed its checks is recorded as dropped, and its problems stay with the direction', () => {
  const settled = degradeDirection(direction({ boardProblems: ['flow: this flow is a simple chain'] }));
  assert.deepEqual(settled.degraded, { dropped: ['board'], problems: ['flow: this flow is a simple chain'] });
  assert.deepEqual(settled.direction.boardProblems, ['flow: this flow is a simple chain']);
  assert.equal(settled.direction.say, EXPLAIN);
  // A failing second candidate beside a board that is shown is not a loss.
  assert.equal(
    degradeDirection(direction({ board: bars('a', 'b'), boardProblems: ['Choose one useful native board'] })).degraded,
    undefined,
  );
});

test('a worked example that failed is dropped; one that is valid beside a stray board keeps its frames', () => {
  const failed = degradeDirection(direction({ exampleProblems: ['The final example frame must show a result.'] }));
  assert.deepEqual(failed.degraded, {
    dropped: ['example'],
    problems: ['The final example frame must show a result.'],
  });
  assert.deepEqual(failed.direction.exampleProblems, []);
  const example = { assumptions: 'a', frames: [{ anchor: 'x', at: 0, item: bars('a', 'b') }] };
  const stray = degradeDirection(direction({ example, exampleProblems: ['Use example frames for the worked case.'] }));
  assert.deepEqual(stray.degraded?.dropped, ['board']);
  assert.equal(stray.direction.example, example);
});

test('pen marks that cannot be drawn are dropped, and a step can lose several things at once', () => {
  const settled = degradeDirection(
    direction({
      boardProblems: ['plot: every curve is a straight line in x'],
      exampleProblems: ['needs example frames'],
      visualProblems: ['Cue 1: fine geometry requires the actual attached figure crop.'],
    }),
  );
  assert.deepEqual(settled.degraded?.dropped, ['board', 'example', 'marks']);
  assert.equal(settled.degraded?.problems.length, 3);
  assert.deepEqual([settled.direction.exampleProblems, settled.direction.visualProblems], [[], []]);
});

/** A planned model whose answer for each step kind is `answers`, and EXPLAIN narration with the first allowed cue. */
function model(
  plan: Record<string, string>,
  answers: Record<string, (attempt: number) => object>,
  attempts: Record<string, number> = {},
) {
  return (request: Request) => {
    if (request.name === 'paper_card') return card;
    if (request.name === 'visual_plan') return planFor(request, (id) => plan[id] ?? 'none');
    const kind = /STEP KIND: (\w+)/.exec(request.task)?.[1] ?? '';
    attempts[kind] = (attempts[kind] ?? 0) + 1;
    return direct(request, EXPLAIN, answers[kind]?.(attempts[kind]) ?? {});
  };
}
const textScene = {
  scene: { objects: [{ id: 'a', type: 'text', x: 0.1, y: 0.1, w: 0.8, h: 0.2, text: 'Probes tell valves' }] },
};
type Event = { type: string; data: Record<string, any> };
const record = (events: Event[]) => async (type: string, data: Record<string, unknown>) => {
  events.push({ type, data });
};
type Degraded = { beat: string; dropped: string[]; problems: string[] };

test('a scene that never validates no longer fails the tour: it plays without the board, flagged', async () => {
  const attempts: Record<string, number> = {};
  const events: Event[] = [];
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(model({ 'method-1': 'scene' }, { method: () => textScene }, attempts)),
  ).generate({ ...input, onEvent: record(events) });
  assert.equal(attempts.method, 3, 'two corrections, then the board is given up');
  assert.equal(steps(tour).length, beats.length, 'every step is there');
  const method = steps(tour).find((s) => s.id === 'method-1')!;
  assert.equal(method.say, EXPLAIN);
  assert.ok(!method.actions.some((a) => a.type === 'board' || a.type === 'board_focus'));
  assert.ok(
    method.actions.some((a) => a.type === 'highlight'),
    'the page cues stay',
  );
  const degraded = metadata.degraded as Degraded[];
  assert.deepEqual(
    degraded.map((d) => [d.beat, ...d.dropped]),
    [['method-1', 'board']],
  );
  has(degraded[0].problems, /^scene: A scene must show/);
  const flagged = events.filter((e) => e.type === 'beat.degraded');
  assert.deepEqual(
    flagged.map((e) => [e.data.beat, ...e.data.dropped]),
    [['method-1', 'board']],
  );
  assert.ok(flagged[0].data.problems.length);
  assert.equal(events.find((e) => e.type === 'beat.completed' && e.data.beat === 'method-1')!.data.outcome, 'degraded');
  assert.ok(
    events.findIndex((e) => e.type === 'beat.degraded') <
      events.findIndex((e) => e.type === 'beat.completed' && e.data.beat === 'method-1'),
  );
  assert.deepEqual(
    (metadata.boards as { dropped: { beat: string }[] }).dropped.map((d) => d.beat),
    ['method-1'],
  );
  assert.deepEqual((metadata.boards as { shown: string[] }).shown, []);
});

test('a board repaired on a later attempt is not flagged', async () => {
  const attempts: Record<string, number> = {};
  const loop = {
    flow: {
      nodes: [node(1), node(2), node(3)],
      edges: [
        { from: 'node-1', to: 'node-2' },
        { from: 'node-2', to: 'node-3' },
        { from: 'node-3', to: 'node-1' },
      ],
    },
  };
  const chain = { flow: { ...loop.flow, edges: loop.flow.edges.slice(0, 2) } };
  const requests: Request[] = [];
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(
      (r) => (
        requests.push(r),
        model({ 'method-1': 'flow' }, { method: (n) => (n === 1 ? chain : loop) }, attempts)(r)
      ),
    ),
  ).generate(input);
  assert.equal(attempts.method, 2);
  assert.deepEqual(metadata.degraded, []);
  assert.ok(
    steps(tour)
      .find((s) => s.id === 'method-1')!
      .actions.some((a) => a.type === 'board' && a.item.kind === 'flow'),
  );
  assert.match(
    requests.filter((r) => r.task.includes('STEP KIND: method')).at(-1)!.task,
    /a flow needs a branch, a merge or a loop/,
  );
});

test('a results step with illustrative numbers is sent back twice, then plays without its grid, flagged', async () => {
  const attempts: Record<string, number> = {};
  const toy = {
    heatmap: heatmap({
      source: 'illustrative',
      values: [
        [31, 0],
        [18, 1],
      ],
    }),
  };
  const requests: Request[] = [];
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider((r) => (requests.push(r), model({ 'result-1': 'heatmap' }, { result: () => toy }, attempts)(r))),
  ).generate(input);
  assert.equal(attempts.result, 3);
  assert.ok(
    !steps(tour)
      .find((s) => s.id === 'result-1')!
      .actions.some((a) => a.type === 'board'),
  );
  const degraded = metadata.degraded as Degraded[];
  assert.deepEqual(
    degraded.map((d) => [d.beat, ...d.dropped]),
    [['result-1', 'board']],
  );
  has(degraded[0].problems, /reports the document’s results/);
  const repairs = requests.filter((r) => r.task.includes('STEP KIND: result')).at(-1)!.task;
  assert.match(repairs, /set source to document and copy the values exactly as printed/);
});

test('every step losing its visual still gives a tour', async () => {
  const chain = {
    flow: {
      nodes: [node(1), node(2), node(3)],
      edges: [
        { from: 'node-1', to: 'node-2' },
        { from: 'node-2', to: 'node-3' },
      ],
    },
  };
  const line = { plot: plot('2*x+1') };
  const toy = {
    heatmap: heatmap({
      source: 'illustrative',
      values: [
        [31, 0],
        [18, 1],
      ],
    }),
  };
  const plan = { 'method-1': 'flow', 'formula-1': 'plot', 'result-1': 'heatmap' };
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(model(plan, { method: () => chain, formula: () => line, result: () => toy })),
  ).generate(input);
  assert.equal(steps(tour).length, beats.length);
  assert.deepEqual(
    (metadata.degraded as Degraded[]).map((d) => d.beat),
    ['method-1', 'formula-1', 'result-1'],
  );
  assert.ok(steps(tour).every((s) => !s.actions.some((a) => a.type === 'board')));
  assert.deepEqual(metadata.fallbackBeats, []);
});

test('a step whose narration is unusable takes the fallback beat, even when its visual was required', async () => {
  const events: Event[] = [];
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'deep',
    provider((request) => {
      // The formula detail must show a numerical example, and its narration is never usable.
      if (request.name === 'beat_direction' && request.task.includes('STEP KIND: formula (a closer look'))
        return { plan: 'p', say: 'too short', cues: [] };
      return model({}, {})(request);
    }),
  ).generate({ ...input, onEvent: record(events) });
  assert.ok(steps(tour).length > 3);
  assert.ok(!steps(tour).some((s) => s.id === 'formula-2'));
  assert.ok((metadata.omittedDetails as string[]).includes('formula-2'));
  assert.ok(events.some((e) => e.type === 'beat.omitted' && e.data.beat === 'formula-2'));
  assert.equal(events.find((e) => e.type === 'beat.completed' && e.data.beat === 'formula-2')!.data.outcome, 'omitted');
});

test('a narration that is too short falls back to the card text, as before', async () => {
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider((request) =>
      request.task.includes('STEP KIND: idea') ? { plan: 'p', say: 'too short', cues: [] } : model({}, {})(request),
    ),
  ).generate(input);
  assert.equal(steps(tour).find((s) => s.id === 'idea-1')!.say, card.key_idea.text);
  assert.deepEqual(metadata.fallbackBeats, ['idea-1']);
  assert.deepEqual(metadata.degraded, []);
});

// ------------------------------------------------------------------------------------------------ the last rung

const move = (id: string, ...actions: Action[]): Step => ({ id, say: 'one two three four five six', actions });
const board = (item: BoardItem): Action => ({ type: 'board', item });
const tourOf = (...list: Step[]): Tour => ({
  schema: 'paper-tour/tour@0.1',
  title: 't',
  paper: 'p',
  doc_sha256: 'x'.repeat(64),
  chapters: [
    { id: 'a', title: 'A', steps: list.slice(0, 2) },
    { id: 'b', title: 'B', steps: list.slice(2) },
  ],
});

test('tour problems name the steps with a board, by step ID or by path into the tour', () => {
  const tour = tourOf(
    move('s1', { type: 'focus', target: 'p1.s1' }, board(bars('a', 'b') as BoardItem)),
    move('s2', { type: 'focus', target: 'p1.s2' }),
    move('s3', { type: 'focus', target: 'p1.s3' }, board(bars('c', 'd') as BoardItem)),
  );
  const named = boardStepsOf(tour, [
    's1: plot is broken',
    '/chapters/1/steps/0/actions/1/item: must have a title',
    's2: unknown element x',
    'nothing',
  ]);
  assert.deepEqual([...named.keys()], ['s1', 's3'], 's2 has no board to drop');
  assert.deepEqual(named.get('s1'), ['s1: plot is broken']);
  assert.deepEqual(named.get('s3'), ['/chapters/1/steps/0/actions/1/item: must have a title']);
});

test('a step loses its board and board cues but keeps its narration and page cues, and the screen is cleared after it', () => {
  const tour = tourOf(
    move('s1', { type: 'focus', target: 'p1.s1' }, board(bars('a', 'b') as BoardItem), {
      type: 'board_focus',
      part: 0,
      at_word: 1,
    }),
    move('s2', { type: 'focus', target: 'p1.s2' }, board(bars('c', 'd') as BoardItem), {
      type: 'highlight',
      targets: ['p1.s2'],
      color: 'blue',
    }),
    move('s3', { type: 'focus', target: 'p1.s3' }),
  );
  const bare = settleBoards(withoutBoards(tour, new Set(['s2'])));
  const [, second, third] = steps(bare);
  assert.deepEqual(steps(bare)[0], steps(tour)[0], 'other steps are untouched');
  assert.deepEqual(
    second.actions.map((a) => a.type),
    ['focus', 'board_clear', 'highlight'],
  );
  assert.equal(second.say, steps(tour)[1].say);
  assert.deepEqual(
    third.actions.map((a) => a.type),
    ['focus'],
  );
});

// ------------------------------------------------------------------------------------------------------- the prompts

test('the prompts and the visual plan state the rules briefly', () => {
  assert.equal(HARNESS_VERSION, 'paper-tour-harness@28');
  const prompt = (board?: Parameters<typeof directTask>[2]['board']) =>
    directTask('en', 'BRIEF', { actions: ['highlight', 'board_focus'], board, words: 120 });
  assert.match(prompt(), /A step that reports results \(a result or a table\) draws only the document’s own numbers/);
  assert.match(prompt(), /a branch, a merge or a loop that the page does not draw→flow \(a chain of boxes is a list\)/);
  assert.match(prompt(), /never a straight line\)→plot/);
  assert.match(prompt(), /name rows, bars and points after real items rather than "item 1"/);
  assert.match(prompt('flow'), /a simple chain of boxes is rejected/);
  assert.match(prompt('plot'), /curves that are all straight lines are rejected/);
  assert.match(prompt('scatter'), /source illustrative is rejected/);
  assert.match(prompt('scatter'), /never "point 1"/);
  assert.match(prompt('heatmap'), /a step that reports results \(a result or a table\) needs it/);
  assert.match(prompt('heatmap'), /never "pos 1"/);
  assert.match(prompt('bars'), /never "item 1"/);
  const plan = visualPlanTask('en-US');
  assert.match(plan, /A step that reports results \(a result or a table\) uses only the\s+document's own numbers/);
  assert.match(plan, /illustrative values only explain a mechanism/);
  assert.match(plan, /never "item 1"/);
  assert.match(plan, /never a straight line/);
  assert.match(plan, /a chain of steps is a list, not a flow/);
  assert.match(plan, /never made-up points/);
  // Merged into the existing text rather than appended: the prompts stay close to their size before the rules.
  assert.ok(prompt().length < 19_700, `${prompt().length} characters`);
  // The rule on worked-example frames (they count toward the kind limits) added one numbered point.
  // The timeline and distribution kinds added one line each to the catalog of kinds.
  assert.ok(plan.length < 3_200, `${plan.length} characters`);
});
