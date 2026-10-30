import { randomUUID } from 'node:crypto';
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
import { findAnchor, tourProblems } from './assemble';
import {
  boardPart,
  boardParts,
  checkBoard,
  checkBars,
  checkFlow,
  checkFormula,
  FLOW_NODE_IDS,
  type BoardKind,
} from './board';
import { checkExample, claimsNumericExample, exampleActions } from './example';
import { answerNarrationProblems, insightStep, readsSource } from './insight';
import { regionOf } from './direct';
import { CUE_ACTIONS } from './ask-authoring';
import { boardKindOf, labelIllustrative, NESTED_KINDS, repeatsShown, type ShownBoard } from './ask-boards';
import { ANSWERABLE, type AskAnswer, type AskTurn } from './ask-types';
import type { Retrieval } from './ask-retrieval';
import { groundedProblems } from './visual-rules';
import {
  exactBounds,
  figureTextTargets,
  groundedVisualMark,
  measuredCueTargets,
  visualCueProblems,
} from './visual-grounding';

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

/** Element IDs a model sometimes cites in its narration: "[p3.s12]", "(fig2.a)", "eq1", "equ2". */
const SPOKEN_ID = /\s*[[(]?\b(?:p\d+\.[sb]\d+|(?:fig|tab)\d+(?:\.[a-z])?|equ?\d+|sec-\d+(?:\.\d+)*|page\d+)\b[\])]?/g;

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

/** What a board has to meet beyond its own checks; ask.ts sets it from the question and the tour. */
export interface BoardRules {
  /** The question is about the document's results (a table is in focus): only the document's own numbers count. */
  results?: boolean;
  /** The tour's latest boards, which an answer does not draw again. */
  shown?: readonly ShownBoard[];
  /** Told the kind and the reasons when a board the model drew is not kept. */
  dropped?: (kind: string, problems: string[]) => void;
}

type Drawn = { item: BoardItem; focus: (number | null)[] };

/**
 * A board item from the model's board, or null when it is "none" or fails the checks of a tour step's board: its own
 * (a formula that KaTeX renders with terms that are exact separate parts of it, bars and every other document value
 * printed in `evidence`, the text the model was shown, a flow of 3 or more stages, sound dimensions, dates and
 * distributions; labels too long are refused, not cut), then the visual rules (a flow that is a chain, a plot of
 * straight lines or labels that are only numbers show nothing real) and, for a question about results, the document's
 * own numbers. A made-up case is labelled illustrative and a picture the tour just showed is not drawn again. Each part
 * carries the word where `say` explains it, for board_focus.
 */
export function boardFromAnswer(
  raw: unknown,
  say: string,
  evidence: string,
  rules: BoardRules = {},
): { item: BoardItem; focus: (number | null)[] } | null {
  if (!isRaw(raw)) return null;
  const kind = boardKindOf(raw);
  const drop = (problems: string[]) => {
    if (kind !== 'none') rules.dropped?.(kind, problems);
    return null;
  };
  const made = drawn(raw, kind, say, evidence, drop);
  if (!made) return null;
  const problems = groundedProblems(made.item, { results: rules.results ?? false });
  if (problems.length) return drop(problems);
  if (repeatsShown(made.item, rules.shown)) return drop(['it repeats a board the tour just showed']);
  return { ...made, item: labelIllustrative(made.item) };
}

/** The checked board of the kind the model chose, with the word each of its parts is spoken at. */
function drawn(
  raw: Raw,
  kind: string,
  say: string,
  evidence: string,
  drop: (problems: string[]) => null,
): Drawn | null {
  const at = (part: Raw | undefined) => (part ? anchorAt(say, str(part.anchor)) : null);
  // The item sits under its kind's name; a board whose fields are written flat (as answers once did) is read as well.
  const body = isRaw(raw[kind]) ? (raw[kind] as Raw) : raw;
  if (kind === 'formula') {
    const { item, problems } = checkFormula(body);
    // Each checked term keeps the anchor of the term it came from, matched by its LaTeX ignoring spaces.
    const squash = (s: string) => s.replace(/\s+/g, '');
    const given = list(body.terms);
    const source = (latex: string) => given.find((t) => squash(str(t.latex)) === squash(latex));
    return item ? { item, focus: item.terms.map((t) => at(source(t.latex))) } : drop(problems);
  }
  if (kind === 'flow') {
    // The stages in the order given, joined by the arrows the model drew, else each leading to the next.
    const given = list(body.nodes);
    const nodes = given.map((n, i) => ({ id: FLOW_NODE_IDS[i] ?? `node-${i + 1}`, label: n.label }));
    const arrows = list(body.edges).map((e) => [str(e.from), str(e.to)]);
    const edges = arrows.length ? arrows : nodes.slice(1).map((n, i) => [nodes[i].id, n.id]);
    const { item, problems } = checkFlow({ title: body.title, nodes, edges });
    return item
      ? { item, focus: item.nodes.map((n) => at(given[nodes.findIndex((m) => m.id === n.id)])) }
      : drop(problems);
  }
  if (kind === 'bars') {
    const given = list(body.bars);
    const bars = given.map((b) => ({ label: b.label, value: b.value }));
    const { item, problems } = checkBars({ ...body, bars }, evidence);
    return item ? { item, focus: given.map(at) } : drop(problems);
  }
  if (!(NESTED_KINDS as readonly string[]).includes(kind)) return null;
  const { focus: _focus, ...data } = body;
  const { item, problems } = checkBoard(kind as BoardKind, data, evidence);
  if (!item) return drop(problems.length ? problems : [`it has no ${kind} data; fill it or set the kind to none`]);
  // Parts spoken by their label come first (a curve, a scene object); `focus` entries name any part and its words.
  const lit: (number | null)[] = Array.from({ length: boardParts(item) }, () => null);
  if (item.kind === 'scene')
    item.objects.forEach((object, i) => (lit[i] = object.text ? anchorAt(say, object.text) : null));
  if (item.kind === 'plot') item.curves.forEach((curve, i) => (lit[i] = anchorAt(say, curve.label)));
  for (const entry of list(body.focus)) {
    const part = boardPart(item, str(entry.part));
    const spoken = anchorAt(say, str(entry.anchor));
    if (part >= 0 && spoken !== null) lit[part] = spoken;
  }
  return { item, focus: lit };
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
  /** What a board must meet beyond its own checks: results questions, the tour's latest boards. */
  boards?: BoardRules;
  /** The start of the step IDs, fixed for a question so that a step shown early and the whole answer agree. */
  idPrefix?: string;
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
  const board = example ? null : boardFromAnswer(raw.board, say, context.evidence, context.boards);
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

const MAX_STEPS = 3;

/** The steps of an answer as checked tour steps; the same steps come out of a half-written answer's first steps. */
export function buildSteps(raw: unknown, context: AnswerContext): Step[] {
  const view = viewer(context.doc);
  const highlighted = new Set<string>();
  const prefix = context.idPrefix ?? `ask-${randomUUID().slice(0, 8)}`;
  const steps: Step[] = [];
  for (const item of list(raw).slice(0, MAX_STEPS)) {
    const step = toStep(item, `${prefix}-${steps.length + 1}`, !steps.length, context, view, highlighted);
    if (step) steps.push(step);
  }
  return checked(steps, context);
}

/** The model's answer as checked tour steps, or null when no step survives. */
export function buildAnswer(value: unknown, context: AnswerContext): AskAnswer | null {
  if (!isRaw(value)) return null;
  if (answerVisualProblems(value, context).length) return null;
  const valid = buildSteps(value.steps, context);
  if (!valid.length) return null;
  const answerable = ANSWERABLE.find((a) => a === value.answerable) ?? 'partly';
  return { answerable, steps: valid, followups: followups(value.followups, context) };
}

/**
 * The steps of an answer still being written that can be shown now: all of its whole steps so far, when they already
 * pass what the finished answer must pass (visual cues, a worked example, narration that is not read from the page or
 * copied from the task), else null, and the answer waits for the whole call and its repairs. The first step is shown
 * whatever its board, since a wait costs more than a board; a later step whose board fails its checks is held back, so
 * that its correction can be made while the steps before it are spoken.
 */
export function readySteps(raw: unknown[], context: AnswerContext, authoringRules: readonly string[]): Step[] | null {
  const value = { steps: raw };
  const trial = { ...context, requireExample: context.requireExample || hasWorkedExample(value) };
  if (answerVisualProblems(value, trial).length || answerBoardProblems(value, trial, 1).length) return null;
  const steps = buildSteps(raw, trial);
  if (steps.length !== Math.min(raw.length, MAX_STEPS)) return null;
  if (steps.some((step) => readsSource(step.say, context.doc))) return null;
  return answerNarrationProblems(steps, authoringRules).length ? null : steps;
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
    if (isRaw(step.board) && boardKindOf(step.board) === 'scene') {
      const { focus: _focus, ...scene } = isRaw(step.board.scene) ? step.board.scene : step.board;
      problems.push(...checkBoard('scene', scene, context.evidence).problems);
    }
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

/** A board dropped only because the tour just showed it is a choice of the checks, not a fault of the answer. */
const CHOICE = /^it repeats a board the tour just showed$/;

/**
 * Why the boards of an answer's steps from `from` on (counting from 0) would not be drawn, as instructions for a
 * correction: each fails the checks of a tour step's board. A step with an example frames shows those instead.
 */
export function answerBoardProblems(value: unknown, context: AnswerContext, from = 0): string[] {
  if (!isRaw(value)) return [];
  return list(value.steps)
    .slice(0, MAX_STEPS)
    .flatMap((step, index) => {
      if (index < from || step.example !== undefined || !isRaw(step.board)) return [];
      const found: string[] = [];
      boardFromAnswer(step.board, spoken(str(step.say)), context.evidence, {
        ...context.boards,
        dropped: (kind, problems) =>
          found.push(...problems.filter((p) => !CHOICE.test(p)).map((p) => `Step ${index + 1}: board ${kind}: ${p}`)),
      });
      return found;
    });
}

/** A repair must retain an example once the response introduces a worked numerical case. */
export function hasWorkedExample(value: unknown): boolean {
  return (
    isRaw(value) &&
    list(value.steps).some((step) => step.example !== undefined || claimsNumericExample(spoken(str(step.say))))
  );
}
