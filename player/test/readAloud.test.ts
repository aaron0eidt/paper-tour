const equal = (actual: unknown, expected: unknown) => { if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); };
const assert = { equal, deepEqual: equal, ok: (value: unknown) => { if (!value) throw new Error('Assertion failed'); } };
import { cleanReadingText, DEFAULT_READING_OPTIONS, readingStepOnPage, readingTour } from '../src/readAloud';
import { sourceOrder } from '../../shared/readingOrder';
import { prepareTour, Resolver } from '../src/resolve';
import { SilentNarrator } from '../src/narration/silent';
import { TourEngine } from '../src/engine';
import type { Doc } from '../src/types';

const refs = new Set([1, 2, 3, 4, 12]);
assert.equal(cleanReadingText('The method [12] improves results [1, 3–4].', true, refs), 'The method improves results.');
assert.equal(cleanReadingText('Results (Vaswani et al., 2017) improve.', true), 'Results improve.');
assert.equal(cleanReadingText('x[2] and x [2] and the interval [0, 1] with x ∈ [1, 2].', true, refs),
  'x[2] and x [2] and the interval [0, 1] with x ∈ [1, 2].');
assert.equal(cleanReadingText('A ﬁne inter\u00ad\nnational loss-\nfree method.\nNext line.'),
  'A fine international loss-free method. Next line.');
assert.equal(cleanReadingText('Results [12].', false, refs), 'Results [12].');
assert.equal(cleanReadingText('Unknown source [99].', true, refs), 'Unknown source [99].');

const doc: Doc = {
  schema: 'paper-tour/doc@0.1', source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 2, generator: 'test' },
  pages: [1, 2].map((n) => ({ n, width: 600, height: 800 })), sections: [], figures: [], equations: [],
  // Ingestion reads the entire left column before the top of the right column.
  blocks: [
    { id: 'left-bottom', page: 1, type: 'paragraph', bbox: [40, 600, 270, 650], text: 'First sentence [12]. Second sentence.', sentences: ['first', 'second'] },
    { id: 'right-top', page: 1, type: 'paragraph', bbox: [320, 40, 570, 80], text: 'Third sentence. Unsegmented original text.', sentences: ['third'] },
    { id: 'footer', page: 1, type: 'header_footer', bbox: [300, 750, 320, 760], text: '1', sentences: [] },
    { id: 'page2', page: 2, type: 'paragraph', bbox: [40, 40, 270, 80], text: 'Page two.', sentences: [] },
    { id: 'reference', page: 2, type: 'reference', bbox: [40, 500, 270, 580], text: '[12] A paper.', sentences: [] },
  ],
  sentences: [
    { id: 'first', page: 1, block: 'left-bottom', text: 'First sentence [12].', rects: [[40, 600, 270, 620]] },
    { id: 'second', page: 1, block: 'left-bottom', text: 'Second sentence.', rects: [[40, 625, 270, 650]] },
    { id: 'third', page: 1, block: 'right-top', text: 'Third sentence.', rects: [[320, 40, 570, 60]] },
  ],
};
const tour = readingTour(doc);
const steps = tour.chapters.flatMap((c) => c.steps);
assert.deepEqual(steps.map((s) => s.say), ['First sentence. Second sentence.', 'Third sentence. Unsegmented original text.', 'Page two.']);
assert.deepEqual(steps[0].actions, [
  { type: 'focus', target: 'left-bottom' },
  { type: 'board_clear' },
  { type: 'highlight', targets: ['first'], at_word: 0 },
  { type: 'highlight', targets: ['second'], at_word: 2 },
]);
assert.deepEqual(steps[1].actions.at(-1), { type: 'highlight', targets: ['right-top'] });
assert.equal(readingStepOnPage(tour, doc, 2), 2);
assert.ok(sourceOrder(doc).get('second')! < sourceOrder(doc).get('third')!);
assert.equal(readingTour(doc, { ...DEFAULT_READING_OPTIONS, includeReferences: true }).chapters.flatMap((c) => c.steps).length, 4);
assert.equal(readingTour(doc, { ...DEFAULT_READING_OPTIONS, removeCitations: false }).chapters[0].steps[0].say, 'First sentence [12]. Second sentence.');
const prepared = prepareTour(tour, new Resolver(doc, doc.pages));
assert.deepEqual(prepared.problems, []);
const engine = new TourEngine(prepared.tour, { narrator: new SilentNarrator() });
engine.goTo(readingStepOnPage(tour, doc, 2));
assert.equal(engine.steps[engine.getState().index].step.say, 'Page two.');
engine.destroy();
console.log('Read aloud: cleaning, source order, complete original text, source cues and playback passed');

// Tables are one grounded visual reading, never a sequence of individual cell utterances.
const tableDoc: Doc = { ...doc, blocks: [...doc.blocks,
  { id: 'cell1', page: 2, type: 'table_text', bbox: [40, 200, 200, 220], text: 'Method A', sentences: [] },
  { id: 'cell2', page: 2, type: 'table_text', bbox: [300, 200, 500, 220], text: '90.4', sentences: [] }],
  figures: [{ id: 'table', page: 2, kind: 'table', number: '1', bbox: [40, 180, 560, 300],
    caption: 'Results', panels: [], referenced_by: [], image: 'table.png' }] };
const tableSteps = readingTour(tableDoc).chapters.flatMap((c) => c.steps);
assert.equal(tableSteps.filter((s) => s.id === 'reading-table').length, 1);
assert.equal(tableSteps.some((s) => s.id === 'reading-cell1' || s.id === 'reading-cell2'), false);
assert.equal(tableSteps.find((s) => s.id === 'reading-table')?.speaker, 'explanation');
assert.equal(readingStepOnPage(tour, doc, 99), 2);

// Repairing hard line-wrap hyphenation is allowed; changing maths and negation is not.
const { sameReadingWords } = await import('../../shared/readingText');
assert.ok(sameReadingWords('AUXILIARY-LOSS-FREE LOAD BALANCING STRAT-EGY FOR MIXTURE-OF-EXPERTS', 'Auxiliary-loss-free load balancing strategy for mixture-of-experts'));
assert.equal(sameReadingWords('The value is 1.2.', 'The value is 12.'), false);
assert.equal(sameReadingWords('Use x-y here.', 'Use xy here.'), false);

const withAuthors: Doc = { ...doc, blocks: [
  { id: 'authors', page: 1, type: 'authors', bbox: [30, 20, 570, 60], text: 'A. Researcher, Example University', sentences: [] },
  { id: 'contact', page: 1, type: 'footnote', bbox: [30, 700, 570, 720], text: 'Corresponding author: author@example.test', sentences: [] },
  ...doc.blocks,
] };
assert.equal(readingTour(withAuthors).chapters.flatMap((c) => c.steps).some((s) => /Researcher|Corresponding author/.test(s.say)), false);

// Consecutive section/subsection headings and the following paragraph are spoken together.
const groupedDoc: Doc = { ...doc, blocks: [
  { id: 'h1', page: 1, type: 'heading', bbox: [40, 40, 560, 60], text: 'Experiments', sentences: [] },
  { id: 'h2', page: 1, type: 'heading', bbox: [40, 80, 560, 100], text: 'Experimental setups', sentences: [] },
  ...doc.blocks,
] };
const grouped = readingTour(groupedDoc);
assert.equal(grouped.chapters[0].steps[0].say, 'Experiments. Experimental setups. First sentence. Second sentence.');
assert.ok(grouped.chapters[0].steps[0].actions.some((a) => a.type === 'highlight' && a.targets[0] === 'first' && a.at_word === 3));
const { readingStepForTarget } = await import('../src/readAloud');
assert.equal(readingStepForTarget(grouped, groupedDoc, 'left-bottom'), 0);
assert.equal(cleanReadingText('Use the interval [1, 2] and vector [3, 4].', true, new Set([1, 2, 3, 4])), 'Use the interval [1, 2] and vector [3, 4].');
