import test from 'node:test';
import assert from 'node:assert/strict';
import type { Step } from '../../shared/paper';
import { config } from '../src/config';
import { HarnessTourGenerator } from './harness-fixture';
import { EXPLAIN, card, doc, input, planFor, provider, settings, texts, type Request } from './plan-fixture';
import { planBeats } from '../src/harness/beats';
import {
  beatTargets,
  cleanDirection,
  directOptions,
  directionSchema,
  highlightedSentences,
  sayLimit,
  type Direction,
} from '../src/harness/direct';
import { RESTATEMENT_REPAIR, RESTATEMENT_SHARE, restatedShare, restatesHighlights } from '../src/harness/insight';

const beats = planBeats(card, doc, 'standard');
const beat = (id: string) => beats.find((b) => b.id === id)!;
/** Says the highlighted sentence again in other words, so it never reads the source aloud. */
const RESTATE =
  'Orchard growers water on a fixed schedule although the soil dries at different speeds across a single field, so a fixed schedule waters every part of the field alike.';
const steps = (tour: { chapters: { steps: Step[] }[] }) => tour.chapters.flatMap((c) => c.steps);

test('narration that mostly rewords the highlighted sentences is flagged; one that explains is not', () => {
  const highlighted = [texts['p1.s1']];
  assert.ok(restatedShare(RESTATE, highlighted) >= 0.7);
  assert.ok(restatesHighlights(RESTATE, highlighted));
  assert.ok(restatedShare(EXPLAIN, highlighted) < 0.25);
  assert.ok(!restatesHighlights(EXPLAIN, highlighted));
  assert.equal(RESTATEMENT_SHARE, 0.5);
});

test('the share counts content words only, stems plurals, and pools every highlighted sentence', () => {
  const say =
    'Probes report readings, controllers open valves, and growers get water where the soil is dry, every ten minutes.';
  const sentences = [texts['p1.s2'], texts['p1.s3']];
  // Stop words ("the", "and", "where") never count; "probes" matches "probe" and "valves" matches "valve".
  assert.ok(restatedShare(say, sentences) > restatedShare(say, [sentences[0]]));
  assert.ok(restatedShare(say, sentences) >= RESTATEMENT_SHARE);
  assert.equal(restatedShare(say, []), 0);
  // Too little narration to judge.
  assert.equal(restatedShare('Probes report readings every ten minutes.', sentences), 0);
});

test('function words of other document languages do not make an explanation look like a restatement', () => {
  const source = [
    'Obstbauern bewässern nach einem festen Plan, obwohl der Boden auf einem einzigen Feld sehr unterschiedlich schnell austrocknet.',
  ];
  const restated =
    'Obstbauern bewässern nach einem festen Plan, obwohl der Boden auf einem Feld unterschiedlich schnell austrocknet und der Plan alle Teile gleich behandelt.';
  const explained =
    'Ein fester Plan gibt feuchten Ecken genauso viel Wasser wie trockenen, deshalb zahlt man doppelt: bei der Pumpe und durch Wurzeln im nassen Grund. Eine Messung als Maßstab lässt die Menge dem Bedarf folgen.';
  assert.ok(restatesHighlights(restated, source));
  assert.ok(!restatesHighlights(explained, source));
});

test('a step highlights its highlight cues, else its first evidence sentence; a figure step highlights none', () => {
  const targets = (id: string) => beatTargets(beat(id), doc);
  const direction = (cues: Direction['cues']): Direction => ({ plan: 'p', say: EXPLAIN, cues });
  const cue = (action: Direction['cues'][number]['action'], target: string) => ({
    action,
    target,
    label: '',
    anchor: 'a',
  });
  assert.deepEqual(
    highlightedSentences(
      direction([cue('highlight', 'p1.s2'), cue('highlight', 'p1.s2'), cue('note', 'p1.s3')]),
      beat('problem-1'),
      targets('problem-1'),
    ),
    ['p1.s2'],
  );
  assert.deepEqual(highlightedSentences(direction([]), beat('problem-1'), targets('problem-1')), ['p1.s1']);
  assert.deepEqual(highlightedSentences(direction([]), beat('figure-1'), targets('figure-1')), []);
});

/** A model with a direction per step kind; `problem` answers once per call from the list (the last one repeats). */
function narrator(problem: unknown[], seen: Request[] = []) {
  let problemCalls = 0;
  return (request: Request) => {
    if (request.name === 'paper_card') return card;
    if (request.name === 'visual_plan') return planFor(request);
    seen.push(request);
    const cue = request.schema.properties.cues.items.properties;
    if (request.task.includes('STEP KIND: problem')) return problem[Math.min(problemCalls++, problem.length - 1)];
    const target = cue.target.enum?.[0];
    return {
      plan: 'p',
      say: EXPLAIN,
      cues: target ? [{ action: cue.action.enum[0], target, label: '', anchor: 'a fixed dose' }] : [],
    };
  };
}
const answer = (
  say: string,
  cues: unknown[] = [{ action: 'highlight', target: 'p1.s1', label: '', anchor: 'fixed schedule' }],
) => ({
  plan: 'p',
  say,
  cues,
});
const problemCalls = (seen: Request[]) => seen.filter((r) => r.task.includes('STEP KIND: problem'));

test('a step that restates its highlighted sentence gets one repair and then keeps the rewrite', async () => {
  const seen: Request[] = [];
  const events: { type: string; data: Record<string, any> }[] = [];
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(
      narrator(
        [
          answer(RESTATE),
          answer(EXPLAIN, [{ action: 'highlight', target: 'p1.s1', label: '', anchor: 'wet corners' }]),
        ],
        seen,
      ),
    ),
  ).generate({
    ...input,
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  const calls = problemCalls(seen);
  assert.equal(calls.length, 2);
  assert.ok(!calls[0].task.includes(RESTATEMENT_REPAIR));
  assert.ok(calls[1].task.includes(RESTATEMENT_REPAIR));
  assert.equal(steps(tour)[0].say, EXPLAIN);
  assert.deepEqual((metadata as { fallbackBeats: string[] }).fallbackBeats, []);
  const flagged = events.filter((e) => e.type === 'beat.restates');
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].data.beat, 'problem-1');
  assert.ok(flagged[0].data.share >= RESTATEMENT_SHARE);
  // Every other step explained, so each was asked once.
  assert.equal(seen.length, beats.length + 1);
});

test('narration that explains is accepted at once, without any repair', async () => {
  const seen: Request[] = [];
  const events: string[] = [];
  const { tour } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(narrator([answer(EXPLAIN)], seen)),
  ).generate({
    ...input,
    onEvent: async (type) => {
      events.push(type);
    },
  });
  assert.equal(seen.length, beats.length);
  assert.ok(!events.includes('beat.restates'));
  assert.ok(seen.every((r) => !r.task.includes(RESTATEMENT_REPAIR)));
  assert.equal(steps(tour).length, beats.length);
});

test('a step is never repaired twice for restating: a second restatement is kept, not repeated or replaced by the card', async () => {
  const seen: Request[] = [];
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(narrator([answer(RESTATE)], seen)),
  ).generate(input);
  assert.equal(problemCalls(seen).length, 2);
  assert.equal(steps(tour)[0].say, RESTATE);
  assert.deepEqual((metadata as { fallbackBeats: string[] }).fallbackBeats, []);
});

test('a rewrite that cannot be used leaves the step with the direction it had', async () => {
  const seen: Request[] = [];
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(narrator([answer(RESTATE), { plan: 'p', say: 'too short', cues: [] }], seen)),
  ).generate(input);
  // The restatement, then two unusable rewrites; the first direction stays.
  assert.equal(problemCalls(seen).length, 3);
  assert.equal(steps(tour)[0].say, RESTATE);
  assert.deepEqual((metadata as { fallbackBeats: string[] }).fallbackBeats, []);
});

test('a step without highlight cues is judged against the sentence its step marks', async () => {
  const seen: Request[] = [];
  const { tour } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(narrator([answer(RESTATE, []), answer(EXPLAIN, [])], seen)),
  ).generate(input);
  assert.equal(problemCalls(seen).length, 2);
  assert.equal(steps(tour)[0].say, EXPLAIN);
});

test('overview steps aim for 50 to 90 spoken words and detail steps for 90 to 140, with schema limits to match', () => {
  const overview = beat('method-1');
  const detail = { ...beat('formula-1'), detail: true };
  assert.equal(directOptions(overview).words, 90);
  assert.equal(directOptions(detail).words, 140);
  const say = (beatId: typeof overview) => (directionSchema(beatId, beatTargets(beatId, doc)).properties as any).say;
  assert.equal(say(overview).description, 'About 50-90 spoken words.');
  assert.equal(say(detail).description, 'About 90-140 spoken words.');
  assert.equal(say(overview).maxLength, sayLimit(overview) * 9);
  const words = (n: number) => Array.from({ length: n }, () => 'water').join(' ');
  const clean = (b: typeof overview, n: number) =>
    cleanDirection({ plan: 'p', say: words(n), cues: [] }, b, beatTargets(b, doc));
  assert.ok(clean(overview, sayLimit(overview)));
  assert.equal(clean(overview, sayLimit(overview) + 1), null);
  assert.ok(clean(detail, sayLimit(detail)));
  assert.equal(clean(detail, sayLimit(detail) + 1), null);
  assert.ok(sayLimit(overview) < 135 && sayLimit(detail) >= 140);
});

test('a new setup creates standard tours unless the preset is set', () => {
  const keep = { ...process.env };
  try {
    Object.assign(process.env, {
      DATABASE_URL: 'postgresql://localhost/db',
      SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SERVICE_ROLE_KEY: 'key',
    });
    delete process.env.TOUR_PRESET;
    assert.equal(config().tours.preset, 'standard');
    process.env.TOUR_PRESET = 'deep';
    assert.equal(config().tours.preset, 'deep');
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in keep)) delete process.env[name];
    Object.assign(process.env, keep);
  }
});
