import ELK from 'elkjs/lib/elk.bundled.js';
import type { GraphGeometry, GraphLesson, Point } from './model';
const elk = new ELK();
const layouts = new WeakMap<GraphLesson, Promise<GraphGeometry>>();
/** Layout is computed once per topology, not on each animation frame. */
export function layoutGraph(graph: GraphLesson): Promise<GraphGeometry> {
  const existing = layouts.get(graph);
  if (existing) return existing;
  const pending = computeLayout(graph).catch((error) => {
    layouts.delete(graph);
    throw error;
  });
  layouts.set(graph, pending);
  return pending;
}
async function computeLayout(graph: GraphLesson): Promise<GraphGeometry> {
  const ids = new Set(graph.nodes.map((n) => n.id));
  if (ids.size !== graph.nodes.length || graph.edges.some((e) => !ids.has(e.from) || !ids.has(e.to)))
    throw new Error('Graph identities and edge endpoints must be valid.');
  const result = await elk.layout({
    id: 'lesson',
    width: 0,
    height: 0,
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.spacing.nodeNode': '42',
      'elk.layered.spacing.nodeNodeBetweenLayers': '75',
      'elk.edgeRouting': 'POLYLINE',
    },
    children: graph.nodes.map((n) => ({ id: n.id, width: 52, height: 52 })),
    edges: graph.edges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
  });
  const width = result.width!,
    height = result.height!;
  const nodes = graph.nodes.map((n) => {
    const position = result.children!.find((p) => p.id === n.id)!;
    return {
      ...n,
      center: [0.08 + (0.84 * (position.x! + 26)) / width, 0.09 + (0.82 * (position.y! + 26)) / height] as Point,
    };
  });
  const centers = new Map(nodes.map((n) => [n.id, n.center]));
  const boundary = (from: Point, to: Point): Point => {
    const dx = to[0] - from[0],
      dy = to[1] - from[1],
      k = 1 / Math.sqrt((dx / 0.035) ** 2 + (dy / 0.055) ** 2);
    return [from[0] + dx * k, from[1] + dy * k];
  };
  return {
    nodes,
    edges: graph.edges.map((e) => ({
      ...e,
      tail: boundary(centers.get(e.from)!, centers.get(e.to)!),
      tip: boundary(centers.get(e.to)!, centers.get(e.from)!),
    })),
  };
}
