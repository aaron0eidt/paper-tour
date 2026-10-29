import type { Doc } from '../../../shared/paper';
import type { Unit } from './exercise';

/**
 * The text of a part as the solve call and the visual plan read it: the task's statement, the part, the maths only the
 * page shows (as extracted, often garbled) and the parts before it. Sentences come with their IDs.
 */
export function unitTaskLines(unit: Unit, doc: Doc): string[] {
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const quote = (ids: string[]) =>
    ids.flatMap((id) => blocks.get(id)?.sentences ?? []).map((id) => `[${id}] ${sentences.get(id)?.text ?? ''}`);
  const lines: string[] = [];
  if (unit.statement.length) lines.push('TASK STATEMENT, shared by its parts:', ...quote(unit.statement));
  lines.push(unit.part ? 'THIS PART:' : 'THE TASK:', ...quote(unit.blocks));
  if (unit.maths.length)
    lines.push(
      'MATHS ON THE PAGE as extracted (often garbled; read it in the page image):',
      ...unit.maths.map((id) => `[${id}] ${blocks.get(id)!.text.replace(/\s+/g, ' ').trim()}`),
    );
  const earlier = unit.part ? unit.task.parts.slice(0, unit.task.parts.indexOf(unit.part)) : [];
  if (earlier.length)
    lines.push(
      'EARLIER PARTS OF THIS TASK:',
      ...earlier.map((p) => `${p.label}) ${quote(p.blocks.slice(0, 1)).join(' ')}`),
    );
  return lines;
}
