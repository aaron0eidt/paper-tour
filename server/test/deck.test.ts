import test from 'node:test';
import assert from 'node:assert/strict';
import type { MuseConfig } from '../src/config';
import type { BBox, BlockType, Doc, Tour } from '../../shared/paper';
import type { TourGenerationInput, TourImage } from '../src/tour-generator';
import { HarnessTourGenerator } from './harness-fixture';
import {
  attachUncovered,
  cleanDeckPlan,
  deckSchema,
  deckTask,
  deckTourPlan,
  fallbackDeckPlan,
  mergeToBudget,
  namesCallback,
  slideCards,
  type DeckBeat,
  type DeckPlan,
} from '../src/harness/deck';
import { deckLike } from '../src/harness/doctype';
import { checkReply } from './plan-fixture';
import { visualPlanBrief } from '../src/harness/visual-plan';
import { paperBlock, proseSentences } from '../src/harness/paper-block';
import { findAnchor, tourProblems } from '../src/harness/assemble';
import { cleanDirection } from '../src/harness/direct';
import type { Preset } from '../src/harness/beats';

// A lecture deck is planned slide by slide in its own order: boilerplate slides are skipped, trivial neighbours merge into
// one step, and every step is narrated as the lecturer would say it. Scripted model, a small deck of nine slides.

const settings: MuseConfig = {
  apiKey: 'unit-test-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en-US',
  timeoutMs: 5000,
};
const png =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j0ZkAAAAASUVORK5CYII=';

/** Slides as [title, bullets]: each page is one slide, landscape, with a footer that repeats. */
const slides: [string, string[]][] = [
  ['Lecture 4: Sorting', []],
  ['Agenda', ['Insertion sort', 'Merge sort']],
  [
    'Why sorting matters',
    ['Searching a sorted list is fast', 'Many algorithms assume sorted input', 'Databases keep indexes sorted'],
  ],
  ['Insertion sort', ['Take the next item', 'Shift larger items right', 'Insert it into the gap']],
  ['Insertion sort', []],
  ['Merge sort', ['Split the list in half', 'Sort each half', 'Merge the two sorted halves']],
  ['Running time', []],
  ['Results', ['Insertion sort took 4.2 seconds on 100000 items', 'Merge sort took 0.3 seconds on 100000 items']],
  ['Thank you', []],
];
const rect = (i: number): BBox => [40, 30 + 22 * i, 600, 46 + 22 * i];
function makeDeck(list: [string, string[]][] = slides, size: [number, number] = [720, 540]): Doc {
  const blocks: Doc['blocks'] = [];
  const sentences: Doc['sentences'] = [];
  list.forEach(([title, bullets], p) => {
    const page = p + 1;
    const add = (id: string, type: BlockType, text: string, sentence?: string) => {
      const y = blocks.length;
      blocks.push({ id, page, type, bbox: rect(y), text, sentences: sentence ? [sentence] : [] });
      if (sentence) sentences.push({ id: sentence, page, block: id, text, rects: [rect(y)] });
    };
    add(`p${page}.b1`, 'heading', title, `p${page}.s1`);
    bullets.forEach((text, i) => add(`p${page}.b${i + 2}`, 'paragraph', text, `p${page}.s${i + 2}`));
    add(`p${page}.b${bullets.length + 2}`, 'header_footer', 'Lecture 4', undefined);
    add(`p${page}.b${bullets.length + 3}`, 'header_footer', String(page), undefined);
  });
  return {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'slides.pdf', sha256: 'a'.repeat(64), num_pages: list.length, generator: 'test' },
    pages: list.map((_, i) => ({ n: i + 1, width: size[0], height: size[1] })),
    sections: [],
    blocks,
    sentences,
    figures: [],
    equations: [],
  };
}
const deck = makeDeck();
const images = (d: Doc): TourImage[] =>
  d.pages.map((p) => ({ targetId: `page${p.n}`, kind: 'page', page: p.n, label: `Slide ${p.n}`, dataUrl: png }));
const input = (d: Doc = deck): TourGenerationInput => ({
  documentId: 'deck',
  analysisId: 'a',
  doc: d,
  images: images(d),
});

const card = {
  plan: 'p',
  doc_type: 'lecture' as const,
  title: 'Sorting',
  chapter_titles: {
    problem: 'Why',
    idea: 'Idea',
    method: 'How',
    evidence: 'Evidence',
    limits: 'Limits',
    takeaway: 'Summary',
  },
  problem: { text: 'Sorting makes search fast.', evidence: ['p3.s2'] },
  key_idea: { text: 'Two algorithms trade simplicity for speed.', evidence: ['p4.s2'] },
  method_steps: [{ text: 'Insertion sort grows a sorted prefix.', evidence: ['p4.s3'] }],
  key_figures: [],
  key_formulas: [],
  results: [{ text: 'Merge sort is much faster.', evidence: ['p8.s3'] }],
  limitations: [],
  takeaway: { text: 'Pick the algorithm by how the time grows.', evidence: ['p8.s3'] },
  suggested_questions: ['Why does merging help?', 'When is insertion sort better?', 'What about other sorts?'],
};
/** The plan as the provider answers: slide numbers are strings of an enum. */
const plan = {
  plan: 'p',
  story: 'Sorting makes search fast; two algorithms trade simplicity for speed, and the numbers decide between them.',
  beats: [
    {
      slides: ['3'],
      chapter: 'Why sort',
      title: 'Why sorting matters',
      point: 'Sorted data makes search and many other algorithms fast.',
      callback: '0',
    },
    {
      slides: ['4', '5'],
      chapter: 'Two algorithms',
      title: 'Insertion sort',
      point: 'Insertion sort grows a sorted prefix one item at a time.',
      callback: '0',
    },
    {
      slides: ['6', '7'],
      chapter: 'Two algorithms',
      title: 'Merge sort',
      point: 'Merge sort splits, sorts and merges, which changes how the running time grows.',
      callback: '4',
    },
    {
      slides: ['8'],
      chapter: 'The numbers',
      title: 'Results',
      point: 'On the same input, merge sort is more than ten times faster.',
      callback: '4',
    },
  ],
  skipped: [
    { slide: '1', reason: 'title' },
    { slide: '2', reason: 'agenda' },
    { slide: '9', reason: 'thanks' },
  ],
};

type Request = { name: string; schema: any; task: string; brief: string; images: number };
function provider(model: (r: Request) => unknown, requests: Request[] = []): typeof fetch {
  return (async (_url: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body));
    const parts = (content: any) => (typeof content === 'string' ? [{ type: 'text', text: content }] : content);
    const all = body.messages.flatMap((m: any) => parts(m.content));
    const texts: string[] = all.map((p: any) => p.text ?? '');
    const request: Request = {
      name: body.response_format.json_schema.name,
      schema: body.response_format.json_schema.schema,
      task: texts.join('\n'),
      brief: texts.find((t) => t.startsWith('TASK:') && !t.startsWith('TASK: understand')) ?? '',
      images: all.filter((p: any) => p.type === 'image_url').length,
    };
    requests.push(request);
    const value = ['visual_plan', 'opening_visual'].includes(request.name)
      ? { plan: 'none', beats: [] }
      : model(request);
    return new Response(
      JSON.stringify({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }),
    );
  }) as typeof fetch;
}
const SAY =
  'Sorted input is what makes lookups cheap, since a sorted list can be halved at every probe, and that is why the rest of the lecture cares about getting data in order fast.';
function direct(r: Request, say = SAY, cues?: object[]) {
  const cue = r.schema.properties.cues.items.properties;
  const target = cue.target.enum?.[0];
  return {
    plan: 'p',
    say,
    cues: cues ?? (target ? [{ action: cue.action.enum[0], target, label: '', anchor: 'halved at every probe' }] : []),
  };
}
const model = (extra?: (r: Request) => unknown) => (r: Request) => {
  const special = extra?.(r);
  if (special !== undefined) return special;
  if (r.name === 'paper_card') return card;
  if (r.name === 'deck_plan') return plan;
  return direct(r);
};
const steps = (tour: Tour) => tour.chapters.flatMap((c) => c.steps);
async function run(
  fn = model(),
  preset: Preset = 'standard',
  d: Doc = deck,
  events: { type: string; data: any }[] = [],
) {
  const requests: Request[] = [];
  const result = await new HarnessTourGenerator(settings, preset, provider(fn, requests)).generate({
    ...input(d),
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  return { ...result, requests, all: steps(result.tour) };
}

// ------------------------------------------------------------------------------------------- reading a deck

test('a deck is recognised by its landscape pages and its little text, and every slide is read into a card', () => {
  assert.equal(deckLike(deck), true);
  assert.equal(deckLike(makeDeck(slides, [600, 800])), false, 'portrait pages are no deck');
  const cards = slideCards(deck);
  assert.deepEqual(
    cards.map((c) => [c.page, c.role, c.picture]),
    [
      [1, 'title', true],
      [2, 'agenda', true],
      [3, 'content', false],
      [4, 'content', false],
      [5, 'content', true],
      [6, 'content', false],
      [7, 'content', true],
      [8, 'content', false],
      [9, 'thanks', true],
    ],
  );
  assert.equal(cards[2].title, 'Why sorting matters');
  assert.equal(cards[2].titleId, 'p3.s1');
  assert.deepEqual(
    cards[2].body.map((b) => b.id),
    ['p3.s2', 'p3.s3', 'p3.s4'],
  );
  // A longer title that merely starts with an agenda word is content.
  const planTitle = makeDeck([
    ...slides.slice(0, 2),
    ['Plan of attack for the proof', ['First split the case', 'Then count']],
    ...slides.slice(3),
  ]);
  assert.equal(slideCards(planTitle)[2].role, 'content');
  // Slide titles are content: a slide with a title only has a sentence to cite, and the block lists every slide by number.
  assert.ok(proseSentences(deck).some((s) => s.id === 'p7.s1'));
  const block = paperBlock(deck);
  assert.match(block, /PAGES: 9 \(a slide deck: each page is one slide\)/);
  assert.match(block, /## SLIDE 2 \[p2\.s1\]: Agenda \(agenda slide\)/);
  assert.match(block, /## SLIDE 7 \[p7\.s1\]: Running time \(hardly any text: a picture, plot, table or code\)/);
  assert.match(block, /## SLIDE 3 \[p3\.s1\]: Why sorting matters\n\[p3\.s2\] Searching a sorted list is fast/);
  // Ingestion may say it: a deck of few pages with the layout set is a deck too.
  const marked = { ...makeDeck(slides.slice(0, 2), [600, 800]), source: { ...deck.source, layout: 'slides' } } as Doc;
  assert.equal(deckLike(marked), true);
});

// ------------------------------------------------------------------------------------------ the plan call

test('the plan keeps the deck’s order, skips boilerplate even when a step includes it, and stays within the steps', () => {
  const cards = slideCards(deck);
  const sloppy = {
    plan: 'p',
    story: 'A story.',
    beats: [
      { slides: [9], chapter: 'End', title: 'Thanks', point: 'The lecture ends.', callback: 0 },
      { slides: [2, 3], chapter: 'Why', title: 'Why', point: 'Sorting makes search fast.', callback: 0 },
      { slides: [4, 5, 6, 7, 8], chapter: 'Algorithms', title: 'All', point: 'Both algorithms.', callback: 9 },
      { slides: [5], chapter: 'Algorithms', title: 'Again', point: 'Insertion again.', callback: 0 },
    ],
    skipped: [{ slide: 1, reason: 'title' }],
  };
  const { plan: kept, problems } = cleanDeckPlan(sloppy, cards, 'standard');
  // The thanks slide never stays; the agenda slide leaves its step; five slides are cut to four; a repeat is dropped.
  assert.deepEqual(
    kept!.beats.map((b) => b.slides),
    [[3], [4, 5, 6, 7]],
  );
  assert.equal(kept!.beats[1].callback, 0, 'a callback to a later slide is no callback');
  assert.match(problems.join(' '), /slide 8 is in no step and not skipped/);
  // A good plan has none.
  assert.deepEqual(cleanDeckPlan(plan, cards, 'standard').problems, []);
  // A step that starts before the previous one ends is a problem, and its slides stay uncovered.
  const crossing = {
    ...plan,
    beats: [
      { ...plan.beats[1], slides: [4, 6] },
      { ...plan.beats[2], slides: [5] },
    ],
  };
  assert.match(
    cleanDeckPlan(crossing, cards, 'standard').problems.join(' '),
    /may not start before the previous step ends/,
  );
  // More steps than the preset allows: the schema names the limit, and the code asks to merge.
  assert.equal((deckSchema(9, 'quick') as any).properties.beats.maxItems, 5);
  // Slide numbers are an enum of strings for the provider; the checked schema takes strings and numbers alike.
  const strict = (deckSchema(9, 'standard') as any).properties.beats.items.properties;
  assert.deepEqual(strict.slides.items.enum, ['1', '2', '3', '4', '5', '6', '7', '8', '9']);
  assert.deepEqual(strict.callback.enum.slice(0, 2), ['0', '1']);
  const many = {
    ...plan,
    beats: [3, 4, 5, 6, 7, 8].map((n) => ({ slides: [n], chapter: 'c', title: `s${n}`, point: `p${n}`, callback: 0 })),
  };
  assert.match(cleanDeckPlan(many, cards, 'quick').problems.join(' '), /at most 5 steps/);
  assert.deepEqual(cleanDeckPlan({ plan: 'p' }, cards, 'standard').plan, null);
});

test('slides no step covers are attached to a neighbour, and the steps merged to the preset’s limit', () => {
  const cards = slideCards(deck);
  const base: DeckPlan = {
    plan: 'p',
    story: 's',
    beats: [
      { slides: [3], chapter: 'a', title: 'a', point: 'A.', callback: 0 },
      { slides: [4], chapter: 'a', title: 'b', point: 'B.', callback: 0 },
      { slides: [6], chapter: 'b', title: 'c', point: 'C.', callback: 0 },
    ],
    skipped: [{ slide: 1, reason: 'title' }],
  };
  const { plan: tied, left } = attachUncovered(base, cards, 'standard');
  // Slide 5 joins the step before it, slide 7 the step before it, and slide 8 too; boilerplate stays out.
  assert.deepEqual(
    tied.beats.map((b) => b.slides),
    [[3], [4, 5], [6, 7, 8]],
  );
  assert.deepEqual(left, []);
  const full: DeckPlan = { ...base, beats: [{ ...base.beats[0], slides: [3, 4, 5, 6] }] };
  // A step that is full takes no more, and what fits nowhere is reported.
  const crowded = attachUncovered(full, cards, 'standard');
  assert.deepEqual(
    crowded.plan.beats.map((b) => b.slides),
    [[3, 4, 5, 6]],
  );
  assert.deepEqual(crowded.left, [7, 8]);
  const merged = mergeToBudget(
    [3, 4, 5, 6, 7, 8].map((n): DeckBeat => ({
      slides: [n],
      chapter: n < 5 ? 'x' : '',
      title: `t${n}`,
      point: `p${n}.`,
      callback: 0,
    })),
    3,
  );
  assert.equal(merged.length, 3);
  assert.deepEqual(
    merged.flatMap((b) => b.slides),
    [3, 4, 5, 6, 7, 8],
  );
});

test('without a usable plan the deck is toured from its cards: boilerplate skipped, a slide and its build merged', () => {
  const cards = slideCards(deck);
  const fallback = fallbackDeckPlan(cards, 'standard', 'Sorting');
  assert.deepEqual(
    fallback.beats.map((b) => b.slides),
    [[3], [4, 5], [6], [7], [8]],
  );
  assert.deepEqual(
    fallback.skipped.map((s) => [s.slide, s.reason]),
    [
      [1, 'title'],
      [2, 'agenda'],
      [9, 'thanks'],
    ],
  );
  const quick = fallbackDeckPlan(cards, 'quick', 'Sorting');
  assert.ok(quick.beats.length <= 5);
  assert.deepEqual(
    quick.beats.flatMap((b) => b.slides),
    [3, 4, 5, 6, 7, 8],
  );
});

test('the deck becomes a tour plan with its chapters, its story and a callback, in the deck’s order', () => {
  const { plan: kept } = cleanDeckPlan(plan, slideCards(deck), 'standard');
  const tour = deckTourPlan(kept!, card as never, deck);
  assert.equal(tour.type, 'lecture');
  assert.deepEqual(
    tour.chapters.map((c) => c.title),
    ['Why sort', 'Two algorithms', 'The numbers'],
  );
  assert.deepEqual(
    tour.beats.map((b) => [b.id, b.arc, b.slides, b.page]),
    [
      ['point-1', 'chapter-1', [3], 3],
      ['point-2', 'chapter-2', [4, 5], 4],
      ['point-3', 'chapter-2', [6, 7], 6],
      ['point-4', 'chapter-3', [8], 8],
    ],
  );
  assert.deepEqual(tour.beats[2].callbacks, [4]);
  assert.equal(tour.beats[1].evidence[0], 'p4.s1', 'the camera opens on the lead slide’s title');
  assert.match(tour.beats[1].notes!.join('\n'), /THE LECTURE'S STORY: Sorting makes search fast/);
  assert.match(tour.beats[1].notes!.join('\n'), /MORE SLIDES IN THIS STEP .*SLIDE 5 "Insertion sort"/s);
  // A picture slide gets the room to explain it; a merged step more.
  assert.deepEqual(tour.beats[0].say, [35, 65]);
  assert.deepEqual(tour.beats[1].say, [45, 107]);
  assert.deepEqual(tour.beats.at(-1)!.questions, card.suggested_questions);
  assert.equal(namesCallback('This builds on slide 4, where we shifted items.', tour.beats[2], deck), true);
  assert.equal(
    namesCallback('Insertion sort showed us the cost of shifting.', tour.beats[2], deck),
    true,
    'the title names it',
  );
  assert.equal(namesCallback('This is the faster way.', tour.beats[2], deck), false);
  assert.equal(namesCallback('Anything at all.', tour.beats[0], deck), true);
});

// ------------------------------------------------------------------------------------------- the whole tour

test('a deck tour is planned slide by slide, narrated in the lecturer’s voice, with each step seeing its slides', async () => {
  const events: { type: string; data: any }[] = [];
  const { tour, all, requests, metadata } = await run(model(), 'standard', deck, events);
  assert.equal(tour.doc_type, 'lecture');
  assert.equal(metadata.docType, 'lecture');
  assert.equal(metadata.planSource, 'model');
  assert.deepEqual(
    tour.chapters.map((c) => c.title),
    ['Why sort', 'Two algorithms', 'The numbers'],
  );
  assert.deepEqual(
    all.map((s) => s.id),
    ['point-1', 'point-2', 'point-3', 'point-4'],
  );
  assert.equal(requests.filter((r) => r.name === 'deck_plan').length, 1);
  assert.equal(requests.filter((r) => r.name === 'tour_plan').length, 0);
  // The plan call sees every slide with what code thinks it is, and the tour's size.
  const planCall = requests.find((r) => r.name === 'deck_plan')!;
  assert.match(planCall.brief, /The deck has 9 slides, 6 of them teaching content, and the tour has at most 10 steps/);
  assert.match(planCall.brief, /SLIDE 2 "Agenda" \(looks like: agenda\)/);
  assert.match(planCall.brief, /SLIDE 7 "Running time" \(a picture, plot, table or code\)/);
  assert.equal(planCall.images, 0);
  // Each step names its slides, with their ids and the story; the voice is the lecturer's, not a reading of the bullets.
  const calls = requests.filter((r) => r.name === 'beat_direction');
  const insertion = calls.find((r) => r.brief.includes('POINT TO MAKE: Insertion sort grows'))!;
  assert.match(
    insertion.brief,
    /THE SLIDES OF THIS STEP \(the first is the lead; the page images of the first three are attached\):\nSLIDE 4 "Insertion sort" \[p4\.s1\]\n  \[p4\.s2\] Take the next item/,
  );
  assert.match(
    insertion.brief,
    /SLIDE 5 "Insertion sort" \[p5\.s1\]: hardly any text, so it is a picture, plot, table or code/,
  );
  assert.match(insertion.brief, /THE LECTURE'S STORY: Sorting makes search fast/);
  assert.match(insertion.brief, /LECTURER VOICE: explain these slides as the lecturer would say them aloud/);
  assert.match(insertion.brief, /never list them or reword them/);
  assert.match(insertion.brief, /code, a plot, a table, a diagram\) is explained from its attached image/);
  assert.equal(insertion.images, 2, 'the page of each slide of the step');
  assert.match(insertion.schema.properties.say.description, /45-107/);
  assert.equal(calls.find((r) => r.brief.includes('POINT TO MAKE: Sorted data'))!.images, 1);
  // A step that builds on an earlier slide is told to name it.
  const merge = calls.find((r) => r.brief.includes('POINT TO MAKE: Merge sort splits'))!;
  assert.match(
    merge.brief,
    /CALLBACK: this step builds on slide 4 "Insertion sort"\. Say in one clause how it sets this up, naming it as "slide 4"/,
  );
  // The camera opens on the lead slide's title; the last step invites a question.
  assert.deepEqual(all[1].actions[0], { type: 'focus', target: 'p4.s1' });
  assert.match(
    calls.at(-1)!.brief + calls.find((r) => r.brief.includes('STEP KIND: point') && r.brief.includes('Results'))!.brief,
    /End by inviting the learner/,
  );
  assert.ok(
    events.some(
      (e) => e.type === 'plan.ready' && e.data.beats[1].slides?.join() === '4,5' && e.data.skipped.length === 3,
    ),
  );
  assert.deepEqual((metadata.deck as any).steps, [[3], [4, 5], [6, 7], [8]]);
  assert.equal(tour.suggested_questions?.length, 3);
});

test('a lecture pauses after its sections that teach: a quick check, then the answer on the slide', async () => {
  // Six content slides as six steps in three sections; the last section is the summary, which no check follows. A deep
  // tour has room for the two sections before it (a standard one for one), which shows the order.
  const sections = {
    ...plan,
    beats: [3, 4, 5, 6, 7, 8].map((n) => ({
      slides: [String(n)],
      chapter: n < 5 ? 'Why sort' : n < 8 ? 'Two algorithms' : 'The numbers',
      title: `Slide ${n}`,
      point: `What slide ${n} adds to the lecture's story about sorting.`,
      callback: '0',
    })),
  };
  const events: { type: string; data: any }[] = [];
  const { tour, all, requests, metadata } = await run(
    model((r) => (r.name === 'deck_plan' ? sections : r.name === 'quick_check' ? checkReply(r as never) : undefined)),
    'deep',
    deck,
    events,
  );
  assert.deepEqual(
    tour.chapters.map((c) => [c.title, c.steps.map((s) => s.id).join(' ')]),
    [
      ['Why sort', 'point-1 point-2 check-1 check-1-answer'],
      ['Two algorithms', 'point-3 point-4 point-5 check-2 check-2-answer'],
      ['The numbers', 'point-6'],
    ],
  );
  assert.equal(requests.filter((r) => r.name === 'quick_check').length, 2);
  // The answer flies to a sentence of the section's slides and marks it.
  const [camera, mark] = all.find((s) => s.id === 'check-1-answer')!.actions as any[];
  assert.match(mark.targets[0], /^p[34]\.s\d$/);
  assert.deepEqual(
    [camera.type, camera.target, mark.type, mark.color],
    ['focus', mark.targets[0], 'highlight', 'green'],
  );
  assert.equal(all.find((s) => s.id === 'check-2')!.checkpoint?.hints.length, 2);
  assert.deepEqual(tourProblems(tour, deck), []);
  assert.equal((metadata as any).quickChecks.length, 2);
  assert.equal(events.filter((e) => e.type === 'check.written').length, 2);
});

test('a highlight on another slide of the step moves the camera there, at the same word', async () => {
  const { all } = await run(
    model((r) => {
      if (r.name !== 'beat_direction' || !r.brief.includes('POINT TO MAKE: Insertion sort grows')) return undefined;
      const say =
        'Insertion sort keeps a sorted prefix and grows it by one item each round, which is why the second slide shows it as a growing staircase.';
      return direct(r, say, [
        { action: 'highlight', target: 'p4.s3', label: '', anchor: 'keeps a sorted prefix' },
        { action: 'highlight', target: 'p5.s1', label: '', anchor: 'growing staircase' },
      ]);
    }),
  );
  const step = all[1];
  const later = findAnchor(step.say, 'growing staircase')!;
  const focus = step.actions.filter((a) => a.type === 'focus');
  assert.deepEqual(
    focus.map((a) => (a as any).target),
    ['p4.s1', 'p5.s1'],
  );
  assert.equal(focus[1].at_word, later);
  const marks = step.actions.filter((a) => a.type === 'highlight').map((a) => (a as any).targets[0]);
  assert.deepEqual(marks, ['p4.s3', 'p5.s1']);
});

test('slides that no step covers are named in one repair turn; a plan with nothing taught uses the cards', async () => {
  const gaps = {
    ...plan,
    beats: [plan.beats[0], { ...plan.beats[1], slides: [4] }, { ...plan.beats[2], slides: [6] }, plan.beats[3]],
  };
  let calls = 0;
  const events: { type: string; data: any }[] = [];
  const fixed = await run(
    model((r) => (r.name === 'deck_plan' ? (++calls === 1 ? gaps : plan) : undefined)),
    'standard',
    deck,
    events,
  );
  const repair = fixed.requests.filter((r) => r.name === 'deck_plan')[1];
  assert.match(repair.task, /slides 5, 7 are in no step and not skipped/);
  assert.deepEqual((fixed.metadata.deck as any).steps, [[3], [4, 5], [6, 7], [8]]);
  assert.ok(events.some((e) => e.type === 'validation.failed' && e.data.stage === 'deck'));
  // If the repair does not fix it, the code attaches them: the tour still covers every content slide.
  const stuck = await run(model((r) => (r.name === 'deck_plan' ? gaps : undefined)));
  assert.deepEqual((stuck.metadata.deck as any).steps, [[3], [4, 5], [6, 7], [8]]);
  assert.deepEqual((stuck.metadata.deck as any).uncovered, []);
  // A plan call that fails twice: the cards make the plan, and the tour still plays.
  const fallback = await run(model((r) => (r.name === 'deck_plan' ? { plan: 'p' } : undefined)));
  assert.equal(fallback.metadata.planSource, 'fallback');
  assert.equal(fallback.requests.filter((r) => r.name === 'deck_plan').length, 2);
  assert.deepEqual((fallback.metadata.deck as any).steps, [[3], [4, 5], [6], [7], [8]]);
  assert.equal(fallback.tour.doc_type, 'lecture');
});

test('narration that names no callback, or only restates the slides, is sent back once', async () => {
  const seen: Request[] = [];
  const bare =
    'Merge sort splits the list and merges the halves back, which is what keeps the cost of growing the input small.';
  const named =
    'This builds on slide 4: instead of shifting items one by one, merge sort halves the list and merges the halves back.';
  const { all } = await run(
    model((r) => {
      if (r.name !== 'beat_direction' || !r.brief.includes('POINT TO MAKE: Merge sort splits')) return undefined;
      seen.push(r);
      return direct(r, r.task.includes('name it once as "slide 4"') ? named : bare);
    }),
  );
  assert.equal(seen.length, 2);
  assert.ok(all[2].say.includes('slide 4'));
  // A step that only repeats what its slides say gets the restatement repair, judged against the whole slide text.
  const echoed: Request[] = [];
  const echo =
    'Split the list in half, sort each half, and merge the two sorted halves, so the two sorted halves are merged and each half is sorted.';
  const restated = await run(
    model((r) => {
      if (r.name !== 'beat_direction' || !r.brief.includes('POINT TO MAKE: Merge sort splits')) return undefined;
      echoed.push(r);
      return direct(r, echoed.length === 1 ? echo : named);
    }),
  );
  assert.equal(echoed.length, 2);
  assert.match(echoed[1].task, /mostly restates the highlighted sentences/);
  assert.ok(!restated.all[2].say.includes('merge the two sorted halves, so'));
});

test('the deck planning task is generic: it names no deck, only slides, steps and roles', () => {
  const task = deckTask('en-US', slideCards(deck), 'standard', 'Sorting');
  assert.match(task, /Skip the slides that teach nothing: the title slide, the agenda or outline/);
  assert.match(task, /merge it into the step of the slide it illustrates/);
  assert.match(task, /DECK: Sorting\nSLIDE 1 "Lecture 4: Sorting" \(looks like: title\)/);
  assert.ok(!/MIT|6\.0002|classification|k-NN/i.test(task));
});

// ------------------------------------------------------------------------------------------ the board of a slide

// The learner sees the slide, so its board goes beyond it (slide-copy.ts): a board that only redraws the slide's own words
// and numbers is sent back once, and dropped when it still does. Here the results slide: two timings as bars.
const RESULTS_SAY =
  'Merge sort wins on the same input because splitting halves the work at every level, so the seconds it saves grow with the input; insertion sort needs 4.2 seconds where merge sort needs 0.3, and the gap only widens.';
const copyingBars = {
  title: 'Insertion sort and merge sort seconds',
  unit: 'seconds',
  bars: [
    { label: 'Insertion sort', value: 4.2 },
    { label: 'Merge sort', value: 0.3 },
  ],
};
const buildingFlow = {
  title: 'Why merge sort scales',
  nodes: [
    { id: 'node-1', label: 'Split list' },
    { id: 'node-2', label: 'Sort left half' },
    { id: 'node-3', label: 'Sort right half' },
    { id: 'node-4', label: 'Merge halves' },
  ],
  edges: [
    { from: 'node-1', to: 'node-2' },
    { from: 'node-1', to: 'node-3' },
    { from: 'node-2', to: 'node-4' },
    { from: 'node-3', to: 'node-4' },
  ],
};
const resultsStep = (r: Request) => r.name === 'beat_direction' && r.brief.includes('POINT TO MAKE: On the same input');
/** A model that answers the results slide with `board(attempt)`, a board of the bars or flow kind, and nothing else differently. */
function drawing(board: (attempt: number) => object, attempts: { n: number }) {
  return model((r) => {
    if (!resultsStep(r)) return undefined;
    attempts.n++;
    return { ...direct(r, RESULTS_SAY), ...board(attempts.n) };
  });
}

test('a board that only redraws its slide is sent back once, and kept when it builds on the slide instead', async () => {
  const attempts = { n: 0 };
  const events: { type: string; data: any }[] = [];
  const { all, metadata, requests } = await run(
    drawing((n) => (n === 1 ? { bars: copyingBars } : { flow: buildingFlow }), attempts),
    'standard',
    deck,
    events,
  );
  assert.equal(attempts.n, 2, 'one correction');
  const sent = requests.filter(resultsStep).at(-1)!.task;
  assert.match(
    sent,
    /bars: the board copies the slide: \d+ of its \d+ words and numbers \(.*(insertion|merge).*\) are printed on the slide/,
  );
  assert.match(sent, /Show what the slide leaves out instead: the mechanism behind its picture/);
  assert.ok(events.some((e) => e.type === 'validation.failed' && /copies the slide/.test(e.data.problems?.join(' '))));
  const board = all.find((s) => s.id === 'point-4')!.actions.find((a) => a.type === 'board');
  assert.equal(board?.type === 'board' && board.item.kind, 'flow');
  assert.deepEqual(metadata.degraded, []);
});

test('a board that still copies its slide after the correction plays without it, flagged, with its narration', async () => {
  const attempts = { n: 0 };
  const events: { type: string; data: any }[] = [];
  const { all, metadata } = await run(
    drawing(() => ({ bars: copyingBars }), attempts),
    'standard',
    deck,
    events,
  );
  assert.ok(attempts.n >= 2, `${attempts.n} tries`);
  const step = all.find((s) => s.id === 'point-4')!;
  assert.equal(step.say, RESULTS_SAY);
  assert.ok(!step.actions.some((a) => a.type === 'board'));
  const lost = (metadata.degraded as any[]).find((d) => d.beat === 'point-4');
  assert.deepEqual(lost.dropped, ['board']);
  assert.match(lost.problems.join(' '), /the board copies the slide/);
  assert.ok(events.some((e) => e.type === 'validation.failed' && /copies the slide/.test(e.data.problems?.join(' '))));
});

test('papers are not held to a slide: the same bars on a step that is no slide step stay', () => {
  const sentences = new Map(deck.sentences.map((s) => [s.id, s]));
  const evidence = ['p8.s1', 'p8.s2', 'p8.s3'];
  const beat = { id: 'result-1', kind: 'result' as const, arc: 'a', point: 'Timings.', evidence };
  const text = evidence.map((id) => sentences.get(id)!.text).join('\n');
  const targets = { page: 8, sentences: evidence, visuals: [], evidence: text, source: text };
  const bars = { plan: 'p', say: RESULTS_SAY, cues: [], bars: copyingBars };
  const paper = cleanDirection(bars, beat, targets);
  assert.equal(paper?.board?.kind, 'bars', 'no slide text, no copy check');
  const slide = cleanDirection(bars, { ...beat, slides: [8] }, { ...targets, slide: text });
  assert.equal(slide?.board, undefined);
  assert.match(slide!.boardProblems![0], /^bars: the board copies the slide/);
});

test('a worked example whose frames only redraw the slide is dropped; one that works something out stays', () => {
  const evidence = ['p8.s1', 'p8.s2', 'p8.s3'];
  const text = evidence.map((id) => deck.sentences.find((s) => s.id === id)!.text).join('\n');
  const beat = { id: 'point-4', kind: 'point' as const, arc: 'a', point: 'Timings.', evidence, slides: [8] };
  const targets = { page: 8, sentences: evidence, visuals: [], evidence: text, source: text, slide: text };
  const say =
    'For an illustrative case, insertion sort needs 4.2 seconds and merge sort 0.3 seconds on the same items. Dividing the first by the second gives 14, so merge sort is fourteen times faster here, which is the gap that grows with the input.';
  const frame = (anchor: string, title: string, ...labels: string[]) => ({
    anchor,
    flow: {
      title,
      nodes: labels.map((label, i) => ({ id: `node-${i + 1}`, label })),
      edges: labels.slice(1).map((_, i) => ({ from: `node-${i + 1}`, to: `node-${i + 2}` })),
    },
  });
  // The result of the copy is a number the slide prints (4.2 seconds); the other works out one it does not (4.2 / 0.3).
  const example = (result: [string, string, number]) => ({
    assumptions: 'Illustrative case: the two timings of the slide, on the same items.',
    inputs: [
      { label: 'Insertion sort seconds', value: 4.2 },
      { label: 'Merge sort seconds', value: 0.3 },
    ],
    calculations: [{ expression: result[1], result: result[2] }],
    frames: [
      frame(
        'insertion sort needs 4.2 seconds',
        'Insertion sort and merge sort',
        'Insertion sort 4.2',
        'Merge sort 0.3',
        'Seconds items',
      ),
      frame(
        'Dividing the first by the second',
        'Insertion sort and merge sort seconds',
        'Insertion sort 4.2',
        'Merge sort 0.3',
        result[0],
      ),
    ],
  });
  const same: [string, string, number] = ['Seconds 4.2', '4.2*1', 4.2];
  const ratio: [string, string, number] = ['Ratio 14', '4.2/0.3', 14];
  const copy = cleanDirection({ plan: 'p', say, cues: [], example: example(same) }, beat, targets)!;
  assert.equal(copy.example, undefined);
  assert.match(copy.exampleProblems![0], /^the worked example copies the slide/);
  const works = cleanDirection({ plan: 'p', say, cues: [], example: example(ratio) }, beat, targets)!;
  assert.equal(works.example?.frames.length, 2);
  assert.deepEqual(works.exampleProblems, []);
  // A step that is no slide step keeps even the copy: papers are not held to a slide.
  const { slide: _slide, ...paper } = targets;
  assert.ok(
    cleanDirection({ plan: 'p', say, cues: [], example: example(same) }, { ...beat, slides: undefined }, paper)!
      .example,
  );
});

test('narration that opens by announcing its slides is sent back once, and the voice is left to the model', async () => {
  const seen: Request[] = [];
  const opening =
    'These slides show how merge sort splits the list and merges the halves back, which keeps the cost of growth small.';
  const free =
    'Splitting the list in half at every level is what keeps the cost of merge sort small, since each level only touches every item once while the halves are merged back.';
  const { all } = await run(
    model((r) => {
      if (r.name !== 'beat_direction' || !r.brief.includes('POINT TO MAKE: Merge sort splits')) return undefined;
      seen.push(r);
      const say = seen.length === 1 ? opening : free;
      return direct(r, `${say} This builds on slide 4.`);
    }),
  );
  assert.equal(seen.length, 2);
  assert.match(seen[1].task, /Do not open by announcing the slides/);
  assert.ok(all[2].say.startsWith('Splitting the list'));
  // Without an announcement there is no repair, and the voice rule no longer asks for one.
  assert.doesNotMatch(seen[0].task, /The first sentence says what these slides do/);
  assert.match(seen[0].task, /never with "these slides" or "this slide"/);
});

test('the plan call of a deck asks for boards that build on its slides, and lists the slides the learner sees', async () => {
  const { requests } = await run();
  const planCall = requests.find((r) => r.name === 'visual_plan')!;
  assert.match(planCall.task, /The side board is not a second copy of a slide\. It builds on it\./);
  assert.match(planCall.task, /the slides on screen:\n    SLIDE 4 "Insertion sort"/);
  assert.match(planCall.task, /SLIDE 5 "Insertion sort" \(a picture, plot, table or code\)/);
  assert.doesNotMatch(planCall.task, /MORE SLIDES IN THIS STEP/, 'the slides are listed once');
  // The brief of the plan names each step’s slides; a document that is no deck keeps the old one.
  const { plan: kept } = cleanDeckPlan(plan, slideCards(deck), 'standard');
  const brief = visualPlanBrief(card as never, deckTourPlan(kept!, card as never, deck).beats, deck);
  assert.match(brief, /\[point-3\] point step\n {2}the point: Merge sort splits/);
  assert.match(brief, /the slides on screen:\n {4}SLIDE 6 "Merge sort"/);
});
