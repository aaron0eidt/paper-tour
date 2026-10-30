import type { Doc, Step } from '../../../shared/paper';
import { selectedSourceIds } from '../../../shared/selection';
import type { TourImage } from '../tour-generator';
import { answerBoardSchema, boardGuidance, shownLine, type ShownBoard } from './ask-boards';
import { EXAMPLE_SCHEMA, EXAMPLE_TASK } from './example';
import { ANSWERABLE, type AskRequest } from './ask-types';
import type { Passage, Retrieval } from './ask-retrieval';
import { BOARD_EXAMPLES } from './prompts';
import { SOURCE_VISUAL_POLICY } from '../muse/visual-policy';
import { pick } from './schema-budget';
import { viewText } from './tables';
import { BOUNDS_SCHEMA, figureFrameText, measuredFrameText } from './visual-grounding';

/** Most sentences and visuals an answer may point at (schema-budget.ts). */
const ASK_IDS = 600;

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export const CUE_ACTIONS = ['highlight', 'box', 'arrow', 'circle', 'spotlight', 'note'] as const;
const NO_BOARD = {};
/** One short answer for a different document (rule 8): weak models copy format and depth from an example. */
const EXAMPLE = JSON.stringify({
  plan: 'Asks why the learning rate warms up. p4.s7 gives the reason and eq2 the schedule.',
  answerable: 'yes',
  steps: [
    {
      say: 'The authors warm up the learning rate because large updates early in training made it unstable. So the rate starts small and grows step by step.',
      cues: [{ action: 'highlight', target: 'p4.s7', region: 'whole', label: '', anchor: 'large updates early' }],
      board: NO_BOARD,
    },
    {
      say: 'Equation two gives the schedule. For the first four thousand steps the rate grows linearly, then it decays with the inverse square root of the step number.',
      cues: [{ action: 'box', target: 'eq2', region: 'whole', label: 'the schedule', anchor: 'Equation two gives' }],
      board: {
        formula: {
          title: 'Learning-rate schedule',
          latex: 'lr = d^{-0.5} \\cdot \\min(s^{-0.5}, s \\cdot w^{-1.5})',
          terms: [
            { latex: 's \\cdot w^{-1.5}', label: 'linear warmup', anchor: 'grows linearly' },
            { latex: 's^{-0.5}', label: 'decay', anchor: 'inverse square root' },
          ],
        },
      },
    },
  ],
  followups: ['How long is the warmup?', 'What happens without warmup?'],
});

/** A board of a kind with its own fields, with the words each part is lit at (weak models copy the format). */
const FOCUS_EXAMPLE = JSON.stringify({
  heatmap: { ...BOARD_EXAMPLES.heatmap.heatmap, focus: [{ part: 'row-2', anchor: 'Along the rust row' }] },
});

/** The task's fixed part: identical for every question on a document, so it extends the cached prefix. */
export function askInstructions(language: string) {
  return `TASK: answer the learner's question as a short spoken micro-tour in ${JSON.stringify(language)} that points at
the document while it speaks.
${EXAMPLE_TASK}
${SOURCE_VISUAL_POLICY}
PLOT TOOL EXAMPLE (format only; choose the actual function for this question): ${JSON.stringify(BOARD_EXAMPLES.plot.plot)}
Actively choose a useful live visual for the answer (item 5 lists the kinds) and timed example frames for calculations or transformations. Use native scenes for vectors, matrices and custom visual explanations: positioned objects with stable id,type,x,y,w,h and optional color,text,values,plot,background; object types text/math/rect/circle/arrow/vector/matrix/plot, normalized0..1positions, signed endpoint deltas for arrows/vectors. Bind vector/arrow/circle objects to axes with plotId and data-domain x,y,endpoint deltas; never guess their normalized alignment with an embedded plot. Keep semantic identities across scene frames, make the transformation visible, and avoid foreground collisions. Use them whenever they clarify the answer. Measured source-component cues are sufficient for a straightforward diagram path; avoid decorative motion and duplicate boards.
Start with the actual PDF equation, figure, table or sentence and choose precise source cues when they suffice. A copied formula must preserve the source and be actively used through term emphasis, substitution or a connected plot. Never fill a sideboard with colorful prose, table descriptions or an input/output flow containing unexplained number pairs. Choose a separate visual only for an important insight that the PDF cues alone cannot show; function behavior calls for a plot, vector transformations for actual components, and meaningful numerical comparisons for charts. A recap or trivial unit conversion does not need another panel.
1. "answerable": "yes" if the document answers the question, "partly" if it answers part of it, "no" if it does not.
2. Write 1 to 3 steps. The first sentence of the first step answers the question directly. Each "say" has at most 100
   words in clear spoken sentences. Explain the intermediate reasoning and meaning of the result; do not compress a mechanism into a list of labels. Add a step only when the answer has parts, for example the idea, then the formula.
   The first step starts the voice, so keep it to about 40 words and put it on the page (the direct answer and its source cues); its board, if the answer needs one, belongs to the next step unless the whole answer is one step.
3. Say only what the document supports. Knowledge from outside it is allowed only as background: start that sentence
   with "As background," and point at nothing while saying it. When the document does not answer the question, say so
   plainly, then point at the closest passage.
4. Cues point at a listed ID while you speak; never say an ID aloud. "highlight" marks a sentence that states what you
   say (at most 2 per step). "box", "arrow" or "circle" marks a figure, panel or equation, with a "label" of at most 4
   words or empty. "spotlight" dims everything else. "note" writes a remark of at most 12 words next to a target.
   "anchor" is 2 to 6 words copied exactly from "say": the cue appears when the voice reaches them. Use 1 to 3 cues per
   step, on one page or one figure when you can. For a visible figure component, prefer its listed panel or detected
   text ID. Otherwise use "bounds": [left,top,right,bottom] between 0 and 1, tightly enclosing that component relative
   to the chosen TARGET, using the supplied image-frame locations. A text ID encloses the printed words only.
   Set "region" to "whole" when bounds are supplied; named regions are legacy fallback. Use arrows only for a precise
   component and circles only for an isolated small part. For larger panels use a box. Leave labels empty when the
   figure already names the part. A measured component/panel/text ID always uses action "box", even when the learner
   asks to "highlight" it; action "highlight" is exclusively for sentence IDs. Do not use spotlight or note on a measured
   ID. Never guess a position from a caption or substitute an overview for a specific component. Selected page crops
   have a different coordinate frame: no fine figure marks.
5. The board is optional, at most one item per step; otherwise its "kind" is "none" and the other fields stay empty.
${boardGuidance()}
   - formula: the whole formula in "latex" and 2 to 4 "terms", each a separate part with "latex" copied exactly from the formula, a "label" of 1 to 4 words and an "anchor" where "say" explains that term.
   - bars: 2 to 6 numbers copied exactly from the document or table cells, with their "unit".
   - flow: each "label" has at most 3 words; "edges" join the nodes.
   - plot: x/y ranges, curves [{expression,label}], optional parameter {from,to}. Safe expressions use x/a, arithmetic and whitelisted sin/cos/tanh/exp/log/sqrt/abs/relu/sigmoid/min/max/softmax(x,0); no code. Explain the mechanism; it is illustrative, never measured data, unless it plots the document's own formula.
6. "followups": two questions of at most 12 words that the learner could ask next. Each goes one step further than this
   answer and the conversation so far, is answered by the document, and was not asked before.
BOARD WITH FOCUS (format only, for a different document): ${FOCUS_EXAMPLE}
EXAMPLE OUTPUT for a different document:
${EXAMPLE}`;
}

function passageLine(p: Passage, doc: Doc): string {
  if (p.kind === 'section') return `${p.text} (page ${p.page}; for orientation, not a target)`;
  if (p.kind === 'sentence') return `[${p.id}] ${clip(p.text, 400)}`;
  const figure = doc.figures.find((f) => f.id === p.id);
  const panels = figure?.panels.map((x) => `${x.id}${x.label ? ` ${x.label}` : ''}`).join(', ');
  return `[${p.id}] ${clip(p.text, p.kind === 'figure' ? 500 : 300)} (page ${p.page})${panels ? ` | panels ${panels}` : ''}`;
}

/** The task's variable part: the question, the conversation so far, the narration and the retrieved passages. */
export function askContext(
  request: AskRequest,
  retrieval: Retrieval,
  doc: Doc,
  step?: Step,
  image?: TourImage,
  shown: readonly ShownBoard[] = [],
) {
  const lines = [`QUESTION: ${request.question}`];
  const { pointing } = retrieval;
  if (pointing)
    lines.push(
      pointing.bare
        ? `The question names no topic of its own: it asks about ${request.selection ? 'the selected region' : 'the figure or equation on screen'}. Explain that.`
        : `The learner points at ${request.selection ? 'a region' : 'a figure or equation on screen'}: the question is about it unless the question names something else.`,
    );
  if (request.selection) {
    const selected = selectedSourceIds(doc, request.selection);
    lines.push(
      `SELECTED REGION: page ${request.selection.page}, normalized rectangle ${JSON.stringify(request.selection.rect)}.`,
      'Two images are attached: the full PDF page for context, followed by an enlarged crop of the selected area. The learner is asking about this crop. The full document text is available above.',
      `Existing source IDs intersecting the region: ${selected.join(', ') || 'none; explain the visible content without inventing a source ID'}.`,
      'The selection image identifier is context only, never a cue target. Use existing listed document IDs for highlights and camera movement.',
    );
  }
  const history = retrieval.history ?? request.history ?? [];
  if (history.length) {
    lines.push('EARLIER IN THIS CONVERSATION (oldest first; the question may build on it):');
    for (const turn of history) lines.push(`Q: ${turn.question}`, `A: ${clip(turn.answer, 700)}`);
  }
  const narration = retrieval.narration ?? step?.say;
  if (narration) lines.push(`THE TOUR WAS SAYING: ${narration}`);
  // The titles of boards the tour showed elsewhere would pull an answer about the selection towards their topics.
  const seen = shownLine(pointing && !pointing.onStep ? shown.map(({ title, ...board }) => board) : shown);
  if (seen) lines.push(seen);
  if (retrieval.focus.length)
    lines.push(
      'IN FOCUS (on screen, asked about or named in the question):',
      ...retrieval.focus.map((p) => passageLine(p, doc)),
    );
  for (const table of retrieval.tables) {
    if (!table.text) {
      lines.push(`CELLS OF [${table.id}] (extracted, one line per block):`, ...table.lines);
      continue;
    }
    lines.push('TABLE AS READ (typed rows and columns; numbers exactly as printed; "-" is a blank cell):', table.text);
    if (table.views?.length)
      lines.push(
        'READY BOARDS BUILT FROM THE TABLE BY CODE (every number is a cell of the table or computed from cells): use one as it is, in the object of its kind (board.scatter, board.heatmap) or as board.bars, shorten its title or drop rows, or build your own by copying numbers exactly as printed.',
        ...table.views.map(viewText),
      );
  }
  if (retrieval.ranked.length)
    lines.push('RETRIEVED PASSAGES (best match first):', ...retrieval.ranked.map((p) => passageLine(p, doc)));
  if (!retrieval.focus.length && !retrieval.ranked.length) lines.push('No passage matched the question.');
  if (image) {
    lines.push(`The image of ${image.label} [${image.targetId}] is attached. Describe only what is visible or stated.`);
    const figure = image.kind === 'figure' && !request.selection && doc.figures.find((f) => f.id === image.targetId);
    if (figure) lines.push(figureFrameText(doc, figure));
    if (retrieval.measured?.length) lines.push(measuredFrameText(retrieval.measured));
  }
  lines.push('Point only at the IDs listed here.');
  return lines.join('\n');
}

/** Muse caps schema nesting at ten levels. Only the deeply nested scene leaves
 * are compact on the wire; full scene/plot/matrix validation still runs locally. */
export function answerProviderSchema<T>(schema: T): T {
  const copy = structuredClone(schema);
  const visit = (value: unknown): void => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    const node = value as Record<string, any>;
    if (node.properties?.kind?.enum?.includes('scene') && node.properties?.objects?.items?.properties) {
      const properties = node.properties.objects.items.properties;
      properties.values = { type: 'array', description: 'Matrix rows: arrays of finite numbers, up to 6 by 6.' };
      properties.plot = {
        type: 'object',
        description:
          'Native plot: kind plot; finite increasing x/y ranges; curves[{expression,label}], optional x_label,y_label,parameter{from,to}; safe math expressions only.',
      };
    }
    Object.values(node).forEach(visit);
  };
  visit(copy);
  return copy;
}

/**
 * The answer's schema: actions, answerability, regions and board kinds are enums, and cues may only target retrieved
 * IDs. Regions other than "whole" are offered only when the model can see the figure.
 */
export function answerSchema(retrieval: Retrieval, regions: readonly string[] = ['whole']) {
  // What a question retrieves is small, but a selection can cover a page: the focus comes first and the rest is cut.
  const ids = pick([...retrieval.sentences, ...retrieval.visuals], ASK_IDS);
  const text = (maxLength: number, description?: string) => ({
    type: 'string',
    maxLength,
    ...(description ? { description } : {}),
  });
  const object = (properties: Record<string, unknown>) => ({
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  });
  const anchor = text(80, 'A 2-6 word phrase copied exactly from say.');
  const cue = object({
    action: {
      type: 'string',
      enum: retrieval.measured?.some((t) => t.kind !== 'text')
        ? CUE_ACTIONS.filter((a) => a !== 'arrow' && a !== 'circle' && a !== 'spotlight')
        : CUE_ACTIONS,
    },
    target: ids.length ? { type: 'string', enum: ids } : { type: 'string', maxLength: 0 },
    region: {
      type: 'string',
      enum: retrieval.measured?.some((t) => t.kind !== 'text') ? ['whole'] : regions,
      description: 'Measured targets use whole; otherwise legacy relative region.',
    },
    label: text(100, 'box, arrow or circle: at most 4 words or empty; note: its text, at most 12 words.'),
    anchor,
  });
  if (regions.length > 1 && !retrieval.measured?.some((t) => t.kind !== 'text')) cue.properties.bounds = BOUNDS_SCHEMA;
  if (retrieval.measured?.length)
    cue.properties.members = {
      type: 'array',
      maxItems: 4,
      items: { type: 'string', enum: retrieval.measured.map((t) => t.id) },
    };
  const board = answerBoardSchema(anchor);
  const step = object({
    say: {
      type: 'string',
      minLength: 1,
      maxLength: 900,
      description: 'At most 100 spoken words; enough reasoning to understand the mechanism.',
    },
    cues: { type: 'array', maxItems: ids.length ? 4 : 0, items: cue },
    board,
  });
  step.properties.example = EXAMPLE_SCHEMA;
  return answerProviderSchema(
    object({
      plan: text(600),
      answerable: { type: 'string', enum: ANSWERABLE },
      steps: {
        type: 'array',
        minItems: 1,
        maxItems: 3,
        items: step,
      },
      followups: { type: 'array', minItems: 2, maxItems: 2, items: text(120) },
    }),
  );
}
