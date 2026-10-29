// What a checkpoint is called in the reader. On an exercise sheet it is the learner's turn to solve a part; between the
// chapters of a paper or a deck it is a quick check, and the writer names those steps check-1, check-2 and so on
// (server/src/harness/check.ts). Pure, so test/coach.test.ts can check the wording without a DOM.

export type CheckpointKind = 'try' | 'check';

export interface CheckpointWords {
  /** The heading of the card, which is also its label for a screen reader, and the same word on the step in the sidebar. */
  heading: string;
  /** The small mark on the step in the sidebar. */
  chip: string;
  /** The button that lets the tour go on, and its tooltip. */
  reveal: string;
  revealTitle: string;
}

export const CHECKPOINT_WORDS: Record<CheckpointKind, CheckpointWords> = {
  try: { heading: 'Your turn', chip: 'Try', reveal: 'Show solution', revealTitle: 'Show the solution (Space)' },
  check: { heading: 'Quick check', chip: 'Check', reveal: 'Show answer', revealTitle: 'Show the answer (Space)' },
};

/** A step of the writer's quick checks (check-1, check-2 ...) is a check; any other checkpoint is the learner's turn. */
export function checkpointKind(stepId: string | undefined): CheckpointKind {
  return /^check-\d+$/.test(stepId ?? '') ? 'check' : 'try';
}
