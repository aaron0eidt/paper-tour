import type { BoardItem } from '../../../shared/paper';
import { evaluateExpression, parseExpression, type PlotItem } from '../../../shared/plot';
import type { Beat } from './beats';
import type { BoardCheck, FlowItem } from './board';

// Rules a tour step's top-level board must meet to show something real (notes/ROADMAP.md, wave 1). The board checks in
// board.ts hold for every caller (tours, worked examples, answers); these only apply to the board of a tour step, and
// each problem is worded as an instruction for the repair turn.

/**
 * Whether a step reports the document's results: a result step, or a step on a table. Its numbers are the document's
 * own; illustrative values only explain a mechanism.
 */
export const reportsResults = (beat: Beat, table?: string) => beat.kind === 'result' || (!!beat.target && !!table);

/** Words that only number an item: "pos 1", "item 2", "token 3", "x1", "row 4". A real name ("GPT-3") is not one. */
const PLACEHOLDER = new RegExp(
  `^(?:${[
    'pos',
    'position',
    'item',
    'token',
    'word',
    'point',
    'bar',
    'row',
    'col',
    'column',
    'sample',
    'label',
    'category',
    'option',
    'entry',
    'element',
    'example',
    'case',
    'input',
    'output',
    'cell',
    'unit',
    'dim',
    'dimension',
    'index',
    'obj',
    'object',
    'event',
    'step',
    'stage',
    'period',
    'date',
    'x',
    'y',
    'z',
  ].join('|')})[\\s._#-]*\\d+$`,
  'i',
);

/** Every label is a numbered placeholder, so the board names nothing the learner can relate to the document. */
const numbered = (labels: string[]) => labels.length > 1 && labels.every((label) => PLACEHOLDER.test(label.trim()));

const placeholders = (what: string) =>
  `all ${what} are numbered placeholders such as "pos 1" or "item 2"; use real items: the words of a short example sentence, settings or method names`;

/**
 * Whether a curve is a straight line over the plot's x range, at every value its parameter takes (a is 1 without a
 * parameter). A curve that cannot be evaluated everywhere is not one.
 */
function straight(expression: string, plot: PlotItem): boolean {
  let tree;
  try {
    tree = parseExpression(expression);
  } catch {
    return false;
  }
  const { from, to } = plot.parameter ?? { from: 1, to: 1 };
  const [low, high] = plot.x;
  const steps = 24;
  return [0, 1, 2, 3, 4].every((k) => {
    const y = Array.from({ length: steps + 1 }, (_, i) =>
      evaluateExpression(tree, low + ((high - low) * i) / steps, from + ((to - from) * k) / 4),
    );
    if (!y.every(Number.isFinite)) return false;
    const spread = Math.max(...y) - Math.min(...y) || 1;
    return y.every((value, i) => Math.abs(value - (y[0] + ((y[steps] - y[0]) * i) / steps)) <= 1e-6 * spread);
  });
}

/**
 * A flow with no branch, merge or loop: every node has at most one arrow in and one out, and the arrows do not close
 * into a ring. Nodes are connected (checkFlow), so that is a single path, which a list says as well.
 */
function chain(flow: FlowItem): boolean {
  const out = new Map<string, number>();
  const into = new Map<string, number>();
  for (const [from, to] of flow.edges) {
    out.set(from, (out.get(from) ?? 0) + 1);
    into.set(to, (into.get(to) ?? 0) + 1);
  }
  const simple = flow.nodes.every((node) => (out.get(node.id) ?? 0) <= 1 && (into.get(node.id) ?? 0) <= 1);
  return simple && flow.edges.length < flow.nodes.length;
}

/** Commands that set their content in words: a rule written out, not mathematics. */
const TEXT_COMMAND = /\\(?:text|textrm|textit|textbf|textsf|texttt|textnormal|textup|textsc|mbox|hbox)\s*\{/;
/** Commands that only space, size or wrap what follows; their content is read as any other. */
const LAYOUT_COMMAND = new Set(
  'left right big Big bigg Bigg bigl bigr Bigl Bigr quad qquad displaystyle textstyle scriptstyle scriptscriptstyle limits nolimits nonumber notag label tag hspace vspace phantom hphantom vphantom mathrm mathit mathbf mathsf mathtt mathcal mathbb mathfrak mathscr boldsymbol bm operatorname hat bar vec tilde dot ddot widehat widetilde overline underline overbrace underbrace'.split(
    ' ',
  ),
);
/** Operators and relations: they join things, and an equation of nothing else says nothing. */
const OPERATOR_COMMAND = new Set(
  'cdot times pm mp div leq geq le ge neq ne ll gg approx simeq sim cong propto equiv to rightarrow leftarrow leftrightarrow Rightarrow Leftarrow Leftrightarrow implies impliedby iff mapsto mid parallel in notin ni subset subseteq supset supseteq cup cap setminus land lor wedge vee neg ldots dots cdots vdots ddots colon lt gt ast star circ bullet oplus otimes odot'.split(
    ' ',
  ),
);
/** Names of functions, which are written out in letters in any formula. */
const FUNCTION_NAME = new Set(
  'sin cos tan cot sec csc sinh cosh tanh arcsin arccos arctan exp log ln lg max min sup inf lim det dim ker deg gcd lcm arg argmax argmin softmax sigmoid relu gelu norm diag tr trace rank sign sgn var cov corr erf mean std'.split(
    ' ',
  ),
);

/** The group after an opening brace at `open`, with its end. */
function group(latex: string, open: number): { text: string; end: number } {
  let depth = 0;
  for (let i = open; i < latex.length; i++) {
    if (latex[i] === '\\') i++;
    else if (latex[i] === '{') depth++;
    else if (latex[i] === '}' && --depth === 0) return { text: latex.slice(open + 1, i), end: i + 1 };
  }
  return { text: latex.slice(open + 1), end: latex.length };
}

/** Whether the position is in a subscript or a superscript: after `_` or `^`, or inside the braces that follow one. */
function inScript(latex: string, at: number): boolean {
  const open: boolean[] = [];
  let script = false;
  for (let i = 0; i < at; i++) {
    const c = latex[i];
    if (c === '\\') i++;
    else if (c === '{') open.push(open.at(-1) === true || script);
    else if (c === '}') open.pop();
    if (c !== ' ') script = c === '_' || c === '^';
  }
  return open.at(-1) === true || script;
}

/**
 * How much of a formula is mathematics: words set as operands (text in \text, or a plain run of letters that is no
 * symbol and no function), against the symbols around them, and whether any of those is a variable, a number or a
 * mathematical command rather than an operator. A name that takes arguments (`\text{Sublayer}(x)`) or labels a
 * symbol (`F_{\text{thrust}}`) is a symbol, not a word.
 */
export function mathContent(latex: string): { words: number; symbols: number; mathematics: boolean } {
  let words = 0,
    symbols = 0,
    mathematics = false;
  let rest = latex.replace(/\\(?:begin|end)\s*\{[^{}]*\}/g, ' ');
  for (let found = TEXT_COMMAND.exec(rest); found; found = TEXT_COMMAND.exec(rest)) {
    const { text, end } = group(rest, found.index + found[0].length - 1);
    if (inScript(rest, found.index) || /^\s*[([]/.test(rest.slice(end))) symbols++;
    else words += text.split(/\s+/).filter((w) => /\p{L}/u.test(w)).length;
    rest = `${rest.slice(0, found.index)} ${rest.slice(end)}`;
  }
  const token = /\\([a-zA-Z]+)|\\.|(\d+(?:[.,]\d+)*)|(\p{L}+)|([+\-−=<>*/±×÷≈≠≤≥∝→⇒⇔])/gu;
  for (const m of rest.matchAll(token)) {
    if (m[1]) {
      if (LAYOUT_COMMAND.has(m[1])) continue;
      symbols++;
      if (!OPERATOR_COMMAND.has(m[1])) mathematics = true;
    } else if (m[2]) {
      symbols++;
      mathematics = true;
    } else if (m[3]) {
      const run = m[3];
      // A plain run of letters that no symbol or function explains is a word: "Rent", "YourOwnership".
      const word =
        run.length >= 4 &&
        run !== run.toUpperCase() &&
        !FUNCTION_NAME.has(run.toLowerCase()) &&
        !inScript(rest, m.index) &&
        !/^\s*[([]/.test(rest.slice(m.index + run.length));
      if (word) words++;
      else {
        symbols++;
        mathematics = true;
      }
    } else if (m[4]) symbols++;
  }
  return { words, symbols, mathematics };
}

/** Why a board's LaTeX is not mathematics: no symbol, number or command of maths in it, or mostly words. */
export function formulaProblems(latex: string): string[] {
  const { words, symbols, mathematics } = mathContent(latex);
  const why = !mathematics
    ? 'it has no variable, number or mathematical symbol, only words and operators'
    : words > symbols
      ? 'most of it is words in \\text'
      : '';
  return why
    ? [
        `this formula is not mathematics: ${why}. A formula board is for an equation in symbols and numbers; show a rule stated in words another way (a plot of how it behaves, a timeline, a flow with a branch) or leave the board out`,
      ]
    : [];
}

/** Why a checked board would show nothing real on this step; empty when it passes. */
export function groundedProblems(item: BoardItem, { results }: { results: boolean }): string[] {
  const problems: string[] = [];
  if (item.kind === 'heatmap') {
    if (results && item.source !== 'document')
      problems.push(
        'this step reports the document’s results, so the grid must use its own numbers: set source to document and copy the values exactly as printed in the evidence, or leave the board out (illustrative and formula values only explain a mechanism)',
      );
    // A formula's rows and columns are the numbers of its two indices.
    if (item.source !== 'formula') {
      if (numbered(item.rows)) problems.push(placeholders('rows'));
      if (numbered(item.cols)) problems.push(placeholders('columns'));
    }
  } else if (item.kind === 'scatter') {
    if (item.source === 'illustrative')
      problems.push(
        'a scatter shows quantities measured in the document: set source to document and copy every coordinate exactly as printed in the evidence, or leave the board out',
      );
    if (numbered(item.points.map((point) => point.label))) problems.push(placeholders('points'));
  } else if (item.kind === 'bars') {
    // Bars always copy their values from the evidence (checkBars), so only their labels can be placeholders.
    if (numbered(item.bars.map((bar) => bar.label))) problems.push(placeholders('bars'));
  } else if (item.kind === 'timeline') {
    if (results && item.source !== 'document')
      problems.push(
        'this step reports the document’s results, so a timeline must use its own dates and periods: set source to document and take every period as written in the evidence, or leave the board out',
      );
    if (numbered([...item.events.map((event) => event.label), ...(item.anchor ? [item.anchor.label] : [])]))
      problems.push(placeholders('events'));
  } else if (item.kind === 'distribution') {
    if (results && item.source !== 'document')
      problems.push(
        'this step reports the document’s results, so a distribution must use its own parameters or counts: set source to document and copy them exactly as printed in the evidence, or leave the board out',
      );
    const counted = item.dists.flatMap((dist) => dist.categories ?? []);
    if (counted.length && numbered(counted)) problems.push(placeholders('categories'));
  } else if (item.kind === 'plot') {
    // Two straight lines that cross, or measured points over a line, are a plot of a fact: the mark or the data is the point.
    const fact =
      (item.marks ?? []).some((mark) => mark.type === 'crossing' || mark.type === 'root') ||
      (item.points?.length ?? 0) >= 3;
    if (!fact && item.curves.every((curve) => straight(curve.expression, item)))
      problems.push(
        'every curve is a straight line in x, which a sentence says as well as a plot; plot a relationship whose shape matters (saturation, decay, periodicity, a crossover) or leave the board out',
      );
  } else if (item.kind === 'formula') problems.push(...formulaProblems(item.latex));
  else if (item.kind === 'flow' && chain(item))
    problems.push(
      'this flow is a simple chain (no node has more than one arrow in or out), which a list says as well; a flow needs a branch, a merge or a loop, otherwise teach on the page with highlights or choose another visual',
    );
  return problems;
}

/** The board's check, turned into problems when the board does not meet the rules above. */
export function groundedCheck(check: BoardCheck, results: boolean): BoardCheck {
  const problems = check.item ? groundedProblems(check.item, { results }) : [];
  return problems.length ? { item: null, problems } : check;
}
