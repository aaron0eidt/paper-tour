import type { MuseMessage } from '../muse/client';

/** Visual repair owns visual fields and cues. Narration and the teaching point are immutable in this operation. */
export function visualRepairSchema(schema: {
  properties: Record<string, unknown>;
  required: string[];
  [key: string]: unknown;
}) {
  const { say: _say, plan: _plan, ...properties } = schema.properties;
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
          'Keep the saved narration and teaching point unchanged. Return only the complete corrected visual (or worked example) and its cues, anchored in the saved narration. Supply the missing visual when none was saved. Use the supplied PDF evidence. Do not return say or plan. Fix these concrete problems rather than rewriting the explanation.',
        saved: draft,
        problems,
      }),
    },
  ];
}
