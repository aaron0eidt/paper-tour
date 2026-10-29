import test from 'node:test';
import assert from 'node:assert/strict';
import type { BoardItem, Step } from '../../shared/paper';
import type { Doc, DocFigure, DocTableGrid, DocTableRow } from '../../shared/paper';
import { planBeats, type Beat } from '../src/harness/beats';
import { beatStep } from '../src/harness/assemble';
import { cardSchema, cleanCard } from '../src/harness/card';
import { beatBrief, beatTargets, cleanDirection, directionSchema } from '../src/harness/direct';
import { equationName, equationTag } from '../src/harness/equations';
import { namedElements } from '../src/harness/ask-retrieval';
import { paperBlock } from '../src/harness/paper-block';
import { tableText, tableViews } from '../src/harness/tables';
import { visualPlanBrief, type StepVisual } from '../src/harness/visual-plan';
import { HarnessTourGenerator } from './harness-fixture';
import { card, direct, doc as base, images, planFor, provider, settings, type Request } from './plan-fixture';

// Tables and equations in the tour: a step on a table, or a result that rests on one, sees the table as read (rows,
// columns, directions) with boards built from it, and a board copied from them passes the grounding check. A display
// equation without a printed number is chosen, listed and taught like a numbered one.

const num = (name: string, extra = {}) => ({ name, kind: 'number' as const, ...extra });
const cell = (text: string) => ({
  text,
  ...(text !== '' && Number.isFinite(Number(text)) ? { value: Number(text) } : {}),
});
const row = (label: string, ...cells: string[]): DocTableRow => ({ label, cells: cells.map(cell) });
/** A results table: quality against cost, with a base row. */
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
const unnumbered = {
  id: 'equ1',
  number: null,
  page: 2,
  bbox: [0, 330, 300, 350] as [number, number, number, number],
  block: 'p2.b4',
  text: 'u = a + b / 2',
};
const doc: Doc = {
  ...base,
  blocks: [
    ...base.blocks,
    { id: 'p2.b4', page: 2, type: 'equation', bbox: [0, 330, 300, 350], text: unnumbered.text, sentences: [] },
  ],
  figures: [...base.figures, table],
  equations: [...base.equations, unnumbered],
};
const tableCard = {
  ...card,
  key_figures: [{ id: 'tab1', why: 'It compares the methods.' }],
  key_formulas: [{ id: 'equ1', why: 'It sets the dose.' }],
};
const beats = planBeats(tableCard, doc, 'standard');
const beat = (id: string): Beat => beats.find((b) => b.id === id)!;
const visual = (kind: StepVisual['visual'], data = ''): StepVisual => ({
  visual: kind,
  idea: 'Show how the methods compare.',
  data,
});
const say =
  'Cost and savings pull in opposite directions here, which is why the probe network sits apart from the timer and the fixed schedule in the picture.';

// ------------------------------------------------------------------------------------------------------- the plan

test('the plan brief lists the tables its steps stand on, once each, with a base row hint where there is one', () => {
  const brief = visualPlanBrief(tableCard, beats, doc);
  assert.match(brief, /\[figure-1\] figure step[\s\S]*on table 1, page 2: Table 1: Water saved/);
  assert.match(brief, /its rows and columns are listed under TABLES below/);
  assert.match(brief, /\[result-1\] result step[\s\S]*its numbers come from table 1, listed under TABLES below/);
  assert.equal(brief.split('TABLES THE STEPS STAND ON').length, 2);
  assert.match(
    brief,
    /TABLE 1 \[tab1\], page 2: 4 rows and 4 columns\nMethod \| Water saved \(%\) \(higher is better\)/,
  );
  assert.match(brief, /Probe network \| 31\.4 \| 392\.5 \| 9\.6/);
  assert.doesNotMatch(brief, /CHANGES FROM THE BASE ROW/);
  assert.match(brief, /scatter of two of them for a trade-off, bars of one column or of the change from a base row/);
});

test('a plan brief of a document without table grids is what it was, and an unnumbered equation is named as one', () => {
  const plain = visualPlanBrief(card, planBeats(card, base, 'standard'), base);
  assert.doesNotMatch(plain, /TABLES/);
  const brief = visualPlanBrief(tableCard, beats, doc);
  assert.match(brief, /on an equation without a printed number, page 2: u = a \+ b \/ 2/);
  assert.match(
    visualPlanBrief(card, planBeats(card, base, 'standard'), base),
    /on equation \(1\), page 2: s = 1 - u \/ b/,
  );
});

// ------------------------------------------------------------------------------------------------------- the step

test('a step on a table sees it as read, with ready boards of the planned kind that match its data best', () => {
  const scatter = visual('scatter', 'Water saved against pump cost for the four methods');
  const targets = beatTargets(beat('figure-1'), doc, scatter);
  assert.equal(targets.table, 'tab1');
  assert.equal(targets.views![0].kind, 'scatter');
  assert.match(targets.evidence!, /Probe network \| 31\.4 \| 392\.5 \| 9\.6/);
  const brief = beatBrief(beat('figure-1'), doc, targets, scatter);
  assert.match(
    brief,
    /TABLE AS READ \(typed rows and columns; numbers exactly as printed; "-" is a blank cell\):\nTABLE 1 \[tab1\]/,
  );
  assert.match(brief, /READY SCATTER BOARDS BUILT FROM THE TABLE BY CODE/);
  assert.match(brief, /- scatter, Water saved \(%\) against Pump cost \(EUR\): \{"kind":"scatter"/);
  assert.match(brief, /"better":"up-left"/);
  // The pen still gets its grounded text targets.
  assert.match(brief, /GROUNDED TABLE TEXT TARGETS/);
});

test('a ready board is accepted by the grounding check, and a number the table does not print is not', () => {
  const scatter = visual('scatter');
  const b = beat('figure-1');
  const targets = beatTargets(b, doc, scatter);
  const copied = targets.views![0].item;
  const kept = cleanDirection({ plan: 'p', say, cues: [], scatter: copied }, b, targets, false, scatter)!;
  assert.deepEqual(kept.boardProblems, []);
  assert.equal(kept.board?.kind, 'scatter');
  const invented = JSON.parse(JSON.stringify(copied));
  invented.points[0].y = 55.5;
  const dropped = cleanDirection({ plan: 'p', say, cues: [], scatter: invented }, b, targets, false, scatter)!;
  assert.equal(dropped.board, undefined);
  assert.match(dropped.boardProblems!.join(' '), /not printed in the evidence/);
});

test('a result that rests on a table sees the same rendering and boards, and the table’s numbers are its evidence', () => {
  const bars = visual('bars', 'Water saved by each method');
  const b = beat('result-1');
  const targets = beatTargets(b, doc, bars);
  assert.equal(targets.table, 'tab1');
  assert.equal(targets.views![0].kind, 'bars');
  assert.match(targets.evidence!, /Timer \+ rain stop \| 12\.5 \| 430 \| 9\.7/);
  const brief = beatBrief(b, doc, targets, bars);
  assert.match(brief, /TABLE AS READ/);
  assert.match(brief, /READY BARS BOARDS BUILT FROM THE TABLE BY CODE/);
  const copied = targets.views![0].item;
  const kept = cleanDirection({ plan: 'p', say, cues: [], bars: copied }, b, targets, false, bars)!;
  assert.deepEqual(kept.boardProblems, []);
  assert.equal(kept.board?.kind, 'bars');
  // A bar the model rounded is not in the table.
  const rounded = JSON.parse(JSON.stringify(copied));
  rounded.bars[1].value = 12;
  const dropped = cleanDirection({ plan: 'p', say, cues: [], bars: rounded }, b, targets, false, bars)!;
  assert.match(dropped.boardProblems!.join(' '), /12 does not appear in the evidence/);
});

test('without a plan a table step offers bars; for a kind that is not numeric it offers nothing', () => {
  assert.equal(beatTargets(beat('figure-1'), doc).views?.[0].kind, 'bars');
  assert.equal(beatTargets(beat('figure-1'), doc, visual('flow')).views, undefined);
  assert.equal(beatTargets(beat('figure-1'), doc, visual('none')).views, undefined);
  assert.ok(!('views' in beatTargets(beat('method-1'), doc, visual('flow'))));
});

test('a table without a grid is shown as before: its extracted cell lines', () => {
  const bare = { ...table, grid: undefined };
  const plain: Doc = {
    ...doc,
    figures: [...base.figures, bare],
    blocks: [
      ...doc.blocks,
      {
        id: 'p2.b5',
        page: 2,
        type: 'table_text',
        bbox: [10, 200, 300, 214],
        text: 'Probe network 31.4 392.5',
        sentences: [],
      },
    ],
  };
  const b = planBeats(tableCard, plain, 'standard').find((x) => x.id === 'figure-1')!;
  const bars = visual('bars');
  const targets = beatTargets(b, plain, bars);
  assert.equal(targets.views, undefined);
  assert.match(targets.evidence!, /Probe network 31\.4 392\.5/);
  const brief = beatBrief(b, plain, targets, bars);
  assert.match(brief, /TABLE 1 \[tab1\] CELLS \(extracted, one line per block\):\nProbe network 31\.4 392\.5/);
  assert.doesNotMatch(brief, /READY|TABLE AS READ/);
  assert.doesNotMatch(visualPlanBrief(tableCard, planBeats(tableCard, plain, 'standard'), plain), /TABLES THE STEPS/);
});

test('every board the tour offers for a table carries only numbers its evidence prints', () => {
  const text = tableText(table);
  for (const view of tableViews(table)) {
    const targets = beatTargets(beat('figure-1'), doc, visual(view.kind));
    assert.ok(targets.evidence!.includes(text), view.kind);
  }
});

// ------------------------------------------------------------------------------------------------------ equations

test('a display equation without a number is listed in the paper block and offered to the card like a numbered one', () => {
  const block = paperBlock(doc);
  assert.match(block, /\[eq1\] \(1\), page 2: s = 1 - u \/ b/);
  assert.match(block, /\[equ1\] \(no number\), page 2: u = a \+ b \/ 2/);
  const ids = (cardSchema(doc, ['p1.s1']).properties.key_formulas.items.properties.id as { enum: string[] }).enum;
  assert.deepEqual(ids, ['eq1', 'equ1']);
  const kept = cleanCard(tableCard, doc);
  assert.deepEqual(
    kept.key_formulas.map((f) => f.id),
    ['equ1'],
  );
  // a table that was read lists its columns, so the card can tell a results table from a list of settings
  assert.match(
    block,
    /\[tab1\] table 1, page 2: Table 1: Water saved .* \| cited by p2\.s2 \| 4 rows, columns Water saved \(%\), Pump cost \(EUR\), Yield \(t\)\n/,
  );
  assert.doesNotMatch(paperBlock(base), /rows, columns/);
});

test('a formula step on an unnumbered equation is briefed, targeted and narrated like any other', () => {
  const formula = beat('formula-1');
  assert.equal(formula.target, 'equ1');
  assert.equal(formula.board, 'formula');
  const targets = beatTargets(formula, doc);
  assert.equal(targets.page, 2);
  assert.equal(targets.evidence, 'u = a + b / 2');
  assert.deepEqual(targets.visuals, ['equ1']);
  const brief = beatBrief(formula, doc, targets);
  assert.match(
    brief,
    /EQUATION \(it has no printed number\) \[equ1\], page 2, extracted text \(often garbled\): u = a \+ b \/ 2/,
  );
  assert.match(brief, /Page 2 is attached: read the typeset equation there\./);
  assert.doesNotMatch(brief, /null|undefined/);
  const schema: any = directionSchema(formula, targets, true);
  assert.ok(schema.properties.cues.items.properties.target.enum.includes('term-1'));
  // Without a narration the step names the equation by where it is.
  const step = beatStep(formula, targets, null, doc);
  assert.match(step.say, /^Let's look at the equation on page 2\./);
  assert.deepEqual(step.actions[0], { type: 'zoom', target: 'equ1' });
  assert.ok(step.actions.some((a) => a.type === 'box' && a.target === 'equ1'));
});

test('a numbered equation reads as it did, and questions find equations by number or by words', () => {
  const numbered = planBeats(card, base, 'standard').find((b) => b.id === 'formula-1')!;
  const brief = beatBrief(numbered, base, beatTargets(numbered, base));
  assert.match(brief, /EQUATION \(1\) \[eq1\], page 2/);
  assert.match(brief, /read the typeset equation \(1\) there\./);
  assert.equal(equationName(base.equations[0]), 'Equation 1');
  assert.equal(equationTag(base.equations[0]), '(1)');
  assert.equal(equationName(unnumbered), 'the equation on page 2');
  assert.equal(equationTag(unnumbered), '(no number)');
  assert.deepEqual(namedElements(doc, 'What does Eq. (1) say, and what is Table 1?'), ['tab1', 'eq1']);
  assert.deepEqual(namedElements(doc, 'What does the unnumbered equation say?'), []);
});

// -------------------------------------------------------------------------------------------------- a whole tour

test('a tour whose model copies the ready board of a table plays it, and one that invents a number loses only its board', async () => {
  const explain =
    'Savings and cost pull in opposite directions here, which is why the probe network sits apart from the timer and the fixed schedule in the picture.';
  const run = async (tamper: (board: any) => void) => {
    const requests: Request[] = [];
    const model = (request: Request) => {
      if (request.name === 'paper_card') return tableCard;
      if (request.name === 'visual_plan')
        return planFor(request, (id) =>
          id === 'figure-1'
            ? { visual: 'scatter', idea: 'Savings against cost.', data: 'Water saved (%) against Pump cost (EUR).' }
            : 'none',
        );
      const step = /STEP KIND: (\w+)/.exec(request.task)?.[1];
      if (step !== 'figure') return direct(request, explain);
      // The model reads the ready board from its brief and copies it.
      const line = request.task.split('\n').find((l) => l.startsWith('- scatter, '))!;
      const board = JSON.parse(line.slice(line.indexOf('{')));
      tamper(board);
      return direct(request, explain, { scatter: board });
    };
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
    const input = { documentId: 'doc-table', analysisId: 'analysis-table', doc, images: [...images, tableImage] };
    const { tour } = await generator.generate(input);
    const steps: Step[] = tour.chapters.flatMap((c) => c.steps);
    const board = steps.flatMap((s) => s.actions).find((a) => a.type === 'board') as { item: BoardItem } | undefined;
    return { requests, board: board?.item };
  };
  const kept = await run(() => {});
  assert.equal(kept.board?.kind, 'scatter');
  assert.equal(kept.board?.kind === 'scatter' && kept.board.better, 'up-left');
  const task = kept.requests.find((r) => r.name === 'beat_direction' && r.task.includes('STEP KIND: figure'))!.task;
  assert.match(task, /READY SCATTER BOARDS BUILT FROM THE TABLE BY CODE/);
  assert.match(task, /TABLE AS READ/);
  const plan = kept.requests.find((r) => r.name === 'visual_plan')!.task;
  assert.match(plan, /TABLES THE STEPS STAND ON/);
  // A coordinate the table does not print is sent back, then dropped; the step and the tour stay.
  const bad = await run((board) => (board.points[0].y = 44.4));
  assert.equal(bad.board, undefined);
  const repairs = bad.requests.filter((r) => r.name === 'beat_direction' && r.task.includes('STEP KIND: figure'));
  assert.ok(repairs.length >= 2, 'the board was sent back for repair');
  assert.ok(repairs.some((r) => r.messages.some((m) => /not printed in the evidence/.test(m))));
});
