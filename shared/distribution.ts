/**
 * One or two distributions drawn from their parameters (or from counts the document prints), the second being where the
 * first morphs to: before and after, prior and posterior, a change of a parameter. Densities, probabilities and the
 * shaded region's probability are computed here, so the board never shows a number the model worked out itself.
 */

export const DISTRIBUTION_FAMILIES = ['normal', 'uniform', 'binomial', 'poisson', 'exponential', 'counts'] as const;
export const DISTRIBUTION_SOURCES = ['document', 'illustrative'] as const;
export type DistributionFamily = (typeof DISTRIBUTION_FAMILIES)[number];

/** One distribution. Each family takes only its own parameters (see DISTRIBUTION_PARAMS). */
export interface DistributionSpec {
  family: DistributionFamily;
  /** What it is called on the board: Before, Prior, n = 100. */
  label: string;
  /** normal, poisson (the average count) or exponential (the average wait) */
  mean?: number;
  /** normal: the standard deviation (the spread) */
  sd?: number;
  /** uniform */
  min?: number;
  max?: number;
  /** binomial: trials and the chance of each */
  n?: number;
  p?: number;
  /** exponential: events per unit, instead of mean */
  rate?: number;
  /** counts: how many in each category, as the document prints them */
  categories?: string[];
  counts?: number[];
}

/** The part of the axis whose chance is read: P(from <= X <= to). A missing bound is open. */
export interface DistributionRegion {
  from?: number;
  to?: number;
  /** Computed: the chance under each distribution, in order. */
  probabilities: number[];
}

export interface DistributionItem {
  kind: 'distribution';
  title?: string;
  /** What is measured, with its unit, at most 40 characters. */
  x_label: string;
  source: 'document' | 'illustrative';
  /** One distribution, or two: the board morphs from the first to the second. */
  dists: DistributionSpec[];
  region?: DistributionRegion;
}

export const DISTRIBUTION_LIMITS = {
  title: 60,
  xLabel: [1, 40],
  dists: [1, 2],
  label: 24,
  categories: [2, 10],
  category: 16,
  trials: 1000,
  poissonMean: 1000,
  value: 1e6,
} as const;

/** The parameters each family takes. */
export const DISTRIBUTION_PARAMS: Record<DistributionFamily, readonly (keyof DistributionSpec)[]> = {
  normal: ['mean', 'sd'],
  uniform: ['min', 'max'],
  binomial: ['n', 'p'],
  poisson: ['mean'],
  exponential: ['mean', 'rate'],
  counts: ['categories', 'counts'],
};
const ALL_PARAMS = ['mean', 'sd', 'min', 'max', 'n', 'p', 'rate', 'categories', 'counts'] as const;

const L = DISTRIBUTION_LIMITS;
const number = (description: string) => ({ type: 'number', description });
export const DISTRIBUTION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['kind', 'x_label', 'source', 'dists'],
  properties: {
    kind: { type: 'string', enum: ['distribution'] },
    title: { type: 'string', maxLength: L.title, description: 'What changes or is compared, at most 6 words.' },
    x_label: {
      type: 'string',
      minLength: L.xLabel[0],
      maxLength: L.xLabel[1],
      description:
        'What is measured, in plain words with its unit, at most 40 characters, such as "waiting time (min)".',
    },
    source: {
      type: 'string',
      enum: [...DISTRIBUTION_SOURCES],
      description: 'document: parameters or counts printed in the document. illustrative: invented values.',
    },
    dists: {
      type: 'array',
      minItems: L.dists[0],
      maxItems: L.dists[1],
      description:
        '1-2 distributions of the same kind (both continuous, or both discrete). With two, the board morphs from the first to the second.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['family', 'label'],
        properties: {
          family: {
            type: 'string',
            enum: [...DISTRIBUTION_FAMILIES],
            description:
              'normal (mean, sd), uniform (min, max), binomial (n, p), poisson (mean), exponential (mean or rate), counts (categories and counts from the document).',
          },
          label: {
            type: 'string',
            minLength: 1,
            maxLength: L.label,
            description: 'Its name on the board, at most 24 characters.',
          },
          mean: number('normal: the mean. poisson: the average count. exponential: the average wait.'),
          sd: number('normal: the standard deviation, above zero.'),
          min: number('uniform: the lowest value.'),
          max: number('uniform: the highest value.'),
          n: { type: 'integer', minimum: 1, maximum: L.trials, description: 'binomial: the number of trials.' },
          p: number('binomial: the chance of each trial, between 0 and 1.'),
          rate: number('exponential: events per unit, instead of mean.'),
          categories: {
            type: 'array',
            minItems: L.categories[0],
            maxItems: L.categories[1],
            description: 'counts: 2-10 category names, at most 16 characters each.',
            items: { type: 'string', minLength: 1, maxLength: L.category },
          },
          counts: {
            type: 'array',
            minItems: L.categories[0],
            maxItems: L.categories[1],
            description: 'counts: how many fall in each category, copied as printed.',
            items: { type: 'number', minimum: 0 },
          },
        },
      },
    },
    region: {
      type: 'object',
      additionalProperties: false,
      description:
        'Optional: shade the part of the axis from "from" to "to" and read its chance. Give one bound for a tail. The code computes the probability.',
      properties: {
        from: number('The lower bound; leave out for everything below "to".'),
        to: number('The upper bound; leave out for everything above "from".'),
      },
    },
  },
};

// ------------------------------------------------------------ mathematics

/** Complementary error function, to a relative error of 1.2e-7 (Numerical Recipes, erfcc). */
function erfc(x: number): number {
  const z = Math.abs(x);
  const t = 1 / (1 + 0.5 * z);
  const r =
    t *
    Math.exp(
      -z * z -
        1.26551223 +
        t *
          (1.00002368 +
            t *
              (0.37409196 +
                t *
                  (0.09678418 +
                    t *
                      (-0.18628806 +
                        t *
                          (0.27886807 + t * (-1.13520398 + t * (1.48851587 + t * (-0.82215223 + t * 0.17087277)))))))),
    );
  return x >= 0 ? r : 2 - r;
}

const normalCdf = (x: number, mean: number, sd: number) => 0.5 * erfc(-(x - mean) / (sd * Math.SQRT2));

const LOG_FACTORIALS: number[] = [0];
/** ln(k!) from a table that grows as far as it is asked. */
function logFactorial(k: number): number {
  for (let i = LOG_FACTORIALS.length; i <= k; i++) LOG_FACTORIALS.push(LOG_FACTORIALS[i - 1] + Math.log(i));
  return LOG_FACTORIALS[k];
}

export const isDiscrete = (spec: Pick<DistributionSpec, 'family'>) =>
  spec.family === 'binomial' || spec.family === 'poisson' || spec.family === 'counts';

/** The exponential's rate, whichever way it was given. */
const exponentialRate = (spec: DistributionSpec) => spec.rate ?? 1 / spec.mean!;

/** The chance of each category as a share of the total. */
const shares = (spec: DistributionSpec) => {
  const total = spec.counts!.reduce((sum, count) => sum + count, 0);
  return spec.counts!.map((count) => count / total);
};

/**
 * The density of a continuous distribution at x, or the chance of a discrete one at the whole number x (a category is
 * counted from 1).
 */
export function density(spec: DistributionSpec, x: number): number {
  switch (spec.family) {
    case 'normal':
      return Math.exp(-0.5 * ((x - spec.mean!) / spec.sd!) ** 2) / (spec.sd! * Math.sqrt(2 * Math.PI));
    case 'uniform':
      return x >= spec.min! && x <= spec.max! ? 1 / (spec.max! - spec.min!) : 0;
    case 'exponential':
      return x < 0 ? 0 : exponentialRate(spec) * Math.exp(-exponentialRate(spec) * x);
    case 'binomial': {
      const [n, p] = [spec.n!, spec.p!];
      if (!Number.isInteger(x) || x < 0 || x > n) return 0;
      return Math.exp(
        logFactorial(n) - logFactorial(x) - logFactorial(n - x) + x * Math.log(p) + (n - x) * Math.log1p(-p),
      );
    }
    case 'poisson':
      return Number.isInteger(x) && x >= 0 ? Math.exp(-spec.mean! + x * Math.log(spec.mean!) - logFactorial(x)) : 0;
    case 'counts':
      return Number.isInteger(x) && x >= 1 && x <= spec.counts!.length ? shares(spec)[x - 1] : 0;
  }
}

/** Every whole number a discrete distribution can take (a tail beyond it is too small to count). */
function whole(spec: DistributionSpec): [number, number] {
  switch (spec.family) {
    case 'binomial':
      return [0, spec.n!];
    case 'poisson':
      return [0, Math.ceil(spec.mean! + 12 * Math.sqrt(spec.mean!) + 20)];
    default:
      return [1, spec.counts!.length];
  }
}

/** The chance that X is at most x. */
export function cdf(spec: DistributionSpec, x: number): number {
  if (x === Infinity) return 1;
  if (x === -Infinity) return 0;
  switch (spec.family) {
    case 'normal':
      return normalCdf(x, spec.mean!, spec.sd!);
    case 'uniform':
      return Math.min(1, Math.max(0, (x - spec.min!) / (spec.max! - spec.min!)));
    case 'exponential':
      return x <= 0 ? 0 : 1 - Math.exp(-exponentialRate(spec) * x);
    default:
      return probability(spec, undefined, x);
  }
}

/** P(from <= X <= to); a missing bound is open. A discrete distribution counts the whole numbers in the range, both ends included. */
export function probability(spec: DistributionSpec, from?: number, to?: number): number {
  const [lo, hi] = [from ?? -Infinity, to ?? Infinity];
  if (isDiscrete(spec)) {
    const [first, last] = whole(spec);
    let total = 0;
    for (let k = Math.max(Math.ceil(lo), first); k <= Math.min(Math.floor(hi), last); k++) total += density(spec, k);
    return Math.min(1, total);
  }
  return Math.max(0, cdf(spec, hi) - cdf(spec, lo));
}

/** The range worth drawing: about 99.99% of a distribution, or all of a bounded one; whole numbers for a discrete one. */
export function support(spec: DistributionSpec): [number, number] {
  switch (spec.family) {
    case 'normal':
      return [spec.mean! - 4 * spec.sd!, spec.mean! + 4 * spec.sd!];
    case 'uniform':
      return [spec.min!, spec.max!];
    case 'exponential':
      return [0, Math.log(10000) / exponentialRate(spec)];
    case 'counts':
      return [1, spec.counts!.length];
    case 'binomial':
    case 'poisson': {
      const mean = spec.family === 'binomial' ? spec.n! * spec.p! : spec.mean!;
      const sd = spec.family === 'binomial' ? Math.sqrt(spec.n! * spec.p! * (1 - spec.p!)) : Math.sqrt(spec.mean!);
      const lo = Math.max(0, Math.floor(mean - 4 * sd));
      const hi = Math.max(Math.ceil(mean + 4 * sd), lo + 5);
      return [lo, spec.family === 'binomial' ? Math.min(spec.n!, hi) : hi];
    }
  }
}

/** Mean and spread, for a readout; null for counts, which are categories. */
export function summary(spec: DistributionSpec): { mean: number; sd: number } | null {
  switch (spec.family) {
    case 'normal':
      return { mean: spec.mean!, sd: spec.sd! };
    case 'uniform':
      return { mean: (spec.min! + spec.max!) / 2, sd: (spec.max! - spec.min!) / Math.sqrt(12) };
    case 'exponential':
      return { mean: 1 / exponentialRate(spec), sd: 1 / exponentialRate(spec) };
    case 'binomial':
      return { mean: spec.n! * spec.p!, sd: Math.sqrt(spec.n! * spec.p! * (1 - spec.p!)) };
    case 'poisson':
      return { mean: spec.mean!, sd: Math.sqrt(spec.mean!) };
    case 'counts':
      return null;
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/**
 * The distribution part-way from a to b, when they are of one family whose parameters can slide (so a bell curve moves
 * and narrows as one shape rather than fading into another); null when the only honest morph is a blend of the two.
 */
export function morphSpec(a: DistributionSpec, b: DistributionSpec, t: number): DistributionSpec | null {
  if (a.family !== b.family) return null;
  const label = t < 0.5 ? a.label : b.label;
  switch (a.family) {
    case 'normal':
      return { family: 'normal', label, mean: lerp(a.mean!, b.mean!, t), sd: lerp(a.sd!, b.sd!, t) };
    case 'uniform':
      return { family: 'uniform', label, min: lerp(a.min!, b.min!, t), max: lerp(a.max!, b.max!, t) };
    case 'exponential':
      return { family: 'exponential', label, mean: lerp(1 / exponentialRate(a), 1 / exponentialRate(b), t) };
    case 'poisson':
      return { family: 'poisson', label, mean: lerp(a.mean!, b.mean!, t) };
    case 'binomial':
      return a.n === b.n ? { family: 'binomial', label, n: a.n, p: lerp(a.p!, b.p!, t) } : null;
    case 'counts':
      return null;
  }
}

/** The density (or chance) of the morph at x. */
export function morphDensity(a: DistributionSpec, b: DistributionSpec, t: number, x: number): number {
  const mix = morphSpec(a, b, t);
  return mix ? density(mix, x) : lerp(density(a, x), density(b, x), t);
}

/** P(from <= X <= to) under the morph. */
export function morphProbability(
  a: DistributionSpec,
  b: DistributionSpec,
  t: number,
  from?: number,
  to?: number,
): number {
  const mix = morphSpec(a, b, t);
  return mix ? probability(mix, from, to) : lerp(probability(a, from, to), probability(b, from, to), t);
}

/** The range of the axis: every distribution's range together. */
export function distributionRange(item: Pick<DistributionItem, 'dists'>): [number, number] {
  const ranges = item.dists.map(support);
  return [Math.min(...ranges.map((r) => r[0])), Math.max(...ranges.map((r) => r[1]))];
}

/** The tallest the morph ever gets: the board fixes its vertical scale to it, so a narrowing shows as growing taller. */
export function distributionPeak(item: Pick<DistributionItem, 'dists'>): number {
  const [lo, hi] = distributionRange(item);
  const [a, b] = [item.dists[0], item.dists[item.dists.length - 1]];
  const xs = isDiscrete(a)
    ? Array.from({ length: Math.round(hi - lo) + 1 }, (_, i) => lo + i)
    : Array.from({ length: 481 }, (_, i) => lo + ((hi - lo) * i) / 480);
  let peak = 0;
  for (let step = 0; step <= 10; step++) for (const x of xs) peak = Math.max(peak, morphDensity(a, b, step / 10, x));
  return peak;
}

/** How different two distributions look: half the area between them, from 0 (the same) to 1 (apart). */
export function distance(a: DistributionSpec, b: DistributionSpec): number {
  const [lo, hi] = distributionRange({ dists: [a, b] });
  if (isDiscrete(a)) {
    let total = 0;
    for (let k = Math.floor(lo); k <= Math.ceil(hi); k++) total += Math.abs(density(a, k) - density(b, k));
    return total / 2;
  }
  const steps = 800;
  const dx = (hi - lo) / steps;
  let total = 0;
  for (let i = 0; i <= steps; i++) total += Math.abs(density(a, lo + i * dx) - density(b, lo + i * dx)) * dx;
  return total / 2;
}

/** The parameters in words, for the legend: "mean 100, sd 15", "n = 20, p = 0.3", "3 categories, 120 in all". */
export function describeSpec(spec: DistributionSpec): string {
  const g = (value: number) => String(Number(value.toPrecision(4)));
  switch (spec.family) {
    case 'normal':
      return `mean ${g(spec.mean!)}, sd ${g(spec.sd!)}`;
    case 'uniform':
      return `from ${g(spec.min!)} to ${g(spec.max!)}`;
    case 'exponential':
      return spec.rate !== undefined ? `rate ${g(spec.rate)}` : `mean ${g(spec.mean!)}`;
    case 'binomial':
      return `n = ${spec.n}, p = ${g(spec.p!)}`;
    case 'poisson':
      return `mean ${g(spec.mean!)}`;
    case 'counts':
      return `${g(spec.counts!.reduce((sum, count) => sum + count, 0))} in all`;
  }
}

// -------------------------------------------------------------- the check

const isRaw = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const clean = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= L.value;
const given = (value: unknown) => value !== undefined && value !== null;

/** The distribution a raw entry describes with its problems, each worded as an instruction to the model. */
function readSpec(entry: unknown, name: string): { spec: DistributionSpec | null; problems: string[] } {
  if (!isRaw(entry)) return { spec: null, problems: [`${name}: give an object with a family and a label`] };
  const problems: string[] = [];
  const family = (DISTRIBUTION_FAMILIES as readonly unknown[]).includes(entry.family)
    ? (entry.family as DistributionFamily)
    : null;
  if (!family) problems.push(`${name}: family must be ${DISTRIBUTION_FAMILIES.join(', ')}`);
  const label = clean(entry.label);
  if (!label) problems.push(`${name}: the label is empty`);
  else if (label.length > L.label)
    problems.push(`${name}: the label "${label}" is longer than ${L.label} characters; shorten it`);
  if (!family) return { spec: null, problems };
  const own = DISTRIBUTION_PARAMS[family];
  const extra = ALL_PARAMS.filter((key) => given(entry[key]) && !own.includes(key));
  if (extra.length)
    problems.push(
      `${name}: ${family} takes ${own.join(' and ')}, not ${extra.join(' or ')}; remove ${extra.join(' and ')}`,
    );
  const need = (key: (typeof ALL_PARAMS)[number], ok: (value: number) => boolean, rule: string): number | undefined => {
    const value = entry[key];
    if (!finite(value) || !ok(value)) {
      problems.push(`${name}: ${family} needs ${key} ${rule}`);
      return undefined;
    }
    return value;
  };
  const spec: DistributionSpec = { family, label };
  switch (family) {
    case 'normal':
      spec.mean = need('mean', () => true, 'as a number');
      spec.sd = need('sd', (v) => v > 0, 'above zero (the spread)');
      break;
    case 'uniform':
      spec.min = need('min', () => true, 'as a number');
      spec.max = need('max', (v) => v > (spec.min ?? -Infinity), 'above min');
      break;
    case 'binomial':
      spec.n = need(
        'n',
        (v) => Number.isInteger(v) && v >= 1 && v <= L.trials,
        `as a whole number from 1 to ${L.trials}`,
      );
      spec.p = need('p', (v) => v > 0 && v < 1, 'strictly between 0 and 1 (write 30% as 0.3)');
      break;
    case 'poisson':
      spec.mean = need(
        'mean',
        (v) => v > 0 && v <= L.poissonMean,
        `above zero and at most ${L.poissonMean} (the average count)`,
      );
      break;
    case 'exponential': {
      if (given(entry.mean) === given(entry.rate))
        problems.push(`${name}: exponential needs mean or rate, one of them`);
      else if (given(entry.mean)) spec.mean = need('mean', (v) => v > 0, 'above zero');
      else spec.rate = need('rate', (v) => v > 0, 'above zero');
      break;
    }
    case 'counts': {
      const [fewest, most] = L.categories;
      const names = Array.isArray(entry.categories) ? entry.categories.map(clean) : [];
      const counts = Array.isArray(entry.counts) ? entry.counts : [];
      if (names.length < fewest || names.length > most)
        problems.push(`${name}: counts needs ${fewest} to ${most} categories`);
      else if (names.some((c) => !c || c.length > L.category))
        problems.push(`${name}: each category name is 1 to ${L.category} characters`);
      else if (new Set(names).size < names.length) problems.push(`${name}: the category names must differ`);
      else if (counts.length !== names.length)
        problems.push(`${name}: give one count per category (${names.length}), not ${counts.length}`);
      else if (!counts.every((c) => finite(c) && c >= 0) || counts.reduce((sum: number, c: number) => sum + c, 0) <= 0)
        problems.push(`${name}: counts must be numbers from zero up, not all zero`);
      else {
        spec.categories = names;
        spec.counts = [...counts];
      }
      break;
    }
  }
  return { spec: problems.length ? null : spec, problems };
}

/** Reasons a distribution board cannot be drawn, each worded as an instruction to the model; empty when it can. */
export function distributionProblems(raw: unknown): string[] {
  if (!isRaw(raw)) return ['Distribution must be an object.'];
  const problems: string[] = [];
  if (raw.kind !== 'distribution') problems.push('Unknown distribution kind.');
  if (raw.title !== undefined && (typeof raw.title !== 'string' || clean(raw.title).length > L.title))
    problems.push(`title: use at most ${L.title} characters`);
  const label = clean(raw.x_label);
  if (label.length < L.xLabel[0] || label.length > L.xLabel[1])
    problems.push(`x_label: give plain words with the unit, ${L.xLabel[0]} to ${L.xLabel[1]} characters`);
  if (!(DISTRIBUTION_SOURCES as readonly unknown[]).includes(raw.source))
    problems.push(`source: use ${DISTRIBUTION_SOURCES.join(' or ')}`);
  const [fewest, most] = L.dists;
  if (!Array.isArray(raw.dists)) return [...problems, `dists: give a list of ${fewest} to ${most} distributions`];
  if (raw.dists.length < fewest || raw.dists.length > most)
    return [...problems, `dists: give ${fewest} to ${most} distributions, not ${raw.dists.length}`];
  const specs = raw.dists.map((entry: unknown, i: number) => readSpec(entry, `dist ${i + 1}`));
  problems.push(...specs.flatMap((s) => s.problems));
  const read = specs.flatMap((s) => (s.spec ? [s.spec] : []));
  if (read.length < specs.length) return problems;

  if (read.length === 2) {
    const [a, b] = read;
    if (a.label === b.label) problems.push(`dists: both are called "${a.label}"; give each its own label`);
    if (isDiscrete(a) !== isDiscrete(b))
      problems.push(
        `dists: ${a.family} and ${b.family} cannot share one axis (one is discrete, the other continuous); use two of the same kind`,
      );
    else if (a.family === 'counts' && b.family === 'counts') {
      if (a.categories!.join('|') !== b.categories!.join('|'))
        problems.push('dists: two counts must have the same categories in the same order');
    } else if (a.family === 'counts' || b.family === 'counts')
      problems.push('dists: counts cannot share an axis with a parametric family; use two counts');
    else {
      const [lo, hi] = distributionRange({ dists: read });
      const thin = read.find((s) => (support(s)[1] - support(s)[0]) / (hi - lo) < 0.06);
      if (thin)
        problems.push(
          `dists: "${thin.label}" would be a thin spike next to the other, whose scale is far larger; choose parameters on a similar scale, or draw one distribution`,
        );
    }
    if (!problems.length && distance(a, b) < 0.03)
      problems.push(
        'dists: the two distributions are almost the same, so the morph would show nothing; change the parameters that the text changes',
      );
  }

  if (raw.region !== undefined) {
    const region = raw.region;
    const [from, to] = isRaw(region) ? [region.from, region.to] : [undefined, undefined];
    if (!isRaw(region)) problems.push('region: give an object with from and/or to');
    else if (read.some((s) => s.family === 'counts'))
      problems.push('region: a region needs a numeric axis, not counts');
    else if (!given(from) && !given(to)) problems.push('region: give from, to, or both');
    else if ((given(from) && !finite(from)) || (given(to) && !finite(to)))
      problems.push('region: from and to must be numbers');
    else if (given(from) && given(to) && (from as number) >= (to as number))
      problems.push('region: from must be below to');
    else if (!problems.length) {
      const [lo, hi] = distributionRange({ dists: read });
      const margin = hi - lo;
      const outside = [from, to].find((v) => given(v) && ((v as number) < lo - margin || (v as number) > hi + margin));
      const chances = read.map((s) => probability(s, from as number | undefined, to as number | undefined));
      if (outside !== undefined)
        problems.push(
          `region: ${outside} is far outside the axis (${Number(lo.toPrecision(3))} to ${Number(hi.toPrecision(3))}); choose bounds inside it`,
        );
      else if (chances.every((p) => p < 0.0005 || p > 0.9995))
        problems.push(
          'region: the chance of that range is almost 0 or almost 1 under every distribution, so the shading would show nothing; choose bounds with a visible chance',
        );
    }
  }
  return problems;
}

/** The clean item: trimmed text, only each family's own parameters, the region's chances computed. Call it once distributionProblems is empty. */
export function canonicalDistribution(raw: unknown): DistributionItem {
  const item = raw as Record<string, unknown>;
  const dists = (item.dists as unknown[]).map((entry, i) => {
    const { spec } = readSpec(entry, `dist ${i + 1}`);
    return spec!;
  });
  const title = clean(item.title);
  const region = item.region as { from?: number; to?: number } | undefined;
  return {
    kind: 'distribution',
    ...(title ? { title } : {}),
    x_label: clean(item.x_label),
    source: item.source as DistributionItem['source'],
    dists,
    ...(region
      ? {
          region: {
            ...(given(region.from) ? { from: region.from } : {}),
            ...(given(region.to) ? { to: region.to } : {}),
            probabilities: dists.map((spec) =>
              Number(probability(spec, region.from ?? undefined, region.to ?? undefined).toPrecision(6)),
            ),
          },
        }
      : {}),
  };
}

/**
 * The numbers an item of the document quotes, as (where, value, alternatives) for the evidence check: the parameters and
 * counts. The region's bounds are the question asked of them, not data, so they are not among them.
 */
export function distributionQuotes(
  item: DistributionItem,
): { where: string; value: number; alternatives?: number[] }[] {
  const out: { where: string; value: number; alternatives?: number[] }[] = [];
  for (const spec of item.dists) {
    const at = (key: keyof DistributionSpec, alternatives?: number[]) => {
      const value = spec[key];
      if (typeof value === 'number')
        out.push({ where: `"${spec.label}" ${key}`, value, ...(alternatives ? { alternatives } : {}) });
    };
    at('mean');
    // A variance is printed where a spread is meant; a chance may be printed as a percentage.
    if (typeof spec.sd === 'number')
      out.push({ where: `"${spec.label}" sd`, value: spec.sd, alternatives: [spec.sd ** 2] });
    at('min');
    at('max');
    at('n');
    if (typeof spec.p === 'number')
      out.push({ where: `"${spec.label}" p`, value: spec.p, alternatives: [spec.p * 100] });
    at('rate');
    for (const count of spec.counts ?? []) out.push({ where: `"${spec.label}" count`, value: count });
  }
  return out;
}
