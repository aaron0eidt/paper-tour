import { BOARD_KINDS, type BoardKind } from './board';
import type { StepVisual } from './visual-plan';
import type { MuseMessage } from '../muse/client';

/** Visual repair owns visual fields and cues. Narration and the teaching point are immutable in this operation. */
export function visualRepairSchema(
  schema: {
    properties: Record<string, unknown>;
    required: string[];
    [key: string]: unknown;
  },
  draft?: Record<string, unknown>,
) {
  const { say: _say, plan: _plan, ...properties } = schema.properties;
  if (draft?.example && properties.example) {
    return {
      type: 'object',
      additionalProperties: false,
      properties: { cues: properties.cues, example: properties.example },
      required: ['cues', 'example'],
    };
  }
  return { ...schema, properties, required: schema.required.filter((key) => key !== 'say' && key !== 'plan') };
}

export function mergeVisualRepair(draft: Record<string, unknown>, patch: Record<string, unknown>) {
  // The patch replaces the visual representation, so an old board and new example cannot coexist accidentally.
  return { ...patch, say: draft.say, plan: draft.plan };
}

export function visualRepairTask(
  base: MuseMessage[],
  draft: Record<string, unknown>,
  problems: string[],
  revision = 1,
): MuseMessage[] {
  return [
    ...base,
    {
      role: 'user',
      content: JSON.stringify({
        operation: 'repair_visual_only',
        revision,
        strategy:
          revision > 1
            ? 'A previous repair did not resolve these problems. Change the construction or algorithm that caused them; do not merely repeat the same output.'
            : 'Correct the specific missing or invalid visual.',
        instructions:
          'Keep the saved narration and teaching point unchanged. Return exactly ONE complete corrected representation allowed by the current response schema and its cues, anchored in the saved narration. An example replaces the top-level board; never return both. Do not copy obsolete representations from the saved draft. Supply the missing visual when none was saved. Use the supplied PDF evidence. Do not return say or plan. Fix these concrete problems rather than rewriting the explanation.',
        saved: draft,
        problems,
      }),
    },
  ];
}

/** Reconsider a failed tool choice explicitly rather than dropping the planned explanation or visual. */
export function representationSchema(previous: BoardKind) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['visual', 'idea', 'data', 'reason'],
    properties: {
      visual: { type: 'string', enum: BOARD_KINDS.filter((kind) => kind !== previous) },
      idea: { type: 'string', minLength: 1 },
      data: { type: 'string' },
      reason: { type: 'string', minLength: 1 },
    },
  };
}
export function revisedRepresentation(value: unknown, previous: BoardKind): StepVisual {
  const plan = value as { visual?: BoardKind; idea?: string; data?: string; reason?: string } | null;
  if (
    !plan ||
    !BOARD_KINDS.includes(plan.visual!) ||
    plan.visual === previous ||
    !plan.idea?.trim() ||
    typeof plan.data !== 'string' ||
    !plan.reason?.trim()
  )
    throw new Error('Choose a different supported visual and explain how it teaches the same objective.');
  return { visual: plan.visual!, idea: plan.idea, data: plan.data, flexible: true };
}
