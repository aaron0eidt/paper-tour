import type { Action, Doc, Step, Tour } from './types';
import { splitWords } from './types';
import { readingUnits } from '../../shared/reading';
import { cleanReadingText, DEFAULT_READING_OPTIONS, readingReferences, readingUnitText, type ReadingOptions } from '../../shared/readingText';
export { cleanReadingText, DEFAULT_READING_OPTIONS } from '../../shared/readingText';
export type { ReadingOptions } from '../../shared/readingText';

/** Source-linked playback script. The model prepares each natural unit; ordinary text must retain its words. */
export function readingTour(doc: Doc, options: ReadingOptions = DEFAULT_READING_OPTIONS): Tour {
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const sections = new Map(doc.sections.map((s) => [s.id, s]));
  const refs = readingReferences(doc);
  const clean = (text: string) => cleanReadingText(text, options.removeCitations, refs);
  const chapters: Tour['chapters'] = [];
  let sectionKey: string | undefined;
  for (const unit of readingUnits(doc)) {
    if (!options.includeReferences && unit.blocks.every((b) => b.type === 'reference')) continue;
    const block = unit.blocks[0], object = unit.object;
    const say = readingUnitText(unit, doc, options.removeCitations);
    if (!say && !object) continue;
    const key = unit.blocks.at(-1)?.section ?? `page-${block.page}`;
    if (key !== sectionKey) {
      sectionKey = key;
      chapters.push({ id: `reading-${unit.id}`, title: sections.get(key)?.title ?? `Page ${block.page}`, steps: [] });
    }
    const actions: Action[] = [{ type: 'focus', target: block.id }, { type: 'board_clear' }];
    let at = 0, page = block.page;
    for (const source of unit.blocks) {
      const text = clean(source.text);
      if (source.page !== page) {
        actions.push({ type: 'focus', target: source.id, at_word: at });
        page = source.page;
      }
      const parts = source.sentences.map((id) => sentences.get(id)).filter((s) => !!s)
        .map((s) => ({ id: s.id, text: clean(s.text) })).filter((s) => s.text);
      if (parts.length && parts.map((p) => p.text).join(' ') === text) {
        let offset = at;
        for (const part of parts) {
          actions.push({ type: 'highlight', targets: [part.id], at_word: offset });
          offset += splitWords(part.text).length;
        }
      } else actions.push({ type: 'highlight', targets: [source.id], ...(at ? { at_word: at } : {}) });
      at += splitWords(text).length;
    }
    const step: Step = object
      ? { id: `reading-${unit.id}`, speaker: 'explanation', say: `Preparing a description of this ${object.kind}.`, hold_ms: 0,
          actions: [{ type: 'focus', target: object.id }, object.kind !== 'equation'
            ? { type: 'box', target: object.id, color: 'blue' }
            : { type: 'highlight', targets: [object.id], color: 'blue' }] }
      : { id: `reading-${unit.id}`, speaker: 'reader', say, hold_ms: 0, actions };
    chapters.at(-1)!.steps.push(step);
  }
  return { schema: 'paper-tour/tour@0.1', title: 'Read aloud', paper: doc.source.file,
    doc_sha256: doc.source.sha256, chapters };
}

export function readingStepOnPage(tour: Tour, doc: Doc, page: number): number {
  const pages = new Map(readingUnits(doc).map((unit) => [`reading-${unit.id}`, Math.max(...unit.blocks.map((b) => b.page))]));
  const steps = tour.chapters.flatMap((c) => c.steps);
  const index = steps.findIndex((s) => (pages.get(s.id) ?? 0) >= page);
  return index >= 0 ? index : Math.max(0, steps.length - 1);
}

export function readingStepForTarget(tour: Tour, doc: Doc, target: string): number {
  const unit = readingUnits(doc).find((u) => u.id === target || u.blocks.some((b) => b.id === target));
  return tour.chapters.flatMap((c) => c.steps).findIndex((s) => s.id === `reading-${unit?.id ?? target}`);
}
