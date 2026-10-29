// Which mark the voice is on. The newest mark of a step is the current one, bright; earlier marks
// settle back. A highlighted passage also gets a sweep that follows the narration along it.

import type { EngineState, FlatStep } from './engine';

export interface MarkPlayback {
  /** Overlay keys of the mark (or marks, when several appear on one word) the voice is on; null shows every mark alike. */
  current: string[] | null;
  /** How far the narration has come through the current mark's passage, 0 to 1. */
  sweep: number;
}

const NONE: MarkPlayback = { current: null, sweep: 1 };
const POINTING = new Set(['highlight', 'box', 'arrow', 'circle', 'spotlight']);

/**
 * The current mark is the newest one the narration has reached; it holds until the next mark
 * appears (or the step ends), and the sweep is the narration's progress over that interval.
 */
export function markPlayback(state: EngineState, steps: readonly FlatStep[]): MarkPlayback {
  const fs = steps[state.index];
  if (!fs || state.status === 'idle' || state.preview) return NONE;
  const marks = fs.schedule.filter((item) => POINTING.has(item.action.type));
  const reached = state.status === 'ended' ? Infinity : Math.max(0, state.word);
  const fired = marks.filter((item) => item.at <= reached);
  if (!fired.length) return NONE;
  const at = fired[fired.length - 1].at;
  const next = marks.find((item) => item.at > at)?.at ?? fs.words.length;
  const span = Math.max(1, next - at);
  // `word` counts spoken words, so a word's end is one past its index.
  const sweep = state.status === 'ended' ? 1 : Math.min(1, Math.max(0, (state.word + 1 - at) / span));
  return { current: fired.filter((item) => item.at === at).map((item) => item.key), sweep };
}
