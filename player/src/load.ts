// Loads a paper folder: doc.json, tour.json and the PDF. Missing or invalid files become problems
// for the UI; the PDF still renders without a tour (and without doc.json) so authors can inspect it.

import { openPdf } from './pdf';
import type { PDFDocumentProxy } from './pdf';
import { checkDoc, checkTour } from './validate';
import type { PageSize, Problem } from './resolve';
import type { Doc, Tour } from './types';

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

type Fetched<T> = { ok: true; data: T } | { ok: false; missing: boolean; reason: string };

async function fetchJson<T>(url: string): Promise<Fetched<T>> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-cache' });
  } catch (err) {
    return { ok: false, missing: true, reason: String(err) };
  }
  // The dev server answers unknown paths with index.html, so HTML counts as missing too.
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || type.includes('text/html')) return { ok: false, missing: true, reason: `HTTP ${res.status}` };
  try {
    return { ok: true, data: JSON.parse(await res.text()) as T };
  } catch (err) {
    return { ok: false, missing: false, reason: `not valid JSON (${(err as Error).message})` };
  }
}

export async function loadPaper(paper: string): Promise<Loaded> {
  const baseUrl = `${import.meta.env.BASE_URL}${paper}/`;
  const problems: Problem[] = [];
  const [docRes, tourRes] = await Promise.all([fetchJson<Doc>(`${baseUrl}doc.json`), fetchJson<Tour>(`${baseUrl}tour.json`)]);

  let doc: Doc | null = null;
  if (!docRes.ok) {
    problems.push({
      level: 'error',
      message: docRes.missing
        ? `No doc.json at ${baseUrl}doc.json. Run ingest/ingest.py on the PDF first.`
        : `${baseUrl}doc.json is ${docRes.reason}.`,
    });
  } else {
    const errors = checkDoc(docRes.data);
    if (errors.length) problems.push({ level: 'error', message: `doc.json is invalid: ${errors.join('; ')}` });
    else doc = docRes.data;
  }

  let tour: Tour | null = null;
  if (!tourRes.ok) {
    problems.push(
      tourRes.missing
        ? { level: 'info', message: 'No tour.json for this paper yet. Showing the document only; press D to see element IDs.' }
        : { level: 'error', message: `${baseUrl}tour.json is ${tourRes.reason}.` },
    );
  } else {
    const errors = checkTour(tourRes.data);
    if (errors.length) problems.push({ level: 'error', message: `tour.json is invalid: ${errors.join('; ')}` });
    else tour = tourRes.data;
  }

  if (tour && tour.paper !== paper) {
    problems.push({ level: 'warning', message: `tour.json says paper "${tour.paper}" but was loaded from "${paper}".` });
  }
  if (tour?.doc_sha256 && doc && tour.doc_sha256 !== doc.source.sha256) {
    problems.push({ level: 'warning', message: 'tour.json was written against a different version of the PDF (doc_sha256 differs).' });
  }

  let pdf: PDFDocumentProxy | null = null;
  let sizes: PageSize[] = [];
  const pdfUrl = `${baseUrl}${doc?.source.file ?? 'paper.pdf'}`;
  try {
    ({ pdf, sizes } = await openPdf(pdfUrl));
  } catch (err) {
    problems.push({ level: 'error', message: `Could not open the PDF at ${pdfUrl}: ${(err as Error).message}` });
  }

  if (doc && pdf) {
    if (doc.pages.length !== sizes.length) {
      problems.push({ level: 'warning', message: `doc.json lists ${doc.pages.length} pages, the PDF has ${sizes.length}.` });
    }
    const off = doc.pages.filter((p) => {
      const s = sizes[p.n - 1];
      return s && (Math.abs(s.width - p.width) > 1 || Math.abs(s.height - p.height) > 1);
    });
    if (off.length) {
      problems.push({ level: 'warning', message: `Page sizes in doc.json differ from the PDF on page ${off.map((p) => p.n).join(', ')}.` });
    }
  }

  return { paper, baseUrl, doc, tour, pdf, sizes, problems };
}
