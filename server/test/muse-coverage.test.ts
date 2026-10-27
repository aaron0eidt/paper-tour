import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc } from '../../shared/paper';
import type { DraftStep, TourDraft } from '../src/muse/schema';
import { materializeTour, TourValidationError } from '../src/muse/schema';
import { mergeCoverageSteps } from '../src/muse/coverage';

function document(pageCount = 5): Doc {
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: pageCount, generator: 'coverage-test' },
    pages: [], sections: [], blocks: [], sentences: [], figures: [], equations: [],
  };
  for (let page = 1; page <= pageCount; page++) {
    const sentenceId = `p${page}.s1`;
    doc.pages.push({ n: page, width: 600, height: 800 });
    doc.blocks.push({ id: `p${page}.b1`, page, type: 'paragraph', bbox: [20, 20, 400, 60], text: `This scientific result is explained on page ${page}.`, sentences: [sentenceId] });
    doc.sentences.push({ id: sentenceId, page, block: `p${page}.b1`, text: `This scientific result is explained on page ${page}.`, rects: [[20, 20, 400, 60]] });
  }
  return doc;
}

function step(page: number, suffix = 'main', sentence = 1): DraftStep {
  const source = `p${page}.s${sentence}`;
  return {
    id: `page-${page}-${suffix}`,
    source,
    say: `This step explains the specific scientific finding on page ${page}.`,
    evidence: [source],
    actions: [{ type: 'focus', target: source }, { type: 'highlight', targets: [source] }],
  };
}

function draft(pages: number[]): TourDraft {
  return { title: 'A chronological guided reading', chapters: [{ id: 'reading', title: 'Original chapter title', steps: pages.map((page) => step(page)) }] };
}

function sources(value: TourDraft): string[] {
  return value.chapters.flatMap((chapter) => chapter.steps.map((item) => item.source));
}

function freeze(value: unknown): void {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
}

test('coverage repair inserts missing page 3 between original pages 2 and 4', () => {
  const doc = document();
  const original = draft([1, 2, 4, 5]);
  const repaired = mergeCoverageSteps(original, [step(3, 'repair')], doc);
  assert.deepEqual(sources(repaired), [1, 2, 3, 4, 5].map((page) => `p${page}.s1`));
  assert.equal(repaired.chapters[0].id, 'reading');
  assert.equal(repaired.chapters[0].title, 'Original chapter title');
  assert.doesNotThrow(() => materializeTour(repaired, doc, 'test-document', 'en-US'));
});

test('coverage repair places pages 35–37 in order before page 38 without rewriting chapter structure', () => {
  const doc = document(39);
  const original: TourDraft = {
    title: 'A longer scientific walkthrough',
    chapters: [
      { id: 'first', title: 'Earlier material', steps: Array.from({ length: 20 }, (_, index) => step(index + 1)) },
      { id: 'second', title: 'Later material', steps: [...Array.from({ length: 14 }, (_, index) => step(index + 21)), step(38), step(39)] },
    ],
  };
  const repaired = mergeCoverageSteps(original, [step(37, 'repair'), step(35, 'repair'), step(36, 'repair')], doc);
  assert.deepEqual(sources(repaired), Array.from({ length: 39 }, (_, index) => `p${index + 1}.s1`));
  assert.deepEqual(repaired.chapters.map(({ id, title }) => ({ id, title })), original.chapters.map(({ id, title }) => ({ id, title })));
  assert.equal(repaired.chapters[0].steps.length, 20);
  assert.doesNotThrow(() => materializeTour(repaired, doc, 'test-document', 'en-US'));
});

test('repair at a chapter boundary joins the chapter containing the first later page', () => {
  const doc = document();
  const original: TourDraft = {
    title: 'A chronological guided reading',
    chapters: [
      { id: 'start', title: 'Start', steps: [step(1), step(2)] },
      { id: 'finish', title: 'Finish', steps: [step(4), step(5)] },
    ],
  };
  const repaired = mergeCoverageSteps(original, [step(3, 'repair')], doc);
  assert.deepEqual(repaired.chapters[0].steps.map((item) => item.id), ['page-1-main', 'page-2-main']);
  assert.deepEqual(repaired.chapters[1].steps.map((item) => item.id), ['page-3-repair', 'page-4-main', 'page-5-main']);
});

test('coverage repair rejects supplemental steps for pages that are already covered', () => {
  const doc = document();
  const original = draft([1, 2, 4, 5]);
  const supplement = [step(2, 'unrequested'), step(3, 'repair')];
  assert.throws(() => mergeCoverageSteps(original, supplement, doc), TourValidationError);
  const repaired = mergeCoverageSteps(original, [step(3, 'repair')], doc);
  assert.throws(() => mergeCoverageSteps(repaired, [step(3, 'repair')], doc), TourValidationError);
});

test('multiple explanations on a repaired page follow the document sentence order', () => {
  const doc = document();
  doc.blocks.find((block) => block.id === 'p3.b1')!.sentences.push('p3.s2');
  doc.sentences.push({ id: 'p3.s2', page: 3, block: 'p3.b1', text: 'A second important local finding follows the first.', rects: [[20, 70, 400, 90]] });
  const repaired = mergeCoverageSteps(draft([1, 2, 4, 5]), [step(3, 'later', 2), step(3, 'earlier', 1)], doc);
  assert.deepEqual(sources(repaired), ['p1.s1', 'p2.s1', 'p3.s1', 'p3.s2', 'p4.s1', 'p5.s1']);
  assert.doesNotThrow(() => materializeTour(repaired, doc, 'test-document', 'en-US'));
});

test('the original draft, chapters, steps and supplemental inputs are not mutated', () => {
  const doc = document();
  const original = draft([1, 2, 4, 5]);
  const supplement = [step(3, 'repair')];
  const before = structuredClone(original);
  const supplied = structuredClone(supplement);
  const chapterRef = original.chapters[0];
  const stepRef = chapterRef.steps[1];
  freeze(original);
  freeze(supplement);
  const repaired = mergeCoverageSteps(original, supplement, doc);
  assert.deepEqual(original, before);
  assert.deepEqual(supplement, supplied);
  assert.strictEqual(original.chapters[0], chapterRef);
  assert.strictEqual(original.chapters[0].steps[1], stepRef);
  assert.notStrictEqual(repaired, original);
});

test('global validation rejects a repaired step containing fabricated evidence or action IDs', () => {
  const doc = document();
  const invalid = step(3, 'repair');
  invalid.evidence.push('p3.s999');
  invalid.actions.push({ type: 'highlight', targets: ['p3.s999'] });
  const repaired = mergeCoverageSteps(draft([1, 2, 4, 5]), [invalid], doc);
  assert.throws(
    () => materializeTour(repaired, doc, 'test-document', 'en-US'),
    (error) => error instanceof TourValidationError && error.problems.some((problem) => problem.includes('unknown document element p3.s999')),
  );
});
