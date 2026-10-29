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
  } else if (item.kind === 'plot') {
    if (item.curves.every((curve) => straight(curve.expression, item)))
      problems.push(
        'every curve is a straight line in x, which a sentence says as well as a plot; plot a relationship whose shape matters (saturation, decay, periodicity, a crossover) or leave the board out',
      );
  } else if (item.kind === 'flow' && chain(item))
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
