import test from 'node:test';
import assert from 'node:assert/strict';
import type { Step, Tour } from '../../shared/paper';
import { HarnessTourGenerator } from './harness-fixture';
import { card, checkReply, doc, input, reply, settings } from './plan-fixture';
import { frameSteps, tourProblems } from '../src/harness/assemble';
import type { Preset } from '../src/harness/beats';

// Progressive tours: while the steps are directed, the harness announces the tour of the leading steps that are finished
// (event "tour.partial" with the tour, its step count and the planned count), assembled and checked like the final tour.

type Event = { type: string; data: Record<string, any> };
const SAY =
  'Water goes only where the soil is dry, so wet corners stop costing twice, in the pump bill and in the roots. Because the dose follows the reading, the amount tracks the need instead of the calendar, and nothing is spent on soil that has no use for it.';
const steps = (tour: Tour) => tour.chapters.flatMap((c) => c.steps);

/** A scripted model in which one kind of step waits until the test lets it go. */
function transport(gate?: { kind: string; opened: Promise<void> }): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const name = body.response_format.json_schema.name;
    const schema = body.response_format.json_schema.schema;
    const text = (content: any) =>
      typeof content === 'string' ? content : content.map((p: any) => p.text ?? '').join('\n');
    const task: string = body.messages.map((m: any) => text(m.content)).join('\n');
    if (name === 'paper_card') return reply(card);
    if (name === 'visual_plan') return reply({ plan: 'none', beats: [] });
    // A quick check closes the method and the evidence chapter of a standard paper tour.
    if (name === 'quick_check') return reply(checkReply({ schema } as never));
    if (gate && task.includes(`STEP KIND: ${gate.kind}`)) await gate.opened;
    const cue = schema.properties.cues.items.properties;
    const target = cue.target.enum?.[0];
    return reply({
      plan: 'p',
      say: SAY,
      cues: target ? [{ action: cue.action.enum[0], target, label: '', anchor: 'only where the soil' }] : [],
    });
  }) as typeof fetch;
}
/** A promise and the function that opens it. */
function latch() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => (open = resolve));
  return { opened, open };
}
async function run(
  preset: Preset,
  gate: { kind: string; opened: Promise<void> } | undefined,
  on: (event: Event) => void,
) {
  const generator = new HarnessTourGenerator(settings, preset, transport(gate));
  return generator.generate({
    ...input,
    onEvent: async (type, data) => on({ type, data }),
  });
}

test('the tour so far is announced each time the next steps in order are finished, and is itself a valid tour', async () => {
  const last = latch();
  const events: Event[] = [];
  let total = 0;
  const result = await run('standard', { kind: 'takeaway', opened: last.opened }, (event) => {
    events.push(event);
    // The steps of the tour: one per beat, and two for each quick check that closes a chapter.
    if (event.type === 'plan.ready') total = event.data.beats.length + 2 * (event.data.checks?.length ?? 0);
    // Everything but the last step is announced, then the last step is allowed to finish.
    if (event.type === 'tour.partial' && event.data.ready === total - 1) last.open();
  });
  const final = steps(result.tour);
  const partials = events.filter((e) => e.type === 'tour.partial');
  assert.ok(partials.length >= 1);
  assert.equal(final.length, total);
  assert.equal(final.filter((s) => s.checkpoint).length, 2, 'the checks are part of the tour that is announced');
  let before = 0;
  for (const { data } of partials) {
    const tour = data.tour as Tour;
    const list = steps(tour);
    // A tour of exactly the leading steps, as many as it says, growing, with the planned size.
    assert.equal(list.length, data.ready);
    assert.ok(data.ready > before, 'the announcements grow');
    before = data.ready;
    assert.equal(data.planned, total);
    assert.deepEqual(
      list.map((s) => s.id),
      final.slice(0, data.ready).map((s) => s.id),
    );
    assert.deepEqual(tourProblems(tour, doc), [], 'it plays like the final tour');
    assert.equal(tour.doc_type, 'research_paper');
    assert.equal(tour.title, result.tour.title);
  }
  // It was announced before the last step was finished, and the last announcement is the whole tour.
  const first = events.findIndex((e) => e.type === 'tour.partial');
  const lastCompleted = events.reduce((at, e, i) => (e.type === 'beat.completed' ? i : at), -1);
  assert.ok(first < lastCompleted);
  assert.ok(partials.some((p) => p.data.ready === total - 1));
  assert.deepEqual(partials.at(-1)!.data.tour, result.tour);
});

test('a step that finishes early waits for the ones before it: nothing is announced past a gap', async () => {
  const first = latch();
  const events: Event[] = [];
  let planned = 0;
  let completed = 0;
  let released = false;
  const result = await run('standard', { kind: 'problem', opened: first.opened }, (event) => {
    events.push(event);
    if (event.type === 'plan.ready') planned = event.data.beats.length;
    if (event.type === 'beat.completed') completed++;
    // The first step is held until all the others are done.
    if (completed === planned - 1 && !released) {
      released = true;
      first.open();
    }
  });
  const partials = events.filter((e) => e.type === 'tour.partial');
  const release = events.findIndex((e) => e.type === 'beat.completed' && e.data.beat === 'problem-1');
  // Not one announcement before the first step was done, then the others come along with it.
  assert.ok(partials.length >= 1);
  assert.ok(events.findIndex((e) => e.type === 'tour.partial') > release - 1);
  assert.equal(partials[0].data.ready, steps(result.tour).length);
});

test('a deep detail is written once its overview is done, in the same pass as the other steps', async () => {
  const events: Event[] = [];
  let planned: string[] = [];
  const result = await run('deep', undefined, (event) => {
    if (event.type === 'plan.ready') planned = event.data.beats.map((b: { id: string }) => b.id);
    if (event.type.startsWith('beat.') && event.type !== 'beat.degraded') events.push(event);
  });
  assert.ok(steps(result.tour).length > 0);
  const index = (type: string, beat: string) => events.findIndex((e) => e.type === type && e.data.beat === beat);
  // The detail is attempted (its worked example may fail with this scripted model, which drops it); it starts only after
  // its overview is done.
  assert.ok(planned.includes('formula-2'));
  assert.ok(index('beat.started', 'formula-2') > index('beat.completed', 'formula-1'));
  // Every step is started once and completed once.
  assert.deepEqual(
    events
      .filter((e) => e.type === 'beat.started')
      .map((e) => e.data.beat)
      .sort(),
    [...planned].sort(),
  );
  assert.deepEqual(
    events
      .filter((e) => e.type === 'beat.completed')
      .map((e) => e.data.beat)
      .sort(),
    [...planned].sort(),
  );
});

test('a contract’s frame leads the first step of a part, and only the whole tour closes with it', () => {
  const list: Step[][] = [
    [{ id: 'a', say: 'First step says things.', actions: [{ type: 'focus', target: 'p1.s1' }] }],
    [{ id: 'b', say: 'Second step says more.', actions: [{ type: 'focus', target: 'p1.s2' }] }],
  ];
  const frame = 'This is not legal advice.';
  const begun = frameSteps(list, frame, false);
  assert.equal(begun[0][0].say, `${frame} First step says things.`);
  assert.equal(begun[1][0].say, 'Second step says more.');
  const whole = frameSteps(list, frame);
  assert.equal(whole[1][0].say, `Second step says more. ${frame}`);
});

test('every tour says what kind of document it is for', async () => {
  const result = await run('quick', undefined, () => {});
  assert.equal(result.tour.doc_type, 'research_paper');
});
