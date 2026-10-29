import { sceneProblems } from '../../../shared/scene';
import { plotProblems } from '../../../shared/plot';
import { isTableTarget } from '../../../shared/tableTargets';
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
import { equationName } from './equations';
import { exampleActions } from './example';
import { insightStep } from './insight';
import type { PaperCard } from './card';
import { boardPart, regionOf, type BeatTargets, type Direction } from './direct';
import { groundedVisualMark } from './visual-grounding';

/** At most this many marks (boxes, arrows, circles) on one figure: one or two that name the parts beat many boxes. */
const MAX_MARKS = 4;
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
const markColor = (beat: Beat): Color => (beat.arc === 'evidence' || beat.move === 'evidence' ? 'green' : 'blue');

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
  return equation ? equationName(equation) : '';
}

/** One tour step from a beat and its direction; without a direction, the card's own words with a single pointer. */
export function beatStep(beat: Beat, targets: BeatTargets, direction: Direction | null, doc: Doc): Step {
  if (direction?.exampleProblems?.length) throw new Error(direction.exampleProblems.join(' '));
  if (direction?.visualProblems?.length) throw new Error(direction.visualProblems.join(' '));
  const name = elementName(beat, doc);
  const say = direction?.say ?? (name ? `Let's look at ${name}. ${beat.point}` : beat.point);
  const words = splitWords(say).length;
  const color = markColor(beat);
  const board = direction?.board;
  const example = direction?.example;
  // A slide without a sentence to point at is shown whole.
  const first = beat.evidence[0] ?? (beat.page ? `page${beat.page}` : '');
  const actions: Action[] = [beat.target ? { type: 'zoom', target: beat.target } : { type: 'focus', target: first }];
  // A step on several slides moves the camera when a highlight is on another slide than the one on screen.
  const pageOf = new Map(beat.slides ? doc.sentences.map((s) => [s.id, s.page]) : []);
  let shown = beat.slides ? (pageOf.get(first) ?? beat.page) : undefined;
  // The board item appears with the step; a formula step also outlines its equation on the page.
  if (board) actions.push({ type: 'board', item: board });
  if (example) actions.push(...exampleActions(example));
  if (beat.kind === 'formula' && beat.target) actions.push({ type: 'box', target: beat.target, color });
  let highlights = 0,
    marks = 0,
    lastPart = -1;
  let lastBoard: BoardItem | undefined;
  const focusWords = new Set<number>();
  const highlightedHere = new Set<string>();
  for (const cue of direction?.cues ?? []) {
    const found = findAnchor(say, cue.anchor);
    const at = Math.min(found ?? 0, words - 1);
    const timing = at > 0 ? { at_word: at } : {};
    if (cue.action === 'highlight') {
      // Past steps must not suppress a cue explicitly tied to this explanation.
      if (found === null || highlightedHere.has(cue.target)) continue;
      highlights++;
      highlightedHere.add(cue.target);
      const slide = pageOf.get(cue.target);
      if (slide !== undefined && slide !== shown) {
        actions.push({ type: 'focus', target: cue.target, ...timing });
        shown = slide;
      }
      actions.push({ type: 'highlight', targets: [cue.target], color: beat.tint ?? COLORS[beat.kind], ...timing });
    } else if (cue.action === 'board_focus') {
      // A part lights up when the narration names it: never without its board or anchor, nor twice in a row or at once.
      const active = example ? example.frames.filter((frame) => frame.at <= at).at(-1)?.item : board;
      if (active !== lastBoard) {
        lastPart = -1;
        lastBoard = active;
      }
      const part = active ? boardPart(active, cue.target) : -1;
      if (part < 0 || found === null || part === lastPart || focusWords.has(at)) continue;
      lastPart = part;
      focusWords.add(at);
      actions.push({ type: 'board_focus', part, ...timing });
    } else if (cue.action === 'box' || cue.action === 'arrow' || cue.action === 'circle') {
      if (found === null) continue;
      const tableTarget = isTableTarget(doc, cue.target);
      // Extracted blocks may merge rows. Never imply a precise value with an
      // arrow endpoint, a guessed image subdivision or a label on the table.
      if (marks >= MAX_MARKS) continue;
      marks++;
      const grounded = groundedVisualMark(
        doc,
        cue.target,
        cue.action,
        cue.bounds ?? regionOf(cue.region),
        cue.label,
        targets.imaged,
      );
      const mark = {
        target: cue.target,
        ...(grounded.region ? { region: grounded.region } : {}),
        ...markLabel(grounded.label),
        color,
        ...timing,
      };
      actions.push(
        grounded.action === 'box' || tableTarget
          ? { type: 'box', ...mark }
          : grounded.action === 'arrow'
            ? { type: 'arrow', ...mark }
            : { type: 'circle', ...mark },
      );
    } else if (cue.action === 'spotlight') actions.push({ type: 'spotlight', target: cue.target, ...timing });
    else actions.push({ type: 'note', anchor: cue.target, text: cue.label.trim().slice(0, 140), ...timing });
  }
  // Pointing is the point: a text step always marks its main sentence, a figure step outlines its figure.
  if (!beat.target && !highlights) {
    const first = beat.evidence.find((id) => targets.sentences.includes(id));
    if (first) {
      actions.push({ type: 'highlight', targets: [first], color: beat.tint ?? COLORS[beat.kind] });
    }
  }
  const marked = actions.some((a) => ['box', 'arrow', 'circle', 'spotlight', 'note'].includes(a.type));
  if (beat.target && !marked) actions.push({ type: 'box', target: beat.target, color });
  return insightStep({ id: beat.id, say, actions, ...(board || example ? { hold_ms: BOARD_HOLD_MS } : {}) }, doc);
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

/** The tour's board hygiene run again over its steps in order, after steps lost their boards. */
export function settleBoards(tour: Tour): Tour {
  const settle = boardSettler();
  return { ...tour, chapters: tour.chapters.map((chapter) => ({ ...chapter, steps: chapter.steps.map(settle) })) };
}

const round = (n: number) => String(Number(n.toPrecision(6)));
const squash = (s: string) => s.replace(/\s+/g, '').toLowerCase();

/**
 * What a board shows, as text: its kind and the values, latex, expressions, points or labels that make it that board.
 * Two boards with the same signature are the same picture; bars compare their values in any order. Null when a board
 * has nothing to compare (a scene of plain shapes).
 */
export function boardSignature(item: BoardItem): string | null {
  switch (item.kind) {
    case 'formula':
      return `formula|${squash(item.latex)}`;
    case 'bars':
      return `bars|${item.bars
        .map((b) => b.value)
        .sort((a, b) => a - b)
        .map(round)
        .join(',')}`;
    case 'flow':
      return `flow|${item.nodes
        .map((n) => squash(n.label))
        .sort()
        .join(',')}`;
    case 'plot':
      return `plot|${item.curves
        .map((c) => squash(c.expression))
        .sort()
        .join(',')}`;
    case 'heatmap':
      return `heatmap|${item.rows.join(',')}|${item.cols.join(',')}|${item.values.map((row) => row.map(round).join(',')).join(';')}`;
    case 'scatter':
      return `scatter|${item.points
        .map((p) => `${squash(p.label)}:${round(p.x)}:${round(p.y)}`)
        .sort()
        .join(',')}`;
    case 'shapes':
      return `shapes|${JSON.stringify(item.terms)}`;
    case 'scene': {
      const content = item.objects.flatMap((o) => [
        ...(o.text ? [`${o.type}:${squash(o.text)}`] : []),
        ...(o.values ? [`${o.type}:${o.values.map((row) => row.map(round).join(',')).join(';')}`] : []),
        ...(o.plot ? o.plot.curves.map((c) => `plot:${squash(c.expression)}`) : []),
      ]);
      return content.length ? `scene|${content.sort().join('|')}` : null;
    }
  }
}

/**
 * A board that repeats an earlier step's board (the same kind and data) is dropped together with the board_focus cues
 * that light up its parts; the narration stays and the board hygiene then clears or keeps the screen as for any step
 * without a board. The steps of one beat may repeat each other, so only earlier beats count; the beats at the `exempt`
 * indices (an exercise part's solution lines) are neither compared nor remembered.
 */
export function dropRepeatedBoards(
  steps: Step[][],
  exempt: ReadonlySet<number> = new Set(),
): {
  steps: Step[][];
  dropped: { step: string; kind: BoardItem['kind']; repeats: string }[];
} {
  const seen = new Map<string, string>();
  const dropped: { step: string; kind: BoardItem['kind']; repeats: string }[] = [];
  const kept = steps.map((list, beat) => {
    if (exempt.has(beat)) return list;
    const before = new Map(seen);
    const out = list.map((step) => {
      const ordered = step.actions.map((action, index) => ({ action, index }));
      ordered.sort((a, b) => (a.action.at_word ?? 0) - (b.action.at_word ?? 0) || a.index - b.index);
      const remove = new Set<number>();
      let repeating = false;
      for (const { action, index } of ordered) {
        if (action.type === 'board') {
          const signature = boardSignature(action.item);
          const earlier = signature ? before.get(signature) : undefined;
          repeating = earlier !== undefined;
          if (earlier !== undefined) {
            remove.add(index);
            dropped.push({ step: step.id, kind: action.item.kind, repeats: earlier });
          } else if (signature && !seen.has(signature)) seen.set(signature, step.id);
        } else if (action.type === 'board_clear') repeating = false;
        else if (action.type === 'board_focus' && repeating) remove.add(index);
      }
      return remove.size ? { ...step, actions: step.actions.filter((_, index) => !remove.has(index)) } : step;
    });
    return out;
  });
  return { steps: kept, dropped };
}

/**
 * A sentence the tour opens and closes with, such as a contract's "this is not legal advice": it leads the first step,
 * whose cues move on by its words, and ends the last (unless the tour is only begun: `closing` false).
 */
export function frameSteps(steps: Step[][], frame: string, closing = true): Step[][] {
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
  if (!closing) return out;
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
  let previousCamera: Action | undefined;
  const positioned = steps.map((list, index) =>
    list.map((step) => {
      if (
        preset === 'deep' &&
        plan.type === 'research_paper' &&
        plan.beats[index].kind === 'takeaway' &&
        previousCamera
      ) {
        // A verbal recap does not require a jump back to the abstract. Its source
        // remains in the teaching plan; the screen stays at the final explanation.
        return {
          ...step,
          actions: [
            { ...previousCamera, at_word: 0 },
            ...step.actions.filter((a) => ['board', 'board_focus', 'board_clear'].includes(a.type)),
          ],
        };
      }
      previousCamera = step.actions.find(isCamera) ?? previousCamera;
      return step;
    }),
  );
  const chapters = plan.chapters
    .map((chapter) => ({
      id: chapter.id,
      title: chapter.title,
      steps: plan.beats.flatMap((beat, i) => (beat.arc === chapter.id ? positioned[i].map(settle) : [])),
    }))
    .filter((chapter) => chapter.steps.length);
  return {
    schema: 'paper-tour/tour@0.1',
    title: card.title,
    paper: documentId,
    doc_sha256: doc.source.sha256,
    level: plan.type === 'research_paper' ? 'grad' : 'intro',
    doc_type: plan.type,
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
      if (action.type === 'board' && action.item.kind === 'scene')
        problems.push(...sceneProblems(action.item).map((p) => `${step.id}: ${p}`));
      if (action.type === 'board' && action.item.kind === 'plot')
        problems.push(...plotProblems(action.item).map((p) => `${step.id}: ${p}`));
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
    for (const action of [...step.actions].sort((a, b) => (a.at_word ?? 0) - (b.at_word ?? 0))) {
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
