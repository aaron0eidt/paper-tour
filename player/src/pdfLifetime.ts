import { useLayoutEffect } from 'react';

/** A PDF belongs to the committed reader, rather than an individual manifest request. */
export interface PdfResource {
  loadingTask: { destroyed: boolean };
  destroy(): Promise<void>;
}

const pending: WeakMap<PdfResource, ReturnType<typeof setTimeout>> = import.meta.hot?.data.pdfRetirements ??
new WeakMap();
const owners: WeakMap<PdfResource, number> = import.meta.hot?.data.pdfOwners ?? new WeakMap();
if (import.meta.hot)
  import.meta.hot.dispose((data) => {
    data.pdfRetirements = pending;
    data.pdfOwners = owners;
  });

export function isPdfOpen(pdf: PdfResource | null | undefined): pdf is PdfResource {
  return !!pdf && !pdf.loadingTask.destroyed;
}

/** React StrictMode/Fast Refresh may release and immediately reacquire the same document. */
export function keepPdf(pdf: PdfResource): void {
  owners.set(pdf, (owners.get(pdf) ?? 0) + 1);
  const timer = pending.get(pdf);
  if (timer !== undefined) {
    clearTimeout(timer);
    pending.delete(pdf);
  }
}

/** Run after commit/effect cleanup, once the old page render effects have been cancelled. */
export function retirePdf(pdf: PdfResource | null | undefined): void {
  if (!pdf || pending.has(pdf) || (owners.get(pdf) ?? 0) > 0) return;
  pending.set(
    pdf,
    setTimeout(() => {
      pending.delete(pdf);
      if (isPdfOpen(pdf)) void pdf.destroy().catch(() => {});
    }, 0),
  );
}

/** pdf.js may throw synchronously if its worker was destroyed; callers always get a promise. */
export async function getLivePage<T>(
  pdf: PdfResource & { getPage(n: number): Promise<T> },
  n: number,
): Promise<T | null> {
  if (!isPdfOpen(pdf)) return null;
  return pdf.getPage(n);
}

export function releasePdf(pdf: PdfResource): void {
  owners.set(pdf, Math.max(0, (owners.get(pdf) ?? 0) - 1));
  retirePdf(pdf);
}

export function usePdfDocument(pdf: PdfResource | null | undefined): void {
  useLayoutEffect(() => {
    if (!pdf) return;
    keepPdf(pdf);
    return () => releasePdf(pdf);
  }, [pdf]);
}
