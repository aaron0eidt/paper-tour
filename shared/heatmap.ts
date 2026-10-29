import { evaluateExpression, parseExpression } from './plot';

/** A grid of values with labelled rows and columns: attention-like weights, masks, similarities, a formula over two indices. */
export interface HeatmapItem {
  kind: 'heatmap';
  title?: string;
  rows: string[];
  cols: string[];
  /** rows x cols. Always present on a checked item: computed from `expression` when there is one. */
  values: number[][];
  /** Safe expression (shared/plot.ts grammar): x is the column number, a the row number, both counting from 1. */
  expression?: string;
  source: 'document' | 'illustrative' | 'formula';
  /** Diverging centres the colours on zero, for signed values. */
  scale?: 'sequential' | 'diverging';
  /** The values are raw scores; the board shows how a row-wise softmax turns each row into weights that sum to one. */
  normalize?: 'rows';
  /** Square grids only: cells above the diagonal are masked, so a row sees only the columns up to its own number. */
  mask?: 'upper';
  /** Links: columns as a top row of tokens, rows as a bottom row, curves from the focused row weighted by its values. */
  view?: 'grid' | 'links';
  unit?: string;
}

export const HEATMAP_LIMITS = {
  title: 60,
  labels: [2, 10],
  label: 16,
  unit: 12,
  value: 1e6,
  linkColumns: 8,
} as const;
export const HEATMAP_SOURCES = ['document', 'illustrative', 'formula'] as const;
export const HEATMAP_SCALES = ['sequential', 'diverging'] as const;
export const HEATMAP_VIEWS = ['grid', 'links'] as const;

const labels = (description: string) => ({
  type: 'array',
  minItems: HEATMAP_LIMITS.labels[0],
  maxItems: HEATMAP_LIMITS.labels[1],
  items: { type: 'string', minLength: 1, maxLength: HEATMAP_LIMITS.label },
  description,
});
export const HEATMAP_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'rows', 'cols', 'source'],
  properties: {
    kind: { type: 'string', enum: ['heatmap'] },
    title: { type: 'string', maxLength: HEATMAP_LIMITS.title, description: 'What the grid shows, at most 6 words.' },
    rows: labels('2-10 distinct row labels, at most 16 characters each, such as the items that look at the others.'),
    cols: labels('2-10 distinct column labels, at most 16 characters each, such as the items that are looked at.'),
    values: {
      type: 'array',
      minItems: HEATMAP_LIMITS.labels[0],
      maxItems: HEATMAP_LIMITS.labels[1],
      items: {
        type: 'array',
        minItems: HEATMAP_LIMITS.labels[0],
        maxItems: HEATMAP_LIMITS.labels[1],
        items: { type: 'number', minimum: -HEATMAP_LIMITS.value, maximum: HEATMAP_LIMITS.value },
      },
      description:
        'One row of numbers per row label, one number per column label. Required unless source is formula; copied exactly as printed for source document.',
    },
    expression: {
      type: 'string',
      minLength: 1,
      maxLength: 200,
      description:
        'Only for source formula: a safe expression where x is the column number and a the row number, both from 1, such as sin(x/a). The values are computed from it.',
    },
    source: {
      type: 'string',
      enum: [...HEATMAP_SOURCES],
      description:
        'document: numbers printed in the paper. illustrative: invented example values. formula: from expression.',
    },
    scale: {
      type: 'string',
      enum: [...HEATMAP_SCALES],
      description: 'diverging centres the colours on zero, for signed values.',
    },
    normalize: {
      type: 'string',
      enum: ['rows'],
      description:
        'rows: the values are raw scores and the board shows a softmax turning each row into weights summing to one.',
    },
    mask: {
      type: 'string',
      enum: ['upper'],
      description:
        'upper: square grids only; cells above the diagonal are masked, so a row sees only columns up to its own number.',
    },
    view: {
      type: 'string',
      enum: [...HEATMAP_VIEWS],
      description: 'links: curves from the focused row to every column, weighted by its values; at most 8 columns.',
    },
    unit: { type: 'string', maxLength: HEATMAP_LIMITS.unit, description: 'What a value measures, such as % or score.' },
  },
};

const isRaw = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const clean = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= HEATMAP_LIMITS.value;
const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
const EXPRESSION_HELP =
  'use x (column number), a (row number), numbers, pi, e, + - * / ^, parentheses and sin, cos, tanh, exp, log, sqrt, abs, relu, sigmoid, min, max';

/** Whether the mask hides the cell at this row and column (both counted from 0). */
export const heatmapMasked = (mask: HeatmapItem['mask'], row: number, col: number) => mask === 'upper' && col > row;

function compile(expression: string) {
  try {
    return parseExpression(expression);
  } catch (error) {
    throw new Error(`${(error as Error).message.replace(/\.$/, '')}; ${EXPRESSION_HELP}`);
  }
}

/**
 * The grid an expression draws: x is the column number and a the row number, both from 1. Throws with the reason, in
 * words for the model, when the expression is invalid or a cell is not a finite value within the limits.
 */
export function evaluateHeatmap(expression: string, rows: number, cols: number): number[][] {
  const tree = compile(expression);
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => {
      const value = evaluateExpression(tree, c + 1, r + 1);
      if (!Number.isFinite(value))
        throw new Error(
          `it is not a finite number at column ${c + 1}, row ${r + 1} (x=${c + 1}, a=${r + 1}); avoid dividing by zero and the log or root of a value that is not allowed`,
        );
      if (Math.abs(value) > HEATMAP_LIMITS.value)
        throw new Error(
          `it gives ${value} at column ${c + 1}, row ${r + 1}; keep every value within ±${HEATMAP_LIMITS.value}`,
        );
      return value;
    }),
  );
}

/** Row-wise softmax, stable for large scores: every row becomes weights that sum to one. Masked cells weigh zero. */
export function rowSoftmax(values: number[][], mask?: HeatmapItem['mask']): number[][] {
  return values.map((row, r) => {
    const live = row.map((_, c) => !heatmapMasked(mask, r, c));
    const top = Math.max(...row.filter((_, c) => live[c]));
    const weights = row.map((value, c) => (live[c] ? Math.exp(value - top) : 0));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return weights.map((weight) => (total > 0 ? weight / total : 0));
  });
}

function labelProblems(name: string, value: unknown): string[] {
  const [fewest, most] = HEATMAP_LIMITS.labels;
  if (!Array.isArray(value)) return [`${name}: give a list of ${fewest} to ${most} labels`];
  if (value.length < fewest || value.length > most)
    return [`${name}: give ${fewest} to ${most} labels, not ${value.length}`];
  const problems: string[] = [];
  const seen = new Set<string>();
  value.forEach((entry, i) => {
    const label = clean(entry);
    if (!label) problems.push(`${name}: label ${i + 1} is empty`);
    else if (label.length > HEATMAP_LIMITS.label)
      problems.push(`${name}: the label "${label}" is longer than ${HEATMAP_LIMITS.label} characters; shorten it`);
    else if (seen.has(label)) problems.push(`${name}: the label "${label}" is used twice`);
    seen.add(label);
  });
  return problems;
}

/** The first reason `values` is not a rows x cols grid of bounded numbers, or null. */
function gridProblem(values: unknown, rows: number, cols: number): string | null {
  if (!Array.isArray(values) || values.length !== rows)
    return `values: give ${rows} rows of numbers, one per row label, not ${count(values)}`;
  for (const [r, row] of values.entries()) {
    if (!Array.isArray(row) || row.length !== cols)
      return `values: row ${r + 1} needs ${cols} numbers, one per column label, not ${count(row)}`;
    const bad = row.findIndex((value) => !finite(value));
    if (bad >= 0)
      return `values: row ${r + 1}, column ${bad + 1} must be a number between -${HEATMAP_LIMITS.value} and ${HEATMAP_LIMITS.value}`;
  }
  return null;
}

/** Reasons a heatmap cannot be drawn, each worded as an instruction to the model; empty when it can. */
export function heatmapProblems(raw: unknown): string[] {
  if (!isRaw(raw)) return ['Heatmap must be an object.'];
  const problems: string[] = [];
  if (raw.kind !== 'heatmap') problems.push('Unknown heatmap kind.');
  if (raw.title !== undefined && (typeof raw.title !== 'string' || clean(raw.title).length > HEATMAP_LIMITS.title))
    problems.push(`title: use at most ${HEATMAP_LIMITS.title} characters`);
  const rowProblems = labelProblems('rows', raw.rows);
  const colProblems = labelProblems('cols', raw.cols);
  problems.push(...rowProblems, ...colProblems);
  const [rows, cols] = [count(raw.rows), count(raw.cols)];
  const sized = !rowProblems.length && !colProblems.length;
  const source = (HEATMAP_SOURCES as readonly unknown[]).includes(raw.source) ? raw.source : undefined;
  if (!source) problems.push(`source: use ${HEATMAP_SOURCES.join(', ')}`);
  if (raw.scale !== undefined && !(HEATMAP_SCALES as readonly unknown[]).includes(raw.scale))
    problems.push(`scale: use ${HEATMAP_SCALES.join(' or ')}`);
  if (raw.view !== undefined && !(HEATMAP_VIEWS as readonly unknown[]).includes(raw.view))
    problems.push(`view: use ${HEATMAP_VIEWS.join(' or ')}`);
  if (raw.normalize !== undefined && raw.normalize !== 'rows') problems.push('normalize: the only choice is rows');
  if (raw.mask !== undefined && raw.mask !== 'upper') problems.push('mask: the only choice is upper');
  if (raw.unit !== undefined && (typeof raw.unit !== 'string' || clean(raw.unit).length > HEATMAP_LIMITS.unit))
    problems.push(`unit: use at most ${HEATMAP_LIMITS.unit} characters`);
  if (raw.mask === 'upper' && rows !== cols)
    problems.push(`mask: upper needs a square grid with as many rows as columns, not ${rows} rows and ${cols} columns`);
  if (raw.view === 'links' && cols > HEATMAP_LIMITS.linkColumns)
    problems.push(
      `view: links needs at most ${HEATMAP_LIMITS.linkColumns} columns, not ${cols}; use grid or fewer columns`,
    );

  // The grid: computed from the expression of a formula, otherwise the values as given.
  let grid: number[][] | null = null;
  if (source === 'formula' && raw.expression === undefined)
    problems.push('expression: source formula needs an expression of x (the column number) and a (the row number)');
  else if (source && source !== 'formula' && raw.expression !== undefined)
    problems.push('expression: only source formula takes an expression; give values instead, or set source to formula');
  if (raw.expression !== undefined) {
    if (typeof raw.expression !== 'string') problems.push('expression: give it as text');
    else if (sized)
      try {
        grid = evaluateHeatmap(raw.expression, rows, cols);
      } catch (error) {
        problems.push(`expression: ${(error as Error).message}`);
      }
  } else if (source && source !== 'formula' && sized) {
    const problem = gridProblem(raw.values, rows, cols);
    if (problem) problems.push(problem);
    else grid = raw.values as number[][];
  }

  if (grid) {
    const mask = raw.mask === 'upper' ? 'upper' : undefined;
    const shown = grid.map((row, r) => row.filter((_, c) => !heatmapMasked(mask, r, c)));
    if (new Set(shown.flat()).size < 2)
      problems.push('values: every visible cell is the same, so the grid shows nothing; use values that differ');
    else if (raw.normalize === 'rows' && shown.every((row) => new Set(row).size < 2))
      problems.push(
        'normalize: every row holds equal scores, so softmax would give each cell the same weight; use scores that differ within a row, or drop normalize',
      );
  }
  return problems;
}

/** The clean item: trimmed text, values computed from the expression, unused options dropped. Call it once heatmapProblems is empty. */
export function canonicalHeatmap(raw: unknown): HeatmapItem {
  const item = raw as Record<string, unknown>;
  const rows = (item.rows as unknown[]).map(clean);
  const cols = (item.cols as unknown[]).map(clean);
  const expression = typeof item.expression === 'string' ? item.expression.trim() : '';
  const title = clean(item.title);
  const unit = clean(item.unit);
  return {
    kind: 'heatmap',
    ...(title ? { title } : {}),
    rows,
    cols,
    values: expression
      ? evaluateHeatmap(expression, rows.length, cols.length)
      : (item.values as number[][]).map((row) => [...row]),
    ...(expression ? { expression } : {}),
    source: item.source as HeatmapItem['source'],
    ...(item.scale ? { scale: item.scale as HeatmapItem['scale'] } : {}),
    ...(item.normalize ? { normalize: 'rows' as const } : {}),
    ...(item.mask ? { mask: 'upper' as const } : {}),
    ...(item.view ? { view: item.view as HeatmapItem['view'] } : {}),
    ...(unit ? { unit } : {}),
  };
}
