// Deck mode and the cover and end cards: which documents play as a deck, how a slide is framed and drawn, which slide each
// step shows, and what the cards say. Bundled for Node with esbuild like the other player tests (no test framework).

import { frameFor, freeArea, project, slideView } from '../src/camera';
import { planDetails, planScales } from '../src/canvasPlan';
import { clampSlide, readerMode, slideOf, stepSlides, stepsBySlide } from '../src/deck';
import { flattenTour } from '../src/engine';
import { layoutDeck, layoutPages } from '../src/layout';
import { positionFromView } from '../src/readerState';
import { Resolver } from '../src/resolve';
import { chapterTakeaways, coverVisible, docTypeLabel, firstSentence, lengthLabel, recapVisible, stepsLabel } from '../src/tourSummary';
import type { CardState } from '../src/tourSummary';
import type { Doc, Tour } from '../src/types';

const results: string[] = [];
let failures = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    results.push(`  ok    ${name}`);
  } catch (error) {
    failures++;
    results.push(`  FAIL  ${name}\n        ${(error as Error).message}`);
  }
}

function eq<T>(actual: T, expected: T, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}

function close(actual: number, expected: number, what = 'value', tolerance = 1e-6) {
  if (Math.abs(actual - expected) > tolerance) throw new Error(`${what}: expected ${expected}, got ${actual}`);
}

// ------------------------------------------------------------------------------------------------ a small deck

const slides = [
  { width: 720, height: 540 },
  { width: 720, height: 540 },
  { width: 960, height: 540 },
  { width: 720, height: 540 },
];

const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'deck.pdf', sha256: '0'.repeat(64), num_pages: slides.length, generator: 'test' },
  pages: slides.map((size, i) => ({ n: i + 1, ...size })),
  sections: [],
  figures: [{ id: 'fig3', kind: 'figure', number: '1', page: 3, bbox: [100, 120, 500, 400], caption: 'A plot.', image: 'f.png', panels: [], referenced_by: [] }],
  blocks: [
    { id: 'p1.b1', page: 1, type: 'heading', text: 'Title.', bbox: [72, 200, 400, 300], sentences: ['p1.s1'] },
    { id: 'p2.b1', page: 2, type: 'paragraph', text: 'Point.', bbox: [72, 100, 600, 130], sentences: ['p2.s1'] },
    { id: 'p4.b1', page: 4, type: 'paragraph', text: 'End.', bbox: [72, 100, 600, 130], sentences: ['p4.s1'] },
  ],
  sentences: [
    { id: 'p1.s1', page: 1, block: 'p1.b1', text: 'Title.', rects: [[72, 200, 400, 300]] },
    { id: 'p2.s1', page: 2, block: 'p2.b1', text: 'Point.', rects: [[72, 100, 600, 130]] },
    { id: 'p4.s1', page: 4, block: 'p4.b1', text: 'End.', rects: [[72, 100, 600, 130]] },
  ],
  equations: [],
};
const resolver = new Resolver(doc, slides);
const deck = layoutDeck(slides);

// ------------------------------------------------------------------------------------------------ which mode

test('a lecture plays as a deck, any other kind as a paper', () => {
  eq(readerMode({ doc_type: 'lecture' }, slides), 'deck');
  for (const type of ['research_paper', 'exercise_sheet', 'contract', 'letter', 'other'] as const)
    eq(readerMode({ doc_type: type }, slides), 'paper', type);
});

test('a lecture of portrait pages (notes, not slides) scrolls like a paper', () => {
  const portrait = Array.from({ length: 5 }, () => ({ width: 595, height: 842 }));
  eq(readerMode({ doc_type: 'lecture' }, portrait), 'paper');
  eq(readerMode({ doc_type: 'lecture' }, [...portrait.slice(0, 2), ...slides.slice(0, 3)]), 'deck', 'mostly landscape');
  eq(readerMode({ doc_type: 'lecture' }, []), 'paper', 'no pages yet');
});

test('only a tour that does not say what the document is is judged by its pages', () => {
  const wide = Array.from({ length: 6 }, () => ({ width: 1024, height: 576 }));
  eq(readerMode(null, wide), 'deck', 'no tour: a run of 16:9 pages');
  eq(readerMode({}, wide), 'deck', 'a tour without a type');
  eq(readerMode({ doc_type: 'research_paper' }, wide), 'paper', 'a stated type wins over the pages');
  eq(readerMode(null, wide.slice(0, 2)), 'paper', 'two pages are not a deck');
  eq(readerMode(null, [...wide.slice(0, 4), { width: 595, height: 842 }, { width: 595, height: 842 }]), 'paper', 'mixed');
  eq(readerMode(null, Array.from({ length: 6 }, () => ({ width: 612, height: 792 }))), 'paper', 'letter pages');
  eq(readerMode(null, Array.from({ length: 6 }, () => ({ width: 720, height: 540 }))), 'deck', '4:3 slides');
  eq(readerMode(null, Array.from({ length: 6 }, () => ({ width: 800, height: 700 }))), 'paper', 'barely landscape');
});

// ------------------------------------------------------------------------------------------------ layout and camera

test('a deck lies every slide on one spot, centred on the largest', () => {
  eq(deck.deck, true);
  eq([deck.width, deck.height], [960 + 64, 540 + 64], 'the largest slide and the margins');
  const centres = deck.pages.map((p) => [p.x + p.width / 2, p.y + p.height / 2]);
  eq(centres.every(([x, y]) => x === centres[0][0] && y === centres[0][1]), true, 'one centre');
  eq(layoutPages(slides).deck, undefined, 'a paper is not a deck');
});

test('a slide is framed whole, centred, as large as the free area allows', () => {
  const vp = { width: 1000, height: 600 };
  const page = deck.pages[0];
  const view = slideView(page, deck, vp);
  const shown = project([page.x, page.y, page.x + page.width, page.y + page.height], view, vp);
  eq(shown.left >= 0 && shown.top >= 0 && shown.right <= vp.width && shown.bottom <= vp.height, true, 'all of it in view');
  close((shown.left + shown.right) / 2, vp.width / 2, 'centred across', 0.5);
  close((shown.top + shown.bottom) / 2, vp.height / 2, 'centred down', 0.5);
  // The height is what limits a 4:3 slide in a wide stage: it nearly fills it.
  eq(shown.bottom - shown.top > vp.height * 0.9, true, 'fills the height');
});

test('a slide stays above what floats over the stage, and a narrow stage fits it by width', () => {
  const vp = { width: 1000, height: 600 };
  const dock = { top: 0, right: 0, bottom: 100, left: 0 };
  const page = deck.pages[0];
  const view = slideView(page, deck, vp, dock);
  const shown = project([page.x, page.y, page.x + page.width, page.y + page.height], view, vp);
  eq(shown.bottom <= vp.height - dock.bottom, true, 'above the dock');
  eq(freeArea(vp, dock).height, 500);
  const narrow = { width: 360, height: 700 };
  const phone = project([page.x, page.y, page.x + page.width, page.y + page.height], slideView(page, deck, narrow), narrow);
  eq(phone.left >= 0 && phone.right <= narrow.width, true, 'across the phone');
  eq(phone.right - phone.left > narrow.width * 0.9, true, 'filling its width');
});

test('slides of other sizes are framed to their own size, on the same centre', () => {
  const vp = { width: 1000, height: 600 };
  const wide = deck.pages[2];
  const view = slideView(wide, deck, vp);
  const shown = project([wide.x, wide.y, wide.x + wide.width, wide.y + wide.height], view, vp);
  eq(shown.left >= 0 && shown.right <= vp.width && shown.bottom <= vp.height, true, 'whole');
  close((shown.left + shown.right) / 2, vp.width / 2, 'centred', 0.5);
});

test('in a deck a focus shows the whole slide and says which one; a zoom still goes into it', () => {
  const vp = { width: 1000, height: 600 };
  const focus = frameFor({ type: 'focus', target: 'p2.s1' }, resolver, deck, vp, { slide: true })!;
  const page = deck.pages[1];
  eq(focus.page, 2);
  eq(focus.rect, [page.x, page.y, page.x + page.width, page.y + page.height], 'the rect the dock must not cover is the slide');
  eq(focus.view, slideView(page, deck, vp), 'the slide, whole');
  const zoom = frameFor({ type: 'zoom', target: 'fig3' }, resolver, deck, vp, { slide: true })!;
  eq(zoom.page, 3);
  eq(zoom.view.s > slideView(deck.pages[2], deck, vp).s, true, 'closer than the slide');
  const beside = frameFor({ type: 'zoom', target: 'fig3' }, resolver, deck, vp, { slide: true, fitWidth: true })!;
  eq(beside.view, zoom.view, 'a board beside the stage does not cancel a zoom into a slide');
  const paper = frameFor({ type: 'focus', target: 'p2.s1' }, resolver, layoutPages(slides), vp)!;
  eq(paper.page, 2, 'a paper says the page too');
});

test('a page target is a slide', () => {
  const vp = { width: 800, height: 600 };
  const frame = frameFor({ type: 'focus', target: 'page4' }, resolver, deck, vp, { slide: true })!;
  eq([frame.page, frame.view], [4, slideView(deck.pages[3], deck, vp)]);
});

// ------------------------------------------------------------------------------------------------ canvases

test('a deck draws the slide showing, the one fading out, the neighbours of the showing one and the next one the tour goes to; the rest are released', () => {
  const view = slideView(deck.pages[0], deck, { width: 1000, height: 600 });
  const many = layoutDeck(Array.from({ length: 12 }, () => ({ width: 720, height: 540 })));
  const scales = planScales(many, view, 600, [], false, 1, { showing: [5], ahead: [] });
  eq(scales.map((s) => s > 0), [false, false, false, true, true, true, false, false, false, false, false, false], 'slides 4 to 6');
  eq(scales[4] >= scales[3] && scales[4] >= scales[5], true, 'the one showing is sharpest');
  const fading = planScales(many, view, 600, scales, false, 1, { showing: [5, 8], ahead: [] });
  eq(fading.map((s) => s > 0), [false, false, false, true, true, true, false, true, false, false, false, false], 'both, and the neighbours of the first');
  const next = planScales(many, view, 600, [], false, 1, { showing: [5], ahead: [10] });
  eq(next.map((s) => s > 0), [false, false, false, true, true, true, false, false, false, true, false, false], 'the slide ahead is drawn too, its neighbours are not');
  eq(next[9] <= next[4], true, 'and never sharper than the one showing');
  eq(planScales(many, view, 600, [], false, 1, { showing: [1], ahead: [] }).map((s) => s > 0).slice(0, 3), [true, true, false], 'at the start');
});

test('a paper is planned by where its pages are, as before', () => {
  const stack = layoutPages(Array.from({ length: 6 }, () => ({ width: 600, height: 800 })));
  const view = { cx: stack.width / 2, cy: stack.pages[0].y + 400, s: 1 };
  const scales = planScales(stack, view, 800, [], false, 1);
  eq(scales.map((s) => s > 0), [true, true, false, false, false, false]);
  eq(planScales(stack, view, 800, [], false, 1, { showing: [4], ahead: [] }), scales, 'a stack ignores the slides');
});

test('only the slides shown get a sharper canvas when zoomed in', () => {
  const many = layoutDeck(Array.from({ length: 6 }, () => ({ width: 720, height: 540 })));
  const view = { cx: many.width / 2, cy: many.height / 2, s: 4 };
  const vp = { width: 800, height: 600 };
  const scales = planScales(many, view, vp.height, [], false, 2, { showing: [3], ahead: [] });
  const details = planDetails(many, view, vp, scales, [], 2, { showing: [3], ahead: [] });
  eq(details.map((d) => d !== null), [false, false, true, false, false, false], 'slide 3 only, not its neighbours');
});

// ------------------------------------------------------------------------------------------------ the strip

const tour: Tour = {
  schema: 'paper-tour/tour@0.1',
  title: 'A deck',
  paper: 'deck',
  doc_type: 'lecture',
  chapters: [
    {
      id: 'one',
      title: 'One',
      steps: [
        { id: 'a', say: 'Start here.', actions: [{ type: 'highlight', targets: ['p1.s1'], at_word: 0 }] },
        { id: 'b', say: 'Next slide.', actions: [{ type: 'focus', target: 'p2.s1' }] },
        { id: 'c', say: 'Still there, with a closer look.', actions: [{ type: 'highlight', targets: ['p2.s1'], at_word: 1 }] },
      ],
    },
    {
      id: 'two',
      title: 'Two',
      steps: [
        { id: 'd', say: 'The plot.', actions: [{ type: 'zoom', target: 'fig3' }, { type: 'focus', target: 'p4.s1', at_word: 1 }] },
        { id: 'e', say: 'Gone to nowhere.', actions: [{ type: 'focus', target: 'nothing-like-this' }] },
        { id: 'f', say: 'The end.', actions: [{ type: 'focus', target: 'page4' }] },
      ],
    },
  ],
};

test('each step is on the slide its first camera move lands on, or stays where the last one was', () => {
  const on = stepSlides(flattenTour(tour), resolver);
  eq(on, [1, 2, 2, 3, 3, 4], 'a, b, c, d (its first move), e (no target), f');
  eq(slideOf('fig3', resolver), 3);
  eq(slideOf('nothing-like-this', resolver), null);
});

test('the strip knows which steps are on a slide', () => {
  const by = stepsBySlide([1, 2, 2, 3, 3, 4]);
  eq([...by], [[1, [0]], [2, [1, 2]], [3, [3, 4]], [4, [5]]]);
  eq(by.get(5), undefined, 'a slide the tour never visits');
  eq(stepsBySlide([]).size, 0);
});

test('a slide number is kept to the deck', () => {
  eq([clampSlide(0, 4), clampSlide(3, 4), clampSlide(9, 4), clampSlide(2.7, 4), clampSlide(NaN, 4), clampSlide(5, 0)], [1, 3, 4, 2, 1, 1]);
});

test('a deck saves the slide showing; the camera alone cannot tell where they lie on one spot', () => {
  const view = slideView(deck.pages[0], deck, { width: 1000, height: 600 });
  eq(positionFromView(deck, view, 3).page, 3);
  eq(positionFromView(deck, view).page, 1, 'without it the first of them');
  eq(positionFromView(deck, view, 3).pageOffset > 0.3 && positionFromView(deck, view, 3).pageOffset < 0.7, true, 'offset within the slide');
  const stack = layoutPages(slides);
  eq(positionFromView(stack, { cx: 400, cy: stack.pages[2].y + 10, s: 1 }, 1).page, 3, 'a paper ignores it');
});

// ------------------------------------------------------------------------------------------------ the cards

test('the cover names the kind of document and how long the tour is', () => {
  eq([docTypeLabel('research_paper'), docTypeLabel('exercise_sheet'), docTypeLabel('lecture'), docTypeLabel('contract'), docTypeLabel('letter')],
    ['Research paper', 'Exercise sheet', 'Lecture slides', 'Contract', 'Letter']);
  eq([docTypeLabel('other'), docTypeLabel(undefined)], [null, null], 'nothing to say');
  eq([lengthLabel(20_000), lengthLabel(60_000), lengthLabel(4.4 * 60_000), lengthLabel(4.6 * 60_000), lengthLabel(61 * 60_000)],
    ['under a minute', 'about 1 min', 'about 4 min', 'about 5 min', 'about 61 min']);
  eq([stepsLabel(1), stepsLabel(11)], ['1 step', '11 steps']);
});

test('a chapter\'s takeaway is the first sentence of its first step, cut at a word when long', () => {
  eq(firstSentence('The point comes first. Then the detail follows.'), 'The point comes first.');
  eq(firstSentence('One sentence only'), 'One sentence only');
  eq(firstSentence('Costs 3.5 times more. Then.'), 'Costs 3.5 times more.', 'a decimal point does not end it');
  const long = `${'word '.repeat(60)}end.`;
  const cut = firstSentence(long, 50);
  eq(cut.endsWith('…'), true, 'marked as cut');
  eq(cut.length <= 51, true, 'short');
  eq(cut.slice(0, -1).endsWith('word'), true, 'at a word');
  eq(firstSentence(''), '');
});

test('the recap lists a takeaway for every chapter and where it starts', () => {
  const list = chapterTakeaways(tour);
  eq(list.map((t) => [t.chapter, t.title, t.step]), [[0, 'One', 0], [1, 'Two', 3]]);
  eq(list.map((t) => t.point), ['Start here.', 'The plot.']);
  eq(chapterTakeaways({ ...tour, chapters: [] }), []);
});

const card = (over: Partial<CardState>): CardState => ({ hasTour: true, status: 'idle', index: 0, preview: false, restored: null, dismissed: false, aside: false, ...over });

test('the cover shows before the first play and ends with it, a jump, a question or closing it', () => {
  eq(coverVisible(card({})), true, 'before the first play');
  eq(coverVisible(card({ hasTour: false })), false, 'no tour');
  eq(coverVisible(card({ dismissed: true })), false, 'read the document first');
  eq(coverVisible(card({ aside: true })), false, 'a question');
  eq(coverVisible(card({ status: 'playing' })), false, 'playing');
  eq(coverVisible(card({ status: 'paused', preview: true, index: 4 })), false, 'a jump to another step before playing');
  eq(coverVisible(card({ status: 'paused', index: 2 })), false, 'paused mid-tour');
  eq(coverVisible(card({ status: 'ended' })), false, 'at the end');
});

test('a tour restored to a saved step shows the cover to continue from it, until anything else happens', () => {
  const restored = card({ status: 'paused', preview: true, index: 6, restored: 6 });
  eq(coverVisible(restored), true, 'on the restored step');
  eq(coverVisible({ ...restored, index: 7 }), false, 'a jump from there');
  eq(coverVisible({ ...restored, status: 'playing' }), false, 'playing');
  eq(coverVisible({ ...restored, preview: false }), false, 'paused in the middle of the step');
  eq(coverVisible({ ...restored, dismissed: true }), false, 'closed');
});

test('the recap shows when the tour has ended, until closed or a question sets the tour aside', () => {
  eq(recapVisible(card({ status: 'ended' })), true);
  eq(recapVisible(card({ status: 'ended', dismissed: true })), false, 'closed');
  eq(recapVisible(card({ status: 'ended', aside: true })), false, 'a question');
  eq(recapVisible(card({ status: 'playing' })), false, 'still playing');
  eq(recapVisible(card({ status: 'ended', hasTour: false })), false, 'no tour');
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} deck tests passed`);
