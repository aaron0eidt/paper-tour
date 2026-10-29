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

/** The type when no model said otherwise: tasks found by ingestion make a sheet, a paper's layout a paper. */
export function guessType(doc: Doc): DocType {
  if (doc.exercises?.length) return 'exercise_sheet';
  return paperLike(doc) ? 'research_paper' : 'other';
}
