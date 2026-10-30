// The timeline board: events, deadlines and periods on one vertical axis. The axis draws down, and what lies on it arrives
// in order: a dot on the axis for an event (a diamond for a deadline, a ring for the anchor), a bar in a lane beside it
// for a span, each with its label in a column on the right. Every position was computed from the document's own dates and
// periods (shared/timeline.ts). The clock follows speech like the scatter's (it pauses with the narration, and a silent
// seek or reduced motion shows the finished board). Geometry is in timeline.ts.

import { useId, useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { TimelineItem } from '../../../shared/timeline';
import { BOARD_INK, EASE_OUT, cubicBezier } from '../board';
import type { BoardPlayback } from '../engine';
import {
  TIMELINE_BAR,
  TIMELINE_DOT,
  TIMELINE_TIME,
  ramp,
  timelineArrival,
  timelineDescription,
  timelineDuration,
  timelineGeometry,
} from '../timeline';
import type { TimelineRow } from '../timeline';
import { textMeasure, useBoxSize, useBuildClock, useFontsVersion } from './ScatterBoard';
import '../timeline.css';

const easeOut = cubicBezier(...EASE_OUT);
const ACCENT = 'var(--accent)';
const WARN = 'var(--warn)';

/** A span's colour by what it is: a term runs, a notice counts down, a wait is held back, a window is open. */
const ROLE_INK: Record<string, string> = {
  term: BOARD_INK.blue,
  notice: BOARD_INK.orange,
  wait: 'var(--board-edge)',
  window: BOARD_INK.green,
};
const rowInk = (row: TimelineRow) =>
  row.kind === 'span' ? (row.role ? ROLE_INK[row.role] : ACCENT) : row.deadline ? WARN : ACCENT;
const ink = (color: string): CSSProperties => ({ '--c': color }) as CSSProperties;
/** A mark on a crisp pixel: a 1 px line is sharp only when it is centred on one. */
const crisp = (v: number) => Math.round(v) + 0.5;

export function TimelineBoard({
  item,
  focus,
  playback,
}: {
  item: TimelineItem;
  focus: number | null;
  playback: BoardPlayback;
}) {
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const fontsVersion = useFontsVersion();
  const fonts = useMemo(
    () => ({ tick: textMeasure(500, 11.5), label: textMeasure(600, 12.5), chip: textMeasure(500, 11.5) }),
    [fontsVersion],
  );
  const geometry = useMemo(() => (box ? timelineGeometry(item, box, fonts) : null), [item, box, fonts]);
  const rows = (item.spans?.length ?? 0) + item.events.length + (item.anchor ? 1 : 0);
  const elapsed = useBuildClock(timelineDuration(rows), playback);
  const focused = focus !== null && focus < item.events.length + (item.spans?.length ?? 0) ? focus : null;
  const hatch = useId().replace(/:/g, '');
  const g = geometry;
  const axis = easeOut(ramp(elapsed, 0, TIMELINE_TIME.axis));
  const drawn = g ? g.top + (g.bottom - g.top) * axis : 0;

  return (
    <div className={`tmboard${focused !== null ? ' has-focus' : ''}`} ref={boxRef}>
      {g && (
        <svg className="tm-svg" width={g.width} height={g.height} role="img" aria-label={timelineDescription(item)}>
          <defs>
            <pattern id={hatch} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" className="tm-hatch-ground" />
              <line x1="0" y1="0" x2="0" y2="6" className="tm-hatch-line" />
            </pattern>
          </defs>
          {g.unitTitle && (
            <text className="tm-title" x={0} y={12} dominantBaseline="central" opacity={axis}>
              {g.unitTitle}
            </text>
          )}
          <g className="tm-axis" opacity={Math.min(1, axis * 2)}>
            <path className="tm-line" d={`M${g.axisX} ${g.top}V${crisp(drawn)}`} />
            <path className="tm-marks" d={g.ticks.map((t) => `M${g.axisX - 4} ${crisp(t.at)}H${g.axisX}`).join('')} />
            {g.ticks.map((t) => (
              <text
                key={t.position}
                className="tm-tick"
                x={g.axisX - 9}
                y={t.at}
                textAnchor="end"
                dominantBaseline="central"
                opacity={t.at <= drawn ? 1 : 0}
              >
                {t.label}
              </text>
            ))}
          </g>

          {g.rows.map((row) => {
            const start = timelineArrival(row.rank);
            const arrive = easeOut(ramp(elapsed, start, TIMELINE_TIME.grow));
            const bar = easeOut(ramp(elapsed, start, TIMELINE_TIME.bar));
            const text = ramp(elapsed, start + TIMELINE_TIME.label, 320);
            const lit = row.part !== null && row.part === focused;
            const color = rowInk(row);
            const markerX = row.kind === 'span' ? g.laneX(row.lane) + TIMELINE_BAR / 2 : g.axisX;
            const reach = g.labelX - 8;
            const leader =
              Math.abs(row.labelY - row.y) < 1
                ? `M${markerX + (row.kind === 'span' ? TIMELINE_BAR / 2 + 1 : TIMELINE_DOT + 2)} ${row.y}H${reach}`
                : `M${markerX + (row.kind === 'span' ? TIMELINE_BAR / 2 + 1 : TIMELINE_DOT + 2)} ${row.y}H${markerX + 14}L${reach} ${row.labelY}`;
            const chip = [row.chip, row.kind === 'span' && row.role ? row.role : '', row.deadline ? 'deadline' : '']
              .filter(Boolean)
              .join(' · ');
            return (
              <g
                key={`${row.kind}-${row.part ?? 'anchor'}`}
                className={`tm-row tm-${row.kind}${lit ? ' is-focus' : ''}${row.deadline ? ' is-deadline' : ''}`}
                style={ink(color)}
              >
                {row.kind === 'anchor' && (
                  <path className="tm-now" d={`M${g.axisX} ${crisp(row.y)}H${reach}`} opacity={arrive} />
                )}
                {row.kind !== 'anchor' && (
                  <path
                    className="tm-leader"
                    d={leader}
                    pathLength={1}
                    style={{ strokeDashoffset: 1 - arrive, opacity: arrive > 0 ? 1 : 0 }}
                  />
                )}
                {row.kind === 'span' && (
                  <g>
                    <path
                      className="tm-tie"
                      d={`M${g.axisX + 1} ${crisp(row.y0)}H${g.laneX(row.lane)}M${g.axisX + 1} ${crisp(row.y1)}H${g.laneX(row.lane)}`}
                      opacity={bar}
                    />
                    <rect
                      className={`tm-bar role-${row.role ?? 'none'}`}
                      x={g.laneX(row.lane)}
                      y={row.y0}
                      width={TIMELINE_BAR}
                      height={Math.max(4, (row.y1 - row.y0) * bar)}
                      rx={TIMELINE_BAR / 2}
                      style={row.role === 'wait' ? { fill: `url(#${hatch})` } : undefined}
                    />
                  </g>
                )}
                {row.kind === 'event' && (
                  <g
                    className="tm-dot"
                    transform={`translate(${g.axisX} ${row.y}) scale(${(0.4 + 0.6 * arrive).toFixed(3)})`}
                    opacity={arrive}
                  >
                    <g className="tm-pop">
                      <circle className="tm-halo" r={TIMELINE_DOT + 5} />
                      {row.deadline ? (
                        <rect
                          className="tm-core"
                          x={-5.5}
                          y={-5.5}
                          width={11}
                          height={11}
                          rx={2}
                          transform="rotate(45)"
                        />
                      ) : (
                        <circle className="tm-core" r={TIMELINE_DOT} />
                      )}
                    </g>
                  </g>
                )}
                {row.kind === 'anchor' && (
                  <g
                    transform={`translate(${g.axisX} ${row.y}) scale(${(0.4 + 0.6 * arrive).toFixed(3)})`}
                    opacity={arrive}
                  >
                    <circle className="tm-ring" r={TIMELINE_DOT + 1.5} />
                    <circle className="tm-core" r={2.2} />
                  </g>
                )}
                <text
                  className="tm-name"
                  x={g.labelX}
                  y={row.labelY - (chip ? 7 : 0)}
                  dominantBaseline="central"
                  opacity={text}
                >
                  {row.name}
                </text>
                {chip && (
                  <text className="tm-chip" x={g.labelX} y={row.labelY + 9} dominantBaseline="central" opacity={text}>
                    {chip}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
