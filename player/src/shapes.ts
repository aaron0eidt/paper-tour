// The shapes board: how long each dimension is drawn, where the matrices and operators go (in one row, or wrapped into
// several on a narrow board), which dimensions a product contracts, and the build timeline. Pure, so it can be tested;
// rendering is in components/ShapesBoard.tsx.

import { shapesRunning } from '../../shared/shapes';
import type { MatrixShape, ShapesItem, ShapesOpTerm } from '../../shared/shapes';
import type { Measure } from './board';
import type { Color } from './types';

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

// ---------------------------------------------------------------- dimensions

// A dimension is drawn as a share of the board's unit length: a vector's 1 is thin, every other dimension falls
// between LOW and HIGH, and two different dimensions differ by at least MIN_GAP, so unequal sizes never look equal.
const THIN = 0.16;
const LOW = 0.46;
const HIGH = 1;
const MIN_GAP = 0.08;
// Symbols have no size of their own, so they take these lengths in order of first appearance.
const SYMBOL_LENGTHS = [1, 0.62, 0.82, 0.5, 0.92, 0.7];

const isNumber = (dim: string) => /^\d+(\.\d+)?$/.test(dim);

/**
 * The drawn length of each distinct dimension, as a share of the unit. One symbol has one length wherever it appears
 * (so Q's n equals the n of the result), numbers keep their order (on a log scale, so 64 against 512 stays readable),
 * and nothing is tiny or huge.
 */
export function dimensionLengths(shapes: MatrixShape[]): Map<string, number> {
  const dims: string[] = [];
  for (const shape of shapes)
    for (const dim of [shape.rows, shape.cols]) if (dim !== '1' && !dims.includes(dim)) dims.push(dim);
  const numbers = dims.filter(isNumber).map((dim) => Math.log(Math.max(1, Number(dim))));
  const [lo, hi] = [Math.min(...numbers), Math.max(...numbers)];
  let symbols = 0;
  const lengths = dims.map((dim) => {
    if (!isNumber(dim)) return SYMBOL_LENGTHS[symbols++ % SYMBOL_LENGTHS.length];
    return LOW + (hi > lo ? (Math.log(Math.max(1, Number(dim))) - lo) / (hi - lo) : 0.5) * (HIGH - LOW);
  });
  // Pull neighbours apart (in order of length), then squeeze back into the limits.
  const order = dims.map((_, i) => i).sort((a, b) => lengths[a] - lengths[b]);
  for (let k = 1; k < order.length; k++)
    lengths[order[k]] = Math.max(lengths[order[k]], lengths[order[k - 1]] + MIN_GAP);
  const top = Math.max(...lengths, HIGH);
  const result = new Map<string, number>([['1', THIN]]);
  dims.forEach((dim, i) => result.set(dim, LOW + ((lengths[i] - LOW) * (HIGH - LOW)) / (top - LOW)));
  return result;
}

/**
 * LaTeX for a dimension label: a symbol such as n or d_k as it stands, a word such as seq upright, and a long subscript
 * (d_model) upright too; null for a number, which is drawn as plain text.
 */
export function dimensionTex(dim: string): string | null {
  if (isNumber(dim)) return null;
  const word = /^[A-Za-z]{2,}$/.exec(dim);
  if (word) return `\\mathrm{${dim}}`;
  const subscript = /^([A-Za-z]+)_([A-Za-z0-9]{2,})$/.exec(dim);
  return subscript ? `${subscript[1]}_{\\mathrm{${subscript[2]}}}` : dim;
}

/** What a LaTeX name or dimension reads as, for measuring and for screen readers: commands and braces dropped. */
export function plainTex(latex: string): string {
  return latex
    .replace(
      /\\(?:mathbf|mathrm|mathbb|mathcal|mathit|text|operatorname|boldsymbol|vec|hat|bar|tilde|left|right)\b/g,
      '',
    )
    .replace(/\\top\b/g, 'T')
    .replace(/\\[a-zA-Z]+/g, 'x')
    .replace(/[{}^]/g, '')
    .replace(/_/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// -------------------------------------------------------------------- plan

/** Contraction colours, in order: warm, so they stand out from the cool blocks. */
export const CONTRACTION_COLORS: Color[] = ['orange', 'pink', 'yellow'];

/** A product's shared inner dimension: it appears on both operands and is gone from the result. */
export interface Contraction {
  /** The times operator, as an index into the terms. */
  op: number;
  /** The matrices on either side (indexes among the matrices, as board focus counts them). */
  left: number;
  right: number;
  dim: string;
  color: Color;
  /** The matrix after the next equals, where the dimension is missing, or null when there is none. */
  result: number | null;
}

/** What is drawn: each matrix with its shape, and the contractions. */
export interface ShapesPlan {
  item: ShapesItem;
  matrices: { term: number; name: string; shape: MatrixShape; result: boolean }[];
  contractions: Contraction[];
}

/** Whether the terms alternate matrix, operator, matrix and end with a matrix, the way the shared check requires. */
function drawable(item: ShapesItem): boolean {
  return item.terms.length % 2 === 1 && item.terms.every((term, i) => term.kind === (i % 2 ? 'op' : 'matrix'));
}

/**
 * The matrices as drawn and the contractions, or null for terms that cannot be drawn. A matrix after equals or apply
 * takes the computed shape (the running shape of the terms before it), the others their own; so a result always shows
 * what the operation produces.
 */
export function shapesPlan(item: ShapesItem): ShapesPlan | null {
  if (!drawable(item)) return null;
  const terms = item.terms;
  const running = shapesRunning(terms);
  const matrices = terms.flatMap((term, i) => {
    if (term.kind !== 'matrix') return [];
    const before = terms[i - 1] as ShapesOpTerm | undefined;
    const result = !!before && (before.op === 'equals' || before.op === 'apply');
    return [{ term: i, name: term.name, shape: result ? running[i] : { rows: term.rows, cols: term.cols }, result }];
  });
  const contractions: Contraction[] = [];
  terms.forEach((term, i) => {
    if (term.kind !== 'op' || term.op !== 'times') return;
    const [left, right] = [(i - 1) / 2, (i + 1) / 2];
    const dim = matrices[left].shape.cols;
    if (dim !== matrices[right].shape.rows) return;
    const equals = terms.findIndex((later, k) => k > i && later.kind === 'op' && later.op === 'equals');
    contractions.push({
      op: i,
      left,
      right,
      dim,
      color: CONTRACTION_COLORS[contractions.length % CONTRACTION_COLORS.length],
      result: equals < 0 ? null : (equals + 1) / 2,
    });
  });
  return { item, matrices, contractions };
}

const OP_WORDS: Record<ShapesOpTerm['op'], string> = {
  times: 'times',
  plus: 'plus',
  hadamard: 'element-wise times',
  equals: 'equals',
  apply: 'through',
};

/** The expression in words for screen readers: "Q (n by d_k) times K^T (d_k by n) equals S (n by n)". */
export function shapesDescription(item: ShapesItem): string {
  const plan = shapesPlan(item);
  if (!plan) return item.title ?? 'Matrix shapes';
  const parts = item.terms.map((term, i) => {
    if (term.kind === 'op')
      return term.op === 'apply' ? `${OP_WORDS.apply} ${term.label ?? 'a function'} to give` : OP_WORDS[term.op];
    const { name, shape } = plan.matrices[i / 2];
    return `${plainTex(name)} (${shape.rows} by ${shape.cols})`;
  });
  const gone = plan.contractions.map((c) => `${plainTex(c.dim)} is summed over`);
  return [`${item.title ?? 'Matrix shapes'}: ${parts.join(' ')}`, ...gone].join('; ');
}

// ------------------------------------------------------------------- layout

export interface ShapesBlock {
  /** Place among the matrices; board focus counts the same way. */
  matrix: number;
  term: number;
  x: number;
  y: number;
  w: number;
  h: number;
  name: string;
  nameSize: number;
  /** A block too narrow for its name (a vector) shows the name beneath it. */
  nameBelow: boolean;
  rows: string;
  cols: string;
  /** The matrix after equals or apply: what the operation produces. */
  result: boolean;
  /** Where a ghost of the contracted dimensions goes under a result, in the stage's px. */
  ghostY: number;
}

export interface ShapesOpBox {
  term: number;
  op: ShapesOpTerm['op'];
  label?: string;
  /** The slot between two matrices: its left edge, width and centre line. */
  x: number;
  w: number;
  cy: number;
}

export interface ShapesLayout {
  /** The size the drawing needs; the stage is this big. */
  width: number;
  height: number;
  /** The length of a dimension of 1.0, in px. */
  unit: number;
  rows: number;
  blocks: ShapesBlock[];
  ops: ShapesOpBox[];
}

// The unit, from largest to smallest: a block of 1.0 is never wider than UNIT_MAX px, and a row of matrices that does
// not fit at UNIT_MIN wraps (at UNIT_WRAP) rather than shrinking further.
const UNIT = { max: 120, min: 64, wrap: 84, floor: 44 };
const OP_SLOT = { symbol: 30, apply: 50 };
// Room beside a block for its row label (and the bracket), above it for its column label.
const GUTTER = 16;
const LABEL_TOP = 34;
const ROW_GAP = 22;
const BELOW = { name: 24, ghost: 36 };
const THIN_MIN = 10;
const NAME = { min: 13, max: 22, share: 0.42 };
const DIM_SIZE = 14;

/** The width of text drawn at `size` px, from a measure of 13 px text. */
const widthOf = (measure: Measure, text: string, size: number) => (measure(text) * size) / 13;

/**
 * Places the matrices and operators of the plan in a stage `avail` px wide, left to right. The unit is as large as lets
 * the whole expression stand in one row (never over UNIT_MAX); a narrower board wraps it after an operator, as
 * typeset maths does, into rows at UNIT_WRAP. Blocks of one row share a centre line, so operators sit at the middle.
 */
export function shapesLayout(plan: ShapesPlan, avail: number, measure: Measure): ShapesLayout {
  const { matrices, item } = plan;
  const lengths = dimensionLengths(matrices.map((m) => m.shape));
  const ops = item.terms.flatMap((term, i) =>
    term.kind === 'op' ? [{ term: i, op: term.op, label: term.label }] : [],
  );
  const length = (dim: string) => lengths.get(dim) ?? THIN;
  const gutter = matrices.map((m) => Math.ceil(widthOf(measure, plainTex(m.shape.rows), DIM_SIZE)) + GUTTER);
  const slot = ops.map((o) =>
    o.op === 'apply' ? Math.max(OP_SLOT.apply, Math.ceil(widthOf(measure, o.label ?? '', 12)) + 14) : OP_SLOT.symbol,
  );
  const wide = (i: number, unit: number) => Math.max(length(matrices[i].shape.cols) * unit, THIN_MIN);
  const tall = (i: number, unit: number) => Math.max(length(matrices[i].shape.rows) * unit, THIN_MIN);
  // A matrix with its row label, and the operator after it.
  const piece = (i: number, unit: number) => gutter[i] + wide(i, unit) + (i < slot.length ? slot[i] : 0);
  // What a block's column label and the ghosts under it need past its right edge: they centre on a block, maybe thin.
  const spill = (i: number, unit: number) => {
    const chips = plan.contractions
      .filter((c) => c.result === i)
      .map((c) => widthOf(measure, plainTex(c.dim), DIM_SIZE) + 24);
    const ghosts = chips.reduce((sum, w) => sum + w + 6, -6);
    const label = widthOf(measure, plainTex(matrices[i].shape.cols), DIM_SIZE);
    return Math.max(0, (Math.max(ghosts, label) - wide(i, unit)) / 2);
  };

  const last = matrices.length - 1;
  const total = (unit: number) => matrices.reduce((sum, _, i) => sum + piece(i, unit), 0) + spill(last, unit);
  let unit = UNIT.max;
  while (unit > UNIT.min && total(unit) > avail) unit -= 2;
  let groups: number[][];
  if (total(unit) <= avail) groups = [matrices.map((_, i) => i)];
  else {
    unit = UNIT.wrap;
    while (unit > UNIT.floor && Math.max(...matrices.map((_, i) => piece(i, unit) + spill(i, unit))) > avail) unit -= 2;
    groups = [[]];
    let used = 0;
    matrices.forEach((_, i) => {
      const next = piece(i, unit);
      if (used && used + next + spill(i, unit) > avail) {
        groups.push([]);
        used = 0;
      }
      groups[groups.length - 1].push(i);
      used += next;
    });
  }

  // A name fits inside its block when the block is wide and tall enough, else it goes below.
  const sizes = matrices.map((m, i) => {
    const [w, h] = [wide(i, unit), tall(i, unit)];
    const size = clamp(Math.min(w, h) * NAME.share, NAME.min, NAME.max);
    const inside = widthOf(measure, plainTex(m.name), size) + 8 <= w && size * 1.3 <= h;
    return { size, inside };
  });
  const ghosted = new Set(plan.contractions.flatMap((c) => (c.result === null ? [] : [c.result])));
  const below = (i: number) => (sizes[i].inside ? 0 : BELOW.name) + (ghosted.has(i) ? BELOW.ghost : 0);
  const rowWidth = (group: number[]) =>
    group.reduce((sum, i) => sum + piece(i, unit), 0) + spill(group[group.length - 1], unit);
  const width = Math.max(...groups.map(rowWidth));
  const blocks: ShapesBlock[] = new Array(matrices.length);
  const opBoxes: ShapesOpBox[] = [];
  let y = 0;
  groups.forEach((group) => {
    const deepest = Math.max(...group.map((i) => tall(i, unit)));
    const cy = y + LABEL_TOP + deepest / 2;
    let x = (width - rowWidth(group)) / 2;
    for (const i of group) {
      const [w, h] = [wide(i, unit), tall(i, unit)];
      const m = matrices[i];
      x += gutter[i];
      blocks[i] = {
        matrix: i,
        term: m.term,
        x,
        y: cy - h / 2,
        w,
        h,
        name: m.name,
        nameSize: sizes[i].size,
        nameBelow: !sizes[i].inside,
        rows: m.shape.rows,
        cols: m.shape.cols,
        result: m.result,
        ghostY: cy + h / 2 + (sizes[i].inside ? 8 : BELOW.name + 4),
      };
      x += w;
      if (i < ops.length) {
        opBoxes.push({ ...ops[i], x, w: slot[i], cy });
        x += slot[i];
      }
    }
    y += LABEL_TOP + deepest + Math.max(0, ...group.map(below)) + ROW_GAP;
  });
  return { width, height: y - ROW_GAP, unit, rows: groups.length, blocks, ops: opBoxes };
}

// ----------------------------------------------------------------- timeline

/** Milliseconds: a term every `step`, matrices growing in, a product's dimension lighting once its right one lands. */
export const SHAPES_TIME = { first: 280, step: 340, grow: 520, op: 280, light: 440, ghost: 760 };

/** When term `i` starts arriving. */
export const termArrival = (i: number) => SHAPES_TIME.first + i * SHAPES_TIME.step;

/** When a contraction's colour comes up on its two operands: just after the right one has landed. */
export const lightStart = (c: Pick<Contraction, 'op'>) => termArrival(c.op + 1) + 220;

/** When the contracted dimension shows, struck out, at the result: just after the result has landed. */
export const ghostStart = (c: Pick<Contraction, 'result'>) =>
  c.result === null ? null : termArrival(c.result * 2) + 360;

/** How long the build takes, in ms. */
export function shapesDuration(plan: ShapesPlan): number {
  const last = termArrival(plan.item.terms.length - 1) + SHAPES_TIME.grow;
  const ghosts = plan.contractions.map((c) => (ghostStart(c) ?? 0) + SHAPES_TIME.ghost);
  const lights = plan.contractions.map((c) => lightStart(c) + SHAPES_TIME.light);
  return Math.max(last, ...ghosts, ...lights);
}
