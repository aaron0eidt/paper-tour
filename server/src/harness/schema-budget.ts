import type { Doc } from '../../../shared/paper';

// The provider rejects a response schema that lists more than 3000 enum values in all ("schema_enum_budget"), and caps an
// enum of more than 250 values at 15000 characters. It counts what is written: a list in $defs counts once however
// often it is referenced, a list written into every field counts every time. A long document has more IDs than that
// (a 63-page lease has 750 citable sentences, which the six fields of the card or the plan repeat), so every call
// that offers IDs shares one list through $defs and, when the list is still long, offers a relevant subset; the code
// that reads the answer checks every ID against the whole document anyway.

export const ENUM_BUDGET = 3000;
/** What the harness plans for, below the provider's limit: the rest is for the fixed lists of the boards and the cues. */
export const ENUM_ROOM = 2400;
/** The most sentence IDs a call may cite from, and the most figures or formulas it may offer besides. */
export const SENTENCE_IDS = 900;
export const FIGURE_IDS = 150;
export const EQUATION_IDS = 250;

const lists = (schema: unknown): string[][] => {
  const found: string[][] = [];
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(visit);
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.enum)) found.push(record.enum.map(String));
    Object.values(record).forEach(visit);
  };
  visit(schema);
  return found;
};

/** The enum values of a schema as the provider counts them. */
export const enumValues = (schema: unknown): number => lists(schema).reduce((n, list) => n + list.length, 0);

/** The characters of the longest enum with more than 250 values, which the provider caps. */
export const enumChars = (schema: unknown): number =>
  Math.max(0, ...lists(schema).map((list) => (list.length > 250 ? list.join('').length : 0)));

/** An enum of the IDs, or an empty string when there are none to choose from. */
export const idEnum = (ids: string[]) =>
  ids.length ? { type: 'string', enum: ids } : { type: 'string', maxLength: 0 };

/**
 * At most `max` of the IDs, in their own order, the preferred ones first in line: the rest of the list is what the
 * model may not cite, and what it names anyway is dropped by the code that reads the answer.
 */
export function pick(ids: string[], max: number, preferred: readonly string[] = []): string[] {
  if (ids.length <= max) return ids;
  const known = new Set(ids);
  const chosen = new Set([...new Set(preferred)].filter((id) => known.has(id)).slice(0, max));
  for (const id of ids) {
    if (chosen.size >= max) break;
    chosen.add(id);
  }
  return ids.filter((id) => chosen.has(id));
}

/** The figures and tables a call may offer: the most cited ones when the document has more than the budget allows. */
export function figureIds(doc: Doc, max = FIGURE_IDS): string[] {
  const cited = [...doc.figures].sort((a, b) => b.referenced_by.length - a.referenced_by.length).map((f) => f.id);
  return pick(
    doc.figures.map((f) => f.id),
    max,
    cited,
  );
}

/** The formulas a call may offer: the numbered ones first when the document has more than the budget allows. */
export function equationIds(doc: Doc, max = EQUATION_IDS): string[] {
  return pick(
    doc.equations.map((e) => e.id),
    max,
    doc.equations.filter((e) => e.number !== null).map((e) => e.id),
  );
}
