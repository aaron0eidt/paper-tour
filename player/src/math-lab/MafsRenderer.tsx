import { Mafs, Coordinates, Plot, Vector, Text, Point, Transform, Line, Circle, MovablePoint } from 'mafs';
import {
  activeNodes,
  functionState,
  matrixAt,
  mafsMatrix,
  multiply,
  palette,
  type GraphGeometry,
  type Lesson,
  type Point as Vec,
} from './model';
import 'mafs/core.css';
export function MafsRenderer({
  lesson,
  progress,
  graph,
  backward,
  onInput,
}: {
  lesson: Lesson;
  progress: number;
  graph?: GraphGeometry;
  backward: boolean;
  onInput: (p: Vec) => void;
}) {
  if (lesson.kind === 'function') {
    const state = functionState(lesson, progress),
      sample = 1;
    return (
      <Mafs
        height={350}
        viewBox={{ x: lesson.domain, y: lesson.range, padding: 0.1 }}
        preserveAspectRatio={false}
        pan={false}
        zoom={false}
      >
        <Coordinates.Cartesian yAxis={{ lines: 0.25 }} />
        <Plot.OfX y={(x) => functionState(lesson, 0).fn(x)} color={palette.muted} style="dashed" />
        <Plot.OfX y={state.fn} color={palette.blue} weight={3} />
        <Line.Segment point1={[sample, 0]} point2={[sample, state.fn(sample)]} color={palette.pink} style="dashed" />
        <Point x={sample} y={state.fn(sample)} color={palette.pink} />
        <Text x={2.7} y={0.16} size={16} color={palette.pink}>
          f(1) = {state.fn(sample).toFixed(2)}
        </Text>
      </Mafs>
    );
  }
  if (lesson.kind === 'linear-map') {
    const a = matrixAt(lesson.matrix, progress),
      v = multiply(a, lesson.input);
    return (
      <Mafs height={350} viewBox={{ x: [-4, 4], y: [-3, 3] }} pan={false} zoom={false}>
        <g opacity={0.15}>
          <Coordinates.Cartesian />
        </g>
        <Transform matrix={mafsMatrix(a)}>
          {Array.from({ length: 9 }, (_, i) => i - 4).map((k) => (
            <g key={k}>
              <Line.Segment point1={[k, -4]} point2={[k, 4]} color={palette.blue} opacity={0.3} />
              <Line.Segment point1={[-4, k]} point2={[4, k]} color={palette.green} opacity={0.3} />
            </g>
          ))}
        </Transform>
        <Vector tip={lesson.input} color={palette.yellow} opacity={0.55} />
        <Vector tip={[a[0][0], a[1][0]]} color={palette.blue} />
        <Text x={a[0][0]} y={a[1][0] - 0.25} size={16} color={palette.blue}>
          A e₁
        </Text>
        <Vector tip={[a[0][1], a[1][1]]} color={palette.green} />
        <Text x={a[0][1] - 0.32} y={a[1][1]} size={16} color={palette.green}>
          A e₂
        </Text>
        <Vector tip={v} color={palette.pink} weight={3} />
        <Text x={v[0] + 0.25} y={v[1] + 0.15} color={palette.pink} size={18}>
          A v
        </Text>
        <MovablePoint
          point={lesson.input}
          onMove={onInput}
          constrain={(p) => [Math.max(-1.5, Math.min(1.5, p[0])), Math.max(-1.5, Math.min(1.5, p[1]))]}
          color={palette.yellow}
        />
      </Mafs>
    );
  }
  if (!graph) return <div className="lab-loading">Graph-Layout wird berechnet…</div>;
  const active = activeNodes(graph, progress, backward),
    map = (p: Vec): Vec => [p[0] * 10, -p[1] * 6];
  return (
    <Mafs
      height={350}
      viewBox={{ x: [0, 10], y: [-6, 0], padding: 0 }}
      preserveAspectRatio={false}
      pan={false}
      zoom={false}
    >
      {graph.edges.map((e) => {
        const lit = active.has(backward ? e.from : e.to),
          tail = map(backward ? e.tip : e.tail),
          tip = map(backward ? e.tail : e.tip);
        return (
          <Vector key={e.id} tail={tail} tip={tip} color={lit ? palette.pink : palette.muted} weight={lit ? 3 : 1.3} />
        );
      })}
      {graph.nodes.map((n) => (
        <g key={n.id}>
          <Circle
            center={map(n.center)}
            radius={0.31}
            color={active.has(n.id) ? palette.pink : palette.blue}
            fillOpacity={active.has(n.id) ? 0.2 : 0.08}
          />
          <Text x={n.center[0] * 10} y={-n.center[1] * 6} size={18}>
            {n.label}
          </Text>
        </g>
      ))}
    </Mafs>
  );
}
