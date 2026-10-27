import type { Doc } from '../../../shared/paper';
import type { Arc, CardItem, CardRef, PaperCard } from './card';

export const PRESETS = ['quick', 'standard', 'deep'] as const;
/** A hard ceiling for every preset: a tour stays concise, depth comes from questions. */
export const MAX_STEPS = 30;
export type Preset = (typeof PRESETS)[number];
export type BeatKind = 'problem' | 'idea' | 'method' | 'figure' | 'formula' | 'result' | 'limitation' | 'takeaway';

/** One planned step: what it must get across and which document elements it may point at. */
export interface Beat {
  id: string;
  kind: BeatKind;
  arc: Arc;
  point: string;
  evidence: string[];
  target?: string;
  detail?: boolean;
  questions?: string[];
}

const RESULT_RE = /\b(result|accura|perform|compar|score|bleu|error|outperform|benchmark|ablation|speed|cost)/i;

/** Code-only beat plan (no model): the paper's argument, not its pages. Quick ≈ 6, standard ≈ 10-12, deep ≤ 24 steps. */
export function planBeats(card: PaperCard, doc: Doc, preset: Preset): Beat[] {
  const deep = preset === 'deep';
  const beats: Omit<Beat, 'id'>[] = [];
  const text = (kind: BeatKind, arc: Arc, item: CardItem | undefined) => {
    if (item?.text && item.evidence.length) beats.push({ kind, arc, point: item.text, evidence: item.evidence });
  };
  const figureArc = (ref: CardRef): Arc => {
    const figure = doc.figures.find((f) => f.id === ref.id);
    return figure?.kind === 'table' || RESULT_RE.test(`${ref.why} ${figure?.caption ?? ''}`) ? 'evidence' : 'method';
  };
  const figure = (ref: CardRef | undefined) => {
    if (!ref) return;
    beats.push({ kind: 'figure', arc: figureArc(ref), point: ref.why, evidence: [], target: ref.id });
    if (deep) beats.push({ kind: 'figure', arc: figureArc(ref), point: ref.why, evidence: [], target: ref.id, detail: true });
  };
  const formula = (ref: CardRef | undefined) => {
    if (!ref) return;
    beats.push({ kind: 'formula', arc: 'method', point: ref.why, evidence: [], target: ref.id });
    if (deep) beats.push({ kind: 'formula', arc: 'method', point: ref.why, evidence: [], target: ref.id, detail: true });
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
  if (preset !== 'quick') card.limitations.slice(0, preset === 'deep' ? 2 : 1).forEach((l) => text('limitation', 'limits', l));
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
    .sort((x, y) => order.indexOf(x.b.arc) - order.indexOf(y.b.arc) || x.i - y.i)
    .map(({ b }) => {
      const n = (counts.get(b.kind) ?? 0) + 1;
      counts.set(b.kind, n);
      return { ...b, id: `${b.kind}-${n}` };
    });
}
