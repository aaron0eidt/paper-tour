// The timeline board: where events, spans and the anchor sit on a vertical axis, how their labels are spread so that none
// overlaps, how the axis is ticked, and the build timeline. Pure, so it can be tested; rendering is in
// components/TimelineBoard.tsx. Positions arrive computed (shared/timeline.ts): days from the anchor, or steps.

import { UNIT_DAYS, addMonths, lengthText, parseDate } from '../../shared/timeline';
import type { TimelineItem, TimelineOffsetUnit, TimelineRole } from '../../shared/timeline';
import { fitText } from './board';
import type { Measure } from './board';
import { ramp, scatterAxis } from './scatter';

export { ramp };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10) / 10;
const DAY_MS = 86400000;

// ----------------------------------------------------------------- wording

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/** A distance in days as the document would write it: in the axis unit when it is a whole number of them, else as lengthText says. */
export function distanceText(item: Pick<TimelineItem, 'unit'>, days: number, unit?: TimelineOffsetUnit): string {
  if (item.unit === 'step') return plural(Math.round(Math.abs(days)), 'step');
  const own = unit ?? item.unit;
  const value = Math.abs(days) / UNIT_DAYS[own];
  return Math.abs(value - Math.round(value)) < 0.06 && Math.round(value) > 0
    ? plural(Math.round(value), own)
    : lengthText(Math.abs(days));
}

/** Where a position falls, counted from the anchor: "month 6", "step 3", "14 days before", "start". */
export function positionText(item: Pick<TimelineItem, 'unit'>, position: number): string {
  if (item.unit === 'step') return `step ${Number(position.toFixed(1))}`;
  if (Math.abs(position) < 0.5) return 'start';
  if (position < 0) return `${distanceText(item, position)} before`;
  const value = position / UNIT_DAYS[item.unit];
  if (Math.abs(value - Math.round(value)) < 0.06) return `${item.unit} ${Math.round(value)}`;
  return item.unit === 'day' || item.unit === 'week'
    ? `day ${Math.round(position)}`
    : `${item.unit} ${Number(value.toFixed(1))}`;
}

type Grain = 'year' | 'month' | 'day';
/** A day of a dated board as a person reads it. */
export function dateText(origin: string, position: number, grain: Grain, locale?: string, year = true): string {
  const day = (parseDate(origin) ?? 0) + Math.round(position);
  const options: Intl.DateTimeFormatOptions =
    grain === 'year'
      ? { year: 'numeric' }
      : grain === 'month'
        ? { month: 'short', year: 'numeric' }
        : year
          ? { day: 'numeric', month: 'short', year: 'numeric' }
          : { day: 'numeric', month: 'short' };
  try {
    return new Intl.DateTimeFormat(locale, { ...options, timeZone: 'UTC' }).format(new Date(day * DAY_MS));
  } catch {
    return new Date(day * DAY_MS).toISOString().slice(0, 10);
  }
}

/** How exact a date the document gave: a year, a month or a day (a derived date is a day, or a year on a yearly axis). */
function grainOf(item: TimelineItem, written?: string): Grain {
  if (written) return written.length <= 4 ? 'year' : written.length <= 7 ? 'month' : 'day';
  return item.unit === 'year' ? 'year' : 'day';
}

// ------------------------------------------------------------------- axis

export interface TimelineTick {
  position: number;
  label: string;
  /** Px along the axis; filled by timelineGeometry. */
  at: number;
}

/**
 * Ticks along the axis, at round numbers of the board's unit counted from the anchor. On a dated board the ticks are
 * dates (the first of a month or year counted on the calendar, so a tick lands on the date it names).
 */
function axisTicks(
  item: TimelineItem,
  positions: number[],
  length: number,
): { lo: number; hi: number; ticks: TimelineTick[] } {
  const scale = item.unit === 'step' ? 1 : UNIT_DAYS[item.unit];
  const axis = scatterAxis(
    positions.map((p) => p / scale),
    false,
    length,
    46,
  );
  const [lo, hi] = [axis.lo * scale, axis.hi * scale];
  const dated = !!item.origin && item.unit !== 'step';
  const origin = item.origin ? (parseDate(item.origin) ?? 0) : 0;
  const long = hi - lo > 300;
  const ticks = axis.ticks.flatMap((tick): TimelineTick[] => {
    // A step axis counts whole steps, from the first one that is used to the last.
    if (
      item.unit === 'step' &&
      (!Number.isInteger(tick.value) || tick.value < Math.min(...positions) || tick.value > Math.max(...positions))
    )
      return [];
    let position = tick.value * scale;
    if (dated && (item.unit === 'month' || item.unit === 'year') && Number.isInteger(tick.value))
      position = addMonths(origin, tick.value * (item.unit === 'year' ? 12 : 1)) - origin;
    if (position < lo - 1e-6 || position > hi + 1e-6) return [];
    const label = dated
      ? dateText(
          item.origin!,
          position,
          item.unit === 'year' ? 'year' : item.unit === 'month' ? 'month' : 'day',
          undefined,
          long,
        )
      : item.unit === 'step'
        ? String(tick.value)
        : tick.label;
    return [{ position, label, at: 0 }];
  });
  return { lo, hi, ticks };
}

// --------------------------------------------------------------- relaxing

/**
 * Label centres as near as possible to where they want to be (least squares), at least `gap` apart and in order: the
 * pool-adjacent-violators algorithm on the positions with the gaps taken out.
 */
export function relax(wanted: number[], gap: number): number[] {
  const z = wanted.map((y, i) => y - i * gap);
  const blocks: { sum: number; count: number }[] = [];
  for (const value of z) {
    blocks.push({ sum: value, count: 1 });
    while (blocks.length > 1) {
      const [a, b] = [blocks[blocks.length - 2], blocks[blocks.length - 1]];
      if (a.sum / a.count <= b.sum / b.count) break;
      blocks.splice(blocks.length - 2, 2, { sum: a.sum + b.sum, count: a.count + b.count });
    }
  }
  return blocks.flatMap((block) => Array<number>(block.count).fill(block.sum / block.count)).map((v, i) => v + i * gap);
}

// ---------------------------------------------------------------- geometry

export interface TimelineFonts {
  tick: Measure;
  label: Measure;
  chip: Measure;
}

export type TimelineRowKind = 'anchor' | 'event' | 'span';
export interface TimelineRow {
  kind: TimelineRowKind;
  /** The index board_focus uses (events, then spans); null for the anchor. */
  part: number | null;
  /** Arrival order down the axis. */
  rank: number;
  /** Where the marker sits on the axis (an event, the anchor) or the middle of the bar (a span). */
  y: number;
  /** The centre of its two-line label. */
  labelY: number;
  name: string;
  chip: string;
  /** A limit that must be met. */
  deadline: boolean;
  role: TimelineRole | null;
  /** A span: its lane, and the ends of its bar. */
  lane: number;
  y0: number;
  y1: number;
}

export interface TimelineGeometry {
  width: number;
  height: number;
  axisX: number;
  top: number;
  bottom: number;
  /** The unit the ticks count, above the axis; null on a dated board, where the ticks are dates. */
  unitTitle: string | null;
  ticks: TimelineTick[];
  lanes: number;
  laneX: (lane: number) => number;
  labelX: number;
  labelWidth: number;
  rows: TimelineRow[];
}

/** Marker radius, the width of a span's bar, the pitch between lanes, and the least distance between two labels' centres. */
export const TIMELINE_DOT = 5.5;
export const TIMELINE_BAR = 10;
const LANE = 16;
const PITCH = 38;
const TOP = 16;
const TITLE = 26;
const BOTTOM = 18;
const MAX_AXIS = 640;

/**
 * Where everything goes in a board of `box` px: the axis down the left with its ticks, the spans as bars in lanes beside
 * it, and a column of labels on the right, each at the height of what it names but pushed apart where the events crowd.
 */
export function timelineGeometry(
  item: TimelineItem,
  box: { width: number; height: number },
  fonts: TimelineFonts,
): TimelineGeometry {
  const width = Math.max(1, Math.floor(box.width));
  const spans = item.spans ?? [];
  const rows = item.events.length + spans.length + (item.anchor ? 1 : 0);
  const positions = [
    ...(item.anchor ? [0] : []),
    ...item.events.map((e) => e.position),
    ...spans.flatMap((s) => [s.start, s.end]),
  ];
  const dated = !!item.origin && item.unit !== 'step';
  const unitTitle = dated
    ? null
    : item.unit === 'step'
      ? 'steps'
      : `${item.unit}s${item.anchor ? ` from ${item.anchor.label}` : ''}`;
  const top = unitTitle ? TITLE : TOP;
  const length = clamp(box.height - top - BOTTOM, Math.max(160, (rows - 1) * PITCH), MAX_AXIS);
  const { lo, hi, ticks } = axisTicks(item, positions, length);
  const y = (position: number) => round(top + ((position - lo) / (hi - lo || 1)) * length);

  // Spans take the first lane free over their whole length.
  const order = spans.map((_, i) => i).sort((a, b) => spans[a].start - spans[b].start || spans[a].end - spans[b].end);
  const laneEnds: number[] = [];
  const laneOf = new Map<number, number>();
  for (const i of order) {
    let lane = laneEnds.findIndex((end) => end <= spans[i].start + 1e-9);
    if (lane < 0) lane = laneEnds.length;
    laneEnds[lane] = spans[i].end;
    laneOf.set(i, lane);
  }
  const lanes = laneEnds.length;

  const widest = Math.min(Math.max(0, ...ticks.map((t) => Math.ceil(fonts.tick(t.label)))), width * 0.3);
  const axisX = Math.round(widest + 14) + 0.5;
  const firstLane = axisX + 18;
  const laneX = (lane: number) => firstLane + lane * LANE;
  const labelX = Math.round((lanes ? laneX(lanes - 1) + TIMELINE_BAR : axisX + 6) + 16);
  const labelWidth = Math.max(40, width - labelX - 2);

  // A date is always written in full (the ticks leave the year out on a short axis); a step axis needs no second reading.
  const datedText = (position: number, written?: string) =>
    dated
      ? dateText(item.origin!, position, grainOf(item, written))
      : item.unit === 'step'
        ? ''
        : positionText(item, position);
  const draft: Omit<TimelineRow, 'rank' | 'labelY'>[] = [
    ...(item.anchor
      ? [
          {
            kind: 'anchor' as const,
            part: null,
            y: y(0),
            name: item.anchor.label,
            chip: dated ? datedText(0, item.anchor.date) : '',
            deadline: false,
            role: null,
            lane: 0,
            y0: y(0),
            y1: y(0),
          },
        ]
      : []),
    ...item.events.map((event, i) => ({
      kind: 'event' as const,
      part: i,
      y: y(event.position),
      name: event.label,
      chip: datedText(event.position, event.date),
      deadline: !!event.deadline,
      role: null,
      lane: 0,
      y0: y(event.position),
      y1: y(event.position),
    })),
    ...spans.map((span, i) => ({
      kind: 'span' as const,
      part: item.events.length + i,
      y: y((span.start + span.end) / 2),
      name: span.label,
      chip:
        span.length !== undefined
          ? plural(span.length, span.length_unit ?? (item.unit === 'step' ? 'step' : item.unit))
          : distanceText(item, span.end - span.start),
      deadline: false,
      role: span.role ?? null,
      lane: laneOf.get(i)!,
      y0: y(span.start),
      y1: y(span.end),
    })),
  ];
  // Labels keep to the order of what they name, spread to at least a pitch apart.
  const sorted = draft.map((_, i) => i).sort((a, b) => draft[a].y - draft[b].y || a - b);
  const spread = relax(
    sorted.map((i) => draft[i].y),
    PITCH,
  );
  const shift = Math.max(0, TOP - (spread[0] ?? 0));
  const labelY = new Map(sorted.map((i, k) => [i, round(spread[k] + shift)]));
  const rank = new Map(sorted.map((i, k) => [i, k]));
  const placed: TimelineRow[] = draft.map((row, i) => ({ ...row, rank: rank.get(i)!, labelY: labelY.get(i)! }));
  const bottom = round(top + length);
  const height = Math.ceil(Math.max(bottom, ...placed.map((r) => r.labelY + PITCH / 2)) + BOTTOM);
  // A label is cut with an ellipsis, not run past the board.
  return {
    width,
    height,
    axisX,
    top,
    bottom,
    unitTitle: unitTitle ? fitText(unitTitle, width - 4, fonts.tick) : null,
    ticks: ticks.map((tick) => ({ ...tick, at: y(tick.position) })),
    lanes,
    laneX,
    labelX,
    labelWidth,
    rows: placed.map((row) => ({
      ...row,
      name: fitText(row.name, labelWidth, fonts.label),
      chip: fitText(row.chip, labelWidth, fonts.chip),
    })),
  };
}

// ----------------------------------------------------------------- timeline

/** Milliseconds: the axis draws, then everything on it arrives in order down the axis, each label just behind its marker. */
export const TIMELINE_TIME = { axis: 460, first: 380, every: 170, grow: 520, bar: 760, label: 150 };

/** When the row of this rank starts arriving. */
export const timelineArrival = (rank: number) => TIMELINE_TIME.first + rank * TIMELINE_TIME.every;

/** How long the build takes, in ms. */
export const timelineDuration = (rows: number) =>
  timelineArrival(Math.max(0, rows - 1)) + Math.max(TIMELINE_TIME.grow, TIMELINE_TIME.bar) + TIMELINE_TIME.label + 200;

/** A description of the timeline for screen readers. */
export function timelineDescription(item: TimelineItem): string {
  const events = item.events.map(
    (event) => `${event.label}${event.deadline ? ' (a deadline)' : ''}, ${positionText(item, event.position)}`,
  );
  const spans = (item.spans ?? []).map(
    (span) =>
      `${span.label}, ${span.length !== undefined ? plural(span.length, span.length_unit ?? item.unit) : distanceText(item, span.end - span.start)}`,
  );
  const anchor = item.anchor ? `from ${item.anchor.label}; ` : '';
  return `${item.title ?? 'Timeline'}: ${anchor}${[...events, ...spans.map((s) => `period ${s}`)].join('; ')}`;
}
