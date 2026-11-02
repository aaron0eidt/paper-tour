import type { Action, BBox, Doc, DocBlock } from './paper';
import { readingObjects } from './readingObjects';
import { sourceOrder } from './readingOrder';
export { readingObjects } from './readingObjects';

/** Only visual readings change; existing cached prose remains reusable. */
export const READING_VISUAL_VERSION = 'contextual-visual-reading@1';

export interface ReadingPassageRequest {
  analysisId: string;
  targetId: string;
  removeCitations?: boolean;
}
export interface ReadingPassage {
  targetId: string;
  speech: string;
  language: string;
  actions?: Action[];
}

export function readingMetadata(block: DocBlock): boolean {
  return block.type === 'authors' || block.type === 'header_footer' ||
    (block.type === 'footnote' && /^(?:©|copyright\b|correspond(?:ing|ence)\b|e-?mail\s*:|orcid\b)/i.test(block.text.trim()));
}

export interface ReadingObject {
  id: string;
  kind: 'equation' | 'table' | 'figure';
  page: number;
  bbox: BBox;
  /** Original extracted blocks replaced by this one visual reading. */
  blocks: string[];
  /** Source captions incorporated into this explanation instead of read again. */
  captionBlocks?: string[];
}

export interface ReadingUnit {
  id: string;
  blocks: DocBlock[];
  object?: ReadingObject;
}

/** Natural reading units shared by the model and player: heading chains stay with their first paragraph. */
export function readingUnits(doc: Doc): ReadingUnit[] {
  const order = sourceOrder(doc);
  const objects = readingObjects(doc);
  const byId = new Map(objects.map((o) => [o.id, o]));
  const blocks = [...doc.blocks].sort((a, b) => order.get(a.id)! - order.get(b.id)!);
  const replaced = new Set(objects.filter((o) => !blocks.some((b) => b.id === o.id)).flatMap((o) => [...o.blocks, ...(o.captionBlocks ?? [])]));
  for (const object of objects.filter((o) => !blocks.some((b) => b.id === o.id))) {
    const figure = doc.figures.find((f) => f.id === object.id);
    let at = blocks.findIndex((b) => object.blocks.includes(b.id));
    if (at < 0) at = blocks.findIndex((b) => object.captionBlocks?.includes(b.id));
    if (at < 0 && figure) at = blocks.findIndex((b) => b.page === object.page && b.type === 'caption' &&
      b.text.replace(/\s+/g, ' ').trim() === figure.caption.replace(/\s+/g, ' ').trim());
    if (at < 0) at = blocks.findIndex((b) => b.page === object.page && b.bbox[1] >= object.bbox[1]);
    if (at < 0) at = blocks.findIndex((b) => b.page > object.page);
    if (at < 0) at = blocks.length;
    blocks.splice(at, 0, { id: object.id, type: 'other', page: object.page, bbox: object.bbox,
      text: '', sentences: [], section: blocks[at]?.section });
  }
  const readable = blocks.filter((b) => !replaced.has(b.id) && !readingMetadata(b) && b.type !== 'figure_text');
  const units: ReadingUnit[] = [];
  for (let i = 0; i < readable.length; i++) {
    const first = readable[i];
    const object = byId.get(first.id);
    const group = object ? [first, ...doc.blocks.filter((b) =>
      [...object.blocks, ...(object.captionBlocks ?? [])].includes(b.id) && b.id !== first.id)] : [first];
    if (!object && first.type === 'heading') {
      while (readable[i + 1]?.type === 'heading' && !byId.has(readable[i + 1].id)) group.push(readable[++i]);
      if (readable[i + 1]?.type === 'paragraph' && !byId.has(readable[i + 1].id)) group.push(readable[++i]);
    }
    units.push({ id: first.id, blocks: group, ...(object ? { object } : {}) });
  }
  return units;
}
