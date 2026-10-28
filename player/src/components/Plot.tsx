import { useEffect, useMemo, useRef, useState } from 'react';
import katex from 'katex';
import { evaluateExpression, parseExpression, plotSegments, type PlotItem } from '../../../shared/plot';
import { BOARD_INK, BOARD_PALETTE, plotCursor } from '../board';

import type { BoardPlayback } from '../engine';

const WIDTH = 480,
  HEIGHT = 300;
const M = { left: 48, right: 20, top: 24, bottom: 42 };
const short = (n: number) => Number(n.toPrecision(3)).toString();
function MathLabel({ text }: { text: string }) {
  const html = useMemo(() => {
    try {
      return katex.renderToString(text, { throwOnError: true, trust: false, strict: 'ignore' });
    } catch {
      return null;
    }
  }, [text]);
  return html ? <span dangerouslySetInnerHTML={{ __html: html }} /> : <span>{text}</span>;
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

export function PlotBoard({ item, focus, playback }: { item: PlotItem; focus: number | null; playback: BoardPlayback }) {
  const progress = useSpokenProgress(playback.progress, playback.playing);
  const trees = useMemo(() => item.curves.map((c) => parseExpression(c.expression)), [item]);
  const { x: px, a } = plotCursor(item, progress);
  const outputs = trees.map(tree => evaluateExpression(tree, px, a));
  const x = (v: number) => M.left + ((v - item.x[0]) / (item.x[1] - item.x[0])) * (WIDTH - M.left - M.right);
  const y = (v: number) =>
    HEIGHT - M.bottom - ((v - item.y[0]) / (item.y[1] - item.y[0])) * (HEIGHT - M.top - M.bottom);
  const paths = trees.map((tree) =>
    plotSegments(tree, item, a)
      .map((segment) =>
        segment.map(([px, py], i) => `${i ? 'L' : 'M'}${x(px).toFixed(2)},${y(py).toFixed(2)}`).join(' '),
      )
      .join(' '),
  );
  return (
    <div className="plot">
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={item.title ?? 'Illustrative function plot'}>
        {[0, 0.25, 0.5, 0.75, 1].map((fraction) => {
          const vx = item.x[0] + fraction * (item.x[1] - item.x[0]);
          const vy = item.y[0] + fraction * (item.y[1] - item.y[0]);
          return (
            <g key={fraction} className="plot-grid">
              <line x1={x(vx)} x2={x(vx)} y1={M.top} y2={HEIGHT - M.bottom} />
              <line x1={M.left} x2={WIDTH - M.right} y1={y(vy)} y2={y(vy)} />
              <text x={x(vx)} y={HEIGHT - M.bottom + 20} textAnchor="middle">
                {short(vx)}
              </text>
              <text x={M.left - 8} y={y(vy)} textAnchor="end" dominantBaseline="central">
                {short(vy)}
              </text>
            </g>
          );
        })}
        <path className="plot-axis" d={`M${M.left},${M.top}V${HEIGHT - M.bottom}H${WIDTH - M.right}`} />
        {item.curves.map((curve, i) => {
          const py = outputs[i];
          const ink = BOARD_INK[curve.color ?? BOARD_PALETTE[i]];
          return (
            <g key={i} opacity={focus === null || focus === i ? 1 : 0.7} style={{ color: ink }}>
              <path className="plot-curve" d={paths[i]} pathLength={1} />
              {Number.isFinite(py) && py >= item.y[0] && py <= item.y[1] && (
                <>
                  {(focus === i || (focus === null && i === 0)) && <path className="plot-probe" d={`M${x(px)},${HEIGHT - M.bottom}V${y(py)}H${M.left}`} stroke={ink} />}
                  <circle cx={x(px)} cy={y(py)} r={5} fill={ink} />
                </>
              )}
            </g>
          );
        })}
      </svg>
      <div className="plot-axis-labels">
        <MathLabel text={item.x_label ?? 'x'} />
        <MathLabel text={item.y_label ?? 'f(x)'} />
      </div>
      <ul className="plot-legend">
        {item.curves.map((c, i) => (
          <li key={i} style={{ color: BOARD_INK[c.color ?? BOARD_PALETTE[i]] }}>
            <MathLabel text={c.label} />
          </li>
        ))}
      </ul>
      <dl className="plot-values" aria-label="Current illustrative values">
        <div><dt><MathLabel text={item.x_label ?? 'x'} /></dt><dd>{short(px)}</dd></div>
        {item.parameter && <div><dt>a</dt><dd>{short(a)}</dd></div>}
        {item.curves.map((curve, i) => <div key={i} style={{ color: BOARD_INK[curve.color ?? BOARD_PALETTE[i]] }}>
          <dt><MathLabel text={curve.label} /></dt><dd>{Number.isFinite(outputs[i]) ? short(outputs[i]) : '—'}</dd>
        </div>)}
      </dl>
      {item.parameter && <p className="plot-parameter">Fixed input · parameter a changes with the explanation</p>}
      <p className="plot-caption">Illustrative function · not measured data</p>
    </div>
  );
}
