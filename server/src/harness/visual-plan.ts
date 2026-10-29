import type { Doc, DocFigure } from '../../../shared/paper';
import type { Beat } from './beats';
import { BOARD_KINDS, LEGACY_BOARD_KINDS, type BoardKind } from './board';
import type { PaperCard } from './card';
import { unitTaskLines } from './unit-task';
import { baseRowName, gridOf, resultTable, tableText } from './tables';

// The tour's visual plan (notes/VISUALS-V2.md): one call after the beats are planned and before they are directed.
// It sees the whole document card and every beat, so it can give each step the visual that makes its point click, and
// give no two steps the same picture. Code checks the plan; a step's direction then offers only its planned board.

/** A board kind, or none: teach on the page with highlights and marks. */
export type PlannedKind = BoardKind | 'none';
/** What one step shows on the side board: the kind, what the learner sees, and the data it uses. */
export interface StepVisual {
  visual: PlannedKind;
  idea: string;
  data: string;
  /**
   * The kinds this step's worked-example frames may use, when it may carry one (allocateFrames): its own planned kind and
   * the kinds the plan leaves free, so that frames count toward the tour's kind limits. Unset: any frame kind.
   */
  frames?: BoardKind[];
}
/** The plan by beat ID. Every planned beat has an entry; a beat without one (an exercise part) is not planned. */
export type VisualPlan = Map<string, StepVisual>;

export const IDEA_WORDS = 40;
export const DATA_WORDS = 30;
/** At most this share of the steps get a board; the rest teach on the page. */
export const BOARD_SHARE = 0.6;
/** Diversity first: each kind once in a tour; a formula or a plot may return for a second key equation. */
export const kindLimit = (kind: BoardKind) => (kind === 'formula' || kind === 'plot' ? 2 : 1);

/**
 * The beats the plan covers: all of them, or on an exercise sheet only the tasks and parts (its overview and takeaway
 * have no visual of their own). A task's solution lines are formula boards in any case; its visual shows the method.
 */
export const plannableBeats = (beats: Beat[]) =>
  beats.some((beat) => beat.unit) ? beats.filter((beat) => beat.unit) : beats;

/** What the plan is for: an exercise sheet's tasks, whose solution lines stay formula boards, or the steps of a tour. */
export interface PlanOptions {
  sheet?: boolean;
}
/** The kinds an exercise sheet's plan offers: a formula is what the solution lines already are. */
export const sheetKinds = () => BOARD_KINDS.filter((kind) => kind !== 'formula');

/** Planned kinds that show a relationship themselves: a worked-example sequence is never forced on their steps. */
const RELATIONAL_KINDS: readonly string[] = ['heatmap', 'scatter', 'shapes', 'plot'];
/** The kinds that show a worked case's mechanism, best first, which the frames of a step planned as a formula may add. */
const MECHANISM_KINDS: readonly BoardKind[] = ['plot', 'scene', 'flow', 'bars'];

/**
 * Whether a step may carry a worked example (example frames) and whether it must. Without a plan a step may always, and
 * a formula detail must. A planned relationship (heatmap, scatter, shapes, plot) is the visual itself, with no example.
 * A step planned without a board has example frames only when it must have a worked example.
 */
export function exampleRules(beat: Beat, visual?: StepVisual): { offered: boolean; required: boolean } {
  const detail = beat.kind === 'formula' && !!beat.detail;
  if (!visual) return { offered: true, required: detail };
  if (RELATIONAL_KINDS.includes(visual.visual)) return { offered: false, required: false };
  return { offered: visual.visual !== 'none' || detail, required: detail };
}

/** The kinds a step's example frames may use: those the plan allotted them (allocateFrames), else every legacy kind. */
export const exampleKinds = (visual?: StepVisual): readonly BoardKind[] =>
  visual?.frames?.length ? visual.frames : LEGACY_BOARD_KINDS;

/**
 * Gives every step that may carry a worked example the kinds its frames may use, so that the frames count toward the
 * tour's kind limits and its diversity. A step planned as bars, flow or scene shows its example in that kind, as formula
 * cards where the formula limit has room. A step planned as a formula, or one without a visual that must show an example,
 * may also use the kinds that show a mechanism and that the plan has not used up: each unit of room goes to one such
 * step, in turn, so that two steps never take the same room.
 */
export function allocateFrames(plan: VisualPlan, beats: Beat[]): VisualPlan {
  const used = new Map<BoardKind, number>();
  for (const entry of plan.values())
    if (entry.visual !== 'none') used.set(entry.visual, (used.get(entry.visual) ?? 0) + 1);
  const room = (kind: BoardKind) => kindLimit(kind) - (used.get(kind) ?? 0);
  const carrying = beats.filter((beat) => {
    const entry = plan.get(beat.id);
    return entry && exampleRules(beat, entry).offered;
  });
  const flexible = carrying.filter((beat) => ['formula', 'none'].includes(plan.get(beat.id)!.visual));
  const slots = MECHANISM_KINDS.flatMap((kind) => Array.from({ length: Math.max(0, room(kind)) }, () => kind));
  const out: VisualPlan = new Map(plan);
  for (const beat of carrying) {
    const entry = plan.get(beat.id)!;
    const frames: BoardKind[] = entry.visual === 'none' ? [] : [entry.visual];
    if (entry.visual !== 'formula' && room('formula') > 0) {
      frames.push('formula');
      used.set('formula', (used.get('formula') ?? 0) + 1);
    }
    const turn = flexible.indexOf(beat);
    if (turn >= 0)
      for (const kind of slots.filter((_, k) => k % flexible.length === turn))
        if (!frames.includes(kind)) frames.push(kind);
    // An example needs a native visual frame, so a step that finds none free is not refused: it may use any.
    if (!frames.some((kind) => kind !== 'formula')) frames.push(...MECHANISM_KINDS);
    out.set(beat.id, { ...entry, frames });
  }
  return out;
}

const KINDS_HELP: Record<BoardKind, string> = {
  heatmap:
    'how every item relates to every other (weights, attention, alignment, similarity, correlation, confusion), a mask, a grid of results over two settings, or a formula’s value over two indices.',
  scatter:
    'a trade-off or relationship between two quantities measured in the document (quality against cost, accuracy against size, speed against error; two columns of a results table), at least three points (two are a comparison: use bars), never made-up points, with the better corner marked.',
  shapes: 'how matrix or vector dimensions combine in an operation, and which dimension disappears or appears.',
  plot: 'how a formula responds to its input or a parameter when the shape matters (saturation, decay, periodicity, a crossover), never a straight line.',
  formula: 'the parts of a key equation, each with its role.',
  bars: 'one key comparison on a single metric.',
  flow: 'a real dependency structure with a branch, a merge or a loop that the page does not draw; a chain of steps is a list, not a flow.',
  scene: 'vectors or geometry (angles, projections, distances) when geometry is the point.',
};
/** The kinds in the order the task lists them: the ones that show relationships come first. */
const KINDS_ORDER: BoardKind[] = ['heatmap', 'scatter', 'shapes', 'plot', 'formula', 'bars', 'flow', 'scene'];

/** The plan call's response schema: one entry per step, in tour order. */
export function visualPlanSchema(beats: Beat[], { sheet }: PlanOptions = {}) {
  const ids = beats.map((beat) => beat.id);
  return {
    type: 'object',
    additionalProperties: false,
    required: ['plan', 'beats'],
    properties: {
      plan: { type: 'string', maxLength: 800 },
      beats: {
        type: 'array',
        minItems: 1,
        maxItems: ids.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['beat', 'visual', 'idea', 'data'],
          properties: {
            beat: { type: 'string', enum: ids },
            visual: { type: 'string', enum: ['none', ...(sheet ? sheetKinds() : BOARD_KINDS)] },
            idea: {
              type: 'string',
              maxLength: IDEA_WORDS * 9,
              description: `One sentence of at most ${IDEA_WORDS} words: what the learner sees and what clicks. Empty for none.`,
            },
            data: {
              type: 'string',
              maxLength: DATA_WORDS * 9,
              description: `At most ${DATA_WORDS} words: exactly which numbers, symbols or labels it uses; document values as printed, made-up ones marked illustrative. Empty for none.`,
            },
          },
        },
      },
    },
  };
}

/** What each kind is for on an exercise sheet: the method of a task, drawn from what the task gives. */
const SHEET_KINDS_HELP: Partial<Record<BoardKind, string>> = {
  heatmap:
    'a grid of counts or probabilities that sets the problem up: natural frequencies for a conditional probability (rows are the groups, columns the outcomes), a table of outcomes, a contingency or confusion table, a formula’s values over two indices.',
  bars: 'a few values that the method compares or splits (the probabilities of the cases it combines, the parts of a total), never the numbers the task already lists.',
  plot: 'the graph of a function the task is about (a density, a trend, a parabola, a curve with a point on it), never a straight line.',
  shapes: 'a matrix or vector and how its dimensions combine in a product or a system (linear algebra).',
  scene:
    'geometry: a point or a vector in the plane or the complex plane, an angle, a triangle, a projection, with labelled objects.',
  scatter: 'the (x, y) data points a task lists, when it prints at least three.',
  flow: 'a procedure or tree with a real branch or loop (a probability tree, a case split, an algorithm).',
};
/** The kinds an exercise sheet's plan lists, in the order the task names them. */
const SHEET_ORDER: BoardKind[] = ['heatmap', 'shapes', 'scene', 'plot', 'bars', 'scatter', 'flow'];

/** The task of the plan call for an exercise sheet: a visual only where the method gains from one. */
function sheetPlanTask(language: string): string {
  const kinds = SHEET_ORDER.map((kind) => `   - ${kind}: ${SHEET_KINDS_HELP[kind]}`).join('\n');
  return `TASK: design the side-board visuals of this exercise sheet's tour, which is narrated in ${JSON.stringify(language)}.
Each step is one task or one part of a task. The tour solves it line by line on the board in formulas, and those lines
stay as they are, so never plan a formula. A visual is only for what the algebra does not show: the structure of the
method, set up from what the task gives. None is right for plain algebra, a short computation or a task whose method
needs no picture.
1. The kinds and what they are for:
${kinds}
2. At most one visual per task (when a task has parts, at most one of its parts), and about half of the tasks. Diversity
   comes first across the sheet: each kind once (plot at most twice), a different kind for a different method.
3. The visual shows the setting and the method from the task's own givens and never the result: the learner works the
   task out first, so never plan a picture of what the task asks for (the distribution to find, the zeros to
   compute), and a picture that only repeats the givens (their numbers as bars, their words in boxes) is worse than
   none. "data" names the labels and numbers it uses: the givens as printed, anything else marked illustrative (at
   most ${DATA_WORDS} words).
4. For each visual, "idea" says in one sentence (at most ${IDEA_WORDS} words) what the learner sees and what clicks.
5. Answer with one entry per step, in tour order. For none, leave "idea" and "data" empty.`;
}

export function visualPlanTask(language: string, { sheet }: PlanOptions = {}): string {
  if (sheet) return sheetPlanTask(language);
  const kinds = KINDS_ORDER.map((kind) => `   - ${kind}: ${KINDS_HELP[kind]}`).join('\n');
  return `TASK: design the side-board visuals of this tour, which is narrated in ${JSON.stringify(language)}.
For each step decide whether a visual would make the step's point click, and which one. A visual must show what the
document is trying to show at that step (its mechanism, relationship or trade-off) in a way the page alone cannot.
Fewer, stronger visuals beat many weak ones; none is right when the page (a figure or table) already shows it or the
point is simple.
1. The kinds and what they are for:
${kinds}
2. About half the steps get a visual. Never two visuals of the same data or idea. Diversity comes first: use as
   many different kinds as fit, each kind once (formula and plot at most twice), and with five or more visuals at
   least four different kinds. Prefer heatmap, scatter, shapes and plot where they fit, since they show
   relationships rather than single numbers. A figure step usually teaches on the figure itself.
3. For each visual, "idea" says in one sentence (at most ${IDEA_WORDS} words) what the learner sees and what clicks.
   "data" says exactly which numbers, symbols or labels it uses (at most ${DATA_WORDS} words): document values copied
   as printed, anything else marked illustrative. A step that reports results (a result or a table) uses only the
   document's own numbers, which its evidence quotes; illustrative values only explain a mechanism. Labels are real
   items (words of an example sentence, settings, methods), never "item 1".
4. A step on a worked numerical case names the kind that shows its mechanism, and its example frames use that kind (bars
   only for a few comparable quantities of one unit). Frames count toward each kind's limit.
5. Answer with one entry per step, in tour order. For none, leave "idea" and "data" empty.`;
}

const trimmed = (text: string, max = 280) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
};

/**
 * The document card and every step with its point, its evidence sentences and its figure or equation, then the tables
 * the steps stand on, as read from the page.
 */
export function visualPlanBrief(card: PaperCard, beats: Beat[], doc: Doc): string {
  const sentences = new Map(doc.sentences.map((s) => [s.id, s.text]));
  const quote = (ids: string[], max: number) =>
    ids.slice(0, max).flatMap((id) => (sentences.has(id) ? [`    [${id}] ${trimmed(sentences.get(id)!)}`] : []));
  const items = (list: { text: string }[]) => list.map((item) => item.text).join(' | ') || 'none';
  const lines = [
    `DOCUMENT CARD (type ${card.doc_type}):`,
    `problem: ${card.problem.text}`,
    `key idea: ${card.key_idea.text}`,
    `how it works: ${items(card.method_steps)}`,
    `key results: ${items(card.results)}`,
    `limits: ${items(card.limitations)}`,
    `takeaway: ${card.takeaway.text}`,
    '',
    beats.some((beat) => beat.unit) ? 'THE TASKS OF THE SHEET, in order:' : 'STEPS OF THE TOUR, in order:',
  ];
  const tables: DocFigure[] = [];
  const listed = (table: DocFigure | undefined) => {
    if (!table || !gridOf(table)) return undefined;
    if (!tables.includes(table)) tables.push(table);
    return table;
  };
  for (const beat of beats) {
    if (beat.unit) {
      // An exercise part: its name and its task as the sheet prints it, which is what a method visual is set up from.
      lines.push(`[${beat.id}] exercise step: ${beat.unit.name}`);
      lines.push(...unitTaskLines(beat.unit, doc).map((line) => `  ${line}`));
      continue;
    }
    const figure = doc.figures.find((f) => f.id === beat.target);
    const equation = doc.equations.find((e) => e.id === beat.target);
    lines.push(`[${beat.id}] ${beat.kind} step${beat.detail ? ' (a closer look at one detail)' : ''}`);
    lines.push(`  the point: ${beat.point}`);
    if (figure) lines.push(`  on ${figure.kind} ${figure.number}, page ${figure.page}: ${trimmed(figure.caption)}`);
    if (listed(figure)) lines.push('  its rows and columns are listed under TABLES below');
    if (equation)
      lines.push(
        `  on ${equation.number ? `equation (${equation.number})` : 'an equation without a printed number'}, page ${equation.page}: ${trimmed(equation.text, 160)}`,
      );
    const evidence = quote(beat.evidence, 4);
    if (evidence.length) lines.push('  evidence sentences:', ...evidence);
    const more = quote(
      (beat.boardEvidence ?? []).filter((id) => !beat.evidence.includes(id)),
      3,
    );
    if (more.length) lines.push('  other numbers of the chapter:', ...more);
    // A step that reports results rests on a table: the one its evidence cites, or that repeats the most of its numbers.
    const numbers = [...beat.evidence, ...(beat.boardEvidence ?? [])].map((id) => sentences.get(id) ?? '').join('\n');
    const table =
      !figure && !equation && (beat.kind === 'result' || beat.board === 'bars')
        ? listed(resultTable(doc, beat.evidence, numbers))
        : undefined;
    if (table) lines.push(`  its numbers come from table ${table.number}, listed under TABLES below`);
  }
  if (tables.length) {
    lines.push(
      '',
      'TABLES THE STEPS STAND ON (rows and columns as read from the page, numbers as printed). A step on a table, or a result that rests on one, can draw the table’s own columns: a scatter of two of them for a trade-off, bars of one column or of the change from a base row (an ablation), a heatmap of a grid of comparable results. Then "data" names the columns and rows.',
    );
    for (const table of tables) {
      const base = baseRowName(table);
      lines.push(
        tableText(table, { maxRows: 14, changes: false }),
        ...(base ? [`Base row "${base}": the change of every other row from it can be drawn as bars.`] : []),
        '',
      );
    }
  }
  return lines.join('\n').trimEnd();
}

const words = (text: unknown, max: number) => {
  const list = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean) : [];
  return list.slice(0, max).join(' ');
};

/** A beat the variety rules turned to none, and why. */
export interface PlanAdjustment {
  beat: string;
  visual: BoardKind;
  reason: string;
}

/**
 * The plan checked in code: unknown beats and kinds are dropped, a beat keeps its first entry, and a beat without a
 * valid entry gets none. In tour order a kind past its limit and every board past the share of steps become none, so
 * the earliest visuals stay. The plan is null (callers fall back to the beats' own boards) when no entry is usable.
 */
export function cleanVisualPlan(
  value: unknown,
  beats: Beat[],
  { sheet }: PlanOptions = {},
): { plan: VisualPlan | null; problems: string[]; adjusted: PlanAdjustment[] } {
  const known = new Set(beats.map((beat) => beat.id));
  const kinds = new Set<string>(['none', ...BOARD_KINDS]);
  const listed = (value as { beats?: unknown } | null)?.beats;
  const entries = new Map<string, StepVisual>();
  const problems: string[] = [];
  for (const raw of Array.isArray(listed) ? listed : []) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const id = typeof entry.beat === 'string' ? entry.beat : '';
    if (!known.has(id)) {
      problems.push(`beats: "${id}" is not a listed step`);
      continue;
    }
    if (entries.has(id)) continue;
    const visual = typeof entry.visual === 'string' && kinds.has(entry.visual) ? (entry.visual as PlannedKind) : null;
    if (!visual) {
      problems.push(`${id}: visual must be none or one of ${BOARD_KINDS.join(', ')}`);
      continue;
    }
    const idea = words(entry.idea, IDEA_WORDS);
    if (visual !== 'none' && !idea) {
      problems.push(`${id}: a ${visual} needs an idea: what the learner sees and what clicks`);
      continue;
    }
    entries.set(id, {
      visual,
      idea: visual === 'none' ? '' : idea,
      data: visual === 'none' ? '' : words(entry.data, DATA_WORDS),
    });
  }
  if (!entries.size) return { plan: null, problems: problems.length ? problems : ['beats: no entry'], adjusted: [] };
  const plan: VisualPlan = new Map();
  const adjusted: PlanAdjustment[] = [];
  const used = new Map<BoardKind, number>();
  const room = Math.max(1, Math.floor(beats.length * BOARD_SHARE));
  const tasks = new Set<string>();
  let boards = 0;
  for (const beat of beats) {
    const entry = entries.get(beat.id) ?? { visual: 'none' as const, idea: '', data: '' };
    const none = { visual: 'none' as const, idea: '', data: '' };
    const task = beat.unit?.task.id;
    if (entry.visual === 'none') plan.set(beat.id, entry);
    else if (sheet && entry.visual === 'formula') {
      plan.set(beat.id, none);
      adjusted.push({ beat: beat.id, visual: 'formula', reason: 'the solution lines are formula boards already' });
    } else if (task !== undefined && tasks.has(task)) {
      plan.set(beat.id, none);
      adjusted.push({ beat: beat.id, visual: entry.visual, reason: 'at most one visual per task' });
    } else if ((used.get(entry.visual) ?? 0) >= kindLimit(entry.visual)) {
      plan.set(beat.id, none);
      adjusted.push({
        beat: beat.id,
        visual: entry.visual,
        reason: `at most ${kindLimit(entry.visual)} ${entry.visual} board${kindLimit(entry.visual) === 1 ? '' : 's'}`,
      });
    } else if (boards >= room) {
      plan.set(beat.id, none);
      adjusted.push({
        beat: beat.id,
        visual: entry.visual,
        reason: `at most ${Math.round(BOARD_SHARE * 100)}% of the steps get a board`,
      });
    } else {
      plan.set(beat.id, entry);
      used.set(entry.visual, (used.get(entry.visual) ?? 0) + 1);
      if (task !== undefined) tasks.add(task);
      boards++;
    }
  }
  return { plan, problems, adjusted };
}

/** The line a step's brief carries: its planned visual and data, or that it teaches on the page alone. */
export function visualLine(visual: StepVisual): string {
  if (visual.visual === 'none')
    return 'VISUAL FOR THIS STEP: none. Teach on the page with highlights and marks; no side board.';
  const idea = /[.!?]$/.test(visual.idea) ? visual.idea : `${visual.idea}.`;
  return `VISUAL FOR THIS STEP: ${visual.visual}: ${idea}${visual.data ? ` Data: ${visual.data}` : ''}`;
}

/** The final plan as the activity log records it, in tour order. */
export function visualPlanEvent(plan: VisualPlan, beats: Beat[]) {
  return beats.flatMap((beat) => {
    const entry = plan.get(beat.id);
    return entry ? [{ beat: beat.id, ...entry }] : [];
  });
}
