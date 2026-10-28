import { SCENE_SCHEMA } from '../../../shared/scene';
import { checkExample, claimsNumericExample, exampleActions, EXAMPLE_SCHEMA, EXAMPLE_TASK } from './example';
import { checkBoard } from './board';
import { PLOT_SCHEMA } from '../../../shared/plot';
import { selectedSourceIds, validateSelection, type RegionSelection } from '../../../shared/selection';
import { selectionImages } from '../selection-image';
import { responseLanguage } from '../../../shared/languages';
import { documentLanguage } from './language';
import { answerNarrationProblems, insightStep, readsSource } from './insight';
import { randomUUID } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import {
  splitWords,
  type Action,
  type BoardItem,
  type CameraAction,
  type Color,
  type Doc,
  type Step,
  type Tour,
} from '../../../shared/paper';
import { ROOT } from '../config';
import type { Db } from '../db';
import { HttpError, ProcessingError } from '../errors';
import type { Completion, MuseClient, MuseMessage } from '../muse/client';
import { isContributorModel } from '../muse/models';
import { OFFICIAL_MODELS } from '../muse/pricing';
import type { FileStorage } from '../storage';
import type { TourImage } from '../tour-generator';
import { findAnchor, tourProblems } from './assemble';
import { BOARD_LIMITS, checkBars, checkFlow, checkFormula, FLOW_NODE_IDS } from './board';
import { imageParts, type Effort } from './calls';
import { REGION_NAMES, regionOf, tableLines } from './direct';
import { paperBlock, proseSentences } from './paper-block';
import { SHARED_RULES } from './prompts';
import {
  BOUNDS_SCHEMA,
  exactBounds,
  figureFrameText,
  figureTextTargets,
  groundedVisualMark,
  measuredCueTargets,
  measuredFrameText,
  visualCueProblems,
  type MeasuredTarget,
} from './visual-grounding';
import { measuredFigureTargets } from './measured-visuals';

// Ask (notes/HARNESS.md): retrieve passages in code, answer in one model call whose cues may only point at them, then
// turn the answer into canonical tour steps the player inserts as a micro-tour.

/** One earlier exchange; a follow-up question may build on it. */
export interface AskTurn {
  question: string;
  answer: string;
}
/** A learner's question, with where they are in the tour and what they are looking at. */
export interface AskRequest {
  question: string;
  responseLanguage?: string;
  tourId?: string;
  analysisId?: string;
  selection?: RegionSelection;
  stepId?: string;
  figureId?: string;
  history?: AskTurn[];
}
export const ANSWERABLE = ['yes', 'partly', 'no'] as const;
export type Answerable = (typeof ANSWERABLE)[number];
/** The answer as a micro-tour: steps in the tour contract, plus two questions to ask next. */
export interface AskAnswer {
  answerable: Answerable;
  language?: string;
  steps: Step[];
  followups: string[];
}

// ------------------------------------------------------------------ retrieval

export interface Passage {
  id: string;
  kind: 'sentence' | 'figure' | 'equation' | 'section';
  page: number;
  /** As the model reads it. */
  text: string;
}
/** Passages for one question and the IDs its cues may point at. */
export interface Retrieval {
  /** The current step's evidence and its neighbours, the figure asked about, and elements the question names. */
  focus: Passage[];
  /** The best BM25 matches that are not in focus, best first. */
  ranked: Passage[];
  sentences: string[];
  /** Figures, tables, their panels and equations. */
  visuals: string[];
  /** The extracted cells of the tables in focus, so an answer can quote and chart their numbers. */
  tables: { id: string; lines: string[] }[];
  /** Where the camera goes when a step points at nothing. */
  home?: string;
  measured?: MeasuredTarget[];
}

const STOP = new Set(
  `a about above after again all also am an and any are as at be because been before being between both but by can
  could did do does doing done during each either for from further had has have having he her here hers him his how i
  if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same
  she should so some such than that the their them then there these they this those through to too under until up
  upon us very was we were what when where whether which while who whom why will with within would you your`.split(
    /\s+/,
  ),
);

/** Rough stem: enough to match plurals and -ing/-ed forms ("keys" and "key", "scaled" and "scale"). */
function stem(word: string): string {
  let w = word;
  if (/(ss|ch|sh|x|z)es$/.test(w) && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (/[^aiosu]s$/.test(w) && w.length > 3) w = w.slice(0, -1);
  const suffix = /(ing|ed|ly)$/.exec(w);
  if (suffix && w.length - suffix[0].length >= 3) w = w.slice(0, -suffix[0].length);
  return w.length > 3 && w.endsWith('e') ? w.slice(0, -1) : w;
}

/** Search terms of a text: lower-case stems without stop words; "d_k" also yields "dk", as PDF text often writes it. */
export function searchTerms(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/\d+(?:[.,]\d+)*|[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*/gu) ?? []) {
    const token = raw.replace(/,(?=\d{3}\b)/g, '');
    const parts = token.includes('_') ? [...token.split('_'), token.replace(/_/g, '')] : [token];
    for (const part of parts)
      if (!STOP.has(part) && (part.length > 1 || /\d/.test(part))) out.push(/\d/.test(part) ? part : stem(part));
  }
  return out;
}

/** BM25 scores of each document (a list of terms) for weighted query terms. */
export function bm25(docs: string[][], query: Map<string, number>, k1 = 1.2, b = 0.75): number[] {
  const avg = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length) || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) if (query.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) if (query.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const [t, f] of tf) {
      const idf = Math.log(1 + (docs.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
      score += query.get(t)! * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg)));
    }
    return score;
  });
}

const figureName = (f: Doc['figures'][number]) => `${f.kind === 'table' ? 'Table' : 'Figure'} ${f.number}`;
const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
/** "Figure 3: caption", whether or not the extracted caption starts with its own "Fig. 3." or "Table III:". */
const captioned = (f: Doc['figures'][number]) =>
  `${figureName(f)}: ${f.caption.replace(/^\s*(?:fig(?:ure)?|tab(?:le)?)\b\.?\s*(?:\d[\w.]*|[ivxlc]+\b)\s*[:.]?\s*/i, '')}`;

/** Everything a question can be matched against, with the text BM25 searches (equations also by their surrounding sentences). */
function corpus(doc: Doc): { passage: Passage; search: string }[] {
  const out: { passage: Passage; search: string }[] = proseSentences(doc).map((s) => ({
    passage: { id: s.id, kind: 'sentence', page: s.page, text: s.text },
    search: s.text,
  }));
  for (const f of doc.figures) {
    const text = captioned(f);
    out.push({ passage: { id: f.id, kind: 'figure', page: f.page, text }, search: text });
  }
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const blocks = doc.blocks;
  for (const e of doc.equations) {
    // Extracted equation text is often garbled; the sentences around it say what it computes.
    const at = blocks.findIndex((b) => b.id === e.block);
    const before = at > 0 ? blocks[at - 1].sentences.at(-1) : undefined;
    const after = at >= 0 && at + 1 < blocks.length ? blocks[at + 1].sentences[0] : undefined;
    const around = [before, after].map((id) => (id ? (sentences.get(id)?.text ?? '') : '')).join(' ');
    const text = `Equation (${e.number}): ${e.text}`;
    out.push({ passage: { id: e.id, kind: 'equation', page: e.page, text }, search: `${text} ${around}` });
  }
  for (const s of doc.sections) {
    const text = `Section ${s.number ? `${s.number} ` : ''}${s.title}`;
    out.push({ passage: { id: s.id, kind: 'section', page: s.page, text }, search: text });
  }
  return out;
}

/** Elements the question names: "Figure 3", "Table II", "Eq. (2)", "Section 4.1". */
export function namedElements(doc: Doc, question: string): string[] {
  const ids: string[] = [];
  for (const m of question.matchAll(/\b(fig(?:ure)?s?|tab(?:le)?s?)\.?\s*([0-9]+[a-z]?|[ivxlc]+)\b/gi)) {
    const kind = m[1].toLowerCase().startsWith('fig') ? 'figure' : 'table';
    // "Figure 2a" names a panel of Figure 2: the figure brings its panels along.
    const numbers = [m[2], m[2].replace(/(?<=\d)[a-z]$/i, '')].map((n) => n.toLowerCase());
    const f = doc.figures.find((f) => f.kind === kind && numbers.includes(f.number.toLowerCase()));
    if (f) ids.push(f.id);
  }
  for (const m of question.matchAll(/\b(?:eq(?:uation)?s?)\.?\s*\(?([0-9]+[a-z]?)\)?/gi)) {
    const e = doc.equations.find((e) => e.number.toLowerCase() === m[1].toLowerCase());
    if (e) ids.push(e.id);
  }
  for (const m of question.matchAll(/(?:\bsec(?:tion)?s?\.?|§)\s*([0-9]+(?:\.[0-9]+)*)/gi)) {
    const s = doc.sections.find((s) => s.number === m[1]);
    if (s) ids.push(s.id);
  }
  return [...new Set(ids)];
}

const TASK =
  /\b(?:exercises?|tasks?|problems?|questions?|aufgaben?|übung(?:en)?|uebung(?:en)?)\s*([a-z]?\d+(?:\.\d+)*)(?:\s*[.(]?\s*([a-z]|[ivx]+)\s*\)?(?![\p{L}\d]))?/giu;

/** The blocks of an exercise sheet's task or part that the question names: "task 2b", "Aufgabe 1 (a)", "exercise 3.c". */
export function namedExercise(doc: Doc, question: string): string[] {
  const tasks = doc.exercises ?? [];
  const blocks: string[] = [];
  type Part = NonNullable<Doc['exercises']>[number]['parts'][number];
  const find = (parts: Part[], label: string): Part | undefined => {
    for (const part of parts) {
      const found = part.label.toLowerCase() === label ? part : find(part.parts ?? [], label);
      if (found) return found;
    }
    return undefined;
  };
  for (const m of tasks.length ? question.matchAll(TASK) : []) {
    const task = tasks.find((t) => t.number.toLowerCase() === m[1].toLowerCase());
    const part = task && m[2] ? find(task.parts, m[2].toLowerCase()) : undefined;
    if (task) blocks.push(...(part ?? task).blocks);
  }
  return [...new Set(blocks)];
}

/** Every element a tour step points at or moves the camera to. */
function stepTargets(step: Step): string[] {
  return step.actions.flatMap((a) =>
    'targets' in a ? a.targets : 'target' in a ? [a.target] : 'anchor' in a ? [a.anchor] : [],
  );
}

export function findStep(tour: Tour | undefined, stepId: string | undefined): Step | undefined {
  return stepId ? tour?.chapters.flatMap((c) => c.steps).find((s) => s.id === stepId) : undefined;
}

const RANKED = 12;
const TABLE_LINES = 40;
/** Words that point back at the conversation: the question builds on the previous exchange. */
const REFERRING = /\b(?:it|its|this|that|these|those|they|them|their|there|he|she|his|her|es|das|dies|diese[rsmn]?)\b/i;
/** A sentence whose first words refer back to the one before it. */
const ANAPHORIC = /^(?:\S+\s+){0,4}?(?:this|that|these|those|it|its|such|they|thus|hence)\b/i;
/** A question for a number: how many, how long, what size. */
const QUANTITY =
  /\b(?:how (?:many|much|big|large|long|small|fast|often|far|high|low|deep|wide)|what (?:value|size|number|percentage|amount|score)|wie (?:viele?|groß|lange?|hoch|oft|weit))\b/i;
// Short section titles win BM25's length normalisation too easily; they are context, not answers.
const KIND_WEIGHT: Record<Passage['kind'], number> = { sentence: 1, figure: 1, equation: 1, section: 0.6 };
const KIND_CAP: Record<Passage['kind'], number> = { sentence: RANKED, figure: 3, equation: 3, section: 2 };

/**
 * Retrieval in code: BM25 over prose sentences, captions, equations and section titles for the question (with the
 * previous question and the current narration as weaker context), plus what the learner is looking at.
 */
export function retrieve(doc: Doc, request: AskRequest, step?: Step): Retrieval {
  const query = new Map<string, number>();
  const weigh = (text: string | undefined, weight: number) => {
    for (const t of searchTerms(text ?? '')) query.set(t, Math.max(query.get(t) ?? 0, weight));
  };
  // A follow-up also searches with the exchange it builds on, more so when it refers back to it ("how big is it?").
  // "How long" asks for a number: "long" is not what the question is about.
  const refers = REFERRING.test(request.question);
  const quantity = QUANTITY.test(request.question);
  weigh(request.question.replace(QUANTITY, ' '), 1);
  weigh(request.history?.at(-1)?.question, refers ? 0.9 : 0.5);
  weigh(request.history?.at(-1)?.answer, refers ? 0.4 : 0.25);
  weigh(step?.say, 0.25);
  const items = corpus(doc);
  const byId = new Map(items.map((item) => [item.passage.id, item.passage]));
  const figures = new Map(doc.figures.map((f) => [f.id, f]));
  const panelOf = new Map(doc.figures.flatMap((f) => f.panels.map((p) => [p.id, f.id] as const)));
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));

  // In focus: the step's evidence with its neighbours, the figure asked about with its citing sentences, named elements.
  const order = items.filter((i) => i.passage.kind === 'sentence').map((i) => i.passage.id);
  const position = new Map(order.map((id, i) => [id, i]));
  const known = (id: string | undefined) => (id && byId.has(id) ? id : id ? panelOf.get(id) : undefined);
  const focus: string[] = [];
  const add = (id: string | undefined) => {
    const k = known(id);
    if (k && !focus.includes(k)) focus.push(k);
  };
  const selected = request.selection ? selectedSourceIds(doc, request.selection) : [];
  for (const id of selected) {
    add(id);
    blocks.get(id)?.sentences.forEach(add);
  }
  const evidence = (step ? stepTargets(step) : [])
    .flatMap((id) => blocks.get(id)?.sentences.slice(0, 4) ?? [id])
    .filter((id) => known(id));
  for (const id of evidence) {
    const at = position.get(id);
    if (at === undefined) add(id);
    else [order[at - 1], id, order[at + 1]].forEach(add);
  }
  const asked = [known(request.figureId)].find((id) => id && ['figure', 'equation'].includes(byId.get(id)!.kind));
  if (asked) {
    add(asked);
    figures.get(asked)?.referenced_by.slice(0, 2).forEach(add);
  }
  const named = namedElements(doc, request.question);
  named.forEach(add);
  // A task or part of an exercise sheet the question names: the start of its statement.
  const statement = namedExercise(doc, request.question)
    .flatMap((id) => blocks.get(id)?.sentences ?? [])
    .filter((id) => known(id))
    .slice(0, 4);
  statement.forEach(add);

  const scores = bm25(
    items.map((i) => searchTerms(i.search)),
    query,
  );
  // A question for a quantity ("how many heads?") prefers passages that print numbers.
  const weight = (p: Passage) => KIND_WEIGHT[p.kind] * (quantity && /\d/.test(p.text) ? 1.5 : 1);
  const taken = new Map<Passage['kind'], number>();
  const best = items
    .map((item, i) => ({ passage: item.passage, score: scores[i] * weight(item.passage), i }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .filter(({ passage }) => {
      const n = taken.get(passage.kind) ?? 0;
      if (n >= KIND_CAP[passage.kind]) return false;
      taken.set(passage.kind, n + 1);
      return true;
    })
    .slice(0, RANKED)
    .map((r) => r.passage);
  // A sentence that opens by referring back ("To counteract this effect, …") comes with the sentence before it.
  const before = (p: Passage) => {
    const at = p.kind === 'sentence' && ANAPHORIC.test(p.text) ? position.get(p.id) : undefined;
    return at ? [byId.get(order[at - 1])!] : [];
  };
  const ranked = [...new Map(best.flatMap((p) => [...before(p), p]).map((p) => [p.id, p])).values()].filter(
    (p) => !focus.includes(p.id),
  );

  const all = [...focus.map((id) => byId.get(id)!), ...ranked];
  const visuals = all.flatMap((p) =>
    p.kind === 'figure'
      ? [
          p.id,
          ...(figures.get(p.id)?.panels.map((x) => x.id) ?? []),
          ...(figures.get(p.id) ? figureTextTargets(doc, figures.get(p.id)!).map((b) => b.id) : []),
        ]
      : p.kind === 'equation'
        ? [p.id]
        : [],
  );
  const namedVisual = named.find((id) => byId.get(id)?.kind !== 'section');
  const tables = focus
    .flatMap((id) => {
      const table = figures.get(id);
      return table?.kind === 'table' ? [{ id, lines: tableLines(doc, table).slice(0, TABLE_LINES) }] : [];
    })
    .filter((t) => t.lines.length)
    .slice(0, 2);
  return {
    focus: focus.map((id) => byId.get(id)!),
    ranked,
    sentences: all.filter((p) => p.kind === 'sentence').map((p) => p.id),
    visuals: [...new Set(visuals)],
    tables,
    home:
      selected.map(known).find((id) => id && ['figure', 'equation'].includes(byId.get(id)!.kind)) ??
      selected.map(known).find(Boolean) ??
      asked ??
      namedVisual ??
      statement[0] ??
      known(evidence[0]) ??
      named[0] ??
      ranked[0]?.id,
  };
}

// ---------------------------------------------------------------- the call

export const CUE_ACTIONS = ['highlight', 'box', 'arrow', 'circle', 'spotlight', 'note'] as const;
const BOARD_KINDS = ['none', 'formula', 'flow', 'bars', 'plot', 'scene'] as const;
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
Actively choose useful live visuals for the answer: a plot for function behavior or parameter changes, bars for comparable quantities, and timed example frames for calculations or transformations. Use native scenes for vectors, matrices and custom visual explanations: positioned objects with stable id,type,x,y,w,h and optional color,text,values,plot,background; object types text/math/rect/circle/arrow/vector/matrix/plot, normalized0..1positions, signed endpoint deltas for arrows/vectors. Bind vector/arrow/circle objects to axes with plotId and data-domain x,y,endpoint deltas; never guess their normalized alignment with an embedded plot. Keep semantic identities across scene frames, make the transformation visible, and avoid foreground collisions. Use them whenever they clarify the answer. Measured source-component cues are sufficient for a straightforward diagram path; avoid decorative motion and duplicate boards.
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
   - "flow" for a process of 3 to 6 stages in order, each "label" at most 3 words.
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

/**
 * The answer's schema: actions, answerability, regions and board kinds are enums, and cues may only target retrieved
 * IDs. Regions other than "whole" are offered only when the model can see the figure.
 */
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
    kind: { type: 'string', enum: BOARD_KINDS },
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

// ------------------------------------------------------------ conversion

const MAX_WORDS = 100;
/** One pen for answers: boxes, arrows and circles in the pink of a tutor's pen, apart from the tour's own marks. */
const PEN: Record<'box' | 'arrow' | 'circle', Color> = { box: 'pink', arrow: 'pink', circle: 'pink' };
const SHA256 = /^[0-9a-f]{64}$/;

type Raw = Record<string, unknown>;
const isRaw = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const list = (v: unknown): Raw[] => (Array.isArray(v) ? v.filter(isRaw) : []);
const str = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
const firstWords = (s: string, n: number) => splitWords(s).slice(0, n).join(' ');

const SPOKEN_COMMANDS: Record<string, string> = {
  sqrt: 'square root of',
  cdot: 'times',
  times: 'times',
  frac: '',
  left: '',
  right: '',
};

/** Element IDs a model sometimes cites in its narration: "[p3.s12]", "(fig2.a)", "eq1". */
const SPOKEN_ID = /\s*[[(]?\b(?:p\d+\.[sb]\d+|(?:fig|tab)\d+(?:\.[a-z])?|eq\d+|sec-\d+(?:\.\d+)*|page\d+)\b[\])]?/g;

/**
 * Text as the voice should read it: no element IDs, markdown or LaTeX remnants ("$\sqrt{d_k}$" becomes "square root of
 * d k"), while prices and names such as "$5" or "C#" stay.
 */
function plain(text: string): string {
  return text
    .replace(SPOKEN_ID, '')
    .replace(/\$([^$]+)\$/g, '$1')
    .replace(
      /\\([a-zA-Z]+)/g,
      (_, name: string) => ` ${Object.hasOwn(SPOKEN_COMMANDS, name) ? SPOKEN_COMMANDS[name] : name} `,
    )
    .replace(/[_^]/g, ' ')
    .replace(/[{}`*\\]/g, '')
    .replace(/^#+\s*/, '')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

/** At most 100 words, cut after the last whole sentence when that keeps enough of it. */
export function spoken(text: string): string {
  const say = plain(text);
  const words = splitWords(say);
  if (words.length <= MAX_WORDS) return say;
  const cut = words.slice(0, MAX_WORDS).join(' ');
  const sentences = /^[\s\S]*[.!?](?=\s|$)/.exec(cut)?.[0];
  return sentences && splitWords(sentences).length >= 15 ? sentences : `${cut.replace(/[,;:]$/, '')}.`;
}

/** Word index where an anchor phrase starts in `say` (cleaned like the narration), or null when it is not there. */
const anchorAt = (say: string, anchor: string) => findAnchor(say, plain(anchor));

/** A pen label: at most 4 words, else none, since a cut-off label reads worse than no label (as in tours). */
function markLabel(label: string): { label?: string } {
  const text = label.replace(/[.,;:]+$/, '');
  return text && splitWords(text).length <= 4 && text.length <= 40 ? { label: text } : {};
}

/**
 * A board item from the model's flat board, or null when it is "none" or fails the board's own checks, which the tour
 * writer uses too: a formula that KaTeX renders with terms that are exact separate parts of it, bars of numbers printed
 * in `evidence` (the text the model was shown), a flow of 3 or more stages; labels too long are refused, not cut. Each
 * part carries the word where `say` explains it, for board_focus.
 */
export function boardFromAnswer(
  raw: unknown,
  say: string,
  evidence: string,
): { item: BoardItem; focus: (number | null)[] } | null {
  if (!isRaw(raw)) return null;
  if (raw.kind === 'scene') {
    const { item } = checkBoard('scene', raw.scene ?? raw, evidence);
    return item && item.kind === 'scene'
      ? { item, focus: item.objects.map((object) => (object.text ? anchorAt(say, object.text) : null)) }
      : null;
  }
  if (raw.kind === 'plot') {
    const { item } = checkBoard('plot', raw.plot ?? raw);
    return item && item.kind === 'plot' ? { item, focus: item.curves.map((c) => anchorAt(say, c.label)) } : null;
  }
  const at = (part: Raw | undefined) => (part ? anchorAt(say, str(part.anchor)) : null);
  if (raw.kind === 'formula') {
    const { item } = checkFormula(raw);
    // Each checked term keeps the anchor of the term it came from, matched by its LaTeX ignoring spaces.
    const squash = (s: string) => s.replace(/\s+/g, '');
    const given = list(raw.terms);
    const source = (latex: string) => given.find((t) => squash(str(t.latex)) === squash(latex));
    return item ? { item, focus: item.terms.map((t) => at(source(t.latex))) } : null;
  }
  if (raw.kind === 'flow') {
    // The stages in the order given, each leading to the next.
    const given = list(raw.nodes);
    const nodes = given.map((n, i) => ({ id: FLOW_NODE_IDS[i] ?? `node-${i + 1}`, label: n.label }));
    const edges = nodes.slice(1).map((n, i) => [nodes[i].id, n.id]);
    const { item } = checkFlow({ title: raw.title, nodes, edges });
    return item ? { item, focus: item.nodes.map((n) => at(given[nodes.findIndex((m) => m.id === n.id)])) } : null;
  }
  if (raw.kind === 'bars') {
    const given = list(raw.bars);
    const bars = given.map((b) => ({ label: b.label, value: b.value }));
    const { item } = checkBars({ ...raw, bars }, evidence);
    return item ? { item, focus: given.map(at) } : null;
  }
  return null;
}

export interface AnswerContext {
  doc: Doc;
  retrieval: Retrieval;
  documentId: string;
  question: string;
  history: AskTurn[];
  /** The text the model was given (passages and table cells): a bars board may only show numbers printed in it. */
  evidence: string;
  /** The figure whose image the model saw: only marks on it may point at a region. */
  imaged?: string;
  /** Once an answer starts a numerical example, its correction must retain a visible example. */
  requireExample?: boolean;
}

/** What the camera does to show an element, and which view it is in (one page of text, one figure, one equation). */
type View = { key: string; camera: CameraAction };

function viewer(doc: Doc): (id: string) => View | null {
  const pages = new Map([...doc.sentences, ...doc.sections].map((s) => [s.id, s.page]));
  const figureOf = new Map(
    doc.figures.flatMap((f) => [
      [f.id, f.id] as const,
      ...f.panels.map((p) => [p.id, f.id] as const),
      ...figureTextTargets(doc, f).map((b) => [b.id, f.id] as const),
    ]),
  );
  const equations = new Set(doc.equations.map((e) => e.id));
  return (id) => {
    const figure = figureOf.get(id);
    if (figure) return { key: `figure:${figure}`, camera: { type: 'zoom', target: figure } };
    if (equations.has(id)) return { key: `equation:${id}`, camera: { type: 'zoom', target: id } };
    const page = pages.get(id);
    return page ? { key: `page:${page}`, camera: { type: 'focus', target: id } } : null;
  };
}

/**
 * One canonical step. The camera opens on the first cue's target (focus for text, zoom for figures and equations) and
 * moves at most once more; cues fire at their anchors; a board item shows from the start and lights each part as the
 * narration reaches it.
 */
function toStep(
  raw: Raw,
  id: string,
  first: boolean,
  context: AnswerContext,
  view: (id: string) => View | null,
  highlighted: Set<string>,
): Step | null {
  const say = spoken(str(raw.say));
  const words = splitWords(say).length;
  if (words < 3) return null;
  const sentences = new Set(context.retrieval.sentences);
  const visuals = new Set(context.retrieval.visuals);
  const timing = (at: number) => (at > 0 ? { at_word: Math.min(at, words - 1) } : {});
  const cues = list(raw.cues)
    .flatMap((c) => {
      const measured = measuredCueTargets(str(c.target), c.members, context.retrieval.measured ?? []);
      return measured.length
        ? measured.map((t) => ({ ...c, target: t.target, bounds: t.region, region: 'whole', measured: true }))
        : [c];
    })
    .map((c) => ({
      action: str(c.action),
      measured: c.measured === true,
      target: str(c.target),
      region: str(c.region),
      bounds: c.bounds,
      label: str(c.label),
      found: anchorAt(say, str(c.anchor)),
      at: anchorAt(say, str(c.anchor)) ?? 0,
    }))
    .filter((c) =>
      c.action === 'highlight'
        ? sentences.has(c.target)
        : c.action === 'note'
          ? !!c.label && (sentences.has(c.target) || visuals.has(c.target))
          : (CUE_ACTIONS as readonly string[]).includes(c.action) && visuals.has(c.target),
    )
    .sort((a, b) => a.at - b.at);
  const actions: Action[] = [];
  let current: string | undefined;
  let moves = 0;
  const look = (target: string, at: number) => {
    const v = view(target);
    if (!v || v.key === current) return !!v;
    if (moves >= 2) return false;
    actions.push({ ...v.camera, ...timing(moves ? at : 0) });
    current = v.key;
    moves++;
    return true;
  };
  // A measured diagram is the teaching surface for this step. Supporting
  // prose remains evidence; its highlight must not move the camera off the diagram.
  const diagram = cues.find((cue) => cue.measured && cue.found !== null);
  if (diagram) look(diagram.target, 0);
  let highlights = 0;
  for (const cue of cues) {
    if (['box', 'arrow', 'circle'].includes(cue.action) && cue.found === null) continue;
    if (cue.action === 'highlight' && (highlights >= 2 || highlighted.has(cue.target))) continue;
    const supportingText =
      diagram && ['highlight', 'note'].includes(cue.action) && view(cue.target)?.key !== view(diagram.target)?.key;
    if (!supportingText && !look(cue.target, cue.at)) continue;
    const when = timing(cue.at);
    if (cue.action === 'highlight') {
      highlights++;
      highlighted.add(cue.target);
      actions.push({ type: 'highlight', targets: [cue.target], color: 'yellow', ...when });
    } else if (cue.action === 'note')
      actions.push({ type: 'note', anchor: cue.target, text: firstWords(cue.label, 12).slice(0, 140), ...when });
    else if (cue.action === 'spotlight') actions.push({ type: 'spotlight', target: cue.target, ...when });
    else if (cue.action === 'box' || cue.action === 'arrow' || cue.action === 'circle') {
      const invalid = cue.bounds !== undefined && !exactBounds(cue.bounds);
      const grounded = groundedVisualMark(
        context.doc,
        cue.target,
        invalid ? 'box' : cue.action,
        cue.bounds !== undefined ? exactBounds(cue.bounds) : regionOf(cue.region),
        invalid ? '' : cue.label,
        context.imaged,
      );
      actions.push({
        type: grounded.action,
        target: cue.target,
        ...(grounded.region ? { region: grounded.region } : {}),
        color: PEN[grounded.action],
        ...markLabel(grounded.label),
        ...when,
      });
    }
  }
  if (!moves && first && context.retrieval.home) look(context.retrieval.home, 0);
  const example = checkExample(raw.example, say).example;
  const board = example ? null : boardFromAnswer(raw.board, say, context.evidence);
  if (example) actions.push(...exampleActions(example));
  if (board) {
    const focus = board.focus.flatMap((at, part) =>
      at === null ? [] : [{ type: 'board_focus' as const, part, ...timing(at) }],
    );
    actions.splice(moves ? 1 : 0, 0, { type: 'board', item: board.item }, ...focus);
  }
  return insightStep({ id, say, actions }, context.doc);
}

/** Steps that pass the tour contract: the canonical schema, real IDs, at_word inside the narration. */
function checked(steps: Step[], context: AnswerContext): Step[] {
  const sha = context.doc.source.sha256;
  const tour = (s: Step[]): Tour => ({
    schema: 'paper-tour/tour@0.1',
    title: 'Answer',
    paper: context.documentId,
    ...(SHA256.test(sha) ? { doc_sha256: sha } : {}),
    chapters: [{ id: 'answer', title: 'Answer', steps: s }],
  });
  const ok = (s: Step[]) => !tourProblems(tour(s), context.doc).length;
  if (!steps.length || ok(steps)) return steps;
  // Drop just the actions the contract rejects, then any step that still fails.
  return steps.flatMap((step) => {
    const kept = { ...step, actions: step.actions.filter((a) => ok([{ ...step, actions: [a] }])) };
    return ok([kept]) ? [kept] : [];
  });
}

function followups(raw: unknown, context: AnswerContext): string[] {
  const asked = new Set(
    [context.question, ...context.history.map((t) => t.question)].map((q) => q.trim().toLowerCase()),
  );
  const out: string[] = [];
  for (const item of Array.isArray(raw) ? raw : []) {
    let q = str(item)
      .replace(/^(?:[-•*]|\d+[.)])\s+/, '')
      .replace(/^["'“‘]+|["'”’]+$/g, '')
      .trim();
    if (q.length > 120) q = q.slice(0, 120).replace(/\s+\S*$/, '');
    if (!q) continue;
    if (!/[?？]$/.test(q)) q = `${q.replace(/[.!;:,]+$/, '')}?`;
    if (!asked.has(q.toLowerCase()) && !out.some((o) => o.toLowerCase() === q.toLowerCase())) out.push(q);
  }
  return out.slice(0, 2);
}

/** The model's answer as checked tour steps, or null when no step survives. */
export function buildAnswer(value: unknown, context: AnswerContext): AskAnswer | null {
  if (!isRaw(value)) return null;
  if (answerVisualProblems(value, context).length) return null;
  const view = viewer(context.doc);
  const highlighted = new Set<string>();
  const prefix = `ask-${randomUUID().slice(0, 8)}`;
  const steps: Step[] = [];
  for (const raw of list(value.steps).slice(0, 3)) {
    const step = toStep(raw, `${prefix}-${steps.length + 1}`, !steps.length, context, view, highlighted);
    if (step) steps.push(step);
  }
  const valid = checked(steps, context);
  if (!valid.length) return null;
  const answerable = ANSWERABLE.find((a) => a === value.answerable) ?? 'partly';
  return { answerable, steps: valid, followups: followups(value.followups, context) };
}

/** Measured actions must survive conversion exactly; bad action/anchor requests a model correction. */
export function answerVisualProblems(value: unknown, context: AnswerContext): string[] {
  if (!isRaw(value)) return [];
  const steps = list(value.steps);
  if (context.requireExample && !steps.some((step) => step.example !== undefined))
    return [
      'The answer started a numerical worked example and needs example frames. Correct its visible example frames instead of removing the example or replacing it with narration alone.',
    ];
  return steps.flatMap((step, index) => {
    const problems = visualCueProblems(step.cues, context.imaged, context.retrieval.measured);
    if (isRaw(step.board) && step.board.kind === 'scene')
      problems.push(...checkBoard('scene', step.board.scene ?? step.board, context.evidence).problems);
    const say = spoken(str(step.say));
    problems.push(...checkExample(step.example, say, claimsNumericExample(say)).problems);
    for (const cue of list(step.cues)) {
      const measured = measuredCueTargets(str(cue.target), cue.members, context.retrieval.measured ?? []);
      if (measured.length && anchorAt(say, str(cue.anchor)) === null)
        problems.push(
          'A measured mark needs an anchor copied from the spoken explanation; choose words that are actually spoken in this step.',
        );
    }
    return problems.map((problem) => `Step ${index + 1}: ${problem}`);
  });
}

const MODEL_FAULTS = new Set(['muse_invalid_response', 'muse_output_truncated', 'muse_refused']);
// A checked multi-frame visual answer can need one correction. Keep a bounded
// request deadline without aborting ordinary scene authoring before it returns.
const ASK_TIMEOUT_MS = 180_000;
/** Low effort first; medium once when the first answer cannot answer or is unusable. Budgets include reasoning. */
const ATTEMPTS: { effort: Effort; maxTokens: number }[] = [
  { effort: 'low', maxTokens: 6_000 },
  { effort: 'medium', maxTokens: 12_000 },
];

export interface AskInput {
  client: MuseClient;
  doc: Doc;
  documentId: string;
  request: AskRequest;
  tour?: Tour;
  /** The crop of the figure asked about, when it was cheap to load. */
  image?: TourImage;
  /** Full-page context and crop rendered from the original PDF for a region question. */
  images?: TourImage[];
  language: string;
  signal?: AbortSignal;
  measureFigure?: typeof measuredFigureTargets;
}

/**
 * Answer one question: retrieve, call the model behind the shared prefix (SHARED_RULES and the paper block, as the tour
 * writer sends them, so the provider can reuse its cache), and convert the answer into checked steps.
 */
export async function answerQuestion(input: AskInput): Promise<{ answer: AskAnswer; completions: Completion[] }> {
  const { client, doc, request } = input;
  if (request.selection) validateSelection(request.selection, doc);
  const step = findStep(input.tour, request.stepId);
  const retrieval = retrieve(doc, request, step);
  const signal = AbortSignal.any([AbortSignal.timeout(ASK_TIMEOUT_MS), ...(input.signal ? [input.signal] : [])]);
  if (input.image?.kind === 'figure' && !request.selection) {
    retrieval.measured = await (input.measureFigure ?? measuredFigureTargets)(input.image, signal);
    retrieval.visuals.push(...retrieval.measured.map((t) => t.id));
  }
  const language = responseLanguage(request.responseLanguage)
    ? request.responseLanguage
    : (input.tour?.voices?.host?.lang ?? documentLanguage(doc, input.language));
  const authoringRules = [
    'The say fields contain only explanations addressed to the learner.',
    'Never narrate schema, rendering instructions or authoring rules.',
  ];
  const task = `${askInstructions(language)}\n${authoringRules.join(' ')}\nKeep quotations in the original document language. Explain them in the answer language.\n\n${askContext(request, retrieval, doc, step, input.image)}`;
  const messages: MuseMessage[] = [
    { role: 'developer', content: SHARED_RULES },
    { role: 'user', content: `<DOCUMENT>\n${paperBlock(doc)}\n</DOCUMENT>` },
    {
      role: 'user',
      content: [
        { type: 'text', text: task },
        ...imageParts([...(input.images ?? []), ...(input.image ? [input.image] : [])]),
      ],
    },
  ];
  const schema = answerSchema(
    retrieval,
    input.image?.kind === 'figure' && !request.selection ? REGION_NAMES : ['whole'],
  );
  const context: AnswerContext = {
    doc,
    retrieval,
    documentId: input.documentId,
    question: request.question,
    history: request.history ?? [],
    evidence: [...retrieval.focus, ...retrieval.ranked]
      .map((p) => p.text)
      .concat(retrieval.tables.flatMap((t) => t.lines))
      .join('\n'),
    imaged: request.selection || input.image?.kind !== 'figure' ? undefined : input.image.targetId,
  };
  const completions: Completion[] = [];
  let answer: AskAnswer | null = null;
  for (const { effort, maxTokens } of ATTEMPTS) {
    let value: unknown;
    try {
      const completion = await client.complete(
        messages,
        'ask_answer',
        schema,
        maxTokens,
        signal,
        undefined,
        undefined,
        effort,
      );
      completions.push(completion);
      value = completion.value;
    } catch (error) {
      // A usable first answer survives a failed retry; otherwise only the model's own faults earn a retry.
      if (answer) break;
      if (effort !== 'low' || !(error instanceof ProcessingError && MODEL_FAULTS.has(error.code))) throw error;
      continue;
    }
    context.requireExample ||=
      isRaw(value) &&
      list(value.steps).some((step) => step.example !== undefined || claimsNumericExample(spoken(str(step.say))));
    const visualProblems = answerVisualProblems(value, context);
    if (visualProblems.length) {
      console.warn(
        JSON.stringify({
          event: 'answer_visual_repair',
          documentId: input.documentId,
          attempt: completions.length,
          problems: visualProblems,
        }),
      );
      messages.push(
        { role: 'assistant', content: JSON.stringify(value) },
        {
          role: 'user',
          content: `Correct the visual targeting or worked example below. Keep valid evidence; correct the narration if example values or steps must change: ${[...new Set(visualProblems)].join(' ')}`,
        },
      );
      continue;
    }
    const candidate = buildAnswer(value, context);
    if (candidate?.steps.some((step) => readsSource(step.say, doc))) {
      messages.push(
        { role: 'assistant', content: JSON.stringify(value) },
        {
          role: 'user',
          content:
            'Explain the mechanism, consequence or intuition in your own words. Do not read the source aloud; retain its facts and exact quotations only when needed.',
        },
      );
      continue;
    }
    const narrationProblems = candidate ? answerNarrationProblems(candidate.steps, authoringRules) : [];
    if (narrationProblems.length) {
      console.warn(
        JSON.stringify({ event: 'answer_narration_repair', documentId: input.documentId, problems: narrationProblems }),
      );
      messages.push(
        { role: 'assistant', content: JSON.stringify(value) },
        {
          role: 'user',
          content: `Repair the answer: ${narrationProblems.join(' ')} Keep valid evidence and useful native boards. Return one coherent explanation without repeating steps or speaking internal instructions.`,
        },
      );
      continue;
    }
    answer = candidate ?? answer;
    if (answer && answer.answerable !== 'no') break;
  }
  if (!answer) throw new ProcessingError('muse_invalid_response', 'The model returned no usable answer.');
  console.log(
    JSON.stringify({
      event: 'answer_visuals',
      documentId: input.documentId,
      measuredTargets: retrieval.measured?.length ?? 0,
      steps: answer.steps.map((step) => ({
        id: step.id,
        actions: step.actions.reduce<Record<string, number>>((counts, action) => {
          counts[action.type] = (counts[action.type] ?? 0) + 1;
          return counts;
        }, {}),
      })),
    }),
  );
  if (responseLanguage(request.responseLanguage)) answer = { ...answer, language };
  return { answer, completions };
}

// ------------------------------------------------------------- service glue

/** The document's own model answers its questions; a Contributor model only with this paper's training consent. */
export function askModel(model: unknown, allowTraining: boolean, fallback: string): string {
  let id = typeof model === 'string' ? model.trim() : '';
  if (isContributorModel(id) && !allowTraining) id = id.replace(/-contributor$/, '');
  const known = Object.hasOwn(OFFICIAL_MODELS, id) ? OFFICIAL_MODELS[id] : undefined;
  return known?.tourCompatible && (allowTraining || !known.contributor) ? id : fallback;
}

/** Model failures in plain words for the learner; a key problem points to the settings, or for demos to the .env. */
export function askError(error: unknown, demo = false): unknown {
  if (!(error instanceof ProcessingError)) return error;
  if (['muse_not_configured', 'muse_auth_failed'].includes(error.code))
    return new HttpError(
      409,
      'model_not_configured',
      demo
        ? 'Demo questions use the server’s Meta API key: set MODEL_API_KEY in the root .env.'
        : 'Check your Meta API key under Profile & Settings, then ask again.',
    );
  if (error.code === 'muse_rate_limited')
    return new HttpError(429, 'model_busy', 'The model is busy right now. Ask again in a moment.');
  if (error.code === 'muse_timeout')
    return new HttpError(504, 'answer_timeout', 'The answer took too long. Ask again, or ask a shorter question.');
  if (error.transient)
    return new HttpError(503, 'model_unavailable', 'The model could not be reached. Ask again in a moment.');
  return new HttpError(502, 'answer_failed', 'The model could not answer this. Try asking it another way.');
}

const IMAGE_WAIT_MS = 2_500;
const IMAGE_MAX_BYTES = 1_500_000;

/** The figure (or the figure of the panel) asked about. */
const figureOf = (doc: Doc, id?: string) =>
  id ? doc.figures.find((f) => f.id === id || f.panels.some((p) => p.id === id)) : undefined;

function imageOf(figure: Doc['figures'][number], data: Buffer | null, jpeg: boolean): TourImage | undefined {
  if (!data || data.length > IMAGE_MAX_BYTES) return undefined;
  const dataUrl = `data:image/${jpeg ? 'jpeg' : 'png'};base64,${data.toString('base64')}`;
  return { targetId: figure.id, kind: figure.kind, page: figure.page, label: figureName(figure), dataUrl };
}

/** The crop of the figure asked about, only when it is small and arrives quickly; otherwise the caption is enough. */
export async function figureImage(
  db: Db,
  storage: FileStorage,
  analysisId: string,
  doc: Doc,
  figureId?: string,
): Promise<TourImage | undefined> {
  const figure = figureOf(doc, figureId);
  if (!figure) return undefined;
  try {
    const {
      rows: [asset],
    } = await db.query(
      "select storage_path,content_type from assets where analysis_id=$1 and logical_path=$2 and kind='figure'",
      [analysisId, figure.image],
    );
    if (!asset) return undefined;
    const data = await Promise.race([
      storage.download(asset.storage_path),
      new Promise<null>((resolve) => setTimeout(resolve, IMAGE_WAIT_MS, null).unref()),
    ]);
    return imageOf(figure, data, asset.content_type === 'image/jpeg');
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------- demo papers

/** Demo papers live in demo/<paper>/ (doc.json, tour.json, figures/), as the player serves them in development. */
export const DEMO_ROOT = resolve(ROOT, 'demo');
/** A demo folder name: letters, digits, "_", "." and "-", not starting with a dot and without "..". */
export const DEMO_PAPER = /^(?!.*\.\.)\w[\w.-]{0,79}$/;
const DEMO_MAX_BYTES = 32 * 1024 * 1024;

export interface DemoPaper {
  doc: Doc;
  tour?: Tour;
}

/** A file inside the demo root once links are followed (demo folders link to each other's files), else null. */
async function demoFile(root: string, ...path: string[]): Promise<string | null> {
  try {
    const base = await realpath(root);
    const file = await realpath(resolve(base, ...path));
    return file.startsWith(`${base}${sep}`) && (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

async function demoJson(file: string | null): Promise<unknown> {
  try {
    return file && (await stat(file)).size <= DEMO_MAX_BYTES ? JSON.parse(await readFile(file, 'utf8')) : undefined;
  } catch {
    return undefined;
  }
}

const isDoc = (v: unknown): v is Doc =>
  isRaw(v) &&
  v.schema === 'paper-tour/doc@0.1' &&
  isRaw(v.source) &&
  ['pages', 'sections', 'blocks', 'sentences', 'figures', 'equations'].every((key) => Array.isArray(v[key]));
const isTour = (v: unknown): v is Tour =>
  isRaw(v) &&
  Array.isArray(v.chapters) &&
  v.chapters.every(
    (c) =>
      isRaw(c) &&
      Array.isArray(c.steps) &&
      c.steps.every((s) => isRaw(s) && typeof s.say === 'string' && Array.isArray(s.actions)),
  );

/** A demo paper's doc.json and, when it has a usable one, its tour.json; null for a bad name or no doc.json. */
export async function loadDemo(paper: string, root = DEMO_ROOT): Promise<DemoPaper | null> {
  if (!DEMO_PAPER.test(paper)) return null;
  const doc = await demoJson(await demoFile(root, paper, 'doc.json'));
  if (!isDoc(doc)) return null;
  const tour = await demoJson(await demoFile(root, paper, 'tour.json'));
  return isTour(tour) ? { doc, tour } : { doc };
}

/** The crop of the demo figure asked about, from the paper folder the player shows it from. */
export async function demoImage(
  paper: string,
  doc: Doc,
  figureId?: string,
  root = DEMO_ROOT,
): Promise<TourImage | undefined> {
  const figure = figureOf(doc, figureId);
  const type = /\.(png|jpe?g)$/i.exec(figure?.image ?? '')?.[1].toLowerCase();
  if (!figure || !type || !DEMO_PAPER.test(paper)) return undefined;
  const file = await demoFile(root, paper, figure.image);
  try {
    return file && (await stat(file)).size <= IMAGE_MAX_BYTES
      ? imageOf(figure, await readFile(file), type !== 'png')
      : undefined;
  } catch {
    return undefined;
  }
}

/** A region question in local demos uses the same verified PDF renderer as signed-in documents. */
export async function demoSelectionImages(
  paper: string,
  doc: Doc,
  selection: RegionSelection,
  root = DEMO_ROOT,
  signal?: AbortSignal,
): Promise<TourImage[]> {
  const file = DEMO_PAPER.test(paper) ? await demoFile(root, paper, 'paper.pdf') : null;
  if (!file || (await stat(file)).size > DEMO_MAX_BYTES)
    throw new HttpError(409, 'source_unavailable', 'The original PDF is unavailable for this selection.');
  const local = { download: () => readFile(file) };
  return selectionImages(local, file, doc, selection, signal);
}
