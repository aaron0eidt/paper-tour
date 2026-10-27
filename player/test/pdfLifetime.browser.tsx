// Open /test/pdfLifetime.browser.html on the Vite dev server. Uses real pdf.js workers.
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ErrorBoundary } from '../src/components/ErrorBoundary';
import { PageView } from '../src/components/PageView';
import { openPdf, type PDFDocumentProxy } from '../src/pdf';
import { isPdfOpen, usePdfDocument } from '../src/pdfLifetime';

function Fixture({ pdf }: { pdf: PDFDocumentProxy }) {
  usePdfDocument(pdf);
  return (
    <PageView
      pdf={pdf}
      box={{ n: 1, x: 0, y: 0, width: 600, height: 800 }}
      scale={1}
      detail={null}
      spotlight={false}
      debug={null}
    />
  );
}
const delay = () => new Promise((resolve) => setTimeout(resolve, 60));
function check(value: unknown, message: string) {
  if (!value) throw new Error(message);
}
const host = document.querySelector('#fixture')!;
const root = createRoot(host);
const status = document.querySelector('#result')!;
const errors: unknown[] = [];
window.addEventListener('error', (event) => errors.push(event.error));
window.addEventListener('unhandledrejection', (event) => errors.push(event.reason));
const render = (pdf: PDFDocumentProxy) =>
  root.render(
    <StrictMode>
      <ErrorBoundary>
        <Fixture pdf={pdf} />
      </ErrorBoundary>
    </StrictMode>,
  );
async function pageReady() {
  for (let i = 0; i < 80; i++) {
    if (host.querySelector('canvas')) return;
    check(!host.querySelector('[role="alert"]'), 'Player crashed in an effect');
    await delay();
  }
  throw new Error('PDF canvas was not rendered');
}
try {
  const a = (await openPdf('/attention/paper.pdf')).pdf;
  render(a);
  await pageReady();
  await delay();
  check(isPdfOpen(a), 'StrictMode cleanup destroyed the mounted document');
  const b = (await openPdf('/attention/paper.pdf')).pdf;
  render(b);
  check(isPdfOpen(a), 'Old PDF was closed before its page effects could clean up');
  await delay();
  check(!isPdfOpen(a), 'Replaced document was leaked');
  check(isPdfOpen(b), 'Replacement document was closed');
  await pageReady();
  render(a); // A stale, destroyed proxy must not synchronously escape the render effect.
  await delay();
  check(!host.querySelector('[role="alert"]'), 'Destroyed worker crashed the player');
  const c = (await openPdf('/attention/paper.pdf')).pdf;
  render(c);
  await delay();
  await pageReady();
  root.unmount();
  await delay();
  check(!isPdfOpen(c), 'Unmounted document was leaked');
  check(errors.length === 0, 'Unhandled worker error: ' + String(errors[0]));
  status.textContent = 'PASS — StrictMode, PDF replacement, stale worker, and unmount with real pdf.js documents.';
} catch (error) {
  status.textContent = 'FAIL — ' + String(error);
  throw error;
}
