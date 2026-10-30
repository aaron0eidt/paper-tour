import type { DocumentSummary, TourGenerationSummary } from '../../shared/contracts';
import { DEFAULT_LIBRARY_VIEW, matchesLibraryFilter, parseLibraryView, selectLibraryPapers } from '../src/library/libraryView';

function test(name: string, run: () => void) { run(); console.log(`  ok    ${name}`); }
function equal(actual: unknown, expected: unknown) {
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}
const paper = (changes: Partial<DocumentSummary> = {}): DocumentSummary => ({
  id: '1', title: 'Alpha', originalFilename: 'research.pdf', pageCount: 4, fileStatus: 'uploaded',
  analysisStatus: 'ready', analysisError: null, thumbnailUrl: null, tourCount: 0,
  createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-01T00:00:00Z', lastOpenedAt: null,
  ...changes,
});
const generation = (status: TourGenerationSummary['status']): TourGenerationSummary => ({
  id: 'generation', analysisId: 'analysis', status, stage: 'writing', imagesDone: 0, imagesTotal: 0,
  error: null, model: 'test', tourId: null,
});

test('malformed and obsolete saved views cannot hide papers', () => {
  for (const saved of [null, 'not JSON', 'null', '42', '[]', '{"query":4,"sort":"unknown","filter":"archived"}'])
    equal(parseLibraryView(saved), DEFAULT_LIBRARY_VIEW);
  equal(parseLibraryView('{"query":"Attention","sort":"title","filter":"tours","other":"ignored"}'),
    { query: 'Attention', sort: 'title', filter: 'tours' });
  equal(parseLibraryView(JSON.stringify({ query: 'x'.repeat(1000), filter: 'preparing' })).query.length, 300);
});

test('attention does not treat a user pause or cancellation as failure', () => {
  for (const status of ['paused', 'cancelled', 'ready'] as const)
    equal(matchesLibraryFilter(paper({ tourGeneration: generation(status) }), 'attention'), false);
  for (const status of ['failed', 'needs_configuration'] as const)
    equal(matchesLibraryFilter(paper({ tourGeneration: generation(status) }), 'attention'), true);
  equal(matchesLibraryFilter(paper({ analysisStatus: 'limited' }), 'attention'), true);
  equal(matchesLibraryFilter(paper({ analysisStatus: 'failed' }), 'attention'), true);
  equal(matchesLibraryFilter(paper({ fileStatus: 'invalid' }), 'attention'), true);
});

test('saved tours remain findable while another version needs attention', () => {
  const saved = paper({ tourCount: 2, tourGeneration: generation('failed') });
  equal(matchesLibraryFilter(saved, 'tours'), true);
  equal(matchesLibraryFilter(saved, 'attention'), true);
  equal(matchesLibraryFilter(saved, 'preparing'), false);
  for (const status of ['queued', 'generating'] as const)
    equal(matchesLibraryFilter(paper({ tourGeneration: generation(status) }), 'preparing'), true);
  equal(matchesLibraryFilter(paper({ analysisStatus: 'processing' }), 'preparing'), true);
  equal(matchesLibraryFilter(paper({ fileStatus: 'uploading' }), 'preparing'), true);
});

test('search combines with filters and sorts without reordering the server data', () => {
  const papers = [paper({ id: 'old', title: 'Zulu', originalFilename: 'ATTENTION.pdf', tourCount: 1,
    lastOpenedAt: '2026-10-30T00:00:00Z' }),
  paper({ id: 'new', title: 'Attention', tourCount: 2, createdAt: '2026-10-20T00:00:00Z' }),
  paper({ id: 'none', title: 'Attention draft' })];
  const view = { query: '  attention ', filter: 'tours' as const, sort: 'recent' as const };
  equal(selectLibraryPapers(papers, view).map((item) => item.id), ['old', 'new']);
  equal(selectLibraryPapers(papers, { ...view, sort: 'added' }).map((item) => item.id), ['new', 'old']);
  equal(selectLibraryPapers(papers, { ...view, sort: 'title' }).map((item) => item.id), ['new', 'old']);
  equal(papers.map((item) => item.id), ['old', 'new', 'none']);
  equal(selectLibraryPapers(papers, { ...view, query: 'missing' }), []);
});
