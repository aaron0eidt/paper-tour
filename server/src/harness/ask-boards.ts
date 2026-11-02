import { AUTHORED_VISUAL_GUIDANCE } from '../visuals/guidance';
import type { BoardItem, Tour } from '../../../shared/paper';
import { boardSignature } from './assemble';
import { BOARD_KINDS, BOARD_LIMITS, FLOW_NODE_IDS, boardPartIds, boardSchema, type BoardKind } from './board';

// The side board of an answer. Every kind the tour board registry supports can answer a question: the model chooses the
// kind that shows the answer best and writes its item, and the same checks as a tour step's board decide whether it is
// drawn (ask-answer.ts). This file holds what is specific to answers: the provider schema, the guidance, the boards the
// tour has just shown (an answer does not redraw them) and the label that tells a made-up case from the document's own.

/** Kinds whose item the shared schemas describe in full (everything but the formula, flow and bars of answers). */
export const NESTED_KINDS: readonly BoardKind[] = BOARD_KINDS.filter(
  (kind) => kind !== 'formula' && kind !== 'flow' && kind !== 'bars',
);
const MAX_FOCUS = 8;

const text = (maxLength: number, description?: string) => ({
  type: 'string',
  maxLength,
  ...(description ? { description } : {}),
});
const object = (properties: Record<string, unknown>, required = Object.keys(properties)) => ({
  type: 'object',
  additionalProperties: false,
  required,
  properties,
});
const parts = (max: number, item: object) => ({ type: 'array', maxItems: max, items: item });

/**
 * The board of one answer step: an object that holds the item of the kind the model chooses under that kind's name
 * (`{"timeline": {...}}`), and nothing for a step without a board (`{}`). The name is the choice, so a kind always
 * brings its own data (nothing can be chosen and left empty) and no kind is favoured by what an object usually starts
 * with. Formula, flow and bars are the small items answers have always had, each part with the words where the voice
 * reaches it; every other kind is the tour board's own schema, plus a `focus` that lights up its parts.
 */
export function answerBoardSchema(anchor: object) {
  const limits = BOARD_LIMITS;
  const node = { type: 'string', enum: FLOW_NODE_IDS };
  const properties: Record<string, unknown> = {
    formula: object(
      {
        title: text(limits.title),
        latex: text(400, 'The LaTeX of the whole formula.'),
        terms: parts(
          limits.terms[1],
          object({ latex: text(160, 'Copied exactly from latex.'), label: text(limits.termLabel), anchor }),
        ),
      },
      ['latex', 'terms'],
    ),
    flow: object(
      {
        title: text(limits.title),
        nodes: parts(limits.nodes[1], object({ label: text(limits.nodeLabel), anchor })),
        edges: {
          ...parts(limits.edges, object({ from: node, to: node })),
          description: 'Arrows between nodes (node-1 is the first listed), with a branch, a merge or a loop.',
        },
      },
      ['nodes', 'edges'],
    ),
    bars: object(
      {
        title: text(limits.title),
        unit: text(limits.unit),
        higher_is_better: { type: 'boolean' },
        bars: parts(limits.bars[1], object({ label: text(limits.barLabel), value: { type: 'number' }, anchor })),
      },
      ['bars'],
    ),
  };
  for (const kind of NESTED_KINDS) {
    const schema = boardSchema(kind) as { properties: Record<string, unknown> };
    const focus = {
      ...parts(MAX_FOCUS, object({ part: { type: 'string', enum: boardPartIds(kind) }, anchor })),
      description: 'A part to light up while the voice explains it, and the words of say where the voice reaches it.',
    };
    properties[kind] = { ...schema, properties: { ...schema.properties, focus } };
  }
  return {
    type: 'object',
    additionalProperties: false,
    properties,
    description:
      'At most one board: the item of the kind that shows the answer best, under that kind’s name. {} for none.',
  };
}

/** The kind of a board an answer wrote: its `kind` when it names one (answers once did), else the one item it holds. */
export function boardKindOf(raw: Record<string, unknown>): string {
  if (typeof raw.kind === 'string' && raw.kind.trim()) return raw.kind.trim();
  const held = BOARD_KINDS.find((kind) => {
    const item = raw[kind];
    return typeof item === 'object' && item !== null && !Array.isArray(item);
  });
  return held ?? 'none';
}

/** When to reach for each kind in an answer; the fields of each are described by its schema. */
const KIND_HELP: Record<BoardKind, string> = {
  program: 'a freely authored live mathematical construction with real numerical intermediate states, vectors, matrices, geometry or a computational graph; host time follows the narration',
  plotly: 'interactive measured-data comparisons or genuine mathematical functions with labeled axes and units',
  heatmap:
    'how items relate to each other (weights, attention, alignment, similarity, correlation, a confusion matrix, a mask), a grid of results over two settings, or a formula’s value over two indices',
  scatter:
    'a trade-off between two quantities measured in the document (quality against cost, accuracy against size; two columns of a results table), at least three points',
  shapes: 'how matrix or vector dimensions combine in an operation and which dimension disappears or appears',
  plot: 'how a formula responds to its input or a parameter when the shape matters (saturation, decay, periodicity, a crossover; never a straight line); marks the code finds (root, extremum, crossing) and measured points',
  timeline: 'the dates, notice periods, deadlines and terms a document states, or the ordered steps of a procedure',
  distribution:
    'how uncertainty is spread and changes: a bell curve that narrows or shifts, a Poisson or binomial, the chance of a tail',
  formula: 'the parts of the equation asked about, in math symbols, each with its role; never a rule in words',
  bars: 'one key comparison on a single metric',
  flow: 'a real dependency structure with a branch, a merge or a loop that the page does not draw (a chain of steps is a list, not a flow)',
  scene: 'vectors or geometry with actual values, when geometry is the point',
};
/** Kinds in the order the guidance lists them: the ones that show relationships first. */
const HELP_ORDER: BoardKind[] = ['program', 'plotly',
  'heatmap',
  'scatter',
  'shapes',
  'plot',
  'timeline',
  'distribution',
  'formula',
  'bars',
  'flow',
  'scene',
];

/** The guidance on boards in the task: the fixed part, identical for every question so it extends the cached prefix. */
export function boardGuidance(): string {
  return `   Choose the kind that shows the answer best, and the picture that makes the point click. The kinds:
${HELP_ORDER.map((kind) => `   - ${kind}: ${KIND_HELP[kind]}.`).join('\n')}
   The board is a single item written under the name of its kind (board.heatmap, board.timeline, board.formula ...) with that kind's own fields (a heatmap has rows, cols and values; a timeline has events and spans). A step without a board has board {}.
   Numbers: source "document" values are copied exactly as printed in the document (its text, captions, equations and the table cells above), never rounded, converted or worked out from other numbers. A made-up case is source "illustrative" (a plot is illustrative unless it says document), and the title and say call it illustrative. A question about the document's results gets the document's own numbers, never illustrative ones. Name rows, bars and points after real items, never "item 1".
${AUTHORED_VISUAL_GUIDANCE}
   Light up each part while you explain it: a formula term, flow node or bar through its own anchor, any other kind through the "focus" of its item, one entry for each part you speak about (part such as row-2, point-1, mark-1, dist-2, and the words of say where the voice reaches it).`;
}

// ------------------------------------------------------------ what the tour just showed

/** A board of the tour the learner has just seen. */
export interface ShownBoard {
  kind: BoardKind;
  title?: string;
  /** What the board shows (assemble.ts boardSignature): the same signature is the same picture. */
  signature: string | null;
}
/** How many of the tour's latest boards count as "just shown". */
const JUST_SHOWN = 3;

/** The latest boards of the tour up to the step the learner asked on (the whole tour when no step is given). */
export function shownBoards(tour: Tour | undefined, stepId: string | undefined): ShownBoard[] {
  const steps = tour?.chapters.flatMap((chapter) => chapter.steps) ?? [];
  const at = stepId ? steps.findIndex((step) => step.id === stepId) : -1;
  const shown = steps
    .slice(0, at >= 0 ? at + 1 : steps.length)
    .flatMap((step) => step.actions.flatMap((action) => (action.type === 'board' ? [action.item] : [])));
  return shown.slice(-JUST_SHOWN).map((item) => ({
    kind: item.kind,
    ...('title' in item && item.title ? { title: item.title } : {}),
    signature: boardSignature(item),
  }));
}

/** The line that keeps an answer from redrawing what the tour just showed, or none. */
export function shownLine(shown: readonly ShownBoard[]): string | undefined {
  if (!shown.length) return undefined;
  const named = shown.map((board) => `${board.kind}${board.title ? ` "${board.title}"` : ''}`).join('; ');
  return `BOARDS THE TOUR JUST SHOWED: ${named}. Do not draw the same board again; prefer another kind, or another aspect of the answer.`;
}

/** Whether the board is a picture the tour just showed. */
export const repeatsShown = (item: BoardItem, shown: readonly ShownBoard[] = []): boolean => {
  const signature = boardSignature(item);
  return !!signature && shown.some((board) => board.signature === signature);
};

// ------------------------------------------------------------ made-up values

const TITLE_MAX = 60;
const SAYS_ILLUSTRATIVE = /\b(?:illustrati\w*|invented|made[- ]up|toy|hypothetical|example|sample|beispiel\w*)\b/i;
/** Whether the board shows made-up values: an illustrative source, or a plot whose curves are not the document's own. */
export const isIllustrative = (item: BoardItem): boolean =>
  item.kind === 'plot'
    ? item.source !== 'document'
    : (item.kind === 'program' || item.kind === 'plotly' || item.kind === 'heatmap' ||
        item.kind === 'scatter' ||
        item.kind === 'timeline' ||
        item.kind === 'distribution') &&
      item.source === 'illustrative';

/**
 * A made-up case is called illustrative in its title, as the tour asks of its writer, so that no learner takes it for the
 * document's own numbers. A title that already says so, or one with no room left, is kept.
 */
export function labelIllustrative(item: BoardItem): BoardItem {
  if (!isIllustrative(item)) return item;
  const title = ('title' in item ? (item.title ?? '') : '').trim();
  if (SAYS_ILLUSTRATIVE.test(title)) return item;
  const labelled = title ? `${title} (illustrative)` : 'Illustrative values';
  return labelled.length <= TITLE_MAX ? ({ ...item, title: labelled } as BoardItem) : item;
}
