import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc, Step, Tour } from '../../shared/paper';
import { tourProblems } from '../src/harness/assemble';
import type { Beat, Preset, TourPlan } from '../src/harness/beats';
import {
  CHECK_LIMIT,
  checkBrief,
  checkMaterial,
  checkSchema,
  checkSites,
  checkSteps,
  checkTargets,
  checkTask,
  cleanCheck,
  type CheckMaterial,
} from '../src/harness/check';
import type { DocType } from '../src/harness/doctype';
import { HarnessTourGenerator } from './harness-fixture';
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
  type Request,
} from './plan-fixture';

// Quick checks: at the end of a chapter of a paper or a lecture that teaches a mechanism or a result, the tour stops,
// asks one thing the chapter just showed (with up to three hints that never give the answer away) and the next step
// reveals it with a cue on the page. Where they go is decided in code; one small call per chapter writes each.

type Event = { type: string; data: Record<string, any> };
const steps = (tour: Tour) => tour.chapters.flatMap((c) => c.steps);

// ------------------------------------------------------------------------------------------------- where

const beat = (id: string, kind: Beat['kind'], arc: string, extra: Partial<Beat> = {}): Beat => ({
  id,
  kind,
  arc,
  point: id,
  evidence: ['p1.s1'],
  ...extra,
});
/** A plan of chapters, each with its beats; the beats follow the chapters' order. */
function planOf(type: DocType, chapters: [string, Beat[]][]): TourPlan {
  return {
    type,
    chapters: chapters.map(([id]) => ({ id, title: id })),
    beats: chapters.flatMap(([, list]) => list),
  };
}
/** A paper: a problem, then a mechanism chapter and a result chapter, a catch and a takeaway. */
const paper = () =>
  planOf('research_paper', [
    ['problem', [beat('problem-1', 'problem', 'problem'), beat('idea-1', 'idea', 'problem')]],
    ['method', [beat('method-1', 'method', 'method'), beat('formula-1', 'formula', 'method', { target: 'eq1' })]],
    ['evidence', [beat('figure-1', 'figure', 'evidence', { target: 'fig1' }), beat('result-1', 'result', 'evidence')]],
    ['limits', [beat('limitation-1', 'limitation', 'limits')]],
    ['takeaway', [beat('takeaway-1', 'takeaway', 'takeaway')]],
  ]);
const chaptersOf = (plan: TourPlan, preset: Preset) => checkSites(plan, preset).map((site) => site.chapter.id);

test('a standard paper tour checks one chapter, a quick one nothing, a deep one up to two', () => {
  assert.deepEqual(CHECK_LIMIT, { quick: 0, standard: 1, deep: 2 });
  assert.deepEqual(chaptersOf(paper(), 'quick'), []);
  // The mechanism and the result both qualify; one check goes to the middle of them, two to each.
  assert.deepEqual(chaptersOf(paper(), 'standard'), ['evidence']);
  assert.deepEqual(chaptersOf(paper(), 'deep'), ['method', 'evidence']);
  const sites = checkSites(paper(), 'deep');
  assert.deepEqual(
    sites.map((site) => [site.n, site.beats]),
    [
      [1, [2, 3]],
      [2, [4, 5]],
    ],
    'numbered in order; a check follows the last beat of its chapter',
  );
  assert.deepEqual(
    checkSites(paper(), 'standard').map((site) => [site.n, site.beats]),
    [[1, [4, 5]]],
  );
  // Six chapters of substance: one check in a standard tour, two in a deep one, spread through them and never in the last.
  const long = planOf('research_paper', [
    ['c1', [beat('method-1', 'method', 'c1')]],
    ['c2', [beat('method-2', 'method', 'c2')]],
    ['c3', [beat('method-3', 'method', 'c3')]],
    ['c4', [beat('method-4', 'method', 'c4')]],
    ['c5', [beat('method-5', 'method', 'c5')]],
    ['c6', [beat('result-1', 'result', 'c6')]],
    ['end', [beat('takeaway-1', 'takeaway', 'end')]],
  ]);
  assert.deepEqual(chaptersOf(long, 'standard'), ['c4'], 'one, in the middle');
  assert.deepEqual(chaptersOf(long, 'deep'), ['c2', 'c5'], 'two, apart');
});

test('only chapters that teach something are checked: not the problem, the claim, the catch or the takeaway', () => {
  const claims = planOf('research_paper', [
    ['problem', [beat('problem-1', 'problem', 'problem', { move: 'thesis' })]],
    [
      'claim-1',
      [
        beat('idea-1', 'idea', 'claim-1', { move: 'change' }),
        beat('formula-1', 'formula', 'claim-1', { move: 'why', target: 'eq1' }),
        beat('figure-1', 'figure', 'claim-1', { move: 'evidence', target: 'fig1' }),
        beat('limitation-1', 'limitation', 'claim-1', { move: 'catch' }),
      ],
    ],
    [
      'claim-2',
      [
        beat('idea-2', 'idea', 'claim-2', { move: 'change' }),
        beat('limitation-2', 'limitation', 'claim-2', { move: 'catch' }),
      ],
    ],
    ['claim-3', [beat('method-1', 'method', 'claim-3', { move: 'why' })]],
    ['takeaway', [beat('takeaway-1', 'takeaway', 'takeaway', { move: 'takeaway' })]],
  ]);
  // Claim 2 only states and qualifies; the last chapter never closes with a check. A deep tour has room for both
  // chapters that teach, a standard one for the later.
  assert.deepEqual(chaptersOf(claims, 'deep'), ['claim-1', 'claim-3']);
  assert.deepEqual(chaptersOf(claims, 'standard'), ['claim-3']);
});

test('a lecture is checked where a chapter has two points or a point with a figure or a board; a text lecture too', () => {
  const lecture = planOf('lecture', [
    ['intro', [beat('point-1', 'point', 'intro', { slides: [1] })]],
    ['loops', [beat('point-2', 'point', 'loops', { slides: [2] }), beat('point-3', 'point', 'loops', { slides: [3] })]],
    ['recursion', [beat('point-4', 'point', 'recursion', { slides: [4], target: 'fig1' })]],
    ['cost', [beat('point-5', 'point', 'cost', { board: 'formula' })]],
    ['wrap', [beat('point-6', 'point', 'wrap', { slides: [6] })]],
  ]);
  // Three chapters qualify (two points, a point with a figure, a point with a board); the intro and the wrap do not.
  assert.deepEqual(chaptersOf(lecture, 'deep'), ['loops', 'cost']);
  assert.deepEqual(chaptersOf(lecture, 'standard'), ['recursion']);
  assert.deepEqual(chaptersOf(lecture, 'quick'), []);
});

test('exercise sheets, contracts, letters and short or full tours get no checks', () => {
  const types: DocType[] = ['exercise_sheet', 'contract', 'letter', 'other'];
  for (const type of types) assert.deepEqual(chaptersOf({ ...paper(), type }, 'standard'), [], type);
  const short = planOf('research_paper', [
    ['method', [beat('method-1', 'method', 'method'), beat('method-2', 'method', 'method')]],
    ['takeaway', [beat('takeaway-1', 'takeaway', 'takeaway')]],
  ]);
  assert.deepEqual(chaptersOf(short, 'standard'), [], 'a short tour is not interrupted');
  const unit = paper();
  unit.beats[2] = { ...unit.beats[2], unit: {} as never };
  assert.deepEqual(chaptersOf(unit, 'standard'), [], 'an exercise part');
  // Thirty steps is the limit of a tour: a check adds two.
  const full = planOf('research_paper', [
    ['method', Array.from({ length: 28 }, (_, i) => beat(`method-${i}`, 'method', 'method'))],
    ['takeaway', [beat('takeaway-1', 'takeaway', 'takeaway')]],
  ]);
  assert.deepEqual(chaptersOf(full, 'standard'), [], 'no room for two more steps');
  assert.deepEqual(chaptersOf({ ...full, beats: full.beats.slice(1) }, 'standard'), ['method']);
});

// ------------------------------------------------------------------------------------------------- the material

const chapter: Step[] = [
  {
    id: 'method-1',
    say: EXPLAIN,
    actions: [
      { type: 'focus', target: 'p1.b2', at_word: 0 },
      { type: 'highlight', targets: ['p1.s3'], color: 'blue', at_word: 4 },
    ],
  },
  {
    id: 'figure-1',
    say: EXPLAIN,
    actions: [
      { type: 'zoom', target: 'fig1', at_word: 0 },
      { type: 'box', target: 'fig1.a', color: 'blue' },
    ],
  },
];
const beats = [
  beat('method-1', 'method', 'method', { evidence: ['p1.s3', 'p1.s2'] }),
  beat('formula-1', 'formula', 'method', { target: 'eq1', evidence: [] }),
];
// The figure has a panel, which the chapter's last step boxes.
const paneled = {
  ...doc,
  figures: [
    {
      ...doc.figures[0],
      panels: [{ id: 'fig1.a', bbox: [0, 200, 200, 500] as [number, number, number, number], label: '(a)' }],
    },
  ],
};

test('the material is what the chapter said and pointed at: highlighted sentences first, then its evidence and targets', () => {
  const material = checkMaterial('How it works', chapter, beats, paneled);
  assert.equal(material.title, 'How it works');
  assert.equal(material.narration.length, 2);
  assert.deepEqual(
    material.sentences.map((s) => s.id),
    ['p1.s3', 'p1.s2'],
  );
  assert.deepEqual(
    material.elements.map((e) => e.id),
    ['fig1', 'eq1'],
    'the boxed panel counts as its figure; an equation is an element too',
  );
  assert.deepEqual(
    material.elements.map((e) => e.label),
    ['Figure 1: The layout of probes and valves', 'Equation 1'],
  );
  assert.equal(material.ready, true);
  const brief = checkBrief(material);
  assert.match(brief, /CHAPTER "How it works"/);
  assert.match(brief, /\[fig1\] Figure 1: The layout of probes and valves/);
  assert.match(brief, /\[p1\.s3\] Each probe reports a reading/);
  // The call is told what the check is and is not.
  const task = checkTask('en-US', brief);
  assert.match(task, /nothing is scored and nobody is told they are wrong/);
  assert.match(task, /never states the answer/);
  assert.match(task, /No hint states the answer/);
});

test('in a paper the answer does not fly back: it points at what is on the camera’s page or after it; a lecture keeps every target', () => {
  // The chapter's method sentences are on page 4; its figure and equation on page 6, where the camera ends.
  const spread: Doc = {
    ...paneled,
    blocks: paneled.blocks.map((b) => (b.id === 'p1.b2' ? { ...b, page: 4 } : b)),
    sentences: paneled.sentences.map((s) => (['p1.s2', 'p1.s3'].includes(s.id) ? { ...s, page: 4 } : s)),
    figures: paneled.figures.map((f) => ({ ...f, page: 6 })),
    equations: paneled.equations.map((e) => ({ ...e, page: 6 })),
  };
  const forward = checkMaterial('How it works', chapter, beats, spread, true);
  assert.equal(forward.from, 6);
  assert.deepEqual(checkTargets(forward), ['fig1', 'eq1']);
  const brief = checkBrief(forward);
  const [now, earlier] = brief.split('SHOWN EARLIER');
  assert.match(brief, /Page 6 is on screen when the question is asked/);
  assert.ok(now.includes('[fig1]') && now.includes('[eq1]') && !now.includes('[p1.s3]'));
  assert.ok(earlier.includes('[p1.s3]'), 'the method sentence is still told as what the chapter showed');
  // An answer that points at the method sentence on page 4 lands on the figure on page 6 instead.
  const request = { schema: checkSchema(checkTargets(forward)) } as unknown as Request;
  assert.deepEqual(request.schema.properties.target.enum, ['fig1', 'eq1']);
  assert.equal(cleanCheck(checkReply(request, { target: 'p1.s3' }), forward, spread).check?.target, 'fig1');
  // A page before is allowed: the tour may turn back by one.
  assert.deepEqual(
    checkTargets({
      ...forward,
      elements: [],
      sentences: [
        { id: 'a', text: 't', page: 5 },
        { id: 'b', text: 't', page: 4 },
      ],
    }),
    ['a'],
  );
  // Nothing on the page or after it: every target, the latest first.
  assert.deepEqual(
    checkTargets({
      ...forward,
      elements: [],
      sentences: [
        { id: 'a', text: 't', page: 3 },
        { id: 'b', text: 't', page: 4 },
      ],
    }),
    ['b', 'a'],
  );
  // A lecture, or any document the tour does not read forward through, keeps every target as before.
  const lecture = checkMaterial('How it works', chapter, beats, spread);
  assert.equal(lecture.from, undefined);
  assert.deepEqual(checkTargets(lecture), ['fig1', 'eq1', 'p1.s3', 'p1.s2']);
  assert.doesNotMatch(checkBrief(lecture), /is on screen when the question is asked|SHOWN EARLIER/);
});

test('a chapter that said little, or pointed at nothing, has nothing to check', () => {
  assert.equal(
    checkMaterial('Short', [{ id: 's', say: 'Just a few words here.', actions: [] }], beats, doc).ready,
    false,
  );
  assert.equal(checkMaterial('Bare', chapter, [], { ...doc, sentences: [], figures: [], equations: [] }).ready, false);
});

test('the response schema offers only the chapter’s own elements as targets, and the loose one any string', () => {
  const ids = ['fig1', 'eq1', 'p1.s3', 'p1.s2'];
  const schema = checkSchema(ids) as any;
  assert.deepEqual(schema.properties.target.enum, ids);
  assert.deepEqual(schema.required, Object.keys(schema.properties));
  assert.equal(schema.properties.hints.maxItems, 3);
  assert.equal(schema.properties.prompt.maxLength, 300);
  const loose = checkSchema(ids, false) as any;
  assert.equal(loose.properties.target.enum, undefined);
  assert.equal(loose.properties.hints.maxItems, undefined, 'the code trims a long ladder itself');
  assert.equal(loose.properties.prompt.maxLength, undefined);
});

// ------------------------------------------------------------------------------------------------- the answer

const material: CheckMaterial = checkMaterial('How it works', chapter, beats, doc);
const request = { schema: checkSchema(['fig1', 'eq1', 'p1.s3', 'p1.s2']) } as unknown as Request;
const raw = (over: object = {}) => checkReply(request, over);
const cleaned = (over: object = {}) => cleanCheck(raw(over), material, doc);

test('a good check keeps its question, hints and answer, and points at the target where the anchor is spoken', () => {
  const { check, declined, problems } = cleaned({ target: 'p1.s3' });
  assert.deepEqual(problems, []);
  assert.equal(declined, false);
  assert.deepEqual(check, {
    kind: 'predict',
    prompt: 'Before the next step: what does a valve do when its probe reads wet soil?',
    hints: ['Think about what the controller compares the reading with.', 'The valve opens only below a threshold.'],
    answer: 'It stays shut, so no water is spent on soil that is already wet.',
    target: 'p1.s3',
    at: 4,
  });
  assert.equal(cleaned({ kind: 'recall' }).check?.kind, 'recall');
  assert.equal(cleaned({ anchor: 'something else entirely' }).check?.at, 0, 'a missing anchor lands at the start');
});

test('the model can decline: no mechanism or result in the chapter to ask about', () => {
  const result = cleaned({ fits: false, prompt: '', answer: '', hints: [], keys: [], target: '', anchor: '' });
  assert.deepEqual(result, { check: null, declined: true, problems: [] });
  assert.equal(cleanCheck({ ...raw(), fits: 'maybe' }, material, doc).check, null, 'a wrong shape is not a decline');
  assert.ok(cleanCheck({ plan: 'p' }, material, doc).problems.length, 'and comes back for a repair');
  // Nothing to point at when the answer comes: no check either.
  const bare: CheckMaterial = { ...material, sentences: [], elements: [] };
  assert.equal(cleanCheck(raw(), bare, doc).declined, true);
});

test('hints stop at the first one that gives the answer away: its key words, the answer itself or its numbers', () => {
  const hints = (list: string[], over: object = {}) => cleaned({ hints: list, ...over }).check?.hints;
  assert.deepEqual(hints(['Look at the rule.', 'The valve stays shut then.', 'Think of the pump.']), [
    'Look at the rule.',
  ]);
  assert.deepEqual(hints(['It stays SHUT.', 'Another.']), [], 'a key in any case');
  assert.deepEqual(hints(['Shutting is the idea.', 'Another.']), [], 'or in another form of the word');
  assert.deepEqual(
    hints(['Think of the valve.', 'It stays shut, so no water is spent on soil that is already wet.']),
    ['Think of the valve.'],
    'the answer itself',
  );
  // A number of the answer that the chapter never said is as good as the answer.
  const counted = { answer: 'The pump runs 4 times less often, because the cycles are batched.', keys: ['batched'] };
  assert.deepEqual(hints(['Think of the cycles.', 'It is about 4 times.', 'More.'], counted), ['Think of the cycles.']);
  // A figure the chapter states is as good as the answer when the answer is that figure, whether or not it is a key.
  const stated: CheckMaterial = {
    ...material,
    sentences: [{ id: 'p2.s1', text: 'The probe network used 31.4 percent less water.' }],
  };
  const recalled = cleanCheck(
    raw({
      prompt: 'Before the next step: how much less water did the probe network use?',
      answer: 'It used 31.4 percent less, because each valve opens only when its patch of soil is dry.',
      keys: ['valve'],
      hints: ['Think of the first result.', 'It was a bit under a third, about 31.4 percent.'],
      target: 'p2.s1',
      anchor: 'only when its patch',
    }),
    stated,
    doc,
  );
  assert.deepEqual(recalled.problems, []);
  assert.deepEqual(recalled.check?.hints, ['Think of the first result.']);
  // The ladder is trimmed to three, with no repeats, and a hint that is too long ends it.
  assert.deepEqual(hints(['One.', 'One.', 'Two.', 'Three.', 'Four.']), ['One.', 'Two.', 'Three.']);
  assert.deepEqual(hints(['One.', 'x'.repeat(201), 'Three.']), ['One.']);
  assert.deepEqual(hints([]), []);
  assert.ok(cleaned({ hints: [] }).check, 'a check needs no hints');
});

test('a question that states the answer, or has no key words to guard it, comes back for one repair', () => {
  const counted = { answer: 'The pump runs 4 times less often, because the cycles are batched.', keys: ['batched'] };
  const leaking = cleaned({ ...counted, prompt: 'Before the next step: why does the pump run 4 times less often?' });
  assert.equal(leaking.check, null);
  assert.match(leaking.problems.join(' '), /prompt: it gives the answer away/);
  // A key the question already says guards nothing; without any key left there is nothing to check hints against.
  const said = cleaned({ prompt: 'Before the next step: does the valve stay shut on wet soil?' });
  assert.equal(said.check, null);
  assert.match(said.problems.join(' '), /keys:/);
  assert.match(cleaned({ keys: [] }).problems.join(' '), /keys:/);
  assert.match(cleaned({ keys: ['absent'] }).problems.join(' '), /keys:/, 'a key must be in the answer');
  assert.match(cleaned({ prompt: 'Why?' }).problems.join(' '), /prompt: ask in 1-2 spoken sentences/);
  assert.match(cleaned({ answer: 'Shut.' }).problems.join(' '), /answer: say it in 5 to 40 spoken words/);
  assert.match(
    cleaned({ answer: 'word '.repeat(70).trim() }).problems.join(' '),
    /answer: say it in 5 to 40 spoken words/,
  );
});

test('an answer brings no figure of its own: its numbers are the chapter’s or the question’s, or small ones reasoned out', () => {
  const brought = cleaned({ answer: 'It saves 52.7 percent of the water, because the valve stays shut on wet soil.' });
  assert.equal(brought.check, null);
  assert.match(brought.problems.join(' '), /answer: 52\.7 is in neither the chapter nor the question/);
  assert.ok(
    cleaned({ answer: 'It stays shut for 3 readings in a row, so no water is spent on wet soil.' }).check,
    'a small number',
  );
  // The chapter's own sentences state this one.
  const stated: CheckMaterial = {
    ...material,
    sentences: [{ id: 'p2.s1', text: 'The probe network used 31.4 percent less water.' }],
  };
  const ok = cleanCheck(
    raw({ answer: 'It saves 31.4 percent of the water, because the valve stays shut.', target: 'p2.s1' }),
    stated,
    doc,
  );
  assert.deepEqual(ok.problems, []);
  assert.ok(ok.check);
});

test('an answer read out of the document is sent back; it is the learner’s to hear in other words', () => {
  const answer =
    'Each probe reports a reading every ten minutes and a controller opens the nearest valve below a threshold.';
  const result = cleaned({ answer, keys: ['nearest'], anchor: 'the nearest valve' });
  assert.equal(result.check, null);
  assert.match(result.problems.join(' '), /answer: say it in your own words/);
});

test('a target outside the chapter becomes the chapter’s own: the figure, else a sentence it pointed at', () => {
  assert.equal(cleaned({ target: 'p2.s4' }).check?.target, 'fig1');
  assert.equal(cleaned({ target: '' }).check?.target, 'fig1');
  assert.equal(cleaned({ target: 'eq1' }).check?.target, 'eq1');
  const sentences: CheckMaterial = { ...material, elements: [] };
  assert.equal(cleanCheck(raw({ target: 'p2.s4' }), sentences, doc).check?.target, 'p1.s3');
});

// ------------------------------------------------------------------------------------------------- the steps

test('the check is a checkpoint step that keeps the page where it was, then an answer step that points', () => {
  const { check } = cleaned({ target: 'p1.s3' });
  const [ask, reveal] = checkSteps(check!, 2, chapter, doc);
  assert.equal(ask.id, 'check-2');
  assert.equal(ask.say, check!.prompt, 'the question is spoken as the card shows it');
  assert.deepEqual(ask.checkpoint, { prompt: check!.prompt, hints: check!.hints });
  // The camera of the chapter's last step, without its timing, and nothing marked: the learner looks at the page.
  assert.deepEqual(ask.actions, [{ type: 'zoom', target: 'fig1' }]);
  assert.equal(reveal.id, 'check-2-answer');
  assert.equal(reveal.say, check!.answer);
  assert.equal(reveal.checkpoint, undefined);
  assert.deepEqual(reveal.actions, [
    { type: 'focus', target: 'p1.s3' },
    { type: 'highlight', targets: ['p1.s3'], color: 'green', at_word: 4 },
  ]);
  // A figure or equation is flown to and boxed; at the start of the step when the anchor is its first word.
  const figure = cleanCheck(raw({ target: 'fig1', anchor: 'It stays shut' }), material, doc).check!;
  assert.deepEqual(checkSteps(figure, 1, [], doc)[1].actions, [
    { type: 'zoom', target: 'fig1' },
    { type: 'box', target: 'fig1', color: 'green' },
  ]);
  assert.deepEqual(checkSteps(figure, 1, [], doc)[0].actions, [], 'no camera to keep');
  const tour: Tour = {
    schema: 'paper-tour/tour@0.1',
    title: 'Check',
    paper: 'doc-plan',
    chapters: [{ id: 'c', title: 'C', steps: [ask, reveal] }],
  };
  assert.deepEqual(tourProblems(tour, doc), [], 'it passes the tour contract');
});

// ------------------------------------------------------------------------------------------------- the tour

/** A model that writes a plain tour of the paper and a check for every chapter it is asked about. */
function model(check: (request: Request, n: number) => unknown = (r) => checkReply(r), names: string[] = []) {
  let asked = 0;
  return (request: Request) => {
    names.push(request.name);
    if (request.name === 'paper_card') return card;
    if (['visual_plan', 'opening_visual'].includes(request.name)) return planFor(request);
    if (request.name === 'quick_check') return check(request, asked++);
    return direct(request, EXPLAIN);
  };
}
async function run(preset: Preset, fn = model(), events: Event[] = []) {
  const generator = new HarnessTourGenerator(settings, preset, provider(fn));
  return generator.generate({ ...input, onEvent: async (type, data) => void events.push({ type, data }) });
}
const ids = (list: Step[]) => list.map((s) => s.id);

test('a standard paper tour pauses once, after its result, and the answer follows', async () => {
  const names: string[] = [];
  const events: Event[] = [];
  const { tour, metadata } = await run('standard', model(undefined, names), events);
  const method = tour.chapters.find((c) => c.id === 'method')!.steps;
  const evidence = tour.chapters.find((c) => c.id === 'evidence')!.steps;
  assert.deepEqual(ids(method), ['method-1', 'formula-1', 'figure-1'], 'one check is enough for a standard tour');
  assert.deepEqual(ids(evidence), ['result-1', 'check-1', 'check-1-answer']);
  assert.deepEqual(
    tour.chapters.map((c) => c.id),
    ['problem', 'idea', 'method', 'evidence', 'limits', 'takeaway'],
  );
  assert.equal(steps(tour).length, 8 + 2);
  assert.equal(names.filter((n) => n === 'quick_check').length, 1, 'one small call per chapter checked');
  const asks = steps(tour).filter((s) => s.checkpoint);
  assert.deepEqual(ids(asks), ['check-1']);
  assert.equal(asks[0].say, asks[0].checkpoint!.prompt);
  assert.equal(asks[0].checkpoint!.hints.length, 2);
  // The answer comes next, and points at the page with a cue the document has.
  const answers = steps(tour).filter((s) => s.id.endsWith('-answer'));
  assert.equal(answers.length, 1);
  const cue = answers[0].actions.find((a) => a.type === 'highlight' || a.type === 'box');
  assert.ok(cue, `${answers[0].id} marks something`);
  assert.equal(steps(tour).at(steps(tour).indexOf(answers[0]) - 1)!.id, 'check-1');
  assert.deepEqual(tourProblems(tour, doc), []);
  assert.deepEqual((metadata as any).quickChecks, [{ id: 'check-1', chapter: 'evidence', kind: 'predict', hints: 2 }]);
  assert.equal((metadata as any).promptVersion, 'paper-tour-harness@33');
  const plan = events.find((e) => e.type === 'plan.ready')!;
  assert.deepEqual(plan.data.checks, [{ chapter: 'evidence', after: 'result-1' }]);
  assert.deepEqual(
    events.filter((e) => e.type === 'check.written').map((e) => [e.data.check, e.data.chapter, e.data.hints]),
    [['check-1', 'evidence', 2]],
  );
});

test('a deep paper tour pauses after two of its chapters, in order, and each answer follows its question', async () => {
  const names: string[] = [];
  const events: Event[] = [];
  const { tour, metadata } = await run('deep', model(undefined, names), events);
  assert.deepEqual(ids(tour.chapters[0].steps).slice(-2), ['check-1', 'check-1-answer']);
  assert.deepEqual(ids(tour.chapters[1].steps).slice(-2), ['check-2', 'check-2-answer']);
  assert.equal(names.filter((n) => n === 'quick_check').length, 2, 'one small call per chapter');
  assert.deepEqual(ids(steps(tour).filter((s) => s.checkpoint)), ['check-1', 'check-2']);
  const all = ids(steps(tour));
  for (const n of [1, 2]) assert.equal(all[all.indexOf(`check-${n}`) + 1], `check-${n}-answer`);
  assert.deepEqual(tourProblems(tour, doc), []);
  assert.deepEqual(
    (metadata as any).quickChecks.map((c: any) => [c.id, c.chapter]),
    [
      ['check-1', 'page-1'],
      ['check-2', 'page-2'],
    ],
  );
  assert.equal(events.find((e) => e.type === 'plan.ready')!.data.checks.length, 2);
});

test('the check call sees the chapter as the tour told it, and the chapter alone', async () => {
  const asked = async (preset: Preset) => {
    const briefs: string[] = [];
    await run(
      preset,
      model((request) => {
        briefs.push(request.messages.at(-1)!);
        return checkReply(request);
      }),
    );
    return briefs;
  };
  const [evidence, ...rest] = await asked('standard');
  assert.equal(rest.length, 0, 'one chapter, one call');
  assert.ok(evidence.includes('CHAPTER "Evidence"'));
  assert.equal(evidence.split(EXPLAIN).length - 1, 1, 'what the one step of the chapter said');
  assert.ok(evidence.includes('[p2.s1]'));
  assert.ok(!evidence.includes('[fig1]') && !evidence.includes('[eq1]'), 'not another chapter’s');
  assert.match(evidence, /TASK: write ONE quick check/);
  assert.match(evidence, /Page 2 is on screen when the question is asked/, 'a paper’s answer reads forward');

  const briefs = await asked('deep');
  assert.equal(briefs.length, 2);
  const intro = briefs.find((b) => b.includes('CHAPTER "Page 1 · Introduction"'))!;
  const results = briefs.find((b) => b.includes('CHAPTER "Page 2 · Results"'))!;
  assert.ok(intro && results);
  assert.equal(intro.split(EXPLAIN).length - 1, 4, 'what the four steps of the chapter said');
  assert.equal(results.split(EXPLAIN).length - 1, 3);
  assert.ok(intro.includes('[fig1]') && !intro.includes('[eq1]'), 'the figure it pointed at, not the equation');
  assert.ok(results.includes('[eq1]') && !results.includes('[fig1]'), 'the equation it pointed at, not the figure');
  for (const brief of briefs) assert.match(brief, /TASK: write ONE quick check/);
});

test('a quick tour has no checks and asks for none', async () => {
  const names: string[] = [];
  const { tour, metadata } = await run('quick', model(undefined, names));
  assert.ok(!names.includes('quick_check'));
  assert.ok(steps(tour).every((s) => !s.checkpoint));
  assert.equal((metadata as any).quickChecks, undefined);
});

test('a chapter the model finds nothing to ask about gets no check, and the tour is the plain one', async () => {
  const events: Event[] = [];
  const { tour } = await run(
    'standard',
    model((r) => checkReply(r, { fits: false, prompt: '', answer: '' })),
    events,
  );
  assert.equal(steps(tour).length, 8);
  assert.ok(steps(tour).every((s) => !s.checkpoint));
  assert.deepEqual(
    events.filter((e) => e.type === 'check.skipped').map((e) => e.data.reason),
    ['nothing in the chapter to predict or recall'],
  );
});

test('a question that gives the answer away is sent back once with what to fix, and the repair is used', async () => {
  const seen: string[] = [];
  const events: Event[] = [];
  const { tour } = await run(
    'standard',
    model((request) => {
      seen.push(request.task);
      // The first try states the answer in its question; the repaired try is fine.
      return request.task.includes('The answer did not match the schema')
        ? checkReply(request)
        : checkReply(request, {
            answer: 'The pump runs 4 times less often, because the cycles are batched.',
            keys: ['batched'],
            prompt: 'Before the next step: why does the pump run 4 times less often?',
          });
    }),
    events,
  );
  const failed = events.filter((e) => e.type === 'validation.failed' && e.data.stage === 'check');
  assert.equal(failed.length, 1, 'one chapter, one repair');
  assert.match(String(failed[0].data.problems), /prompt: it gives the answer away/);
  assert.equal(seen.length, 2, 'a try and a repair');
  assert.equal(seen.filter((task) => task.includes('gives the answer away')).length, 1, 'the repair says what to fix');
  assert.deepEqual(
    ids(steps(tour)).filter((id) => id.startsWith('check-')),
    ['check-1', 'check-1-answer'],
  );
  assert.match(
    steps(tour).find((s) => s.id === 'check-1')!.say,
    /^Before the next step: what does a valve do/,
    'the repaired question',
  );
});

test('a check that cannot be fixed is left out and the tour is whole; so is one the provider fails', async () => {
  const unfixable = model((request) => checkReply(request, { keys: [] }));
  const provider503 = model(() => new Response('busy', { status: 503 }));
  for (const [label, fn] of [
    ['unfixable', unfixable],
    ['provider fault', provider503],
  ] as const) {
    const events: Event[] = [];
    const { tour, metadata } = await run('standard', fn, events);
    assert.equal(steps(tour).length, 8, label);
    assert.ok(
      steps(tour).every((s) => !s.checkpoint),
      label,
    );
    assert.equal(events.filter((e) => e.type === 'check.skipped').length, 1, label);
    assert.equal((metadata as any).quickChecks, undefined, label);
    assert.deepEqual((metadata as any).fallbackBeats, [], label);
    assert.deepEqual(tourProblems(tour, doc), [], label);
  }
});

test('a rejected key still fails the tour: a check never hides a credentials error', async () => {
  await assert.rejects(
    run(
      'standard',
      model(() => new Response('denied', { status: 401 })),
    ),
    (e: any) => e.code === 'muse_auth_failed',
  );
});

test('the tour so far carries the check with its chapter, and the planned count includes the checks to come', async () => {
  const events: Event[] = [];
  const { tour } = await run('standard', model(), events);
  const partials = events.filter((e) => e.type === 'tour.partial');
  assert.ok(partials.length >= 1);
  const final = steps(tour);
  for (const { data } of partials) {
    const list = steps(data.tour as Tour);
    assert.equal(list.length, data.ready);
    assert.deepEqual(ids(list), ids(final.slice(0, data.ready)), 'always the leading steps of the final tour');
    assert.equal(data.planned, final.length, 'the check of two steps is planned from the start');
    assert.deepEqual(tourProblems(data.tour as Tour, doc), []);
  }
  // A check always arrives with the step it follows, never alone: the list never ends between the question and the answer.
  for (const { data } of partials) {
    const last = steps(data.tour as Tour).at(-1)!;
    assert.ok(!last.checkpoint, 'a partial never ends on the question');
  }
});
