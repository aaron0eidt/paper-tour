import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc, DocFigure, DocTableColumn, DocTableGrid, DocTableRow } from '../../shared/paper';
import { scatterProblems } from '../../shared/scatter';
import { heatmapProblems } from '../../shared/heatmap';
import { checkBoard } from '../src/harness/board';
import { groundedProblems } from '../src/harness/visual-rules';
import {
  barsView,
  baseRow,
  baseRowName,
  betterWay,
  changesView,
  gridNumbers,
  heatmapView,
  printedNumbers,
  resultTable,
  scatterView,
  tableText,
  tableViews,
  viewText,
  viewsFor,
} from '../src/harness/tables';

// Tables as the ingest reads them (doc.json figures[].grid): the numbers they print, their compact text, and the boards
// code builds from them. The tables here are small and made up; their shapes are the common ones: a results table with
// a cost column, an ablation with a base row and blank cells, a grid of comparable scores.

const num = (name: string, extra: Partial<DocTableColumn> = {}): DocTableColumn => ({ name, kind: 'number', ...extra });
const text = (name: string): DocTableColumn => ({ name, kind: 'text' });
const parsed = (cell: string) => {
  const n = Number(cell.replace(/,/g, ''));
  return cell !== '' && Number.isFinite(n) ? { text: cell, value: n } : { text: cell };
};
const row = (label: string, ...cells: string[]): DocTableRow => ({ label, cells: cells.map(parsed) });
const grid = (columns: DocTableColumn[], rows: DocTableRow[], extra: Partial<DocTableGrid> = {}): DocTableGrid => ({
  confidence: 'high',
  method: 'spans',
  label_header: 'Model',
  columns,
  rows,
  ...extra,
});
const table = (g?: DocTableGrid, id = 'tab1', number = '1'): DocFigure => ({
  id,
  kind: 'table',
  number,
  page: 3,
  bbox: [0, 0, 100, 100],
  caption: 'Results',
  image: `figures/${id}.png`,
  panels: [],
  referenced_by: [],
  ...(g ? { grid: g } : {}),
});

/** Quality against cost: a score where higher is better, a latency where lower is, a size, and a gap in one row. */
const results = grid(
  [num('BLEU', { better: 'up' }), num('Latency (ms)', { unit: 'ms', better: 'down' }), num('Params')],
  [
    row('Old [18]', '23.75', '120', '65'),
    row('Wide [9]', '25.16', '96.5', '213'),
    row('Deep + Cache [11]', '26.03', '40', ''),
    row('Ours (small)', '26.3', '12.5', '60'),
    row('Ours (big)', '27.4', '30.1', '210'),
  ],
);

/** An ablation: the base row fills every setting and measure, the others only what they change. */
const ablation = grid(
  [num('N'), num('h'), num('d_k'), num('P_drop'), num('PPL (dev)'), num('BLEU (dev)')],
  [
    row('base', '6', '8', '64', '0.1', '4.92', '25.8'),
    row('(A)', '', '1', '512', '', '5.29', '24.9'),
    row('(A)', '', '4', '128', '', '5.00', '25.5'),
    row('(B)', '', '', '16', '', '5.16', '25.1'),
    row('(C)', '2', '', '', '', '6.11', '23.7'),
    row('(C)', '4', '', '', '', '5.19', '25.3'),
    row('(C)', '8', '', '', '', '4.88', '25.5'),
    row('(D)', '', '', '', '0.0', '5.77', '24.6'),
    row('(D)', '', '', '', '0.2', '4.95', '25.5'),
    { ...row('(E)', '', '', '', '', '4.92', '25.7'), note: 'learned positions' },
    row('big', '6', '', '', '0.3', '4.33', '26.4'),
  ],
);

/** Scores of several methods on several comparable settings. */
const scores = grid(
  [num('Easy'), num('Medium'), num('Hard'), num('Expert')],
  [
    row('Method A', '91.2', '84.5', '70.1', '55.0'),
    row('Method B', '93.0', '86.0', '74.2', '58.9'),
    row('Method C', '88.4', '80.3', '69.9', '50.2'),
    row('Method D', '95.1', '90.8', '81.5', '66.7'),
  ],
);

// ------------------------------------------------------------------------------------------------------ numbers

test('the numbers a grid prints are its values and the numbers in its text, ranges included', () => {
  const g = grid([num('ICC range'), num('p')], [row('Strong', '0.16–0.40', '0.006'), row('Weak', '1,024', '<0.001')]);
  const printed = gridNumbers(g);
  for (const n of [0.16, 0.4, 0.006, 1024, 0.001]) assert.ok(printed.includes(n), String(n));
});

test('a table without a grid prints the numbers of its extracted lines', () => {
  const doc = {
    blocks: [
      { id: 'p1.b1', page: 3, type: 'table_text', bbox: [10, 10, 90, 20], text: 'Model A 12.5 99.1', sentences: [] },
    ],
  } as unknown as Doc;
  assert.deepEqual(printedNumbers(doc, table()), [12.5, 99.1]);
  assert.ok(printedNumbers(doc, table(results)).includes(25.16));
});

test('a result rests on the table its evidence cites, else on the one that prints its numbers', () => {
  const other = grid([num('A'), num('B')], [row('x', '501.5', '77.25'), row('y', '502.5', '78.25')]);
  const [first, second] = [table(results, 'tab1', '1'), table(other, 'tab2', '2')];
  const doc = { blocks: [], figures: [first, second] } as unknown as Doc;
  assert.equal(resultTable(doc, [], 'the score rose to 77.25 and 501.5')?.id, 'tab2');
  assert.equal(resultTable(doc, [], 'it scored 26.03 against 25.16')?.id, 'tab1');
  assert.equal(resultTable(doc, [], 'no numbers that match anything'), undefined);
  second.referenced_by = ['p1.s9'];
  assert.equal(resultTable(doc, ['p1.s9'], 'it scored 26.03 against 25.16')?.id, 'tab2');
});

// ------------------------------------------------------------------------------------------------------- text

test('the compact text has a header with directions, one line per row and a dash for a blank cell', () => {
  const lines = tableText(table(results)).split('\n');
  assert.equal(lines[0], 'TABLE 1 [tab1], page 3: 5 rows and 4 columns');
  assert.equal(lines[1], 'Model | BLEU (higher is better) | Latency (ms) (lower is better) | Params');
  assert.equal(lines[2], 'Old [18] | 23.75 | 120 | 65');
  assert.equal(lines[4], 'Deep + Cache [11] | 26.03 | 40 | -');
  assert.equal(lines.length, 7);
});

test('the text names a group before the row, keeps a row note, notes under the table and what was inferred', () => {
  const g = grid(
    [text('Setting'), num('Score')],
    [
      { label: '', group: '(A)', cells: [{ text: 'h=1' }, { text: '5.2', value: 5.2 }] },
      { label: '', group: '(A)', cells: [{ text: 'h=4' }, { text: '5.0', value: 5.0 }] },
      { label: 'E', note: 'learned positions', cells: [{ text: '' }, { text: '5.7', value: 5.7 }] },
    ],
    { confidence: 'medium', label_header: undefined, notes: ['Unlisted values are the same as the first row.'] },
  );
  const lines = tableText(table(g)).split('\n');
  assert.match(lines[0], /: 3 rows and 3 columns, read with some inference from the layout$/);
  assert.equal(lines[1], 'Row | Setting | Score');
  assert.equal(lines[2], '(A) | h=1 | 5.2');
  assert.equal(lines[4], 'E | - | 5.7  [learned positions]');
  assert.equal(lines.at(-1), 'Notes: Unlisted values are the same as the first row.');
});

test('a long table is cut and counted, and none of it is cut without asking', () => {
  const long = grid(
    [num('v')],
    Array.from({ length: 30 }, (_, i) => row(`r${i}`, String(100 + i))),
  );
  assert.equal(tableText(table(long)).split('\n').length, 32);
  const cut = tableText(table(long), { maxRows: 10 }).split('\n');
  assert.equal(cut.length, 13);
  assert.equal(cut.at(-1), '(20 more rows not shown)');
  assert.equal(tableText(table()), '');
});

test('with a base row the text ends with each measure’s change from it, computed to the printed places', () => {
  const lines = tableText(table(ablation)).split('\n');
  const at = lines.findIndex((l) => l.startsWith('CHANGES FROM THE BASE ROW'));
  assert.ok(at > 0);
  assert.equal(lines[at], 'CHANGES FROM THE BASE ROW "base" (computed, row minus base):');
  // 24.9 - 25.8 is -0.9000000000000021 in floating point; the text prints -0.9
  assert.match(lines[at + 2], /^BLEU \(dev\): h=1 d_k=512 -0\.9; h=4 d_k=128 -0\.3; /);
  assert.match(lines[at + 1], /^PPL \(dev\): h=1 d_k=512 \+0\.37; /);
  assert.doesNotMatch(tableText(table(ablation), { changes: false }), /CHANGES FROM/);
  assert.doesNotMatch(tableText(table(results)), /CHANGES FROM/);
});

test('the base row is the one named base, else the only full row among sparse ones', () => {
  assert.equal(baseRow(ablation), 0);
  assert.equal(baseRowName(table(ablation)), 'base');
  const renamed = grid(
    ablation.columns,
    ablation.rows.map((r, i) => (i === 0 ? { ...r, label: 'ours' } : r)),
  );
  assert.equal(baseRow(renamed), 0, 'the one full row among sparse ones');
  assert.equal(baseRow(results), undefined);
  assert.equal(baseRow(scores), undefined);
  assert.equal(baseRowName(table(results)), undefined);
  const named = grid(results.columns, [row('Baseline CNN', '20', '50', '1'), ...results.rows]);
  assert.equal(baseRow(named), 0);
});

// ------------------------------------------------------------------------------------------------------- better

test('a column’s direction is what its header says, else what the name of a known measure says', () => {
  assert.equal(betterWay(num('BLEU', { better: 'down' })), 'down', 'the header wins');
  assert.equal(betterWay(num('BLEU EN-DE')), 'up');
  assert.equal(betterWay(num('Top-1 accuracy')), 'up');
  assert.equal(betterWay(num('Training Cost (FLOPs)')), 'down');
  assert.equal(betterWay(num('PPL (dev)')), 'down');
  assert.equal(betterWay(num('Error rate')), 'down');
  assert.equal(betterWay(num('Params')), undefined);
  assert.equal(betterWay(num('Lag (d)')), undefined);
  assert.equal(betterWay(num('Scorecard')), undefined, 'a word on the list only counts as a whole word');
});

// ------------------------------------------------------------------------------------------------------ scatter

test('a scatter of two columns puts the cost on x, shades the better corner and uses a log axis for a wide range', () => {
  const item = scatterView(results, 0, 1)!;
  assert.equal(item.kind, 'scatter');
  assert.equal(item.source, 'document');
  assert.equal(item.x_label, 'Latency (ms)');
  assert.equal(item.y_label, 'BLEU');
  assert.equal(item.better, 'up-left');
  assert.equal(item.x_log, undefined, '12.5 to 120 is under 30 times');
  assert.deepEqual(item.points[0], { label: 'Old', x: 120, y: 23.75 });
  assert.equal(item.points.length, 5);
  assert.deepEqual(scatterProblems(item), []);
  // the same pair given the other way round draws the same picture
  assert.deepEqual(scatterView(results, 1, 0), item);
  const wide = grid(
    [num('Score', { better: 'up' }), num('Cost', { better: 'down' })],
    [row('a', '1', '1,000'), row('b', '2', '100,000'), row('c', '3', '10')],
  );
  assert.equal(scatterView(wide, 0, 1)!.x_log, true);
});

test('a scatter has no better corner unless both columns say which way is better', () => {
  const g = grid([num('Params'), num('Steps')], [row('a', '1', '5'), row('b', '2', '6'), row('c', '3', '8')]);
  assert.equal(scatterView(g, 0, 1)!.better, undefined);
  assert.equal(scatterView(results, 0, 2)!.better, undefined, 'params has no known direction');
  const both = grid([num('Acc'), num('F1')], [row('a', '1', '5'), row('b', '2', '6'), row('c', '3', '8')]);
  assert.equal(scatterView(both, 0, 1)!.better, 'up-right');
});

test('a scatter takes the rows that have both numbers, at most ten spread over the table, and no summary row', () => {
  const rows = Array.from({ length: 25 }, (_, i) => row(`Method ${i + 1} large`, String(i + 1), String(100 - i)));
  const item = scatterView(grid([num('A'), num('B')], [...rows, row('Mean', '13', '88')]), 0, 1)!;
  assert.equal(item.points.length, 10);
  assert.equal(item.points.at(-1)!.x, 25, 'the last row stays');
  assert.ok(!item.points.some((p) => p.label.startsWith('Mean')));
  assert.equal(scatterView(grid([num('A'), num('B')], [row('x', '1', '2'), row('y', '2', '')]), 0, 1), null);
  assert.equal(
    scatterView(grid([num('A'), num('B')], [row('x', '1', '2'), row('y', '1', '3')]), 0, 1),
    null,
    'one x only',
  );
  assert.equal(scatterView(grid([text('A'), num('B')], [row('x', 'a', '2'), row('y', 'b', '3')]), 0, 1), null);
});

test('point labels are short and distinct: citations go, a cut that fits two rows is cut from the start', () => {
  const g = grid(
    [num('Acc', { better: 'up' }), num('Cost', { better: 'down' })],
    [
      row('Convolutional attention network [3]', '1', '5'),
      row('Convolutional attention', '2', '6'),
      row('Dyer et al. (2016) [8]', '3', '8'),
      row('Dyer et al. (2016) [9]', '4', '9'),
    ],
  );
  const labels = scatterView(g, 0, 1)!.points.map((p) => p.label);
  assert.equal(new Set(labels).size, 4);
  assert.ok(
    labels.every((l) => l.length <= 24),
    labels.join(' | '),
  );
  assert.equal(labels[0], 'attention network');
  assert.equal(labels[1], 'Convolutional attention');
  assert.deepEqual(labels.slice(2), ['Dyer et al. (2016) #1', 'Dyer et al. (2016) #2']);
});

// ------------------------------------------------------------------------------------------------------ heatmap

test('a heatmap is a block of comparable columns over the rows that fill all of them', () => {
  const item = heatmapView(scores, 'Scores')!;
  assert.equal(item.kind, 'heatmap');
  assert.equal(item.source, 'document');
  assert.equal(item.title, 'Scores');
  assert.deepEqual(item.rows, ['Method A', 'Method B', 'Method C', 'Method D']);
  assert.deepEqual(item.cols, ['Easy', 'Medium', 'Hard', 'Expert']);
  assert.deepEqual(item.values[1], [93.0, 86.0, 74.2, 58.9]);
  assert.equal(item.scale, undefined);
  assert.deepEqual(heatmapProblems(item), []);
});

test('signed values get a diverging scale, and a column that is not comparable stays out', () => {
  const g = grid(
    [num('r1'), num('r2'), num('r3'), num('Count')],
    [
      row('a', '0.8', '-0.2', '0.1', '5400'),
      row('b', '-0.3', '0.9', '0.4', '9200'),
      row('c', '0.1', '0.5', '-0.6', '7100'),
    ],
  );
  const item = heatmapView(g)!;
  assert.deepEqual(item.cols, ['r1', 'r2', 'r3']);
  assert.equal(item.scale, 'diverging');
  assert.equal(item.title, undefined);
});

test('no heatmap for numbers one colour scale cannot show, or for fewer than three rows and columns', () => {
  const mixed = grid(
    [num('p'), num('t'), num('SE')],
    [row('a', '0.002', '4.063', '0.048'), row('b', '0.346', '0.98', '0.05'), row('c', '0.814', '9.2', '0.077')],
  );
  assert.equal(heatmapView(mixed), null);
  assert.equal(
    heatmapView(
      grid(
        scores.columns.slice(0, 2),
        scores.rows.map((r) => ({ ...r, cells: r.cells.slice(0, 2) })),
      ),
    ),
    null,
  );
  assert.equal(heatmapView(grid(scores.columns, scores.rows.slice(0, 2))), null);
});

test('heatmap labels are at most 16 characters and distinct', () => {
  const g = grid(
    [num('Training Cost (FLOPs) EN-DE'), num('Training Cost (FLOPs) EN-FR'), num('Training Cost (FLOPs) EN-ES')],
    [
      row('A very long model name [4]', '5', '6', '7'),
      row('Another long model name [5]', '6', '7', '8'),
      row('x', '7', '8', '9'),
    ],
  );
  const item = heatmapView(g)!;
  assert.ok(
    [...item.rows, ...item.cols].every((l) => l.length <= 16),
    [...item.rows, ...item.cols].join(' | '),
  );
  assert.equal(new Set(item.cols).size, 3);
  assert.equal(new Set(item.rows).size, 3);
});

// -------------------------------------------------------------------------------------------------------- bars

test('bars of one column: at most six rows, the last and the best kept, labels without citations', () => {
  const rows = Array.from({ length: 12 }, (_, i) => row(`Method ${i + 1} [${i}]`, String(50 + (i === 4 ? 30 : i))));
  const item = barsView(grid([num('Accuracy', { better: 'up' })], rows), 0)!;
  assert.equal(item.bars.length, 6);
  assert.equal(item.higher_is_better, true);
  assert.ok(
    item.bars.some((b) => b.label === 'Method 12'),
    'the last row',
  );
  assert.ok(
    item.bars.some((b) => b.value === 80),
    'the best row',
  );
  assert.ok(item.bars.every((b) => !b.label.includes('[')));
  const tableOrder = item.bars.map((b) => Number(/\d+/.exec(b.label)![0]));
  assert.deepEqual(
    tableOrder,
    [...tableOrder].sort((a, b) => a - b),
  );
});

/** A cell as the ingest reads it when the exponent was a superscript: its text keeps "10^19", its value is the number. */
const power = (mantissa: string, exponent: number) => ({
  text: `${mantissa} × 10^${exponent}`,
  value: Number(`${mantissa}e${exponent}`),
});

test('a table of costs in FLOPs: the numbers its cells print include the powers of ten, and its scatter has the axis they need', () => {
  const costs = (...rows: [string, string, number][]) =>
    grid(
      [num('BLEU', { better: 'up' }), num('Training Cost (FLOPs)', { better: 'down' })],
      rows.map(([label, bleu, exponent], i) => ({
        label,
        cells: [parsed(bleu), power(['9.6', '2.0', '2.3', '3.3', '1.4'][i], exponent)],
      })),
    );
  const narrow = costs(
    ['ConvS2S [9]', '25.16', 18],
    ['MoE [32]', '26.03', 19],
    ['GNMT + RL [38]', '24.6', 19],
    ['Transformer (big)', '28.4', 19],
  );
  assert.deepEqual(
    gridNumbers(narrow).filter((n) => n > 1e6),
    [9.6e18, 2e19, 2.3e19, 3.3e19],
  );
  // Only 3.4 times apart: a linear axis shows them, labelled in powers of ten rather than a log axis of one decade.
  const item = scatterView(narrow, 0, 1)!;
  assert.equal(item.x_log, undefined);
  assert.equal(item.y_log, undefined);
  assert.deepEqual(
    item.points.map((p) => p.x),
    [9.6e18, 2e19, 2.3e19, 3.3e19],
  );
  assert.ok(tableViews(table(narrow)).some((view) => view.kind === 'scatter'));
  // Ten times apart or more, and past what tick labels spell out, it is a log axis.
  const wide = costs(
    ['ConvS2S [9]', '25.16', 18],
    ['MoE [32]', '26.03', 19],
    ['GNMT + RL [38]', '24.6', 19],
    ['Transformer (big)', '28.4', 19],
    ['Transformer (base)', '27.3', 20],
  );
  assert.equal(scatterView(wide, 0, 1)!.x_log, true);
  // Bars refuse such numbers however close they are: a label of twenty digits is no bar.
  assert.equal(barsView(narrow, 1), null);
});

test('bars need numbers a bar chart can show: not 200 times apart, not billions, not all the same', () => {
  const column = (...values: string[]) =>
    grid(
      [num('v')],
      values.map((v, i) => row(`r${i}`, v)),
    );
  assert.ok(barsView(column('10', '20', '30'), 0));
  assert.equal(barsView(column('1', '500'), 0), null);
  assert.equal(barsView(column('2.3e19', '3.3e18'), 0), null);
  assert.equal(barsView(column('2.3e19', '2.9e19'), 0), null, 'close together, but past a billion');
  assert.ok(barsView(column('5e8', '9e8'), 0), 'under a billion is fine');
  assert.equal(barsView(column('1e9', '1.2e9'), 0), null, 'a billion and over is not');
  assert.equal(barsView(column('7', '7', '7'), 0), null);
  assert.equal(barsView(column('5'), 0), null);
  assert.equal(barsView(grid([text('t')], [row('a', 'x'), row('b', 'y')]), 0), null);
  assert.ok(barsView(column('-2', '3', '0'), 0), 'a negative bar and a zero are fine');
});

test('a unit and a direction come from the column, and a total is not a bar', () => {
  const item = barsView(results, 1)!;
  assert.equal(item.unit, 'ms');
  assert.equal(item.higher_is_better, false);
  assert.equal(item.title, 'Latency (ms)');
  const g = grid([num('N')], [row('Strong', '1'), row('Weak', '9'), row('Total', '10')]);
  assert.deepEqual(
    barsView(g, 0)!.bars.map((b) => b.label),
    ['Strong', 'Weak'],
  );
});

// ------------------------------------------------------------------------------------------------------ changes

test('changes from the base row are bars of row minus base, to the printed places, the biggest six in table order', () => {
  const item = changesView(ablation, 5)!;
  assert.equal(item.title, 'Change in BLEU (dev) from base');
  assert.equal(item.higher_is_better, true);
  assert.deepEqual(item.bars, [
    { label: 'h=1 d_k=512', value: -0.9 },
    { label: 'd_k=16', value: -0.7 },
    { label: 'N=2', value: -2.1 },
    { label: 'N=4', value: -0.5 },
    { label: 'P_drop=0.0', value: -1.2 },
    { label: 'big', value: 0.6 },
  ]);
  const ppl = changesView(ablation, 4)!;
  assert.deepEqual(
    ppl.bars.map((b) => b.value),
    [0.37, 0.24, 1.19, 0.27, 0.85, -0.59],
  );
  assert.equal(ppl.higher_is_better, false);
});

test('changes need a base row and a column with a value in it', () => {
  assert.equal(changesView(results, 0), null, 'no base row');
  assert.ok(changesView(results, 0, 0), 'a base row can be named');
  assert.equal(changesView(results, 2, 2), null, 'the base row has no value in that column');
  const same = grid([num('v')], [row('base', '5'), row('a', '5'), row('b', '5')]);
  assert.equal(changesView(same, 0), null, 'nothing changes');
});

test('a row without a label is named by what it changes, or by its note', () => {
  const g = grid(
    [num('N'), num('P'), num('Q'), num('Score')],
    [
      row('base', '6', '1', '2', '25.8'),
      row('(C)', '2', '', '', '23.7'),
      row('(D)', '', '0', '', '24.6'),
      row('(F)', '', '', '7', '25.0'),
      { ...row('(E)', '', '', '', '27.7'), note: 'learned positions' },
    ],
  );
  assert.deepEqual(
    changesView(g, 3)!.bars.map((b) => b.label),
    ['N=2', 'P=0', 'Q=7', 'learned positions'],
  );
});

// ------------------------------------------------------------------------------------------------------- views

test('every view a table offers passes the board checks against the table’s own text', () => {
  for (const g of [results, ablation, scores]) {
    const t = table(g);
    const views = tableViews(t);
    assert.ok(views.length > 0);
    const evidence = tableText(t);
    for (const view of views) {
      const checked = checkBoard(view.kind, view.item, evidence);
      assert.deepEqual(checked.problems, [], viewText(view));
      assert.ok(checked.item, viewText(view));
      assert.deepEqual(groundedProblems(checked.item!, { results: true }), [], viewText(view));
    }
  }
  assert.deepEqual(tableViews(table()), []);
});

test('a results table offers a trade-off scatter, a grid of comparable scores a heatmap, an ablation changes', () => {
  assert.deepEqual(
    tableViews(table(results)).map((v) => v.kind),
    ['scatter', 'bars', 'bars'],
  );
  assert.ok(tableViews(table(scores)).some((v) => v.kind === 'heatmap'));
  const ablate = tableViews(table(ablation));
  assert.ok(ablate.some((v) => v.what.startsWith('Change in BLEU (dev) from base')));
  assert.ok(ablate.some((v) => v.kind === 'scatter' && v.what === 'BLEU (dev) against PPL (dev)'));
  assert.ok(!tableViews(table(scores)).some((v) => v.kind === 'scatter'), 'two scores have no direction to trade');
});

test('a changed number in a view is no longer printed in the table’s text', () => {
  const t = table(results);
  const view = tableViews(t).find((v) => v.kind === 'scatter')!;
  const wrong = JSON.parse(JSON.stringify(view.item));
  wrong.points[0].y = 99.9;
  assert.match(checkBoard('scatter', wrong, tableText(t)).problems.join(' '), /not printed in the evidence/);
});

test('views of one kind come in the order the plan’s description of the data matches them', () => {
  const views = tableViews(table(ablation)).filter((v) => v.kind === 'bars');
  assert.match(views[0].what, /^Change in PPL/);
  const ordered = viewsFor(views, 'bars', 'the BLEU score of each variant against the base');
  assert.match(ordered[0].what, /BLEU/);
  assert.deepEqual(viewsFor(views, 'heatmap', 'anything'), []);
  // two datasets tell apart by their short names
  const datasets = grid(
    [
      num('BLEU EN-DE', { better: 'up' }),
      num('Cost EN-DE', { better: 'down' }),
      num('BLEU EN-FR', { better: 'up' }),
      num('Cost EN-FR', { better: 'down' }),
    ],
    [row('a', '1', '9', '5', '4'), row('b', '2', '8', '6', '3'), row('c', '3', '7', '8', '2')],
  );
  const pairs = tableViews(table(datasets)).filter((v) => v.kind === 'scatter');
  assert.equal(pairs.length, 2);
  assert.deepEqual(viewsFor(pairs, 'scatter', 'quality against cost on EN-FR')[0].columns, [
    'BLEU EN-FR',
    'Cost EN-FR',
  ]);
  assert.deepEqual(viewsFor(pairs, 'scatter', 'quality against cost on EN-DE')[0].columns, [
    'BLEU EN-DE',
    'Cost EN-DE',
  ]);
  assert.match(viewText(views[0]), /^- bars, Change in PPL \(dev\) from base: \{"kind":"bars"/);
});
