import { plotProblems } from '../../../shared/plot';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  DEFAULT_HOLD_MS,
  splitWords,
  type Action,
  type BoardItem,
  type Color,
  type Doc,
  type Step,
  type Tour,
} from '../../../shared/paper';
import { ROOT } from '../config';
import { indexElements } from '../elements';
import type { Beat, BeatKind, Preset, TourPlan } from './beats';
import { boardParts } from './board';
import { insightStep } from './insight';
import type { PaperCard } from './card';
import { boardPart, regionOf, type BeatTargets, type Direction } from './direct';

/** At most this many marks (boxes, arrows, circles) on one figure: one or two that name the parts beat many boxes. */
const MAX_MARKS = 3;
/** A short pause after a step that shows a board, so its last animation settles before the next step. */
const BOARD_HOLD_MS = 800;
/** Narration pace at rate 1, for the length estimate. */
const WORDS_PER_SECOND = 2.6;

const COLORS: Record<BeatKind, Color> = {
  problem: 'yellow',
  idea: 'yellow',
  method: 'blue',
  figure: 'blue',
  formula: 'blue',
  result: 'green',
  limitation: 'orange',
  takeaway: 'yellow',
  overview: 'yellow',
  point: 'blue',
  exercise: 'blue',
};

/**
 * Word index of an anchor phrase in `say`: the first exact match, else the best match of at least two words; null when
 * the phrase is not there.
 */
export function findAnchor(say: string, anchor: string): number | null {
  const token = (w: string) => w.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
  const words = splitWords(say).map(token);
  const phrase = splitWords(anchor).map(token).filter(Boolean);
  let best = 0,
    bestScore = 0;
  for (let i = 0; i < words.length && bestScore < phrase.length; i++) {
    let score = 0;
    for (let k = 0; k < phrase.length && i + k < words.length; k++) if (words[i + k] === phrase[k]) score++;
    if (score > bestScore) [best, bestScore] = [i, score];
  }
  return phrase.length && bestScore >= Math.min(2, phrase.length) ? best : null;
}

/** Like findAnchor, but 0 (the start of the step) when the phrase is not found. */
export function anchorWord(say: string, anchor: string): number {
  return findAnchor(say, anchor) ?? 0;
}

/** Marks on a figure or equation share the step's colour: blue while explaining the method, green for the evidence. */
const markColor = (beat: Beat): Color => (beat.arc === 'evidence' ? 'green' : 'blue');

/** A mark's label: at most 4 words, else none, since a cut-off label reads worse than no label. */
function markLabel(label: string): { label?: string } {
  const text = label
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.,;:]+$/, '');
  return text && text.split(' ').length <= 4 && text.length <= 40 ? { label: text } : {};
}

const isCamera = (a: Action) => a.type === 'focus' || a.type === 'zoom';

function elementName(beat: Beat, doc: Doc): string {
  const figure = doc.figures.find((f) => f.id === beat.target);
  if (figure) return `${figure.kind === 'table' ? 'Table' : 'Figure'} ${figure.number}`;
  const equation = doc.equations.find((e) => e.id === beat.target);
  return equation ? `Equation ${equation.number}` : '';
}

/** One tour step from a beat and its direction; without a direction, the card's own words with a single pointer. */
export function beatStep(
  beat: Beat,
  targets: BeatTargets,
  direction: Direction | null,
  doc: Doc,
  used: Set<string>,
): Step {
  const name = elementName(beat, doc);
  const say = direction?.say ?? (name ? `Let's look at ${name}. ${beat.point}` : beat.point);
  const words = splitWords(say).length;
  const color = markColor(beat);
  const board = direction?.board;
  const actions: Action[] = [
    beat.target ? { type: 'zoom', target: beat.target } : { type: 'focus', target: beat.evidence[0] },
  ];
  // The board item appears with the step; a formula step also outlines its equation on the page.
  if (board) actions.push({ type: 'board', item: board });
  if (beat.kind === 'formula' && beat.target) actions.push({ type: 'box', target: beat.target, color });
  let highlights = 0,
    marks = 0,
    lastPart = -1;
  const focusWords = new Set<number>();
  for (const cue of direction?.cues ?? []) {
    const found = findAnchor(say, cue.anchor);
    const at = Math.min(found ?? 0, words - 1);
    const timing = at > 0 ? { at_word: at } : {};
    if (cue.action === 'highlight') {
      if (highlights >= 2 || used.has(cue.target)) continue;
      highlights++;
      used.add(cue.target);
      actions.push({ type: 'highlight', targets: [cue.target], color: beat.tint ?? COLORS[beat.kind], ...timing });
    } else if (cue.action === 'board_focus') {
      // A part lights up when the narration names it: never without its board or anchor, nor twice in a row or at once.
      const part = board ? boardPart(board, cue.target) : -1;
      if (part < 0 || found === null || part === lastPart || focusWords.has(at)) continue;
      lastPart = part;
      focusWords.add(at);
      actions.push({ type: 'board_focus', part, ...timing });
    } else if (cue.action === 'box' || cue.action === 'arrow' || cue.action === 'circle') {
      if (marks >= MAX_MARKS) continue;
      marks++;
      const region = regionOf(cue.region);
      const mark = { target: cue.target, ...(region ? { region } : {}), ...markLabel(cue.label), color, ...timing };
      actions.push(
        cue.action === 'box'
          ? { type: 'box', ...mark }
          : cue.action === 'arrow'
            ? { type: 'arrow', ...mark }
            : { type: 'circle', ...mark },
      );
    } else if (cue.action === 'spotlight') actions.push({ type: 'spotlight', target: cue.target, ...timing });
    else actions.push({ type: 'note', anchor: cue.target, text: cue.label.trim().slice(0, 140), ...timing });
  }
  // Pointing is the point: a text step always marks its main sentence, a figure step outlines its figure.
  if (!beat.target && !highlights) {
    const first = beat.evidence.find((id) => !used.has(id) && targets.sentences.includes(id));
    if (first) {
      used.add(first);
      actions.push({ type: 'highlight', targets: [first], color: beat.tint ?? COLORS[beat.kind] });
    }
  }
  const marked = actions.some((a) => ['box', 'arrow', 'circle', 'spotlight', 'note'].includes(a.type));
  if (beat.target && !marked) actions.push({ type: 'box', target: beat.target, color });
  return insightStep({ id: beat.id, say, actions, ...(board ? { hold_ms: BOARD_HOLD_MS } : {}) }, doc);
}

/**
 * Board hygiene in tour order. The board keeps its item across steps until it is replaced or cleared, so a step without
 * its own item clears the one an earlier step left, right after its camera move; board_focus only follows a board item
 * of the same step.
 */
function boardSettler() {
  let shown = false;
  return (step: Step): Step => {
    const item = step.actions.findIndex((a) => a.type === 'board');
    const actions = step.actions.filter((a, i) => a.type !== 'board_focus' || (item >= 0 && i > item));
    if (item < 0 && shown) actions.splice(actions.findIndex(isCamera) + 1, 0, { type: 'board_clear' });
    shown = item >= 0;
    return { ...step, actions };
  };
}

/**
 * A sentence the tour opens and closes with, such as a contract's "this is not legal advice": it leads the first step,
 * whose cues move on by its words, and ends the last.
 */
export function frameSteps(steps: Step[][], frame: string): Step[][] {
  const out = steps.map((list) => [...list]);
  const firstBeat = out.findIndex((list) => list.length);
  if (firstBeat < 0 || !frame.trim()) return out;
  const shift = splitWords(frame).length;
  const first = out[firstBeat][0];
  out[firstBeat][0] = {
    ...first,
    say: `${frame} ${first.say}`,
    actions: first.actions.map((a) => (isCamera(a) ? a : { ...a, at_word: (a.at_word ?? 0) + shift })),
  };
  const lastBeat = out.length - 1 - [...out].reverse().findIndex((list) => list.length);
  const last = out[lastBeat].at(-1)!;
  out[lastBeat][out[lastBeat].length - 1] = { ...last, say: `${last.say} ${frame}` };
  return out;
}

/** The tour from its plan: each chapter's steps in order (an exercise beat gives several), with board hygiene. */
export function assembleTour(
  card: PaperCard,
  plan: TourPlan,
  steps: Step[][],
  doc: Doc,
  documentId: string,
  language: string,
  preset: Preset,
): Tour {
  const settle = boardSettler();
  const chapters = plan.chapters
    .map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      steps: plan.beats.flatMap((beat, i) => (beat.arc === chapter.id ? steps[i].map(settle) : [])),
    }))
    .filter((chapter) => chapter.steps.length);
  return {
    schema: 'paper-tour/tour@0.1',
    title: card.title,
    paper: documentId,
    doc_sha256: doc.source.sha256,
    level: plan.type === 'research_paper' ? 'grad' : 'intro',
    voices: { host: { lang: language, rate: 1 } },
    chapters,
    preset,
    ...(card.suggested_questions.length ? { suggested_questions: card.suggested_questions } : {}),
  };
}

const canonical = JSON.parse(readFileSync(resolve(ROOT, 'schema/tour.schema.json'), 'utf8'));
const checkCanonical = new Ajv2020({ strict: false, allErrors: true }).compile(canonical);

/**
 * Contract problems of each action on its own: the canonical schema, real element IDs, at_word within the narration
 * and regions with an area.
 */
export function tourProblems(tour: Tour, doc: Doc): string[] {
  const problems = checkCanonical(tour)
    ? []
    : (checkCanonical.errors ?? []).slice(0, 8).map((e) => `${e.instancePath || '/'}: ${e.message}`);
  const ids = new Set(indexElements(doc).map((e) => e.id));
  for (const step of tour.chapters.flatMap((c) => c.steps)) {
    const words = splitWords(step.say).length;
    for (const action of step.actions) {
      if (action.type === 'board' && action.item.kind === 'plot') problems.push(...plotProblems(action.item).map((p) => `${step.id}: ${p}`));
      const used =
        'target' in action
          ? [action.target]
          : 'targets' in action
            ? action.targets
            : 'anchor' in action
              ? [action.anchor]
              : [];
      for (const id of used) if (!ids.has(id)) problems.push(`${step.id}: unknown element ${id}`);
      if (action.at_word !== undefined && action.at_word >= words)
        problems.push(`${step.id}: at_word past the narration`);
      const region = 'region' in action ? action.region : undefined;
      if (region && !(region[2] > region[0] && region[3] > region[1])) problems.push(`${step.id}: region without area`);
    }
  }
  return problems;
}

/** Board order across the tour: board_focus lights up a part of an item shown earlier in the same step. */
export function boardProblems(tour: Tour): string[] {
  const problems: string[] = [];
  for (const step of tour.chapters.flatMap((c) => c.steps)) {
    let item: BoardItem | null = null;
    for (const action of step.actions) {
      if (action.type === 'board') item = action.item;
      else if (action.type === 'board_clear') item = null;
      else if (action.type === 'board_focus' && !(item && action.part < boardParts(item)))
        problems.push(`${step.id}: board_focus ${action.part} has no board part in this step`);
    }
  }
  return problems;
}

/** Estimated playing time in seconds: the narration at rate 1 plus each step's pause. */
export function tourSeconds(tour: Tour): number {
  const steps = tour.chapters.flatMap((c) => c.steps);
  const seconds = (s: Step) => splitWords(s.say).length / WORDS_PER_SECOND + (s.hold_ms ?? DEFAULT_HOLD_MS) / 1000;
  return Math.round(steps.reduce((sum, s) => sum + seconds(s), 0));
}
