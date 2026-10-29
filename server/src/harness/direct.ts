import { checkExample, claimsNumericExample, exampleSchema, type WorkedExample } from './example';
import { tableTextBlocks, tableLines } from '../../../shared/tableTargets';
import Ajv2020 from 'ajv/dist/2020.js';
import type { BoardItem, Doc, DocFigure, Region } from '../../../shared/paper';
import type { Beat } from './beats';
import { deckBrief } from './deck';
import { BOARD_KINDS, boardPartIds, boardSchema, checkBoard, numbersIn } from './board';
import type { DocType } from './doctype';
import { proseSentences } from './paper-block';
import type { DirectOptions } from './prompts';
import {
  BOUNDS_SCHEMA,
  exactBounds,
  faultyVisualCues,
  figureFrameText,
  figureTextTargets,
  measuredCueTargets,
  measuredFrameText,
  visualCueProblems,
  type MeasuredTarget,
} from './visual-grounding';
import { distinctive, gridOf, resultTable, tableText, tableViews, viewsFor, viewText, type TableView } from './tables';
import { exampleKinds, exampleRules, visualLine, type StepVisual } from './visual-plan';
import { groundedCheck, reportsResults } from './visual-rules';

export const CUE_ACTIONS = ['highlight', 'box', 'spotlight', 'note', 'arrow', 'circle', 'board_focus'] as const;
/** Room for source cues and board emphasis in the same explanation. */
export const MAX_CUES = 8;
export type CueAction = (typeof CUE_ACTIONS)[number];
export interface Cue {
  action: CueAction;
  target: string;
  /** Where on the figure or panel a pen mark goes; missing means the whole target. */
  region?: RegionName;
  /** Exact target-relative coordinates from the attached image; supersedes legacy named regions. */
  bounds?: Region;
  label: string;
  anchor: string;
}
export interface Direction {
  plan: string;
  say: string;
  cues: Cue[];
  /** The side-board item, when the model drew one that passed its checks. */
  board?: BoardItem;
  example?: WorkedExample;
  exampleProblems?: string[];
  /** Why the board the model drew was dropped; empty when it passed or none was drawn. */
  boardProblems?: string[];
  visualProblems?: string[];
}
/** What a beat may point at: sentences to highlight, figures, panels or equations to mark, and parts of its board. */
export interface BeatTargets {
  page: number;
  sentences: string[];
  visuals: string[];
  /** Board parts a board_focus cue may light up: term-1, node-1 or bar-1 and so on. */
  parts?: string[];
  /** The quoted document text a bars board's numbers must come from. */
  evidence?: string;
  /** A table whose cells a text beat quotes as the source of its numbers. */
  table?: string;
  tableCells?: string[];
  /** Sentences that print the numbers a planned visual names, so its board may copy them (they are part of `evidence`). */
  visualEvidence?: string[];
  /** Boards the table fills by itself for the planned kind, best first (tables.ts); their numbers are in `evidence`. */
  views?: TableView[];
  /** The actual figure crop supplied to this direction call. Absent means no fine visual targeting. */
  imaged?: string;
  measured?: MeasuredTarget[];
}

/** Named areas of a figure or panel for pen marks: a 3 by 3 grid with some overlap, the four halves, or the whole. */
export const REGION_NAMES = [
  'whole',
  'top-left',
  'top',
  'top-right',
  'left',
  'center',
  'right',
  'bottom-left',
  'bottom',
  'bottom-right',
  'left-half',
  'right-half',
  'top-half',
  'bottom-half',
] as const;
export type RegionName = (typeof REGION_NAMES)[number];
const BANDS = { start: [0, 0.4], middle: [0.3, 0.7], end: [0.6, 1] } as const;
const cell = (x: keyof typeof BANDS, y: keyof typeof BANDS): Region => [
  BANDS[x][0],
  BANDS[y][0],
  BANDS[x][1],
  BANDS[y][1],
];
const REGIONS: Record<RegionName, Region | undefined> = {
  whole: undefined,
  'top-left': cell('start', 'start'),
  top: cell('middle', 'start'),
  'top-right': cell('end', 'start'),
  left: cell('start', 'middle'),
  center: cell('middle', 'middle'),
  right: cell('end', 'middle'),
  'bottom-left': cell('start', 'end'),
  bottom: cell('middle', 'end'),
  'bottom-right': cell('end', 'end'),
  'left-half': [0, 0, 0.5, 1],
  'right-half': [0.5, 0, 1, 1],
  'top-half': [0, 0, 1, 0.5],
  'bottom-half': [0, 0.5, 1, 1],
};
/** The region a named area covers, normalised to the target's box; undefined for the whole target or unknown names. */
export function regionOf(name: string | undefined): Region | undefined {
  const region = REGIONS[name as RegionName];
  return region ? [...region] : undefined;
}

export { boardPartIds, boardPart } from './board';

export { tableLines } from '../../../shared/tableTargets';

/** Planned kinds whose numbers come from the document, so their board may only copy what the evidence prints. */
const NUMERIC_KINDS: readonly string[] = ['bars', 'heatmap', 'scatter'];

export { exampleRules };

/** The board kinds a step's direction offers: its planned kind alone, none when it is planned without a board. */
const plannedKinds = (visual?: StepVisual) =>
  visual ? (visual.visual === 'none' ? [] : [visual.visual]) : [...BOARD_KINDS];

/** Board parts a board_focus cue may light up: those of the planned board, and of an example's frames when offered. */
function focusParts(beat: Beat, visual?: StepVisual): string[] {
  if (!visual) return BOARD_KINDS.flatMap(boardPartIds);
  const kinds = [...plannedKinds(visual), ...(exampleRules(beat, visual).offered ? exampleKinds(visual) : [])];
  return [...new Set(kinds.flatMap(boardPartIds))];
}

/**
 * Sentences that print the numbers a planned visual names in its data, the best matches first: one that has a
 * distinctive number (a decimal, or 100 and more) or at least two of them.
 */
function dataSentences(doc: Doc, visual: StepVisual | undefined, have: string[]): string[] {
  if (!visual || !NUMERIC_KINDS.includes(visual.visual)) return [];
  const named = new Set(numbersIn(visual.data));
  const rare = new Set(distinctive([...named]));
  if (!named.size) return [];
  return proseSentences(doc)
    .filter((s) => !have.includes(s.id))
    .map((s) => {
      const hits = new Set(numbersIn(s.text).filter((n) => named.has(n)));
      return { id: s.id, hits: hits.size, rare: [...hits].some((n) => rare.has(n)) };
    })
    .filter((s) => s.rare || s.hits >= 2)
    .sort((a, b) => b.hits - a.hits)
    .slice(0, 4)
    .map((s) => s.id);
}

/** A table's numbers for a board's evidence and for the brief: its grid as compact text, else its extracted cell lines. */
const tableEvidence = (doc: Doc, table: DocFigure) =>
  gridOf(table) ? tableText(table) : tableLines(doc, table).join('\n');

/**
 * The boards a table fills by itself for the board kind of a step (bars when there is no plan), the ones that match
 * the plan's description of its data best first. Their numbers are cells of the table or computed from them, and all
 * of them are in the table's text, so a board copied from one passes the grounding check.
 */
function offeredViews(table: DocFigure | undefined, visual?: StepVisual): TableView[] {
  const kind = visual ? visual.visual : 'bars';
  if (!table || !gridOf(table) || (kind !== 'bars' && kind !== 'scatter' && kind !== 'heatmap')) return [];
  return viewsFor(tableViews(table), kind, `${visual?.idea ?? ''} ${visual?.data ?? ''}`).slice(0, 2);
}

/**
 * Targets on the page the camera shows: a text beat's paragraphs, or a figure with its panels, or an equation. A
 * numeric board (bars, or a planned heatmap or scatter) may copy numbers from the cited table and from the sentences
 * that print the numbers its plan names.
 */
export function beatTargets(beat: Beat, doc: Doc, visual?: StepVisual): BeatTargets {
  const parts = { parts: focusParts(beat, visual) };
  const numeric = visual ? NUMERIC_KINDS.includes(visual.visual) : beat.board === 'bars';
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const quote = (ids: string[]) => ids.map((id) => sentences.get(id)?.text ?? '').filter(Boolean);
  if (beat.target) {
    const figure = doc.figures.find((f) => f.id === beat.target);
    const equation = doc.equations.find((e) => e.id === beat.target);
    const page = figure?.page ?? equation?.page ?? 1;
    const tableCells =
      figure?.kind === 'table'
        ? tableTextBlocks(doc, figure)
            .slice(0, 60)
            .map((b) => b.id)
        : [];
    const visuals = figure
      ? [
          figure.id,
          ...figure.panels.map((p) => p.id),
          ...figureTextTargets(doc, figure).map((b) => b.id),
          ...tableCells,
        ]
      : [beat.target];
    const table = figure?.kind === 'table' ? { table: figure.id } : {};
    if (!numeric || !figure)
      return {
        page,
        sentences: [],
        visuals,
        tableCells,
        ...table,
        ...parts,
        evidence: figure ? [figure.caption, ...quote(figure.referenced_by)].join('\n') : (equation?.text ?? ''),
      };
    // A table's numbers come from what its brief quotes: the caption, the citing sentences and the cells.
    const cited = figure.referenced_by.slice(0, 4);
    const more = dataSentences(doc, visual, cited);
    const evidence = [figure.caption, ...quote([...cited, ...more]), tableEvidence(doc, figure)];
    const views = offeredViews(figure, visual);
    return {
      page,
      sentences: [],
      visuals,
      tableCells,
      ...table,
      ...parts,
      ...(more.length ? { visualEvidence: more } : {}),
      ...(views.length ? { views } : {}),
      evidence: evidence.join('\n'),
    };
  }
  const first = sentences.get(beat.evidence[0]);
  const page = first?.page ?? beat.page ?? 1;
  // A step on several slides may point at any of them; any other step at the page of its first sentence.
  const blocks = new Set(
    beat.evidence
      .map((id) => sentences.get(id))
      .filter((s) => (beat.slides ? beat.slides.includes(s?.page ?? 0) : s?.page === page))
      .map((s) => s!.block),
  );
  const ids = doc.blocks.filter((b) => blocks.has(b.id)).flatMap((b) => b.sentences);
  const targets = { page, sentences: ids.slice(0, 60), visuals: [], ...parts };
  if (!numeric) return { ...targets, evidence: quote(beat.evidence).join('\n') };
  const have = [...new Set([...beat.evidence, ...(beat.boardEvidence ?? [])])];
  const more = dataSentences(doc, visual, have);
  const quoted = quote([...have, ...more]);
  const table = resultTable(doc, beat.evidence, [...quoted, visual?.data ?? ''].join('\n'));
  const views = offeredViews(table, visual);
  return {
    ...targets,
    evidence: [...quoted, ...(table ? [tableEvidence(doc, table)] : [])].join('\n'),
    ...(more.length ? { visualEvidence: more } : {}),
    ...(table ? { table: table.id } : {}),
    ...(views.length ? { views } : {}),
  };
}

/**
 * Cue actions a beat may use: text beats highlight, figures get the pen, and a formula walks its board's terms. A step
 * planned without a board (or example) has nothing on the board to light up.
 */
function actionsFor(beat: Beat, targets?: BeatTargets, visual?: StepVisual): CueAction[] {
  const board: CueAction[] =
    !visual || visual.visual !== 'none' || exampleRules(beat, visual).offered ? ['board_focus'] : [];
  if (beat.kind === 'formula') return board;
  return [
    ...(beat.target
      ? targets?.table || targets?.measured?.some((t) => t.kind === 'component' || t.kind === 'panel')
        ? (['box'] as const)
        : (['arrow', 'circle', 'box'] as const)
      : (['highlight', 'note'] as const)),
    ...board,
  ];
}

/** The IDs a cue may target, for the actions the beat allows. */
function cueTargets(actions: CueAction[], targets: BeatTargets): string[] {
  const uses = (...names: CueAction[]) => names.some((name) => actions.includes(name));
  return [
    ...(uses('highlight', 'note') ? targets.sentences : []),
    ...(uses('box', 'spotlight', 'arrow', 'circle', 'note') ? targets.visuals : []),
    ...(uses('board_focus') ? (targets.parts ?? []) : []),
  ];
}

/**
 * The spoken length a step aims for: an overview step makes its point in about 50 to 90 words, a detail step adds one
 * worked case in about 90 to 140. The learner reads the page; the voice only says what the page does not. A planned
 * step (a claim's move, a slide) brings its own range.
 */
const sayWords = (beat: Beat) => beat.say?.[1] ?? (beat.detail ? 140 : 90);
const sayShortest = (beat: Beat) => beat.say?.[0] ?? (beat.detail ? 90 : 50);
/** The most words a step may have before it is sent back for a rewrite: a margin over what it aims for. */
export const sayLimit = (beat: Beat) => (beat.say ? Math.round(beat.say[1] * 1.35) : beat.detail ? 175 : 115);

/**
 * A step may run this far past the most words it aims for before it is sent back once to be shortened (the hard limit
 * above rejects it outright). The caps per step kind are those aims: an overview 90, a detail 140, a claim's move or a
 * slide step its own.
 */
export const SAY_MARGIN = 1.15;
export const sayCap = (beat: Beat) => Math.ceil(sayWords(beat) * SAY_MARGIN);

/** The repair for narration past its cap, or none: how long it is, how long it may be, and what to cut. */
export function lengthProblems(say: string, beat: Beat): string[] {
  const words = say.split(/\s+/).filter(Boolean).length;
  return words > sayCap(beat)
    ? [
        `This step is ${words} spoken words; say it in at most ${sayWords(beat)}. Keep the point and the "because" and cut the least important sentence or example.`,
      ]
    : [];
}

/** What the beat's task offers the model: its cue actions, its board, the spoken length it aims for and its tone. */
export function directOptions(beat: Beat, type?: DocType, targets?: BeatTargets, visual?: StepVisual): DirectOptions {
  const board = visual ? plannedKinds(visual)[0] : beat.board;
  return {
    actions: actionsFor(beat, targets, visual),
    ...(board ? { board } : {}),
    words: sayWords(beat),
    ...(beat.say ? { fewest: beat.say[0] } : {}),
    detail: beat.detail,
    ...(beat.move ? { move: beat.move } : {}),
    ...(beat.slides ? { slides: true } : {}),
    ...(type ? { type } : {}),
  };
}

/**
 * The beat's response schema; `strict` adds the enums the model must choose from (the code re-checks them anyway).
 * A board comes before "say", so the narration walks through the terms, stages or numbers the board already holds.
 */
export function directionSchema(beat: Beat, targets: BeatTargets, strict = true, visual?: StepVisual) {
  const actions = actionsFor(beat, targets, visual);
  const offered = exampleRules(beat, visual).offered;
  const ids = strict ? cueTargets(actions, targets) : [];
  if (strict) ids.push(...(targets.measured ?? []).map((t) => t.id));
  const pen = actions.includes('arrow');
  const measured = targets.measured ?? [];
  // A planned step offers its own board kind only (the loose schema, which cleans the answer, still names every kind).
  const kinds = strict ? plannedKinds(visual) : BOARD_KINDS;
  const region = strict
    ? {
        type: 'string',
        enum: targets.imaged ? REGION_NAMES : ['whole'],
        description: 'Legacy region; use whole when exact bounds are supplied.',
      }
    : { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['plan', 'say', 'cues'],
    properties: {
      plan: strict
        ? {
            type: 'string',
            maxLength: 600,
            description: visual
              ? 'Name the one point this step makes, then how the planned visual or the page marks make it click. Do not restate the highlighted sentences.'
              : 'Identify the learner difficulty, choose the most informative visual tool, and explain what quantity, geometry or relationship visibly changes. If source cues suffice, explain why no sideboard is needed.',
          }
        : { type: 'string' },
      ...Object.fromEntries(
        kinds.map((kind) => [
          kind,
          strict
            ? {
                ...boardSchema(kind),
                description:
                  kind === 'scene'
                    ? 'Optional complete live scene. Omit when using example.frames; never insert a placeholder. Text/math objects require nonempty text, matrices require numeric values, plots require a complete plot. Stable IDs identify the same objects across frames.'
                    : `Optional ${kind} board. Omit when unused or when using example.frames; do not fill unused boards with placeholders.`,
              }
            : {},
        ]),
      ),
      ...(!strict || offered ? { example: strict ? exampleSchema(exampleKinds(visual)) : {} } : {}),
      say: {
        type: 'string',
        minLength: 20,
        maxLength: sayLimit(beat) * 9,
        description: `About ${sayShortest(beat)}-${sayWords(beat)} spoken words.`,
      },
      cues: {
        type: 'array',
        ...(strict ? { maxItems: ids.length ? MAX_CUES : 0 } : {}),
        items: {
          type: 'object',
          additionalProperties: false,
          required: strict
            ? ['action', 'target', ...(pen ? ['region'] : []), 'label', 'anchor']
            : ['action', 'target', 'anchor'],
          properties: {
            action: strict ? { type: 'string', enum: actions } : { type: 'string' },
            target: !strict
              ? { type: 'string' }
              : ids.length
                ? { type: 'string', enum: ids }
                : { type: 'string', maxLength: 0 },
            ...(pen || !strict ? { region } : {}),
            ...(!strict ? { bounds: {} } : pen && targets.imaged ? { bounds: BOUNDS_SCHEMA } : {}),
            ...(!strict
              ? { members: {} }
              : measured.length
                ? {
                    members: { type: 'array', maxItems: 4, items: { type: 'string', enum: measured.map((t) => t.id) } },
                  }
                : {}),
            label: {
              type: 'string',
              maxLength: 80,
              description: 'arrow, circle or box: names the part in at most 4 words. note: the remark. Else empty.',
            },
            anchor: { type: 'string', minLength: 1, maxLength: 80, description: 'A 2-6 word phrase copied from say.' },
          },
        },
      },
    },
  };
}

/** The beat's task text: the point to make, its planned visual and the local evidence, quoted from the document. */
export function beatBrief(beat: Beat, doc: Doc, targets: BeatTargets, visual?: StepVisual): string {
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const quote = (ids: string[]) =>
    ids
      .map((id) => sentences.get(id))
      .filter(Boolean)
      .map((s) => `[${s!.id}] ${s!.text}`);
  const lines = [`STEP KIND: ${beat.kind}${beat.detail ? ' (a closer look at one important detail)' : ''}`];
  if ((beat.kind === 'figure' || beat.kind === 'formula') && !beat.move) {
    lines.push(
      beat.detail
        ? 'TEACHING ROLE: build on the preceding overview with one concrete mechanism, worked example or contrast. Explain a new causal link and why it matters. Never restate the overview.'
        : 'TEACHING ROLE: orient the learner: what this computes or depicts, its inputs and outputs, and its purpose. Leave a worked example or close-up causal mechanism for the following detail step.',
    );
  }
  if (beat.role) lines.push(`THIS STEP OF THE TOUR: ${beat.role}`);
  if (beat.claim)
    lines.push(
      `CLAIM ${beat.claim.n} OF ${beat.claim.of}: ${beat.claim.text}`,
      ...(beat.claim.scope ? [`SCOPE OF ITS EVIDENCE: ${beat.claim.scope}`] : []),
    );
  lines.push(`POINT TO MAKE: ${beat.point}`);
  if (visual) {
    const demanded = visual.visual === 'none' && exampleRules(beat, visual).required;
    lines.push(
      demanded
        ? 'VISUAL FOR THIS STEP: none beyond the numerical worked example this step must show (example frames). Teach the rest on the page with highlights and marks.'
        : visualLine(visual),
    );
    if (exampleRules(beat, visual).offered && visual.frames?.length)
      lines.push(
        `WORKED EXAMPLE FRAMES MAY USE ONLY: ${exampleKinds(visual).join(', ')}. Pick each frame's kind by what it shows; the tour counts them toward its limit of each kind, so do not use another.`,
      );
  }
  const figure = doc.figures.find((f) => f.id === beat.target);
  const equation = doc.equations.find((e) => e.id === beat.target);
  const cells = (table: DocFigure) =>
    gridOf(table)
      ? [
          'TABLE AS READ (typed rows and columns; numbers exactly as printed; "-" is a blank cell):',
          tableText(table),
          ...(targets.views?.length
            ? [
                `READY ${targets.views[0].kind.toUpperCase()} BOARDS BUILT FROM THE TABLE BY CODE (every number is a cell of the table or computed from cells): use one as it is, shorten its title or drop rows, or build your own from the table by copying numbers exactly as printed.`,
                ...targets.views.map(viewText),
              ]
            : []),
        ]
      : [`TABLE ${table.number} [${table.id}] CELLS (extracted, one line per block):`, ...tableLines(doc, table)];
  if (figure) {
    lines.push(`${figure.kind.toUpperCase()} ${figure.number} [${figure.id}], page ${figure.page}: ${figure.caption}`);
    if (figure.panels.length)
      lines.push(`PANELS: ${figure.panels.map((p) => `${p.id}${p.label ? ` (${p.label})` : ''}`).join(', ')}`);
    if (targets.imaged === figure.id && figure.kind === 'figure') lines.push(figureFrameText(doc, figure));
    if (targets.measured?.length) lines.push(measuredFrameText(targets.measured));
    lines.push('CITED BY:', ...quote(figure.referenced_by.slice(0, 4)));
    if (figure.kind === 'table')
      lines.push(
        ...cells(figure),
        'GROUNDED TABLE TEXT TARGETS (one extracted block can contain several rows; it is not necessarily a cell):',
        ...tableTextBlocks(doc, figure)
          .slice(0, 60)
          .map((b) => `[${b.id}] ${b.text}`),
        'Use only unlabelled boxes around these complete blocks. Never use arrows, circles, overlaid labels or guessed top/center/bottom/half regions inside a table. A block containing several rows cannot point out one specific value. A group label only encloses the label, not all rows in that group. Explain the row/value verbally or on the side board; if no exact target supports it, keep an unlabelled whole-table overview.',
      );
    lines.push(
      targets.imaged === figure.id
        ? 'The image of this figure is attached. Describe only what is visible or stated.'
        : 'No figure crop is attached for this step. Use an unlabelled overview box only; do not guess component positions, arrows or circles.',
    );
  } else if (equation) {
    const block = doc.blocks.findIndex((b) => b.id === equation.block);
    const around = doc.blocks.slice(Math.max(0, block - 1), block + 2).flatMap((b) => b.sentences);
    const extracted = `extracted text (often garbled): ${equation.text}`;
    const tag = equation.number ? ` (${equation.number})` : ' (it has no printed number)';
    lines.push(`EQUATION${tag} [${equation.id}], page ${equation.page}, ${extracted}`);
    lines.push('TEXT AROUND IT:', ...quote(around.slice(0, 6)));
    lines.push(
      `Page ${equation.page} is attached: read the typeset equation${equation.number ? ` (${equation.number})` : ''} there.`,
    );
  } else if (beat.slides) {
    lines.push(...deckBrief(beat, doc));
    const more = (beat.boardEvidence ?? []).filter((id) => !beat.evidence.includes(id));
    if (more.length) lines.push('MORE NUMBERS FOR THE BARS ONLY (other steps speak about them):', ...quote(more));
    const data = (targets.visualEvidence ?? []).filter((id) => !more.includes(id));
    if (data.length)
      lines.push('SENTENCES WITH THE NUMBERS OF THE PLANNED VISUAL (for its board only):', ...quote(data));
    const table = doc.figures.find((f) => f.id === targets.table);
    if (table) lines.push(...cells(table));
  } else {
    lines.push('EVIDENCE:', ...quote(beat.evidence));
    const more = (beat.boardEvidence ?? []).filter((id) => !beat.evidence.includes(id));
    if (more.length) lines.push('MORE NUMBERS FOR THE BARS ONLY (other steps speak about them):', ...quote(more));
    const data = (targets.visualEvidence ?? []).filter((id) => !more.includes(id));
    if (data.length)
      lines.push('SENTENCES WITH THE NUMBERS OF THE PLANNED VISUAL (for its board only):', ...quote(data));
    const table = doc.figures.find((f) => f.id === targets.table);
    if (table) lines.push(...cells(table));
    lines.push(
      `OTHER SENTENCES YOU MAY HIGHLIGHT: ${targets.sentences.filter((id) => !beat.evidence.includes(id)).join(', ') || 'none'}`,
    );
    if (beat.page) lines.push(`Page ${beat.page} is attached: read the formula there.`);
  }
  if (beat.slides && (figure || equation)) lines.push(...deckBrief(beat, doc));
  lines.push(...(beat.notes ?? []));
  if (beat.kind === 'takeaway' || beat.questions)
    lines.push(
      'This is the last step. End by inviting the learner to ask a question, and mention one of these:',
      ...(beat.questions ?? []).map((q) => `- ${q}`),
    );
  return lines.join('\n');
}

const ajv = new Ajv2020({ strict: false, allErrors: true });

/**
 * Keep a direction whose shape and narration are usable; drop just the cues with an action or target this beat may not
 * use. The board is checked here too, against the rules for a tour step (visual-rules.ts): one that fails comes back as
 * `boardProblems`, without the board. A planned step keeps only its planned board, and an example only when its plan
 * allows one. Pen marks that cannot be drawn as asked are left out and come back as `visualProblems`.
 */
export function cleanDirection(
  value: unknown,
  beat: Beat,
  targets: BeatTargets,
  requireExample = false,
  visual?: StepVisual,
): Direction | null {
  if (!ajv.compile(directionSchema(beat, targets, false, visual))(value)) return null;
  const d = value as Direction & Record<string, unknown>;
  const say = d.say.replace(/\s+/g, ' ').trim();
  const words = say.split(' ').length;
  if (words < 8 || words > sayLimit(beat)) return null;
  const actions = new Set<string>(actionsFor(beat, targets, visual)),
    sentences = new Set(targets.sentences),
    visuals = new Set(targets.visuals),
    parts = new Set(targets.parts);
  const allowed = (c: Cue) => {
    if (c.action === 'highlight') return sentences.has(c.target);
    if (c.action === 'note') return c.label.trim().length > 0 && (sentences.has(c.target) || visuals.has(c.target));
    if (c.action === 'board_focus') return parts.has(c.target);
    return visuals.has(c.target);
  };
  const imaged = targets.imaged === beat.target ? targets.imaged : undefined;
  const visualProblems = visualCueProblems(d.cues, imaged, targets.measured);
  const faulty = new Set(faultyVisualCues(d.cues, imaged, targets.measured));
  const expanded = d.cues.flatMap((c, i) => {
    if (faulty.has(i)) return [];
    const measured = measuredCueTargets(c.target, (c as Cue & { members?: unknown }).members, targets.measured ?? []);
    return measured.length
      ? measured.map((t) => ({ ...c, target: t.target, bounds: t.region, region: undefined }))
      : [c];
  });
  const cues = expanded
    .map((c) => ({
      action:
        targets.table && visuals.has(c.target) && ['arrow', 'circle'].includes(c.action) ? ('box' as const) : c.action,
      target: c.target,
      ...(c.bounds === undefined &&
      REGION_NAMES.includes(c.region as RegionName) &&
      !(targets.table && visuals.has(c.target))
        ? { region: c.region }
        : {}),
      ...(exactBounds(c.bounds) && !(targets.table && visuals.has(c.target)) ? { bounds: exactBounds(c.bounds)! } : {}),
      label:
        (targets.table && visuals.has(c.target)) || (c.bounds !== undefined && !exactBounds(c.bounds))
          ? ''
          : typeof c.label === 'string'
            ? c.label
            : '',
      anchor: c.anchor,
    }))
    .filter((c) => actions.has(c.action) && allowed(c))
    .slice(0, MAX_CUES);
  const rules = exampleRules(beat, visual);
  const example: { example?: WorkedExample; problems: string[] } = rules.offered
    ? checkExample(d.example, say, requireExample || rules.required || claimsNumericExample(say), exampleKinds(visual))
    : { problems: [] };
  const results = reportsResults(beat, targets.table);
  const candidates = plannedKinds(visual)
    .filter((kind) => d[kind] !== undefined && d[kind] !== null)
    .map((kind) => ({ kind, check: groundedCheck(checkBoard(kind, d[kind], targets.evidence), results) }));
  const boards = candidates.filter((c) => c.check.item);
  const boardProblems = candidates.flatMap((c) => c.check.problems.map((p) => `${c.kind}: ${p}`));
  if (boards.length > 1)
    boardProblems.push(
      'Choose one useful native board, or put successive states in example.frames; multiple simultaneous boards cannot be shown.',
    );
  if (example.example && boards.length)
    example.problems.push(
      'Use example frames for the worked case, without a second top-level board repeating or replacing them.',
    );
  const check = example.example ? null : boards[0]?.check;
  const board = check?.item ? { board: check.item } : {};
  return {
    plan: d.plan,
    say,
    cues,
    ...board,
    ...(example.example ? { example: example.example } : {}),
    exampleProblems: example.problems,
    boardProblems,
    visualProblems,
  };
}

/**
 * The sentences a text step highlights: its highlight cues, or when it has none the first sentence of its evidence,
 * which the assembled step marks instead (see beatStep). A step on a figure or equation highlights no sentences.
 */
export function highlightedSentences(direction: Direction, beat: Beat, targets: BeatTargets): string[] {
  if (beat.target) return [];
  const cued = direction.cues.filter((cue) => cue.action === 'highlight').map((cue) => cue.target);
  const first = beat.evidence.find((id) => targets.sentences.includes(id));
  return [...new Set(cued.length ? cued : first ? [first] : [])];
}
