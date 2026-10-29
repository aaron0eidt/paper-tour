/** A matrix or vector in a product, named in LaTeX; its dimensions are symbols ("n", "d_k") or numbers ("64"). A vector has cols "1". */
export interface ShapesMatrixTerm {
  kind: 'matrix';
  name: string;
  rows: string;
  cols: string;
}
/** What happens between two matrices; apply is a function such as softmax, named in label, that keeps the shape. */
export interface ShapesOpTerm {
  kind: 'op';
  op: 'times' | 'plus' | 'hadamard' | 'equals' | 'apply';
  label?: string;
}
export type ShapesTerm = ShapesMatrixTerm | ShapesOpTerm;
/** How the dimensions of matrices combine through an operation: matrix, operator, matrix, ... ending with a matrix. */
export interface ShapesItem {
  kind: 'shapes';
  title?: string;
  terms: ShapesTerm[];
}
export interface MatrixShape {
  rows: string;
  cols: string;
}

export const SHAPES_LIMITS = {
  title: 60,
  terms: [3, 9],
  matrices: 5,
  name: 40,
  dimension: 8,
  opLabel: 16,
} as const;
export const SHAPES_OPS = ['times', 'plus', 'hadamard', 'equals', 'apply'] as const;

const dimension = (description: string) => ({
  type: 'string',
  minLength: 1,
  maxLength: SHAPES_LIMITS.dimension,
  description,
});
export const SHAPES_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'terms'],
  properties: {
    kind: { type: 'string', enum: ['shapes'] },
    title: {
      type: 'string',
      maxLength: SHAPES_LIMITS.title,
      description: 'What the operation computes, at most 6 words.',
    },
    terms: {
      type: 'array',
      minItems: SHAPES_LIMITS.terms[0],
      maxItems: SHAPES_LIMITS.terms[1],
      description:
        '3, 5, 7 or 9 terms: a matrix, an operator, a matrix and so on, ending with a matrix; at most 5 matrices. Dimensions must agree.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['kind'],
        properties: {
          kind: {
            type: 'string',
            enum: ['matrix', 'op'],
            description: 'matrix at the odd places, op at the even places.',
          },
          name: {
            type: 'string',
            minLength: 1,
            maxLength: SHAPES_LIMITS.name,
            description: 'Matrix only: its name in LaTeX, such as A^T.',
          },
          rows: dimension('Matrix only: its number of rows as a symbol such as n or d_k, or a number.'),
          cols: dimension('Matrix only: its number of columns; a vector has 1.'),
          op: {
            type: 'string',
            enum: [...SHAPES_OPS],
            description:
              'Operator only. times: matrix product, left columns must equal right rows. plus and hadamard: equal shapes. equals: the next matrix is the result. apply: a function that keeps the shape, the next matrix is its output.',
          },
          label: {
            type: 'string',
            maxLength: SHAPES_LIMITS.opLabel,
            description: 'Operator only: the function name for apply, such as softmax.',
          },
        },
      },
    },
  },
};

const isRaw = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const clean = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
/** A dimension as text; a plain number is accepted as the symbol of that size. */
const sized = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? String(value) : clean(value));
const show = (shape: MatrixShape) => `${shape.rows} x ${shape.cols}`;
const same = (a: MatrixShape, b: MatrixShape) => a.rows === b.rows && a.cols === b.cols;

/** Why one term cannot be drawn at its place (matrices at the odd places, operators between them), or nothing. */
function termProblems(term: unknown, i: number): string[] {
  const name = `term ${i + 1}`;
  const expected = i % 2 === 0 ? 'matrix' : 'op';
  if (!isRaw(term)) return [`${name}: give an object`];
  if (term.kind !== expected)
    return [
      `${name}: this place needs ${expected === 'matrix' ? 'a matrix (kind matrix)' : 'an operator (kind op)'}; alternate matrix, operator, matrix`,
    ];
  const problems: string[] = [];
  if (term.kind === 'matrix') {
    const label = clean(term.name);
    if (!label || label.length > SHAPES_LIMITS.name)
      problems.push(`${name}: name must be 1 to ${SHAPES_LIMITS.name} characters of LaTeX`);
    for (const side of ['rows', 'cols'] as const) {
      const size = sized(term[side]);
      if (!size || size.length > SHAPES_LIMITS.dimension)
        problems.push(
          `${name}: ${side} must be 1 to ${SHAPES_LIMITS.dimension} characters, a symbol such as n or d_k or a number`,
        );
    }
    return problems;
  }
  const label = clean(term.label);
  if (!(SHAPES_OPS as readonly unknown[]).includes(term.op))
    problems.push(`${name}: op must be one of ${SHAPES_OPS.join(', ')}`);
  if (term.label !== undefined && (typeof term.label !== 'string' || label.length > SHAPES_LIMITS.opLabel))
    problems.push(`${name}: label must be at most ${SHAPES_LIMITS.opLabel} characters, such as softmax`);
  else if (term.op === 'apply' && !label)
    problems.push(`${name}: apply needs a label naming the function, such as softmax`);
  return problems;
}

/** The terms with trimmed text and only the fields that belong to their kind. */
function cleanTerms(terms: Record<string, unknown>[]): ShapesTerm[] {
  return terms.map((term): ShapesTerm => {
    if (term.kind === 'matrix')
      return { kind: 'matrix', name: clean(term.name), rows: sized(term.rows), cols: sized(term.cols) };
    const label = clean(term.label);
    return { kind: 'op', op: term.op as ShapesOpTerm['op'], ...(label ? { label } : {}) };
  });
}

/**
 * The shape of the whole expression after each term, left to right: a matrix shows the result so far (the first its own
 * shape, after a times the product's rows and columns), an operator the shape before it. The terms must alternate
 * matrix, operator, matrix (shapesProblems checks it). `problem` is the first place the dimensions disagree, or null;
 * the shapes after it follow the same rules, so a player can still draw them.
 */
export function shapesWalk(terms: ShapesTerm[]): { running: MatrixShape[]; problem: string | null } {
  const [first] = terms as [ShapesMatrixTerm];
  let now: MatrixShape = { rows: first.rows, cols: first.cols };
  const running = [now];
  let problem: string | null = null;
  for (let i = 1; i + 1 < terms.length; i += 2) {
    const { op } = terms[i] as ShapesOpTerm;
    const next = terms[i + 1] as ShapesMatrixTerm;
    const shape = { rows: next.rows, cols: next.cols };
    const fail = (why: string) => {
      problem ??= `term ${i + 2}: ${why}`;
    };
    let result = now;
    if (op === 'times') {
      if (now.cols !== shape.rows)
        fail(
          `times needs the columns of the left side (${now.cols}) to equal the rows of this matrix (${shape.rows}); fix a dimension or the order`,
        );
      result = { rows: now.rows, cols: shape.cols };
    } else if (!same(now, shape))
      fail(
        op === 'equals'
          ? `after equals this matrix must have the computed shape ${show(now)}, not ${show(shape)}`
          : op === 'apply'
            ? `apply keeps the shape ${show(now)}, so this matrix must have it, not ${show(shape)}`
            : `${op} needs equal shapes, but the left side is ${show(now)} and this matrix is ${show(shape)}`,
      );
    running.push(now, result);
    now = result;
  }
  return { running, problem };
}

/** The shape of the expression after each term; see shapesWalk. */
export const shapesRunning = (terms: ShapesTerm[]): MatrixShape[] => shapesWalk(terms).running;

/** Reasons a shapes item cannot be drawn, each worded as an instruction to the model; empty when it can. */
export function shapesProblems(raw: unknown): string[] {
  if (!isRaw(raw)) return ['Shapes must be an object.'];
  const problems: string[] = [];
  if (raw.kind !== 'shapes') problems.push('Unknown shapes kind.');
  if (raw.title !== undefined && (typeof raw.title !== 'string' || clean(raw.title).length > SHAPES_LIMITS.title))
    problems.push(`title: use at most ${SHAPES_LIMITS.title} characters`);
  const [fewest, most] = SHAPES_LIMITS.terms;
  if (!Array.isArray(raw.terms)) return [...problems, `terms: give a list of ${fewest} to ${most} terms`];
  const terms: unknown[] = raw.terms;
  if (terms.length < fewest || terms.length > most)
    return [
      ...problems,
      `terms: give ${fewest} to ${most} terms alternating matrix, operator, matrix, not ${terms.length}`,
    ];
  if (terms.length % 2 === 0)
    return [
      ...problems,
      `terms: end with a matrix; matrix, operator, matrix, ... makes an odd number of terms, not ${terms.length}`,
    ];
  const found = terms.flatMap(termProblems);
  problems.push(...found);
  if (!found.length) {
    const { problem } = shapesWalk(cleanTerms(terms as Record<string, unknown>[]));
    if (problem) problems.push(problem);
  }
  return problems;
}

/** The clean item: trimmed text and only the fields that belong to each term. Call it once shapesProblems is empty. */
export function canonicalShapes(raw: unknown): ShapesItem {
  const item = raw as Record<string, unknown>;
  const title = clean(item.title);
  return { kind: 'shapes', ...(title ? { title } : {}), terms: cleanTerms(item.terms as Record<string, unknown>[]) };
}
