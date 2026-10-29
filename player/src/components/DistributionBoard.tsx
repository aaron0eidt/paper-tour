// The distribution board: one distribution, or two with the first morphing into the second (a bell curve that slides and
// narrows, bars that redistribute), and an optional shaded range whose chance is read off beneath. The morph follows the
// narration: a dist-2 cue (or the middle of the narration, when the cue was left out) starts it, it pauses with the
// speech, and a silent seek or reduced motion shows the finished state, the first distribution kept as a dashed ghost.
// Every density and chance is computed by shared/distribution.ts. Geometry is in distribution.ts.

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { describeSpec, summary } from '../../../shared/distribution';
import type { DistributionItem } from '../../../shared/distribution';
import { EASE_OUT, cubicBezier } from '../board';
import type { BoardPlayback } from '../engine';
import {
  DISTRIBUTION_INK,
  DISTRIBUTION_TIME,
  MORPH_MS,
  areaPath,
  columnPath,
  barsAt,
  curveAt,
  distributionDescription,
  distributionDuration,
  distributionLayout,
  linePath,
  liveProbability,
  liveSummary,
  mixInk,
  morphEase,
  nearestSpec,
  percentText,
  quantity,
  ramp,
  regionPath,
  regionStart,
  regionText,
  stageWanted,
} from '../distribution';
import { rectsOverlap } from '../labelLayout';
import { reducedMotion, textMeasure, useBoxSize, useBuildClock, useFontsVersion } from './ScatterBoard';
import '../distribution.css';

const easeOut = cubicBezier(...EASE_OUT);
const ink = (color: string): CSSProperties => ({ '--c': color }) as CSSProperties;
/** A mark on a crisp pixel: a 1 px line is sharp only when it is centred on one. */
const crisp = (v: number) => Math.round(v) + 0.5;

/**
 * The morph state, 0 (the first distribution) to 1 (the second), moving towards `target` while the narration plays. It
 * holds while the speech is paused and jumps when the board is shown finished or motion is reduced.
 */
function useMorph(target: number, playback: BoardPlayback, enabled: boolean): number {
  const { playing } = playback;
  const complete = !playing && playback.progress >= 1;
  const [shown, setShown] = useState(() => (enabled && (reducedMotion() || !playing) ? target : 0));
  const current = useRef(shown);
  useEffect(() => {
    if (!enabled) return;
    if (reducedMotion() || complete) {
      current.current = target;
      setShown(target);
      return;
    }
    if (!playing || current.current === target) return;
    let last = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const step = (now - last) / MORPH_MS;
      last = now;
      const next = current.current + Math.sign(target - current.current) * step;
      current.current = (next - target) * (current.current - target) <= 0 ? target : next;
      setShown(current.current);
      if (current.current !== target) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [target, playing, complete, enabled]);
  return shown;
}

export function DistributionBoard({
  item,
  focus,
  playback,
}: {
  item: DistributionItem;
  focus: number | null;
  playback: BoardPlayback;
}) {
  const [boxRef, space] = useBoxSize<HTMLDivElement>();
  const [headRef, head] = useBoxSize<HTMLDivElement>();
  const [footRef, foot] = useBoxSize<HTMLDListElement>();
  const fontsVersion = useFontsVersion();
  const fonts = useMemo(() => ({ tick: textMeasure(500, 11.5), title: textMeasure(500, 12) }), [fontsVersion]);
  // The drawing takes the room the legend and the readouts leave.
  const box = useMemo(
    () =>
      space ? { width: space.width, height: space.height - (head?.height ?? 0) - (foot?.height ?? 0) - 12 } : null,
    [space, head, foot],
  );
  const layout = useMemo(() => (box ? distributionLayout(item, box, fonts) : null), [item, box, fonts]);
  const elapsed = useBuildClock(distributionDuration(item), playback);
  const clip = useId().replace(/:/g, '');

  const two = item.dists.length > 1;
  const complete = !playback.playing && playback.progress >= 1;
  const wanted = stageWanted(item, focus, playback.progress);
  const held = useRef<0 | 1>(0);
  if (wanted !== null) held.current = wanted;
  const target = two ? (reducedMotion() || complete ? 1 : (wanted ?? held.current)) : 0;
  const t = morphEase(useMorph(target, playback, two));

  const regionPart = item.dists.length;
  const focused = focus !== null && focus < regionPart + (item.region ? 1 : 0) ? focus : null;
  const live = liveSummary(item, t);
  const chance = item.region ? liveProbability(item, t) : 0;
  const color = two ? mixInk(t) : DISTRIBUTION_INK[0];
  const current = item.dists.indexOf(nearestSpec(item, t));

  const g = layout;
  const rise = easeOut(ramp(elapsed, DISTRIBUTION_TIME.axes, DISTRIBUTION_TIME.rise));
  const axes = easeOut(ramp(elapsed, 0, DISTRIBUTION_TIME.axes));
  const sweep = easeOut(ramp(elapsed, regionStart(), DISTRIBUTION_TIME.region));
  const ghost = two ? Math.min(0.55, t * 4) : 0;

  // The region's bounds are printed on the axis in badges, over the ticks they cover.
  const badges = useMemo(() => {
    if (!g || !item.region) return [];
    return [item.region.from, item.region.to].flatMap((value) => {
      if (value === undefined || value < g.lo || value > g.hi) return [];
      const text = quantity(value);
      const w = Math.ceil(fonts.tick(text) * 1.1) + 12;
      const left = Math.min(Math.max(0, g.x(value) - w / 2), g.width - w);
      return [
        { text, at: g.x(value), rect: { left, top: g.plot.bottom + 6, right: left + w, bottom: g.plot.bottom + 24 } },
      ];
    });
  }, [g, item.region, fonts]);

  const bars = g?.discrete ? barsAt(item, g, t, rise) : [];
  const first = g?.discrete && two ? barsAt(item, g, 0, rise) : [];
  const line = g && !g.discrete ? curveAt(item, g, t, rise) : [];
  const was = g && !g.discrete && two ? curveAt(item, g, 0, rise) : [];
  const mean = live && g ? g.x(live.mean) : null;
  const regionIn = g && item.region && !g.discrete ? regionPath(item, g, t, rise) : '';
  const regionBounds =
    item.region && g
      ? [item.region.from, item.region.to].filter((v): v is number => v !== undefined && v >= g.lo && v <= g.hi)
      : [];

  return (
    <div className={`distribution${focused !== null ? ' has-focus' : ''}`} ref={boxRef}>
      <div className="ds-legend" ref={headRef}>
        {item.dists.map((spec, i) => (
          <span
            key={i}
            className={`ds-key${i === current ? ' is-current' : ''}${i === focused ? ' is-focus' : ''}`}
            style={ink(DISTRIBUTION_INK[i])}
          >
            <i />
            {spec.label}
            <em>{describeSpec(spec)}</em>
          </span>
        ))}
      </div>
      {g && (
        <svg className="ds-svg" width={g.width} height={g.height} role="img" aria-label={distributionDescription(item)}>
          <g className="ds-axis" opacity={axes}>
            <path className="ds-base" d={`M${g.plot.left} ${crisp(g.plot.bottom)}H${g.plot.right}`} />
            <path
              className="ds-marks"
              d={g.ticks.map((tick) => `M${crisp(tick.at)} ${g.plot.bottom}V${g.plot.bottom + 4}`).join('')}
            />
            {g.ticks.map((tick) => {
              const half = fonts.tick(tick.label) / 2;
              const covered = badges.some((b) =>
                rectsOverlap(
                  { left: tick.at - half, top: g.plot.bottom + 8, right: tick.at + half, bottom: g.plot.bottom + 22 },
                  b.rect,
                  2,
                ),
              );
              return (
                <text
                  key={tick.value}
                  className={`ds-tick${covered ? ' is-hidden' : ''}`}
                  x={tick.at}
                  y={g.plot.bottom + 15}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {tick.label}
                </text>
              );
            })}
            {g.categories.map((category, i) => (
              <text key={i} className="ds-tick" textAnchor="middle" dominantBaseline="central">
                {category.lines.map((text, j) => (
                  <tspan key={j} x={category.at} y={g.plot.bottom + 15 + j * 14}>
                    {text}
                  </tspan>
                ))}
              </text>
            ))}
            <text className="ds-title" x={g.xTitle.x} y={g.xTitle.y} textAnchor="end" dominantBaseline="central">
              {g.xTitle.text}
            </text>
          </g>

          {!g.discrete && (
            <>
              <defs>
                <linearGradient id={`${clip}-fill`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0" stopColor={color} stopOpacity="0.34" />
                  <stop offset="1" stopColor={color} stopOpacity="0.03" />
                </linearGradient>
                {item.region && (
                  <clipPath id={`${clip}-sweep`}>
                    <rect
                      x={g.x(Math.max(item.region.from ?? g.lo, g.lo))}
                      y={0}
                      width={
                        (g.x(Math.min(item.region.to ?? g.hi, g.hi)) - g.x(Math.max(item.region.from ?? g.lo, g.lo))) *
                        sweep
                      }
                      height={g.height}
                    />
                  </clipPath>
                )}
              </defs>
              {ghost > 0 && (
                <path className="ds-ghost" d={linePath(was)} style={{ ...ink(DISTRIBUTION_INK[0]), opacity: ghost }} />
              )}
              <path
                className="ds-area"
                d={areaPath(line, g.plot.bottom)}
                fill={`url(#${clip}-fill)`}
                opacity={rise > 0 ? 1 : 0}
              />
              <path className="ds-curve" d={linePath(line)} style={ink(color)} opacity={rise > 0 ? 1 : 0} />
              {regionIn && (
                <path
                  className={`ds-region${focused === regionPart ? ' is-focus' : ''}`}
                  d={regionIn}
                  style={ink(color)}
                  clipPath={`url(#${clip}-sweep)`}
                  opacity={sweep > 0 ? 1 : 0}
                />
              )}
            </>
          )}

          {g.discrete && (
            <g>
              {first.map((bar) => (
                <path
                  key={`was-${bar.value}`}
                  className="ds-ghost"
                  d={columnPath(bar, g.plot.bottom)}
                  style={{ ...ink(DISTRIBUTION_INK[0]), opacity: ghost }}
                />
              ))}
              {bars.map((bar) => {
                const dim = item.region && !bar.inRegion ? sweep : 0;
                return (
                  <g
                    key={bar.value}
                    className={`ds-bar${bar.inRegion && item.region ? ' in-region' : ''}`}
                    style={ink(color)}
                    opacity={1 - 0.62 * dim}
                  >
                    <path className="ds-bar-fill" d={columnPath(bar, g.plot.bottom)} />
                    {g.counts && rise > 0.6 && (
                      <text
                        className="ds-share"
                        x={bar.x + bar.width / 2}
                        y={bar.top - 8}
                        textAnchor="middle"
                        dominantBaseline="central"
                      >
                        {percentText(bar.chance)}
                      </text>
                    )}
                  </g>
                );
              })}
            </g>
          )}

          {regionBounds.length > 0 && (
            <g className="ds-bounds" opacity={sweep} style={ink(color)}>
              {regionBounds.map((value) => (
                <path key={value} className="ds-bound" d={`M${crisp(g.x(value))} ${g.plot.top}V${g.plot.bottom}`} />
              ))}
              {badges.map((badge) => (
                <g key={badge.text} className="ds-badge">
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

          {mean !== null && !g.counts && (
            <g className="ds-mean" opacity={ramp(elapsed, DISTRIBUTION_TIME.axes + 500, 400)}>
              <path d={`M${crisp(mean)} ${g.plot.top + 4}V${g.plot.bottom}`} />
              <text x={mean} y={g.plot.top - 6} textAnchor="middle" dominantBaseline="central">
                mean
              </text>
            </g>
          )}
        </svg>
      )}
      <dl className="ds-stats" ref={footRef}>
        {item.region && (
          <div className={`ds-stat ds-chance${focused === regionPart ? ' is-focus' : ''}`} style={ink(color)}>
            <dt>{regionText(item.region)}</dt>
            <dd>{percentText(chance)}</dd>
            {two && <small>{`${item.dists[0].label}: ${percentText(item.region.probabilities[0])}`}</small>}
          </div>
        )}
        {live && summary(item.dists[0]) && (
          <>
            <div className="ds-stat">
              <dt>mean</dt>
              <dd>{quantity(live.mean)}</dd>
            </div>
            <div className="ds-stat">
              <dt>spread (sd)</dt>
              <dd>{quantity(live.sd)}</dd>
            </div>
          </>
        )}
      </dl>
    </div>
  );
}
