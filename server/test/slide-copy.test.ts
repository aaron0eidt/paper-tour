import test from 'node:test';
import assert from 'node:assert/strict';
import type { BoardItem, Doc } from '../../shared/paper';
import type { Beat } from '../src/harness/beats';
import {
  COPY_SHARE,
  MIN_MARKS,
  copyCheck,
  copyShare,
  exampleCopyProblems,
  slideCopy,
  slideCopyProblems,
  slidePrinted,
} from '../src/harness/slide-copy';
import { slideOpeningProblems } from '../src/harness/deck';
import { visualPlanTask, withTableBoard } from '../src/harness/visual-plan';
import { doc as base } from './plan-fixture';
import { directTask } from '../src/harness/prompts';

// Whether a board of a slide step only redraws its slide (slide-copy.ts). The pairs are real: the boards of two tours of
// one lecture deck (the saved tour and a run of 2026-11-04, 12 boards) with the text printed on the slides of their step,
// then boards written by hand for other decks in English and German. A copy is flagged with the share of its words and
// numbers the slide prints; a board that builds on the slide is let be, and so is any board of a slide that is a picture
// (its text is an image).

const bars = (title: string, ...rows: [string, number][]): BoardItem => ({
  kind: 'bars',
  title,
  bars: rows.map(([label, value]) => ({ label, value })),
});
const flow = (title: string, ...labels: string[]): BoardItem => ({
  kind: 'flow',
  title,
  nodes: labels.map((label, i) => ({ id: `node-${i + 1}`, label })),
  edges: labels.slice(1).map((_, i) => [`node-${i + 1}`, `node-${i + 2}`]),
});
const scatter = (title: string, x: string, y: string, ...points: [string, number, number][]): BoardItem => ({
  kind: 'scatter',
  title,
  x_label: x,
  y_label: y,
  points: points.map(([label, px, py]) => ({ label, x: px, y: py })),
  source: 'document',
});
const share = (item: BoardItem, printed: string) => copyShare(slideCopy(item, printed)).share;

// ------------------------------------------------------------------------------------------- the saved lecture tour

/** The text of slides 12 to 14 of the lecture (headings and bullets), as the learner reads it. */
const TITANIC = `The Titanic Disaster
RMS Titanic sank in the North Atlantic the morning of 15 April 1912, after colliding with an iceberg.
Of the 1,300 passengers aboard, 812 died.
(703 of 918 crew members died.)
Database of 1046 passengers
Is Accuracy Enough
If we predict “died”, accuracy will be >62% or passenger and >76% for crew members Consider a disease that occurs in 0.1% of population
◦ Predicting disease-free has an accuracy of 0.999
Other Metrics
sensitivity = recall specificity = precision`;
const KNN_RESULTS = `Let’s Try KNN
Results
Average of 10 80/20 splits using KNN (k=3) Accuracy = 0.766 Sensitivity = 0.67 Specificity = 0.836 Pos. Pred. Val. = 0.747 Average of LOO testing using KNN (k=3) Accuracy = 0.769 Sensitivity = 0.663 Specificity = 0.842 Pos. Pred. Val. = 0.743
Considerably better than 62%
Not much difference between experiments`;
const COMPARE = `Putting It Together
Results
Average of 10 80/20 splits LR Accuracy = 0.804 Sensitivity = 0.719 Specificity = 0.859 Pos. Pred. Val. = 0.767 Average of LOO testing using LR Accuracy = 0.786 Sensitivity = 0.705 Specificity = 0.842 Pos. Pred. Val. = 0.754
Compare to KNN Results
Average of 10 80/20 splits using KNN (k=3) Accuracy = 0.744 Sensitivity = 0.629 Specificity = 0.829 Pos. Pred. Val. = 0.728 Average of LOO testing using KNN (k=3) Accuracy = 0.769 Sensitivity = 0.663 Specificity = 0.842 Pos. Pred. Val. = 0.743
Performance not much difference Logistic regression slightly better
Also provides insight about variables`;
const CUTOFF = `Looking at Feature Weights
Be wary of reading too much into the weights Features are often correlated
model.classes_ = ['Died' 'Survived'] For label Survived C1 = 1.66761946545 C2 = 0.460354552452 C3 = -0.50338282535 age = -0.0314481062387 male gender = -2.39514860929
Changing the Cutoff
Try p = 0.1 Accuracy = 0.493 Sensitivity = 0.976 Specificity = 0.161 Pos. Pred. Val. = 0.444
Try p = 0.9 Accuracy = 0.656 Sensitivity = 0.176 Specificity = 0.984 Pos. Pred. Val. = 0.882
ROC (Receiver Operating Characteristic)
Output`;
const LOGISTIC = `Logistic Regression
Analogous to linear regression
Designed explicitly for predicting probability of an event
◦ Dependent variable can only take on a finite set of values
Finds weights for each feature
◦ Positive implies variable positively correlated with outcome
◦ Absolute magnitude related to strength of the correlation
Class LogisticRegression
fit(sequence of feature vectors, sequence of labels) Returns object of type LogisticRegression coef_ Returns weights of features predict_proba(feature vector) Returns probabilities of labels`;
const KNN_PICTURES = `K-nearest Neighbors
X
An Example
Advantages and Disadvantages of KNN
Advantages
◦ Learning fast, no explicit training
◦ Memory intensive and predictions can take a long time
◦ No model to shed light on process that generated data`;

/** The boards that only redraw their slide: its numbers as bars or points, its table as a chart. */
const COPIES: [string, BoardItem, string][] = [
  [
    'two bullet numbers as bars',
    bars('Trivial predictor accuracy', ['Predict died passengers', 62], ['Predict died crew', 76]),
    TITANIC,
  ],
  [
    'the results of a slide as bars',
    bars('KNN accuracy by evaluation', ['KNN 80/20 splits', 0.766], ['KNN LOO', 0.769]),
    KNN_RESULTS,
  ],
  [
    'the results table of two slides as points',
    scatter(
      'Sensitivity vs Specificity',
      'specificity',
      'sensitivity',
      ['KNN 80/20', 0.829, 0.629],
      ['LR 80/20', 0.859, 0.719],
      ['KNN LOO', 0.842, 0.663],
      ['LR LOO', 0.842, 0.705],
    ),
    COMPARE,
  ],
  [
    'the two cutoffs of a slide and the point beside them',
    scatter(
      'Cutoff trades sensitivity specificity',
      'specificity (fraction)',
      'sensitivity (fraction)',
      ['p=0.1 cutoff', 0.161, 0.976],
      ['default LR', 0.859, 0.719],
      ['p=0.9 cutoff', 0.984, 0.176],
    ),
    CUTOFF,
  ],
  [
    'the same results drawn as a plotly figure',
    {
      kind: 'plotly',
      title: 'Sensitivity-specificity trade-off by cutoff',
      objective:
        "Show that raising the probability cutoff lowers sensitivity while raising specificity, using the lecture's measured values.",
      figure: JSON.stringify({
        data: [
          { name: 'Sensitivity', type: 'scatter', x: [0.1, 0.5, 0.9], y: [0.976, 0.719, 0.176], text: ['0.976'] },
          { name: 'Specificity', type: 'scatter', x: [0.1, 0.5, 0.9], y: [0.161, 0.859, 0.984] },
        ],
        layout: { title: { text: 'Cutoff trades sensitivity against specificity' } },
      }),
      source: 'document',
      sourceRefs: ['p31.s2'],
      functions: [],
    },
    CUTOFF,
  ],
  [
    'three bullet numbers as bars, with new labels',
    bars('Share of stated outcome', ['Passengers died', 62], ['Crew died', 76], ['Disease occurs', 0.1]),
    TITANIC,
  ],
];
/** The boards that build on theirs: a formula the slide only describes, a vote with numbers of its own. */
const BUILDS: [string, BoardItem, string][] = [
  [
    'a formula for the slide’s idea, with the role of each term',
    {
      kind: 'formula',
      title: 'Probability from weighted features',
      latex: 'p = \\sigma(w^{\\top} x + b)',
      terms: [
        { latex: 'w^{\\top} x', label: 'weighted sum of the features' },
        { latex: 'b', label: 'shifts the decision point' },
        { latex: '\\sigma', label: 'squashes it into probability' },
      ],
    },
    LOGISTIC,
  ],
  [
    'a program with ranked neighbours of its own',
    {
      kind: 'program',
      title: 'K-nearest vote among closest animals',
      objective: 'See ranked neighbors to a query animal and how the majority among K closest forms the prediction.',
      code: '({svg}) => svg.scene("")',
      parameters: [{ name: 'k', label: 'K neighbors', value: 3, min: 1, max: 5, step: 1 }],
      data: [{ name: 'distances', values: [1.2, 1.5, 2.1, 2.4, 3] }],
      source: 'illustrative',
      sourceRefs: ['p9.s1'],
    },
    KNN_PICTURES,
  ],
  [
    'the curve the slide describes in words, as a plot',
    {
      kind: 'plot',
      title: 'Illustrative logistic mapping',
      x: [-6, 6],
      y: [0, 1],
      x_label: 'weighted sum s',
      y_label: 'probability of event',
      curves: [{ expression: 'sigmoid(x)', label: 'p(s)' }],
      marks: [{ type: 'value', curve: 1, at: 0, label: 'p=0.5' }],
    } as BoardItem,
    LOGISTIC,
  ],
];

test('a board of the slide’s own numbers and words is flagged, with what it shares and how to fix it', () => {
  for (const [name, board, printed] of COPIES) {
    const [problem] = slideCopyProblems(board, printed);
    // The bars that redraw a slide share nearly all of what they print; a plot of its results and one more point, most.
    assert.ok(share(board, printed) >= COPY_SHARE, `${name}: ${share(board, printed)}`);
    assert.match(
      problem,
      /^the board copies the slide: \d+ of its \d+ words and numbers \(.+\) are printed on the slide/,
      name,
    );
    assert.match(
      problem,
      /Show what the slide leaves out instead: the mechanism behind its picture, a worked case/,
      name,
    );
  }
  assert.match(
    slideCopyProblems(COPIES[0][1], TITANIC)[0],
    /8 of its 9 words and numbers \(predictor, accuracy, predict, died, passengers, ...\)/,
  );
  // The saved tour had 7 boards, a run of the same deck 5: 8 of the 12 redraw their slide.
  assert.equal(COPIES.length, 6);
});

test('a board that builds on its slide is let be, whatever words of the slide it uses', () => {
  for (const [name, board, printed] of BUILDS) {
    assert.deepEqual(slideCopyProblems(board, printed), [], name);
    assert.ok(share(board, printed) < 0.5, `${name}: ${share(board, printed)}`);
  }
  // A worked case that names the slide’s own stations but brings numbers of its own: a value the slide does not print is new.
  const station =
    'Zellatmung\nGlykolyse im Cytoplasma\nCitratzyklus in der Matrix\nAtmungskette an der inneren Membran';
  const atp = bars('ATP pro Glucose (illustrativ)', ['Glykolyse', 2], ['Citratzyklus', 2], ['Atmungskette', 26]);
  assert.deepEqual(slideCopyProblems(atp, station), []);
});

test('the copies of other decks are flagged in English and German: bullets as boxes, a table as bars', () => {
  const search =
    'Binary search\nCompare the middle element with the target\nDiscard the half that cannot hold it\nRepeat on the remaining half';
  const steps = flow('Binary search steps', 'Compare middle element', 'Discard half', 'Repeat remaining half');
  assert.equal(slideCopyProblems(steps, search).length, 1);
  // The same method as a trace on numbers of its own says what the slide leaves out.
  const trace = flow(
    'Finding 23 in ten numbers',
    'mid is 16, too small',
    'low moves to 6',
    'mid is 38, too big',
    'high moves to 6',
    'found at index 6',
  );
  assert.deepEqual(slideCopyProblems(trace, search), []);
  const tabelle = `Quartalszahlen
Umsatz 2023: 4,2 Mio. Euro
Umsatz 2024: 5,1 Mio. Euro
Marge 2024: 12,5 Prozent`;
  const copy = bars('Umsatz in Mio. Euro', ['Umsatz 2023', 4.2], ['Umsatz 2024', 5.1], ['Marge 2024', 12.5]);
  assert.equal(
    slideCopyProblems({ ...copy, title: 'Umsatz und Marge 2024 in Mio. Euro' } as BoardItem, tabelle).length,
    1,
  );
  // A percentage the slide prints as a share is the same value; the growth the slide leaves out is new.
  const growth = bars('Wachstum 2023 bis 2024 (Prozent)', ['Umsatz', 21.4], ['Marge', 3.1], ['Kosten', 18.6]);
  assert.deepEqual(slideCopyProblems(growth, tabelle), []);
});

test('what the check cannot judge it lets be: a slide that is a picture, a board with few words, a rounded value', () => {
  // The flow of the saved tour that redraws two picture slides ("Leave-one-out", "Repeated Random Subsampling"): the
  // pictures are images, so only the titles are printed and the board shares two words with them.
  const pictures = 'Testing Methodology Matters\nLeave-one-out\nRepeated Random Subsampling';
  const loop = flow(
    'Two repeated evaluation paths',
    'Passenger data',
    'Hold one out',
    'Random split',
    'Score trial',
    'Average scores',
  );
  assert.deepEqual(slideCopyProblems(loop, pictures), []);
  // Fewer than MIN_MARKS words and numbers say too little: three words of five are the slide's.
  const small = flow('Stations of respiration', 'Glycolysis', 'Krebs cycle');
  assert.ok(copyShare(slideCopy(small, 'Glycolysis\nKrebs cycle\nElectron chain')).marks < MIN_MARKS);
  assert.deepEqual(slideCopyProblems(small, 'Glycolysis\nKrebs cycle\nElectron chain'), []);
  // 0.859 is not 0.9 (the roundings a narration says are no copy); 86 percent is the same value as 0.86.
  const point = slideCopy(
    scatter('Cutoff', 'specificity', 'sensitivity', ['p', 0.859, 0.719]),
    'cutoff p = 0.9, 86% sure',
  );
  assert.ok(point.values.fresh.includes('0.859') && point.values.fresh.includes('0.719'));
  assert.ok(slideCopy(scatter('Cutoff', 'a', 'b', ['p', 0.86, 0.5]), 'a rate of 86%').values.copied.includes('0.86'));
  // A single digit weighs as much as a word, a number that tells something as three: the counts of a bullet as bars are
  // the bullet again, and votes the slide does not print are the board’s own.
  const votes = slideCopy(bars('Votes', ['Yes', 2], ['No', 1]), 'Votes among 3 neighbours');
  assert.ok(votes.values.fresh.includes('2') && votes.values.fresh.includes('1'));
});

test('the slide’s numbers as bars are a copy even when they are single digits; a worked example is a copy only if no frame adds', () => {
  const cycle = 'Citratzyklus\nPro Umlauf entstehen 3 NADH, 1 FADH2 und 1 ATP\nPro Glucose läuft der Zyklus zweimal';
  const counts = bars(
    'Illustrative Ausbeute ein Umlauf',
    ['NADH Moleküle', 3],
    ['FADH2 Moleküle', 1],
    ['ATP Moleküle', 1],
  );
  assert.equal(slideCopyProblems(counts, cycle).length, 1);
  const printed =
    'Results\nInsertion sort took 4.2 seconds on 100000 items\nMerge sort took 0.3 seconds on 100000 items';
  const frame = (...labels: string[]) => ({ item: flow('Insertion sort and merge sort seconds', ...labels) });
  const same = [
    frame('Insertion sort 4.2', 'Merge sort 0.3', 'Seconds items'),
    frame('Merge sort 0.3', 'Insertion sort 4.2', 'Items seconds'),
  ];
  assert.match(
    exampleCopyProblems(same, printed)[0],
    /^the worked example copies the slide: its frames show only words and numbers the slide prints/,
  );
  // The same frames with a ratio they work out (4.2 / 0.3 is 14, which the slide does not print) build on the slide.
  const works = [same[0], frame('Insertion sort 4.2', 'Merge sort 0.3', 'Ratio 14')];
  assert.deepEqual(exampleCopyProblems(works, printed), []);
  assert.deepEqual(exampleCopyProblems([], printed), []);
});

test('a board that failed its own checks is judged by what the model wrote, so that one repair names every fault', () => {
  const [, board, printed] = COPIES[1];
  const failed = { item: null, problems: ['bar 1: the value is not a number'] };
  const checked = copyCheck(failed, { kind: 'bars', value: board }, printed);
  assert.equal(checked.item, null);
  assert.equal(checked.problems.length, 2);
  assert.match(checked.problems[1], /^the board copies the slide/);
  // A board that passes stays; a board of a step that is no slide step is not held to a slide.
  const passed = { item: board, problems: [] };
  assert.equal(copyCheck(passed, { kind: 'bars', value: board }, undefined), passed);
  assert.equal(copyCheck(passed, { kind: 'bars', value: board }, printed).item, null);
  // An authored board that is missing its data, or whose figure is no JSON, is read as far as it goes.
  const bare = { kind: 'program', title: 'Votes among the closest animals', objective: 'x', code: 'x' };
  assert.deepEqual(copyCheck({ item: null, problems: ['p'] }, { kind: 'program', value: bare }, printed).problems, [
    'p',
  ]);
  const broken = { kind: 'plotly', title: 'Sensitivity and specificity', figure: '{"data": 3}', objective: 'x' };
  assert.deepEqual(copyCheck({ item: null, problems: ['p'] }, { kind: 'plotly', value: broken }, printed).problems, [
    'p',
  ]);
  // No item and no problem is a model that drew nothing.
  assert.deepEqual(copyCheck({ item: null, problems: [] }, { kind: 'bars', value: undefined }, printed).problems, []);
});

test('the slide’s text is its titles, bullets, table cells and the text inside its figures, never its footer', () => {
  const block = (id: string, page: number, type: string, text: string) => ({
    id,
    page,
    type,
    text,
    bbox: [0, 0, 1, 1],
    sentences: [],
  });
  const doc = {
    blocks: [
      block('a', 3, 'heading', 'Heap sort'),
      block('b', 3, 'paragraph', 'Build a max heap'),
      block('c', 3, 'figure_text', 'swap root with last'),
      block('d', 3, 'table_text', 'comparisons 12'),
      block('e', 3, 'header_footer', 'Lecture 7'),
      block('f', 4, 'paragraph', 'Another slide'),
    ],
  } as unknown as Doc;
  const text = slidePrinted({ slides: [3] } as Beat, doc);
  assert.equal(text, 'Heap sort\nBuild a max heap\nswap root with last\ncomparisons 12');
});

test('the opening that announces the slides is asked to go, in the languages of the harness', () => {
  for (const say of [
    'These slides turn distance into a classifier.',
    'This slide introduces the model.',
    'Diese Folien zeigen, wie der Algorithmus arbeitet.',
    'Die Folie erklärt die Regel.',
    'Ces diapositives montrent la méthode.',
    'Estas diapositivas muestran el método.',
    'Slides 4 and 5 give the idea.',
    'The slides then move on to cost.',
  ])
    assert.equal(slideOpeningProblems(say).length, 1, say);
  for (const say of [
    'A nearest neighbour copies the label of the closest example, which is why one noisy point can decide everything.',
    'After slide 4, distance becomes a classifier, because the closest stored example donates its label.',
    'Der Algorithmus teilt die Liste, sortiert beide Hälften und mischt sie wieder, weshalb die Laufzeit langsamer wächst.',
    'Why does the slide matter? Because the slide-level view hides the cost.',
  ])
    assert.deepEqual(slideOpeningProblems(say), [], say);
});

test('the plan and the direction tasks of a deck tell the board to build on the slide, and no other tour is touched', () => {
  const plan = visualPlanTask('en-US', { deck: true });
  assert.match(plan, /The side board is not a second copy of a slide\. It builds on it\./);
  assert.match(plan, /the mechanism behind the slide's picture/);
  assert.match(plan, /a worked case with numbers of your own, marked illustrative/);
  assert.match(plan, /Never plan a board that redraws a slide/);
  assert.match(plan, /- program: /, 'every kind stays offered');
  assert.ok(!/MIT|6\.0002|classification|k-NN|Titanic/i.test(plan), 'it names no deck');
  assert.match(visualPlanTask('en-US', { deck: true, adaptive: true }), /There is no quota of boards or kinds/);
  assert.match(visualPlanTask('en-US', { deck: true }), /Each kind once in the tour/);
  // Papers, sheets and the other kinds of document keep their tasks.
  assert.ok(!/redraws a slide/.test(visualPlanTask('en-US', {})));
  assert.ok(!/redraws a slide/.test(visualPlanTask('en-US', { sheet: true })));
  const options = { actions: ['highlight', 'board_focus'], board: 'bars' as const, words: 80 };
  const slides = directTask('en-US', 'BRIEF', { ...options, slides: true });
  assert.match(
    slides,
    /BOARD OF A SLIDE: the learner sees the slide, so the board never redraws its bullets, table, plot or picture/,
  );
  assert.match(slides, /never with "these slides" or "this slide"/);
  assert.ok(!/BOARD OF A SLIDE/.test(directTask('en-US', 'BRIEF', options)));
  // A slide step that draws no board is not told about one.
  assert.ok(
    !/BOARD OF A SLIDE/.test(directTask('en-US', 'BRIEF', { ...options, actions: ['highlight'], slides: true })),
  );
  assert.ok(!/BOARD OF A SLIDE/.test(directTask('en-US', 'BRIEF', { ...options, bare: true, slides: true })));
});

test('a table on a slide is on screen already: the plan never adds a chart of its own numbers, as it does for a paper', () => {
  const table = {
    id: 'tab-results',
    kind: 'table',
    number: '1',
    page: 2,
    bbox: [0, 160, 400, 300],
    caption: 'Measured savings and cost',
    image: 'figures/table.png',
    panels: [],
    referenced_by: [],
    grid: {
      confidence: 'high',
      method: 'spans',
      label_header: 'Method',
      columns: [
        { name: 'Water saved (%)', kind: 'number', better: 'up' },
        { name: 'Cost (EUR)', kind: 'number', better: 'down' },
      ],
      rows: [
        {
          label: 'Fixed',
          cells: [
            { text: '0', value: 0 },
            { text: '480', value: 480 },
          ],
        },
        {
          label: 'Timer',
          cells: [
            { text: '12.5', value: 12.5 },
            { text: '430', value: 430 },
          ],
        },
        {
          label: 'Probes',
          cells: [
            { text: '31.4', value: 31.4 },
            { text: '392.5', value: 392.5 },
          ],
        },
      ],
    },
  };
  const doc = { ...base, figures: [...base.figures, table] } as unknown as Doc;
  const step: Beat = {
    id: 'step-1',
    kind: 'figure',
    arc: 'a',
    point: 'Compare the savings.',
    target: table.id,
    evidence: [],
  };
  const none = new Map([[step.id, { visual: 'none' as const, idea: '', data: '' }]]);
  assert.equal(
    withTableBoard(none, [step], doc).plan.get(step.id)?.table,
    table.id,
    'a paper’s table step gets its board',
  );
  const onSlide = withTableBoard(none, [{ ...step, slides: [2] }], doc);
  assert.equal(onSlide.plan.get(step.id)?.visual, 'none');
  assert.deepEqual(onSlide.adjusted, []);
});
