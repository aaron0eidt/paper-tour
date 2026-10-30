import type { Doc } from '../../../shared/paper';
import { ProcessingError } from '../errors';
import type { MuseMessage } from '../muse/client';
import type { Beat } from './beats';
import type { PaperCard } from './card';
import { repairTurn } from './card';
import { cleanVisualPlan, visualPlanBrief, visualPlanSchema, visualPlanTask, type VisualPlan } from './visual-plan';

interface VisualAuthorInput {
  doc: Doc;
  card: PaperCard;
  beats: Beat[];
  settled: VisualPlan;
  sheet: boolean;
  language: string;
  prefix: MuseMessage[];
  signal: AbortSignal;
  call: (messages: MuseMessage[], schema: object) => Promise<{ value: unknown }>;
  retryable: (error: unknown) => boolean;
  onProblems?: (problems: string[], attempt: number) => Promise<void>;
}

/**
 * Plan every adaptive beat. A provider output truncation splits the request, never the content: each batch still
 * sees the whole tour and previous decisions. There is no pedagogical board quota or total batch limit.
 */
export async function authorVisualPlan(input: VisualAuthorInput): Promise<VisualPlan> {
  const held: VisualPlan = new Map(input.settled);
  const pending = [input.beats.filter((beat) => !held.has(beat.id))];
  const options = { adaptive: true, sheet: input.sheet };
  while (pending.length) {
    input.signal.throwIfAborted();
    const batch = pending.shift()!;
    if (!batch.length) continue;
    const messages: MuseMessage[] = [...input.prefix, {
      role: 'user',
      content: `${visualPlanTask(input.language, options)}\n\n${visualPlanBrief(input.card, input.beats, input.doc, held)}\n\nPlan only these requested beat IDs in this response: ${batch.map((beat) => beat.id).join(', ')}. Every other beat remains in the tour. Previously saved visual decisions are context, not a quota.`,
    }];
    let accepted = false, split = false, problems: string[] = [];
    for (let attempt = 0; attempt < 2 && !accepted && !split; attempt++) {
      try {
        const result = await input.call(messages, visualPlanSchema(batch, options));
        const checked = cleanVisualPlan(result.value, batch, options);
        if (checked.plan) {
          for (const [id, visual] of checked.plan) held.set(id, visual);
          accepted = true;
        } else {
          problems = checked.problems;
          messages.push(...repairTurn(result.value, problems));
          await input.onProblems?.(problems, attempt + 1);
        }
      } catch (error) {
        input.signal.throwIfAborted();
        if (!input.retryable(error)) throw error;
        if (error instanceof ProcessingError && error.code === 'muse_output_truncated' && batch.length > 1) {
          const middle = Math.ceil(batch.length / 2);
          pending.unshift(batch.slice(0, middle), batch.slice(middle));
          split = true;
        } else {
          problems = [error instanceof Error ? error.message : 'The visual plan could not be read.'];
          await input.onProblems?.(problems, attempt + 1);
        }
      }
    }
    if (!accepted && !split)
      throw new ProcessingError('invalid_visual_plan', `The planned explanations need a valid visual decision for every beat. ${problems.join(' ')}`);
  }
  return held;
}
