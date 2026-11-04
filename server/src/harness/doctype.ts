import type { Doc } from '../../../shared/paper';

// What kind of document the tour explains (notes/HARNESS.md, stage A). The card call classifies it from the document
// itself; the type chooses the arc, the tone and the board use of the tour.

export const DOC_TYPES = [
  'research_paper',
  'exercise_sheet',
  'lecture',
  'contract',
  'letter',
  'manual',
  'report',
  'article',
  'literature',
  'medical',
  'other',
] as const;
export type DocType = (typeof DOC_TYPES)[number];

/**
 * How the card call tells the types apart, and how each reads after "It is": the examples route the neighbours (a
 * policy to a contract, a form to a letter, a textbook chapter to a lecture) so that the classifier has one place for
 * each kind of document.
 */
export const DOC_TYPE_HELP: Record<DocType, string> = {
  research_paper: 'a scientific or technical paper or report that presents its own work',
  exercise_sheet: 'tasks for the reader to solve: homework, an exercise sheet, a problem set or an exam',
  lecture: 'lecture slides, a lecture script, a textbook chapter or teaching notes that explain a topic',
  contract: 'a contract, lease, agreement, policy, code of conduct or terms and conditions the reader may accept',
  letter: 'an official letter, notice, bill, form or application addressed to the reader (a medical letter is medical)',
  manual:
    'a manual, set of instructions, how-to guide, datasheet, piece of technical or API documentation, or recipe ' +
    'that tells the reader how to use, build, make or do something (a textbook chapter is a lecture)',
  report:
    'a business, annual, financial, government or project report, or the results of a lab experiment or study, ' +
    'that reports figures for a period or an outcome (a paper that presents new research is a research_paper)',
  article:
    'a news or magazine article, essay, opinion piece or blog post that reports on or argues about something for ' +
    'general readers (a scientific paper is a research_paper)',
  literature:
    'a poem, story, play, novel excerpt or other literary text to read for its form and meaning (an essay about ' +
    'literature is an article)',
  medical:
    'a patient information leaflet, package insert, medical test result (such as blood work), medical letter, ' +
    'discharge summary or other health information for a patient (a clinical study is a research_paper)',
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
  manual:
    'Speak as an experienced technician standing next to the reader: say what to do, in order, and why each step ' +
    'matters, with times, temperatures, settings, commands and part names exactly as written. Say plainly what ' +
    'must not be done.',
  report:
    'Brief a colleague as an analyst would: lead with what changed and why, with every number, unit, currency and ' +
    'period exactly as written. Compare only what the report compares, stay neutral and never recommend an action.',
  article:
    'Speak as a thoughtful, neutral editor: say what the author claims and what evidence the article gives for ' +
    'it, attribute every view to whoever holds it, and keep the article’s facts apart from your own remarks. ' +
    'Never take a side.',
  literature:
    'Teach as an enthusiastic literature teacher: point at the exact words and say what they do to the reader, ' +
    'then link them to the meaning. Quote only the few words you point at; never paraphrase the whole text, and ' +
    'never present one reading as the only one.',
  medical:
    'Explain calmly and in plain words, with doses, times, values, units, reference ranges and frequencies exactly ' +
    'as written. Say what the document states; never diagnose or advise changing a treatment, and send questions ' +
    'about the reader’s own health to a doctor or pharmacist.',
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
