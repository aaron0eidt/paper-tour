// Coach checkpoints: a step that asks the learner to try first. The tour pauses after its narration, hints come one
// at a time, and the next step reveals the answer. Pure, so the rules can be tested without a DOM.

import type { Checkpoint } from './types';

export const MAX_HINTS = 3;

/**
 * A step's checkpoint as the reader uses it: a prompt and up to three hints. A checkpoint without a prompt is not
 * one (the tour just plays on), and a malformed hint is dropped rather than failing the tour.
 */
export function normalizeCheckpoint(raw: unknown): Checkpoint | null {
  if (!raw || typeof raw !== 'object') return null;
  const { prompt, hints } = raw as { prompt?: unknown; hints?: unknown };
  if (typeof prompt !== 'string' || !prompt.trim()) return null;
  const given = Array.isArray(hints) ? hints : [];
  const kept = given.filter((hint): hint is string => typeof hint === 'string' && hint.trim() !== '');
  return { prompt: prompt.trim(), hints: kept.map((hint) => hint.trim()).slice(0, MAX_HINTS) };
}

/** How many hints show once the learner asks for another. */
export function moreHints(shown: number, total: number): number {
  return Math.min(Math.max(0, total), Math.max(0, Math.floor(shown)) + 1);
}

/** What the hint button says: "Hint", then which of the remaining ones is next; null once every hint is out. */
export function hintLabel(shown: number, total: number): string | null {
  if (total <= 0 || shown >= total) return null;
  return shown === 0 ? (total > 1 ? `Hint (1 of ${total})` : 'Hint') : `Another hint (${shown + 1} of ${total})`;
}
