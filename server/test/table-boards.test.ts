import test from 'node:test';
import assert from 'node:assert/strict';
import type { Step } from '../../shared/paper';
import type { Doc, DocFigure, DocTableGrid, DocTableRow } from '../../shared/paper';
import { planBeats, type Beat } from '../src/harness/beats';
import { beatTargets, withReadyView } from '../src/harness/direct';
import { tableViews } from '../src/harness/tables';
import {
  cleanVisualPlan,
  tableSteps,
  visualPlanBrief,
  visualPlanTask,
  withTableBoard,
  type StepVisual,
  type VisualPlan,
} from '../src/harness/visual-plan';
import { HarnessTourGenerator } from './harness-fixture';
import { card, direct, doc as base, images, planFor, provider, settings, type Request } from './plan-fixture';

// A results step that stands on a table with ready boards draws the table's own numbers (notes/VISUALS-V2.md): the visual
// plan gives at least one such step a board of the document's real values, within the variety limits, and the step's
// direction is briefed with the table the plan named.

const num = (name: string, extra = {}) => ({ name, kind: 'number' as const, ...extra });
const cell = (text: string) => ({
  text,
  ...(text !== '' && Number.isFinite(Number(text)) ? { value: Number(text) } : {}),
});
const row = (label: string, ...cells: string[]): DocTableRow => ({ label, cells: cells.map(cell) });
const grid: DocTableGrid = {
  confidence: 'high',
  method: 'spans',
  label_header: 'Method',
  columns: [num('Water saved (%)', { better: 'up' }), num('Pump cost (EUR)', { better: 'down' }), num('Yield (t)')],
  rows: [
    row('Fixed schedule', '0', '480', '9.8'),
    row('Timer + rain stop', '12.5', '430', '9.7'),
    row('Probe network', '31.4', '392.5', '9.6'),
    row('Probe network (cheap)', '27.2', '350', '9.5'),
  ],
};
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
  grid,
};
const doc: Doc = { ...base, figures: [...base.figures, table] };
const tableCard = { ...card, key_figures: [{ id: 'tab1', why: 'It compares the methods.' }], key_formulas: [] };
const beats = planBeats(tableCard, doc, 'standard');
const none: StepVisual = { visual: 'none', idea: '', data: '' };
const planOf = (pick: Record<string, StepVisual['visual']> = {}): VisualPlan =>
  new Map(
    beats.map((beat) => [
      beat.id,
      pick[beat.id] ? { visual: pick[beat.id], idea: 'Show the idea.', data: 'illustrative values' } : none,
    ]),
  );
const kinds = (plan: VisualPlan) => Object.fromEntries([...plan].map(([id, entry]) => [id, entry.visual]));

test('the steps that report results from a table with ready boards are the step on the table and the result on it', () => {
  assert.deepEqual(
    tableSteps(beats, doc).map(({ beat, table: t }) => [beat.id, t.id]),
    [
      ['figure-1', 'tab1'],
      ['result-1', 'tab1'],
    ],
  );
  // No grid, no ready boards, no such step; and a document without tables has none.
  const bare: Doc = { ...doc, figures: [...base.figures, { ...table, grid: undefined }] };
  assert.deepEqual(tableSteps(planBeats(tableCard, bare, 'standard'), bare), []);
  assert.deepEqual(tableSteps(planBeats(card, base, 'standard'), base), []);
});

test('a plan with no board of the table’s numbers gives the first free results step its best ready board', () => {
  const { plan, adjusted } = withTableBoard(planOf({ 'idea-1': 'plot', 'method-1': 'flow' }), beats, doc);
  const given = plan.get('figure-1')!;
  const views = tableViews(table);
  assert.equal(given.visual, views[0].kind);
  assert.equal(given.table, 'tab1');
  assert.match(given.idea, /^Learner sees .*table 1's own numbers/);
  assert.match(given.data, /^columns Water saved \(%\), Pump cost \(EUR\) of the table/);
  assert.deepEqual(adjusted, [
    { beat: 'figure-1', visual: views[0].kind, reason: 'a results step on table 1 draws its own numbers' },
  ]);
  // The other steps keep their plan.
  assert.equal(plan.get('idea-1')!.visual, 'plot');
  assert.equal(plan.get('method-1')!.visual, 'flow');
  assert.equal(plan.get('result-1')!.visual, 'none');
});

test('a plan that already draws the table on a results step is kept and only learns the table', () => {
  const planned = planOf({ 'result-1': 'bars', 'figure-1': 'flow' });
  const { plan, adjusted } = withTableBoard(planned, beats, doc);
  assert.deepEqual(adjusted, []);
  assert.deepEqual(kinds(plan), kinds(planned));
  assert.equal(plan.get('result-1')!.table, 'tab1');
  assert.equal(plan.get('figure-1')!.table, undefined);
});

test('the board comes within the variety limits: a kind in use goes on, and a used-up kind is taken over', () => {
  // Scatter, then the next ready kind: the table offers a scatter first, so with scatter in use another kind is drawn.
  const used = withTableBoard(planOf({ 'idea-1': 'scatter' }), beats, doc);
  const next = used.plan.get('figure-1')!;
  assert.notEqual(next.visual, 'scatter');
  assert.equal(used.plan.get('idea-1')!.visual, 'scatter');
  assert.ok(tableViews(table).some((view) => view.kind === next.visual));
  // Every kind the table offers is in use elsewhere: the last such step elsewhere gives its board up.
  const offered = [...new Set(tableViews(table).map((view) => view.kind))];
  const busy = planOf(Object.fromEntries(offered.map((kind, i) => [['idea-1', 'method-1', 'limitation-1'][i], kind])));
  const taken = withTableBoard(busy, beats, doc);
  assert.equal(taken.plan.get('figure-1')!.visual, offered[0]);
  assert.equal(taken.plan.get('idea-1')!.visual, 'none');
  assert.ok(taken.adjusted.some((a) => a.beat === 'idea-1' && /goes to a results step .* table 1/.test(a.reason)));
  // Boards and kinds stay within the limits that cleanVisualPlan enforces.
  for (const { plan } of [used, taken]) {
    const drawn = [...plan.values()].filter((entry) => entry.visual !== 'none');
    assert.ok(drawn.length <= Math.max(1, Math.floor(beats.length * 0.6)));
    for (const kind of new Set(drawn.map((entry) => entry.visual)))
      assert.ok(
        drawn.filter((entry) => entry.visual === kind).length <= (kind === 'plot' || kind === 'formula' ? 2 : 1),
      );
  }
});

test('a plan whose boards are used up in kinds the table cannot draw still gets the table’s board in a free step', () => {
  const plan = planOf({ 'idea-1': 'plot', 'method-1': 'flow', 'limitation-1': 'timeline' });
  const { plan: out } = withTableBoard(plan, beats, doc);
  assert.ok(tableViews(table).some((view) => view.kind === out.get('figure-1')!.visual));
  assert.equal([...out.values()].filter((entry) => entry.visual !== 'none').length, 4);
});

test('the plan brief and task ask for it: ready boards per table, and at least one results step draws one', () => {
  const brief = visualPlanBrief(tableCard, beats, doc);
  assert.match(brief, /Ready boards of this table: scatter: Water saved \(%\) against Pump cost \(EUR\);/);
  assert.match(
    visualPlanTask('en-US'),
    /At least one\s+results step on a table with ready boards \(listed under TABLES\) draws one/,
  );
});

test('the step is briefed with the table the plan named, not with another one that repeats its numbers', () => {
  const other: DocFigure = {
    ...table,
    id: 'tab2',
    number: '2',
    referenced_by: ['p2.s1'],
    caption: 'Table 2: Another comparison',
  };
  const two: Doc = { ...doc, figures: [...base.figures, table, other] };
  const result = planBeats(tableCard, two, 'standard').find((b) => b.id === 'result-1')!;
  const bars: StepVisual = { visual: 'bars', idea: 'The methods.', data: 'Water saved by each method' };
  assert.equal(beatTargets(result, two, bars).table, 'tab2');
  assert.equal(beatTargets(result, two, { ...bars, table: 'tab1' }).table, 'tab1');
});

test('a direction that left a planned table board out gets the table’s own ready board, a failed one stays dropped', () => {
  const figure = beats.find((b) => b.id === 'figure-1') as Beat;
  const planned: StepVisual = {
    visual: 'scatter',
    idea: 'Savings against cost.',
    data: 'columns Water saved (%)',
    table: 'tab1',
  };
  const targets = beatTargets(figure, doc, planned);
  const direction = { plan: 'p', say: 'Savings and cost pull apart here.', cues: [], boardProblems: [] };
  const filled = withReadyView(direction, targets, planned)!;
  assert.equal(filled.board?.kind, 'scatter');
  assert.deepEqual(filled.board, targets.views![0].item);
  // Nothing is added for a step the plan did not put on a table, for a failed board, or when one is drawn.
  assert.equal(withReadyView(direction, targets, { ...planned, table: undefined }), null);
  assert.equal(withReadyView({ ...direction, boardProblems: ['x'] }, targets, planned), null);
  assert.equal(withReadyView(filled, targets, planned), null);
  assert.equal(withReadyView(direction, targets, { ...planned, visual: 'plot' }), null);
});

test('a tour whose plan leaves the table to the page still draws its numbers on a results step', async () => {
  const explain =
    'Savings and cost pull in opposite directions here, which is why the probe network sits apart from the timer and the fixed schedule in the picture.';
  for (const copies of [true, false]) {
    const requests: Request[] = [];
    const model = (request: Request) => {
      if (request.name === 'paper_card') return tableCard;
      if (request.name === 'visual_plan') return planFor(request, (id) => (id === 'idea-1' ? 'plot' : 'none'));
      if (!/STEP KIND: figure/.test(request.task)) return direct(request, explain);
      // The model reads the ready board from its brief and copies it, or leaves the board out.
      const line = request.task.split('\n').find((l) => /^- (scatter|heatmap|bars), /.test(l));
      return copies && line
        ? direct(request, explain, { [/^- (\w+),/.exec(line)![1]]: JSON.parse(line.slice(line.indexOf('{'))) })
        : direct(request, explain);
    };
    const events: { type: string; data: any }[] = [];
    const generator = new HarnessTourGenerator(
      settings,
      'standard',
      provider((r) => (requests.push(r), model(r))),
    );
    const tableImage = {
      targetId: 'tab1',
      kind: 'table' as const,
      page: 2,
      label: 'Table 1',
      dataUrl: images[0].dataUrl,
    };
    const { tour, metadata } = await generator.generate({
      documentId: 'doc-table',
      analysisId: 'analysis-table',
      doc,
      images: [...images, tableImage],
      onEvent: async (type, data) => void events.push({ type, data: data as any }),
    });
    const steps: Step[] = tour.chapters.flatMap((c) => c.steps);
    const boards = steps.flatMap((s) => s.actions).flatMap((a) => (a.type === 'board' ? [a.item] : []));
    const plan = events.find((e) => e.type === 'visual.plan')!.data;
    const given = plan.beats.find((b: { beat: string }) => b.beat === 'figure-1');
    assert.equal(given.table, 'tab1');
    assert.ok(['scatter', 'heatmap', 'bars'].includes(given.visual));
    assert.ok(plan.adjusted.some((a: { beat: string }) => a.beat === 'figure-1'));
    const own = boards.find((item) => item.kind === given.visual);
    assert.ok(own, `the table's board is shown (model ${copies ? 'copied' : 'left it out'})`);
    assert.equal(
      events.some((e) => e.type === 'board.table'),
      !copies,
    );
    assert.ok((metadata as any).boards.shown.some((s: string) => s.startsWith('figure-1:')));
  }
});

test('the checks of the plan still apply to what the backstop adds', () => {
  // Fed through the same cleaner first, a plan that is over the share of steps loses its latest boards.
  const raw = { plan: 'p', beats: beats.map((b) => ({ beat: b.id, visual: 'none', idea: '', data: '' })) };
  const cleaned = cleanVisualPlan(raw, beats);
  assert.ok(cleaned.plan);
  const { plan } = withTableBoard(cleaned.plan!, beats, doc);
  assert.equal([...plan.values()].filter((entry) => entry.visual !== 'none').length, 1);
});
