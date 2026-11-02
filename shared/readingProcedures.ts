import type { BBox, Doc, DocBlock } from './paper';
import type { ReadingObject } from './reading';
import { sourceOrder } from './readingOrder';

// Structural cues, not paper topics or variable names. A title alone never changes prose into an explanation.
const title = /^(?:algorithm(?:us|e)?|algoritmo|procedure|prozedur|pseudocode)\b/iu;
const ports = /\b(?:input|output|require|ensure|eingabe|ausgabe|entrée|sortie)\s*:/iu;
const assignment = /[←⇐]|:=|(?<![\p{L}\p{N}_])[\p{L}_][\p{L}\p{N}_]*(?:\[[^\]]+\])?\s*=(?!=)/gu;
const control = /\b(?:for\s+[^.;:\n]+(?:\bdo\b|:)|while\s+[^.;\n]+(?:\bdo\b|:)|if\s+[^.;\n]+(?:\bthen\b|:)|repeat\b|until\b|return\s+\S+)/iu;
const declaration = /^(?:def|function|class)\s+[\p{L}_][\p{L}\p{N}_]*\s*[(:]/iu;
const steps = /(?:^|[\s;])\d+[.)]\s+\p{L}/gu;
const ending = /^(?:end(?:\s+(?:for|while|if|function))?|else|do|done|[{}])\s*[;:]?$/iu;
const structural = (b: DocBlock) => b.type === 'equation' || title.test(b.text.trim()) || ports.test(b.text)
  || control.test(b.text) || declaration.test(b.text.trim()) || ending.test(b.text.trim())
  || [...b.text.matchAll(assignment)].length > 0 || [...b.text.matchAll(steps)].length > 0;
const union = (boxes: BBox[]): BBox => [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])),
  Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];
const eligible = (b: DocBlock) => ['heading', 'paragraph', 'equation', 'other'].includes(b.type);

/** Recognize a source procedure across OCR blocks, including embedded equations and closing/output lines. */
export function readingProcedures(doc: Doc, excluded: ReadonlySet<string>): ReadingObject[] {
  const order = sourceOrder(doc);
  const blocks = [...doc.blocks].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const result: ReadingObject[] = [];
  for (let i = 0; i < blocks.length; i++) {
    const first = blocks[i];
    if (excluded.has(first.id) || !eligible(first)) continue;
    const start = first.text.trim();
    if (!(title.test(start) || ports.test(start) || declaration.test(start) || control.test(start)
      || [...start.matchAll(steps)].length >= 2)) continue;
    const heights = doc.sentences.filter((s) => s.page === first.page).flatMap((s) => s.rects.map((r) => r[3] - r[1]))
      .filter((h) => h > 0).sort((a, b) => a - b);
    const line = heights[Math.floor(heights.length / 2)] ?? 12;
    const group = [first];
    let box = first.bbox;
    for (let at = i + 1; at < blocks.length; at++) {
      const next = blocks[at];
      if (excluded.has(next.id) || !eligible(next) || next.page !== first.page || next.section !== first.section) break;
      // Keep neighbouring columns, new headings and the following narrative outside the procedure.
      const overlap = Math.min(box[2], next.bbox[2]) - Math.max(box[0], next.bbox[0]);
      const gap = next.bbox[1] - box[3];
      if (overlap <= 0 || gap > 2 * line || gap < -line || title.test(next.text.trim())
        || next.type === 'heading' || !structural(next)) break;
      group.push(next); box = union([box, next.bbox]);
    }
    const text = group.map((b) => b.text).join('\n');
    const assignments = [...text.matchAll(assignment)].length;
    const numbered = [...text.matchAll(steps)].length;
    const procedural = (title.test(start) && (control.test(text) || numbered >= 2 || assignments > 0))
      || (ports.test(text) && (control.test(text) || numbered >= 2 || assignments >= 2))
      || (control.test(text) && (declaration.test(start) || assignments >= 2))
      || (numbered >= 2 && assignments > 0);
    if (!procedural) continue;
    result.push({ id: `reading-procedure:${first.id}`, kind: 'procedure', page: first.page,
      bbox: box, blocks: group.map((b) => b.id) });
    i += group.length - 1;
  }
  return result;
}
