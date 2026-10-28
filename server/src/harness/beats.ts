import type { Color, Doc } from '../../../shared/paper';
import type { BoardKind } from './board';
import { ARCS, type Arc, type CardItem, type CardRef, type PaperCard } from './card';
import type { DocType } from './doctype';
import type { Unit } from './exercise';

export const PRESETS = ['quick', 'standard', 'deep'] as const;
/** A hard ceiling for every preset: a tour stays concise, depth comes from questions. */
export const MAX_STEPS = 30;
export type Preset = (typeof PRESETS)[number];
export type BeatKind =
  | 'problem'
  | 'idea'
  | 'method'
  | 'figure'
  | 'formula'
  | 'result'
  | 'limitation'
  | 'takeaway'
  /** The first step of a tour that is not a paper's: what the document is and why it matters. */
  | 'overview'
  /** One point of a lecture, contract, letter or other document. */
  | 'point'
  /** One exercise part taught as several steps: the task, the method, the solution on the board, the answer. */
  | 'exercise';

/** One planned step: what it must get across and which document elements it may point at. */
export interface Beat {
  id: string;
  kind: BeatKind;
  /** The chapter the beat belongs to: an arc of the paper's argument, of another document type, or a task. */
  arc: Arc | string;
  point: string;
  evidence: string[];
  target?: string;
  detail?: boolean;
  questions?: string[];
  /** The side-board item the beat may draw: a formula's terms, a method's flow or a result's numbers as bars. */
  board?: BoardKind;
  /** Highlight colour; by kind when unset. */
  tint?: Color;
  /** What the step is for in the tour, quoted in its brief: "what the reader agrees to". */
  role?: string;
  /** More lines for the brief, such as the tasks an overview introduces. */
  notes?: string[];
  /** Sentences whose numbers a bars board may also show, such as every cost of a contract. */
  boardEvidence?: string[];
  /** A page the direction call sees, for a formula printed in the text rather than as a numbered equation. */
  page?: number;
  /** An exercise beat's part and its plan. */
  unit?: Unit;
}

export interface PlanChapter {
  id: string;
  title: string;
}
/** The tour before any narration: its chapters in order and the beats of each. */
export interface TourPlan {
  type: DocType;
  chapters: PlanChapter[];
  beats: Beat[];
  /** A sentence the first and the last step must say, such as "this is not legal advice". */
  frame?: string;
}

/** A paper's tour: its argument in the six arcs, sized by the preset. */
export function paperPlan(card: PaperCard, doc: Doc, preset: Preset): TourPlan {
  return {
    type: 'research_paper',
    chapters: ARCS.map((arc) => ({ id: arc, title: card.chapter_titles[arc] })),
    beats: planBeats(card, doc, preset),
  };
}

const RESULT_RE = /\b(result|accura|perform|compar|score|bleu|error|outperform|benchmark|ablation|speed|cost)/i;

/** Code-only beat plan (no model): the paper's argument, not its pages. Quick ≈ 6, standard ≈ 10-12, deep ≤ 24 steps. */
export function planBeats(card: PaperCard, doc: Doc, preset: Preset): Beat[] {
  const deep = preset === 'deep';
  const beats: Omit<Beat, 'id'>[] = [];
  // The board a beat may draw: a method as a flow, a result's numbers as bars (formulas and figures below).
  const boards: Partial<Record<BeatKind, BoardKind>> = { result: 'bars' };
  const text = (kind: BeatKind, arc: Arc, item: CardItem | undefined) => {
    const board = kind === 'method' && !beats.some((b) => b.board === 'flow')
      && /(?:then|after|before|pipeline|stages|first|sends|feeds|passes|anschließend|danach|zuerst)/i.test(item?.text ?? '') ? 'flow' : boards[kind];
    if (item?.text && item.evidence.length)
      beats.push({ kind, arc, point: item.text, evidence: item.evidence, ...(board ? { board } : {}) });
  };
  const figureArc = (ref: CardRef): Arc => {
    const figure = doc.figures.find((f) => f.id === ref.id);
    return figure?.kind === 'table' || RESULT_RE.test(`${ref.why} ${figure?.caption ?? ''}`) ? 'evidence' : 'method';
  };
  const figure = (ref: CardRef | undefined) => {
    if (!ref) return;
    const arc = figureArc(ref);
    // A table's numbers may become bars, and a diagram of the method a simplified flow; a results plot draws on itself.
    const table = doc.figures.find((f) => f.id === ref.id)?.kind === 'table';
    const board: BoardKind | undefined = table ? 'bars' : undefined;
    const beat: Omit<Beat, 'id'> = {
      kind: 'figure',
      arc,
      point: ref.why,
      evidence: [],
      target: ref.id,
      ...(board ? { board } : {}),
    };
    beats.push(beat);
    if (deep) beats.push({ ...beat, detail: true });
  };
  const formula = (ref: CardRef | undefined) => {
    if (!ref) return;
    const beat: Omit<Beat, 'id'> = {
      kind: 'formula',
      arc: 'method',
      point: ref.why,
      evidence: [],
      target: ref.id,
      board: 'formula',
    };
    beats.push(beat);
    if (deep) beats.push({ ...beat, detail: true });
  };
  const methods = card.method_steps.slice(0, preset === 'quick' ? 1 : preset === 'standard' ? 3 : 4);
  const figures = card.key_figures.slice(0, preset === 'quick' ? 1 : preset === 'standard' ? 2 : 3);
  const formulas = card.key_formulas.slice(0, preset === 'quick' ? 0 : preset === 'standard' ? 1 : 2);
  text('problem', 'problem', card.problem);
  text('idea', 'idea', card.key_idea);
  methods.forEach((m) => text('method', 'method', m));
  if (preset === 'quick') {
    if (figures[0]) figure(figures[0]);
    else if (card.key_formulas[0]) formula(card.key_formulas[0]);
  } else {
    formulas.forEach(formula);
    figures.forEach(figure);
  }
  card.results.slice(0, preset === 'deep' ? 3 : 1).forEach((r) => text('result', 'evidence', r));
  if (preset !== 'quick')
    card.limitations.slice(0, preset === 'deep' ? 2 : 1).forEach((l) => text('limitation', 'limits', l));
  text('takeaway', 'takeaway', card.takeaway);
  for (let i = beats.length - 1; i >= 0; i--)
    if (beats[i].kind === 'takeaway') {
      beats[i].questions = card.suggested_questions;
      break;
    }
  // Chapters follow the arc; keep the planned order inside each arc.
  const order: Arc[] = ['problem', 'idea', 'method', 'evidence', 'limits', 'takeaway'];
  const counts = new Map<string, number>();
  const takeaway = beats.filter((b) => b.kind === 'takeaway');
  const kept = [...beats.filter((b) => b.kind !== 'takeaway').slice(0, MAX_STEPS - takeaway.length), ...takeaway];
  return kept
    .map((b, i) => ({ b, i }))
    .sort((x, y) => order.indexOf(x.b.arc as Arc) - order.indexOf(y.b.arc as Arc) || x.i - y.i)
    .map(({ b }) => {
      const n = (counts.get(b.kind) ?? 0) + 1;
      counts.set(b.kind, n);
      return { ...b, id: `${b.kind}-${n}` };
    });
}
