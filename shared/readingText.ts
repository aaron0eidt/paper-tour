export interface ReadingOptions {
  removeCitations: boolean;
  includeReferences: boolean;
}
export const DEFAULT_READING_OPTIONS: ReadingOptions = { removeCitations: true, includeReferences: false };

export function readingUnitText(unit: import('./reading').ReadingUnit, doc: import('./paper').Doc, removeCitations: boolean): string {
  const refs = readingReferences(doc);
  return unit.blocks.map((b) => {
    const text = cleanReadingText(b.text, removeCitations, refs);
    return b.type === 'heading' && text && !/[.!?:]$/.test(text) ? `${text}.` : text;
  }).filter(Boolean).join(' ');
}

/** Only typography and recognizable citation syntax change. Never summarize or invent spoken maths. */
export function cleanReadingText(text: string, removeCitations = true, referenceNumbers: ReadonlySet<number> = new Set()): string {
  let clean = text
    .replace(/\u00ad\s*\n\s*/g, '')
    .replace(/\u00ad/g, '')
    // Keep real hyphens: "loss-\nfree" must not become "lossfree".
    .replace(/(\p{L})-[ \t]*\r?\n[ \t]*(?=\p{L})/gu, '$1-')
    .replace(/ﬁ/g, 'fi').replace(/ﬂ/g, 'fl');
  if (removeCitations) {
    clean = clean
      // Only numbers present in the bibliography and following a prose word.
      // In particular preserve [0, 1], x[2], x [2], and expressions after = or ∈.
      .replace(/\[\s*\d+(?:\s*[,;–-]\s*\d+)*\s*\]/g, (match, offset: number, whole: string) => {
        const numbers = match.match(/\d+/g)!.map(Number);
        const before = whole.slice(0, offset);
        const mathematical = /(?:\b(?:interval|range|vector|matrix|array|indices|index|coordinates?|bounds?|domain|values?|dimensions?|shape|tensor|intervall|bereich|vektor)|[=∈])\s*$/iu.test(before);
        const prose = !mathematical && /\p{L}{2,}[ \t]+$/u.test(before);
        return prose && numbers.every((n) => n > 0 && referenceNumbers.has(n)) ? '' : match;
      })
      .replace(/\((?:[\p{Lu}][\p{L}'’.-]+(?:\s+(?:et\s+al\.|and|&|[\p{Lu}][\p{L}'’.-]+))*[, ]+)(?:19|20)\d{2}[a-z]?(?:\s*;[^()]*?(?:19|20)\d{2}[a-z]?)*\)/gu, '');
  }
  return clean.replace(/\s+/g, ' ').replace(/\s+([,.;:!?])/g, '$1').trim();
}


/** Numeric reference IDs explicitly present in the source bibliography. */
export function readingReferences(doc: import('./paper').Doc): Set<number> {
  return new Set(doc.blocks.filter((b) => b.type === 'reference')
    .flatMap((b) => [...b.text.matchAll(/(?:^|\n)\s*(?:\[(\d+)\]|(\d+)\.)\s/g)].map((m) => Number(m[1] ?? m[2]))));
}

/** Word positions must survive cleanup so source cues keep their exact timing. */
export function sameReadingWords(source: string, speech: string): boolean {
  const words = (text: string) => text.split(/\s+/).filter(Boolean).map((word) =>
    word.normalize('NFKC').toLowerCase().replace(/[’‘]/g, "'").replace(/^[('\"]+|[.,;:!?)\"]+$/g, '')
      .replace(/(?<=\p{L}{2})[-‐‑](?=\p{L})|(?<=\p{L})[-‐‑](?=\p{L}{2})/gu, ''));
  const a = words(source), b = words(speech);
  return a.length === b.length && a.every((word, i) => word === b[i]);
}
