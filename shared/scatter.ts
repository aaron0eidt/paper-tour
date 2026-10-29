/** Points on two measured axes: a trade-off or relationship between two quantities. */
export interface ScatterItem {
  kind: 'scatter';
  title?: string;
  /** Plain words with the unit, at most 40 characters. */
  x_label: string;
  y_label: string;
  x_log?: boolean;
  y_log?: boolean;
  /** The corner where results are better. */
  better?: 'up-left' | 'up-right' | 'down-left' | 'down-right';
  /** Points of one series are joined in order. */
  points: { label: string; x: number; y: number; series?: string }[];
  source: 'document' | 'illustrative';
}

export const SCATTER_LIMITS = {
  title: 60,
  points: [2, 10],
  pointLabel: 24,
  series: 3,
  axisLabel: [1, 40],
} as const;
export const SCATTER_BETTER = ['up-left', 'up-right', 'down-left', 'down-right'] as const;
export const SCATTER_SOURCES = ['document', 'illustrative'] as const;

const axisLabel = (axis: string) => ({
  type: 'string',
  minLength: SCATTER_LIMITS.axisLabel[0],
  maxLength: SCATTER_LIMITS.axisLabel[1],
  description: `The ${axis} quantity in plain words with its unit, at most 40 characters, such as "latency (ms)".`,
});
export const SCATTER_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'x_label', 'y_label', 'points', 'source'],
  properties: {
    kind: { type: 'string', enum: ['scatter'] },
    title: {
      type: 'string',
      maxLength: SCATTER_LIMITS.title,
      description: 'What the points compare, at most 6 words.',
    },
    x_label: axisLabel('x-axis'),
    y_label: axisLabel('y-axis'),
    x_log: {
      type: 'boolean',
      description: 'A log x axis, for values that span orders of magnitude; every x must be above zero.',
    },
    y_log: { type: 'boolean', description: 'A log y axis; every y must be above zero.' },
    better: {
      type: 'string',
      enum: [...SCATTER_BETTER],
      description: 'The corner of the plot where results are better, when one is.',
    },
    points: {
      type: 'array',
      minItems: SCATTER_LIMITS.points[0],
      maxItems: SCATTER_LIMITS.points[1],
      description: '2-10 points, each a named result with its x and y.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['label', 'x', 'y'],
        properties: {
          label: {
            type: 'string',
            minLength: 1,
            maxLength: SCATTER_LIMITS.pointLabel,
            description: 'Distinct, at most 24 characters.',
          },
          x: { type: 'number', description: 'Copied exactly as printed for source document.' },
          y: { type: 'number', description: 'Copied exactly as printed for source document.' },
          series: {
            type: 'string',
            minLength: 1,
            maxLength: SCATTER_LIMITS.pointLabel,
            description: 'A group name; points of one series are joined in order. At most 3 different series.',
          },
        },
      },
    },
    source: {
      type: 'string',
      enum: [...SCATTER_SOURCES],
      description: 'document: numbers printed in the paper. illustrative: invented example values.',
    },
  },
};

const isRaw = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const clean = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** The distinct series names, in the order they first appear. */
export function scatterSeries(points: { series?: string }[]): string[] {
  return [...new Set(points.flatMap((point) => (point.series ? [point.series] : [])))];
}

/** Reasons a scatter cannot be drawn, each worded as an instruction to the model; empty when it can. */
export function scatterProblems(raw: unknown): string[] {
  if (!isRaw(raw)) return ['Scatter must be an object.'];
  const problems: string[] = [];
  if (raw.kind !== 'scatter') problems.push('Unknown scatter kind.');
  if (raw.title !== undefined && (typeof raw.title !== 'string' || clean(raw.title).length > SCATTER_LIMITS.title))
    problems.push(`title: use at most ${SCATTER_LIMITS.title} characters`);
  const [shortest, longest] = SCATTER_LIMITS.axisLabel;
  for (const name of ['x_label', 'y_label'] as const) {
    const label = clean(raw[name]);
    if (label.length < shortest || label.length > longest)
      problems.push(`${name}: give plain words with the unit, ${shortest} to ${longest} characters`);
  }
  for (const name of ['x_log', 'y_log'] as const)
    if (raw[name] !== undefined && typeof raw[name] !== 'boolean') problems.push(`${name}: use true or false`);
  if (raw.better !== undefined && !(SCATTER_BETTER as readonly unknown[]).includes(raw.better))
    problems.push(`better: use ${SCATTER_BETTER.join(', ')}`);
  if (!(SCATTER_SOURCES as readonly unknown[]).includes(raw.source))
    problems.push(`source: use ${SCATTER_SOURCES.join(' or ')}`);

  const [fewest, most] = SCATTER_LIMITS.points;
  if (!Array.isArray(raw.points)) return [...problems, `points: give a list of ${fewest} to ${most} points`];
  if (raw.points.length < fewest || raw.points.length > most)
    return [...problems, `points: give ${fewest} to ${most} points, not ${raw.points.length}`];
  const points: { label: string; x: number; y: number; series: string }[] = [];
  const seen = new Set<string>();
  raw.points.forEach((entry: unknown, i: number) => {
    const name = `point ${i + 1}`;
    if (!isRaw(entry)) {
      problems.push(`${name}: give an object with label, x and y`);
      return;
    }
    const label = clean(entry.label);
    if (!label) problems.push(`${name}: the label is empty`);
    else if (label.length > SCATTER_LIMITS.pointLabel)
      problems.push(`${name}: the label "${label}" is longer than ${SCATTER_LIMITS.pointLabel} characters; shorten it`);
    else if (seen.has(label)) problems.push(`${name}: the label "${label}" is used twice`);
    seen.add(label);
    const series = clean(entry.series);
    if (entry.series !== undefined && (typeof entry.series !== 'string' || series.length > SCATTER_LIMITS.pointLabel))
      problems.push(`${name}: the series must be a name of at most ${SCATTER_LIMITS.pointLabel} characters`);
    if (!finite(entry.x) || !finite(entry.y)) problems.push(`${name}: x and y must both be finite numbers`);
    else points.push({ label: label || name, x: entry.x, y: entry.y, series });
  });
  const groups = scatterSeries(points);
  if (groups.length > SCATTER_LIMITS.series)
    problems.push(`points: use at most ${SCATTER_LIMITS.series} different series, not ${groups.length}`);
  if (points.length === raw.points.length)
    for (const axis of ['x', 'y'] as const) {
      const log = raw[`${axis}_log`] === true;
      const low = points.find((point) => log && point[axis] <= 0);
      if (low)
        problems.push(
          `${axis}_log: a log axis needs values above zero, but "${low.label}" has ${axis} = ${low[axis]}; use a linear axis`,
        );
      else if (new Set(points.map((point) => point[axis])).size < 2)
        problems.push(
          `points: every point has the same ${axis}, so that axis shows nothing; give points different ${axis} values`,
        );
    }
  return problems;
}

/** The clean item: trimmed text, options kept only when set. Call it once scatterProblems is empty. */
export function canonicalScatter(raw: unknown): ScatterItem {
  const item = raw as Record<string, unknown>;
  const title = clean(item.title);
  return {
    kind: 'scatter',
    ...(title ? { title } : {}),
    x_label: clean(item.x_label),
    y_label: clean(item.y_label),
    ...(item.x_log === true ? { x_log: true } : {}),
    ...(item.y_log === true ? { y_log: true } : {}),
    ...(item.better ? { better: item.better as ScatterItem['better'] } : {}),
    points: (item.points as Record<string, unknown>[]).map((point) => {
      const series = clean(point.series);
      return { label: clean(point.label), x: point.x as number, y: point.y as number, ...(series ? { series } : {}) };
    }),
    source: item.source as ScatterItem['source'],
  };
}
