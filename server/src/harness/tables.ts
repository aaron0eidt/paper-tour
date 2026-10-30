import type { Doc, DocFigure, DocTableColumn, DocTableGrid } from '../../../shared/paper';
import { canonicalHeatmap, heatmapProblems, HEATMAP_LIMITS, type HeatmapItem } from '../../../shared/heatmap';
import { canonicalScatter, scatterProblems, SCATTER_LIMITS, type ScatterItem } from '../../../shared/scatter';
import { tableLines } from '../../../shared/tableTargets';
import { BOARD_LIMITS, checkBoard, numbersIn, type BarsItem } from './board';
import { groundedProblems } from './visual-rules';

// A table the ingest could read (doc.json figures[].grid) as the harness uses it: the numbers it prints, a compact
// text for the model, and views built by code (a scatter of two columns, a heatmap of a numeric block, bars of one
// column, changes from a base row). Every value in a view is a cell of the grid, or for changes a difference of two
// cells, and a view passes the same board checks as a model's board, so a number on the board is a number of the
// document. All functions are pure.

export type TableViewKind = 'scatter' | 'heatmap' | 'bars';
/** A board the table can fill by itself, with a line saying what it shows and the columns it uses. */
export interface TableView {
  kind: TableViewKind;
  /** "scatter of BLEU against cost": what the board shows, for the brief. */
  what: string;
  /** The names of the columns whose numbers it uses. */
  columns: string[];
  item: ScatterItem | HeatmapItem | BarsItem;
}

type Grid = DocTableGrid;
type Cols = number[];

/** The grid of a table figure, when the ingest could read one. */
export const gridOf = (table: DocFigure | undefined): Grid | undefined =>
  table?.kind === 'table' ? table.grid : undefined;

/** Every number the grid prints: each cell's value and the numbers in its text (a range prints both ends). */
export function gridNumbers(grid: Grid): number[] {
  const out = new Set<number>();
  for (const row of grid.rows)
    for (const cell of row.cells) {
      if (cell.value !== undefined) out.add(cell.value);
      for (const n of numbersIn(cell.text)) out.add(n);
    }
  return [...out];
}

/** The numbers a table prints: its grid's, or for a table without one the numbers of its extracted text lines. */
export function printedNumbers(doc: Doc, table: DocFigure): number[] {
  const grid = gridOf(table);
  return grid ? gridNumbers(grid) : numbersIn(tableLines(doc, table).join('\n'));
}

/** Decimals and larger numbers, but not years: "28.4 BLEU" is a distinctive number, "Table 2" or "2017" is not. */
export const distinctive = (numbers: number[]) =>
  numbers.filter((n) => !Number.isInteger(n) || (n >= 100 && !(n >= 1900 && n <= 2100)));

/** The table a result rests on: one its evidence cites, else the one that repeats most of its distinctive numbers. */
export function resultTable(doc: Doc, evidence: string[], text: string): DocFigure | undefined {
  const tables = doc.figures.filter((f) => f.kind === 'table');
  const cited = tables.find((t) => t.referenced_by.some((id) => evidence.includes(id)));
  if (cited) return cited;
  const named = distinctive(numbersIn(text));
  let best: DocFigure | undefined,
    bestScore = 0;
  for (const table of tables) {
    const printed = printedNumbers(doc, table);
    const score = new Set(named.filter((n) => printed.includes(n))).size;
    if (score > bestScore) [best, bestScore] = [table, score];
  }
  return best;
}

// ------------------------------------------------------------------------------------------------- reading

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();
/** Citation markers such as [18] or [3, 7], which table rows carry but labels do not need. */
const CITATION = /\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g;
const wordsOf = (text: string) => text.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w));

/**
 * The text cut to at most `chars` characters and `words` words, keeping whole words: citations and parentheses go
 * first, then words from the far end (`from` start keeps the end of the text, which often tells similar names apart).
 */
function shorten(text: string, chars: number, words: number, from: 'start' | 'end' = 'end'): string {
  let t = clean(text.replace(CITATION, ''));
  const fits = (s: string) => s.length <= chars && wordsOf(s).length <= words;
  if (fits(t)) return t;
  t = clean(t.replace(/\s*(?:\([^)]*\)|\[[^\]]*\])/g, '')) || t;
  const list = t.split(' ');
  while (list.length > 1 && !fits(list.join(' '))) from === 'end' ? list.pop() : list.shift();
  t = list.join(' ').replace(/^[\s,;:+&/-]+|[\s,;:+&/-]+$/g, '');
  return t.length <= chars ? t : `${t.slice(0, chars - 1).trimEnd()}…`;
}

/**
 * Distinct short labels for a list of texts: cut from the end; a cut that is also the start of another name of the
 * table (`others`: "Wide network" for "Wide network small" and "Wide network large") is cut from the start instead, and what still collides is numbered
 * ("#2", not "(2)", which reads as a year).
 */
function distinctLabels(texts: string[], chars: number, words: number, others: string[] = texts): string[] {
  const whole = (text: string) => clean(text.replace(CITATION, ''));
  const base = texts.map((text) => {
    const label = shorten(text, chars, words);
    const ambiguous = label !== whole(text) && others.some((other) => other !== text && whole(other).startsWith(label));
    return ambiguous ? shorten(text, chars, words, 'start') : label;
  });
  const seen = new Map<string, number>();
  return base.map((label) => {
    if (label && base.filter((l) => l === label).length === 1) return label;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return `${shorten(label || 'Row', chars - 3, Math.max(1, words - 1))} #${n}`;
  });
}

const isNumber = (grid: Grid, c: number) => grid.columns[c].kind === 'number';
const valueAt = (grid: Grid, r: number, c: number): number | undefined => grid.rows[r].cells[c]?.value;
const filled = (grid: Grid, c: number) => grid.rows.filter((row) => row.cells[c]?.text.trim()).length;
const numericColumns = (grid: Grid): Cols => grid.columns.flatMap((_, c) => (isNumber(grid, c) ? [c] : []));
/** A row that sums up the others (Total, Mean ± SD): it is not one more item to compare. */
const SUMMARY = /^(?:grand total|subtotal|total|sum|mean|average|avg|overall|median)\b/i;
const isSummary = (grid: Grid, r: number) => SUMMARY.test(clean(grid.rows[r].label));
/** The rows that have a number in every one of the columns, without the rows that sum up the others. */
const rowsWith = (grid: Grid, cols: Cols) =>
  grid.rows.flatMap((_, r) => (!isSummary(grid, r) && cols.every((c) => valueAt(grid, r, c) !== undefined) ? [r] : []));

/** `count` of `total` positions spread evenly, always the first and the last. */
function evenly(total: number, count: number): number[] {
  if (total <= count || count < 2) return Array.from({ length: Math.min(total, count) }, (_, i) => i);
  return [...new Set(Array.from({ length: count }, (_, i) => Math.round((i * (total - 1)) / (count - 1))))];
}

/**
 * `count` of the rows, in table order: always the last row (a paper's own method is usually listed last) and the best
 * one when `best` is given, the rest spread evenly.
 */
function pickRows(rows: number[], count: number, best?: number): number[] {
  if (rows.length <= count) return rows;
  const must = new Set([rows[rows.length - 1], ...(best === undefined ? [] : [best])]);
  const rest = rows.filter((r) => !must.has(r));
  const spread = new Set(evenly(rest.length, count - must.size).map((i) => rest[i]));
  return rows.filter((r) => must.has(r) || spread.has(r));
}

// Words that say which way a measure is better. Only names that mean it everywhere: a column the paper marks itself
// (an arrow, "higher is better") needs no list. A direction is shown on a board as a shaded corner or an arrow, so a
// name that is not on the list gets none.
const HIGHER = /\b(bleu|accuracy|acc|f1|precision|recall|auc|rouge|mrr|ndcg|iou)\b/i;
const LOWER = /\b(error|loss|perplexity|ppl|wer|cer|latency|flops?|cost|mse|rmse|mae)\b/i;

/** Which way a column is better: what its header says, else what the name of a well-known measure says. */
export function betterWay(column: DocTableColumn): 'up' | 'down' | undefined {
  if (column.better) return column.better;
  const name = column.name.replace(/_/g, ' ');
  return LOWER.test(name) ? 'down' : HIGHER.test(name) ? 'up' : undefined;
}

/** "Latency (ms)" or, when the unit is not in the name already, "BLEU (%)". */
function withUnit(column: DocTableColumn): string {
  const name = clean(column.name);
  return column.unit && !name.includes(column.unit) ? `${name} (${column.unit})` : name;
}

/** The columns whose cells are filled in under half of the rows: the settings an ablation row changes. */
const settingColumns = (grid: Grid, except: Cols): Cols =>
  grid.columns.flatMap((_, c) => {
    const n = filled(grid, c);
    return !except.includes(c) && n > 0 && n < grid.rows.length / 2 ? [c] : [];
  });

/**
 * What names a row on a board: its label; for a row named by a mark like "(E)" its note; for a row without a label
 * the settings it fills ("h=1, d_k=512"); else its group.
 */
function rowName(grid: Grid, r: number, settings: Cols): string {
  const row = grid.rows[r];
  const label = clean(row.label.replace(CITATION, ''));
  if (label && !/^\(?[A-Za-z0-9]{1,2}\)?$/.test(label)) return label;
  if (row.note) return clean(row.note);
  const set = settings.flatMap((c) =>
    row.cells[c]?.text.trim() ? [`${grid.columns[c].name}=${row.cells[c].text.trim()}`] : [],
  );
  if (set.length) return set.join(' ');
  return label || row.group || `Row ${r + 1}`;
}

/** The names of all rows, to tell a cut label that stays unique from one that would fit two rows. */
const allNames = (grid: Grid, settings: Cols) => grid.rows.map((_, r) => rowName(grid, r, settings));

// ------------------------------------------------------------------------------------------------- text

/** The text of one row: its group and label, then its cells, with "-" for a blank one. */
function rowText(grid: Grid, r: number): string {
  const row = grid.rows[r];
  const name = [row.group, row.label].filter(Boolean).join(' ') || `row ${r + 1}`;
  const cells = row.cells.map((cell) => clean(cell.text) || '-');
  return `${[name, ...cells].join(' | ')}${row.note ? `  [${row.note}]` : ''}`;
}

/** The header of the grid with each column's direction when it has one. */
function headerText(grid: Grid): string {
  const names = grid.columns.map((col) => {
    const better = col.better;
    return better ? `${col.name} (${better === 'up' ? 'higher' : 'lower'} is better)` : col.name;
  });
  return [grid.label_header || 'Row', ...names].join(' | ');
}

/**
 * The base row of an ablation or a comparison against a reference: the row named base, baseline, default or the
 * like, else the one row that fills every number column while the others fill under 75% of them.
 */
export function baseRow(grid: Grid): number | undefined {
  const named = grid.rows.findIndex((row) =>
    /^\(?(?:base(?:line)?|default|reference|control|original|vanilla)\b/i.test(clean(`${row.label} ${row.note ?? ''}`)),
  );
  if (named >= 0) return named;
  const cols = numericColumns(grid);
  if (grid.rows.length < 4 || cols.length < 2) return undefined;
  const share = grid.rows.map((_, r) => cols.filter((c) => valueAt(grid, r, c) !== undefined).length / cols.length);
  const full = share.flatMap((s, r) => (s === 1 ? [r] : []));
  return full.length === 1 && share.filter((s) => s < 0.75).length >= grid.rows.length - 2 ? full[0] : undefined;
}

/** The name of the table's base row, when it has one. */
export function baseRowName(table: DocFigure): string | undefined {
  const grid = gridOf(table);
  const base = grid ? baseRow(grid) : undefined;
  return grid && base !== undefined ? rowName(grid, base, settingColumns(grid, measureColumns(grid))) : undefined;
}

/** Number columns filled in most rows (the measures; the settings of an ablation are filled in few). */
const measureColumns = (grid: Grid): Cols =>
  numericColumns(grid).filter((c) => filled(grid, c) >= 0.7 * grid.rows.length);

const decimals = (text: string) => /\.(\d+)/.exec(text)?.[1].length ?? 0;
/** The difference of two cells, rounded to the places they print (no 24.900000000000002). */
const difference = (a: number, b: number, places: number) => Number((a - b).toFixed(places));
const signed = (n: number, places: number) => `${n > 0 ? '+' : ''}${n.toFixed(places)}`;

/** The rows that differ from the base row in `col`, with the difference as printed to the places of the cells. */
function changesOf(grid: Grid, col: number, base: number): { row: number; change: number; text: string }[] {
  const reference = valueAt(grid, base, col);
  if (reference === undefined) return [];
  return grid.rows.flatMap((row, r) => {
    const value = valueAt(grid, r, col);
    if (r === base || value === undefined || isSummary(grid, r)) return [];
    const places = Math.max(decimals(row.cells[col].text), decimals(grid.rows[base].cells[col].text));
    const change = difference(value, reference, places);
    return [{ row: r, change, text: signed(change, places) }];
  });
}

/**
 * The table as compact text for the model: a header line, then one line per row, cells as printed and "-" for a blank
 * one. With a base row it ends with each measure's change from that row, computed here, so those numbers are printed
 * too. `maxRows` cuts a long table (the rest is counted), and `changes` is false for a short overview.
 */
export function tableText(table: DocFigure, { maxRows = 80, changes = true } = {}): string {
  const grid = gridOf(table);
  if (!grid) return '';
  const shown = grid.rows.length > maxRows ? evenly(grid.rows.length, maxRows) : grid.rows.map((_, r) => r);
  const lines = [
    `TABLE ${table.number} [${table.id}], page ${table.page}: ${grid.rows.length} rows and ${grid.columns.length + 1} columns` +
      (grid.confidence === 'medium' ? ', read with some inference from the layout' : ''),
    headerText(grid),
    ...shown.map((r) => rowText(grid, r)),
  ];
  if (shown.length < grid.rows.length) lines.push(`(${grid.rows.length - shown.length} more rows not shown)`);
  if (grid.notes?.length) lines.push(`Notes: ${grid.notes.join(' ')}`);
  const base = changes ? baseRow(grid) : undefined;
  if (base !== undefined) {
    const settings = settingColumns(grid, measureColumns(grid));
    const name = rowName(grid, base, settings);
    const measures = measureColumns(grid).slice(0, 3);
    const parts = measures.flatMap((c) => {
      const list = changesOf(grid, c, base);
      return list.length >= 2
        ? [`${grid.columns[c].name}: ${list.map((x) => `${rowName(grid, x.row, settings)} ${x.text}`).join('; ')}`]
        : [];
    });
    if (parts.length) lines.push(`CHANGES FROM THE BASE ROW "${name}" (computed, row minus base):`, ...parts);
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------- views

const unitOf = (columns: DocTableColumn[]) => {
  const units = new Set(columns.map((col) => col.unit ?? ''));
  return units.size === 1 && [...units][0] ? [...units][0] : undefined;
};
/** How many times larger the largest value is than the smallest one that is not zero (by size, not by sign). */
const spread = (values: number[]) => {
  const sizes = values.map(Math.abs).filter(Boolean);
  return sizes.length ? Math.max(...sizes) / Math.min(...sizes) : 1;
};

/**
 * Points of two number columns: each row with both numbers, at most 10 spread over the table. A log axis when an axis
 * spans more than 30 times and stays above zero. When the two columns have opposite directions the cost goes on x and
 * the better corner is shaded; with no known direction on either, none is.
 */
export function scatterView(grid: Grid, a: number, b: number, rows?: number[]): ScatterItem | null {
  const columns = [a, b].sort((p, q) => p - q);
  const ways = columns.map((c) => betterWay(grid.columns[c]));
  // Cost left, quality up: put a column that is better when lower on x.
  const [x, y] = ways[1] === 'down' && ways[0] !== 'down' ? [columns[1], columns[0]] : [columns[0], columns[1]];
  if (!isNumber(grid, x) || !isNumber(grid, y) || x === y) return null;
  const usable = (rows ?? rowsWith(grid, [x, y])).filter(
    (r) => valueAt(grid, r, x) !== undefined && valueAt(grid, r, y) !== undefined,
  );
  const chosen = pickRows(usable, SCATTER_LIMITS.points[1]);
  if (chosen.length < SCATTER_LIMITS.points[0]) return null;
  const settings = settingColumns(grid, [x, y]);
  const labels = distinctLabels(
    chosen.map((r) => rowName(grid, r, settings)),
    SCATTER_LIMITS.pointLabel,
    6,
    allNames(grid, settings),
  );
  const points = chosen.map((r, i) => ({ label: labels[i], x: valueAt(grid, r, x)!, y: valueAt(grid, r, y)! }));
  const logOf = (axis: 'x' | 'y') => {
    const values = points.map((p) => p[axis]);
    return values.every((v) => v > 0) && spread(values) > 30;
  };
  const [wayX, wayY] = [betterWay(grid.columns[x]), betterWay(grid.columns[y])];
  const better =
    wayX && wayY
      ? (`${wayY === 'up' ? 'up' : 'down'}-${wayX === 'down' ? 'left' : 'right'}` as ScatterItem['better'])
      : undefined;
  const label = (c: number) => shorten(withUnit(grid.columns[c]), SCATTER_LIMITS.axisLabel[1], 8);
  const raw = {
    kind: 'scatter',
    title: shorten(`${grid.columns[y].name} against ${grid.columns[x].name}`, SCATTER_LIMITS.title, 8),
    x_label: label(x),
    y_label: label(y),
    ...(logOf('x') ? { x_log: true } : {}),
    ...(logOf('y') ? { y_log: true } : {}),
    ...(better ? { better } : {}),
    points,
    source: 'document',
  };
  return scatterProblems(raw).length ? null : canonicalScatter(raw);
}

/**
 * A grid of the table's numbers: the number columns that are comparable (one colour scale for all of them: typical
 * sizes within 5 times, no values 100 times apart), and the rows that fill every one of them, at most 10 by 10 and at
 * least 3 by 3 (two columns are bars).
 */
export function heatmapView(grid: Grid, title?: string): HeatmapItem | null {
  const most = HEATMAP_LIMITS.labels[1];
  const dense = measureColumns(grid).filter((c) => rowsWith(grid, [c]).length >= 3);
  const typical = (c: number) => {
    const values = rowsWith(grid, [c])
      .map((r) => Math.abs(valueAt(grid, r, c)!))
      .sort((p, q) => p - q);
    return values[Math.floor(values.length / 2)] || 1e-9;
  };
  // The largest run of columns whose typical sizes are within 5 times of each other.
  const bySize = [...dense].sort((p, q) => typical(p) - typical(q));
  let cols: Cols = [];
  for (let i = 0; i < bySize.length; i++) {
    const group = bySize.filter((c) => typical(c) >= typical(bySize[i]) && typical(c) <= 5 * typical(bySize[i]));
    if (group.length > cols.length) cols = group;
  }
  cols = cols.sort((p, q) => p - q).slice(0, most);
  const rows = rowsWith(grid, cols);
  if (cols.length < 3 || rows.length < 3) return null;
  const chosen = pickRows(rows, most);
  const settings = settingColumns(grid, cols);
  const rowLabels = distinctLabels(
    chosen.map((r) => rowName(grid, r, settings)),
    HEATMAP_LIMITS.label,
    4,
    allNames(grid, settings),
  );
  const colLabels = distinctLabels(
    cols.map((c) => grid.columns[c].name),
    HEATMAP_LIMITS.label,
    3,
  );
  const values = chosen.map((r) => cols.map((c) => valueAt(grid, r, c)!));
  if (spread(values.flat()) > 100) return null; // one colour scale cannot show numbers 100 times apart
  const unit = unitOf(cols.map((c) => grid.columns[c]));
  const raw = {
    kind: 'heatmap',
    ...(title ? { title: shorten(title, HEATMAP_LIMITS.title, 8) } : {}),
    rows: rowLabels,
    cols: colLabels,
    values,
    source: 'document',
    ...(values.flat().some((v) => v < 0) && values.flat().some((v) => v > 0) ? { scale: 'diverging' } : {}),
    ...(unit && unit.length <= HEATMAP_LIMITS.unit ? { unit } : {}),
  };
  return heatmapProblems(raw).length ? null : canonicalHeatmap(raw);
}

/**
 * Bars need real differences between their values, sizes that can share a scale (over 200 times apart, only the largest
 * shows) and numbers a label can print (a count of operations in the 10^19 is for a log axis).
 */
const barsReadable = (values: number[]) =>
  new Set(values).size >= 2 && spread(values) <= 200 && values.every((v) => Math.abs(v) < 1e9);

function barsOf(
  grid: Grid,
  col: number,
  picked: { row: number; value: number }[],
  title: string,
  name?: (r: number) => string,
) {
  const settings = settingColumns(grid, [col]);
  const labels = distinctLabels(
    picked.map(({ row }) => (name ? name(row) : rowName(grid, row, settings))),
    BOARD_LIMITS.barLabel,
    BOARD_LIMITS.barLabelWords,
    allNames(grid, settings),
  );
  const way = betterWay(grid.columns[col]);
  const unit = grid.columns[col].unit;
  return {
    kind: 'bars' as const,
    title: shorten(title, BOARD_LIMITS.title, 8),
    ...(unit && unit.length <= BOARD_LIMITS.unit ? { unit } : {}),
    ...(way ? { higher_is_better: way === 'up' } : {}),
    bars: picked.map(({ value }, i) => ({ label: labels[i], value })),
  };
}

/** Bars of one number column: at most 6 rows with a value, spread over the table. */
export function barsView(grid: Grid, col: number): BarsItem | null {
  if (!isNumber(grid, col)) return null;
  const rows = rowsWith(grid, [col]);
  const way = betterWay(grid.columns[col]);
  const ranked = [...rows].sort((p, q) => valueAt(grid, p, col)! - valueAt(grid, q, col)!);
  const best = way === 'up' ? ranked.at(-1) : way === 'down' ? ranked[0] : undefined;
  const picked = pickRows(rows, BOARD_LIMITS.bars[1], best).map((row) => ({ row, value: valueAt(grid, row, col)! }));
  if (picked.length < 2 || !barsReadable(picked.map((p) => p.value))) return null;
  return barsOf(grid, col, picked, withUnit(grid.columns[col]));
}

/**
 * How far each row is from the base row in one number column, as bars: the up to 6 rows that differ most, in table
 * order, each value computed as the row minus the base row to the places the cells print. `base` defaults to the
 * table's base row.
 */
export function changesView(grid: Grid, col: number, base = baseRow(grid)): BarsItem | null {
  if (base === undefined || !isNumber(grid, col)) return null;
  const changes = changesOf(grid, col, base).filter((x) => x.change !== 0);
  if (changes.length < 2) return null;
  const biggest = [...changes].sort((p, q) => Math.abs(q.change) - Math.abs(p.change)).slice(0, BOARD_LIMITS.bars[1]);
  const picked = changes.filter((x) => biggest.includes(x)).map((x) => ({ row: x.row, value: x.change }));
  const settings = settingColumns(grid, measureColumns(grid));
  const baseName = shorten(rowName(grid, base, settings), 20, 3);
  return barsOf(grid, col, picked, `Change in ${grid.columns[col].name} from ${baseName}`, (r) =>
    rowName(grid, r, settings),
  );
}

/**
 * The best pair of measures for a scatter: at least one has a known direction (a scatter shows quality against cost,
 * not any two columns), a trade-off (opposite directions) on the same dataset first, the same measure on two datasets
 * last. Only a real trade-off gets a second pair.
 */
function scatterPairs(grid: Grid): [number, number][] {
  const cols = measureColumns(grid);
  const stem = (c: number) => grid.columns[c].name.split(/[\s_]/)[0].toLowerCase();
  const tail = (c: number) => grid.columns[c].name.split(' ').at(-1)!.toLowerCase();
  const pairs = cols.flatMap((a, i) => cols.slice(i + 1).map((b): [number, number] => [a, b]));
  const score = ([a, b]: [number, number]) => {
    const [p, q] = [betterWay(grid.columns[a]), betterWay(grid.columns[b])];
    return (p && q && p !== q ? 4 : p || q ? 2 : 0) + (tail(a) === tail(b) ? 1 : 0) - (stem(a) === stem(b) ? 3 : 0);
  };
  const ranked = pairs
    .filter(
      ([a, b]) => rowsWith(grid, [a, b]).length >= 3 && (betterWay(grid.columns[a]) || betterWay(grid.columns[b])),
    )
    .map((pair, i) => ({ pair, i, s: score(pair) }))
    .sort((p, q) => q.s - p.s || p.i - q.i);
  return ranked
    .filter(({ s }, i) => i === 0 || s >= 4)
    .slice(0, 2)
    .map(({ pair }) => pair);
}

/** Number columns best to show as bars: those with a known direction first, then the fullest, then table order. */
function barColumns(grid: Grid): Cols {
  return numericColumns(grid)
    .map((c, i) => ({ c, i, way: betterWay(grid.columns[c]) ? 1 : 0, n: filled(grid, c) }))
    .sort((p, q) => q.way - p.way || q.n - p.n || p.i - q.i)
    .map(({ c }) => c);
}

/**
 * The views a table can fill by itself, each checked like a model's board (shape, labels, every number printed in the
 * table's text) and as the board of a step that reports results; those that fail are left out. Scatter pairs first,
 * then a heatmap, then changes from a base row and bars of single columns. A table that cannot be turned into views
 * offers none: a tour never fails over a table.
 */
export function tableViews(table: DocFigure): TableView[] {
  try {
    return buildViews(table);
  } catch {
    return [];
  }
}

function buildViews(table: DocFigure): TableView[] {
  const grid = gridOf(table);
  if (!grid) return [];
  const column = (c: number) => grid.columns[c].name;
  const found: TableView[] = [];
  for (const [a, b] of scatterPairs(grid)) {
    const item = scatterView(grid, a, b);
    if (item)
      found.push({
        kind: 'scatter',
        what: `${item.y_label} against ${item.x_label}`,
        columns: [column(a), column(b)],
        item,
      });
  }
  const heatmap = heatmapView(grid, `Table ${table.number}`);
  if (heatmap)
    found.push({
      kind: 'heatmap',
      what: `a grid of ${heatmap.cols.join(', ')} for ${heatmap.rows.length} rows`,
      columns: heatmap.cols,
      item: heatmap,
    });
  const measures = measureColumns(grid);
  const changes = measures
    .map((c) => ({ c, item: changesView(grid, c) }))
    .filter((x): x is { c: number; item: BarsItem } => !!x.item)
    .slice(0, 2);
  for (const { c, item } of changes) found.push({ kind: 'bars', what: `${item.title}`, columns: [column(c)], item });
  for (const c of barColumns(grid).slice(0, 2)) {
    const item = barsView(grid, c);
    if (item) found.push({ kind: 'bars', what: `bars of ${item.title}`, columns: [column(c)], item });
  }
  const text = tableText(table);
  return found.filter(({ kind, item }) => {
    const checked = checkBoard(kind, item, text);
    return !!checked.item && !groundedProblems(checked.item, { results: true }).length;
  });
}

/** The words of a text of two letters or more, lower case ("de" and "fr" tell two datasets apart). */
const tokens = (text: string) => new Set(text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []);

/**
 * The views of one kind, those that match a description best first: a view's score is how many words of its columns
 * the description names (the visual plan says which columns it uses).
 */
export function viewsFor(views: TableView[], kind: TableViewKind, description: string): TableView[] {
  const named = tokens(description);
  const score = (view: TableView) => [...tokens(view.columns.join(' '))].filter((word) => named.has(word)).length;
  return views
    .filter((view) => view.kind === kind)
    .map((view, i) => ({ view, i, s: score(view) }))
    .sort((p, q) => q.s - p.s || p.i - q.i)
    .map(({ view }) => view);
}

/** A view as the brief shows it: one line saying what it is, then its board as compact JSON. */
export const viewText = (view: TableView): string => `- ${view.kind}, ${view.what}: ${JSON.stringify(view.item)}`;
