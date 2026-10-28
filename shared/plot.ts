import type { Color } from './paper';

export interface PlotItem {
  kind: 'plot';
  title?: string;
  x: [number, number];
  y: [number, number];
  x_label?: string;
  y_label?: string;
  curves: { expression: string; label: string; color?: Color }[];
  /** Optional parameter sweep; the only parameter variable is a. */
  parameter?: { from: number; to: number };
}

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
export function plotProblems(raw: unknown): string[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return ['Plot must be an object.'];
  const p = raw as PlotItem;
  const problems: string[] = [];
  if (p.kind !== 'plot') problems.push('Unknown plot kind.');
  if (!range(p.x) || !range(p.y)) problems.push('Plot axes need finite increasing ranges within ±1000000.');
  for (const label of [p.title, p.x_label, p.y_label])
    if (label !== undefined && (typeof label !== 'string' || label.length > 80))
      problems.push('Plot labels must be short strings.');
  if (!Array.isArray(p.curves) || p.curves.length < 1 || p.curves.length > 3)
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
  return problems;
}

/** Segment discontinuities and clip out-of-range values; never connect across a pole. */
export function plotSegments(tree: Expr, plot: PlotItem, a = 1, samples = 160): [number, number][][] {
  const count = Math.max(8, Math.min(240, Math.floor(samples) || 160));
  const segments: [number, number][][] = [];
  let current: [number, number][] = [];
  const flush = () => {
    if (current.length) segments.push(current);
    current = [];
  };
  for (let i = 0; i <= count; i++) {
    const x = plot.x[0] + (i / count) * (plot.x[1] - plot.x[0]);
    const y = evaluateExpression(tree, x, a);
    if (!Number.isFinite(y) || y < plot.y[0] || y > plot.y[1]) {
      flush();
      continue;
    }
    if (current.length && Math.abs(y - current[current.length - 1][1]) > (plot.y[1] - plot.y[0]) / 2) flush();
    current.push([x, y]);
  }
  flush();
  return segments;
}

const axisSchema = { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number', minimum: -1e6, maximum: 1e6 } };
export const PLOT_SCHEMA = {
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
    curves: {
      type: 'array',
      minItems: 1,
      maxItems: 3,
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
  },
};
