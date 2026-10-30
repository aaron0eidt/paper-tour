import type { PlotItem } from './plot';
export type { PlotItem } from './plot';
import type { SceneItem } from './scene';
export type { SceneItem, SceneObject } from './scene';
import type { HeatmapItem } from './heatmap';
export type { HeatmapItem } from './heatmap';
import type { ScatterItem } from './scatter';
export type { ScatterItem } from './scatter';
import type { ShapesItem } from './shapes';
export type { ShapesItem, ShapesTerm } from './shapes';
import type { TimelineItem } from './timeline';
export type { TimelineItem, TimelineEvent, TimelineSpan } from './timeline';
import type { DistributionItem } from './distribution';
export type { DistributionItem, DistributionSpec } from './distribution';
import type { LeftOut } from './coverage';
export type { LeftOut, LossCause, LostPart } from './coverage';
// TypeScript mirror of schema/doc.schema.json and schema/tour.schema.json (version 0.1).
// The schemas are the source of truth; keep these in sync with them.

/** [x0, y0, x1, y1] in PDF points, origin top-left of the page, y down. */
export type BBox = [number, number, number, number];

// ---------------------------------------------------------------- doc.json

export type BlockType =
  | 'title'
  | 'authors'
  | 'heading'
  | 'paragraph'
  | 'caption'
  | 'equation'
  | 'footnote'
  | 'reference'
  | 'figure_text'
  | 'table_text'
  | 'header_footer'
  | 'other';

export interface DocSource {
  file: string;
  sha256: string;
  num_pages: number;
  title?: string;
  generator: string;
}

export interface DocPage {
  n: number;
  width: number;
  height: number;
}

export interface DocSection {
  id: string;
  number?: string;
  title: string;
  level: number;
  page: number;
  block: string;
}

export interface DocBlock {
  id: string;
  page: number;
  type: BlockType;
  bbox: BBox;
  text: string;
  section?: string;
  sentences: string[];
}

export interface DocSentence {
  id: string;
  page: number;
  block: string;
  text: string;
  rects: BBox[];
}

export interface DocPanel {
  id: string;
  bbox: BBox;
  label?: string;
}

/** A column of a table grid, after its row labels. */
export interface DocTableColumn {
  /** The header text, spanning headers first ("BLEU EN-DE"), without direction marks; equal names get a number. */
  name: string;
  /** number: most of the filled cells are numbers. */
  kind: 'number' | 'text';
  /** A unit or scale found in the header or the cells: ms, %, ×10^6. */
  unit?: string;
  /** Which way is better, only when the header says so (an arrow, "higher is better"). */
  better?: 'up' | 'down';
}

export interface DocTableCell {
  /** As printed; empty for a blank cell. Scripts are written d_model and 10^19. */
  text: string;
  /** The number the cell holds, only when the whole cell is one number (0.16 ± 0.11 is 0.16, 2.3 × 10^19 is 2.3e19). */
  value?: number;
}

export interface DocTableRow {
  /** The row label; empty when the row is named by its group or by its cells. */
  label: string;
  /** What several rows share: a label centred beside them, or a title line above them. */
  group?: string;
  /** Text printed across the row's columns. */
  note?: string;
  /** One cell per column. */
  cells: DocTableCell[];
}

/** What a table prints, typed. Only present when the table could be read without guessing. */
export interface DocTableGrid {
  /** medium: part of it was inferred (no rule under the header, a number printed across several columns). */
  confidence: 'high' | 'medium';
  method: 'spans' | 'finder';
  /** Header of the row-label column, when the table has one. */
  label_header?: string;
  columns: DocTableColumn[];
  rows: DocTableRow[];
  /** Lines of text under the last row, inside the table box. */
  notes?: string[];
}

export interface DocFigure {
  id: string;
  kind: 'figure' | 'table';
  number: string;
  page: number;
  bbox: BBox;
  caption: string;
  caption_block?: string;
  image: string;
  panels: DocPanel[];
  referenced_by: string[];
  /** Tables only, and only when readable: the typed rows and columns. */
  grid?: DocTableGrid;
}

export interface DocEquation {
  /** eq and the printed number (eq1, eq5a), or equ1, equ2, ... in reading order for a display without one. */
  id: string;
  /** The printed number; null for a display without one. */
  number: string | null;
  page: number;
  bbox: BBox;
  block?: string;
  text: string;
}

/** A part of an exercise: "a)", "(b)", or a sub-part such as "(ii)" under "(c)". */
export interface DocExercisePart {
  /** The task's ID and the label: ex1.a, ex1.c.ii. */
  id: string;
  /** The printed label without brackets: "a" for "(a)" and "a)". */
  label: string;
  points?: number;
  page: number;
  /** Blocks of the part in reading order, starting with the label's block; includes its sub-parts. */
  blocks: string[];
  parts?: DocExercisePart[];
}

/** A task of an exercise sheet: "Aufgabe 1 (4 Punkte)", "Exercise 2 [6 points]". */
export interface DocExercise {
  /** "ex" and the printed number: ex1, ex2.3, exH1; a repeated number gets a suffix, ex1-2. */
  id: string;
  number: string;
  title?: string;
  points?: number;
  /** Page of the heading. */
  page: number;
  /** The block that starts with the heading. */
  block: string;
  /** Every block of the task in reading order, heading first, across pages. */
  blocks: string[];
  parts: DocExercisePart[];
}

export interface Doc {
  schema: 'paper-tour/doc@0.1';
  source: DocSource;
  pages: DocPage[];
  sections: DocSection[];
  blocks: DocBlock[];
  sentences: DocSentence[];
  figures: DocFigure[];
  equations: DocEquation[];
  /** Exercise sheets only: the tasks and their parts. Absent for other documents. */
  exercises?: DocExercise[];
}

// --------------------------------------------------------------- tour.json

export type Color = 'yellow' | 'blue' | 'green' | 'pink' | 'orange';

/** Normalized to the target's bbox: [x0, y0, x1, y1], each 0..1. */
export type Region = [number, number, number, number];

export interface Voice {
  lang?: string;
  name_hint?: string;
  rate?: number;
  pitch?: number;
}

export interface StepAudio {
  src: string;
  duration_ms?: number;
  word_times_ms?: number[];
}

export interface FocusAction {
  type: 'focus';
  target: string;
  at_word?: number;
}

export interface ZoomAction {
  type: 'zoom';
  target: string;
  region?: Region;
  padding?: number;
  at_word?: number;
}

export interface HighlightAction {
  type: 'highlight';
  targets: string[];
  color?: Color;
  style?: 'marker' | 'underline';
  at_word?: number;
  persist?: boolean;
}

export interface BoxAction {
  type: 'box';
  target: string;
  region?: Region;
  label?: string;
  color?: Color;
  at_word?: number;
  persist?: boolean;
}

export interface SpotlightAction {
  type: 'spotlight';
  target: string;
  region?: Region;
  at_word?: number;
  persist?: boolean;
}

export interface NoteAction {
  type: 'note';
  anchor: string;
  region?: Region;
  text: string;
  side?: 'auto' | 'right' | 'left' | 'top' | 'bottom';
  at_word?: number;
  persist?: boolean;
}

export interface ClearAction {
  type: 'clear';
  at_word?: number;
}

/** Pen: a hand-drawn arrow pointing at the target (or a region of it), drawn in as the narration reaches it. */
export interface ArrowAction {
  type: 'arrow';
  target: string;
  region?: Region;
  label?: string;
  from?: 'auto' | 'left' | 'right' | 'top' | 'bottom';
  color?: Color;
  at_word?: number;
  persist?: boolean;
}

/** Pen: a hand-drawn circle around the target (or a region of it). */
export interface CircleAction {
  type: 'circle';
  target: string;
  region?: Region;
  label?: string;
  color?: Color;
  at_word?: number;
  persist?: boolean;
}

export interface FormulaTerm {
  latex: string;
  label: string;
  color?: Color;
}

/** What the side board shows: the model fills a template, the player animates it. */
export type BoardItem =
  | PlotItem
  | SceneItem
  | HeatmapItem
  | ScatterItem
  | ShapesItem
  | TimelineItem
  | DistributionItem
  | { kind: 'formula'; title?: string; latex: string; terms: FormulaTerm[] }
  | { kind: 'flow'; title?: string; nodes: { id: string; label: string; color?: Color }[]; edges: [string, string][] }
  | {
      kind: 'bars';
      title?: string;
      unit?: string;
      higher_is_better?: boolean;
      bars: { label: string; value: number; color?: Color }[];
    };

/** Show an item on the side board; it stays, across steps, until another board item or board_clear. */
export interface BoardAction {
  type: 'board';
  item: BoardItem;
  at_word?: number;
}

/**
 * Light up one part of the board item, by index: a formula term, flow node, bar, curve (then plot mark), scene object,
 * heatmap row, scatter point, shapes matrix, timeline event (then span) or distribution (then its region).
 */
export interface BoardFocusAction {
  type: 'board_focus';
  part: number;
  at_word?: number;
}

export interface BoardClearAction {
  type: 'board_clear';
  at_word?: number;
}

export type CameraAction = FocusAction | ZoomAction;
export type PenAction = ArrowAction | CircleAction;
export type OverlayAction = HighlightAction | BoxAction | SpotlightAction | NoteAction | PenAction;
export type BoardControl = BoardAction | BoardFocusAction | BoardClearAction;
export type Action = CameraAction | OverlayAction | ClearAction | BoardControl;

/** A pause where the learner tries first: the step asks, hints come one at a time, and the next step reveals the answer. */
export interface Checkpoint {
  /** What the learner should try, in one or two sentences. */
  prompt: string;
  /** Up to three hints, from a nudge to almost the answer. */
  hints: string[];
}

export interface Step {
  id: string;
  speaker?: string;
  say: string;
  hold_ms?: number;
  audio?: StepAudio;
  actions: Action[];
  /** The learner tries this before the next step reveals it (exercise sheets, quick checks). */
  checkpoint?: Checkpoint;
}

export interface Chapter {
  id: string;
  title: string;
  steps: Step[];
}

export interface Tour {
  schema: 'paper-tour/tour@0.1';
  title: string;
  paper: string;
  doc_sha256?: string;
  level?: 'intro' | 'grad' | 'expert';
  voices?: Record<string, Voice>;
  /** Length the tour was written for. */
  preset?: 'quick' | 'standard' | 'deep';
  /** Questions offered to the learner when the tour ends. */
  suggested_questions?: string[];
  /** What the writer planned but left out, and why; absent when the tour is all of its plan (coverage.ts). */
  left_out?: LeftOut[];
  /** The kind of document, so the reader can pick its mode; a lecture deck plays slide by slide. */
  doc_type?: 'research_paper' | 'exercise_sheet' | 'lecture' | 'contract' | 'letter' | 'other';
  chapters: Chapter[];
}

// Defaults stated in tour.schema.json.
export const DEFAULT_SPEAKER = 'host';
export const DEFAULT_HOLD_MS = 300;
export const DEFAULT_ZOOM_PADDING = 0.12;
export const DEFAULT_COLOR: Color = 'yellow';

/** Words are counted by splitting on whitespace; at_word indexes into this list. */
export function splitWords(say: string): string[] {
  return say.split(/\s+/).filter(Boolean);
}
