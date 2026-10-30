import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  DISTRIBUTION_SCHEMA,
  canonicalDistribution,
  cdf,
  density,
  describeSpec,
  distance,
  distributionPeak,
  distributionProblems,
  distributionRange,
  morphProbability,
  morphSpec,
  probability,
  summary,
  type DistributionSpec,
} from '../../shared/distribution';
import {
  TIMELINE_SCHEMA,
  addMonths,
  canonicalTimeline,
  isoDate,
  lengthText,
  parseDate,
  timelineProblems,
} from '../../shared/timeline';
import { boardSignature } from '../src/harness/assemble';
import { boardParts, checkBoard } from '../src/harness/board';
import { groundedProblems } from '../src/harness/visual-rules';

const has = (problems: string[], pattern: RegExp) =>
  assert.ok(
    problems.some((p) => pattern.test(p)),
    problems.join(' | '),
  );

// ------------------------------------------------------------------ timeline

/** A lease: notice cannot be served in the first 3 months, and then runs for 3 more. */
const lease = () => ({
  kind: 'timeline',
  title: 'Earliest exit',
  unit: 'month',
  source: 'document',
  anchor: { label: 'Lease starts' },
  events: [
    { label: 'Notice allowed', after: 'Lease starts', offset: 3 },
    { label: 'Earliest exit', after: 'Notice allowed', offset: 3 },
    { label: 'Fixed term ends', after: 'Lease starts', offset: 12 },
  ],
  spans: [
    { label: 'Too early to serve', from: 'Lease starts', to: 'Notice allowed', role: 'wait' },
    { label: 'Notice runs', from: 'Notice allowed', to: 'Earliest exit', role: 'notice' },
  ],
});
const withLease = (change: Record<string, unknown>) => timelineProblems({ ...lease(), ...change });

test('periods are resolved by the code: the earliest exit is the two periods added, not what the model wrote', () => {
  const item = canonicalTimeline(lease());
  const [allowed, exit, ends] = item.events;
  assert.equal(allowed.position, 91.3125, 'three nominal months, in days from the anchor');
  assert.equal(exit.position, 182.625, 'six months after the start');
  assert.equal(ends.position, 365.25);
  assert.deepEqual(
    item.spans!.map((s) => [s.start, s.end]),
    [
      [0, 91.3125],
      [91.3125, 182.625],
    ],
  );
  assert.equal(item.origin, undefined, 'no dates, no calendar');
});

test('with dates, months are counted on the calendar and clamp to the end of a shorter month', () => {
  const item = canonicalTimeline({
    kind: 'timeline',
    unit: 'day',
    source: 'document',
    anchor: { label: 'Notice served', date: '2022-01-31' },
    events: [
      { label: 'Review date', date: '2022-03-31' },
      { label: 'Earliest exit', after: 'Notice served', offset: 3, offset_unit: 'month' },
      { label: 'Reply due', after: 'Notice served', offset: 14 },
    ],
    spans: [{ label: 'Window', from: 'Notice served', length: 28 }],
  });
  assert.equal(item.origin, '2022-01-31');
  assert.deepEqual(
    item.events.map((e) => e.position),
    [59, 89, 14],
    '31 January plus 3 months is 30 April, 89 days on',
  );
  assert.deepEqual([item.spans![0].start, item.spans![0].end], [0, 28]);
  assert.equal(isoDate(parseDate('2022-01-31')! + 89), '2022-04-30');
  assert.equal(isoDate(addMonths(parseDate('2024-01-31')!, 1)), '2024-02-29', 'a leap year');
  assert.equal(isoDate(addMonths(parseDate('2022-03-15')!, -4)), '2021-11-15');
});

test('without an anchor the first date is zero, and what comes before it is negative', () => {
  const item = canonicalTimeline({
    kind: 'timeline',
    unit: 'day',
    source: 'document',
    events: [
      { label: 'Review date', date: '2026-09-01' },
      { label: 'Latest notice', after: 'Review date', offset: -28 },
      { label: 'Earliest notice', after: 'Review date', offset: -90 },
    ],
    spans: [{ label: 'Notice must arrive', from: 'Earliest notice', to: 'Latest notice', role: 'window' }],
  });
  assert.equal(item.origin, '2026-09-01');
  assert.deepEqual(
    item.events.map((e) => e.position),
    [0, -28, -90],
  );
  assert.deepEqual([item.spans![0].start, item.spans![0].end], [-90, -28]);
});

test('an ordered list of steps needs no calendar', () => {
  const steps = {
    kind: 'timeline',
    unit: 'step',
    source: 'illustrative',
    events: [
      { label: 'Parse', at: 1 },
      { label: 'Plan', at: 2 },
      { label: 'Run', after: 'Plan', offset: 1 },
    ],
  };
  assert.deepEqual(
    canonicalTimeline(steps).events.map((e) => e.position),
    [1, 2, 3],
  );
  has(
    timelineProblems({ ...steps, events: [{ label: 'Parse', date: '2022-01-01' }, steps.events[1]] }),
    /a date needs a calendar unit/,
  );
  has(
    timelineProblems({ ...steps, events: [{ ...steps.events[2], offset_unit: 'day' }, steps.events[0]] }),
    /a step axis counts in steps; leave offset_unit out/,
  );
});

test('each event is placed one way, and references must resolve without a cycle', () => {
  has(
    withLease({
      events: [
        { label: 'A', date: '2022-01-01', at: 1 },
        { label: 'B', at: 2 },
      ],
    }),
    /place it one way/,
  );
  has(withLease({ events: [{ label: 'A' }, { label: 'B', at: 2 }] }), /place it one way.*it has none/);
  has(
    withLease({
      events: [
        { label: 'A', after: 'Lease starts' },
        { label: 'B', at: 2 },
      ],
    }),
    /after needs an offset/,
  );
  has(
    withLease({
      events: [
        { label: 'A', at: 1, offset: 3 },
        { label: 'B', at: 2 },
      ],
    }),
    /offset needs after/,
  );
  has(
    withLease({
      events: [
        { label: 'A', after: 'Nowhere', offset: 1 },
        { label: 'B', at: 2 },
      ],
    }),
    /after "Nowhere" is not the label of an event or of the anchor/,
  );
  has(
    withLease({
      events: [
        { label: 'A', after: 'B', offset: 1 },
        { label: 'B', after: 'A', offset: 1 },
      ],
    }),
    /"A" and "B" are each measured from another of them/,
  );
  has(
    withLease({
      events: [
        { label: 'A', at: 1 },
        { label: 'A', at: 2 },
      ],
    }),
    /the label "A" is used twice/,
  );
  has(
    withLease({
      events: [
        { label: 'Lease starts', at: 1 },
        { label: 'B', at: 2 },
      ],
    }),
    /used twice \(also for the anchor\)/,
  );
  has(withLease({ events: [{ label: 'A', at: 1 }] }), /give 2 to 8 events, not 1/);
  has(
    withLease({
      events: [
        { label: 'A', at: 1 },
        { label: 'B', at: 1 },
      ],
    }),
    /every event falls at the same place/,
  );
  has(
    withLease({
      events: [
        { label: 'A', date: '2022-02-30' },
        { label: 'B', at: 2 },
      ],
    }),
    /not a real date/,
  );
  has(withLease({ unit: 'decade' }), /unit: use day, week, month, year, step/);
  has(withLease({ source: 'measured' }), /source: use document or illustrative/);
});

test('with dates the anchor needs one too, and a span must run forwards', () => {
  has(
    withLease({
      events: [
        { label: 'Review', date: '2026-09-01' },
        { label: 'B', after: 'Review', offset: 1 },
      ],
    }),
    /give the anchor "Lease starts" a date too/,
  );
  has(
    withLease({ spans: [{ label: 'Backwards', from: 'Earliest exit', to: 'Notice allowed' }] }),
    /span "Backwards": it ends at or before it starts/,
  );
  has(withLease({ spans: [{ label: 'Lost', from: 'Nowhere', to: 'Notice allowed' }] }), /"Nowhere" is not the label/);
  has(
    withLease({ spans: [{ label: 'Both', from: 'Lease starts', to: 'Notice allowed', length: 3 }] }),
    /give to or length, not both/,
  );
  has(withLease({ spans: [{ label: 'Neither', from: 'Lease starts' }] }), /give to .* or length/);
});

test('a number in a label must be the length the code found, so the board never states what the document does not', () => {
  assert.deepEqual(
    withLease({ spans: [{ label: '3 months notice', from: 'Notice allowed', to: 'Earliest exit' }] }),
    [],
  );
  has(
    withLease({ spans: [{ label: '2 months notice', from: 'Notice allowed', to: 'Earliest exit' }] }),
    /the label quotes "2 months", but .* the code finds 3 months/,
  );
  has(
    withLease({
      events: [
        { label: 'Notice allowed', after: 'Lease starts', offset: 3 },
        { label: 'Exit after 4 months', after: 'Notice allowed', offset: 3 },
      ],
    }),
    /the label quotes "4 months", but it falls 3 months from "Notice allowed"/,
  );
  assert.deepEqual(
    withLease({
      anchor: { label: 'Notice served' },
      unit: 'day',
      events: [
        { label: 'Interest after 14 days', after: 'Notice served', offset: 14 },
        { label: 'Deposit by 30-day mark', after: 'Notice served', offset: 30 },
      ],
      spans: [],
    }),
    [],
  );
  assert.equal(lengthText(89), '3 months');
  assert.equal(lengthText(28), '4 weeks');
  assert.equal(lengthText(30), '30 days');
  assert.equal(lengthText(62), '2 months');
  assert.equal(lengthText(5), '5 days');
  assert.equal(lengthText(730.5), '2 years');
});

test("the periods of a document's own timeline must be printed, in digits or in words; an illustrative one needs none", () => {
  const printed =
    "A tenant may leave by giving at least 3 months' notice; none may be given in the first three months. The term is 12 months.";
  assert.deepEqual(checkBoard('timeline', lease(), printed).problems, []);
  const words = { ...lease(), events: lease().events.map((e) => (e.offset === 3 ? { ...e, offset: 3 } : e)) };
  assert.ok(checkBoard('timeline', words, 'Notice of three months; a term of twelve months.').item);
  const missing = checkBoard('timeline', lease(), 'The tenant may leave with notice.');
  assert.equal(missing.item, null);
  has(missing.problems, /events: not printed in the evidence: "Notice allowed" offset = 3/);
  assert.ok(checkBoard('timeline', { ...lease(), source: 'illustrative' }, '').item);
  const dated = {
    kind: 'timeline',
    unit: 'day',
    source: 'document',
    anchor: { label: 'Served', date: '2022-03-14' },
    events: [
      { label: 'Reply', after: 'Served', offset: 14 },
      { label: 'Review', date: '2022-09-01' },
    ],
  };
  assert.ok(
    checkBoard('timeline', dated, 'Served on 14 March 2022; reply within 14 days; review on 1 September 2022.').item,
  );
  has(
    checkBoard('timeline', dated, 'Served on 14 March; reply within 14 days; review on 1 September.').problems,
    /year = 2022/,
  );
  const ordinal = {
    kind: 'timeline',
    unit: 'step',
    source: 'document',
    events: [
      { label: 'Notice', at: 1 },
      { label: 'Inspection', at: 2 },
      { label: 'Keys', at: 3 },
    ],
  };
  assert.ok(
    checkBoard('timeline', ordinal, 'First the notice, second the inspection, third the keys.').item,
    'ordinals are printed positions',
  );
});

test('a timeline offers its events and then its spans as focus parts, and an empty one means no board', () => {
  const { item } = checkBoard('timeline', lease(), "3 months' notice and a term of 12 months");
  assert.ok(item);
  assert.equal(boardParts(item), 5);
  assert.deepEqual(checkBoard('timeline', { events: [] }), { item: null, problems: [] });
  assert.equal(checkBoard('timeline', 'text').item, null);
});

test('a timeline whose events are all numbered placeholders names nothing and is refused on a tour step', () => {
  const placeholder = {
    ...lease(),
    source: 'illustrative',
    anchor: undefined,
    events: [
      { label: 'event 1', at: 1 },
      { label: 'event 2', at: 2 },
    ],
    spans: [],
  };
  const { item } = checkBoard('timeline', placeholder);
  assert.ok(item);
  has(groundedProblems(item, { results: false }), /numbered placeholders/);
  has(groundedProblems(item, { results: true }), /reports the document’s results/);
});

test('the timeline provider schema is flat, and the saved-tour schema holds the resolved item', () => {
  assert.doesNotMatch(JSON.stringify(TIMELINE_SCHEMA), /\$ref|oneOf|anyOf|allOf/);
  assert.equal(TIMELINE_SCHEMA.additionalProperties, false);
  const ajv = new Ajv2020({ strict: false });
  assert.equal(ajv.compile(TIMELINE_SCHEMA)(lease()), true);
  assert.equal(ajv.compile(TIMELINE_SCHEMA)({ ...lease(), extra: 1 }), false);
  const schema = JSON.parse(readFileSync(new URL('../../schema/tour.schema.json', import.meta.url), 'utf8'));
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const tour = (item: unknown) => ({
    schema: 'paper-tour/tour@0.1',
    title: 'Timeline',
    paper: 'test',
    chapters: [{ id: 'c', title: 'C', steps: [{ id: 's', say: 'Look at this.', actions: [{ type: 'board', item }] }] }],
  });
  const resolved = canonicalTimeline(lease());
  assert.equal(validate(tour(resolved)), true, JSON.stringify(validate.errors?.slice(0, 3)));
  assert.equal(
    validate(tour({ ...resolved, events: resolved.events.map(({ position, ...rest }) => rest) })),
    false,
    'positions are stored',
  );
});

// -------------------------------------------------------------- distribution

const normal = (label: string, mean: number, sd: number): DistributionSpec => ({ family: 'normal', label, mean, sd });
const bell = () => ({
  kind: 'distribution',
  title: 'Training narrows reaction times',
  x_label: 'reaction time (ms)',
  source: 'document',
  dists: [normal('Baseline', 250, 30), normal('After training', 230, 20)],
  region: { from: 300 },
});
const withBell = (change: Record<string, unknown>) => distributionProblems({ ...bell(), ...change });
const near = (actual: number, expected: number, tolerance = 1e-4) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} ~= ${expected}`);

test('probabilities are computed, not estimated: the tail of a normal, a binomial, a Poisson and an exponential', () => {
  near(probability(normal('n', 100, 15), 130), 0.02275, 1e-5);
  near(probability(normal('n', 0, 1), -1.96, 1.96), 0.95, 1e-3);
  near(cdf(normal('n', 5, 2), 5), 0.5, 1e-6);
  const binomial: DistributionSpec = { family: 'binomial', label: 'b', n: 10, p: 0.5 };
  near(probability(binomial, 7), 0.171875, 1e-9);
  near(probability(binomial), 1, 1e-9);
  near(density(binomial, 5), 0.24609375, 1e-9);
  assert.equal(density(binomial, 5.5), 0);
  const poisson: DistributionSpec = { family: 'poisson', label: 'p', mean: 3 };
  near(probability(poisson, 5), 0.18474, 1e-5);
  near(probability(poisson, 0, 2), 0.42319, 1e-5);
  const exponential: DistributionSpec = { family: 'exponential', label: 'e', mean: 5 };
  near(probability(exponential, 5), Math.exp(-1), 1e-9);
  near(probability({ ...exponential, mean: undefined, rate: 0.2 }, 5), Math.exp(-1), 1e-9);
  near(probability({ family: 'uniform', label: 'u', min: 0, max: 10 }, 2, 5), 0.3, 1e-12);
  const counts: DistributionSpec = { family: 'counts', label: 'c', categories: ['A', 'B', 'C'], counts: [18, 54, 48] };
  near(density(counts, 2), 0.45, 1e-12);
  assert.deepEqual(summary(normal('n', 7, 2)), { mean: 7, sd: 2 });
  near(summary(binomial)!.sd, Math.sqrt(2.5), 1e-12);
  assert.equal(summary(counts), null);
});

test('a bell curve morphs as one shape: its parameters slide, so the middle is a normal between the two', () => {
  const [a, b] = [normal('a', 250, 30), normal('b', 230, 20)];
  const middle = morphSpec(a, b, 0.5)!;
  assert.deepEqual([middle.mean, middle.sd], [240, 25]);
  near(morphProbability(a, b, 0, 300), probability(a, 300), 1e-12);
  near(morphProbability(a, b, 1, 300), probability(b, 300), 1e-12);
  near(morphProbability(a, b, 0.5, 300), probability(middle, 300), 1e-12);
  // Different families cannot slide into each other: the honest morph is a blend of the two densities.
  const exponential: DistributionSpec = { family: 'exponential', label: 'e', mean: 100 };
  assert.equal(morphSpec(a, exponential, 0.5), null);
  near(morphProbability(a, exponential, 0.5, 300), (probability(a, 300) + probability(exponential, 300)) / 2, 1e-12);
  // A binomial slides in p when n is the same, and blends when it is not.
  const [p1, p2]: DistributionSpec[] = [
    { family: 'binomial', label: 'x', n: 20, p: 0.2 },
    { family: 'binomial', label: 'y', n: 20, p: 0.6 },
  ];
  assert.equal(morphSpec(p1, p2, 0.5)!.p, 0.4);
  assert.equal(morphSpec(p1, { ...p2, n: 30 }, 0.5), null);
});

test('the board fixes its scale to the tallest the morph gets, so a narrowing is seen as growing taller', () => {
  const item = canonicalDistribution(bell());
  const [lo, hi] = distributionRange(item);
  assert.ok(lo <= 230 - 4 * 20 + 1e-9 && hi >= 250 + 4 * 30 - 1e-9, 'the range holds both');
  const narrow = distributionPeak({ dists: [normal('a', 0, 1), normal('b', 0, 0.5)] });
  const wide = distributionPeak({ dists: [normal('a', 0, 1), normal('b', 0, 1.01)] });
  near(narrow, 1 / (0.5 * Math.sqrt(2 * Math.PI)), 0.01);
  assert.ok(narrow > 1.9 * wide);
  assert.ok(distance(normal('a', 0, 1), normal('b', 0, 1)) < 1e-9);
  assert.ok(distance(normal('a', 0, 1), normal('b', 5, 1)) > 0.95);
});

test("the canonical distribution keeps each family's own parameters and stores the region's chances", () => {
  const item = canonicalDistribution({
    ...bell(),
    title: '  Training narrows reaction times ',
    x_label: ' reaction time (ms) ',
  });
  assert.equal(item.title, 'Training narrows reaction times');
  assert.equal(item.x_label, 'reaction time (ms)');
  assert.deepEqual(item.dists[0], { family: 'normal', label: 'Baseline', mean: 250, sd: 30 });
  assert.deepEqual(item.region!.from, 300);
  assert.equal(item.region!.to, undefined);
  near(item.region!.probabilities[0], 0.0477904, 1e-6);
  near(item.region!.probabilities[1], 0.0002326, 1e-6);
  assert.equal(describeSpec(item.dists[1]), 'mean 230, sd 20');
  assert.equal(describeSpec({ family: 'binomial', label: 'b', n: 20, p: 0.3 }), 'n = 20, p = 0.3');
  assert.equal(describeSpec({ family: 'exponential', label: 'e', rate: 0.2 }), 'rate 0.2');
  const checked = checkBoard(
    'distribution',
    bell(),
    'mean of 250 ms and a standard deviation of 30 ms; the mean fell to 230 ms and 20 ms',
  );
  assert.deepEqual(checked.problems, []);
  assert.equal(boardParts(checked.item!), 3, 'two distributions and the region');
});

test('distribution problems name the parameter and the way out', () => {
  has(withBell({ x_label: '' }), /x_label: give plain words with the unit/);
  has(withBell({ source: 'measured' }), /source: use document or illustrative/);
  has(withBell({ dists: [] }), /dists: give 1 to 2 distributions, not 0/);
  has(withBell({ dists: [normal('a', 1, 0)] }), /dist 1: normal needs sd above zero/);
  has(
    withBell({ dists: [{ family: 'normal', label: 'a', mean: 1, sd: 1, p: 0.3 }] }),
    /normal takes mean and sd, not p/,
  );
  has(
    withBell({ dists: [{ family: 'binomial', label: 'b', n: 10, p: 30 }] }),
    /binomial needs p strictly between 0 and 1 \(write 30% as 0.3\)/,
  );
  has(
    withBell({ dists: [{ family: 'binomial', label: 'b', n: 2000, p: 0.3 }] }),
    /binomial needs n as a whole number from 1 to 1000/,
  );
  has(withBell({ dists: [{ family: 'uniform', label: 'u', min: 5, max: 1 }] }), /uniform needs max above min/);
  has(
    withBell({ dists: [{ family: 'exponential', label: 'e', mean: 5, rate: 0.2 }] }),
    /exponential needs mean or rate, one of them/,
  );
  has(
    withBell({ dists: [{ family: 'poisson', label: 'p', mean: 5000 }] }),
    /poisson needs mean above zero and at most 1000/,
  );
  has(
    withBell({ dists: [{ family: 'gamma', label: 'g' }] }),
    /family must be normal, uniform, binomial, poisson, exponential, counts/,
  );
  has(withBell({ dists: [normal('a', 1, 1), normal('a', 5, 1)] }), /both are called "a"/);
  has(
    withBell({ dists: [normal('a', 100, 10), { family: 'poisson', label: 'p', mean: 4 }] }),
    /cannot share one axis \(one is discrete, the other continuous\)/,
  );
  has(
    withBell({ dists: [normal('a', 100, 10), normal('b', 100.2, 10)] }),
    /almost the same, so the morph would show nothing/,
  );
  has(withBell({ dists: [normal('wide', 0, 100), normal('thin', 0, 1)] }), /"thin" would be a thin spike/);
  has(withBell({ region: {} }), /region: give from, to, or both/);
  has(withBell({ region: { from: 5, to: 5 } }), /region: from must be below to/);
  has(withBell({ region: { from: 5000 } }), /region: 5000 is far outside the axis/);
  has(withBell({ region: { from: 100, to: 500 } }), /almost 0 or almost 1 under every distribution/);
  assert.deepEqual(withBell({ region: { to: 200 } }), []);
});

test('counts come from the document: the same categories before and after, and no region on a category axis', () => {
  const survey = (second = [30, 42, 30, 18]) => ({
    kind: 'distribution',
    x_label: 'option chosen',
    source: 'document',
    dists: [
      { family: 'counts', label: 'Before', categories: ['A', 'B', 'C', 'D'], counts: [18, 54, 36, 12] },
      { family: 'counts', label: 'After', categories: ['A', 'B', 'C', 'D'], counts: second },
    ],
  });
  assert.deepEqual(distributionProblems(survey()), []);
  has(distributionProblems({ ...survey(), region: { from: 2 } }), /a region needs a numeric axis, not counts/);
  has(
    distributionProblems({
      ...survey(),
      dists: [survey().dists[0], { ...survey().dists[1], categories: ['A', 'B', 'C', 'E'] }],
    }),
    /same categories in the same order/,
  );
  has(
    distributionProblems({ ...survey(), dists: [survey().dists[0], { ...survey().dists[1], counts: [1, 2, 3] }] }),
    /one count per category \(4\), not 3/,
  );
  has(
    distributionProblems({ ...survey(), dists: [{ ...survey().dists[0], counts: [0, 0, 0, 0] }] }),
    /counts must be numbers from zero up, not all zero/,
  );
  has(
    distributionProblems({ ...survey(), dists: [survey().dists[0], normal('n', 1, 1)] }),
    /cannot share an axis|cannot share one axis/,
  );
  const printed =
    'Of 120 respondents, 18 chose A, 54 chose B, 36 chose C and 12 chose D; afterwards 30, 42, 30 and 18.';
  assert.ok(checkBoard('distribution', survey(), printed).item);
  has(checkBoard('distribution', survey([31, 41, 30, 18]), printed).problems, /"After" count = 31/);
  const item = checkBoard('distribution', survey(), printed).item!;
  assert.deepEqual(groundedProblems(item, { results: false }), []);
});

test("the parameters of a document's own distribution are printed, a variance may stand for a spread and a percentage for a chance", () => {
  const printed =
    'Reaction times have a mean of 250 ms and a standard deviation of 30 ms; after training the mean is 230 ms and the sd is 20 ms.';
  assert.deepEqual(checkBoard('distribution', bell(), printed).problems, []);
  const bad = checkBoard(
    'distribution',
    bell(),
    'Reaction times have a mean of 250 ms and a standard deviation of 30 ms.',
  );
  assert.equal(bad.item, null);
  has(bad.problems, /dists: not printed in the evidence: "After training" mean = 230/);
  assert.ok(checkBoard('distribution', { ...bell(), source: 'illustrative' }, '').item);
  const variance = { ...bell(), dists: [normal('a', 250, 30), normal('b', 230, 20)] };
  assert.ok(
    checkBoard('distribution', variance, 'means 250 and 230, variances 900 and 400').item,
    'a spread may be printed as a variance',
  );
  const binomial = {
    ...bell(),
    dists: [
      { family: 'binomial', label: 'b', n: 20, p: 0.3 },
      { family: 'binomial', label: 'c', n: 20, p: 0.6 },
    ],
    region: { from: 10 },
  };
  assert.ok(
    checkBoard('distribution', binomial, '20 trials; a 30% chance, then a 60% chance').item,
    'a chance may be printed as a percentage',
  );
  assert.ok(
    checkBoard(
      'distribution',
      { ...bell(), dists: [normal('a', 250, 30), normal('b', 230, 20)], region: { from: 301 } },
      printed,
    ).item,
    'the region is the question asked, not data',
  );
});

test('a distribution and a plot are held to the rules of a tour step', () => {
  const { item } = checkBoard('distribution', { ...bell(), source: 'illustrative' }, '');
  assert.ok(item);
  assert.deepEqual(groundedProblems(item, { results: false }), []);
  has(groundedProblems(item, { results: true }), /reports the document’s results, so a distribution must use its own/);
});

test('the distribution provider schema is flat and the saved-tour schema holds the computed chances', () => {
  assert.doesNotMatch(JSON.stringify(DISTRIBUTION_SCHEMA), /\$ref|oneOf|anyOf|allOf/);
  const ajv = new Ajv2020({ strict: false });
  const validate = ajv.compile(DISTRIBUTION_SCHEMA);
  assert.equal(validate(bell()), true, JSON.stringify(validate.errors));
  assert.equal(validate({ ...bell(), extra: 1 }), false);
  assert.equal(validate({ ...bell(), dists: [] }), false);
  const schema = JSON.parse(readFileSync(new URL('../../schema/tour.schema.json', import.meta.url), 'utf8'));
  const saved = new Ajv2020({ strict: false }).compile(schema);
  const tour = (item: unknown) => ({
    schema: 'paper-tour/tour@0.1',
    title: 'Distribution',
    paper: 'test',
    chapters: [{ id: 'c', title: 'C', steps: [{ id: 's', say: 'Look at this.', actions: [{ type: 'board', item }] }] }],
  });
  const item = canonicalDistribution(bell());
  assert.equal(saved(tour(item)), true, JSON.stringify(saved.errors?.slice(0, 3)));
  assert.equal(saved(tour({ ...item, region: { from: 300 } })), false, 'the chances are stored');
});

test('the same timeline, distribution or plot twice is the same picture, so the second one is dropped', () => {
  const [a, b] = [canonicalTimeline(lease()), canonicalTimeline({ ...lease(), title: 'Another title' })];
  assert.equal(boardSignature(a), boardSignature(b), 'a title does not make a new picture');
  const later = canonicalTimeline({
    ...lease(),
    events: lease().events.map((e) => (e.offset === 12 ? { ...e, offset: 24 } : e)),
  });
  assert.notEqual(boardSignature(a), boardSignature(later));
  const [x, y] = [canonicalDistribution(bell()), canonicalDistribution({ ...bell(), region: undefined })];
  assert.equal(boardSignature(x), boardSignature(y), 'the same distributions, shaded or not');
  const wider = canonicalDistribution({
    ...bell(),
    dists: [normal('Baseline', 250, 30), normal('After training', 230, 25)],
  });
  assert.notEqual(boardSignature(x), boardSignature(wider));
  const plot = checkBoard('plot', {
    x: [0, 20],
    y: [0, 400],
    curves: [
      { expression: 'x*x', label: 'a' },
      { expression: '10*x', label: 'b' },
    ],
  }).item!;
  const marked = checkBoard('plot', {
    x: [0, 20],
    y: [0, 400],
    curves: [
      { expression: 'x*x', label: 'a' },
      { expression: '10*x', label: 'b' },
    ],
    marks: [{ type: 'crossing', curve: 1, other: 2, nth: 2 }],
  }).item!;
  assert.notEqual(boardSignature(plot), boardSignature(marked), 'the same curves with a mark are another picture');
});
