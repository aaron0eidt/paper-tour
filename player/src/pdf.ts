import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
import type { PageSize } from './resolve';
import type { BBox } from './types';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export type { PDFDocumentProxy, PDFPageProxy };

/** Open a PDF and read every page's size in points (rotation applied). */
export async function openPdf(url: string): Promise<{ pdf: PDFDocumentProxy; sizes: PageSize[] }> {
  const pdf = await pdfjs.getDocument({ url }).promise;
  const sizes: PageSize[] = [];
  for (let n = 1; n <= pdf.numPages; n++) {
    const viewport = (await pdf.getPage(n)).getViewport({ scale: 1 });
    sizes.push({ width: viewport.width, height: viewport.height });
  }
  return { pdf, sizes };
}

export interface PageRender {
  canvas: HTMLCanvasElement;
  promise: Promise<HTMLCanvasElement>;
  cancel(): void;
}

/**
 * Render a page into a fresh canvas at `scale` device pixels per point. With `region` (page
 * points), only that part of the page is rendered, its top-left corner at the canvas origin.
 */
export function renderPage(page: PDFPageProxy, scale: number, region?: BBox): PageRender {
  const viewport = region
    ? page.getViewport({ scale, offsetX: -region[0] * scale, offsetY: -region[1] * scale })
    : page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(region ? (region[2] - region[0]) * scale : viewport.width);
  canvas.height = Math.floor(region ? (region[3] - region[1]) * scale : viewport.height);
  const task = page.render({ canvasContext: canvas.getContext('2d', { alpha: false })!, viewport });
  return {
    canvas,
    promise: task.promise.then(() => canvas),
    cancel: () => task.cancel(),
  };
}

export function isCancelled(err: unknown): boolean {
  return err instanceof pdfjs.RenderingCancelledException;
}
