import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import katex from 'katex';
import type { SceneItem, SceneObject } from '../../../shared/scene';
import { sceneMatrixText, scenePlotBounds } from '../../../shared/scene';
import { evaluateExpression, parseExpression, plotSegments, type PlotItem } from '../../../shared/plot';
import type { BoardPlayback } from '../engine';
import { BOARD_INK, BOARD_PALETTE, plotCursor } from '../board';
import { useSpokenProgress } from './Plot';
import { SCENE_HEIGHT as H, SCENE_WIDTH as W, interpolateScene, projectSceneObject, sceneArrow, sceneNumber, sceneObjects, sceneTransitionAllowed, type DrawnSceneObject } from '../sceneBoard';

const DURATION = 850;
const reduceMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Complete authored states supply the destination. The short interpolation is
 * interruptible, freezes when speech pauses, and a silent seek is exact. */
function useSceneState(item: SceneItem, playback: BoardPlayback): DrawnSceneObject[] {
  const [drawn, setDrawn] = useState(() => sceneObjects(item));
  const current = useRef(drawn);
  const transition = useRef({ item, from: drawn, elapsed: DURATION });
  const complete = !playback.playing && playback.progress >= 1;
  useLayoutEffect(() => {
    if (transition.current.item === item) return;
    transition.current = { item, from: current.current, elapsed: 0 };
  }, [item]);
  useEffect(() => {
    const state = transition.current;
    const update = (objects: DrawnSceneObject[]) => { current.current = objects; setDrawn(objects); };
    if (complete || reduceMotion() || !sceneTransitionAllowed(state.from, item)) {
      state.elapsed = DURATION;
      update(sceneObjects(item));
      return;
    }
    if (!playback.playing || state.elapsed >= DURATION) return;
    const start = performance.now() - state.elapsed;
    let frame = requestAnimationFrame(function tick(now) {
      state.elapsed = Math.min(DURATION, now - start);
      const t = state.elapsed / DURATION;
      update(interpolateScene(state.from, item, t * t * (3 - 2 * t)));
      if (t < 1) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [item, playback.playing, complete]);
  return drawn;
}

function MathText({ text }: { text: string }) {
  const html = useMemo(() => {
    try { return katex.renderToString(text, { throwOnError: true, trust: false, strict: 'ignore' }); }
    catch { return null; }
  }, [text]);
  return /^[\p{L}][\p{L}\s-]+$/u.test(text) ? <span>{text}</span> : html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <span>{text}</span>;
}

function ObjectText({ object, math = false }: { object: SceneObject; math?: boolean }) {
  return <foreignObject x={object.x * W} y={object.y * H} width={Math.abs(object.w) * W} height={Math.abs(object.h) * H}>
    <div className={`scene-object-text${math ? ' is-math' : ''}`}>
      {math ? <MathText text={object.text ?? ''} /> : object.text}
    </div>
  </foreignObject>;
}

function Matrix({ object }: { object: SceneObject }) {
  const rows = object.values ?? [], columns = rows[0]?.length ?? 0;
  if (!rows.length || !columns) return null;
  const x = object.x * W, y = object.y * H, w = object.w * W, h = object.h * H;
  const labelHeight = object.text ? Math.min(28, h * .23) : 0;
  const inset = 10, cw = (w - 2 * inset) / columns, ch = (h - labelHeight - 8) / rows.length;
  const longest = Math.max(...rows.flat().map(value => sceneMatrixText(value).length));
  const fontSize = Math.max(16, Math.min(21, cw / (longest * .64), ch * .48));
  return <>
    {object.text && <text x={x + w / 2} y={y + labelHeight / 2} textAnchor="middle" dominantBaseline="central" className="scene-matrix-label">{object.text}</text>}
    <path className="scene-matrix-bracket" d={`M${x + inset},${y + labelHeight}H${x + 3}V${y + h}H${x + inset}M${x + w - inset},${y + labelHeight}H${x + w - 3}V${y + h}H${x + w - inset}`} />
    {rows.flatMap((row, i) => row.map((value, j) => <g key={`${i}:${j}`}>
      <rect className="scene-matrix-cell" x={x + inset + cw * j + 2} y={y + labelHeight + ch * i + 4} width={Math.max(0, cw - 4)} height={Math.max(0, ch - 4)} rx={4} />
      <text x={x + inset + cw * (j + .5)} y={y + labelHeight + ch * (i + .5) + 4} textAnchor="middle" dominantBaseline="central" fontSize={fontSize}>{sceneMatrixText(value)}</text>
    </g>))}
  </>;
}

/** The same safe expression evaluator as a full-board plot, within a scene's
 * declared coordinate plane so vectors and matrices can be explained together. */
function EmbeddedPlot({ object, playback }: { object: SceneObject & { plot: PlotItem }; playback: BoardPlayback }) {
  const { plot } = object, width = object.w * W, height = object.h * H;
  const trees = useMemo(() => plot.curves.map(curve => parseExpression(curve.expression)), [plot]);
  const bounds = scenePlotBounds(object);
  const pad = { l: (bounds.x - object.x) * W, t: (bounds.y - object.y) * H };
  const iw = bounds.w * W, ih = bounds.h * H;
  const x = (v: number) => pad.l + (v - plot.x[0]) / (plot.x[1] - plot.x[0]) * iw;
  const y = (v: number) => pad.t + ih - (v - plot.y[0]) / (plot.y[1] - plot.y[0]) * ih;
  const { x: input, a } = plotCursor(plot, playback.progress);
  const output = trees.map(tree => evaluateExpression(tree, input, a));
  const zeroX = x(Math.max(plot.x[0], Math.min(plot.x[1], 0)));
  const zeroY = y(Math.max(plot.y[0], Math.min(plot.y[1], 0)));
  const readoutY = Math.min(height - 18, pad.t + ih + 18);
  return <>
    {[0, .5, 1].map(t => <g key={t} className="scene-plot-grid">
      <line x1={pad.l + t * iw} x2={pad.l + t * iw} y1={pad.t} y2={pad.t + ih} />
      <line x1={pad.l} x2={pad.l + iw} y1={pad.t + t * ih} y2={pad.t + t * ih} />
      <text x={pad.l + t * iw} y={pad.t + ih + 15} textAnchor="middle">{sceneNumber(plot.x[0] + t * (plot.x[1] - plot.x[0]))}</text>
      <text x={pad.l - 6} y={pad.t + ih - t * ih} textAnchor="end" dominantBaseline="central">{sceneNumber(plot.y[0] + t * (plot.y[1] - plot.y[0]))}</text>
    </g>)}
    <path className="scene-plot-axis" d={`M${pad.l},${zeroY}H${pad.l + iw}M${zeroX},${pad.t}V${pad.t + ih}`} />
    <g transform={`translate(9 ${pad.t + ih / 2}) rotate(-90)`}>
      <foreignObject x={-ih / 2} y={-8} width={ih} height={16}>
        <div className="scene-plot-axis-name"><MathText text={plot.y_label ?? 'f(x)'} /></div>
      </foreignObject>
    </g>
    {trees.map((tree, index) => {
      const path = plotSegments(tree, plot, a).map(segment => segment.map(([px, py], i) => `${i ? 'L' : 'M'}${x(px)},${y(py)}`).join(' ')).join(' ');
      const value = output[index], visible = Number.isFinite(value) && value >= plot.y[0] && value <= plot.y[1];
      const color = BOARD_INK[plot.curves[index].color ?? BOARD_PALETTE[index]];
      return <g key={index} style={{ color }}>
        <path d={path} className="scene-plot-curve" />
        {visible && <>
          {index === 0 && <path className="scene-plot-probe" d={`M${x(input)},${zeroY}V${y(value)}H${zeroX}`} />}
          <circle cx={x(input)} cy={y(value)} r={4} fill="currentColor" />
        </>}
      </g>;
    })}
    <foreignObject x={0} y={readoutY} width={width} height={height - readoutY}>
      <div data-scene-plot-values={object.id} className="scene-plot-values" aria-label="Current illustrative values">
        <span><MathText text={plot.x_label ?? 'x'} /> = {sceneNumber(input)}</span>
        {plot.parameter && <span>a = {sceneNumber(a)}</span>}
        {plot.curves.map((curve, i) => <span key={i} style={{ color: BOARD_INK[curve.color ?? BOARD_PALETTE[i]] }}>
          <MathText text={curve.label} /> = {Number.isFinite(output[i]) ? sceneNumber(output[i]) : '—'}
        </span>)}
      </div>
    </foreignObject>
  </>;
}

export function SceneBoard({ item, focus, playback }: { item: SceneItem; focus: number | null; playback: BoardPlayback }) {
  const objects = useSceneState(item, playback);
  const progress = useSpokenProgress(playback.progress, playback.playing);
  const focusedId = focus !== null ? item.objects[focus]?.id : undefined;
  const ordered = [...objects].sort((a, b) => Number(!!b.background) - Number(!!a.background));
  return <div className="native-scene">
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={item.title ?? 'Mathematical explanation'}>
      {ordered.map(authored => {
        const object = projectSceneObject(authored, objects);
        const { x, y, w, h } = object;
        const arrow = object.type === 'arrow' || object.type === 'vector' ? sceneArrow(object) : null;
        const label = `${object.text ?? object.id}${object.values ? `: ${object.values.map(row => row.map(sceneMatrixText).join(', ')).join('; ')}` : ''}`;
        return <g key={`${object.id}:${object.type}`} data-scene-object-id={object.id} data-scene-x={x} data-scene-y={y} data-scene-values={object.values ? JSON.stringify(object.values) : undefined}
          role="group" aria-label={label} opacity={object.opacity} className={`scene-object${focusedId === object.id ? ' is-focus' : ''}${object.background ? ' is-background' : ''}`}
          style={{ color: object.ink, '--c': object.ink } as CSSProperties}>
          {object.type === 'rect' && <rect className="scene-shape" x={x * W} y={y * H} width={w * W} height={h * H} rx={9} />}
          {object.type === 'circle' && <ellipse className="scene-shape" cx={(x + w / 2) * W} cy={(y + h / 2) * H} rx={w * W / 2} ry={h * H / 2} />}
          {arrow && <><path className={`scene-arrow${object.type === 'vector' ? ' is-vector' : ''}`} d={arrow.line} /><path className="scene-arrow-head" d={arrow.head} />
            {object.text && <text x={(x + w / 2) * W} y={(y + h / 2) * H - 10} textAnchor="middle" className="scene-arrow-label">{object.text}</text>}</>}
          {object.type === 'matrix' && <Matrix object={object} />}
          {object.type === 'plot' && object.plot && <svg x={x * W} y={y * H} width={w * W} height={h * H} viewBox={`0 0 ${w * W} ${h * H}`} overflow="hidden">
            <EmbeddedPlot object={{ ...object, plot: object.plot }} playback={{ ...playback, progress }} />
          </svg>}
          {['text', 'math', 'rect', 'circle'].includes(object.type) && object.text && <ObjectText object={object} math={object.type === 'math'} />}
        </g>;
      })}
    </svg>
  </div>;
}
