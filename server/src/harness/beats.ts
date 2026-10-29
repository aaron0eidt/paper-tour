import type { Color, Doc } from '../../../shared/paper';
import type { BoardKind } from './board';
import { ARCS, type Arc, type CardItem, type CardRef, type PaperCard } from './card';
import type { DocType } from './doctype';
import type { Unit } from './exercise';
import type { Move } from './moves';
import { indexElements } from '../elements';

export const PRESETS = ['quick', 'standard', 'deep'] as const;
/** Planning guardrail; spend depth on mechanisms and comparisons, never padding. */
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
  /** The side-board item the beat may draw: a formula's terms or a result's numbers as bars. */
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
  /** What the step does in a claim's argument; its narration follows that move's grammar (moves.ts). */
  move?: Move;
  /** The claim a step of a claim-organised paper tour belongs to, and how far its evidence reaches. */
  claim?: { n: number; of: number; text: string; scope?: string };
  /** The spoken length the step aims for, fewest and most words; the kind's default when unset. */
  say?: [number, number];
  /** A slide step: the pages (slides) it covers, the lead slide first. */
  slides?: number[];
  /** Earlier slides the step connects back to, which the narration names. */
  callbacks?: number[];
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
  const beats = planBeats(card, doc, preset);
  if (preset === 'deep') {
    const elements = new Map(indexElements(doc).map((e) => [e.id, e]));
    const source = (beat: Beat) => elements.get(beat.target ?? beat.evidence[0]);
    const ordered = beats
      .filter((b) => b.kind !== 'takeaway')
      .sort((a, b) => {
        const x = source(a),
          y = source(b);
        return (x?.page ?? 1) - (y?.page ?? 1) || (x?.bbox?.[1] ?? 0) - (y?.bbox?.[1] ?? 0);
      });
    const chapters: PlanChapter[] = [];
    for (const beat of ordered) {
      const page = source(beat)?.page ?? 1;
      const id = `page-${page}`;
      if (!chapters.some((c) => c.id === id)) {
        const y = source(beat)?.bbox?.[1] ?? 0;
        const section = doc.sections
          .filter((s) => s.page < page || (s.page === page && (elements.get(s.block)?.bbox?.[1] ?? Infinity) <= y))
          .sort(
            (a, b) =>
              a.page - b.page || (elements.get(a.block)?.bbox?.[1] ?? 0) - (elements.get(b.block)?.bbox?.[1] ?? 0),
          )
          .at(-1);
        chapters.push({ id, title: section ? `Page ${page} · ${section.title}` : `Page ${page}` });
      }
      beat.arc = id;
    }
    const ending = beats.filter((b) => b.kind === 'takeaway');
    if (ending.length) chapters.push({ id: 'takeaway', title: card.chapter_titles.takeaway });
    return { type: 'research_paper', chapters, beats: [...ordered, ...ending] };
  }
  return {
    type: 'research_paper',
    chapters: ARCS.map((arc) => ({ id: arc, title: card.chapter_titles[arc] })),
    beats,
  };
}

const RESULT_RE = /\b(result|accura|perform|compar|score|bleu|error|outperform|benchmark|ablation|speed|cost)/i;

const TEACHING_ROLES: Partial<Record<BeatKind, string>> = {
  problem:
    'State the problem in one plain sentence, then say what makes it hard or what goes wrong today. The learner can read the highlighted sentences, so add the cause or the stakes instead of rewording them. Keep a neutral tone without a hook or rhetorical question.',
  idea: 'Say the central contribution in one sentence, then why it answers the stated problem: what it changes and what that buys. Preserve the authors’ claims and qualifications and add the intuition, not a rewording of the highlighted sentences.',
  method:
    'Explain how the mechanism works in the order presented: inputs, operations and outputs, and why each part is needed. Do not reword the highlighted sentences. Give reasons supported by the text; do not invent failure cases or unsupported causal claims.',
  result:
    'Lead with the result: the experiment, metric and comparable baseline, then the values and their difference. Then say what the gap supports and what it does not establish; state only the supported implication and its scope.',
  limitation:
    'Show where the preceding explanation stops working or remains uncertain, and why that boundary matters for applying the method.',
  takeaway:
    'Summarize the paper’s conclusion, main evidence and limitations in neutral language. Offer a relevant follow-up question without inventing a dramatic resolution.',
};

/** Card summaries may cite just the claim; its paragraph contains the causal
 * explanation. Make that evidence available without adding unrelated pages. */
function mechanismEvidence(item: CardItem, doc: Doc): string[] {
  const cited = new Set(item.evidence);
  const primary = doc.sentences.find((s) => s.id === item.evidence[0]);
  const local = primary ? doc.sentences.filter((s) => s.page === primary.page && s.block === primary.block) : [];
  return [...new Set([...item.evidence, ...local.map((s) => s.id).filter((id) => !cited.has(id))])];
}

/** Code-only beat plan (no model): the paper's argument, not its pages. Quick ≈ 6, standard ≈ 10-12, deep ≤ 24 steps. */
export function planBeats(card: PaperCard, doc: Doc, preset: Preset): Beat[] {
  const deep = preset === 'deep';
  const beats: Omit<Beat, 'id'>[] = [];
  // The board a beat may draw: a result's numbers as bars (formulas and figures below). A method gets none: a chain of
  // stages is a list, and a flow with a branch or a loop is for the visual plan to choose.
  const boards: Partial<Record<BeatKind, BoardKind>> = { result: 'bars' };
  const text = (kind: BeatKind, arc: Arc, item: CardItem | undefined) => {
    const board = boards[kind];
    if (item?.text && item.evidence.length)
      beats.push({
        kind,
        arc,
        point: item.text,
        evidence: deep && kind === 'method' ? mechanismEvidence(item, doc) : item.evidence,
        ...(board ? { board } : {}),
        role: TEACHING_ROLES[kind],
        ...(kind === 'result'
          ? {
              boardEvidence: [...new Set(card.results.flatMap((r) => r.evidence))],
              notes: [
                'COMPARISON: choose one meaningful contrast with matching metric, dataset and conditions. Explain the gap or trade-off, not a list of scores. If a board helps, reveal/focus the baseline, proposed result and comparison when those values are spoken. Extra result evidence is only for genuinely comparable values.',
              ],
            }
          : {}),
        ...(deep && kind === 'method'
          ? {
              notes: [
                "MECHANISM: use the supporting paragraph to explain a causal chain or one small worked case. Connect it to the paper's central problem, distinguish illustrative inputs from evidence, and avoid repeating an adjacent figure or formula overview.",
              ],
            }
          : {}),
      });
  };
  const figureArc = (ref: CardRef): Arc => {
    const figure = doc.figures.find((f) => f.id === ref.id);
    return figure?.kind === 'table' || RESULT_RE.test(`${ref.why} ${figure?.caption ?? ''}`) ? 'evidence' : 'method';
  };
  const figure = (ref: CardRef | undefined) => {
    if (!ref) return;
    const arc = figureArc(ref);
    // A table's numbers may become bars; the figure of a method or a results plot is taught on the page.
    const table = doc.figures.find((f) => f.id === ref.id)?.kind === 'table';
    const board: BoardKind | undefined = table ? 'bars' : undefined;
    const beat: Omit<Beat, 'id'> = {
      kind: 'figure',
      arc,
      point: ref.why,
      evidence: [],
      target: ref.id,
      ...(board ? { board } : {}),
      role: table
        ? 'Orient the learner to the experiment question, metric and comparison groups. Explain what the table can test before reading individual values.'
        : "Orient the learner to the mechanism: identify its input, output and purpose, then trace the main relationship that solves the paper's problem.",
    };
    beats.push(beat);
    if (deep)
      beats.push({
        ...beat,
        detail: true,
        role: table
          ? 'Work through one meaningful numerical comparison: baseline, changed condition, result and size of the difference. Explain what it supports and what it cannot establish.'
          : 'Follow one concrete input, interaction or failure case through the depicted mechanism. Explain why the intermediate changes matter instead of repeating the overview or printed labels.',
        notes: [
          table
            ? 'Keep compared values on the same metric and evaluation setting. Use a side comparison only if it adds insight; synchronize each value with its spoken explanation. Do not invent a causal reason for an observed score gap.'
            : 'Choose one important causal path. A separate visual should show a transformation, interaction or worked example that the static source does not already make obvious.',
        ],
      });
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
      role: 'Explain the equation as a mechanism: what enters, what each important operation changes, why it is needed, and what the output means.',
    };
    beats.push(beat);
    if (deep)
      beats.push({
        ...beat,
        detail: true,
        role: 'Apply the equation to an explicitly labelled small worked case. Change an input, compute the consequence and explain the intuition; the symbol definitions have already been taught.',
      });
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
