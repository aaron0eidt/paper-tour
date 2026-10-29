import type { Color } from './paper';

/**
 * A fact about the curves that the code finds and the board draws as a labelled point. The model asks for it and never
 * gives a position: where a root, an extremum or a crossing lies is computed from the expressions.
 */
export interface PlotMark {
  type: 'root' | 'extremum' | 'crossing' | 'value';
  /** The curve it reads, counted from 1. */
  curve: number;
  /** crossing: the curve it meets, counted from 1. */
  other?: number;
  /** extremum: the highest or the lowest point. */
  which?: 'max' | 'min';
  /** root or crossing: the first, second, ... one counted from the left. */
  nth?: number;
  /** value: the x whose value is read. */
  at?: number;
  /** What the point means, in a few words; its coordinates are always printed with it. */
  label?: string;
}

export interface PlotItem {
  kind: 'plot';
  title?: string;
  x: [number, number];
  y: [number, number];
  x_label?: string;
  y_label?: string;
  /** Log axes need a range above zero. */
  x_scale?: 'linear' | 'log';
  y_scale?: 'linear' | 'log';
  curves: { expression: string; label: string; color?: Color }[];
  /** Optional parameter sweep; the only parameter variable is a. */
  parameter?: { from: number; to: number };
  /** document: the expressions are the document's own. A plot is illustrative unless it says so. */
  source?: 'document' | 'illustrative';
  /** Roots, extrema, crossings and values, found by the code (see resolveMarks). */
  marks?: PlotMark[];
  /** Measured points from the document, drawn over the curves; never invented. */
  points?: { x: number; y: number; label?: string }[];
}

export const PLOT_LIMITS = { curves: 3, marks: 4, points: 8, label: 24, nth: 5 } as const;
export const PLOT_MARK_TYPES = ['root', 'extremum', 'crossing', 'value'] as const;
export const PLOT_SCALES = ['linear', 'log'] as const;
export const PLOT_SOURCES = ['document', 'illustrative'] as const;

type Expr = { value: number } | { variable: 'x' | 'a' } | { op: string; args: Expr[] };
const FUNCTIONS: Record<string, [number, number, (...args: number[]) => number]> = {
  sin: [1, 1, Math.sin],
  cos: [1, 1, Math.cos],
  tanh: [1, 1, Math.tanh],
  exp: [1, 1, Math.exp],
  log: [1, 1, Math.log],
  sqrt: [1, 1, Math.sqrt],
  abs: [1, 1, Math.abs],
  relu: [1, 1, (x) => Math.max(0, x)],
  sigmoid: [1, 1, (x) => (x >= 0 ? 1 / (1 + Math.exp(-x)) : Math.exp(x) / (1 + Math.exp(x)))],
  min: [2, 4, Math.min],
  max: [2, 4, Math.max],
  /** First component of a stable softmax of two to four logits. */
  softmax: [
    2,
    4,
    (...v) => {
      const m = Math.max(...v);
      return Math.exp(v[0] - m) / v.reduce((s, x) => s + Math.exp(x - m), 0);
    },
  ],
};

/** Bounded arithmetic parser: no properties, assignment, strings, implicit multiplication or executable code. */
export function parseExpression(source: string, { maxConstant = 1e6 }: { maxConstant?: number } = {}): Expr {
  if (!source || source.length > 200) throw new Error('Expression must contain 1–200 characters.');
  const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|[a-zA-Z_]+|[^\s]/g) ?? [];
  if (tokens.length > 128) throw new Error('Expression is too complex.');
  let at = 0,
    depth = 0;
  const take = (token: string) => {
    if (tokens[at] !== token) throw new Error(`Expected ${token}.`);
    at++;
  };
  const expression = (minimum = 0): Expr => {
    if (++depth > 16) throw new Error('Expression is nested too deeply.');
    let left: Expr;
    const token = tokens[at++];
    if (token === '+' || token === '-') left = { op: token === '-' ? 'neg' : 'pos', args: [expression(3)] };
    else if (token === '(') {
      left = expression();
      take(')');
    } else if (token === 'x' || token === 'a') left = { variable: token };
    else if (token === 'pi' || token === 'e') left = { value: token === 'pi' ? Math.PI : Math.E };
    else if (token && /^\d|^\.\d/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value) || Math.abs(value) > maxConstant) throw new Error('Numeric constant is too large.');
      left = { value };
    } else if (token && Object.hasOwn(FUNCTIONS, token)) {
      take('(');
      const args = [expression()];
      while (tokens[at] === ',') {
        at++;
        args.push(expression());
      }
      take(')');
      const [min, max] = FUNCTIONS[token];
      if (args.length < min || args.length > max) throw new Error(`Invalid arguments for ${token}.`);
      left = { op: token, args };
    } else throw new Error('Unknown variable, function or token.');
    while (at < tokens.length) {
      const op = tokens[at],
        power = ({ '+': 1, '-': 1, '*': 2, '/': 2, '^': 4 } as Record<string, number>)[op];
      if (power === undefined || power < minimum) break;
      at++;
      left = { op, args: [left, expression(op === '^' ? power : power + 1)] };
    }
    depth--;
    return left;
  };
  const tree = expression();
  if (at !== tokens.length) throw new Error('Unexpected token after expression.');
  return tree;
}

export function evaluateExpression(tree: Expr, x: number, a = 1): number {
  if ('value' in tree) return tree.value;
  if ('variable' in tree) return tree.variable === 'x' ? x : a;
  const v = tree.args.map((arg) => evaluateExpression(arg, x, a));
  let value: number;
  switch (tree.op) {
    case '+':
      value = v[0] + v[1];
      break;
    case '-':
      value = v[0] - v[1];
      break;
    case '*':
      value = v[0] * v[1];
      break;
    case '/':
      value = v[0] / v[1];
      break;
    case '^':
      value = Math.pow(v[0], v[1]);
      break;
    case 'neg':
      value = -v[0];
      break;
    case 'pos':
      value = v[0];
      break;
    default:
      value = FUNCTIONS[tree.op][2](...v);
  }
  return Number.isFinite(value) ? value : NaN;
}

const range = (v: unknown): v is [number, number] =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e6) &&
  v[1] - v[0] >= 1e-6;
const isRaw = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');

/** Whether an axis of the plot is logarithmic. */
export const plotLog = (plot: Pick<PlotItem, 'x_scale' | 'y_scale'>, axis: 'x' | 'y') =>
  plot[`${axis}_scale`] === 'log';

const SUPERSCRIPT = '⁰¹²³⁴⁵⁶⁷⁸⁹';
/** A number as a board prints it: three significant digits, and powers of ten for the very large or small. */
export function formatNumber(value: number): string {
  if (value === 0) return '0';
  const abs = Math.abs(value);
  if (abs >= 1e5 || abs < 1e-3) {
    const [mantissa, exponent] = value.toExponential(2).split('e');
    const power = [...String(Math.abs(Number(exponent)))].map((digit) => SUPERSCRIPT[Number(digit)]).join('');
    return `${Number(mantissa)}×10${Number(exponent) < 0 ? '⁻' : ''}${power}`;
  }
  return String(Number(value.toPrecision(3))).replace('-', '−');
}

export function plotProblems(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['Plot must be an object.'];
  const p = raw as PlotItem;
  const problems: string[] = [];
  if (p.kind !== 'plot') problems.push('Unknown plot kind.');
  if (!range(p.x) || !range(p.y)) problems.push('Plot axes need finite increasing ranges within ±1000000.');
  for (const label of [p.title, p.x_label, p.y_label])
    if (label !== undefined && (typeof label !== 'string' || label.length > 80))
      problems.push('Plot labels must be short strings.');
  for (const axis of ['x', 'y'] as const) {
    const scale = p[`${axis}_scale`];
    if (scale === undefined) continue;
    if (!(PLOT_SCALES as readonly unknown[]).includes(scale)) problems.push(`${axis}_scale: use linear or log`);
    else if (scale === 'log' && range(p[axis]) && p[axis][0] <= 0)
      problems.push(`${axis}_scale: a log axis needs a range above zero, not ${p[axis][0]} to ${p[axis][1]}`);
  }
  if (p.source !== undefined && !(PLOT_SOURCES as readonly unknown[]).includes(p.source))
    problems.push('source: use document or illustrative');
  if (!Array.isArray(p.curves) || p.curves.length < 1 || p.curves.length > PLOT_LIMITS.curves)
    return [...problems, 'Plot needs 1–3 curves.'];
  for (const c of p.curves) {
    if (!c || typeof c.expression !== 'string' || typeof c.label !== 'string' || !c.label || c.label.length > 80) {
      problems.push('Invalid curve.');
      continue;
    }
    try {
      parseExpression(c.expression);
    } catch (e) {
      problems.push((e as Error).message);
    }
    if (c.color !== undefined && !['blue', 'green', 'pink', 'orange', 'yellow'].includes(c.color))
      problems.push('Invalid curve colour.');
  }
  if (
    p.parameter !== undefined &&
    (!p.parameter ||
      ![p.parameter.from, p.parameter.to].every(
        (n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e3,
      ))
  )
    problems.push('Invalid parameter range.');
  if (!problems.length) problems.push(...markProblems(p), ...pointProblems(p));
  return problems;
}

// ----------------------------------------------------------------- points

/** Measured points: finite, inside the axes (a log axis needs values above zero), a short label. */
function pointProblems(plot: PlotItem): string[] {
  if (plot.points === undefined) return [];
  if (!Array.isArray(plot.points) || plot.points.length > PLOT_LIMITS.points)
    return [`points: give at most ${PLOT_LIMITS.points} points`];
  const problems: string[] = [];
  plot.points.forEach((point, i) => {
    const name = `point ${i + 1}`;
    if (!isRaw(point) || !finite(point.x) || !finite(point.y)) {
      problems.push(`${name}: x and y must both be finite numbers`);
      return;
    }
    if (point.label !== undefined && (typeof point.label !== 'string' || clean(point.label).length > PLOT_LIMITS.label))
      problems.push(`${name}: the label must be at most ${PLOT_LIMITS.label} characters`);
    const outside =
      point.x < plot.x[0] || point.x > plot.x[1] ? 'x' : point.y < plot.y[0] || point.y > plot.y[1] ? 'y' : null;
    if (outside)
      problems.push(
        `${name} (${formatNumber(point.x)}, ${formatNumber(point.y)}) lies outside the axes; widen the ${outside} range to ${formatNumber(
          point[outside],
        )} or leave the point out`,
      );
  });
  return problems;
}

// ------------------------------------------------------------------ marks

export interface ResolvedMark {
  /** Which entry of plot.marks it answers. */
  index: number;
  type: PlotMark['type'];
  /** The curve it reads, counted from 1. */
  curve: number;
  x: number;
  y: number;
  label?: string;
}

const SCAN = 600;
type Fn = (x: number) => number;

/** The x values a mark search walks along: even along a linear axis, even in ratio along a log one. */
function scanXs(plot: PlotItem): number[] {
  const [lo, hi] = plot.x;
  const log = plotLog(plot, 'x');
  return Array.from({ length: SCAN + 1 }, (_, i) =>
    i === SCAN ? hi : log ? lo * (hi / lo) ** (i / SCAN) : lo + ((hi - lo) * i) / SCAN,
  );
}

/** Where f crosses zero, left to right: a sign change refined by bisection, and a pole (which only flips sign) is not one. */
function zeros(f: Fn, xs: number[]): number[] {
  const ys = xs.map(f);
  const found: number[] = [];
  const add = (x: number) => {
    if (!found.some((r) => Math.abs(r - x) <= 1e-9 * Math.max(1, Math.abs(x)))) found.push(x);
  };
  for (let i = 0; i < xs.length; i++) {
    if (!Number.isFinite(ys[i])) continue;
    if (ys[i] === 0) {
      add(xs[i]);
      continue;
    }
    const j = i + 1;
    if (j >= xs.length || !Number.isFinite(ys[j]) || ys[j] === 0 || ys[i] * ys[j] > 0) continue;
    let [a, b] = [xs[i], xs[j]];
    const below = ys[i] < 0;
    for (let k = 0; k < 80; k++) {
      const m = (a + b) / 2;
      const fm = f(m);
      if (!Number.isFinite(fm)) break;
      if (fm < 0 === below) a = m;
      else b = m;
    }
    const root = (a + b) / 2;
    const at = f(root);
    if (Number.isFinite(at) && Math.abs(at) <= 1e-6 * Math.max(Math.abs(ys[i]), Math.abs(ys[j]))) add(root);
  }
  return found;
}

/** The highest or lowest point strictly inside the range, refined by golden-section search; null at an edge, a pole or a constant. */
function extremum(f: Fn, xs: number[], which: 'max' | 'min'): { x: number; y: number } | null {
  const sign = which === 'max' ? 1 : -1;
  const ys = xs.map(f);
  let best = -1;
  for (let i = 0; i < ys.length; i++)
    if (Number.isFinite(ys[i]) && (best < 0 || sign * ys[i] > sign * ys[best])) best = i;
  if (best <= 0 || best >= ys.length - 1) return null;
  if (!Number.isFinite(ys[best - 1]) || !Number.isFinite(ys[best + 1])) return null;
  if (Math.min(...ys.filter(Number.isFinite)) === Math.max(...ys.filter(Number.isFinite))) return null;
  let [a, b] = [xs[best - 1], xs[best + 1]];
  const ratio = (Math.sqrt(5) - 1) / 2;
  let [c, d] = [b - ratio * (b - a), a + ratio * (b - a)];
  for (let k = 0; k < 80 && b - a > 1e-12 * Math.max(1, Math.abs(b)); k++) {
    if (sign * f(c) > sign * f(d)) b = d;
    else a = c;
    [c, d] = [b - ratio * (b - a), a + ratio * (b - a)];
  }
  const x = (a + b) / 2;
  const y = f(x);
  return Number.isFinite(y) && sign * y >= sign * ys[best] - 1e-12 * Math.max(1, Math.abs(ys[best]))
    ? { x, y }
    : { x: xs[best], y: ys[best] };
}

const span = (plot: PlotItem) => `x = ${formatNumber(plot.x[0])} to ${formatNumber(plot.x[1])}`;

/**
 * The marks the plot asks for, found at parameter value `a`: for each one its point, else the reason it does not exist,
 * worded for the model. A mark outside the y range, or on a log axis at a value that axis cannot show, is not found.
 */
export function resolveMarks(plot: PlotItem, a = 1): { marks: ResolvedMark[]; problems: string[] } {
  const marks: ResolvedMark[] = [];
  const problems: string[] = [];
  if (!Array.isArray(plot.marks)) return { marks, problems };
  const trees = plot.curves.map((c) => parseExpression(c.expression));
  const curve =
    (n: number): Fn =>
    (x) =>
      evaluateExpression(trees[n - 1], x, a);
  const xs = scanXs(plot);
  plot.marks.forEach((mark, index) => {
    const name = `mark ${index + 1}`;
    const nth = Math.min(PLOT_LIMITS.nth, Math.max(1, Math.floor(mark.nth ?? 1)));
    let found: { x: number; y: number } | string;
    if (mark.type === 'root') {
      const roots = zeros(curve(mark.curve), xs);
      found =
        roots[nth - 1] !== undefined
          ? { x: roots[nth - 1], y: 0 }
          : `curve ${mark.curve} has ${roots.length ? `only ${roots.length}` : 'no'} root${roots.length === 1 ? '' : 's'} (where it crosses zero) over ${span(plot)}; choose a root that exists, a wider x range, or another mark`;
    } else if (mark.type === 'extremum') {
      const top = extremum(curve(mark.curve), xs, mark.which === 'min' ? 'min' : 'max');
      found =
        top ??
        `curve ${mark.curve} has no interior ${mark.which === 'min' ? 'minimum' : 'maximum'} over ${span(plot)} (it is highest or lowest at an edge, or is constant); choose another mark or widen the x range`;
    } else if (mark.type === 'crossing') {
      const [f, g] = [curve(mark.curve), curve(mark.other!)];
      const crossings = zeros((x) => f(x) - g(x), xs);
      found =
        crossings[nth - 1] !== undefined
          ? { x: crossings[nth - 1], y: f(crossings[nth - 1]) }
          : `curves ${mark.curve} and ${mark.other} ${crossings.length ? `cross only ${crossings.length} time${crossings.length === 1 ? '' : 's'}` : 'do not cross'} over ${span(plot)}; choose a crossing that exists or a wider x range`;
    } else {
      const y = curve(mark.curve)(mark.at!);
      found = Number.isFinite(y)
        ? { x: mark.at!, y }
        : `curve ${mark.curve} has no value at x = ${formatNumber(mark.at!)}`;
    }
    if (typeof found === 'string') {
      problems.push(`${name}: ${found}`);
      return;
    }
    if (found.y < plot.y[0] || found.y > plot.y[1])
      problems.push(
        `${name}: its point (${formatNumber(found.x)}, ${formatNumber(found.y)}) is outside the y range ${formatNumber(plot.y[0])} to ${formatNumber(plot.y[1])}; widen the y range`,
      );
    else if (plotLog(plot, 'y') && found.y <= 0)
      problems.push(
        `${name}: its point has y = ${formatNumber(found.y)}, which a log y axis cannot show; use a linear y axis or another mark`,
      );
    else
      marks.push({ index, type: mark.type, curve: mark.curve, ...found, ...(mark.label ? { label: mark.label } : {}) });
  });
  return { marks, problems };
}

/** The parameter values a mark has to exist at: both ends of a sweep and its middle, else just 1. */
function sweepValues(plot: PlotItem): number[] {
  return plot.parameter ? [plot.parameter.from, (plot.parameter.from + plot.parameter.to) / 2, plot.parameter.to] : [1];
}

/** Why the marks cannot be drawn: malformed requests first, then a mark that does not exist at some point of the sweep. */
function markProblems(plot: PlotItem): string[] {
  if (plot.marks === undefined) return [];
  if (!Array.isArray(plot.marks) || plot.marks.length > PLOT_LIMITS.marks)
    return [`marks: give at most ${PLOT_LIMITS.marks} marks`];
  const problems: string[] = [];
  const curves = plot.curves.length;
  const index = (value: unknown) => finite(value) && Number.isInteger(value) && value >= 1 && value <= curves;
  plot.marks.forEach((mark, i) => {
    const name = `mark ${i + 1}`;
    if (!isRaw(mark) || !(PLOT_MARK_TYPES as readonly unknown[]).includes(mark.type)) {
      problems.push(`${name}: type must be ${PLOT_MARK_TYPES.join(', ')}`);
      return;
    }
    if (!index(mark.curve)) problems.push(`${name}: curve must be a whole number from 1 to ${curves}`);
    if (mark.type === 'crossing' && (!index(mark.other) || mark.other === mark.curve))
      problems.push(`${name}: a crossing needs "other", a different curve from 1 to ${curves}`);
    if (mark.type === 'extremum' && mark.which !== 'max' && mark.which !== 'min')
      problems.push(`${name}: an extremum needs which, max or min`);
    if (mark.type === 'value' && (!finite(mark.at) || mark.at < plot.x[0] || mark.at > plot.x[1]))
      problems.push(
        `${name}: a value needs "at", an x inside the x range ${formatNumber(plot.x[0])} to ${formatNumber(plot.x[1])}`,
      );
    if (mark.nth !== undefined && (!Number.isInteger(mark.nth) || mark.nth < 1 || mark.nth > PLOT_LIMITS.nth))
      problems.push(`${name}: nth must be a whole number from 1 to ${PLOT_LIMITS.nth}`);
    if (mark.label !== undefined && (typeof mark.label !== 'string' || clean(mark.label).length > PLOT_LIMITS.label))
      problems.push(`${name}: the label must be at most ${PLOT_LIMITS.label} characters`);
  });
  if (problems.length) return problems;
  const missing = new Set<string>();
  for (const a of sweepValues(plot)) for (const problem of resolveMarks(plot, a).problems) missing.add(problem);
  const where = plot.parameter ? ` (checked at a = ${sweepValues(plot).map(formatNumber).join(', ')})` : '';
  return [...missing].map((problem) => `${problem}${where}`).slice(0, 3);
}

/** The words that name a mark when the model gave none. */
export function markName(mark: PlotMark): string {
  if (mark.type === 'extremum') return mark.which === 'min' ? 'minimum' : 'maximum';
  return mark.type;
}

// --------------------------------------------------------------- sampling

/** The x of sample i of `count` along the plot's x axis, even along a linear axis and even in ratio along a log one. */
export function plotSampleX(plot: PlotItem, i: number, count: number): number {
  const [lo, hi] = plot.x;
  return plotLog(plot, 'x') ? lo * (hi / lo) ** (i / count) : lo + (i / count) * (hi - lo);
}

/** Segment discontinuities and clip out-of-range values; never connect across a pole. */
export function plotSegments(tree: Expr, plot: PlotItem, a = 1, samples = 160): [number, number][][] {
  const count = Math.max(8, Math.min(240, Math.floor(samples) || 160));
  const logY = plotLog(plot, 'y');
  const along = (y: number) => (logY ? Math.log10(y) : y);
  const jump = logY ? Math.log10(plot.y[1] / plot.y[0]) / 2 : (plot.y[1] - plot.y[0]) / 2;
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  const flush = () => {
    if (current.length) segments.push(current);
    current = [];
  };
  for (let i = 0; i <= count; i++) {
    const x = plotSampleX(plot, i, count);
    const y = evaluateExpression(tree, x, a);
    if (!Number.isFinite(y) || y < plot.y[0] || y > plot.y[1] || (logY && y <= 0)) {
      flush();
      continue;
    }
    if (current.length && Math.abs(along(y) - along(current[current.length - 1][1])) > jump) flush();
    current.push([x, y]);
  }
  flush();
  return segments;
}

const axisSchema = { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', minimum: -1e6, maximum: 1e6 } };
/** The plot board: curves with log axes, marks the code finds, and the document's measured points. */
export const PLOT_BOARD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'x', 'y', 'curves'],
  properties: {
    kind: { const: 'plot' },
    title: { type: 'string', maxLength: 80 },
    x: axisSchema,
    y: axisSchema,
    x_label: { type: 'string', maxLength: 80 },
    y_label: { type: 'string', maxLength: 80 },
    x_scale: {
      enum: [...PLOT_SCALES],
      description: 'log for values that span orders of magnitude (the x range must be above zero); default linear.',
    },
    y_scale: { enum: [...PLOT_SCALES], description: 'log y axis (the y range must be above zero); default linear.' },
    curves: {
      type: 'array',
      minItems: 1,
      maxItems: PLOT_LIMITS.curves,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['expression', 'label'],
        properties: {
          expression: { type: 'string', minLength: 1, maxLength: 200 },
          label: { type: 'string', minLength: 1, maxLength: 80 },
          color: { enum: ['blue', 'green', 'pink', 'orange', 'yellow'] },
        },
      },
    },
    parameter: {
      type: 'object',
      additionalProperties: false,
      required: ['from', 'to'],
      properties: {
        from: { type: 'number', minimum: -1000, maximum: 1000 },
        to: { type: 'number', minimum: -1000, maximum: 1000 },
      },
    },
    source: {
      enum: [...PLOT_SOURCES],
      description:
        'document only when the expressions are the document’s own formula; otherwise illustrative (the default).',
    },
    marks: {
      type: 'array',
      maxItems: PLOT_LIMITS.marks,
      description:
        'Facts the code finds on the curves and draws as labelled points: a root, an extremum, a crossing of two curves, a value at a stated x. Ask for one; never give a position.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'curve'],
        properties: {
          type: { enum: [...PLOT_MARK_TYPES] },
          curve: {
            type: 'integer',
            minimum: 1,
            maximum: PLOT_LIMITS.curves,
            description: 'The curve, counted from 1.',
          },
          other: {
            type: 'integer',
            minimum: 1,
            maximum: PLOT_LIMITS.curves,
            description: 'crossing only: the other curve.',
          },
          which: { enum: ['max', 'min'], description: 'extremum only.' },
          nth: {
            type: 'integer',
            minimum: 1,
            maximum: PLOT_LIMITS.nth,
            description: 'root or crossing: the first, second, ... from the left.',
          },
          at: { type: 'number', description: 'value only: the x whose value is read, as stated in the document.' },
          label: {
            type: 'string',
            maxLength: PLOT_LIMITS.label,
            description: 'What the point means in a few words, such as break-even.',
          },
        },
      },
    },
    points: {
      type: 'array',
      maxItems: PLOT_LIMITS.points,
      description: 'Measured points printed in the document, drawn over the curves; copy x and y exactly as printed.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['x', 'y'],
        properties: {
          x: { type: 'number' },
          y: { type: 'number' },
          label: { type: 'string', maxLength: PLOT_LIMITS.label },
        },
      },
    },
  },
};

// A plot inside a scene object is curves alone: its renderer draws no marks, points or log axes.
const {
  x_scale: _xScale,
  y_scale: _yScale,
  source: _source,
  marks: _marks,
  points: _points,
  ...curveProperties
} = PLOT_BOARD_SCHEMA.properties;
export const PLOT_SCHEMA = { ...PLOT_BOARD_SCHEMA, properties: curveProperties };
