/**
 * Dated or ordered events, spans and deadlines on one axis: a lease's notice periods, the steps of a protocol, a
 * history. The model writes what the document says (a date, a position, or "14 days after the notice") and the code
 * resolves every position, so the board never shows a date or a length the model worked out in its head.
 */

export const TIMELINE_UNITS = ['day', 'week', 'month', 'year', 'step'] as const;
export const TIMELINE_OFFSET_UNITS = ['day', 'week', 'month', 'year'] as const;
export const TIMELINE_ROLES = ['term', 'notice', 'wait', 'window'] as const;
export const TIMELINE_SOURCES = ['document', 'illustrative'] as const;
export type TimelineUnit = (typeof TIMELINE_UNITS)[number];
export type TimelineOffsetUnit = (typeof TIMELINE_OFFSET_UNITS)[number];
export type TimelineRole = (typeof TIMELINE_ROLES)[number];

export interface TimelineEvent {
  label: string;
  /** Where it falls, one way: a date as printed (YYYY, YYYY-MM or YYYY-MM-DD), ... */
  date?: string;
  /** ... a position counted from the anchor in the axis unit (a step number), ... */
  at?: number;
  /** ... or a distance from another event, or from the anchor, named by its label. Negative: before it. */
  after?: string;
  offset?: number;
  offset_unit?: TimelineOffsetUnit;
  /** A limit, not something that happens: it is drawn as a flag. */
  deadline?: boolean;
  /** Computed: where it falls, in days from the anchor (from the first date without one); on a step axis, the step. */
  position: number;
}

export interface TimelineSpan {
  label: string;
  /** The event, or the anchor, it starts at, named by its label. */
  from: string;
  /** The event it ends at, or ... */
  to?: string;
  /** ... how long it lasts. */
  length?: number;
  length_unit?: TimelineOffsetUnit;
  /** term: a period that runs. notice: a notice period. wait: time in which nothing can be done yet. window: when it is allowed. */
  role?: TimelineRole;
  /** Computed: the ends of the span, counted like an event's position. */
  start: number;
  end: number;
}

export interface TimelineItem {
  kind: 'timeline';
  title?: string;
  /** What the axis counts. step: ordered events with no calendar. */
  unit: TimelineUnit;
  source: 'document' | 'illustrative';
  /** The reference mark ("today", the notice date, the start of the term): position 0 of the axis. */
  anchor?: { label: string; date?: string };
  /** Computed: the date at position 0, when the board has dates. */
  origin?: string;
  events: TimelineEvent[];
  spans?: TimelineSpan[];
}

export const TIMELINE_LIMITS = { title: 60, events: [2, 8], spans: 4, label: 28, offset: 10000, at: 100000 } as const;

/** Days in one unit; a month and a year are the mean calendar ones when there is no date to count them from. */
export const UNIT_DAYS: Record<TimelineOffsetUnit, number> = { day: 1, week: 7, month: 365.25 / 12, year: 365.25 };
/** How far a number in a label may be from the length the code computed, in days, per unit (calendar months vary). */
const QUOTE_SLACK: Record<TimelineOffsetUnit, number> = { day: 1, week: 2, month: 3.5, year: 4 };

// ------------------------------------------------------------------- dates

const DAY_MS = 86400000;

/** Days since 1970-01-01 (UTC) of YYYY, YYYY-MM or YYYY-MM-DD (the first of the month or year when it is left out); null when it is not a real date. */
export function parseDate(text: unknown): number | null {
  const match = typeof text === 'string' ? /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(text.trim()) : null;
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2] ?? 1), Number(match[3] ?? 1)];
  if (year < 1000 || month < 1 || month > 12 || day < 1) return null;
  const time = Date.UTC(year, month - 1, day);
  const real = new Date(time);
  return real.getUTCFullYear() === year && real.getUTCMonth() === month - 1 && real.getUTCDate() === day
    ? Math.round(time / DAY_MS)
    : null;
}

/** The date of a day count, as YYYY-MM-DD. */
export const isoDate = (day: number) => new Date(Math.round(day) * DAY_MS).toISOString().slice(0, 10);

/** A date some calendar months later (earlier when negative); the day clamps to the end of a shorter month, as leases count. */
export function addMonths(day: number, months: number): number {
  const date = new Date(day * DAY_MS);
  const total = date.getUTCFullYear() * 12 + date.getUTCMonth() + months;
  const [year, month] = [Math.floor(total / 12), ((total % 12) + 12) % 12];
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return Math.round(Date.UTC(year, month, Math.min(date.getUTCDate(), last)) / DAY_MS);
}

// ------------------------------------------------------------------ schema

const limit = TIMELINE_LIMITS;
export const TIMELINE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'unit', 'source', 'events'],
  properties: {
    kind: { type: 'string', enum: ['timeline'] },
    title: { type: 'string', maxLength: limit.title, description: 'What the timeline lays out, at most 6 words.' },
    unit: {
      type: 'string',
      enum: [...TIMELINE_UNITS],
      description:
        'What the axis counts: day, week, month or year for a calendar; step for ordered events with no time between them.',
    },
    source: {
      type: 'string',
      enum: [...TIMELINE_SOURCES],
      description: 'document: periods and dates as the document writes them. illustrative: an invented case.',
    },
    anchor: {
      type: 'object',
      additionalProperties: false,
      required: ['label'],
      description:
        'The reference mark and zero of the axis, such as the day a notice is served, the start of the term or today.',
      properties: {
        label: { type: 'string', minLength: 1, maxLength: limit.label },
        date: { type: 'string', description: 'Only when the document gives it: YYYY-MM-DD.' },
      },
    },
    events: {
      type: 'array',
      minItems: limit.events[0],
      maxItems: limit.events[1],
      description:
        '2-8 events or deadlines, each placed ONE way: date, at, or after with offset (as the document writes it). The code works out every position.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label'],
        properties: {
          label: {
            type: 'string',
            minLength: 1,
            maxLength: limit.label,
            description: 'Distinct, at most 28 characters.',
          },
          date: { type: 'string', description: 'YYYY-MM-DD (or YYYY-MM, YYYY) exactly as the document states it.' },
          at: { type: 'number', description: 'A position from the anchor in the axis unit, such as a step number.' },
          after: {
            type: 'string',
            description: 'The label of another event, or of the anchor, this is measured from.',
          },
          offset: {
            type: 'number',
            description: 'With after: how long after (negative: before), as the document writes it.',
          },
          offset_unit: {
            type: 'string',
            enum: [...TIMELINE_OFFSET_UNITS],
            description: 'The unit of offset; default the axis unit.',
          },
          deadline: {
            type: 'boolean',
            description: 'true for a limit that must be met rather than something that happens.',
          },
        },
      },
    },
    spans: {
      type: 'array',
      maxItems: limit.spans,
      description:
        'Periods between two events: a term, a notice period, a waiting time, a window in which something is allowed.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'from'],
        properties: {
          label: {
            type: 'string',
            minLength: 1,
            maxLength: limit.label,
            description: 'A name; the code prints the length.',
          },
          from: { type: 'string', description: 'The label of the event, or the anchor, where it starts.' },
          to: { type: 'string', description: 'The label of the event where it ends (or give length).' },
          length: { type: 'number', description: 'How long it lasts, as the document writes it (or give to).' },
          length_unit: { type: 'string', enum: [...TIMELINE_OFFSET_UNITS] },
          role: { type: 'string', enum: [...TIMELINE_ROLES], description: 'term, notice, wait or window.' },
        },
      },
    },
  },
};

// -------------------------------------------------------------- the check

const isRaw = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const clean = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const finite = (value: unknown, bound: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= bound;
const round = (value: number) => Number(value.toFixed(4));
const plural = (n: number, unit: string) => `${n} ${unit}${n === 1 ? '' : 's'}`;

/** A number with a unit in a label: "14 days", "3 months", "28-day". */
const QUOTED = /(\d+(?:[.,]\d+)?)\s*[- ]?\s*(day|week|month|year)s?\b/gi;

interface Built {
  problems: string[];
  item: TimelineItem | null;
}

/** The days a distance covers from a day, counted on the calendar when the board has dates. */
function shift(from: number, amount: number, unit: TimelineOffsetUnit, origin: number | null): number {
  if ((unit === 'month' || unit === 'year') && origin !== null) {
    const months = unit === 'year' ? amount * 12 : amount;
    const whole = Math.trunc(months);
    return addMonths(origin + from, whole) - origin + (months - whole) * UNIT_DAYS.month;
  }
  return from + amount * UNIT_DAYS[unit];
}

/** Everything the check and the canonical item need, from one pass: the problems, and the item when there are none. */
function build(raw: unknown): Built {
  const fail = (problems: string[]): Built => ({ problems, item: null });
  if (!isRaw(raw)) return fail(['Timeline must be an object.']);
  const problems: string[] = [];
  if (raw.kind !== 'timeline') problems.push('Unknown timeline kind.');
  if (raw.title !== undefined && (typeof raw.title !== 'string' || clean(raw.title).length > limit.title))
    problems.push(`title: use at most ${limit.title} characters`);
  if (!(TIMELINE_SOURCES as readonly unknown[]).includes(raw.source))
    problems.push(`source: use ${TIMELINE_SOURCES.join(' or ')}`);
  const unit = (TIMELINE_UNITS as readonly unknown[]).includes(raw.unit) ? (raw.unit as TimelineUnit) : null;
  if (!unit) problems.push(`unit: use ${TIMELINE_UNITS.join(', ')}`);
  const calendar = unit !== null && unit !== 'step';

  // The anchor: the reference mark, and position 0.
  let anchor: { label: string; date?: string } | undefined;
  let anchorDay: number | null = null;
  if (raw.anchor !== undefined) {
    const entry = raw.anchor;
    const label = isRaw(entry) ? clean(entry.label) : '';
    if (!isRaw(entry) || !label || label.length > limit.label)
      problems.push(`anchor: give a label of 1 to ${limit.label} characters`);
    else {
      anchor = { label };
      if (entry.date !== undefined && entry.date !== '') {
        anchorDay = parseDate(entry.date);
        if (anchorDay === null)
          problems.push(`anchor: the date "${clean(entry.date)}" is not a real date; write YYYY-MM-DD`);
        else if (!calendar) problems.push('anchor: a date needs a calendar unit (day, week, month or year), not step');
        else anchor.date = clean(entry.date);
      }
    }
  }

  const [fewest, most] = limit.events;
  if (!Array.isArray(raw.events)) return fail([...problems, `events: give a list of ${fewest} to ${most} events`]);
  if (raw.events.length < fewest || raw.events.length > most)
    return fail([...problems, `events: give ${fewest} to ${most} events, not ${raw.events.length}`]);

  interface Entry {
    label: string;
    date: number | null;
    at: number | null;
    after: string;
    offset: number | null;
    offsetUnit: TimelineOffsetUnit | null;
    deadline: boolean;
    raw: Record<string, unknown>;
  }
  const entries: Entry[] = [];
  const names = new Map<string, string>();
  if (anchor) names.set(anchor.label, 'the anchor');
  raw.events.forEach((entry: unknown, i: number) => {
    const name = `event ${i + 1}`;
    if (!isRaw(entry)) {
      problems.push(`${name}: give an object with a label and a date, at or after`);
      return;
    }
    const label = clean(entry.label);
    if (!label) problems.push(`${name}: the label is empty`);
    else if (label.length > limit.label)
      problems.push(`${name}: the label "${label}" is longer than ${limit.label} characters; shorten it`);
    else if (names.has(label))
      problems.push(`${name}: the label "${label}" is used twice (also for ${names.get(label)})`);
    names.set(label, name);
    const given = (['date', 'at', 'after'] as const).filter((key) => entry[key] !== undefined && entry[key] !== '');
    if (given.length !== 1)
      problems.push(
        `${name} "${label}": place it one way, with date, at, or after and offset; ${given.length ? `not ${given.join(' and ')}` : 'it has none'}`,
      );
    let date: number | null = null;
    if (entry.date !== undefined && entry.date !== '') {
      date = parseDate(entry.date);
      if (date === null)
        problems.push(`${name} "${label}": the date "${clean(entry.date)}" is not a real date; write YYYY-MM-DD`);
      else if (!calendar)
        problems.push(`${name} "${label}": a date needs a calendar unit (day, week, month or year), not step`);
    }
    let at: number | null = null;
    if (entry.at !== undefined) {
      if (!finite(entry.at, limit.at)) problems.push(`${name} "${label}": at must be a number`);
      else at = entry.at;
    }
    const after = clean(entry.after);
    let offset: number | null = null;
    if (entry.offset !== undefined) {
      if (!finite(entry.offset, limit.offset)) problems.push(`${name} "${label}": offset must be a number`);
      else offset = entry.offset;
    }
    if (after && offset === null)
      problems.push(`${name} "${label}": after needs an offset, how long after (negative: before)`);
    if (!after && entry.offset !== undefined)
      problems.push(`${name} "${label}": offset needs after, the event it is measured from`);
    let offsetUnit: TimelineOffsetUnit | null = null;
    if (entry.offset_unit !== undefined) {
      if (!(TIMELINE_OFFSET_UNITS as readonly unknown[]).includes(entry.offset_unit))
        problems.push(`${name} "${label}": offset_unit must be ${TIMELINE_OFFSET_UNITS.join(', ')}`);
      else if (!calendar) problems.push(`${name} "${label}": a step axis counts in steps; leave offset_unit out`);
      else offsetUnit = entry.offset_unit as TimelineOffsetUnit;
    }
    entries.push({ label, date, at, after, offset, offsetUnit, deadline: entry.deadline === true, raw: entry });
  });

  const spanList: unknown[] = raw.spans === undefined ? [] : Array.isArray(raw.spans) ? raw.spans : [null];
  if (raw.spans !== undefined && !Array.isArray(raw.spans)) problems.push('spans: give a list');
  else if (spanList.length > limit.spans)
    problems.push(`spans: give at most ${limit.spans} spans, not ${spanList.length}`);
  interface SpanEntry {
    label: string;
    from: string;
    to: string;
    length: number | null;
    lengthUnit: TimelineOffsetUnit | null;
    role: TimelineRole | null;
  }
  const spans: SpanEntry[] = [];
  spanList.slice(0, limit.spans).forEach((entry, i) => {
    const name = `span ${i + 1}`;
    if (!isRaw(entry)) {
      problems.push(`${name}: give an object with a label, from and to (or length)`);
      return;
    }
    const label = clean(entry.label);
    if (!label || label.length > limit.label) problems.push(`${name}: give a label of 1 to ${limit.label} characters`);
    const [from, to] = [clean(entry.from), clean(entry.to)];
    if (!from) problems.push(`${name} "${label}": from names the event or the anchor where it starts`);
    if (!to && entry.length === undefined)
      problems.push(`${name} "${label}": give to (the event where it ends) or length`);
    if (to && entry.length !== undefined) problems.push(`${name} "${label}": give to or length, not both`);
    let length: number | null = null;
    if (entry.length !== undefined) {
      if (!finite(entry.length, limit.offset) || entry.length <= 0)
        problems.push(`${name} "${label}": length must be a number above zero`);
      else length = entry.length;
    }
    let lengthUnit: TimelineOffsetUnit | null = null;
    if (entry.length_unit !== undefined) {
      if (!(TIMELINE_OFFSET_UNITS as readonly unknown[]).includes(entry.length_unit))
        problems.push(`${name} "${label}": length_unit must be ${TIMELINE_OFFSET_UNITS.join(', ')}`);
      else if (!calendar) problems.push(`${name} "${label}": a step axis counts in steps; leave length_unit out`);
      else lengthUnit = entry.length_unit as TimelineOffsetUnit;
    }
    if (entry.role !== undefined && !(TIMELINE_ROLES as readonly unknown[]).includes(entry.role))
      problems.push(`${name} "${label}": role must be ${TIMELINE_ROLES.join(', ')}`);
    spans.push({
      label,
      from,
      to,
      length,
      lengthUnit,
      role: (TIMELINE_ROLES as readonly unknown[]).includes(entry.role) ? (entry.role as TimelineRole) : null,
    });
  });
  if (problems.length || !unit) return fail(problems);

  // The zero of the axis: the anchor's date, else the first date; positions count from it.
  const dated = entries.flatMap((e) => (e.date !== null ? [e.date] : []));
  if (anchor && anchorDay === null && dated.length)
    return fail([
      `anchor: the events have dates, so give the anchor "${anchor.label}" a date too (YYYY-MM-DD), or leave the dates out`,
    ]);
  const origin: number | null = anchorDay ?? (dated.length ? Math.min(...dated) : null);
  if (entries.some((e) => e.at !== null) && dated.length && anchorDay === null)
    return fail([
      'events: at counts from the anchor, so with dates give the anchor a date, or place each event by date or after',
    ]);

  // Days from the zero (steps for a step axis) of every label that has been placed.
  const placed = new Map<string, number>();
  if (anchor) placed.set(anchor.label, 0);
  const resolved = new Map<Entry, number>();
  for (let pass = 0; pass <= entries.length; pass++) {
    for (const entry of entries) {
      if (resolved.has(entry)) continue;
      let at: number | undefined;
      if (entry.date !== null) at = entry.date - origin!;
      else if (entry.at !== null)
        at = unit === 'step' ? entry.at : shift(0, entry.at, unit as TimelineOffsetUnit, origin);
      else if (entry.after && placed.has(entry.after)) {
        const base = placed.get(entry.after)!;
        at =
          unit === 'step'
            ? base + entry.offset!
            : shift(base, entry.offset!, entry.offsetUnit ?? (unit as TimelineOffsetUnit), origin);
      }
      if (at === undefined) continue;
      resolved.set(entry, at);
      placed.set(entry.label, at);
    }
  }
  const stuck = entries.filter((e) => !resolved.has(e));
  if (stuck.length) {
    const unknown = stuck.filter((e) => !names.has(e.after));
    return fail(
      unknown.length
        ? unknown.map((e) => `event "${e.label}": after "${e.after}" is not the label of an event or of the anchor`)
        : [
            `events ${stuck.map((e) => `"${e.label}"`).join(' and ')} are each measured from another of them; place one by date or at`,
          ],
    );
  }

  const spanItems: TimelineSpan[] = [];
  for (const span of spans) {
    const name = `span "${span.label}"`;
    for (const ref of [span.from, span.to])
      if (ref && !placed.has(ref)) problems.push(`${name}: "${ref}" is not the label of an event or of the anchor`);
    if (problems.length) continue;
    const start = placed.get(span.from)!;
    const end = span.to
      ? placed.get(span.to)!
      : unit === 'step'
        ? start + span.length!
        : shift(start, span.length!, span.lengthUnit ?? (unit as TimelineOffsetUnit), origin);
    if (end <= start) {
      problems.push(`${name}: it ends at or before it starts; check from and to`);
      continue;
    }
    spanItems.push({
      label: span.label,
      from: span.from,
      ...(span.to ? { to: span.to } : {}),
      ...(span.length !== null ? { length: span.length } : {}),
      ...(span.lengthUnit ? { length_unit: span.lengthUnit } : {}),
      ...(span.role ? { role: span.role } : {}),
      start: round(start),
      end: round(end),
    });
    // A number in the name must be the length the code found.
    if (unit !== 'step')
      for (const [full, quoted, word] of span.label.matchAll(QUOTED))
        if (!matches(Number(quoted.replace(',', '.')), word.toLowerCase() as TimelineOffsetUnit, end - start))
          problems.push(
            `${name}: the label quotes "${full}", but from "${span.from}" to ${span.to ? `"${span.to}"` : `+${span.length}`} the code finds ${lengthText(end - start)}; remove the number from the label or fix the period`,
          );
  }

  const eventItems: TimelineEvent[] = entries.map((entry) => {
    const at = resolved.get(entry)!;
    // A number in the name of a relative event must be its offset, as the code resolved it.
    if (unit !== 'step' && entry.after)
      for (const [full, quoted, word] of entry.label.matchAll(QUOTED)) {
        const apart = Math.abs(at - placed.get(entry.after)!);
        if (!matches(Number(quoted.replace(',', '.')), word.toLowerCase() as TimelineOffsetUnit, apart))
          problems.push(
            `event "${entry.label}": the label quotes "${full}", but it falls ${lengthText(apart)} from "${entry.after}"; remove the number from the label or fix the offset`,
          );
      }
    return {
      label: entry.label,
      ...(entry.raw.date !== undefined && entry.raw.date !== '' ? { date: clean(entry.raw.date) } : {}),
      ...(entry.at !== null ? { at: entry.at } : {}),
      ...(entry.after
        ? { after: entry.after, offset: entry.offset!, ...(entry.offsetUnit ? { offset_unit: entry.offsetUnit } : {}) }
        : {}),
      ...(entry.deadline ? { deadline: true } : {}),
      position: round(at),
    };
  });
  const positions = [...eventItems.map((e) => e.position), ...spanItems.flatMap((s) => [s.start, s.end])];
  if (new Set(eventItems.map((e) => e.position)).size < 2)
    problems.push(
      'events: every event falls at the same place, so the axis shows nothing; give them different dates or offsets',
    );
  if (positions.some((p) => Math.abs(p) > limit.at))
    problems.push('events: the positions are too far apart for one axis; check the units');
  if (problems.length) return fail(problems);
  const title = clean(raw.title);
  return {
    problems: [],
    item: {
      kind: 'timeline',
      ...(title ? { title } : {}),
      unit,
      source: raw.source as TimelineItem['source'],
      ...(anchor ? { anchor } : {}),
      ...(origin !== null ? { origin: isoDate(origin) } : {}),
      events: eventItems,
      ...(spanItems.length ? { spans: spanItems } : {}),
    },
  };
}

/** Whether a quoted "N unit" is the distance the code found, within what calendar months and years vary. */
function matches(quoted: number, unit: TimelineOffsetUnit, distance: number): boolean {
  return Math.abs(quoted * UNIT_DAYS[unit] - distance) <= QUOTE_SLACK[unit];
}

/** A distance in days as a person would say it: days under two months (weeks when they are whole), else months and years when they are. */
export function lengthText(daysApart: number): string {
  const days = Math.round(daysApart);
  const months = daysApart / UNIT_DAYS.month;
  if (days >= 59 && Math.abs(months - Math.round(months)) * UNIT_DAYS.month <= 3.5)
    return Math.round(months) % 12 === 0
      ? plural(Math.round(months) / 12, 'year')
      : plural(Math.round(months), 'month');
  if (days >= 14 && days % 7 === 0) return plural(days / 7, 'week');
  return plural(days, 'day');
}

/** Reasons a timeline cannot be drawn, each worded as an instruction to the model; empty when it can. */
export function timelineProblems(raw: unknown): string[] {
  return build(raw).problems;
}

/** The clean item with every position computed. Call it once timelineProblems is empty. */
export function canonicalTimeline(raw: unknown): TimelineItem {
  const { item, problems } = build(raw);
  if (!item) throw new Error(`Timeline cannot be resolved: ${problems.join('; ')}`);
  return item;
}

/** The numbers an item of the document quotes, as (where, value) pairs for the evidence check: offsets, positions, lengths and date parts. */
export function timelineQuotes(item: TimelineItem): { where: string; value: number }[] {
  const out: { where: string; value: number }[] = [];
  const date = (where: string, text: string | undefined) => {
    const day = parseDate(text);
    if (!text || day === null) return;
    out.push({ where: `${where} year`, value: Number(text.slice(0, 4)) });
    if (/^\d{4}-\d{2}-\d{2}$/.test(text.trim()))
      out.push({ where: `${where} day`, value: Number(text.trim().slice(8, 10)) });
  };
  date(`anchor "${item.anchor?.label}"`, item.anchor?.date);
  for (const event of item.events) {
    date(`"${event.label}"`, event.date);
    if (event.at !== undefined) out.push({ where: `"${event.label}" position`, value: Math.abs(event.at) });
    if (event.offset !== undefined) out.push({ where: `"${event.label}" offset`, value: Math.abs(event.offset) });
  }
  for (const span of item.spans ?? [])
    if (span.length !== undefined) out.push({ where: `"${span.label}" length`, value: span.length });
  return out;
}
