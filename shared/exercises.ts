import type { Doc, DocExercisePart } from './paper';

/** Stable task/part IDs refer to the same original blocks, including tasks spanning pages. */
export function exerciseTargets(doc: Doc): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const parts = (items: DocExercisePart[]) => {
    for (const part of items) {
      out.set(part.id, part.blocks);
      parts(part.parts ?? []);
    }
  };
  for (const task of doc.exercises ?? []) {
    out.set(task.id, task.blocks);
    parts(task.parts);
  }
  return out;
}
