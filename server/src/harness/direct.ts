import { SCENE_MAX_OBJECTS } from '../../../shared/scene';
import { checkExample, claimsNumericExample, EXAMPLE_SCHEMA, type WorkedExample } from './example';
import { tableTextBlocks } from '../../../shared/tableTargets';
import Ajv2020 from 'ajv/dist/2020.js';
import type { BoardItem, Doc, DocFigure, Region } from '../../../shared/paper';
import type { MuseMessage } from '../muse/client';
import type { Beat } from './beats';
import { BOARD_LIMITS, FLOW_NODE_IDS, boardSchema, checkBoard, numbersIn, type BoardKind } from './board';
import type { DocType } from './doctype';
import type { DirectOptions } from './prompts';
import {
  BOUNDS_SCHEMA,
  exactBounds,
  figureFrameText,
  figureTextTargets,
  measuredCueTargets,
  measuredFrameText,
  visualCueProblems,
  type MeasuredTarget,
} from './visual-grounding';

export const CUE_ACTIONS = ['highlight', 'box', 'spotlight', 'note', 'arrow', 'circle', 'board_focus'] as const;
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

/** Part IDs a board_focus cue chooses from: term-1 … for a formula, the flow's node IDs, bar-1 … for bars. */
export function boardPartIds(kind: BoardKind | undefined): string[] {
  if (kind === 'flow') return [...FLOW_NODE_IDS];
  if (kind === 'scene') return Array.from({ length: SCENE_MAX_OBJECTS }, (_, i) => `object-${i + 1}`);
  if (!kind) return [];
  if (kind === 'plot') return ['curve-1', 'curve-2', 'curve-3'];
  const [prefix, most] = kind === 'formula' ? ['term', BOARD_LIMITS.terms[1]] : ['bar', BOARD_LIMITS.bars[1]];
  return Array.from({ length: most }, (_, i) => `${prefix}-${i + 1}`);
}

/** The index board_focus lights up for a part ID, or -1 when the item has no such part. */
export function boardPart(item: BoardItem, id: string): number {
  if (item.kind === 'scene') {
    const n = Number(/^object-(\d+)$/.exec(id)?.[1]) - 1;
    return n >= 0 && n < item.objects.length ? n : -1;
  }
  if (item.kind === 'plot') {
    const n = Number(/^curve-(\d+)$/.exec(id)?.[1]) - 1;
    return n >= 0 && n < item.curves.length ? n : -1;
  }
  if (item.kind === 'flow') return item.nodes.findIndex((n) => n.id === id);
  const [prefix, size] = item.kind === 'formula' ? ['term', item.terms.length] : ['bar', item.bars.length];
  const n = Number(new RegExp(`^${prefix}-(\\d+)$`).exec(id)?.[1]) - 1;
  return n >= 0 && n < size ? n : -1;
}

/** A table's cells as extracted, one line per text block: the table_text blocks centred inside its box on its page. */
export function tableLines(doc: Doc, table: DocFigure): string[] {
  return tableTextBlocks(doc, table)
    .map((b) => b.text.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, 60);
}

/** The table a result rests on: one its evidence cites, else the one that repeats most of its distinctive numbers. */
function resultTable(doc: Doc, evidence: string[], text: string): DocFigure | undefined {
  const tables = doc.figures.filter((f) => f.kind === 'table');
  const cited = tables.find((t) => t.referenced_by.some((id) => evidence.includes(id)));
  if (cited) return cited;
  // Decimals and larger numbers, but not years: "28.4 BLEU" finds its table, "Table 2" or "2017" does not.
  const distinctive = numbersIn(text).filter((n) => !Number.isInteger(n) || (n >= 100 && !(n >= 1900 && n <= 2100)));
  let best: DocFigure | undefined,
    bestScore = 0;
  for (const table of tables) {
    const printed = numbersIn(tableLines(doc, table).join('\n'));
    const score = new Set(distinctive.filter((n) => printed.includes(n))).size;
    if (score > bestScore) [best, bestScore] = [table, score];
  }
  return best;
}

/** Targets on the page the camera shows: a text beat's paragraphs, or a figure with its panels, or an equation. */
export function beatTargets(beat: Beat, doc: Doc): BeatTargets {
  const parts = { parts: ['formula', 'flow', 'bars', 'plot', 'scene'].flatMap((k) => boardPartIds(k as BoardKind)) };
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
    if (beat.board !== 'bars' || !figure)
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
    const evidence = [figure.caption, ...quote(figure.referenced_by.slice(0, 4)), ...tableLines(doc, figure)];
    return { page, sentences: [], visuals, tableCells, ...table, ...parts, evidence: evidence.join('\n') };
  }
  const first = sentences.get(beat.evidence[0]);
  const page = first?.page ?? 1;
  const blocks = new Set(
    beat.evidence
      .map((id) => sentences.get(id))
      .filter((s) => s?.page === page)
      .map((s) => s!.block),
  );
  const ids = doc.blocks.filter((b) => blocks.has(b.id)).flatMap((b) => b.sentences);
  const targets = { page, sentences: ids.slice(0, 60), visuals: [], ...parts };
  if (beat.board !== 'bars') return { ...targets, evidence: quote(beat.evidence).join('\n') };
  const quoted = quote([...new Set([...beat.evidence, ...(beat.boardEvidence ?? [])])]);
  const table = resultTable(doc, beat.evidence, quoted.join('\n'));
  return {
    ...targets,
    evidence: [...quoted, ...(table ? tableLines(doc, table) : [])].join('\n'),
    ...(table ? { table: table.id } : {}),
  };
}

/** Cue actions a beat may use: text beats highlight, figures get the pen, and a formula walks its board's terms. */
function actionsFor(beat: Beat, targets?: BeatTargets): CueAction[] {
  const board: CueAction[] = ['board_focus'];
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

/** Leave room for causal explanation; detail steps teach a worked example, not a terse caption. */
const sayWords = (beat: Beat) =>
  beat.detail ? 150 : beat.kind === 'takeaway' ? 90 : ['formula', 'method', 'figure'].includes(beat.kind) ? 110 : 80;

/** What the beat's task offers the model: its cue actions, its board, the spoken length it aims for and its tone. */
export function directOptions(beat: Beat, type?: DocType, targets?: BeatTargets): DirectOptions {
  return {
    actions: actionsFor(beat, targets),
    ...(beat.board ? { board: beat.board } : {}),
    words: sayWords(beat),
    detail: beat.detail,
    ...(type ? { type } : {}),
  };
}

/**
 * The beat's response schema; `strict` adds the enums the model must choose from (the code re-checks them anyway).
 * A board comes before "say", so the narration walks through the terms, stages or numbers the board already holds.
 */
export function directionSchema(beat: Beat, targets: BeatTargets, strict = true) {
  const actions = actionsFor(beat, targets);
  const ids = strict ? cueTargets(actions, targets) : [];
  if (strict) ids.push(...(targets.measured ?? []).map((t) => t.id));
  const pen = actions.includes('arrow');
  const measured = targets.measured ?? [];
  const words = beat.detail ? 175 : 135;
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
      plan: strict ? { type: 'string', maxLength: 600 } : { type: 'string' },
      ...Object.fromEntries(
        (['formula', 'flow', 'bars', 'plot', 'scene'] as const).map((kind) => [kind, strict ? {
          ...boardSchema(kind),
          description: kind === 'scene'
            ? 'Optional complete live scene. Omit when using example.frames; never insert a placeholder. Text/math objects require nonempty text, matrices require numeric values, plots require a complete plot. Stable IDs identify the same objects across frames.'
            : `Optional ${kind} board. Omit when unused or when using example.frames; do not fill unused boards with placeholders.`,
        } : {}]),
      ),
      example: strict ? EXAMPLE_SCHEMA : {},
      say: {
        type: 'string',
        minLength: 20,
        maxLength: words * 9,
        description: `About 25-${sayWords(beat)} spoken words.`,
      },
      cues: {
        type: 'array',
        ...(strict ? { maxItems: ids.length ? 4 : 0 } : {}),
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

/** The beat's task text: the point to make and the local evidence, quoted from the document. */
export function beatBrief(beat: Beat, doc: Doc, targets: BeatTargets): string {
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const quote = (ids: string[]) =>
    ids
      .map((id) => sentences.get(id))
      .filter(Boolean)
      .map((s) => `[${s!.id}] ${s!.text}`);
  const lines = [`STEP KIND: ${beat.kind}${beat.detail ? ' (a closer look at one important detail)' : ''}`];
  if (beat.kind === 'figure' || beat.kind === 'formula') {
    lines.push(
      beat.detail
        ? 'TEACHING ROLE: build on the preceding overview with one concrete mechanism, worked example or contrast. Explain a new causal link and why it matters. Never restate the overview.'
        : 'TEACHING ROLE: orient the learner: what this computes or depicts, its inputs and outputs, and its purpose. Leave a worked example or close-up causal mechanism for the following detail step.',
    );
  }
  if (beat.role) lines.push(`THIS STEP OF THE TOUR: ${beat.role}`);
  lines.push(`POINT TO MAKE: ${beat.point}`);
  const figure = doc.figures.find((f) => f.id === beat.target);
  const equation = doc.equations.find((e) => e.id === beat.target);
  const cells = (table: DocFigure) => [
    `TABLE ${table.number} [${table.id}] CELLS (extracted, one line per block):`,
    ...tableLines(doc, table),
  ];
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
    lines.push(`EQUATION (${equation.number}) [${equation.id}], page ${equation.page}, ${extracted}`);
    lines.push('TEXT AROUND IT:', ...quote(around.slice(0, 6)));
    lines.push(`Page ${equation.page} is attached: read the typeset equation (${equation.number}) there.`);
  } else {
    lines.push('EVIDENCE:', ...quote(beat.evidence));
    const more = (beat.boardEvidence ?? []).filter((id) => !beat.evidence.includes(id));
    if (more.length) lines.push('MORE NUMBERS FOR THE BARS ONLY (other steps speak about them):', ...quote(more));
    const table = doc.figures.find((f) => f.id === targets.table);
    if (table) lines.push(...cells(table));
    lines.push(
      `OTHER SENTENCES YOU MAY HIGHLIGHT: ${targets.sentences.filter((id) => !beat.evidence.includes(id)).join(', ') || 'none'}`,
    );
    if (beat.page) lines.push(`Page ${beat.page} is attached: read the formula there.`);
  }
  lines.push(...(beat.notes ?? []));
  if (beat.kind === 'takeaway')
    lines.push(
      'This is the last step. End by inviting the learner to ask a question, and mention one of these:',
      ...(beat.questions ?? []).map((q) => `- ${q}`),
    );
  return lines.join('\n');
}

const ajv = new Ajv2020({ strict: false, allErrors: true });

/**
 * Keep a direction whose shape and narration are usable; drop just the cues with an action or target this beat may not
 * use. The board is checked here too: one that fails comes back as `boardProblems`, without the board.
 */
export function cleanDirection(
  value: unknown,
  beat: Beat,
  targets: BeatTargets,
  requireExample = false,
): Direction | null {
  if (!ajv.compile(directionSchema(beat, targets, false))(value)) return null;
  const d = value as Direction & Record<string, unknown>;
  const say = d.say.replace(/\s+/g, ' ').trim();
  const words = say.split(' ').length;
  if (words < 8 || words > (beat.detail ? 175 : 135)) return null;
  const actions = new Set<string>(actionsFor(beat, targets)),
    sentences = new Set(targets.sentences),
    visuals = new Set(targets.visuals),
    parts = new Set(targets.parts);
  const allowed = (c: Cue) => {
    if (c.action === 'highlight') return sentences.has(c.target);
    if (c.action === 'note') return c.label.trim().length > 0 && (sentences.has(c.target) || visuals.has(c.target));
    if (c.action === 'board_focus') return parts.has(c.target);
    return visuals.has(c.target);
  };
  const visualProblems = visualCueProblems(
    d.cues,
    targets.imaged === beat.target ? targets.imaged : undefined,
    targets.measured,
  );
  const expanded = d.cues.flatMap((c) => {
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
    .slice(0, 4);
  const example = checkExample(
    d.example,
    say,
    requireExample || (beat.kind === 'formula' && !!beat.detail) || claimsNumericExample(say),
  );
  const candidates = (['formula', 'flow', 'bars', 'plot', 'scene'] as const)
    .filter((kind) => d[kind] !== undefined && d[kind] !== null)
    .map((kind) => ({ kind, check: checkBoard(kind, d[kind], targets.evidence) }));
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

/** One repair turn for a board that failed its checks: the exact problems, and the rest of the answer kept. */
export function boardRepair(previous: unknown, kind: BoardKind, problems: string[]): MuseMessage[] {
  const empty = kind === 'formula' ? '' : `, or leave "${kind}" empty if the document does not support it`;
  const content = [
    `The "${kind}" board cannot be shown:`,
    ...problems.map((p) => `- ${p}`),
    `Return the complete answer again with "${kind}" fixed${empty}. Keep "say" and the cues unless they must change.`,
  ];
  return [
    { role: 'assistant', content: JSON.stringify(previous) },
    { role: 'user', content: content.join('\n') },
  ];
}
