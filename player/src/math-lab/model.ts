import type { SceneItem, SceneObject } from '../../../shared/scene';
import { evaluateExpression, parseExpression, type PlotItem } from '../../../shared/plot';

/** Experimental authoring contract. Values/topology are shared by both renderers;
 * lesson fixtures below are examples, never rules for a particular paper. */
export type Point = [number, number];
export type Matrix = [Point, Point];
export type Lesson =
  | { kind: 'function'; title: string; expression: string; domain: Point; range: Point; parameter: Point }
  | { kind: 'linear-map'; title: string; matrix: Matrix; input: Point }
  | {
      kind: 'graph';
      title: string;
      nodes: { id: string; label: string }[];
      edges: { id: string; from: string; to: string; label?: string }[];
    };
export type GraphLesson = Extract<Lesson, { kind: 'graph' }>;
export interface GraphGeometry {
  nodes: { id: string; label: string; center: Point }[];
  edges: { id: string; from: string; to: string; tail: Point; tip: Point; label?: string }[];
}
export const lessons: Lesson[] = [
  {
    kind: 'function',
    title: 'Wie eine Skalierung die Antwort verändert',
    expression: 'sigmoid(x/a)',
    domain: [-4, 6],
    range: [-0.1, 1.1],
    parameter: [0.35, 2.5],
  },
  {
    kind: 'linear-map',
    title: 'Eine Matrix bewegt den ganzen Raum',
    matrix: [
      [1.4, 0.7],
      [0.3, 1.1],
    ],
    input: [1, 1],
  },
  {
    kind: 'graph',
    title: 'Verbindungen statt Schicht-Kästchen',
    nodes: [
      { id: 'x1', label: 'x₁' },
      { id: 'x2', label: 'x₂' },
      { id: 'a3', label: 'a₃' },
      { id: 'a4', label: 'a₄' },
      { id: 'a5', label: 'a₅' },
      { id: 'a6', label: 'a₆' },
      { id: 'y', label: 'y' },
      { id: 't', label: 't' },
      { id: 'E', label: 'E' },
    ],
    edges: [
      ['x1', 'a3'],
      ['x2', 'a3'],
      ['x1', 'a4'],
      ['x2', 'a4'],
      ['a3', 'a5'],
      ['a4', 'a5'],
      ['a3', 'a6'],
      ['a4', 'a6'],
      ['a5', 'y'],
      ['a6', 'y'],
      ['y', 'E'],
      ['t', 'E'],
    ].map(([from, to], i) => ({ id: `e${i}`, from, to })),
  },
];
export const palette = { blue: '#7ea6ff', green: '#57d4ad', pink: '#ef9bd8', yellow: '#f0d779', muted: '#586179' };
export const clamp = (n: number) => Math.max(0, Math.min(1, n));
export const mix = (a: number, b: number, t: number) => a + (b - a) * clamp(t);
export function matrixAt(matrix: Matrix, t: number): Matrix {
  return [
    [mix(1, matrix[0][0], t), mix(0, matrix[0][1], t)],
    [mix(0, matrix[1][0], t), mix(1, matrix[1][1], t)],
  ];
}
export const mafsMatrix = (a: Matrix): [number, number, number, number, number, number] => [
  a[0][0],
  a[0][1],
  0,
  a[1][0],
  a[1][1],
  0,
];
export const multiply = (a: Matrix, v: Point): Point => [
  a[0][0] * v[0] + a[0][1] * v[1],
  a[1][0] * v[0] + a[1][1] * v[1],
];
/** Frame the quantities being taught across the whole transition, rather than
 * shrinking short vectors inside a large generic coordinate plane. */
export function linearMapView(lesson: Extract<Lesson, { kind: 'linear-map' }>): { x: Point; y: Point } {
  const a = lesson.matrix;
  const points: Point[] = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    lesson.input,
    [a[0][0], a[1][0]],
    [a[0][1], a[1][1]],
    [a[0][0] + a[0][1], a[1][0] + a[1][1]],
    multiply(a, lesson.input),
  ];
  const axis = (i: 0 | 1): Point => {
    const low = Math.min(...points.map((p) => p[i]));
    const high = Math.max(...points.map((p) => p[i]));
    const margin = Math.max(0.55, (high - low) * 0.2);
    return [low - margin, high + margin];
  };
  return { x: axis(0), y: axis(1) };
}
export function functionState(lesson: Extract<Lesson, { kind: 'function' }>, progress: number) {
  const a = mix(...lesson.parameter, progress),
    tree = parseExpression(lesson.expression);
  return {
    a,
    fn: (x: number) => evaluateExpression(tree, x, a),
    slope: (x: number) => (evaluateExpression(tree, x + 0.0001, a) - evaluateExpression(tree, x - 0.0001, a)) / 0.0002,
  };
}
export function functionPlot(lesson: Extract<Lesson, { kind: 'function' }>, progress: number): PlotItem {
  const { a } = functionState(lesson, progress);
  return {
    kind: 'plot',
    title: lesson.title,
    x: lesson.domain,
    y: lesson.range,
    x_label: 'input',
    y_label: 'response',
    curves: [
      {
        expression: lesson.expression.replace(/\ba\b/g, `(${lesson.parameter[0]})`),
        label: 'initial',
        color: 'orange',
      },
      { expression: lesson.expression, label: 'response', color: 'blue' },
    ],
    parameter: { from: a, to: a },
  };
}
export function activeNodes(graph: GraphGeometry, progress: number, backward: boolean): Set<string> {
  // Derive teaching layers from dependencies, never from a node's screen position.
  const depth = new Map(graph.nodes.map((n) => [n.id, 0]));
  const pending = new Map(graph.nodes.map((n) => [n.id, graph.edges.filter((e) => e.to === n.id).length]));
  const ready = graph.nodes.filter((n) => pending.get(n.id) === 0).map((n) => n.id);
  let visited = 0;
  while (ready.length) {
    const id = ready.shift()!;
    visited++;
    for (const edge of graph.edges.filter((e) => e.from === id)) {
      depth.set(edge.to, Math.max(depth.get(edge.to)!, depth.get(id)! + 1));
      pending.set(edge.to, pending.get(edge.to)! - 1);
      if (pending.get(edge.to) === 0) ready.push(edge.to);
    }
  }
  if (visited !== graph.nodes.length) throw new Error('This traversal requires an acyclic computation graph.');
  const count = Math.max(...depth.values()) + 1;
  const rank = Math.min(count - 1, Math.floor(clamp(progress) * count));
  return new Set(graph.nodes.filter((n) => depth.get(n.id) === (backward ? count - 1 - rank : rank)).map((n) => n.id));
}
function coordinatePlane(view: { x: Point; y: Point }): SceneObject {
  return {
    id: 'axes',
    type: 'plot',
    x: 0.08,
    y: 0.06,
    w: 0.84,
    h: 0.88,
    background: true,
    plot: { kind: 'plot', ...view, curves: [{ expression: '0', label: 'zero', color: 'blue' }] },
  };
}
/** Use the existing production scene renderer as our baseline, without changing it. */
export function nativeScene(lesson: Lesson, progress: number, graph?: GraphGeometry, backward = false): SceneItem {
  if (lesson.kind === 'function')
    return {
      kind: 'scene',
      objects: [
        { id: 'function', type: 'plot', x: 0.03, y: 0.02, w: 0.94, h: 0.94, plot: functionPlot(lesson, progress) },
      ],
    };
  if (lesson.kind === 'linear-map') {
    const a = matrixAt(lesson.matrix, progress),
      v = multiply(a, lesson.input);
    const vectors: { id: string; tip: Point; color: 'blue' | 'green' | 'pink' | 'orange'; text: string }[] = [
      { id: 'input', tip: lesson.input, color: 'orange', text: 'v' },
      { id: 'basis1', tip: [a[0][0], a[1][0]], color: 'blue', text: 'A e₁' },
      { id: 'basis2', tip: [a[0][1], a[1][1]], color: 'green', text: 'A e₂' },
      { id: 'output', tip: v, color: 'pink', text: 'A v' },
    ];
    return {
      kind: 'scene',
      objects: [
        coordinatePlane(linearMapView(lesson)),
        ...vectors.map((o) => ({
          id: o.id,
          type: 'vector' as const,
          plotId: 'axes',
          x: 0,
          y: 0,
          w: o.tip[0],
          h: o.tip[1],
          color: o.color,
          text: o.text,
        })),
      ],
    };
  }
  if (!graph) return { kind: 'scene', objects: [] };
  const active = activeNodes(graph, progress, backward);
  return {
    kind: 'scene',
    objects: [
      ...graph.edges.map((e) => ({
        id: e.id,
        type: 'arrow' as const,
        x: e.tail[0],
        y: e.tail[1],
        w: e.tip[0] - e.tail[0],
        h: e.tip[1] - e.tail[1],
        color: 'blue' as const,
      })),
      ...graph.nodes.map((n) => ({
        id: n.id,
        type: 'circle' as const,
        x: n.center[0] - 0.035,
        y: n.center[1] - 0.055,
        w: 0.07,
        h: 0.11,
        text: n.label,
        color: active.has(n.id) ? ('pink' as const) : ('blue' as const),
      })),
    ],
  };
}
