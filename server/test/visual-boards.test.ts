import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Doc } from '../../shared/paper';
import { canonicalScatter, needsLogAxis } from '../../shared/scatter';
import { tableLines } from '../../shared/tableTargets';
import { findAnchor } from '../src/harness/assemble';
import { boardPart, boardParts, boardPartIds, checkBoard, numbersIn, type BoardKind } from '../src/harness/board';
import { BOARD_EXAMPLES, SHARED_RULES, directTask } from '../src/harness/prompts';
import { groundedProblems } from '../src/harness/visual-rules';
import { SOURCE_VISUAL_POLICY } from '../src/muse/visual-policy';
import { printedNumbers } from '../src/harness/tables';

// The server side of the heatmap, scatter and shapes boards: grounding in the evidence and the prompts that teach them.

const has = (problems: string[], pattern: RegExp) =>
  assert.ok(
    problems.some((p) => pattern.test(p)),
    problems.join(' | '),
  );
const heatmap = (change: Record<string, unknown> = {}) => ({
  rows: ['true blight', 'true rust'],
  cols: ['pred blight', 'pred rust'],
  values: [
    [46, 4],
    [9, 41],
  ],
  source: 'document',
  ...change,
});
const scatter = (change: Record<string, unknown> = {}) => ({
  x_label: 'cost (GPU hours)',
  y_label: 'error rate (%)',
  points: [
    { label: 'plain', x: 12, y: 8.5 },
    { label: 'tuned', x: 40, y: 6.1 },
    { label: 'ensemble', x: 130, y: 5.4 },
  ],
  source: 'document',
  ...change,
});
const shapes = (...names: string[]) => ({
  terms: [
    { kind: 'matrix', name: names[0], rows: 'n', cols: 'd' },
    { kind: 'op', op: 'times' },
    { kind: 'matrix', name: names[1], rows: 'd', cols: 'h' },
  ],
});

// ------------------------------------------------------------------------------------------------- heatmap grounding

test('a heatmap of the document’s values is accepted when every value is printed in the evidence', () => {
  const { item, problems } = checkBoard('heatmap', heatmap(), 'Table 3: blight 46 4; rust 9 41 (leaves).');
  assert.deepEqual(problems, []);
  assert.equal(item?.kind, 'heatmap');
});

test('a heatmap of document values that are not printed is refused with the cells to fix', () => {
  const { item, problems } = checkBoard('heatmap', heatmap(), 'Table 3: blight 46 4; rust 9.');
  assert.equal(item, null);
  assert.equal(problems.length, 1);
  has(problems, /^values: not printed in the evidence: row "true rust", column "pred rust" = 41\./);
  has(problems, /Copy numbers exactly as printed, or set source to illustrative and say so in the title/);
});

test('a heatmap names three unprinted cells and counts the rest', () => {
  const grid = heatmap({
    rows: ['a', 'b', 'c'],
    cols: ['x', 'y', 'z'],
    values: [
      [11, 12, 13],
      [14, 15, 16],
      [17, 18, 19],
    ],
  });
  const { problems } = checkBoard('heatmap', grid, 'Only 11 and 12 are printed.');
  has(problems, /row "a", column "z" = 13; row "b", column "x" = 14; row "b", column "y" = 15 \(and 4 more\)\./);
});

test('masked cells of a document heatmap need no evidence, since the board hides them', () => {
  const masked = heatmap({
    mask: 'upper',
    values: [
      [0.7, 123],
      [0.2, 0.8],
    ],
  });
  assert.deepEqual(checkBoard('heatmap', masked, 'Weights 0.7 0.2 0.8').problems, []);
  has(
    checkBoard('heatmap', { ...masked, mask: undefined }, 'Weights 0.7 0.2 0.8').problems,
    /column "pred rust" = 123/,
  );
});

test('illustrative and formula heatmaps need no evidence, but a grid of equal values is refused', () => {
  assert.deepEqual(checkBoard('heatmap', heatmap({ source: 'illustrative' }), '').problems, []);
  const formula = {
    rows: ['pos 1', 'pos 2', 'pos 3'],
    cols: ['dim 1', 'dim 2', 'dim 3'],
    source: 'formula',
    expression: 'sin(a/x)',
  };
  const { item, problems } = checkBoard('heatmap', formula, '');
  assert.deepEqual(problems, []);
  assert.equal(item?.kind === 'heatmap' && item.values.length, 3);
  has(
    checkBoard('heatmap', { ...formula, expression: 'log(0)' }, '').problems,
    /expression: it is not a finite number/,
  );
  const equal = heatmap({
    source: 'illustrative',
    values: [
      [5, 5],
      [5, 5],
    ],
  });
  has(checkBoard('heatmap', equal, '').problems, /every visible cell is the same/);
});

test('a blank heatmap means no board, and a broken one is not checked against the evidence', () => {
  assert.deepEqual(checkBoard('heatmap', { rows: [], cols: [], values: [] }, ''), { item: null, problems: [] });
  const { problems } = checkBoard('heatmap', heatmap({ cols: ['one'] }), 'nothing printed');
  assert.deepEqual(problems, ['cols: give 2 to 10 labels, not 1']);
});

// ------------------------------------------------------------------------------------------------- scatter grounding

test('a scatter of the document’s coordinates is accepted when they are printed, in any of the document’s notations', () => {
  const evidence = 'Plain: 12 hours, 8.5% error. Tuned: 40 h, 6.1%. Ensemble: 130 h, 5.4%.';
  assert.deepEqual(checkBoard('scatter', scatter(), evidence).problems, []);
  const big = scatter({
    points: [
      { label: 'small', x: 65e6, y: 71 },
      { label: 'large', x: 1024, y: 80 },
      { label: 'base', x: 300, y: 75 },
    ],
  });
  assert.deepEqual(
    checkBoard('scatter', big, 'a 65M model scores 71, a 1,024 unit one 80 and a 300 unit one 75').problems,
    [],
  );
});

test('a scatter of document coordinates that are not printed is refused with the points to fix', () => {
  const { item, problems } = checkBoard('scatter', scatter(), 'Plain: 12 hours, 8.5% error. Tuned: 40 h.');
  assert.equal(item, null);
  assert.equal(problems.length, 1);
  has(problems, /^points: not printed in the evidence: "tuned" y = 6\.1; "ensemble" x = 130; "ensemble" y = 5\.4\./);
  has(problems, /set source to illustrative and say so in the title/);
});

test('illustrative scatter points need no evidence, but all points on one value of an axis are refused', () => {
  assert.deepEqual(checkBoard('scatter', scatter({ source: 'illustrative' }), '').problems, []);
  const flat = scatter({
    source: 'illustrative',
    points: [
      { label: 'a', x: 1, y: 5 },
      { label: 'b', x: 2, y: 5 },
      { label: 'c', x: 3, y: 5 },
    ],
  });
  has(checkBoard('scatter', flat, '').problems, /every point has the same y/);
});

// The cost column of a results table as older analyses (and a table without a grid) print it: the exponent flattened.
const FLATTENED_COSTS = [
  'ConvS2S [9] 25.16 40.46 9.6 · 1018 1.5 · 1020',
  'MoE [32] 26.03 40.56 2.0 · 1019 1.2 · 1020',
  'GNMT + RL [38] 24.6 39.92 2.3 · 1019 1.4 · 1020',
  'Transformer (base model) 27.3 38.1 3.3 · 1018',
  'Transformer (big) 28.4 41.8 2.3 · 1019',
].join('\n');
const costs = (change: Record<string, unknown> = {}) =>
  scatter({
    x_label: 'Training cost (FLOPs)',
    y_label: 'BLEU EN-DE',
    points: [
      { label: 'ConvS2S', x: 9.6e18, y: 25.16 },
      { label: 'MoE', x: 2e19, y: 26.03 },
      { label: 'GNMT + RL', x: 2.3e19, y: 24.6 },
      { label: 'Transformer (base)', x: 3.3e18, y: 27.3 },
      { label: 'GNMT + RL (EN-FR)', x: 1.4e20, y: 39.92 }, // 40 times the cheapest: a log axis
    ],
    ...change,
  });

test('a scatter of costs is grounded in a table text whose exponents were flattened, and the log axis is chosen in code', () => {
  const { item, problems } = checkBoard('scatter', costs(), FLATTENED_COSTS);
  assert.deepEqual(problems, []);
  assert.equal(item?.kind === 'scatter' && item.x_log, true);
  assert.equal(item?.kind === 'scatter' && item.y_log, undefined);
  assert.deepEqual(groundedProblems(item!, { results: true }), []);
});

test('a cost that the flattened table text does not print is still refused, as is a changed exponent', () => {
  for (const wrong of [2.4e19, 2.3e18, 2.3e20, 2343.7]) {
    const points = costs().points.map((p: { x: number }, i: number) => (i === 2 ? { ...p, x: wrong } : p));
    const { item, problems } = checkBoard('scatter', costs({ points }), FLATTENED_COSTS);
    assert.equal(item, null, String(wrong));
    has(problems, /"GNMT \+ RL" x = /);
  }
  // An ordinary number is as strict as before: a flattened table text prints no 23 or 2.3e19 of anything else.
  const { problems } = checkBoard('scatter', costs(), 'Transformer (big) 28.4 41.8 2.3 · 105');
  has(problems, /not printed in the evidence/);
});

test('the exponents a newer ingest marks ground the same costs as the flattened text of an older one', () => {
  const marked = FLATTENED_COSTS.replace(/ 10(\d\d)\b/g, ' 10^$1');
  assert.ok(marked.includes('2.3 · 10^19 1.4 · 10^20'));
  for (const evidence of [FLATTENED_COSTS, marked])
    assert.deepEqual(checkBoard('scatter', costs(), evidence).problems, []);
  const large = (text: string) => numbersIn(text).filter((n) => n >= 1e18);
  assert.deepEqual(large(marked), large(FLATTENED_COSTS));
});

// demo/attention-short/doc.json is a link to demo/attention/doc.json, where the file lives; neither is committed.
const realDoc = ['attention-short', 'attention']
  .map((folder) => resolve(import.meta.dirname, `../../demo/${folder}/doc.json`))
  .find((path) => existsSync(path));

test(
  'the real paper: costs of its results table ground a scatter from the flattened text of the page',
  { skip: !realDoc },
  () => {
    const doc = JSON.parse(readFileSync(realDoc!, 'utf8')) as Doc;
    const table = doc.figures.find((f) => f.id === 'tab2')!;
    // What a table without a grid gives the model: the extracted lines, "2.3 · 1019" among them.
    const flattened = tableLines(doc, { ...table, grid: undefined });
    assert.ok(flattened.some((line) => /2\.3 · 10(?:\^)?19/.test(line)));
    const { item, problems } = checkBoard('scatter', costs(), flattened.join('\n'));
    assert.deepEqual(problems, []);
    assert.equal(item?.kind === 'scatter' && item.x_log, true);
    const printed = printedNumbers(doc, { ...table, grid: undefined });
    for (const cost of [9.6e18, 2e19, 2.3e19, 3.3e18, 1.1e21]) assert.ok(printed.includes(cost), String(cost));
  },
);

test('a log axis is chosen in code where a linear one cannot show the values, and only there', () => {
  for (const [values, log] of [
    [[1, 999], false],
    [[1, 1000], true],
    [[8, 14, 31, 78], false],
    [[5e14, 9e14], false],
    [[1e15, 2e15], false], // past what k, M, B and T spell out, but not a decade
    [[9.6e18, 2.3e19, 3.3e19], false], // within a decade: linear, with powers of ten for labels
    [[1e20, 1.2e20, 1.5e20], false],
    [[3.3e18, 1.5e20], true],
    [[1e15, 1e16], true],
    [[0.001, 0.002], false],
    [[0.0002, 0.0005], false], // a thousandth is the last plain decimal, a decade is the least a log axis needs
    [[0.0002, 0.002], true],
    [[-1, 1e18], false], // a log axis needs values above zero
    [[0, 1e18], false],
    [[], false],
  ] as [number[], boolean][])
    assert.equal(needsLogAxis(values), log, values.join(', '));
  const point = (x: number, y: number) => ({ label: `p${x}`, x, y });
  const item = canonicalScatter(
    scatter({ points: [point(1e19, 3), point(2e20, 4), point(3e19, 5)], y_log: false, source: 'document' }),
  );
  assert.equal(item.x_log, true);
  assert.equal(item.y_log, undefined);
  assert.equal(canonicalScatter(scatter({ x_log: true })).x_log, true, 'a log axis the model asks for stays');
});

test('a scatter without points means no board', () => {
  assert.deepEqual(checkBoard('scatter', { points: [] }, ''), { item: null, problems: [] });
});

// -------------------------------------------------------------------------------------------------- shapes names

test('shapes accepts names KaTeX renders and refuses the rest with the term to fix', () => {
  assert.deepEqual(checkBoard('shapes', shapes('X', 'W^{\\top}')).problems, []);
  const { item, problems } = checkBoard('shapes', shapes('\\frac{', '\\href{x}{y}'));
  assert.equal(item, null);
  has(problems, /^term 1: the name "\\frac\{" cannot be rendered as LaTeX: /);
  has(problems, /^term 3: the name "\\href\{x\}\{y\}" cannot be rendered as LaTeX: links, images and HTML/);
});

test('shapes reports a name that does not render together with a dimension that does not agree', () => {
  const bad = shapes('A', '$B$');
  bad.terms[2].rows = 'k';
  const { problems } = checkBoard('shapes', bad);
  has(problems, /^term 3: times needs the columns of the left side \(d\) to equal the rows of this matrix \(k\)/);
  has(problems, /^term 3: the name "\$B\$" cannot be rendered as LaTeX/);
});

test('shapes without terms means no board', () => {
  assert.deepEqual(checkBoard('shapes', { terms: [] }), { item: null, problems: [] });
});

// ------------------------------------------------------------------------------------------------------- prompts

const ACTIONS = ['highlight', 'box', 'spotlight', 'note', 'arrow', 'circle', 'board_focus'];
const prompt = (board?: BoardKind, detail = false) =>
  directTask('en', 'BRIEF', { actions: ACTIONS, board, words: 120, detail });
const NEW_KINDS = ['heatmap', 'scatter', 'shapes', 'timeline', 'distribution'] as const;
const FOCUS = {
  heatmap: 'row-1',
  scatter: 'point-1',
  shapes: 'matrix-1',
  timeline: 'event-1',
  distribution: 'dist-1',
} as const;
const HEADER = {
  heatmap: 'BOARD (optional): a heatmap shows',
  scatter: 'BOARD (optional): a scatter plot shows',
  shapes: 'BOARD (optional): shapes shows',
  timeline: 'BOARD (optional): a timeline lays out',
  distribution: 'BOARD (optional): a distribution board draws',
} as const;

test('the prompt of a heatmap, scatter or shapes step explains the kind, its data rules, its focus and an example', () => {
  const heat = prompt('heatmap');
  assert.match(heat, /BOARD \(optional\): a heatmap shows a grid of values with labelled rows and columns/);
  assert.match(heat, /source document: values copied exactly as printed/);
  assert.match(heat, /source illustrative: .*labelled illustrative in the title and in "say"/);
  assert.match(heat, /source formula: .*"expression" in x \(the column number\) and a \(the row number\)/);
  assert.match(prompt('scatter'), /a scatter plot shows a trade-off or relationship between two measured quantities/);
  assert.match(prompt('scatter'), /source document: coordinates copied exactly as printed/);
  assert.match(prompt('shapes'), /shapes shows how the dimensions of matrices and vectors combine/);
  assert.match(prompt('shapes'), /times \(the columns on its left must equal the rows on its right\)/);
  for (const kind of NEW_KINDS) {
    const text = prompt(kind);
    assert.ok(text.includes(`target ${FOCUS[kind]} is the first`), `${kind} focus`);
    assert.ok(
      text.includes(`EXAMPLE from another document: ${JSON.stringify(BOARD_EXAMPLES[kind])}`),
      `${kind} example`,
    );
    assert.ok(text.includes(HEADER[kind]), `${kind} task`);
    for (const other of NEW_KINDS.filter((k) => k !== kind)) assert.ok(!text.includes(HEADER[other]), `${kind} only`);
  }
});

test('the focus line is only offered when the step may light up board parts', () => {
  const text = directTask('en', 'BRIEF', { actions: ['highlight'], board: 'heatmap', words: 120 });
  assert.ok(!text.includes('row-1'));
});

test('the examples the model is shown pass the checks of its own answers and cue real parts', () => {
  // A scatter is the document's own measured numbers, so its example prints them in its evidence.
  const printed = {
    scatter: BOARD_EXAMPLES.scatter.scatter.points.map((point) => `${point.x} ${point.y}`).join(' '),
    // A timeline of the document's own periods prints them too.
    timeline: 'Free returns within 30 days of delivery, a refund within 14 days of that, and a warranty of 2 years.',
  } as Record<string, string>;
  for (const kind of NEW_KINDS) {
    const example = BOARD_EXAMPLES[kind];
    const { item, problems } = checkBoard(kind, (example as Record<string, unknown>)[kind], printed[kind] ?? '');
    assert.deepEqual(problems, [], kind);
    assert.ok(item, kind);
    assert.deepEqual(groundedProblems(item, { results: false }), [], `${kind} meets the rules for a tour step`);
    const parts = boardParts(item);
    for (const cue of example.cues) {
      assert.ok(findAnchor(example.say, cue.anchor) !== null, `${kind}: ${cue.anchor}`);
      assert.ok(boardPartIds(kind).includes(cue.target), `${kind}: ${cue.target}`);
      assert.ok(boardPart(item, cue.target) >= 0, `${kind}: ${cue.target} is one of ${parts} parts`);
    }
    if (kind !== 'scatter' && kind !== 'timeline')
      assert.match(example.say, /illustrative/, `${kind} labels its values illustrative`);
  }
});

test('the representation guidance names the new kinds and what they show, and stops steering toward bars and flows', () => {
  const text = prompt();
  assert.match(text, /Relations, weights, masks, a grid of results or a formula over two indices→heatmap/);
  assert.match(text, /A trade-off between two quantities measured in the document→scatter/);
  assert.match(text, /How matrix dimensions combine through an operation→shapes/);
  assert.match(text, /Dates, notice periods, deadlines, the steps of a procedure→timeline/);
  assert.match(text, /A spread that narrows or shifts, before and after, the chance of a tail→distribution/);
  assert.match(text, /One key comparison on a single metric→bars/);
  assert.match(text, /A real dependency structure with a branch, a merge or a loop that the page does not draw→flow/);
  assert.match(text, /no board is better than a weak one/);
  assert.match(text, /Never repeat the same data twice/);
  assert.doesNotMatch(text, /Actively choose a visual teaching method for every step/);
  assert.doesNotMatch(
    text,
    /comparable quantities become bars|prefer a clear visual comparison|Use a grounded bars board/,
  );
  assert.doesNotMatch(text, /CHOOSE REPRESENTATIONS|VISUAL VALUE:/);
  assert.match(SOURCE_VISUAL_POLICY, /grounded bars only for one key comparison on a single metric/);
  assert.match(SOURCE_VISUAL_POLICY, /a flow only for a real dependency/);
  // Questions and worked-example frames cannot draw the newer kinds, so the policy they share does not offer them.
  assert.doesNotMatch(SOURCE_VISUAL_POLICY, /heatmap|scatter|shapes|timeline|distribution/);
});

test('narration explains what the text leaves implicit instead of paraphrasing what is highlighted', () => {
  for (const text of [prompt(), prompt('bars'), prompt('heatmap', true)]) {
    assert.match(text, /never read it out or paraphrase it/);
    assert.match(text, /State the point in one plain sentence, then explain what the text leaves implicit/);
    assert.match(text, /why it holds, how it works, what it changes, what would happen without it/);
    assert.match(text, /one concrete example or analogy only when it makes the idea click, labelled illustrative/);
    assert.match(text, /skip what a reader gets from it at a glance/);
    assert.doesNotMatch(text, /concise paraphrases|close to the authors|actual section and page order/);
    assert.doesNotMatch(text, /never read the source aloud/);
    assert.match(text, /not universal superiority/); // results stay scoped to their dataset, metric and baselines
  }
  assert.match(SHARED_RULES, /never read it out or paraphrase it: lead with the\s+point in one plain sentence/);
  assert.match(SHARED_RULES, /then say what the text leaves implicit/);
  assert.match(SHARED_RULES, /no markdown, lists, URLs, hype or\s+suspense/);
});

test('the direction prompt stays within its budget for every board', () => {
  // The common prompt shrank when the rules were merged; this keeps it from growing back unnoticed. The formula board's
  // task grew by the line that a formula is mathematics, not a rule in words.
  for (const board of [undefined, 'formula', 'bars', 'flow', 'plot', 'scene', ...NEW_KINDS] as const)
    assert.ok(prompt(board).length < 23_200, `${board ?? 'no board'}: ${prompt(board).length} characters`);
  assert.ok(prompt().length < 20_000, `common prompt: ${prompt().length} characters`);
});
