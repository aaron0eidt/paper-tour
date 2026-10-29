// The scatter board: points on two measured axes, arriving one after another. The better corner is a soft wash with a
// small mark, the points of a series are joined in x order, and the point in focus grows, shows its two values on the
// axes and leaves the others muted. The clock follows speech like the bars' (it pauses with the narration, and a silent
// seek or reduced motion shows the finished plot). Geometry is in scatter.ts.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { scatterSeries } from '../../../shared/scatter';
import type { ScatterItem } from '../../../shared/scatter';
import { BOARD_INK, BOARD_PALETTE, EASE_OUT, cubicBezier } from '../board';
import type { BoardPlayback } from '../engine';
import {
  SCATTER_DOT,
  SCATTER_LINE,
  SCATTER_TIME,
  ramp,
  scatterArrival,
  scatterDescription,
  scatterDuration,
  scatterGeometry,
  scatterReadout,
  segmentStart,
} from '../scatter';
import '../scatter.css';

const ACCENT = 'var(--accent)';
const easeOut = cubicBezier(...EASE_OUT);

export const reducedMotion = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** The element's content-box size in px, kept up to date; null before the first layout. */
export function useBoxSize<T extends HTMLElement>(): [RefObject<T>, { width: number; height: number } | null] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize((prev) =>
        prev && prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Measures text in the player's font at the given weight and size, the way the board draws it. */
export function textMeasure(weight: number, size: number): (text: string) => number {
  measureContext ??= document.createElement('canvas').getContext('2d');
  const family = getComputedStyle(document.documentElement).fontFamily;
  const font = `${weight} ${size}px ${family}`;
  return (text) => {
    if (!measureContext) return text.length * size * 0.56;
    measureContext.font = font;
    return measureContext.measureText(text).width;
  };
}

/** Counts up once the page's fonts have loaded, so text measured before then is measured again. */
export function useFontsVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    void document.fonts?.ready.then(() => alive && setVersion((v) => v + 1));
    return () => {
      alive = false;
    };
  }, []);
  return version;
}

/**
 * Milliseconds since the build began, ticking until `end`. It runs with the narration: paused speech holds it, a silent
 * seek or reduced motion jumps to the end, and a board shown while nothing plays starts finished.
 */
export function useBuildClock(end: number, playback: BoardPlayback): number {
  const { playing } = playback;
  const complete = !playing && playback.progress >= 1;
  const [elapsed, setElapsed] = useState(() => (reducedMotion() || !playing ? end : 0));
  const current = useRef(elapsed);
  useEffect(() => {
    if (reducedMotion() || complete) {
      current.current = end;
      setElapsed(end);
      return;
    }
    if (!playing || current.current >= end) return;
    const start = performance.now() - current.current;
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(end, now - start);
      current.current = t;
      setElapsed(t);
      if (t < end) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [end, playing, complete]);
  return elapsed;
}

const ink = (color: string): CSSProperties => ({ '--c': color }) as CSSProperties;
/** A mark on a crisp pixel: a 1 px line is sharp only when it is centred on one. */
const crisp = (v: number) => Math.round(v) + 0.5;

export function ScatterBoard({
  item,
  focus,
  playback,
}: {
  item: ScatterItem;
  focus: number | null;
  playback: BoardPlayback;
}) {
  const [boxRef, space] = useBoxSize<HTMLDivElement>();
  const [legendRef, legend] = useBoxSize<HTMLDivElement>();
  const elapsed = useBuildClock(scatterDuration(item.points.length), playback);
  const fontsVersion = useFontsVersion();
  const fonts = useMemo(
    () => ({ tick: textMeasure(500, 11.5), label: textMeasure(650, 12.5), title: textMeasure(500, 12) }),
    [fontsVersion],
  );
  // The plot takes the room the legend leaves.
  const box = useMemo(
    () => (space ? { width: space.width, height: space.height - (legend?.height ?? 0) } : null),
    [space, legend],
  );
  const geometry = useMemo(() => (box ? scatterGeometry(item, box, fonts) : null), [item, box, fonts]);
  const series = useMemo(() => scatterSeries(item.points), [item]);
  const focused = focus !== null && focus < item.points.length ? focus : null;
  const readout = useMemo(
    () => (geometry && focused !== null ? scatterReadout(geometry, focused, item, fonts.tick) : null),
    [geometry, focused, item, fonts],
  );
  const gradient = useId().replace(/:/g, '');
  // A series has its own colour; with series on the plot, a point without one is muted, else all share the accent.
  const seriesInk = (s: number | null) =>
    s === null ? (series.length ? 'var(--board-edge)' : ACCENT) : BOARD_INK[BOARD_PALETTE[s % BOARD_PALETTE.length]];

  const g = geometry;
  const plot = g?.plot;
  const lit = g && focused !== null ? g.points[focused] : null;
  const axes = easeOut(ramp(elapsed, 0, SCATTER_TIME.axes));
  const wash = easeOut(ramp(elapsed, 120, 700));
  const showLegend = series.length > 0 || item.source === 'illustrative';

  return (
    <div className={`scatter${focused !== null ? ' has-focus' : ''}`} ref={boxRef}>
      {showLegend && (
        <div className="sc-legend" ref={legendRef}>
          {series.map((name, s) => (
            <span key={name} className="sc-series" style={ink(seriesInk(s))}>
              <i />
              {name}
            </span>
          ))}
          {item.source === 'illustrative' && <span className="sc-tag">illustrative values</span>}
        </div>
      )}
      {g && plot && (
        <svg className="sc-svg" width={g.width} height={g.height} role="img" aria-label={scatterDescription(item)}>
          {g.wash && (
            <>
              <defs>
                <linearGradient
                  id={gradient}
                  gradientUnits="userSpaceOnUse"
                  x1={g.wash.x1}
                  y1={g.wash.y1}
                  x2={g.wash.x2}
                  y2={g.wash.y2}
                >
                  <stop offset="0" style={{ stopColor: ACCENT, stopOpacity: 0 }} />
                  <stop offset="0.5" style={{ stopColor: ACCENT, stopOpacity: 0.025 }} />
                  <stop offset="1" style={{ stopColor: ACCENT, stopOpacity: 0.2 }} />
                </linearGradient>
              </defs>
              <rect
                x={plot.left}
                y={plot.top}
                width={plot.right - plot.left}
                height={plot.bottom - plot.top}
                fill={`url(#${gradient})`}
                opacity={wash}
              />
            </>
          )}
          <g className="sc-axes" opacity={axes}>
            <g className="sc-grid">
              {g.yTicks.map((t) => (
                <line key={t.value} x1={plot.left} x2={plot.right} y1={crisp(t.at)} y2={crisp(t.at)} />
              ))}
              {g.xTicks.map((t) => (
                <line key={t.value} x1={crisp(t.at)} x2={crisp(t.at)} y1={plot.top} y2={plot.bottom} />
              ))}
            </g>
            <path className="sc-axis" d={`M${crisp(plot.left)} ${plot.top}V${crisp(plot.bottom)}H${plot.right}`} />
            <path
              className="sc-marks"
              d={[
                ...g.yTicks.map((t) => `M${plot.left - 4} ${crisp(t.at)}H${plot.left}`),
                ...g.xTicks.map((t) => `M${crisp(t.at)} ${plot.bottom}V${plot.bottom + 4}`),
                ...g.yMinor.map((at) => `M${plot.left - 2} ${crisp(at)}H${plot.left}`),
                ...g.xMinor.map((at) => `M${crisp(at)} ${plot.bottom}V${plot.bottom + 2}`),
              ].join('')}
            />
            {g.yTicks.map((t, i) => (
              <text
                key={t.value}
                className={`sc-tick${readout?.hideY.includes(i) ? ' is-hidden' : ''}`}
                x={plot.left - 8}
                y={t.at}
                textAnchor="end"
                dominantBaseline="central"
              >
                {t.label}
              </text>
            ))}
            {g.xTicks.map((t, i) => (
              <text
                key={t.value}
                className={`sc-tick${readout?.hideX.includes(i) ? ' is-hidden' : ''}`}
                x={t.at}
                y={plot.bottom + 15}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {t.label}
              </text>
            ))}
            <text className="sc-title" dominantBaseline="central">
              {g.yTitle.lines.map((line, i) => (
                <tspan key={i} x={g.yTitle.x} y={g.yTitle.y + i * SCATTER_LINE}>
                  {line}
                </tspan>
              ))}
            </text>
            <text className="sc-title" textAnchor="end" dominantBaseline="central">
              {g.xTitle.lines.map((line, i) => (
                <tspan key={i} x={g.xTitle.x} y={g.xTitle.y + i * SCATTER_LINE}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>

          {g.segments.map((segment) => {
            const drawn = easeOut(ramp(elapsed, segmentStart(segment), SCATTER_TIME.line));
            return (
              <path
                key={`${segment.from}:${segment.to}`}
                className="sc-line"
                d={segment.d}
                pathLength={1}
                style={{ ...ink(seriesInk(segment.series)), strokeDashoffset: 1 - drawn, opacity: drawn > 0 ? 1 : 0 }}
              />
            );
          })}

          {g.points.map((point, i) => {
            const arrive = easeOut(ramp(elapsed, scatterArrival(i), SCATTER_TIME.grow));
            const text = ramp(elapsed, scatterArrival(i) + SCATTER_TIME.label, 320);
            const { label } = point;
            return (
              <g key={i} className={`sc-point${i === focused ? ' is-focus' : ''}`} style={ink(seriesInk(point.series))}>
                <g
                  transform={`translate(${point.x} ${point.y}) scale(${(0.4 + 0.6 * arrive).toFixed(3)})`}
                  opacity={arrive}
                >
                  <g className="sc-dot">
                    <circle className="sc-halo" r={SCATTER_DOT.rest + 4} />
                    <circle className="sc-core" r={SCATTER_DOT.rest} />
                  </g>
                </g>
                <text className="sc-label" opacity={text} textAnchor={label.anchor} dominantBaseline="central">
                  {/* A label wrapped or cut to fit among the others is read in full while its point is in focus. */}
                  {(i === focused && label.whole ? [item.points[i].label] : label.lines).map((line, j, lines) => (
                    <tspan
                      key={j}
                      x={label.x}
                      y={label.top + label.height / 2 + (j - (lines.length - 1) / 2) * SCATTER_LINE}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            );
          })}

          {lit && readout && (
            <g
              key={`probe-${focused}`}
              className="sc-probe"
              style={ink(seriesInk(lit.series))}
              opacity={easeOut(ramp(elapsed, scatterArrival(lit.index), SCATTER_TIME.grow))}
            >
              <path className="sc-guide" d={`M${lit.x} ${lit.y}V${plot.bottom}M${lit.x} ${lit.y}H${plot.left}`} />
              {[readout.x, readout.y].map((badge, i) => (
                <g key={i} className="sc-badge">
                  <rect
                    x={badge.rect.left}
                    y={badge.rect.top}
                    width={badge.rect.right - badge.rect.left}
                    height={badge.rect.bottom - badge.rect.top}
                    rx={5}
                  />
                  <text
                    x={(badge.rect.left + badge.rect.right) / 2}
                    y={(badge.rect.top + badge.rect.bottom) / 2}
                    textAnchor="middle"
                    dominantBaseline="central"
                  >
                    {badge.text}
                  </text>
                </g>
              ))}
            </g>
          )}

          {g.better && (
            <g className="sc-better" opacity={wash}>
              <path d={g.better.arrow} />
              {g.better.text && (
                <text
                  x={g.better.text.x}
                  y={g.better.text.y}
                  textAnchor={g.better.text.anchor}
                  dominantBaseline="central"
                >
                  better
                </text>
              )}
            </g>
          )}
        </svg>
      )}
    </div>
  );
}
