const assert = {
  equal(actual: unknown, expected: unknown) {
    if (actual !== expected) throw new Error(`Expected ${String(expected)}, got ${String(actual)}`);
  },
  deepEqual(actual: unknown, expected: unknown) {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Page result differs');
  },
  doesNotThrow(run: () => void) {
    run();
  },
  async rejects(promise: Promise<unknown>, pattern: RegExp) {
    try {
      await promise;
    } catch (error) {
      if (error instanceof Error && pattern.test(error.message)) return;
      throw error;
    }
    throw new Error('Expected a rejected page request');
  },
};
import { getLivePage, isPdfOpen, keepPdf, releasePdf, retirePdf } from '../src/pdfLifetime';

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
function document() {
  let closes = 0;
  const pdf = {
    loadingTask: { destroyed: false },
    async destroy() {
      closes++;
      pdf.loadingTask.destroyed = true;
    },
    getPage(n: number) {
      if (pdf.loadingTask.destroyed) throw new TypeError("Cannot read properties of null (reading 'sendWithPromise')");
      return Promise.resolve({ n });
    },
  };
  return { pdf, closes: () => closes };
}

// StrictMode / Fast Refresh cleanup followed by setup must preserve the mounted PDF.
{
  const { pdf, closes } = document();
  keepPdf(pdf);
  releasePdf(pdf);
  keepPdf(pdf);
  await tick();
  assert.equal(closes(), 0);
  assert.deepEqual(await getLivePage(pdf, 8), { n: 8 });
  releasePdf(pdf);
  await tick();
  assert.equal(closes(), 1);
}

// Replacing one document retires it after page-effect cleanup, without closing its replacement.
{
  const a = document(),
    b = document();
  keepPdf(a.pdf);
  retirePdf(a.pdf);
  keepPdf(b.pdf);
  // The still-mounted pages retain A until their commit cleanup.
  await tick();
  assert.equal(a.closes(), 0);
  releasePdf(a.pdf);
  assert.equal(isPdfOpen(a.pdf), true);
  await tick();
  assert.equal(a.closes(), 1);
  assert.equal(isPdfOpen(b.pdf), true);
  retirePdf(a.pdf);
  retirePdf(a.pdf);
  await tick();
  assert.equal(a.closes(), 1);
  releasePdf(b.pdf);
  await tick();
  assert.equal(b.closes(), 1);
}

// A stale worker cannot throw out of a render effect before its rejection handler is installed.
{
  const { pdf } = document();
  await pdf.destroy();
  assert.equal(await getLivePage(pdf, 1), null);
  const transportFailure = {
    ...document().pdf,
    getPage: () => {
      throw new TypeError("Cannot read properties of null (reading 'sendWithPromise')");
    },
  };
  let promise: Promise<unknown> | undefined;
  assert.doesNotThrow(() => {
    promise = getLivePage(transportFailure, 2);
  });
  await assert.rejects(promise!, /sendWithPromise/);
}
console.log('all PDF lifetime regression tests passed');
