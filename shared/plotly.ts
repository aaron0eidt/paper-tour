import { evaluateExpression, parseExpression } from './plot';
import type { VisualParameter } from './program';

/** Plotly figure JSON is data, never an executable JavaScript callback. */
export interface PlotlyItem {
  kind: 'plotly';
  title?: string;
  objective: string;
  figure: string;
  source: 'document' | 'illustrative';
  sourceRefs: string[];
  parameter?: VisualParameter;
  functions: { trace: number; expression: string; domain: [number, number]; samples: number }[];
}
export interface PlotlyFigure {
  data: Record<string, unknown>[];
  layout?: Record<string, unknown>;
}
const object = (properties: Record<string, unknown>) => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
export const PLOTLY_SCHEMA = object({
  kind: { type: 'string', enum: ['plotly'] },
  title: { type: 'string', maxLength: 100 },
  objective: { type: 'string', maxLength: 600 },
  figure: {
    type: 'string',
    maxLength: 150000,
    description:
      'Plotly figure JSON with data and layout. Allowed traces: scatter, bar, heatmap, contour, scatter3d, surface. Include labeled axes/units and exactly sourced measurements. No HTML, URLs, images, scripts or external resources.',
  },
  source: { type: 'string', enum: ['document', 'illustrative'] },
  sourceRefs: { type: 'array', maxItems: 30, items: { type: 'string', maxLength: 100 } },
  parameter: {
    anyOf: [
      object({
        name: { type: 'string', maxLength: 40 },
        label: { type: 'string', maxLength: 80 },
        value: { type: 'number' },
        min: { type: 'number' },
        max: { type: 'number' },
        step: { type: 'number' },
      }),
      { type: 'null' },
    ],
  },
  functions: {
    type: 'array',
    maxItems: 6,
    items: object({
      trace: { type: 'integer', minimum: 0, maximum: 11 },
      expression: {
        type: 'string',
        maxLength: 220,
        description:
          'Bounded arithmetic expression using x, a, and sin/cos/tanh/exp/log/sqrt. a is the interactive parameter.',
      },
      domain: { type: 'array', minItems: 2, maxItems: 2, items: { type: 'number' } },
      samples: { type: 'integer', minimum: 20, maximum: 400 },
    }),
  },
});
export function plotlyFigure(item: PlotlyItem, parameter = item.parameter?.value ?? 1): PlotlyFigure {
  const figure = JSON.parse(item.figure) as PlotlyFigure;
  for (const fn of item.functions) {
    const tree = parseExpression(fn.expression),
      x: number[] = [],
      y: (number | null)[] = [];
    for (let i = 0; i < fn.samples; i++) {
      const v = fn.domain[0] + ((fn.domain[1] - fn.domain[0]) * i) / (fn.samples - 1);
      x.push(v);
      const z = evaluateExpression(tree, v, parameter);
      y.push(Number.isFinite(z) ? z : null);
    }
    figure.data[fn.trace] = { ...figure.data[fn.trace], x, y };
  }
  return figure;
}
export function plotlyProblems(raw: unknown): string[] {
  const x = raw as PlotlyItem | null;
  if (!x || typeof x !== 'object' || typeof x.figure !== 'string' || x.figure.length > 150000)
    return ['Plotly needs a bounded figure JSON string.'];
  const problems: string[] = [];
  if (typeof x.objective !== 'string' || !x.objective.trim()) problems.push('Plotly needs a learning objective.');
  if (!['document', 'illustrative'].includes(x.source))
    problems.push('Identify document data or illustrative calculations.');
  if (
    !Array.isArray(x.sourceRefs) ||
    x.sourceRefs.length > 30 ||
    x.sourceRefs.some((id) => typeof id !== 'string' || id.length > 100)
  )
    problems.push('Provide valid sourceRefs.');
  try {
    const f = JSON.parse(x.figure) as PlotlyFigure;
    if (!Array.isArray(f.data) || f.data.length < 1 || f.data.length > 12) throw Error('Use 1–12 Plotly traces.');
    for (const trace of f.data)
      if (!trace || !['scatter', 'bar', 'heatmap', 'contour', 'scatter3d', 'surface'].includes(String(trace.type)))
        throw Error('Unsupported Plotly trace type.');
    let nodes = 0;
    const walk = (value: unknown, depth = 0): void => {
      if (++nodes > 30000 || depth > 16) throw Error('Plotly figure exceeds its complexity budget.');
      if (typeof value === 'string' && (/[<>]|(?:https?:|file:|javascript:|data:)/i.test(value) || value.length > 1000))
        throw Error('Plotly text must be plain text without external resources.');
      if (typeof value === 'number' && !Number.isFinite(value)) throw Error('Plotly values must be finite.');
      if (Array.isArray(value)) value.forEach((v) => walk(v, depth + 1));
      else if (value && typeof value === 'object')
        for (const [key, v] of Object.entries(value)) {
          if (['images', 'source', 'href', 'mapbox', 'geo', 'template'].includes(key))
            throw Error(`Plotly ${key} is not supported.`);
          walk(v, depth + 1);
        }
    };
    walk(f);
    if (!Array.isArray(x.functions) || x.functions.length > 6) throw Error('Invalid function traces.');
    for (const fn of x.functions) {
      if (
        !fn ||
        !Number.isInteger(fn.trace) ||
        !f.data[fn.trace] ||
        f.data[fn.trace].type !== 'scatter' ||
        !Array.isArray(fn.domain) ||
        fn.domain.length !== 2 ||
        !fn.domain.every(Number.isFinite) ||
        fn.domain[0] >= fn.domain[1] ||
        !Number.isInteger(fn.samples) ||
        fn.samples < 20 ||
        fn.samples > 400
      )
        throw Error('Function traces need a scatter trace, increasing finite domain, and 20–400 samples.');
      parseExpression(fn.expression);
    }
    const p = x.parameter;
    if (
      p &&
      (![p.value, p.min, p.max, p.step].every(Number.isFinite) ||
        p.min >= p.max ||
        p.value < p.min ||
        p.value > p.max ||
        p.step <= 0 ||
        !p.label)
    )
      throw Error('Invalid interactive parameter.');
    plotlyFigure(x);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : 'Invalid Plotly figure.');
  }
  return problems;
}
