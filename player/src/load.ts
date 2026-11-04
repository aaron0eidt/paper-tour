import { isPdfOpen } from './pdfLifetime';
import { openPdf } from './pdf';
import type { PDFDocumentProxy } from './pdf';
import { checkDoc, checkTour } from './validate';
import type { PageSize, Problem } from './resolve';
import type { Doc, Tour } from './types';
import type { DocumentManifest } from '../../shared/contracts';

export interface Loaded {
  paper: string;
  /** URL of the paper folder, ending in "/". */
  baseUrl: string;
  doc: Doc | null;
  tour: Tour | null;
  pdf: PDFDocumentProxy | null;
  sizes: PageSize[];
  problems: Problem[];
}

/** Load the reader from the application contract, independently of storage layout. */
export async function loadManifest(manifest: DocumentManifest, previous?: Loaded): Promise<Loaded> {
  const problems: Problem[] = [];
  let doc = manifest.selectedTour?.doc ?? manifest.doc;
  let tour = manifest.selectedTour?.tour ?? null;
  if (doc) {
    const errors = checkDoc(doc);
    if (errors.length) {
      problems.push({ level: 'error', message: `The document analysis is invalid: ${errors.join('; ')}` });
      doc = null;
    }
  }
  if (tour) {
    const errors = checkTour(tour);
    if (errors.length || !doc || (tour.doc_sha256 && tour.doc_sha256 !== doc.source.sha256)) {
      problems.push({
        level: 'error',
        message: errors.length
          ? `The tour is invalid: ${errors.join('; ')}`
          : 'This tour does not match the document analysis.',
      });
      tour = null;
    } else {
      // Stored scripts retain portable asset keys. Signed URLs are resolved only for playback.
      tour = {
        ...tour,
        chapters: tour.chapters.map((chapter) => ({
          ...chapter,
          steps: chapter.steps.map((step) => ({
            ...step,
            audio:
              step.audio && manifest.assets[step.audio.src]
                ? { ...step.audio, src: manifest.assets[step.audio.src] }
                : undefined,
          })),
        })),
      };
    }
  }
  let pdf = previous?.paper === manifest.document.id && isPdfOpen(previous.pdf) ? previous.pdf : null;
  let sizes = pdf ? previous!.sizes : [];
  if (!pdf && manifest.pdfUrl) {
    try {
      ({ pdf, sizes } = await openPdf(manifest.pdfUrl));
    } catch (error) {
      problems.push({ level: 'error', message: `Could not open this PDF: ${(error as Error).message}` });
    }
  }
  if (
    doc &&
    sizes.length &&
    (doc.pages.length !== sizes.length ||
      doc.pages.some((p) => {
        const size = sizes[p.n - 1];
        return !size || Math.abs(size.width - p.width) > 1 || Math.abs(size.height - p.height) > 1;
      }))
  ) {
    problems.push({
      level: 'warning',
      message: 'Analysis page dimensions do not match this PDF. Highlights have been disabled.',
    });
    doc = null;
    tour = null;
  }
  return { paper: manifest.document.id, baseUrl: '/', doc, tour, pdf, sizes, problems };
}
