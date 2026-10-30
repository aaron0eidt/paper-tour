// The plot board: curves that draw in on crisp axes (linear or log), the marks the code found on them (a root, a peak, a
// crossing, a value) as labelled points with guides to the axes, and measured points from the document over them. With
// no marks and no points it keeps its moving probe, which follows the narration across the curves. Geometry is in
// plotView.ts; the clock follows speech like the scatter's.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import katex from 'katex';
import { formatNumber, type PlotItem } from '../../../shared/plot';
import { BOARD_INK, BOARD_PALETTE, EASE_OUT, cubicBezier, plotCursor } from '../board';
import type { BoardPlayback } from '../engine';
import {
  PLOT_TIME,
  curveStart,
  curveValues,
  markStart,
  plotDescription,
  plotDuration,
  plotGeometry,
  pointStart,
  ramp,
} from '../plotView';
import { textMeasure, useBoxSize, useBuildClock, useFontsVersion } from './ScatterBoard';
import '../plot.css';

const easeOut = cubicBezier(...EASE_OUT);
const ink = (color: string): CSSProperties => ({ '--c': color }) as CSSProperties;
/** A mark on a crisp pixel: a 1 px line is sharp only when it is centred on one. */
const crisp = (v: number) => Math.round(v) + 0.5;
const short = (n: number) => formatNumber(n);
/** Plain words (a name with a unit) are set as text; anything with a symbol or a formula in it is typeset. */
const PLAIN = /^(?=.*\p{L}{3})[\p{L}\p{N}\s().,%/:–-]+$/u;
function MathLabel({ text }: { text: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(text, { throwOnError: true, trust: false, strict: 'ignore' });
    } catch {
      return null;
    }
  }, [text]);
  return PLAIN.test(text) ? (
    <span>{text}</span>
  ) : html ? (
    <span dangerouslySetInnerHTML={{ __html: html }} />
  ) : (
    <span>{text}</span>
  );
}

/** Word events own the position; this short tween only smooths the distance
 * between two observed words. Pausing/seeking immediately shows that exact
 * position and never leaves an independent sweep running in the background. */
export function useSpokenProgress(target: number, playing: boolean): number {
  const [shown, setShown] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!playing || reduce) {
      current.current = target;
      setShown(target);
      return;
    }
    const from = current.current;
    if (from === target) return;
    const start = performance.now();
    let raf = requestAnimationFrame(function tick(now) {
      const t = Math.min(1, (now - start) / 160);
      current.current = from + t * (target - from);
      setShown(current.current);
      if (t < 1) raf = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(raf);
  }, [target, playing]);
  return shown;
}

export function PlotBoard({
  item,
  focus,
  playback,
}: {
  item: PlotItem;
  focus: number | null;
  playback: BoardPlayback;
}) {
  const progress = useSpokenProgress(playback.progress, playback.playing);
  const [boxRef, space] = useBoxSize<HTMLDivElement>();
  const [topRef, top] = useBoxSize<HTMLDivElement>();
  const [restRef, rest] = useBoxSize<HTMLDivElement>();
  const fontsVersion = useFontsVersion();
  const fonts = useMemo(
    () => ({ tick: textMeasure(500, 11.5), label: textMeasure(600, 12), coords: textMeasure(500, 11) }),
    [fontsVersion],
  );
  // Marks and points make the plot a statement; without them the probe walks the curves with the narration.
  const probing = !item.marks?.length && !item.points?.length;
  const { x: probeX, a } = plotCursor(item, progress);
  // The plot takes the room the labels and the legend leave.
  const box = useMemo(
    () => (space ? { width: space.width, height: space.height - (top?.height ?? 0) - (rest?.height ?? 0) - 8 } : null),
    [space, top, rest],
  );
  const g = useMemo(() => (box ? plotGeometry(item, box, a, fonts) : null), [item, box, a, fonts]);
  const elapsed = useBuildClock(plotDuration(item), playback);
  const curves = item.curves.length;
  const inkOf = (i: number) => BOARD_INK[item.curves[i].color ?? BOARD_PALETTE[i]];
  const focusedCurve = focus !== null && focus < curves ? focus : null;
  const focusedMark = focus !== null && focus >= curves ? focus - curves : null;
  const outputs = probing ? curveValues(item, probeX, a) : [];
  const axes = easeOut(ramp(elapsed, 0, PLOT_TIME.axes));
  const document = item.source === 'document';
  const caption = document
    ? 'Function from the document'
    : item.points?.length
      ? 'Points measured in the document · curves illustrative'
      : 'Illustrative function · not measured data';

  return (
    <div className={`plotboard${focus !== null ? ' has-focus' : ''}`} ref={boxRef}>
      <div className="pl-ylabel" ref={topRef}>
        <MathLabel text={item.y_label ?? 'f(x)'} />
      </div>
      {g && (
        <svg className="pl-svg" width={g.width} height={g.height} role="img" aria-label={plotDescription(item, a)}>
          <g className="pl-axes" opacity={axes}>
            <g className="pl-grid">
              {g.yTicks.map((t) => (
                <line key={`y${t.value}`} x1={g.plot.left} x2={g.plot.right} y1={crisp(t.at)} y2={crisp(t.at)} />
              ))}
              {g.xTicks.map((t) => (
                <line key={`x${t.value}`} x1={crisp(t.at)} x2={crisp(t.at)} y1={g.plot.top} y2={g.plot.bottom} />
              ))}
            </g>
            <path
              className="pl-axis"
              d={`M${crisp(g.plot.left)} ${g.plot.top}V${crisp(g.plot.bottom)}H${g.plot.right}`}
            />
            <path
              className="pl-ticks"
              d={[
                ...g.yTicks.map((t) => `M${g.plot.left - 4} ${crisp(t.at)}H${g.plot.left}`),
                ...g.xTicks.map((t) => `M${crisp(t.at)} ${g.plot.bottom}V${g.plot.bottom + 4}`),
                ...g.yMinor.map((at) => `M${g.plot.left - 2} ${crisp(at)}H${g.plot.left}`),
                ...g.xMinor.map((at) => `M${crisp(at)} ${g.plot.bottom}V${g.plot.bottom + 2}`),
              ].join('')}
            />
            {g.yTicks.map((t) => (
              <text
                key={`yl${t.value}`}
                className="pl-tick"
                x={g.plot.left - 8}
                y={t.at}
                textAnchor="end"
                dominantBaseline="central"
              >
                {t.label}
              </text>
            ))}
            {g.xTicks.map((t) => (
              <text
                key={`xl${t.value}`}
                className="pl-tick"
                x={t.at}
                y={g.plot.bottom + 16}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {t.label}
              </text>
            ))}
          </g>

          {item.curves.map((_, i) => {
            const drawn = easeOut(ramp(elapsed, curveStart(i), PLOT_TIME.curve));
            return (
              <g key={i} className={`pl-curve-group${i === focusedCurve ? ' is-focus' : ''}`} style={ink(inkOf(i))}>
                <path
                  className="pl-curve"
                  d={g.paths[i]}
                  pathLength={1}
                  style={{ strokeDashoffset: 1 - drawn, opacity: drawn > 0 ? 1 : 0 }}
                />
              </g>
            );
          })}

          {probing &&
            item.curves.map((_, i) => {
              const value = outputs[i];
              const shown = Number.isFinite(value) && value >= item.y[0] && value <= item.y[1];
              if (!shown || !(focusedCurve === i || (focusedCurve === null && i === 0))) return null;
              return (
                <g
                  key={`probe${i}`}
                  className="pl-probe"
                  style={ink(inkOf(i))}
                  opacity={ramp(elapsed, curveStart(i) + 500, 400)}
                >
                  <path className="pl-guide" d={`M${g.x(probeX)} ${g.plot.bottom}V${g.y(value)}H${g.plot.left}`} />
                  <circle className="pl-dot" cx={g.x(probeX)} cy={g.y(value)} r={5} />
                </g>
              );
            })}

          {g.points.map((point, i) => {
            const arrive = easeOut(ramp(elapsed, pointStart(item, i), PLOT_TIME.point));
            return (
              <g key={`p${i}`} className="pl-point" opacity={arrive}>
                <circle cx={point.x} cy={point.y} r={4.5 + 3 * (1 - arrive)} />
                {point.label && (
                  <text
                    x={point.labelLeft}
                    y={point.y}
                    textAnchor={point.labelLeft < point.x ? 'end' : 'start'}
                    dominantBaseline="central"
                  >
                    {point.label}
                  </text>
                )}
              </g>
            );
          })}

          {g.marks.map((placed) => {
            const k = placed.mark.index;
            const arrive = easeOut(ramp(elapsed, markStart(item, k), PLOT_TIME.mark));
            const text = ramp(elapsed, markStart(item, k) + 220, 320);
            const lit = focusedMark === k;
            const color = inkOf(Math.max(0, placed.mark.curve - 1));
            const crossing = placed.mark.type === 'crossing';
            return (
              <g
                key={`m${k}`}
                className={`pl-mark${lit ? ' is-focus' : ''}`}
                style={ink(crossing ? 'var(--text)' : color)}
              >
                <path
                  className="pl-guide"
                  d={`M${placed.x} ${placed.y}V${g.plot.bottom}M${placed.x} ${placed.y}H${g.plot.left}`}
                  pathLength={2}
                  style={{ strokeDasharray: '3 4', opacity: arrive }}
                />
                <g transform={`translate(${placed.x} ${placed.y - 14 * (1 - arrive)})`} opacity={arrive}>
                  <g className="pl-pop">
                    <circle className="pl-halo" r={11} />
                    <circle className="pl-core" r={5.5} />
                  </g>
                </g>
                <g className="pl-pill" opacity={text}>
                  <rect
                    x={placed.rect.left}
                    y={placed.rect.top}
                    width={placed.rect.right - placed.rect.left}
                    height={placed.rect.bottom - placed.rect.top}
                    rx={6}
                  />
                  <text
                    className="pl-pill-name"
                    x={placed.rect.left + 9}
                    y={placed.rect.top + 12}
                    dominantBaseline="central"
                  >
                    {placed.name}
                  </text>
                  <text
                    className="pl-pill-coords"
                    x={placed.rect.left + 9}
                    y={placed.rect.top + 25}
                    dominantBaseline="central"
                  >
                    {placed.coords}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      )}
      <div className="pl-rest" ref={restRef}>
        <div className="pl-xlabel">
          <MathLabel text={item.x_label ?? 'x'} />
        </div>
        <ul className="pl-legend">
          {item.curves.map((c, i) => (
            <li key={i} className={i === focusedCurve ? 'is-focus' : undefined} style={{ color: inkOf(i) }}>
              <i />
              <MathLabel text={c.label} />
            </li>
          ))}
        </ul>
        {(probing || item.parameter) && (
          <dl className="pl-stats" aria-label="Current illustrative values">
            {probing && (
              <div>
                <dt>
                  <MathLabel text={item.x_label ?? 'x'} />
                </dt>
                <dd>{short(probeX)}</dd>
              </div>
            )}
            {item.parameter && (
              <div>
                <dt>a</dt>
                <dd>{short(a)}</dd>
              </div>
            )}
            {probing &&
              item.curves.map((curve, i) => (
                <div key={i} style={{ color: inkOf(i) }}>
                  <dt>
                    <MathLabel text={curve.label} />
                  </dt>
                  <dd>{Number.isFinite(outputs[i]) ? short(outputs[i]) : '—'}</dd>
                </div>
              ))}
          </dl>
        )}
        {item.parameter && probing && <p className="pl-note">Fixed input · parameter a changes with the explanation</p>}
        <p className="pl-note">
          {caption}
          {item.marks?.length ? ' · marked points computed from the curves' : ''}
        </p>
      </div>
    </div>
  );
}
