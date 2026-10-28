import { useEffect, useMemo, useState } from 'react';
import katex from 'katex';
import { evaluateExpression, parseExpression, plotSegments, type PlotItem } from '../../../shared/plot';
import { BOARD_INK, BOARD_PALETTE } from '../board';

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

export function PlotBoard({ item, focus }: { item: PlotItem; focus: number | null }) {
  const [progress, setProgress] = useState(() => (matchMedia('(prefers-reduced-motion: reduce)').matches ? 1 : 0));
  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let raf = 0,
      start: number | undefined;
    const tick = (now: number) => {
      start ??= now;
      const value = Math.min(1, (now - start) / 5000);
      setProgress(value);
      if (value < 1) raf = requestAnimationFrame(tick);
    };
    const begin = () => {
      cancelAnimationFrame(raf);
      if (reduced.matches) setProgress(1);
      else {
        start = undefined;
        setProgress(0);
        raf = requestAnimationFrame(tick);
      }
    };
    begin();
    reduced.addEventListener('change', begin);
    return () => {
      cancelAnimationFrame(raf);
      reduced.removeEventListener('change', begin);
    };
  }, [item]);
  const trees = useMemo(() => item.curves.map((c) => parseExpression(c.expression)), [item]);
  const a = item.parameter ? item.parameter.from + progress * (item.parameter.to - item.parameter.from) : 1;
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
  const px = item.x[0] + progress * (item.x[1] - item.x[0]);
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
          const py = evaluateExpression(trees[i], px, a);
          const ink = BOARD_INK[curve.color ?? BOARD_PALETTE[i]];
          return (
            <g key={i} opacity={focus === null || focus === i ? 1 : 0.3} style={{ color: ink }}>
              <path className="plot-curve" d={paths[i]} pathLength={1} />
              {Number.isFinite(py) && py >= item.y[0] && py <= item.y[1] && (
                <circle cx={x(px)} cy={y(py)} r={5} fill={ink} />
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
      {item.parameter && <p className="plot-parameter">a = {short(a)}</p>}
      <p className="plot-caption">Illustrative function · not measured data</p>
    </div>
  );
}
