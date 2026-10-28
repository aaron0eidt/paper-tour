import { SCENE_SCHEMA } from '../../../shared/scene';
import { PLOT_SCHEMA } from '../../../shared/plot';
import type { Doc, Step } from '../../../shared/paper';
import { selectedSourceIds } from '../../../shared/selection';
import type { TourImage } from '../tour-generator';
import { BOARD_KINDS, BOARD_LIMITS } from './board';
import { EXAMPLE_SCHEMA, EXAMPLE_TASK } from './example';
import { ANSWERABLE, type AskRequest } from './ask-types';
import type { Passage, Retrieval } from './ask-retrieval';
import { SOURCE_VISUAL_POLICY } from './prompts';
import { BOUNDS_SCHEMA, figureFrameText, measuredFrameText } from './visual-grounding';

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);

export const CUE_ACTIONS = ['highlight', 'box', 'arrow', 'circle', 'spotlight', 'note'] as const;
const NO_BOARD = {
  kind: 'none',
  title: '',
  latex: '',
  terms: [],
  nodes: [],
  bars: [],
  unit: '',
  higher_is_better: true,
};
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
        ...NO_BOARD,
        kind: 'formula',
        title: 'Learning-rate schedule',
        latex: 'lr = d^{-0.5} \\cdot \\min(s^{-0.5}, s \\cdot w^{-1.5})',
        terms: [
          { latex: 's \\cdot w^{-1.5}', label: 'linear warmup', anchor: 'grows linearly' },
          { latex: 's^{-0.5}', label: 'decay', anchor: 'inverse square root' },
        ],
      },
    },
  ],
  followups: ['How long is the warmup?', 'What happens without warmup?'],
});

/** The task's fixed part: identical for every question on a document, so it extends the cached prefix. */
export function askInstructions(language: string) {
  return `TASK: answer the learner's question as a short spoken micro-tour in ${JSON.stringify(language)} that points at
the document while it speaks.
${EXAMPLE_TASK}
${SOURCE_VISUAL_POLICY}
Actively choose useful live visuals for the answer: a plot for function behavior or parameter changes, bars for comparable quantities, and timed example frames for calculations or transformations. Use native scenes for vectors, matrices and custom visual explanations: positioned objects with stable id,type,x,y,w,h and optional color,text,values,plot,background; object types text/math/rect/circle/arrow/vector/matrix/plot, normalized0..1positions, signed endpoint deltas for arrows/vectors. Bind vector/arrow/circle objects to axes with plotId and data-domain x,y,endpoint deltas; never guess their normalized alignment with an embedded plot. Keep semantic identities across scene frames, make the transformation visible, and avoid foreground collisions. Use them whenever they clarify the answer. Measured source-component cues are sufficient for a straightforward diagram path; avoid decorative motion and duplicate boards.
Start with the actual PDF equation, figure, table or sentence and choose precise source cues when they suffice. A copied formula must preserve the source and be actively used through term emphasis, substitution or a connected plot. Never fill a sideboard with colorful prose, table descriptions or an input/output flow containing unexplained number pairs. Choose a separate visual only for an important insight that the PDF cues alone cannot show; function behavior calls for a plot, vector transformations for actual components, and meaningful numerical comparisons for charts. A recap or trivial unit conversion does not need another panel.
1. "answerable": "yes" if the document answers the question, "partly" if it answers part of it, "no" if it does not.
2. Write 1 to 3 steps. The first sentence of the first step answers the question directly. Each "say" has at most 100
   words in clear spoken sentences. Explain the intermediate reasoning and meaning of the result; do not compress a mechanism into a list of labels. Add a step only when the answer has parts, for example the idea, then the formula.
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
5. For a function intuition you may use board.kind plot and optional board.plot: kind plot, x/y ranges, curves [{expression,label}], optional parameter {from,to}. Safe expressions use x/a, arithmetic and whitelisted sin/cos/tanh/exp/log/sqrt/abs/relu/sigmoid/min/max/softmax(x,0); no code. Explain the mechanism and label it illustrative, never measured data.
6. The board is optional, at most one item per step; otherwise its "kind" is "none" and the other fields stay empty.
   - "formula" when the question is about an equation: its LaTeX, and 2 to 4 terms, each a separate part with "latex"
     copied exactly from the formula, a "label" of 1 to 4 words and an "anchor" where "say" explains that term.
   - "bars" to compare 2 to 6 numbers copied exactly from the passages or table cells, with their "unit".
   - "flow" only for informative dependencies, branching, feedback or changing values that source annotations cannot show; never for a plain list of stages. Each "label" has at most 3 words.
6. "followups": two questions of at most 12 words that the learner could ask next. Each goes one step further than this
   answer and the conversation so far, is answered by the document, and was not asked before.
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
export function askContext(request: AskRequest, retrieval: Retrieval, doc: Doc, step?: Step, image?: TourImage) {
  const lines = [`QUESTION: ${request.question}`];
  if (request.selection) {
    const selected = selectedSourceIds(doc, request.selection);
    lines.push(
      `SELECTED REGION: page ${request.selection.page}, normalized rectangle ${JSON.stringify(request.selection.rect)}.`,
      'Two images are attached: the full PDF page for context, followed by an enlarged crop of the selected area. The learner is asking about this crop. The full document text is available above.',
      `Existing source IDs intersecting the region: ${selected.join(', ') || 'none; explain the visible content without inventing a source ID'}.`,
      'The selection image identifier is context only, never a cue target. Use existing listed document IDs for highlights and camera movement.',
    );
  }
  if (request.history?.length) {
    lines.push('EARLIER IN THIS CONVERSATION (oldest first; the question may build on it):');
    for (const turn of request.history) lines.push(`Q: ${turn.question}`, `A: ${clip(turn.answer, 700)}`);
  }
  if (step) lines.push(`THE TOUR WAS SAYING: ${step.say}`);
  if (retrieval.focus.length)
    lines.push(
      'IN FOCUS (on screen, asked about or named in the question):',
      ...retrieval.focus.map((p) => passageLine(p, doc)),
    );
  for (const table of retrieval.tables)
    lines.push(`CELLS OF [${table.id}] (extracted, one line per block):`, ...table.lines);
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
  const ids = [...retrieval.sentences, ...retrieval.visuals];
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
  const limits = BOARD_LIMITS;
  const parts = (max: number, item: object) => ({ type: 'array', maxItems: max, items: item });
  const board = object({
    kind: { type: 'string', enum: ['none', ...BOARD_KINDS] },
    title: text(limits.title),
    latex: text(400, 'formula only: the LaTeX of the whole formula.'),
    terms: parts(
      limits.terms[1],
      object({ latex: text(160, 'Copied exactly from latex.'), label: text(limits.termLabel), anchor }),
    ),
    nodes: parts(limits.nodes[1], object({ label: text(limits.nodeLabel), anchor })),
    bars: parts(limits.bars[1], object({ label: text(limits.barLabel), value: { type: 'number' }, anchor })),
    unit: text(limits.unit),
    higher_is_better: { type: 'boolean' },
  });
  board.properties.plot = PLOT_SCHEMA;
  board.properties.scene = SCENE_SCHEMA;
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
