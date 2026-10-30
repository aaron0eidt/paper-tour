import test from 'node:test';
import assert from 'node:assert/strict';
import Ajv2020 from 'ajv/dist/2020.js';
import { readFileSync } from 'node:fs';
import type { Step, Tour } from '../../shared/paper';
import { coverageNote, lossesFromEvents } from '../../shared/coverage';
import { tourProblems } from '../src/harness/assemble';
import { PACE, type Pace } from '../src/harness/pace';
import { HarnessTourGenerator } from './harness-fixture';
import { exampleSay, numericalExample } from './example-fixture';
import {
  EXPLAIN,
  card,
  checkReply,
  direct,
  doc,
  input,
  planFor,
  provider,
  settings,
  texts,
  type Request,
} from './plan-fixture';

/** The causes of the visuals a tour records as left out. */
const boardsLost = (tour: Tour) => (tour.left_out ?? []).filter((item) => item.part === 'board').map((item) => item.cause);

// A slow step degrades instead of vanishing, and whatever a tour leaves out of its plan is recorded with its real cause
// (shared/coverage.ts): in the events, in the generation's provenance and in the tour, with scripted models (no network).

type Seen = { type: string; data: Record<string, any> };
/** Fake network calls need a referenced handle, like a real socket, until their abort settles them. */
function hangUntilAbort(signal: AbortSignal): Promise<Response> {
  return new Promise((_, reject) => {
    const keepAlive = setInterval(() => {}, 60_000);
    const abort = () => {
      clearInterval(keepAlive);
      reject(new Error('aborted'));
    };
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
  });
}

const steps = (tour: Tour) => tour.chapters.flatMap((c) => c.steps);
const stepOf = (tour: Tour, id: string): Step | undefined => steps(tour).find((s) => s.id === id);
const detailOf = (kind: string) => (task: string) => task.includes(`STEP KIND: ${kind} (a closer look`);
const kindOf = (kind: string) => (task: string) =>
  task.includes(`STEP KIND: ${kind}`) && !task.includes('(a closer look');
/** A different explanation from every other the scripted model gives. */
const OTHER =
  'Picture one valve: when its probe dries out below the threshold the controller opens it, and when the soil is wet again it closes, so water follows the need patch by patch.';

/** A model that answers every step well; the formula detail also with a worked example, as that step must. */
function model(options: { detail?: (request: Request) => unknown } = {}) {
  const requests: Request[] = [];
  const fetch = provider((request) => {
    requests.push(request);
    if (request.name === 'paper_card') return card;
    if (['visual_plan', 'opening_visual'].includes(request.name)) return planFor(request);
    if (request.name === 'quick_check') return checkReply(request, { fits: false });
    if (request.name === 'beat_direction' && detailOf('formula')(request.task))
      return options.detail?.(request) ?? direct(request, exampleSay, { example: numericalExample() });
    return direct(request, EXPLAIN);
  });
  return { requests, fetch };
}

/** The `hangs` calls of a step after the first `after` hang until they are given up on; the others are answered as `inner` does. */
function hangFirst(inner: typeof globalThis.fetch, matches: (task: string) => boolean, hangs: number, after = 0) {
  let asked = 0;
  return (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.response_format.json_schema.name === 'beat_direction' && matches(JSON.stringify(body.messages))) {
      const n = asked++;
      if (n >= after && n < after + hangs)
        return hangUntilAbort(init!.signal!);
    }
    return inner(url as never, init);
  }) as typeof globalThis.fetch;
}
const quick: Pace = {
  ...PACE,
  callMs: (name, effort) => (name === 'beat_direction' ? 150 : PACE.callMs(name, effort)),
};
const run = async (fetch: typeof globalThis.fetch, preset: 'standard' | 'deep' = 'deep', pace: Pace = quick) => {
  const events: Seen[] = [];
  const done = await new HarnessTourGenerator(settings, preset, fetch, undefined, undefined, pace).generate({
    ...input,
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  return { ...done, events, metadata: done.metadata as Record<string, any> };
};
/** The reasoning effort of each call that wrote a step, in the order they were made. */
const efforts = (events: Seen[], beat: string) =>
  events
    .filter((e) => e.type === 'model.started' && e.data.name === 'beat_direction' && e.data.task?.id === beat)
    .map((e) => e.data.reasoningEffort);
const asksExample = (request: Request) => 'example' in request.schema.properties;
/** The scripted calls of a step, in the order they are made: answered, never answered, or answered with no JSON in it. */
function script(
  inner: typeof globalThis.fetch,
  matches: (task: string) => boolean,
  calls: ('ok' | 'hang' | 'garbage')[],
) {
  let asked = 0;
  return (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.response_format.json_schema.name === 'beat_direction' && matches(JSON.stringify(body.messages))) {
      const call = calls[asked++] ?? 'ok';
      if (call === 'hang')
        return hangUntilAbort(init!.signal!);
      if (call === 'garbage')
        return new Response(
          JSON.stringify({
            choices: [{ finish_reason: 'stop', message: { content: 'this is not JSON' } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
        );
    }
    return inner(url as never, init);
  }) as typeof globalThis.fetch;
}
/** The events and the tour say the same of what was left out. */
const agree = (events: Seen[], tour: Tour) => {
  const order = (items: { step: string; part: string }[]) =>
    [...items].sort((a, b) => `${a.step} ${a.part}`.localeCompare(`${b.step} ${b.part}`));
  assert.deepEqual(order(lossesFromEvents(events)), order(tour.left_out ?? []));
};
const WRONG =
  'For example, suppose one valve gets 2 litres and another gets 3 litres, so together the two valves use 9 litres, which is why the probe network saves water patch by patch.';

// ------------------------------------------------------------------------------------- a slow step is asked for less

test('a worked example that keeps timing out is asked again at less effort, then given up, and the step keeps its narration', async () => {
  const { requests, fetch } = model({ detail: (r) => direct(r, asksExample(r) ? exampleSay : OTHER) });
  const { tour, metadata, events } = await run(hangFirst(fetch, detailOf('formula'), 2));
  assert.deepEqual(
    efforts(events, 'formula-2'),
    ['medium', 'low', 'minimal'],
    'one rung less after each call that was too slow',
  );
  // The first two calls never reached the model: the third is the only answer, and it asks for the narration alone.
  const asked = requests.filter((r) => r.name === 'beat_direction' && detailOf('formula')(r.task));
  assert.equal(asked.length, 1);
  assert.ok(!asksExample(asked[0]), 'no worked example, no board');
  assert.match(asked[0].task, /VISUAL FOR THIS STEP: none\./);
  // The step is still there, with its narration and without the example.
  const detail = stepOf(tour, 'formula-2')!;
  assert.equal(detail.say, OTHER);
  assert.ok(!detail.actions.some((a) => a.type === 'board' || a.type === 'board_focus'));
  // It says what it lost and why: the time.
  const flagged = metadata.degraded.find((d: any) => d.beat === 'formula-2');
  assert.deepEqual(flagged.dropped, ['example']);
  assert.deepEqual(flagged.causes, { example: 'slow' });
  assert.match(flagged.problems.join(' '), /worked example took too long to write/);
  const degraded = events.find((e) => e.type === 'beat.degraded' && e.data.beat === 'formula-2')!;
  assert.deepEqual(degraded.data.causes, { example: 'slow' });
  assert.deepEqual(
    events
      .filter((e) => e.type === 'beat.lean' && e.data.beat === 'formula-2')
      .map((e) => [e.data.effort, e.data.dropped]),
    [
      ['low', undefined],
      ['minimal', ['example']],
    ],
  );
  assert.equal(
    events.find((e) => e.type === 'beat.completed' && e.data.beat === 'formula-2')!.data.outcome,
    'degraded',
  );
  assert.deepEqual(
    metadata.omittedDetails.filter((d: any) => d.beat === 'formula-2'),
    [],
  );
  // The tour says so, briefly.
  assert.deepEqual(
    tour.left_out!.filter((l) => l.step === 'formula-2'),
    [{ step: 'formula-2', part: 'example', cause: 'slow' }],
  );
  assert.equal(
    coverageNote(tour.left_out!.filter((l) => l.step === 'formula-2')),
    '1 worked example left out: it took too long to write',
  );
});

test('the first call that is too slow keeps the worked example the step must show, at less effort', async () => {
  const { requests, fetch } = model();
  const { tour, metadata, events } = await run(hangFirst(fetch, detailOf('formula'), 1));
  assert.deepEqual(efforts(events, 'formula-2'), ['medium', 'low']);
  const [asked] = requests.filter((r) => r.name === 'beat_direction' && detailOf('formula')(r.task));
  assert.ok(asksExample(asked), 'the example is still asked for');
  assert.ok(stepOf(tour, 'formula-2')!.actions.some((a) => a.type === 'board'));
  assert.ok(!metadata.degraded.some((d: any) => d.beat === 'formula-2'));
  assert.ok(!tour.left_out?.some((l) => l.step === 'formula-2'));
});

test('a step that is nothing without its worked example is left out for that, and the tour still publishes', async () => {
  // Without the example the step only says what the overview already said.
  const { fetch } = model({ detail: (r) => direct(r, asksExample(r) ? exampleSay : EXPLAIN) });
  const { tour, metadata, events } = await run(hangFirst(fetch, detailOf('formula'), 2));
  assert.equal(stepOf(tour, 'formula-2'), undefined);
  assert.ok(stepOf(tour, 'formula-1'), 'the overview stays');
  const omitted = events.find((e) => e.type === 'beat.omitted' && e.data.beat === 'formula-2')!;
  assert.deepEqual([omitted.data.code, omitted.data.because], ['slow', 'example']);
  assert.equal(events.find((e) => e.type === 'beat.completed' && e.data.beat === 'formula-2')!.data.code, 'slow');
  const record = metadata.omittedDetails.find((d: any) => d.beat === 'formula-2');
  assert.deepEqual([record.code, record.because], ['slow', 'example']);
  assert.match(record.reason, /worked example took too long to write/);
  assert.equal(
    coverageNote(tour.left_out!.filter((l) => l.step === 'formula-2')),
    '1 planned step left out: its worked example took too long to write',
  );
});

test('a detail whose every call is too slow is left out, a step that is not a detail takes the fallback; both say it was the time', async () => {
  const { fetch } = model();
  const slowest = hangFirst(hangFirst(fetch, detailOf('figure'), 3), kindOf('idea'), 3);
  const { tour, metadata, events } = await run(slowest);
  assert.equal(stepOf(tour, 'figure-2'), undefined);
  assert.deepEqual(efforts(events, 'figure-2'), ['medium', 'low', 'minimal']);
  assert.equal(events.find((e) => e.type === 'beat.omitted' && e.data.beat === 'figure-2')!.data.code, 'slow');
  assert.equal(metadata.omittedDetails.find((d: any) => d.beat === 'figure-2').code, 'slow');
  assert.deepEqual(
    events.filter((e) => e.type === 'beat.lean' && e.data.beat === 'figure-2').map((e) => e.data.attempt),
    [1, 2],
    'a lighter try is announced only when one follows',
  );
  assert.deepEqual(efforts(events, 'idea-1'), ['low', 'minimal', 'minimal']);
  assert.equal(events.find((e) => e.type === 'beat.fallback' && e.data.beat === 'idea-1')!.data.code, 'slow');
  assert.ok(metadata.fallbackBeats.includes('idea-1'));
  assert.ok(stepOf(tour, 'idea-1'), 'the fallback beat is in the tour');
  assert.ok(tour.left_out!.some((l) => l.step === 'idea-1' && l.part === 'narration' && l.cause === 'slow'));
  assert.ok(tour.left_out!.some((l) => l.step === 'figure-2' && l.part === 'step' && l.cause === 'slow'));
});

// ------------------------------------------------------------------------------------------ the other causes

test('a narration that never comes out usable and a detail that only repeats the overview are told apart', async () => {
  const { fetch } = model({ detail: () => ({ plan: 'p', say: 'too short', cues: [] }) });
  const { tour, metadata, events } = await run(fetch);
  // Every other detail repeats its overview, the formula detail never gave a narration at all.
  const cause = (id: string) => metadata.omittedDetails.find((d: any) => d.beat === id)?.code;
  assert.equal(cause('formula-2'), 'invalid');
  assert.equal(cause('figure-2'), 'repeats');
  assert.equal(events.find((e) => e.type === 'beat.omitted' && e.data.beat === 'figure-2')!.data.code, 'repeats');
  assert.match(metadata.omittedDetails.find((d: any) => d.beat === 'figure-2').reason, /repeated earlier content/);
  assert.match(metadata.omittedDetails.find((d: any) => d.beat === 'formula-2').reason, /came back unusable/);
  assert.ok(tour.left_out!.some((l) => l.step === 'figure-2' && l.cause === 'repeats'));
});

test('a step with no usable narration takes the fallback beat and the event says why', async () => {
  const { fetch } = model();
  const bad: typeof globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    if (body.response_format.json_schema.name === 'beat_direction' && kindOf('idea')(JSON.stringify(body.messages)))
      return provider(() => ({ plan: 'p', say: 'too short', cues: [] }))(url as never, init);
    return fetch(url as never, init);
  }) as typeof globalThis.fetch;
  const { events, tour } = await run(bad, 'standard');
  assert.equal(events.find((e) => e.type === 'beat.fallback' && e.data.beat === 'idea-1')!.data.code, 'invalid');
  assert.ok(tour.left_out!.some((l) => l.step === 'idea-1' && l.part === 'narration' && l.cause === 'invalid'));
});

test('a board that fails its checks after the corrections is dropped for that, a board given up for the time for that', async () => {
  const invented = {
    title: 'Water used',
    unit: 'percent',
    higher_is_better: false,
    bars: [
      { label: 'Fixed schedule', value: 77.7 },
      { label: 'Probe network', value: 54.3 },
    ],
  };
  const planned = (r: Request) => planFor(r, (id) => (id === 'result-1' ? 'bars' : 'none'));
  const result = (r: Request) => r.name === 'beat_direction' && r.task.includes('STEP KIND: result');
  const base = provider((r) => {
    if (r.name === 'paper_card') return card;
    if (['visual_plan', 'opening_visual'].includes(r.name)) return planned(r);
    if (r.name === 'quick_check') return checkReply(r, { fits: false });
    return direct(r, EXPLAIN, result(r) ? { bars: invented } : {});
  });
  const checks = await run(base, 'standard');
  const failed = checks.metadata.degraded.find((d: any) => d.beat === 'result-1');
  assert.deepEqual([failed.dropped, failed.causes], [['board'], { board: 'checks' }]);
  assert.deepEqual(
    checks.tour.left_out!.filter((l) => l.step === 'result-1'),
    [{ step: 'result-1', part: 'board', cause: 'checks' }],
  );
  // A lost visual is recorded with its cause; the learner's note leaves it to the checklist.
  assert.deepEqual(boardsLost(checks.tour), ['checks']);
  assert.equal(coverageNote(checks.tour.left_out!), null);

  const slow = await run(
    hangFirst(base, (task) => task.includes('STEP KIND: result'), 1),
    'standard',
  );
  const given = slow.metadata.degraded.find((d: any) => d.beat === 'result-1');
  assert.deepEqual([given.dropped, given.causes], [['board'], { board: 'slow' }]);
  assert.deepEqual(efforts(slow.events, 'result-1'), ['low', 'minimal']);
  // A lost visual is recorded with its cause; the learner's note leaves it to the checklist.
  assert.deepEqual(boardsLost(slow.tour), ['slow']);
  assert.equal(coverageNote(slow.tour.left_out!), null);
});

test('a board that failed and could not be corrected in time is dropped for the time, not for a check it had no chance to pass', async () => {
  const invented = {
    title: 'Water used',
    unit: 'percent',
    higher_is_better: false,
    bars: [
      { label: 'Fixed schedule', value: 77.7 },
      { label: 'Probe network', value: 54.3 },
    ],
  };
  const result = (r: Request) => r.name === 'beat_direction' && r.task.includes('STEP KIND: result');
  const base = provider((r) => {
    if (r.name === 'paper_card') return card;
    if (['visual_plan', 'opening_visual'].includes(r.name))
      return planFor(r, (id) => (id === 'result-1' ? 'bars' : 'none'));
    if (r.name === 'quick_check') return checkReply(r, { fits: false });
    return direct(r, EXPLAIN, result(r) ? { bars: invented } : {});
  });
  const cause = (done: Awaited<ReturnType<typeof run>>) =>
    done.metadata.degraded.find((d: any) => d.beat === 'result-1');
  // The step has used its time when the first answer comes: no correction is asked for.
  const hurried = cause(await run(base, 'standard', { ...quick, stepMs: 0 }));
  assert.deepEqual([hurried.dropped, hurried.causes], [['board'], { board: 'slow' }]);
  assert.match(hurried.problems.join(' '), /no time left to correct it/);
  // The correction is asked for and outlives its time, both times.
  const late = await run(
    hangFirst(base, (task) => task.includes('STEP KIND: result'), 2, 1),
    'standard',
  );
  const timedOut = cause(late);
  assert.deepEqual([timedOut.dropped, timedOut.causes], [['board'], { board: 'slow' }]);
  assert.match(timedOut.problems.join(' '), /the correction took too long to write/);
  // A lost visual is recorded with its cause; the learner's note leaves it to the checklist.
  assert.deepEqual(boardsLost(late.tour), ['slow']);
  assert.equal(coverageNote(late.tour.left_out!), null);
  // A correction that comes back and still fails is a check that failed.
  const failed = cause(
    await run(
      hangFirst(base, (task) => task.includes('STEP KIND: result'), 1, 1),
      'standard',
    ),
  );
  assert.deepEqual(failed.causes, { board: 'checks' });
});

// ------------------------------------------------------------------------- the lighter try is told what it cannot do

test('the lighter try is not taught the worked example it has no field for, and what it says of numbers stands', async () => {
  // The lighter try of a formula detail answers with numbers in its narration, which is no worked example to check.
  const { requests, fetch } = model({ detail: (r) => direct(r, asksExample(r) ? exampleSay : WRONG) });
  const { tour, metadata, events } = await run(hangFirst(fetch, detailOf('formula'), 2));
  const bare = requests.filter((r) => r.name === 'beat_direction' && detailOf('formula')(r.task));
  assert.equal(bare.length, 1, 'one lighter try, and no repair of it');
  assert.ok(!asksExample(bare[0]));
  assert.ok(!bare[0].task.includes('WORKED EXAMPLES:'), 'the example contract is not in its task');
  assert.ok(!/TEACHING ROLE:[^\n]*worked example/.test(bare[0].task), 'nor in its role');
  assert.ok(!bare[0].task.includes('Add ONE new worked example'), 'nor in its detail rule');
  assert.match(bare[0].task, /This step shows no worked example and no numbers of your own/);
  assert.equal(stepOf(tour, 'formula-2')!.say, WRONG);
  assert.ok(!metadata.omittedDetails.some((d: any) => d.beat === 'formula-2'));
  assert.deepEqual(
    tour.left_out!.filter((l) => l.step === 'formula-2'),
    [{ step: 'formula-2', part: 'example', cause: 'slow' }],
  );
  agree(events, tour);

  // The repair of a lighter try that only repeated the overview does not ask for an example either.
  const again = model({ detail: (r) => direct(r, asksExample(r) ? exampleSay : EXPLAIN) });
  await run(hangFirst(again.fetch, detailOf('formula'), 2));
  const repair = again.requests.filter((r) => r.name === 'beat_direction' && detailOf('formula')(r.task)).at(-1)!;
  assert.ok(!asksExample(repair));
  assert.match(repair.task, /Teach a new cause-and-effect mechanism/);
  assert.ok(!repair.task.includes('Teach a new worked example'));
});

test('a slow step that was planned a board keeps a narration that quotes numbers after "for example", as it did before', async () => {
  const base = provider((r) => {
    if (r.name === 'paper_card') return card;
    if (['visual_plan', 'opening_visual'].includes(r.name))
      return planFor(r, (id) => (id === 'result-1' ? 'bars' : 'none'));
    if (r.name === 'quick_check') return checkReply(r, { fits: false });
    return direct(r, r.task.includes('STEP KIND: result') ? WRONG : EXPLAIN);
  });
  const { tour, metadata, events } = await run(script(base, kindOf('result'), ['hang']), 'standard');
  assert.equal(stepOf(tour, 'result-1')!.say, WRONG);
  assert.ok(!metadata.omittedDetails.some((d: any) => d.beat === 'result-1'));
  assert.ok(!events.some((e) => e.type === 'beat.fallback' && e.data.beat === 'result-1'));
  assert.deepEqual(
    tour.left_out!.filter((l) => l.step === 'result-1'),
    [{ step: 'result-1', part: 'board', cause: 'slow' }],
  );
  agree(events, tour);
});

test('a worked example the plan never asked for is no loss to tell the learner of, though the checks dropped it', async () => {
  // A results step planned as bars speaks of numbers and never writes the example the checks then ask for.
  const base = provider((r) => {
    if (r.name === 'paper_card') return card;
    if (['visual_plan', 'opening_visual'].includes(r.name))
      return planFor(r, (id) => (id === 'result-1' ? 'bars' : 'none'));
    if (r.name === 'quick_check') return checkReply(r, { fits: false });
    return direct(r, r.task.includes('STEP KIND: result') ? WRONG : EXPLAIN);
  });
  const { tour, metadata, events } = await run(base, 'standard');
  assert.equal(stepOf(tour, 'result-1')!.say, WRONG);
  assert.ok(metadata.degraded.some((d: any) => d.beat === 'result-1' && d.dropped.includes('example')));
  assert.ok(!tour.left_out?.some((l) => l.part === 'example'));
  agree(events, tour);
});

test('a second timeout on the last of three tries still gets its lighter try, with what the first try was told', async () => {
  let first = true;
  const { requests, fetch } = model({
    detail: (r) => {
      // The first answer is unusable; the next two never come; the lighter try is answered.
      if (first) {
        first = false;
        return { plan: 'p', say: 'too short', cues: [] };
      }
      return direct(r, asksExample(r) ? exampleSay : OTHER, asksExample(r) ? { example: numericalExample() } : {});
    },
  });
  const { tour, metadata, events } = await run(script(fetch, detailOf('formula'), ['ok', 'hang', 'hang']));
  assert.deepEqual(efforts(events, 'formula-2'), ['medium', 'medium', 'low', 'minimal']);
  const asked = requests.filter((r) => r.name === 'beat_direction' && detailOf('formula')(r.task));
  const last = asked.at(-1)!;
  assert.ok(!asksExample(last), 'the last try asks for the narration alone');
  assert.match(last.task, /say must be 8-/, 'it was told what the first try got wrong');
  assert.equal(stepOf(tour, 'formula-2')!.say, OTHER);
  assert.deepEqual(metadata.degraded.find((d: any) => d.beat === 'formula-2').causes, { example: 'slow' });
  assert.ok(!metadata.omittedDetails.some((d: any) => d.beat === 'formula-2'));
  agree(events, tour);
});

test('a step left out after an unusable lighter try says so, and is not blamed on the worked example', async () => {
  const { fetch } = model({
    detail: (r) =>
      asksExample(r)
        ? direct(r, exampleSay, { example: numericalExample() })
        : { plan: 'p', say: 'too short', cues: [] },
  });
  const { tour, metadata, events } = await run(hangFirst(fetch, detailOf('formula'), 2));
  assert.equal(stepOf(tour, 'formula-2'), undefined);
  const record = metadata.omittedDetails.find((d: any) => d.beat === 'formula-2');
  assert.deepEqual([record.code, record.because], ['invalid', undefined]);
  assert.match(record.reason, /came back unusable/);
  assert.equal(events.find((e) => e.type === 'beat.omitted' && e.data.beat === 'formula-2')!.data.code, 'invalid');
  agree(events, tour);
});

// ------------------------------------------------------------------------------------- what a step that vanished says

test('a step whose stand-in only reads the source aloud and whose calls are too slow is left out for the time, in the events and the tour alike', async () => {
  const printed = texts['p1.s3'];
  const reading = { ...card, method_steps: [{ text: printed, evidence: ['p1.s3'] }] };
  const base = provider((r) => {
    if (r.name === 'paper_card') return reading;
    if (['visual_plan', 'opening_visual'].includes(r.name)) return planFor(r);
    if (r.name === 'quick_check') return checkReply(r, { fits: false });
    return direct(r, EXPLAIN);
  });
  const { tour, metadata, events } = await run(script(base, kindOf('method'), ['hang', 'hang', 'hang']), 'standard');
  assert.equal(stepOf(tour, 'method-1'), undefined, 'a stand-in that reads the document aloud is no step');
  const omitted = events.find((e) => e.type === 'beat.omitted' && e.data.beat === 'method-1')!;
  assert.equal(omitted.data.code, 'slow');
  assert.ok(!events.some((e) => e.type === 'beat.fallback' && e.data.beat === 'method-1'));
  assert.equal(events.find((e) => e.type === 'beat.completed' && e.data.beat === 'method-1')!.data.outcome, 'omitted');
  assert.deepEqual(
    tour.left_out!.filter((l) => l.step === 'method-1'),
    [{ step: 'method-1', part: 'step', cause: 'slow' }],
    'never a repeat of earlier content: it was the time',
  );
  assert.ok(!metadata.fallbackBeats.includes('method-1'), 'a step that is not there stands in for nothing');
  assert.ok(metadata.omittedDetails.some((d: any) => d.beat === 'method-1' && d.code === 'slow'));
  agree(events, tour);
});

// ------------------------------------------------------------------- a failed part says how its last correction ended

const invented = {
  title: 'Water used',
  unit: 'percent',
  higher_is_better: false,
  bars: [
    { label: 'Fixed schedule', value: 77.7 },
    { label: 'Probe network', value: 54.3 },
  ],
};
const resultModel = provider((r) => {
  if (r.name === 'paper_card') return card;
  if (['visual_plan', 'opening_visual'].includes(r.name))
    return planFor(r, (id) => (id === 'result-1' ? 'bars' : 'none'));
  if (r.name === 'quick_check') return checkReply(r, { fits: false });
  return direct(
    r,
    EXPLAIN,
    r.name === 'beat_direction' && r.task.includes('STEP KIND: result') ? { bars: invented } : {},
  );
});
const isResult = (task: string) => task.includes('STEP KIND: result');
const boardOf = (done: Awaited<ReturnType<typeof run>>) =>
  done.metadata.degraded.find((d: any) => d.beat === 'result-1');

test('a board that failed on the last try, after two unusable answers, is dropped for its checks: nothing was slow', async () => {
  // The real limits: the step has used a few milliseconds of its forty seconds, and has no try left to correct the board.
  const done = await run(script(resultModel, isResult, ['garbage', 'garbage']), 'standard', PACE);
  const out = boardOf(done);
  assert.deepEqual([out.dropped, out.causes], [['board'], { board: 'checks' }]);
  assert.match(out.problems.join(' '), /the tries to correct it ran out/);
  assert.doesNotMatch(out.problems.join(' '), /no time left|too long/);
  // A lost visual is recorded with its cause; the learner's note leaves it to the checklist.
  assert.deepEqual(boardsLost(done.tour), ['checks']);
  assert.equal(coverageNote(done.tour.left_out!), null);
  agree(done.events, done.tour);
});

test('a board whose corrections came back unusable is dropped for that, and a slow correction followed by one is not called slow', async () => {
  const broken = await run(script(resultModel, isResult, ['ok', 'garbage', 'garbage']), 'standard');
  assert.deepEqual(boardOf(broken).causes, { board: 'invalid' });
  assert.match(boardOf(broken).problems.join(' '), /the correction came back unusable/);
  // A lost visual is recorded with its cause; the learner's note leaves it to the checklist.
  assert.deepEqual(boardsLost(broken.tour), ['invalid']);
  assert.equal(coverageNote(broken.tour.left_out!), null);
  agree(broken.events, broken.tour);
  // The first correction took too long, the second came back unusable: the second is how it ended.
  const mixed = await run(script(resultModel, isResult, ['ok', 'hang', 'garbage']), 'standard');
  assert.deepEqual(boardOf(mixed).causes, { board: 'invalid' });
  assert.doesNotMatch(boardOf(mixed).problems.join(' '), /too long/);
  // And the other way round: a correction that came back unusable, then one that was too slow.
  const late = await run(script(resultModel, isResult, ['ok', 'garbage', 'hang']), 'standard');
  assert.deepEqual(boardOf(late).causes, { board: 'slow' });
  assert.match(boardOf(late).problems.join(' '), /the correction took too long to write/);
});

// ----------------------------------------------------------------------------------- a tour with nothing lost

test('a tour that lost nothing carries no record of it, and every tour that does validates against the schema', async () => {
  const whole = await run(model().fetch, 'standard');
  assert.equal(whole.tour.left_out, undefined);
  assert.deepEqual(whole.metadata.leftOut, []);
  assert.deepEqual(whole.metadata.omittedDetails, []);
  const lost = await run(hangFirst(model().fetch, detailOf('figure'), 3));
  assert.ok(lost.tour.left_out!.length);
  assert.deepEqual(tourProblems(lost.tour, doc), []);
  assert.deepEqual(lost.metadata.leftOut, lost.tour.left_out);
  const schema = JSON.parse(readFileSync(new URL('../../schema/tour.schema.json', import.meta.url), 'utf8'));
  const valid = new Ajv2020({ strict: false }).compile(schema);
  assert.ok(valid(lost.tour), JSON.stringify(valid.errors));
  // An older tour has no record, and is as valid as it was.
  const { left_out: _gone, ...older } = lost.tour;
  assert.ok(valid(older));
  for (const bad of [
    [{ step: 'a', part: 'step', cause: 'because I said so' }],
    [{ step: 'a', part: 'chapter', cause: 'slow' }],
    [{ step: '', part: 'step', cause: 'slow' }],
    [{ step: 'a', part: 'step', cause: 'slow', because: 'board' }],
    [{ step: 'a', part: 'step', cause: 'slow', extra: 1 }],
  ])
    assert.equal(valid({ ...older, left_out: bad }), false, JSON.stringify(bad));
});

test('the time limit of a step falls from 45 s to 30 s once the reasoning effort drops below medium', () => {
  const limit = (effort: 'minimal' | 'low' | 'medium' | 'high') => PACE.callMs('beat_direction', effort);
  assert.deepEqual([limit('high'), limit('medium'), limit('low'), limit('minimal')], [45_000, 45_000, 30_000, 30_000]);
});
