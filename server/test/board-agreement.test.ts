import test from 'node:test';
import assert from 'node:assert/strict';
import type { BoardItem, Step } from '../../shared/paper';
import { HarnessTourGenerator } from './harness-fixture';
import { EXPLAIN, about, card, direct, doc, input, planFor, provider, settings, type Request } from './plan-fixture';
import { FITTING, SWAPPED, UNRELATED } from './board-agreement-pairs';
import { planBeats } from '../src/harness/beats';
import { checkBoard } from '../src/harness/board';
import {
  MIN_BOARD_WORDS,
  MIN_SOURCED,
  agreement,
  agreementCheck,
  agreementProblems,
  boardTerms,
  sameTerm,
  spokenTerms,
} from '../src/harness/board-agreement';
import { beatBrief, beatTargets, cleanDirection } from '../src/harness/direct';
import type { StepVisual } from '../src/harness/visual-plan';

// Whether a tour step's board shows what its narration says (board-agreement.ts): a board that shares no word, symbol or
// number with the narration is flagged, any other is let be. Real pairs from the live tours, and the step's repair and
// degrade (degrade.ts) with a scripted model (no network).

const beats = planBeats(card, doc, 'standard');
const method = beats.find((b) => b.id === 'method-1')!;
const steps = (tour: { chapters: { steps: Step[] }[] }) => tour.chapters.flatMap((c) => c.steps);

const formula = (latex: string, ...terms: [string, string][]): BoardItem => ({
  kind: 'formula',
  title: undefined,
  latex,
  terms: terms.map(([latex, label]) => ({ latex, label })),
});
const flow = (title: string, ...labels: string[]): BoardItem => ({
  kind: 'flow',
  title,
  nodes: labels.map((label, i) => ({ id: `node-${i + 1}`, label })),
  edges: [],
});
const bars = (title: string, ...labels: string[]): BoardItem => ({
  kind: 'bars',
  title,
  bars: labels.map((label, i) => ({ label, value: 31.5 + i })),
});
const shapes = (title: string): BoardItem => ({
  kind: 'shapes',
  title,
  terms: [
    { kind: 'matrix', name: 'X', rows: 'n', cols: 'd_{model}' },
    { kind: 'op', op: 'times' },
    { kind: 'matrix', name: 'W^Q_i', rows: 'd_{model}', cols: 'd_k' },
    { kind: 'op', op: 'equals' },
    { kind: 'matrix', name: 'Q_i', rows: 'n', cols: 'd_k' },
  ],
});
/** A narration of enough words, about the dose of water that a measurement sets. */
const DOSE = EXPLAIN;

// ------------------------------------------------------------------------------------------- real tours

test('the boards of the real tours that their narration fits are never flagged: English, German, every kind', () => {
  assert.ok(FITTING.length >= 20);
  for (const { name, say, board, source } of FITTING)
    assert.deepEqual(agreementProblems(say, board, { source }), [], name);
});

test('a board the narration paraphrases is not flagged, whatever of its own words it leaves out', () => {
  // Four classifier results on accuracy and sensitivity, narrated as "which classifier comes out ahead": one word of five.
  const scatter = FITTING.find((p) => p.name.startsWith('scatter: two classifiers'))!;
  const { said, unsaid } = agreement(scatter.say, scatter.board);
  assert.ok(said.length >= 1 && unsaid.length >= 3, `${said} | ${unsaid}`);
  assert.deepEqual(agreementProblems(scatter.say, scatter.board), []);
  // A heatmap of animals narrated as the reptile class: the rows are named by their class, not one by one.
  const animals = FITTING.find((p) => p.name.startsWith('heatmap: animals'))!;
  assert.deepEqual(agreementProblems(animals.say, animals.board), []);
  // A scene of a cheap simulator drawn as detailed fish and simple physics, a flow of causes narrated as what blocks
  // learning: one word in common is agreement, however many words the board has.
  for (const name of ['scene: a cheap simulator', 'flow: causes of a tail shape']) {
    const pair = FITTING.find((p) => p.name.startsWith(name))!;
    const { said, unsaid } = agreement(pair.say, pair.board);
    assert.ok(said.length === 1 && unsaid.length >= 6, `${name}: ${said} | ${unsaid}`);
    assert.deepEqual(agreementProblems(pair.say, pair.board), [], name);
  }
});

test('a board whose words the narration never says is flagged, with what it shows and how to fix it', () => {
  assert.equal(UNRELATED.length, 3);
  for (const { name, say, board, source } of UNRELATED) {
    const [problem] = agreementProblems(say, board, { source });
    assert.ok(problem, name);
    assert.match(problem, /^the narration never speaks of what this board shows \("/, name);
    assert.ok(problem.includes(`"${board.title}"`), name);
    assert.match(problem, /Keep this step's point: redraw the board so that it shows it, or leave the board out/, name);
    // The values of the board are no evidence either: neither narration says one.
    assert.deepEqual(agreement(say, board).said, [], name);
  }
  const fish = UNRELATED.find((p) => p.board.title === 'Arrivals within 5 cm')!;
  assert.match(agreementProblems(fish.say, fish.board)[0], /arrivals, cm, count/);
});

test('a narration may paraphrase the sentences the step points at, which the board prints', () => {
  // "Strongest delay" and "average" for a board of the best-lag peak against the window mean, as the sentence calls them.
  const plot = FITTING.find((p) => p.name.startsWith('plot: a peak against a mean'))!;
  assert.deepEqual(agreement(plot.say, plot.board).said, []);
  assert.equal(agreementProblems(plot.say, plot.board).length, 1, 'by the narration alone it is a mismatch');
  assert.deepEqual(agreementProblems(plot.say, plot.board, { source: plot.source }), []);
  // One word in the source is a word every sentence of a paper may share; the mismatches of the real tours keep theirs.
  const fish = UNRELATED.find((p) => p.board.title === 'Arrivals within 5 cm')!;
  assert.equal(MIN_SOURCED, 2);
  assert.equal(agreementProblems(fish.say, fish.board, { source: fish.source }).length, 1);
  assert.deepEqual(agreementProblems(fish.say, fish.board, { source: `${fish.source} Arrivals were counted.` }), []);
  assert.deepEqual(agreementProblems(fish.say, fish.board, { source: `${fish.source} Arrivals within 5 cm.` }), []);
});

test('a board with the narration of another step of the same tour is flagged, though they share the paper’s words', () => {
  for (const { name, say, board } of SWAPPED) {
    const { said } = agreement(say, board);
    assert.ok(agreementProblems(say, board).length, `${name} (${said.join(', ')} said)`);
  }
});

// ------------------------------------------------------------------------------------------- a step on an equation

/** The narrations of a formula step and a method step that explain the softmax of scaled dot-product attention. */
const SOFTMAX = [
  FITTING.find((p) => p.name.startsWith('formula: scaled dot-product'))!.say,
  FITTING.find((p) => p.name.startsWith('flow: multi-head scaled attention'))!.say,
];
const matrix = (name: string, rows: string, cols: string) => ({ kind: 'matrix' as const, name, rows, cols });
const op = (name: 'times' | 'equals', label?: string) => ({ kind: 'op' as const, op: name, label });

test('a shapes board of an equation step is judged by words and symbols it shares, not by the operations it shows', () => {
  // Shapes of the scores, titled with the narration's own words: no operation word, and matrix names of two characters.
  const scores: BoardItem = {
    kind: 'shapes',
    title: 'Compatibility of each query with all keys',
    terms: [matrix('Q', 'n', 'd_k'), op('times'), matrix('K^T', 'd_k', 'n'), op('equals'), matrix('S', 'n', 'n')],
  };
  assert.deepEqual(agreementProblems(SOFTMAX[0], scores), []);
  // The feed-forward step: the board applies ReLU, the narration says "max of zero and x W one".
  const ffn = FITTING.find((p) => p.name.startsWith('formula: the feed-forward'))!;
  const relu: BoardItem = {
    kind: 'shapes',
    title: 'Hidden layer shapes',
    terms: [matrix('x', 'n', 'd'), op('times'), matrix('W_1', 'd', 'h'), op('equals'), matrix('h', 'n', 'h')],
  };
  assert.deepEqual(agreementProblems(ffn.say, relu), []);
  // A projection board under the softmax narration shares the word "query" or none: only a board with nothing in
  // common is flagged, and a board that shares a word is not, whatever it explains.
  assert.deepEqual(agreementProblems(SOFTMAX[0], shapes('Queries entering the softmax')), []);
  assert.deepEqual(agreementProblems(SOFTMAX[0], shapes('Query projection per head')), []);
});

test('a board of an equation step that shares nothing with the narration is flagged', () => {
  const [problem] = agreementProblems(SOFTMAX[0], shapes('Projection dimensions per head'));
  assert.match(problem, /^the narration never speaks of what this board shows \("Projection dimensions per head": /);
});

// ------------------------------------------------------------------------------------------- what a board prints

test('a formula prints words, Greek letters and numbers; the letters of its variables are no terms', () => {
  const terms = boardTerms(
    formula(
      '\\mathrm{Attention}(Q, K) = \\sigma_{shared}^2 \\cdot \\sqrt{d_k} + 0.5 \\text{ per head}',
      ['\\sqrt{d_k}', 'scale preventing tiny gradients'],
      ['\\alpha', ''],
    ),
  );
  assert.deepEqual(terms.core.slice(0, 3).sort(), ['attention', 'head', 'shared']);
  assert.ok(terms.core.includes('gradients') && terms.core.includes('scale'));
  assert.ok(!terms.core.some((w) => w.length < 3), 'single letters are not words');
  // An operation is an item, named in any of the languages a narration is in: it counts when said, and is never missed.
  for (const name of ['sqrt', 'root', 'wurzel', 'racine', 'sigma', 'alpha'])
    assert.ok(terms.items.includes(name), name);
  assert.deepEqual(terms.numbers, ['2', '0.5']);
  // A function written without its backslash is an operation too.
  assert.deepEqual(boardTerms(formula('y = log(x) + softmax(z)')).items.slice(0, 2), ['log', 'ln']);
  assert.deepEqual(boardTerms(formula('y = log(x) + softmax(z)')).core.slice(-1), ['softmax']);
});

test('the words of every kind of board: parts and axes name it, the items it compares are a bonus', () => {
  assert.deepEqual(boardTerms(flow('Possession needs a court', 'Rent arrears', 'Notice served')).core, [
    'possession',
    'needs',
    'court',
    'rent',
    'arrears',
    'notice',
    'served',
  ]);
  const chart = boardTerms({ ...bars('Deposit cap', 'Standard', 'Premium'), unit: 'pounds' } as BoardItem);
  assert.deepEqual(chart.core, ['deposit', 'cap', 'pounds']);
  assert.deepEqual(chart.items, ['standard', 'premium']);
  const scatter = boardTerms({
    kind: 'scatter',
    title: 'Quality against cost',
    x_label: 'training cost (FLOPs)',
    y_label: 'BLEU',
    points: [{ label: 'Transformer', x: 1, y: 2, series: 'big' }],
    source: 'document',
  } as BoardItem);
  assert.deepEqual(scatter.core, ['quality', 'against', 'cost', 'training', 'cost', 'flops', 'bleu']);
  assert.deepEqual(scatter.items, ['transformer', 'big']);
  // Matrix dimensions are symbols and numbers: what the narration says of them counts, and nothing is missed or shown.
  const dims = boardTerms(shapes('Projection'));
  assert.deepEqual([dims.core, dims.sizes], [['projection'], ['model', 'model']]);
  assert.deepEqual(dims.numbers, []);
  const timeline = boardTerms({
    kind: 'timeline',
    title: 'Withdrawal',
    unit: 'day',
    source: 'document',
    anchor: { label: 'Acceptance' },
    events: [
      { label: 'Notice sent', position: 5 },
      { label: 'Refund due', position: 19, deadline: true },
    ],
    spans: [{ label: 'Cooling-off period', from: 'Acceptance', start: 0, end: 14 }],
  } as BoardItem);
  assert.deepEqual(timeline.core, ['withdrawal', 'acceptance', 'notice', 'sent', 'refund', 'due', 'cooling', 'period']);
  const grid = boardTerms({
    kind: 'heatmap',
    title: 'Distances',
    rows: ['cobra', 'boa'],
    cols: ['chicken'],
    values: [[1], [2]],
    source: 'document',
    unit: 'cm',
  } as BoardItem);
  assert.deepEqual(
    [grid.core, grid.items],
    [
      ['distances', 'cm'],
      ['cobra', 'boa', 'chicken'],
    ],
  );
  const scene = boardTerms({
    kind: 'scene',
    title: 'Complex plane',
    objects: [
      { id: 'a', type: 'text', x: 0, y: 0, w: 1, h: 1, text: 'Real axis' },
      { id: 'b', type: 'math', x: 0, y: 0, w: 1, h: 1, text: '\\lambda z' },
    ],
  } as BoardItem);
  assert.deepEqual([scene.core, scene.items], [['complex', 'plane', 'real', 'axis'], ['lambda']]);
  const spread = boardTerms({
    kind: 'distribution',
    title: 'Calls',
    x_label: 'calls per minute',
    source: 'document',
    dists: [{ family: 'poisson', label: 'Baseline', mean: 4, categories: ['busy'] }],
  } as BoardItem);
  assert.deepEqual(
    [spread.core, spread.items],
    [
      ['calls', 'calls', 'minute'],
      ['baseline', 'busy'],
    ],
  );
});

test('the numbers of a data board are what its narration says: values as printed, rounded or as percentages', () => {
  const numbers = (item: BoardItem) => boardTerms(item).numbers;
  const latency: BoardItem = {
    kind: 'bars',
    title: 'Latency per request',
    unit: 'ms',
    bars: [
      { label: 'Without cache', value: 120 },
      { label: 'With cache', value: 40 },
    ],
  };
  assert.deepEqual(numbers(latency), ['120', '40']);
  // A fraction is also said as a percentage and rounded, but a derived single digit is no evidence.
  const share = (value: number): BoardItem =>
    ({ kind: 'bars', title: 'Share', bars: [{ label: 'a', value }] }) as BoardItem;
  assert.deepEqual(numbers(share(0.96)), ['0.96', '96']);
  assert.deepEqual(numbers(share(0.804)), ['0.804', '0.8', '80', '80.4']);
  assert.deepEqual(numbers(share(26.36)), ['26.36', '26', '26.4']);
  assert.deepEqual(numbers(share(4)), ['4'], 'a single digit as printed counts: it is the board’s value');
  // Heatmap cells, scatter points, timeline positions and the parameters of a distribution are printed values too.
  const heat = { kind: 'heatmap', title: 'Distances', rows: ['a', 'b'], cols: ['c'], values: [[1.414], [2.236]] };
  assert.ok(numbers(heat as BoardItem).includes('1.414'));
  const scatter = { kind: 'scatter', x_label: 'cost', y_label: 'BLEU', points: [{ label: 'big', x: 3.5, y: 28.4 }] };
  assert.deepEqual(numbers(scatter as BoardItem), ['3.5', '28.4', '28']);
  const dist = {
    kind: 'distribution',
    x_label: 'calls',
    dists: [{ family: 'normal', label: 'now', mean: 0.21, sd: 0.13 }],
  };
  assert.deepEqual(numbers(dist as BoardItem), ['0.21', '0.2', '21', '0.13', '0.1', '13']);
  const timeline = {
    kind: 'timeline',
    unit: 'day',
    anchor: { label: 'Start' },
    events: [{ label: 'Due', position: 14, offset: 14 }],
    spans: [{ label: 'Window', from: 'Start', start: 0, end: 14, length: 14 }],
  };
  assert.ok(numbers(timeline as BoardItem).includes('14'));
  // The numbers of a title or a label count too: "within 5 cm" is said "within five centimetres".
  assert.deepEqual(numbers(bars('Arrivals within 25 cm', 'static')).slice(0, 1), ['25']);
  assert.ok(numbers(bars('Arrivals within 5 cm', 'static')).includes('5'));
  // The number words of a title are numbers, not names: "five-hinge" names a hinge, and "one" is the number 1.
  const head = boardTerms(shapes('One head, five-hinge'));
  assert.deepEqual(head.core, ['head', 'hinge']);
  assert.ok(head.numbers.includes('5') && head.numbers.includes('1'));
  // The dimensions of a shapes board are its data, but a dimension of 1 only makes a vector.
  const sizes = boardTerms({
    kind: 'shapes',
    title: 'Observation to gait parameters',
    terms: [
      { kind: 'matrix', name: 'o^T', rows: '1', cols: '24' },
      { kind: 'op', op: 'times' },
      { kind: 'matrix', name: 'W_{out}', rows: '24', cols: '6' },
      { kind: 'op', op: 'equals' },
      { kind: 'matrix', name: 'u^T', rows: '1', cols: '6' },
    ],
  });
  assert.deepEqual(sizes.numbers, ['24', '24', '6', '6']);
});

test('a results board is judged by the values and the unit its narration says, though it paraphrases the title', () => {
  const latency: BoardItem = {
    kind: 'bars',
    title: 'Latency per request',
    unit: 'ms',
    bars: [
      { label: 'before', value: 120 },
      { label: 'after', value: 40 },
    ],
  };
  // Written to probe the check, not taken from a tour: the narration says the unit in full and the values in digits.
  const say =
    'Once lookups are kept in memory, each call waits about 40 milliseconds instead of 120, because repeated reads never reach the disk again and the slow path is skipped entirely.';
  assert.deepEqual(agreementProblems(say, latency), []);
  assert.deepEqual(agreement(say, latency).said, ['ms', '120', '40']);
  // The values said in words, the unit not at all: still the board the narration is about.
  const spelled =
    'Once lookups are kept in memory each call takes forty where it took one hundred twenty before, because repeated reads never reach the disk again and the slow path is skipped entirely.';
  assert.deepEqual(agreementProblems(spelled, latency), []);
  // Fractions said as percentages, a German decimal comma, and a unit abbreviation said in German.
  const accuracy = {
    kind: 'bars',
    title: 'Trefferquote',
    unit: '%',
    bars: [
      { label: 'neu', value: 0.804 },
      { label: 'alt', value: 0.62 },
    ],
  };
  const german =
    'Das neue Verfahren liegt bei achtzig Komma vier Prozent, das alte nur bei zweiundsechzig, weil lange Sätze früher regelmäßig scheiterten und jetzt gelesen werden.';
  assert.deepEqual(agreementProblems(german, accuracy as BoardItem), []);
  assert.ok(agreement(german, accuracy as BoardItem).said.includes('80.4'));
  // The unit spoken in full is the unit: 5 cm is five centimetres or fünf Zentimeter.
  const reach: BoardItem = {
    kind: 'bars',
    title: 'Reach',
    unit: 'cm',
    bars: [
      { label: 'static', value: 11 },
      { label: 'moved', value: 5 },
    ],
  };
  const said = agreement('The arm covers eleven centimetres when it is still, and the bar goes out.', reach).said;
  assert.deepEqual(said, ['cm', '11']);
  assert.ok(
    agreement('Der Arm kommt elf Zentimeter weit, wenn er stillsteht und sich nicht bewegt.', reach).said.includes(
      'cm',
    ),
  );
});

// ------------------------------------------------------------------------------------------- what a narration says

test('a narration says its words, the Greek letters it names, the numbers it spells, and a name read letter by letter', () => {
  const spoken = spokenTerms('Take σ and Omega, then F F N of x: twenty is 0,5 times drei, zwölf and 28.4.');
  assert.ok(spoken.words.includes('sigma') && spoken.words.includes('omega'));
  assert.ok(spoken.words.includes('ffn'), 'letters read one by one make the name');
  assert.ok(spoken.words.includes('times'));
  assert.deepEqual([...spoken.numbers].sort(), ['0.5', '12', '20', '28.4', '3']);
});

test('numbers spelled out in English or German are the digits a board prints, fractions and decimals included', () => {
  const numbers = (say: string) => spokenTerms(say).numbers;
  assert.ok(numbers('twenty eight point four BLEU').has('28.4'));
  assert.ok(numbers('zero point nine eight against zero point zero two').has('0.98'));
  assert.ok(numbers('zero point nine eight against zero point zero two').has('0.02'));
  assert.ok(numbers('one hundred and five, then two hundred twenty one').has('105'));
  assert.ok(numbers('one hundred and five, then two hundred twenty one').has('221'));
  assert.ok(numbers('a third of it, and two thirds').has('3'));
  // German: compounds read unit first, fractions are nouns (also in the dative), Komma is the decimal point.
  const german = numbers(
    'minus neunzehn Siebtel und neunundzwanzig Siebtel, einundzwanzig, zwei Komma fünf, drei Dritteln',
  );
  for (const n of ['19', '7', '29', '21', '2.5', '3']) assert.ok(german.has(n), n);
  assert.ok(numbers('dreißig Prozent').has('30'));
  assert.ok(!numbers('Wir setzen das Ergebnis ein').size);
});

test('hundreds and thousands are read in digits, words and both languages, with their separators', () => {
  const numbers = (say: string) => spokenTerms(say).numbers;
  for (const [say, n] of [
    ['two thousand five hundred requests', '2500'],
    ['twenty thousand', '20000'],
    ['a thousand and one nights', '1001'],
    ['a hundred and five', '105'],
    ['hundertfünf Fälle', '105'],
    ['zweihundert Euro', '200'],
    ['dreihundertneunundzwanzig', '329'],
    ['tausend Zeichen', '1000'],
    ['zweitausendfünfhundert Zeichen', '2500'],
    ['einhundert', '100'],
    ['1,000 requests', '1000'],
    ['1,250,000 requests', '1250000'],
    ['1.000 Anfragen', '1000'],
    ['über 12.500 Anfragen', '12500'],
    ['1\u00a0000 requests, with a no-break space', '1000'],
    ['0,5 Prozent', '0.5'],
  ])
    assert.ok(numbers(say).has(n), `${say}: ${[...numbers(say)]}`);
  // A decimal comma is no thousands mark.
  assert.ok(!numbers('0,5 Prozent').has('5'));
  assert.ok(!numbers('hundertste Wiederholung').has('100'));
});

test('two words are one term when they stem alike, share their start, or one is part of a compound', () => {
  for (const [a, b] of [
    ['keys', 'key'],
    ['queries', 'query'],
    ['scale', 'scaling'],
    ['normalization', 'normalizing'],
    ['Eliminiere', 'Elimination'],
    ['Matrix', 'Matrixprodukt'],
    ['Gleichung', 'Gleichungen'],
    ['lag', 'lagged'],
    ['Größe', 'grosse'],
    ['log', 'logarithm'],
    ['exp', 'exponential'],
    ['root', 'Wurzel'],
    ['limit', 'Grenzwert'],
    ['sqrt', 'racine'],
    ['sum', 'Summe'],
  ])
    assert.ok(sameTerm(a, b), `${a} ${b}`);
  for (const [a, b] of [
    ['head', 'heal'],
    ['model', 'modular'],
    ['key', 'kettle'],
    ['dose', 'water'],
    ['of', 'on'],
    ['root', 'rooster'],
  ])
    assert.ok(!sameTerm(a, b), `${a} ${b}`);
});

// ------------------------------------------------------------------------------------------- when a board is flagged

test('a board that names enough words is flagged when none is said, and no number', () => {
  assert.equal(MIN_BOARD_WORDS, 3);
  // Three words, none said: flagged. Two words, none said: too little to tell a paraphrase from a mismatch.
  assert.equal(agreementProblems(DOSE, flow('Valve control', 'Probe reading', 'Valve opens')).length, 1);
  assert.deepEqual(agreementProblems(DOSE, bars('Valve control', 'one', 'two')), []);
  // One word in common (dose) is agreement, however many are not said: a paraphrase of the rest is not a mismatch.
  const many = flow('Dose logic', 'Probe reading', 'Valve opens', 'Tank', 'Switch', 'Relay');
  const { said, unsaid } = agreement(DOSE, many);
  assert.deepEqual(said, ['dose']);
  assert.ok(unsaid.length >= 8);
  assert.deepEqual(agreementProblems(DOSE, many), []);
  // A number of the board that the narration says is agreement too: 31.5 percent less water.
  const data = { ...bars('Valve control logic', 'a', 'b'), unit: 'cycles' } as BoardItem;
  const percent =
    'Across forty trees the network used 31.5 percent less water than the fixed schedule, so the saving is large.';
  assert.deepEqual(agreement(percent, data).said, ['31.5']);
  assert.deepEqual(agreementProblems(percent, data), []);
  assert.equal(agreementProblems(percent.replace('31.5', '30'), data).length, 1);
});

test('numbers, Greek letters and names of items that the narration says count as agreement, and generic words do not', () => {
  const say =
    'The chance is 0.99 for one group and 0.02 for the other, as the testimony gives it before any prior is used.';
  const board = formula('P = 0.99 \\times 0.01', ['0.99', 'hit rate'], ['0.01', 'base rate']);
  assert.deepEqual(agreement(say, board).said, ['0.99']);
  assert.deepEqual(agreementProblems(say, board), []);
  // An illustrative bars board named only by a word every picture carries says nothing to compare.
  assert.deepEqual(agreement(say, bars('Illustrative values', 'value 1', 'value 2')).unsaid, []);
  // Items count when said and are never missed: the narration names a bar.
  assert.deepEqual(agreement(say, bars('Prior', 'testimony', 'harbour')).said, ['prior', 'testimony']);
  assert.deepEqual(agreement(say, bars('Prior', 'testimony', 'harbour')).unsaid, []);
});

test('a narration is judged only when it says enough and in a script whose words can be told apart', () => {
  const board = flow('Valve control', 'Probe reading', 'Valve opens');
  assert.equal(agreementProblems(DOSE, board).length, 1);
  assert.deepEqual(agreementProblems('A short remark about the soil.', board), []);
  // Chinese runs words together: no word-level check applies.
  const chinese =
    '每个探头每十分钟报告一次读数，控制器在读数低于阈值时打开最近的阀门，因此水量跟随土壤的实际需求而变化，浪费随之减少。';
  assert.deepEqual(agreementProblems(chinese, flow('阀门控制', '探头读数', '阀门打开')), []);
  // Cyrillic and German are judged like English: umlauts fold and compounds match.
  assert.deepEqual(
    agreementProblems(
      'Wir lösen die Gleichung durch Division, weil die Zahl invertierbar ist und die Probe die Lösung bestätigt.',
      formula('3x=5', ['3x=5', 'Gleichung'], ['x', 'Lösung durch Division']),
    ),
    [],
  );
});

test('the check turns a board that fails it into a failed check, and leaves the others alone', () => {
  const item = flow('Valve control', 'Probe reading', 'Valve opens');
  const raw = { kind: 'flow' as const, value: item };
  const checked = agreementCheck({ item, problems: [] }, DOSE, raw);
  assert.equal(checked.item, null);
  assert.equal(checked.problems.length, 1);
  const fitting = agreementCheck({ item, problems: [] }, `${DOSE} ${about({ flow: item })}`, raw);
  assert.equal(fitting.item, item);
  // A model that drew nothing is left alone, whatever its draft says.
  const none = { item: null, problems: [] };
  assert.equal(agreementCheck(none, DOSE, raw), none);
});

test('a board that fails its own checks is judged too, so that one repair turn names every fault', () => {
  // Two nodes where three are the least, and a title and labels of another subject than the narration.
  const raw = {
    title: 'Valve control',
    nodes: [
      { id: 'node-1', label: 'Probe reading' },
      { id: 'node-2', label: 'Valve opens' },
    ],
    edges: [],
  };
  const check = checkBoard('flow', raw);
  assert.equal(check.item, null);
  assert.ok(check.problems.length >= 1);
  const both = agreementCheck(check, DOSE, { kind: 'flow', value: raw });
  assert.equal(both.problems.length, check.problems.length + 1);
  assert.deepEqual(both.problems.slice(0, check.problems.length), check.problems);
  assert.match(both.problems.at(-1)!, /^the narration never speaks of what this board shows \("Valve control"/);
  // Junk does not throw, and a board of unreadable parts has nothing to compare.
  for (const value of [
    null,
    'flow',
    7,
    [],
    {},
    { nodes: [null, 3, { label: 5 }], title: 7 },
    { terms: 'no', bars: {} },
  ])
    assert.deepEqual(agreementCheck({ item: null, problems: ['bad'] }, DOSE, { kind: 'flow', value }).problems, [
      'bad',
    ]);
});

// ------------------------------------------------------------------------------------------- a step's direction

// A loop whose words neither the narration of the step (DOSE) nor the sentence it stands on (the probes and valves) say.
const loop = {
  title: 'Forecast rewrites the schedule',
  nodes: [
    { id: 'node-1', label: 'Forecast arrives' },
    { id: 'node-2', label: 'Scheduler delays' },
    { id: 'node-3', label: 'Timer resets' },
  ],
  edges: [
    { from: 'node-1', to: 'node-2' },
    { from: 'node-2', to: 'node-3' },
    { from: 'node-3', to: 'node-1' },
  ],
};
const planned: StepVisual = { visual: 'flow', idea: 'Show the loop.', data: '' };

test('a direction drops a board its narration is not about and says why; the narration and cues stay', () => {
  const ask = (say: string) =>
    cleanDirection(
      { plan: 'p', say, cues: [], flow: loop },
      method,
      beatTargets(method, doc, planned),
      false,
      planned,
    )!;
  const apart = ask(DOSE);
  assert.equal(apart.board, undefined);
  assert.equal(apart.say, DOSE);
  assert.equal(apart.boardProblems!.length, 1);
  assert.match(
    apart.boardProblems![0],
    /^flow: the narration never speaks of what this board shows \("Forecast rewrites the schedule"/,
  );
  const fitting = ask(`${DOSE} ${about({ flow: loop })}`);
  assert.equal(fitting.board?.kind, 'flow');
  assert.deepEqual(fitting.boardProblems, []);
  // The same narration beside a board that prints the words of the sentence the step stands on (the probes and valves of
  // p1.s3) is a paraphrase of that sentence, not a mismatch.
  const printed = {
    title: 'A reading reaches a valve',
    nodes: [
      { id: 'node-1', label: 'Probe reading' },
      { id: 'node-2', label: 'Controller' },
      { id: 'node-3', label: 'Valve opens' },
    ],
    edges: loop.edges,
  };
  const targets = beatTargets(method, doc, planned);
  assert.match(targets.source!, /probe reports a reading every ten minutes/);
  const paraphrased = cleanDirection(
    { plan: 'p', say: DOSE, cues: [], flow: printed },
    method,
    targets,
    false,
    planned,
  )!;
  assert.equal(paraphrased.board?.kind, 'flow');
  assert.deepEqual(paraphrased.boardProblems, []);
  // A step planned without a board draws none, and so has nothing to agree with.
  const none: StepVisual = { visual: 'none', idea: '', data: '' };
  assert.deepEqual(
    cleanDirection({ plan: 'p', say: DOSE, cues: [] }, method, beatTargets(method, doc, none), false, none)!
      .boardProblems,
    [],
  );
  assert.deepEqual(checkBoard('flow', loop).problems, [], 'the board itself is sound');
});

test('a board that also fails its own check is sent back with both faults at once, not one per turn', () => {
  const plan: StepVisual = { visual: 'shapes', idea: 'Show the sizes of the projection.', data: '' };
  const formulaBeat = { ...method, kind: 'formula' as const, target: 'eq1' };
  const targets = beatTargets(formulaBeat, doc, plan);
  const terms = (rows: string) => [
    matrix('X', 'n', 'D'),
    op('times'),
    matrix('W^Q_i', rows, 'd_k'),
    op('equals'),
    matrix('Q_i', 'n', 'd_k'),
  ];
  const ask = (shapes: unknown) =>
    cleanDirection({ plan: 'p', say: DOSE, cues: [], shapes }, formulaBeat, targets, false, plan)!;
  const projection = { title: 'Query projection per head', terms: terms('D') };
  assert.deepEqual(checkBoard('shapes', projection).problems, [], 'the board itself is sound');
  const apart = ask(projection);
  assert.equal(apart.board, undefined);
  assert.equal(apart.say, DOSE);
  assert.equal(apart.boardProblems!.length, 1);
  assert.match(apart.boardProblems![0], /^shapes: the narration never speaks of what this board shows/);
  const both = ask({ ...projection, terms: terms('m') }).boardProblems!;
  assert.ok(both.length >= 2, both.join(' | '));
  assert.ok(both.some((p) => /^shapes: the narration never speaks/.test(p)));
  assert.ok(both.some((p) => !/narration/.test(p)));
});

test('the brief tells a planned step that its board and its narration are one explanation, a step without a board nothing', () => {
  const line = /The board and "say" are one explanation: say what the board shows, with its title, labels and symbols/;
  assert.match(beatBrief(method, doc, beatTargets(method, doc, planned), planned), line);
  const none: StepVisual = { visual: 'none', idea: '', data: '' };
  assert.doesNotMatch(beatBrief(method, doc, beatTargets(method, doc, none), none), line);
  assert.doesNotMatch(beatBrief(method, doc, beatTargets(method, doc)), line);
});

// ------------------------------------------------------------------------------------------- the repair and the ladder

type Degraded = { beat: string; dropped: string[]; problems: string[] };

/** A model that plans a flow for the method step, and answers it with `answer(attempt)`: a narration and a flow board. */
function model(answer: (attempt: number) => string, attempts: { method: number }, requests: Request[] = []) {
  return (request: Request) => {
    requests.push(request);
    if (request.name === 'paper_card') return card;
    if (['visual_plan', 'opening_visual'].includes(request.name))
      return planFor(request, (id) => (id === 'method-1' ? 'flow' : 'none'));
    if (!request.task.includes('STEP KIND: method')) return direct(request, EXPLAIN);
    attempts.method++;
    return direct(request, answer(attempts.method), { flow: loop });
  };
}

test('a step whose narration is not about its board is sent back with the reason and keeps the board once it is', async () => {
  const attempts = { method: 0 };
  const requests: Request[] = [];
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(model((n) => (n === 1 ? DOSE : `${DOSE} ${about({ flow: loop })}`), attempts, requests)),
  ).generate(input);
  assert.equal(attempts.method, 2, 'one correction');
  const sent = requests.filter((r) => r.task.includes('STEP KIND: method')).at(-1)!.task;
  assert.match(sent, /flow: the narration never speaks of what this board shows \("Forecast rewrites the schedule"/);
  assert.ok(
    steps(tour)
      .find((s) => s.id === 'method-1')!
      .actions.some((a) => a.type === 'board' && a.item.kind === 'flow'),
  );
  assert.deepEqual(metadata.degraded, []);
});

test('a board the narration still is not about after its corrections plays without it, flagged, with its narration', async () => {
  const attempts = { method: 0 };
  const events: { type: string; data: Record<string, any> }[] = [];
  const { tour, metadata } = await new HarnessTourGenerator(
    settings,
    'standard',
    provider(model(() => DOSE, attempts)),
  ).generate({
    ...input,
    onEvent: async (type, data) => {
      events.push({ type, data });
    },
  });
  assert.equal(attempts.method, 3, 'two corrections, then the board is given up');
  const step = steps(tour).find((s) => s.id === 'method-1')!;
  assert.equal(step.say, DOSE);
  assert.ok(!step.actions.some((a) => a.type === 'board' || a.type === 'board_focus'));
  const degraded = metadata.degraded as Degraded[];
  assert.deepEqual(
    degraded.map((d) => [d.beat, ...d.dropped]),
    [['method-1', 'board']],
  );
  assert.match(degraded[0].problems[0], /^flow: the narration never speaks of what this board shows/);
  assert.deepEqual(
    events.filter((e) => e.type === 'beat.degraded').map((e) => [e.data.beat, ...e.data.dropped]),
    [['method-1', 'board']],
  );
});
