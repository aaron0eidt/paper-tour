function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const assert = {
  equal,
  deepEqual: equal,
  ok: (condition: unknown) => {
    if (!condition) throw new Error('Assertion failed');
  },
  rejects: async (work: Promise<unknown>, pattern: RegExp) => {
    try {
      await work;
    } catch (error) {
      if (pattern.test(String(error))) return;
      throw error;
    }
    throw new Error('Expected rejection');
  },
};
import { sceneProblems } from '../../shared/scene';
import { evaluateExpression, parseExpression } from '../../shared/plot';
import { layoutGraph } from '../src/math-lab/layout';
import { vec } from 'mafs';
import {
  activeNodes,
  functionPlot,
  functionState,
  lessons,
  matrixAt,
  linearMapView,
  mafsMatrix,
  multiply,
  nativeScene,
  type GraphLesson,
  type Matrix,
} from '../src/math-lab/model';
const matrix: Matrix = [
  [1.4, 0.7],
  [0.3, 1.1],
];
for (const a of [
  matrix,
  [
    [0, -1],
    [1, 0],
  ] as Matrix,
]) {
  const lesson = { kind: 'linear-map' as const, title: 'bounds', matrix: a, input: [1, -0.5] as [number, number] };
  const view = linearMapView(lesson);
  const baseline = nativeScene(lesson, 0).objects.find((o) => o.id === 'axes')!.plot!;
  assert.deepEqual(baseline.x, view.x);
  assert.deepEqual(baseline.y, view.y);
  for (const progress of [0, 0.5, 1]) {
    const at = matrixAt(a, progress);
    for (const point of [
      multiply(at, lesson.input),
      [at[0][0], at[1][0]],
      [at[0][1], at[1][1]],
      [at[0][0] + at[0][1], at[1][0] + at[1][1]],
    ]) {
      assert.ok(point[0] > view.x[0] && point[0] < view.x[1] && point[1] > view.y[0] && point[1] < view.y[1]);
    }
  }
}
assert.deepEqual(matrixAt(matrix, 0), [
  [1, 0],
  [0, 1],
]);
assert.deepEqual(matrixAt(matrix, 1), matrix);
assert.deepEqual(vec.transform([1, 1], mafsMatrix(matrix)), multiply(matrix, [1, 1]));
assert.deepEqual(
  multiply(matrix, [1, 1]).map((n) => Number(n.toFixed(6))),
  [2.1, 1.4],
);
assert.deepEqual(matrixAt(matrix, 0.5), [
  [1.2, 0.35],
  [0.15, 1.05],
]);
const f = lessons[0];
assert.equal(f.kind, 'function');
if (f.kind !== 'function') throw new Error('fixture');
for (const progress of [0, 0.5, 1]) {
  const state = functionState(f, progress),
    plot = functionPlot(f, progress);
  assert.ok(
    Math.abs(evaluateExpression(parseExpression(plot.curves[1].expression), 1, plot.parameter!.from) - state.fn(1)) <
      1e-10,
  );
  assert.deepEqual(sceneProblems(nativeScene(f, progress)), []);
  assert.deepEqual(sceneProblems(nativeScene(lessons[1], progress)), []);
}
assert.ok(functionState(f, 1).slope(0) < functionState(f, 0).slope(0));
const graph = await layoutGraph(lessons[2] as GraphLesson);
assert.equal(graph.nodes.length, 9);
assert.equal(graph.edges.length, 12);
assert.equal(new Set(graph.nodes.map((n) => n.id)).size, 9);
assert.equal(nativeScene(lessons[2], 0, graph).objects.length, 21);
assert.ok(sceneProblems(nativeScene(lessons[2], 0, graph)).some((problem) => /overlap/.test(problem)));
for (const n of graph.nodes) assert.ok(n.center.every((p) => p > 0 && p < 1));
assert.deepEqual([...activeNodes(graph, 0, true)], ['E']);
const scrambled = {
  ...graph,
  nodes: graph.nodes.map((n) => ({ ...n, center: [1 - n.center[0], n.center[1]] as [number, number] })),
};
assert.deepEqual([...activeNodes(graph, 0, false)], [...activeNodes(scrambled, 0, false)]);
await assert.rejects(
  layoutGraph({
    kind: 'graph',
    title: 'bad',
    nodes: [{ id: 'a', label: 'a' }],
    edges: [{ id: 'e', from: 'a', to: 'missing' }],
  }),
  /endpoints/,
);
console.log(
  'Math lab: matrix interpolation, numerical parity, source topology, reverse traversal and native validation passed.',
);
