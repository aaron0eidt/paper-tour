import test from 'node:test';
import assert from 'node:assert/strict';
import { findAnchor } from '../src/harness/assemble';
import { boardParts, boardPartIds, checkBoard, type BoardKind } from '../src/harness/board';
import { BOARD_EXAMPLES, SHARED_RULES, directTask } from '../src/harness/prompts';
import { SOURCE_VISUAL_POLICY } from '../src/muse/visual-policy';

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
    ],
  });
  assert.deepEqual(checkBoard('scatter', big, 'a 65M model scores 71 and a 1,024 unit one 80').problems, []);
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
    ],
  });
  has(checkBoard('scatter', flat, '').problems, /every point has the same y/);
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
const NEW_KINDS = ['heatmap', 'scatter', 'shapes'] as const;
const FOCUS = { heatmap: 'row-1', scatter: 'point-1', shapes: 'matrix-1' } as const;
const HEADER = {
  heatmap: 'BOARD (optional): a heatmap shows',
  scatter: 'BOARD (optional): a scatter plot shows',
  shapes: 'BOARD (optional): shapes shows',
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
  for (const kind of NEW_KINDS) {
    const example = BOARD_EXAMPLES[kind];
    const { item, problems } = checkBoard(kind, (example as Record<string, unknown>)[kind], '');
    assert.deepEqual(problems, [], kind);
    assert.ok(item, kind);
    const parts = boardParts(item);
    for (const cue of example.cues) {
      assert.ok(findAnchor(example.say, cue.anchor) !== null, `${kind}: ${cue.anchor}`);
      assert.ok(boardPartIds(kind).includes(cue.target), `${kind}: ${cue.target}`);
      assert.ok(Number(cue.target.split('-')[1]) <= parts, `${kind}: ${cue.target} is one of ${parts} parts`);
    }
    assert.match(example.say, /illustrative/, `${kind} labels its values illustrative`);
  }
});

test('the representation guidance names the new kinds and what they show, and stops steering toward bars and flows', () => {
  const text = prompt();
  assert.match(text, /Relations, weights, masks, a grid of results or a formula over two indices→heatmap/);
  assert.match(text, /A trade-off or relationship between two measured quantities→scatter/);
  assert.match(text, /How matrix dimensions combine through an operation→shapes/);
  assert.match(text, /One key comparison on a single metric→bars/);
  assert.match(text, /A real dependency structure the page does not draw→flow/);
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
  assert.doesNotMatch(SOURCE_VISUAL_POLICY, /heatmap|scatter|shapes/);
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
  // The common prompt shrank when the rules were merged; this keeps it from growing back unnoticed.
  for (const board of [undefined, 'formula', 'bars', 'flow', 'plot', 'scene', ...NEW_KINDS] as const)
    assert.ok(prompt(board).length < 23_000, `${board ?? 'no board'}: ${prompt(board).length} characters`);
  assert.ok(prompt().length < 20_000, `common prompt: ${prompt().length} characters`);
});
