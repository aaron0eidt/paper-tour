import { PLOT_SCHEMA } from '../../../shared/plot';
import Ajv2020 from 'ajv/dist/2020.js';
import type { BoardItem, Doc, DocFigure, Region } from '../../../shared/paper';
import type { MuseMessage } from '../muse/client';
import type { Beat } from './beats';
import { BOARD_LIMITS, FLOW_NODE_IDS, boardSchema, checkBoard, numbersIn, type BoardKind } from './board';
import type { DocType } from './doctype';
import type { DirectOptions } from './prompts';

export const CUE_ACTIONS = ['highlight', 'box', 'spotlight', 'note', 'arrow', 'circle', 'board_focus'] as const;
export type CueAction = (typeof CUE_ACTIONS)[number];
export interface Cue {
  action: CueAction;
  target: string;
  /** Where on the figure or panel a pen mark goes; missing means the whole target. */
  region?: RegionName;
  label: string;
  anchor: string;
}
export interface Direction {
  plan: string;
  say: string;
  cues: Cue[];
  /** The side-board item, when the model drew one that passed its checks. */
  board?: BoardItem;
  /** Why the board the model drew was dropped; empty when it passed or none was drawn. */
  boardProblems?: string[];
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
  if (!kind) return [];
  if (kind === 'plot') return ['curve-1', 'curve-2', 'curve-3'];
  const [prefix, most] = kind === 'formula' ? ['term', BOARD_LIMITS.terms[1]] : ['bar', BOARD_LIMITS.bars[1]];
  return Array.from({ length: most }, (_, i) => `${prefix}-${i + 1}`);
}

/** The index board_focus lights up for a part ID, or -1 when the item has no such part. */
export function boardPart(item: BoardItem, id: string): number {
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
  const [x0, y0, x1, y1] = table.bbox;
  const inside = ([a, b, c, d]: number[]) =>
    (a + c) / 2 >= x0 && (a + c) / 2 <= x1 && (b + d) / 2 >= y0 && (b + d) / 2 <= y1;
  return doc.blocks
    .filter((b) => b.page === table.page && b.type === 'table_text' && inside(b.bbox))
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
  const parts = beat.board
    ? { parts: [...boardPartIds(beat.board), ...(beat.kind === 'formula' ? boardPartIds('plot') : [])] }
    : {};
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const quote = (ids: string[]) => ids.map((id) => sentences.get(id)?.text ?? '').filter(Boolean);
  if (beat.target) {
    const figure = doc.figures.find((f) => f.id === beat.target);
    const equation = doc.equations.find((e) => e.id === beat.target);
    const page = figure?.page ?? equation?.page ?? 1;
    const visuals = figure ? [figure.id, ...figure.panels.map((p) => p.id)] : [beat.target];
    if (beat.board !== 'bars' || !figure) return { page, sentences: [], visuals, ...parts };
    // A table's numbers come from what its brief quotes: the caption, the citing sentences and the cells.
    const evidence = [figure.caption, ...quote(figure.referenced_by.slice(0, 4)), ...tableLines(doc, figure)];
    return { page, sentences: [], visuals, ...parts, evidence: evidence.join('\n') };
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
  if (beat.board !== 'bars') return targets;
  const quoted = quote([...new Set([...beat.evidence, ...(beat.boardEvidence ?? [])])]);
  const table = resultTable(doc, beat.evidence, quoted.join('\n'));
  return {
    ...targets,
    evidence: [...quoted, ...(table ? tableLines(doc, table) : [])].join('\n'),
    ...(table ? { table: table.id } : {}),
  };
}

/** Cue actions a beat may use: text beats highlight, figures get the pen, and a formula walks its board's terms. */
function actionsFor(beat: Beat): CueAction[] {
  const board: CueAction[] = beat.board ? ['board_focus'] : [];
  if (beat.kind === 'formula') return board;
  return [...(beat.target ? (['arrow', 'circle', 'box'] as const) : (['highlight', 'note'] as const)), ...board];
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

/** Spoken words a beat aims for; the code accepts up to 70 (90 for the takeaway). */
const sayWords = (beat: Beat) => (beat.kind === 'takeaway' ? 65 : beat.kind === 'formula' ? 55 : 45);

/** What the beat's task offers the model: its cue actions, its board, the spoken length it aims for and its tone. */
export function directOptions(beat: Beat, type?: DocType): DirectOptions {
  return {
    actions: actionsFor(beat),
    ...(beat.board ? { board: beat.board } : {}),
    words: sayWords(beat),
    ...(type ? { type } : {}),
  };
}

/**
 * The beat's response schema; `strict` adds the enums the model must choose from (the code re-checks them anyway).
 * A board comes before "say", so the narration walks through the terms, stages or numbers the board already holds.
 */
export function directionSchema(beat: Beat, targets: BeatTargets, strict = true) {
  const actions = actionsFor(beat);
  const ids = strict ? cueTargets(actions, targets) : [];
  const pen = actions.includes('arrow');
  const words = beat.kind === 'takeaway' ? 90 : 70;
  const region = strict
    ? { type: 'string', enum: REGION_NAMES, description: 'arrow or circle: where the part is in the image.' }
    : { type: 'string' };
  return {
    type: 'object',
    additionalProperties: false,
    required: ['plan', ...(strict && beat.board && beat.kind !== 'formula' ? [beat.board] : []), 'say', 'cues'],
    properties: {
      plan: strict ? { type: 'string', maxLength: 600 } : { type: 'string' },
      ...(beat.board ? { [beat.board]: strict ? boardSchema(beat.board) : {} } : {}),
      ...(beat.kind === 'formula' ? { plot: strict ? PLOT_SCHEMA : {} } : {}),
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
    lines.push('CITED BY:', ...quote(figure.referenced_by.slice(0, 4)));
    if (figure.kind === 'table') lines.push(...cells(figure));
    lines.push('The image of this figure is attached. Describe only what is visible or stated.');
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
export function cleanDirection(value: unknown, beat: Beat, targets: BeatTargets): Direction | null {
  if (!ajv.compile(directionSchema(beat, targets, false))(value)) return null;
  const d = value as Direction & Record<string, unknown>;
  const say = d.say.replace(/\s+/g, ' ').trim();
  const words = say.split(' ').length;
  if (words < 8 || words > (beat.kind === 'takeaway' ? 90 : 70)) return null;
  const actions = new Set<string>(actionsFor(beat)),
    sentences = new Set(targets.sentences),
    visuals = new Set(targets.visuals),
    parts = new Set(targets.parts);
  const allowed = (c: Cue) => {
    if (c.action === 'highlight') return sentences.has(c.target);
    if (c.action === 'note') return c.label.trim().length > 0 && (sentences.has(c.target) || visuals.has(c.target));
    if (c.action === 'board_focus') return parts.has(c.target);
    return visuals.has(c.target);
  };
  const cues = d.cues
    .map((c) => ({
      action: c.action,
      target: c.target,
      ...(REGION_NAMES.includes(c.region as RegionName) ? { region: c.region } : {}),
      label: typeof c.label === 'string' ? c.label : '',
      anchor: c.anchor,
    }))
    .filter((c) => actions.has(c.action) && allowed(c))
    .slice(0, 4);
  const check =
    beat.kind === 'formula' && d.plot
      ? checkBoard('plot', d.plot)
      : beat.board
        ? checkBoard(beat.board, d[beat.board], targets.evidence)
        : null;
  const board = check?.item ? { board: check.item } : {};
  return { plan: d.plan, say, cues, ...board, boardProblems: check?.problems ?? [] };
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
