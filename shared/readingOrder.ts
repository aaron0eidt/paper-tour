import type { Doc } from './paper';

/** Ingestion's block order preserves columns; sorting by y alone does not. */
export function sourceOrder(doc: Doc): Map<string, number> {
  const order = new Map<string, number>();
  const sentences = new Map(doc.sentences.map((sentence) => [sentence.id, sentence]));
  const byBlock = new Map<string, string[]>();
  for (const sentence of doc.sentences) {
    const ids = byBlock.get(sentence.block) ?? [];
    ids.push(sentence.id);
    byBlock.set(sentence.block, ids);
  }
  // Page order is absolute; the original order inside a page is intentional.
  const blocks = [...doc.blocks].sort((a, b) => a.page - b.page);
  for (const block of blocks) {
    order.set(block.id, order.size);
    const ids = [...new Set([...block.sentences, ...(byBlock.get(block.id) ?? [])])];
    for (const id of ids) if (sentences.has(id)) order.set(id, order.size);
  }
  return order;
}
