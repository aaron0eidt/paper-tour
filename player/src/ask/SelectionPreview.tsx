import { useEffect, useRef } from 'react';
import { getLivePage, isPdfOpen } from '../pdfLifetime';
import { renderPage } from '../pdf';
import type { PDFDocumentProxy } from '../pdf';
import type { RegionSelection } from './regionSelection';

/** Local canvas preview only. The API receives page coordinates and renders its own trusted crop. */
export function SelectionPreview({ pdf, selection }: { pdf: PDFDocumentProxy | null; selection: RegionSelection }) {
  const host = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let cancelled = false;
    let job: ReturnType<typeof renderPage> | null = null;
    const container = host.current;
    container?.replaceChildren();
    if (!pdf) return;
    void getLivePage(pdf, selection.page).then(async (page) => {
      if (!page || cancelled || !isPdfOpen(pdf)) return;
      const { width, height } = page.getViewport({ scale: 1 });
      const [x0, y0, x1, y1] = selection.rect;
      const scale = Math.min(2, 144 / ((x1 - x0) * width), 80 / ((y1 - y0) * height));
      job = renderPage(page, scale, [x0 * width, y0 * height, x1 * width, y1 * height]);
      const canvas = await job.promise;
      if (!cancelled && isPdfOpen(pdf)) container?.replaceChildren(canvas);
    }).catch(() => {});
    return () => {
      cancelled = true;
      job?.cancel();
      container?.replaceChildren();
    };
  }, [pdf, selection]);
  return <span ref={host} className="ask-selection-preview" aria-hidden="true" />;
}
