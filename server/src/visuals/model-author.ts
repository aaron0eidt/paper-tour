import type { Completion, MuseClient, MuseMessage, MuseContent } from '../muse/client';
import { boardSchema } from '../harness/board';
import {
  authorAndInspectVisual,
  AUTHORED_VISUAL_GUIDANCE,
  type AuthoredVisual,
  type VisualRepairContext,
} from './inspect';

const feedbackParts = (feedback: VisualRepairContext): MuseContent[] => [
  {
    type: 'text',
    text: JSON.stringify({
      visual: feedback.item,
      narration: feedback.narration,
      evidence: feedback.evidence,
      problems: feedback.problems,
      frames: feedback.frames.map(({ t, labels, calculations }) => ({ t, labels, calculations })),
    }),
  },
  ...feedback.frames.map((frame) => ({ type: 'image_url' as const, image_url: { url: frame.image } })),
];
export interface ModelVisualContext {
  client: Pick<MuseClient, 'complete'>;
  narration: string;
  evidence: string;
  sourceImages?: string[];
  allowedSourceRefs?: readonly string[];
  signal?: AbortSignal;
  onCompletion?: (completion: Completion) => void;
}
export function sourceReferenceProblems(item: AuthoredVisual, allowed?: readonly string[]): string[] {
  if (item.source === 'document' && !item.sourceRefs.length)
    return ['Document-based visuals need actual sourceRefs from the PDF.'];
  if (!allowed) return [];
  const ids = new Set(allowed);
  return item.sourceRefs
    .filter((id) => !ids.has(id))
    .map((id) => `Unknown PDF source reference ${id}; choose an actual supplied element ID.`);
}
/** Tour and Q&A use this same rendered-output review and targeted correction path. */
export async function reviewAuthoredWithModel(
  item: AuthoredVisual,
  context: ModelVisualContext,
): Promise<AuthoredVisual> {
  const sourceImages = (context.sourceImages ?? [])
    .slice(0, 3)
    .map((url) => ({ type: 'image_url' as const, image_url: { url } }));
  const call = async (messages: MuseMessage[], name: string, schema: object, maxTokens: number) => {
    const completion = await context.client.complete(
      messages,
      name,
      schema,
      maxTokens,
      context.signal,
      undefined,
      undefined,
      'low',
    );
    context.onCompletion?.(completion);
    return completion.value;
  };
  return authorAndInspectVisual(item, {
    narration: context.narration,
    evidence: context.evidence,
    signal: context.signal,
    review: async (feedback) => {
      const references = sourceReferenceProblems(feedback.item, context.allowedSourceRefs);
      if (references.length) return references;
      const value = (await call(
        [
          {
            role: 'developer',
            content:
              'Review a mathematical teaching visual independently against the narration and supplied document evidence. Inspect actual rendered PNG frames. Report only concrete defects: mathematical errors, invented measured values, wrong units or relationships, content that is unrelated to what is spoken, overlapping/unreadable labels, or prose/duplicate formulas posing as a demonstration. An illustrative example is permitted when clearly identified. Do not invent style quotas. Return problems [] when the construction teaches the stated insight faithfully. The first images are rendered frames; subsequent images are original PDF context.',
          },
          { role: 'user', content: [...feedbackParts(feedback), ...sourceImages] },
        ],
        'authored_visual_review',
        {
          type: 'object',
          additionalProperties: false,
          required: ['problems'],
          properties: { problems: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 500 } } },
        },
        1600,
      )) as { problems?: unknown };
      if (!Array.isArray(value.problems) || value.problems.some((p) => typeof p !== 'string'))
        throw Error('Visual reviewer returned an invalid verdict.');
      return value.problems as string[];
    },
    repair: async (feedback) => {
      const value = await call(
        [
          {
            role: 'developer',
            content: `Repair this exact mathematical visual. Preserve the explanation and source facts, fix the reported execution/geometry/math/alignment faults. Return the complete corrected ${feedback.item.kind} item.\n${AUTHORED_VISUAL_GUIDANCE}`,
          },
          { role: 'user', content: [...feedbackParts(feedback), ...sourceImages] },
        ],
        'authored_visual_repair',
        boardSchema(feedback.item.kind),
        12000,
      );
      // Shape/compute errors enter the next inspection round as actionable feedback too.
      return { ...(value && typeof value === 'object' ? value : {}), kind: feedback.item.kind } as AuthoredVisual;
    },
  });
}
