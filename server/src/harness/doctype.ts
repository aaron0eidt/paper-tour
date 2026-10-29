import type { Doc } from '../../../shared/paper';

// What kind of document the tour explains (notes/HARNESS.md, stage A). The card call classifies it from the document
// itself; the type chooses the arc, the tone and the board use of the tour.

export const DOC_TYPES = ['research_paper', 'exercise_sheet', 'lecture', 'contract', 'letter', 'other'] as const;
export type DocType = (typeof DOC_TYPES)[number];

/** How the card call tells the types apart. */
export const DOC_TYPE_HELP: Record<DocType, string> = {
  research_paper: 'a scientific or technical paper or report that presents its own work',
  exercise_sheet: 'tasks for the reader to solve: homework, an exercise sheet, a problem set or an exam',
  lecture: 'lecture slides, a lecture script or teaching notes that explain a topic',
  contract: 'a contract, lease, agreement, policy or terms and conditions the reader may accept',
  letter: 'an official letter, notice, bill or form addressed to the reader',
  other: 'anything else',
};

/** How every step of a tour of this type speaks. */
export const TONE: Record<DocType, string> = {
  research_paper:
    'Explain the point directly and precisely, using the paper’s own terms for its concepts. Make the idea intuitive without rhetorical questions or invented drama.',
  exercise_sheet: 'Speak as a patient tutor who works through the exercises with the student.',
  lecture:
    'Teach this part of the lecture to a student as a friendly tutor would: build on what came before without ' +
    'recapping it.',
  contract:
    'Explain in plain words to someone who is about to sign: what each clause means for them, with amounts, dates ' +
    'and periods exactly as written. Stay neutral; never recommend whether to sign.',
  letter:
    'Explain calmly and practically what the letter says, what the reader must do and by when, with dates, ' +
    'amounts and reference numbers exactly as written.',
  other: 'Explain the document clearly and simply to a curious reader.',
};

const PAPER_SECTION = /^(abstract|references|bibliography|related work|literatur(verzeichnis)?|zusammenfassung)$/i;

/** Whether the document is laid out like a paper: an abstract, a reference list or a bibliography. */
export function paperLike(doc: Doc): boolean {
  return (
    doc.blocks.some((b) => b.type === 'reference') ||
    doc.sections.some((s) => PAPER_SECTION.test(s.title.trim())) ||
    doc.blocks.some((b) => b.type !== 'header_footer' && /^abstract\b/i.test(b.text.trim()))
  );
}

/** The type when no model said otherwise: tasks found by ingestion make a sheet, slides a lecture, a paper's layout a paper. */
export function guessType(doc: Doc): DocType {
  if (doc.exercises?.length) return 'exercise_sheet';
  if (deckLike(doc)) return 'lecture';
  return paperLike(doc) ? 'research_paper' : 'other';
}

/** The pages of a slide deck are mostly landscape and carry little text: a few lines a slide, against a paper's page. */
const DECK_MIN_PAGES = 4;
const DECK_LANDSCAPE = 0.8;
const DECK_MAX_MEDIAN_WORDS = 120;

const decks = new WeakMap<Doc, boolean>();

/**
 * Whether the document is a slide deck: ingestion said so, or most pages are landscape and the median page holds little
 * text. Decided from the document alone, so the same document is a deck for every stage and every call.
 */
export function deckLike(doc: Doc): boolean {
  const known = decks.get(doc);
  if (known !== undefined) return known;
  const layout = (doc.source as { layout?: string }).layout;
  let deck = layout === 'slides';
  if (!deck && layout === undefined && doc.pages.length >= DECK_MIN_PAGES) {
    const landscape = doc.pages.filter((p) => p.width > p.height).length / doc.pages.length;
    const sentences = new Map(doc.sentences.map((s) => [s.id, s.text]));
    const words = doc.pages
      .map((page) =>
        doc.blocks
          .filter((b) => b.page === page.n && b.type !== 'header_footer')
          .flatMap((b) => b.sentences)
          .reduce((n, id) => n + (sentences.get(id)?.split(/\s+/).filter(Boolean).length ?? 0), 0),
      )
      .sort((a, b) => a - b);
    deck = landscape >= DECK_LANDSCAPE && words[Math.floor(words.length / 2)] <= DECK_MAX_MEDIAN_WORDS;
  }
  decks.set(doc, deck);
  return deck;
}
