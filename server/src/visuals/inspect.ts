import type { BoardItem } from '../../../shared/paper';
import { plotlyFigure } from '../../../shared/plotly';
import { computePlotlyPython } from './plotly-compute';
import { reviewProgram, type ProgramReview } from './program-review';
export { AUTHORED_VISUAL_GUIDANCE } from './guidance';
export type AuthoredVisual = Extract<BoardItem, { kind: 'program' | 'plotly' }>;
export const isAuthoredVisual = (item: BoardItem): item is AuthoredVisual =>
  item.kind === 'program' || item.kind === 'plotly';

/** Shared asynchronous gate for tour/Q&A authoring. Frames belong in the author/reviewer's multimodal repair context. */
export async function inspectAuthoredVisual(item: AuthoredVisual, signal?: AbortSignal): Promise<ProgramReview> {
  if (item.kind === 'program') return reviewProgram(item, signal);
  try {
    // An independent runtime computes the exact figure contract; browser updates use the same expression AST.
    for (const value of item.parameter ? [item.parameter.min, item.parameter.value, item.parameter.max] : [1]) {
      signal?.throwIfAborted();
      const python = await computePlotlyPython(item, value, signal),
        browser = plotlyFigure(item, value);
      for (const fn of item.functions) {
        const a = python.data[fn.trace].y as (number | null)[],
          b = browser.data[fn.trace].y as (number | null)[];
        if (
          a.length !== b.length ||
          a.some((v, i) =>
            v === null ? b[i] !== null : b[i] === null || Math.abs(v - b[i]!) > 1e-8 * Math.max(1, Math.abs(v)),
          )
        )
          throw Error(`Function trace ${fn.trace} differs between Python and browser computations.`);
      }
    }
    return { problems: [], frames: [] };
  } catch (error) {
    return { problems: [error instanceof Error ? error.message : 'Plot validation failed'], frames: [] };
  }
}

export interface VisualRepairContext extends ProgramReview {
  item: AuthoredVisual;
  narration: string;
  evidence: string;
  attempt: number;
}
/** The workflow supplies its existing model call and must receive the PNGs as images, not JSON strings. */
export async function authorAndInspectVisual(
  initial: AuthoredVisual,
  context: {
    narration: string;
    evidence: string;
    signal?: AbortSignal;
    repair: (feedback: VisualRepairContext) => Promise<AuthoredVisual>;
    review?: (feedback: VisualRepairContext) => Promise<string[]>;
  },
): Promise<AuthoredVisual> {
  let item = initial;
  for (let attempt = 0; attempt < 3; attempt++) {
    const inspection = await inspectAuthoredVisual(item, context.signal);
    const feedback = { ...inspection, item, narration: context.narration, evidence: context.evidence, attempt };
    if (!inspection.problems.length && context.review) feedback.problems.push(...(await context.review(feedback)));
    if (!feedback.problems.length) return item;
    if (attempt === 2) throw new Error(`Authored visual failed inspection: ${feedback.problems.join('; ')}`);
    item = await context.repair(feedback);
  }
  throw new Error('Unreachable visual authoring state');
}
