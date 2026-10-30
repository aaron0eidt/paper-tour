import type { Doc, DocFigure } from '../../../shared/paper';
import type { Beat } from './beats';
import { BOARD_KINDS, LEGACY_BOARD_KINDS, type BoardKind } from './board';
import type { PaperCard } from './card';
import { unitTaskLines } from './unit-task';
import { baseRowName, gridOf, resultTable, tableText, tableViews, type TableView } from './tables';

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
  /** The table whose own numbers the step draws (a results step that rests on one), when code chose it (withTableBoard). */
  table?: string;
  /** The step is asked for its narration alone, with no board and no worked example, even where it must have one (a slow step). */
  bare?: boolean;
  /** Adaptive profiles choose representations by learning value, without legacy per-kind quotas. */
  flexible?: boolean;
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

/**
 * What the plan is for: an exercise sheet's tasks, whose solution lines stay formula boards, or the steps of a tour.
 * `settled` says that some steps were planned ahead of it (planOpening): the call leaves them out and counts them.
 */
export interface PlanOptions {
  sheet?: boolean;
  settled?: boolean;
  adaptive?: boolean;
}
/** The kinds an exercise sheet's plan offers: a formula is what the solution lines already are. */
export const sheetKinds = () => BOARD_KINDS.filter((kind) => kind !== 'formula' && kind !== 'timeline');

/** Planned kinds that show a relationship themselves: a worked-example sequence is never forced on their steps. */
const RELATIONAL_KINDS: readonly string[] = ['heatmap', 'scatter', 'shapes', 'plot', 'timeline', 'distribution'];
/** The kinds that show a worked case's mechanism, best first, which the frames of a step planned as a formula may add. */
const MECHANISM_KINDS: readonly BoardKind[] = ['plot', 'scene', 'flow', 'bars'];

/**
 * Whether a step may carry a worked example (example frames) and whether it must. Without a plan a step may always, and
 * a formula detail must. A planned relationship (heatmap, scatter, shapes, plot, timeline, distribution) is the visual
 * itself, with no example.
 * A step planned without a board has example frames only when it must have a worked example. A bare step has neither.
 */
export function exampleRules(beat: Beat, visual?: StepVisual): { offered: boolean; required: boolean } {
  const detail = beat.kind === 'formula' && !!beat.detail;
  if (!visual) return { offered: true, required: detail };
  if (visual.bare) return { offered: false, required: false };
  // These contain their own executable demonstration, including intermediate states and interactive inputs.
  if (visual.visual === 'program' || visual.visual === 'plotly') return { offered: false, required: false };
  if (visual.flexible) return { offered: visual.visual !== 'none' || detail, required: detail };
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
export function allocateFrames(plan: VisualPlan, beats: Beat[], settled: ReadonlySet<string> = new Set()): VisualPlan {
  const used = new Map<BoardKind, number>();
  for (const entry of plan.values())
    if (entry.visual !== 'none') used.set(entry.visual, (used.get(entry.visual) ?? 0) + 1);
  const room = (kind: BoardKind) => kindLimit(kind) - (used.get(kind) ?? 0);
  // A step planned ahead of the rest (planOpening) was written with its frames already; they are not allotted again.
  const carrying = beats.filter((beat) => {
    const entry = plan.get(beat.id);
    return entry && !settled.has(beat.id) && exampleRules(beat, entry).offered;
  });
  const flexible = carrying.filter((beat) => ['formula', 'none'].includes(plan.get(beat.id)!.visual));
  const slots = MECHANISM_KINDS.flatMap((kind) => Array.from({ length: Math.max(0, room(kind)) }, () => kind));
  const out: VisualPlan = new Map(plan);
  for (const beat of carrying) {
    const entry = plan.get(beat.id)!;
    if (entry.flexible) {
      out.set(beat.id, { ...entry, frames: [...LEGACY_BOARD_KINDS] });
      continue;
    }
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
  program:
    'a paper-specific animated mathematical construction with actual numerical intermediate states, vectors, matrices, geometry or computation.',
  plotly: 'interactive measured-data comparisons or mathematical functions with labeled axes and units.',
  heatmap:
    'how every item relates to every other (weights, attention, alignment, similarity, correlation, confusion), a mask, a grid of results over two settings, or a formula’s value over two indices.',
  scatter:
    'a trade-off or relationship between two quantities measured in the document (quality against cost, accuracy against size, speed against error; two columns of a results table), at least three points (two are a comparison: use bars), never made-up points, with the better corner marked.',
  shapes: 'how matrix or vector dimensions combine in an operation, and which dimension disappears or appears.',
  plot: 'how a formula responds to its input or a parameter when the shape matters (saturation, decay, periodicity, a crossover), never a straight line; its roots, peak and crossings are marked.',
  timeline: 'the dates, notice periods, deadlines and terms a document states, or the ordered steps of a procedure.',
  distribution:
    'how uncertainty is spread and changes: a bell curve that narrows or shifts, a Poisson or binomial, the chance of a tail.',
  formula: 'the parts of a key equation in math symbols, each with its role; never a rule in words.',
  bars: 'one key comparison on a single metric.',
  flow: 'a real dependency structure with a branch, a merge or a loop that the page does not draw; a chain of steps is a list, not a flow.',
  scene: 'vectors or geometry (angles, projections, distances) when geometry is the point.',
};
/** The kinds in the order the task lists them: the ones that show relationships come first. */
const KINDS_ORDER: BoardKind[] = [
  'program',
  'plotly',
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
  program: KINDS_HELP.program,
  plotly: KINDS_HELP.plotly,
  heatmap:
    'a grid of counts or probabilities that sets the problem up: natural frequencies for a conditional probability (rows are the groups, columns the outcomes), a table of outcomes, a contingency or confusion table, a formula’s values over two indices.',
  bars: 'a few values that the method compares or splits (the probabilities of the cases it combines, the parts of a total), never the numbers the task already lists.',
  plot: 'the graph of a function the task is about (a density, a trend, a parabola, a curve with a point on it), never a straight line.',
  shapes: 'a matrix or vector and how its dimensions combine in a product or a system (linear algebra).',
  scene:
    'geometry: a point or a vector in the plane or the complex plane, an angle, a triangle, a projection, with labelled objects.',
  scatter: 'the (x, y) data points a task lists, when it prints at least three.',
  flow: 'a procedure or tree with a real branch or loop (a probability tree, a case split, an algorithm).',
  distribution:
    'the distribution a probability task is about (a normal, binomial, Poisson or exponential with the parameters the task gives), never with the range the task asks the chance of shaded.',
};
/** The kinds an exercise sheet's plan lists, in the order the task names them. */
const SHEET_ORDER: BoardKind[] = [
  'program',
  'plotly',
  'heatmap',
  'shapes',
  'scene',
  'plot',
  'distribution',
  'bars',
  'scatter',
  'flow',
];

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

const kindsList = () => KINDS_ORDER.map((kind) => `   - ${kind}: ${KINDS_HELP[kind]}`).join('\n');

export function visualPlanTask(language: string, { sheet, settled, adaptive }: PlanOptions = {}): string {
  if (sheet) return sheetPlanTask(language);
  const kinds = kindsList();
  return `TASK: design the side-board visuals of this tour, which is narrated in ${JSON.stringify(language)}.
For each step decide whether a visual would make the step's point click, and which one. A visual must show what the
document is trying to show at that step (its mechanism, relationship or trade-off) in a way the page alone cannot.
Fewer, stronger visuals beat many weak ones; none is right when the page (a figure or table) already shows it or the
point is simple.
1. The kinds and what they are for:
${kinds}
2. ${
    adaptive
      ? `Choose each representation for the learning objective and misconception in the brief. There is no per-kind
   quota or required share of side boards. Repeat a useful kind for a genuinely different relationship, input or
   computation; never repeat the same picture as decoration. Prefer source annotations when the page already shows
   the mechanism clearly. A spoken numerical example must visibly change its inputs, intermediate values and output.
   Use a new side visual when it reveals a relationship the original page cannot.`
      : `About half the steps get a visual. Never two visuals of the same data or idea. Diversity comes first: use as
   many different kinds as fit, each kind once (formula and plot at most twice), and with five or more visuals at
   least four different kinds. Prefer heatmap, scatter, shapes, plot, timeline and distribution where they fit, since
   they show relationships rather than single numbers. A figure step usually teaches on the figure itself.`
  }
3. For each visual, "idea" says in one sentence (at most ${IDEA_WORDS} words) what the learner sees and what clicks.
   "data" says exactly which numbers, symbols or labels it uses (at most ${DATA_WORDS} words): document values copied
   as printed, anything else marked illustrative. A step that reports results (a result or a table) uses only the
   document's own numbers, which its evidence quotes; illustrative values only explain a mechanism. At least one
   results step on a table with ready boards (listed under TABLES) draws one, naming its columns. Labels are real
   items (words of an example sentence, settings, methods), never "item 1".
4. A step on a worked numerical case names the kind that shows its mechanism, and its example frames use that kind (bars
   only for a few comparable quantities of one unit). ${adaptive ? 'Choose the frames that demonstrate the actual computation.' : "Frames count toward each kind's limit."}
5. Answer with one entry per step, in tour order. For none, leave "idea" and "data" empty.${
    settled
      ? `
6. A step marked "already planned" keeps its visual: leave it out of your answer. ${adaptive ? 'Later steps must add new understanding instead of repeating its picture.' : 'Count its kind toward every limit above, so that no other step repeats its picture.'}`
      : ''
  }`;
}

/**
 * The task of the call that plans the opening step alone (planOpening), which the learner waits for: it runs while the
 * tour's claims are still being found, sees the document card only, and its choice is kept by the plan of the other steps.
 */
export function openingPlanTask(language: string): string {
  return `TASK: decide the side-board visual of the OPENING step of this tour, which is narrated in ${JSON.stringify(language)}.
The opening step says what the document does and the problem it answers, then names the claims the tour takes next. It is
listed below as the first step. A second call plans the other steps right after this one and keeps your choice: about
half of all the steps get a visual, each kind is used at most once in the whole tour (formula and plot at most twice),
and diversity comes first. The learner is waiting for this step to start, so a visual here must be simple.
1. The kinds and what they are for:
${kindsList()}
2. Choose a visual only when it makes the opening point click in a way the page alone cannot. None is right when the page
   already shows it, when the point is simple, or when a later step is likelier to need that kind (a figure step teaches
   on the figure itself, and a results step has the document's numbers).
3. If you choose one, "idea" says in one sentence (at most ${IDEA_WORDS} words) what the learner sees and what clicks, and
   "data" says exactly which numbers, symbols or labels it uses (at most ${DATA_WORDS} words): document values copied as
   printed, anything else marked illustrative. Labels are real items, never "item 1".
4. Answer with one entry, for the opening step. For none, leave "idea" and "data" empty.`;
}

const trimmed = (text: string, max = 280) => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 3)}...` : flat;
};

/**
 * The document card and every step with its point, its evidence sentences and its figure or equation, then the tables
 * the steps stand on, as read from the page.
 */
export function visualPlanBrief(card: PaperCard, beats: Beat[], doc: Doc, settled: VisualPlan = new Map()): string {
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
    const ahead = settled.get(beat.id);
    if (ahead)
      lines.push(`  already planned (leave it out of your answer; it counts toward the limits): ${visualLine(ahead)}`);
    lines.push(`  the point: ${beat.point}`);
    if (beat.notes?.length) lines.push(...beat.notes.map((note) => `  ${note}`));
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
      const ready = readyBoards(table);
      lines.push(
        tableText(table, { maxRows: 14, changes: false }),
        ...(base ? [`Base row "${base}": the change of every other row from it can be drawn as bars.`] : []),
        ...(ready ? [`Ready boards of this table: ${ready}.`] : []),
        '',
      );
    }
  }
  return lines.join('\n').trimEnd();
}

/** What the code can draw from a table by itself, as one line for the brief: each kind with what it shows. */
function readyBoards(table: DocFigure): string {
  return tableViews(table)
    .map((view) => `${view.kind}: ${view.what.replace(/^bars of /, '')}`)
    .join('; ');
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
  { sheet, adaptive }: PlanOptions = {},
  settled: VisualPlan = new Map(),
): { plan: VisualPlan | null; problems: string[]; adjusted: PlanAdjustment[] } {
  const known = new Set(beats.map((beat) => beat.id));
  const kinds = new Set<string>(['none', ...BOARD_KINDS]);
  const listed = (value as { beats?: unknown } | null)?.beats;
  // A step planned ahead of the rest is kept as it was decided, and counted before any other step: the tour's limits
  // hold for it too.
  const entries = new Map<string, StepVisual>([...settled].filter(([id]) => known.has(id)));
  const ahead = entries.size;
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
  if (entries.size === ahead)
    return { plan: null, problems: problems.length ? problems : ['beats: no entry'], adjusted: [] };
  const plan: VisualPlan = new Map();
  const adjusted: PlanAdjustment[] = [];
  const used = new Map<BoardKind, number>();
  const room = Math.max(1, Math.floor(beats.length * BOARD_SHARE));
  const tasks = new Set<string>();
  let boards = 0;
  for (const [id, entry] of entries)
    if (settled.has(id) && entry.visual !== 'none') {
      used.set(entry.visual, (used.get(entry.visual) ?? 0) + 1);
      boards++;
    }
  for (const beat of beats) {
    const entry = entries.get(beat.id) ?? { visual: 'none' as const, idea: '', data: '' };
    const none = { visual: 'none' as const, idea: '', data: '' };
    const task = beat.unit?.task.id;
    if (settled.has(beat.id)) plan.set(beat.id, adaptive ? { ...entry, flexible: true } : entry);
    else if (entry.visual === 'none') plan.set(beat.id, adaptive ? { ...entry, flexible: true } : entry);
    else if (sheet && entry.visual === 'formula') {
      plan.set(beat.id, none);
      adjusted.push({ beat: beat.id, visual: 'formula', reason: 'the solution lines are formula boards already' });
    } else if (task !== undefined && tasks.has(task)) {
      plan.set(beat.id, none);
      adjusted.push({ beat: beat.id, visual: entry.visual, reason: 'at most one visual per task' });
    } else if (!adaptive && (used.get(entry.visual) ?? 0) >= kindLimit(entry.visual)) {
      plan.set(beat.id, none);
      adjusted.push({
        beat: beat.id,
        visual: entry.visual,
        reason: `at most ${kindLimit(entry.visual)} ${entry.visual} board${kindLimit(entry.visual) === 1 ? '' : 's'}`,
      });
    } else if (!adaptive && boards >= room) {
      plan.set(beat.id, none);
      adjusted.push({
        beat: beat.id,
        visual: entry.visual,
        reason: `at most ${Math.round(BOARD_SHARE * 100)}% of the steps get a board`,
      });
    } else {
      plan.set(beat.id, adaptive ? { ...entry, flexible: true } : entry);
      used.set(entry.visual, (used.get(entry.visual) ?? 0) + 1);
      if (task !== undefined) tasks.add(task);
      boards++;
    }
  }
  return { plan, problems, adjusted };
}

/** A step that reports results from a table the code can draw from, and the boards it can make from it. */
interface TableStep {
  beat: Beat;
  table: DocFigure;
  views: TableView[];
}

/**
 * The steps that report results from a table with ready boards (tables.ts): a step on a table, and a result that rests
 * on one. Their numbers are the document's own, and a board of them is made by code.
 */
export function tableSteps(beats: Beat[], doc: Doc): TableStep[] {
  const sentences = new Map(doc.sentences.map((s) => [s.id, s.text]));
  const views = new Map<string, TableView[]>();
  const steps: TableStep[] = [];
  for (const beat of beats) {
    if (beat.unit) continue;
    const figure = beat.target ? doc.figures.find((f) => f.id === beat.target) : undefined;
    const numbers = [...beat.evidence, ...(beat.boardEvidence ?? [])].map((id) => sentences.get(id) ?? '').join('\n');
    const table = beat.target
      ? figure?.kind === 'table'
        ? figure
        : undefined
      : beat.kind === 'result'
        ? resultTable(doc, beat.evidence, numbers)
        : undefined;
    if (!table) continue;
    if (!views.has(table.id)) views.set(table.id, tableViews(table));
    if (views.get(table.id)!.length) steps.push({ beat, table, views: views.get(table.id)! });
  }
  return steps;
}

/**
 * The plan with a board of the document's own numbers on a results step, when the document has one that rests on a
 * table with ready boards and the plan left them all out (models plan illustrative pictures for the mechanism and
 * leave the results to the page). A step whose planned kind is one of its table's ready boards already counts, and
 * only learns its table. Otherwise the first such step takes the kind of the first ready board that the variety rules
 * leave room for: a free step before a step with another board, one not in detail before a detail; when every kind
 * its table offers is used up, the last step elsewhere with such a board gives it up. The plan stays within the limits
 * of each kind and the share of steps with a board, and every change is recorded. A step planned ahead of the rest
 * (`settled`) is already written and never gives its board up.
 */
export function withTableBoard(
  plan: VisualPlan,
  beats: Beat[],
  doc: Doc,
  settled: ReadonlySet<string> = new Set(),
): { plan: VisualPlan; adjusted: PlanAdjustment[] } {
  const out: VisualPlan = new Map(plan);
  const adjusted: PlanAdjustment[] = [];
  const steps = tableSteps(beats, doc);
  if (!steps.length) return { plan: out, adjusted };
  const none: StepVisual = { visual: 'none', idea: '', data: '' };
  const entry = (id: string) => out.get(id) ?? none;
  const drawn = steps.find(({ beat, views }) => views.some((view) => view.kind === entry(beat.id).visual));
  if (drawn) {
    out.set(drawn.beat.id, { ...entry(drawn.beat.id), table: drawn.table.id });
    return { plan: out, adjusted };
  }
  const results = new Set(steps.map(({ beat }) => beat.id));
  const holders = (kind: BoardKind) => beats.filter((beat) => entry(beat.id).visual === kind).map((beat) => beat.id);
  const boards = beats.filter((beat) => entry(beat.id).visual !== 'none').length;
  const room = Math.max(1, Math.floor(beats.length * BOARD_SHARE));
  const order = steps
    .map((step, i) => ({ step, i, rank: (entry(step.beat.id).visual === 'none' ? 0 : 2) + (step.beat.detail ? 1 : 0) }))
    .sort((a, b) => a.rank - b.rank || a.i - b.i)
    .map(({ step }) => step);
  for (const takeover of [false, true])
    for (const { beat, table, views } of order)
      for (const view of views) {
        const free = entry(beat.id).visual === 'none';
        const others = holders(view.kind).filter((id) => id !== beat.id);
        const giving =
          takeover && others.length >= kindLimit(view.kind)
            ? others.filter((id) => !results.has(id) && !settled.has(id)).at(-1)
            : undefined;
        const fits = giving !== undefined || others.length < kindLimit(view.kind);
        if (!fits || boards + (free ? 1 : 0) - (giving === undefined ? 0 : 1) > room) continue;
        if (giving !== undefined) {
          out.set(giving, none);
          adjusted.push({
            beat: giving,
            visual: view.kind,
            reason: `its ${view.kind} goes to a results step that draws the numbers of table ${table.number}`,
          });
        }
        out.set(beat.id, {
          visual: view.kind,
          idea: words(
            `Learner sees ${view.what}, drawn from table ${table.number}'s own numbers, and clicks the pattern behind the result.`,
            IDEA_WORDS,
          ),
          data: words(`columns ${view.columns.join(', ')} of the table, values as printed.`, DATA_WORDS),
          table: table.id,
        });
        adjusted.push({
          beat: beat.id,
          visual: view.kind,
          reason: `a results step on table ${table.number} draws its own numbers`,
        });
        return { plan: out, adjusted };
      }
  return { plan: out, adjusted };
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

/**
 * What the opening step is told about the worked example it may carry. The plan of the other steps allots example frames
 * only once it is done, and the opening is written before; so its frames stay in its own kind, which the tour's limits
 * already count. A step planned as a relationship (heatmap, scatter, plot, ...) or as none carries no example.
 */
export function openingEntry(entry: StepVisual): StepVisual {
  return entry.visual === 'none' || RELATIONAL_KINDS.includes(entry.visual)
    ? entry
    : { ...entry, frames: [entry.visual] };
}

/**
 * The visual of the opening step from the answer of the call that plans it alone (openingPlanTask), checked like any plan
 * of one step: null when the answer has no usable entry.
 */
export function cleanOpeningPlan(
  value: unknown,
  beat: Beat,
): { visual: StepVisual | null; problems: string[]; adjusted: PlanAdjustment[] } {
  const checked = cleanVisualPlan(value, [beat]);
  const entry = checked.plan?.get(beat.id);
  return { visual: entry ? openingEntry(entry) : null, problems: checked.problems, adjusted: checked.adjusted };
}
