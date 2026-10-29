import { Mafs, Coordinates, Plot, Vector, Text, Point, Transform, Line, Circle, MovablePoint, Polygon } from 'mafs';
import {
  activeNodes,
  functionState,
  matrixAt,
  linearMapView,
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
        <Coordinates.Cartesian
          xAxis={{ lines: 2, labels: (n) => (n % 2 === 0 ? String(n) : '') }}
          yAxis={{ lines: 0.5, labels: (n) => (n >= 0 && n <= 1 ? String(n) : '') }}
          subdivisions={false}
        />
        <Plot.OfX y={(x) => functionState(lesson, 0).fn(x)} color={palette.muted} style="dashed" opacity={0.6} />
        <Plot.OfX y={state.fn} color={palette.blue} weight={2.5} />
        <Line.Segment
          point1={[sample, 0]}
          point2={[sample, state.fn(sample)]}
          color={palette.pink}
          style="dashed"
          opacity={0.6}
        />
        <Point x={sample} y={state.fn(sample)} color={palette.pink} />
        <Text x={sample + 1.25} y={Math.max(0.1, state.fn(sample) - 0.12)} size={17} color={palette.pink}>
          f(1) = {state.fn(sample).toFixed(2)}
        </Text>
      </Mafs>
    );
  }
  if (lesson.kind === 'linear-map') {
    const a = matrixAt(lesson.matrix, progress),
      v = multiply(a, lesson.input);
    return (
      <Mafs height={350} viewBox={{ ...linearMapView(lesson), padding: 0.1 }} pan={false} zoom={false}>
        <g opacity={0.35}>
          <Coordinates.Cartesian xAxis={{ lines: false, labels: false }} yAxis={{ lines: false, labels: false }} />
        </g>
        <Polygon
          points={[
            [0, 0],
            [a[0][0], a[1][0]],
            [a[0][0] + a[0][1], a[1][0] + a[1][1]],
            [a[0][1], a[1][1]],
          ]}
          color={palette.blue}
          fillOpacity={0.035}
          strokeOpacity={0.2}
          weight={1}
        />
        <Transform matrix={mafsMatrix(a)}>
          {Array.from({ length: 5 }, (_, i) => i - 2).map((k) => (
            <g key={k}>
              <Line.Segment point1={[k, -3]} point2={[k, 3]} color={palette.blue} opacity={0.12} weight={1} />
              <Line.Segment point1={[-3, k]} point2={[3, k]} color={palette.green} opacity={0.12} weight={1} />
            </g>
          ))}
        </Transform>
        <Vector tip={lesson.input} color={palette.yellow} opacity={0.6} weight={1.5} />
        <Text x={lesson.input[0] + 0.12} y={lesson.input[1] - 0.18} size={17} color={palette.yellow}>
          v
        </Text>
        <Vector tip={[a[0][0], a[1][0]]} color={palette.blue} weight={1.6} />
        <Text x={a[0][0]} y={a[1][0] - 0.2} size={17} color={palette.blue}>
          A e₁
        </Text>
        <Vector tip={[a[0][1], a[1][1]]} color={palette.green} weight={1.6} />
        <Text x={a[0][1] - 0.27} y={a[1][1] + 0.1} size={17} color={palette.green}>
          A e₂
        </Text>
        <Vector tip={v} color={palette.pink} weight={2.2} opacity={Math.min(1, progress * 4)} />
        <Text
          x={v[0] + 0.22}
          y={v[1] + 0.18}
          color={palette.pink}
          size={19}
          svgTextProps={{ opacity: Math.min(1, progress * 4) }}
        >
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
      preserveAspectRatio="contain"
      pan={false}
      zoom={false}
    >
      {graph.edges.map((e) => {
        const lit = active.has(backward ? e.to : e.from),
          tail = map(backward ? e.tip : e.tail),
          tip = map(backward ? e.tail : e.tip);
        return (
          <Vector
            key={e.id}
            tail={tail}
            tip={tip}
            color={lit ? palette.pink : palette.blue}
            opacity={lit ? 1 : 0.5}
            weight={lit ? 2 : 1}
          />
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
