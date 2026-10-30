import type { DocumentSummary } from '../../../shared/contracts';
import { isTourGenerationActive } from './tourGeneration';

export const LIBRARY_FILTERS = [
  { id: 'all', label: 'All papers' },
  { id: 'tours', label: 'With tours' },
  { id: 'preparing', label: 'Preparing' },
  { id: 'attention', label: 'Needs attention' },
] as const;
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number]['id'];
export interface LibraryView {
  query: string;
  sort: 'recent' | 'added' | 'title';
  filter: LibraryFilter;
}
export const DEFAULT_LIBRARY_VIEW: LibraryView = { query: '', sort: 'recent', filter: 'all' };

/** Read only known fields so older or malformed saved preferences cannot hide the library. */
export function parseLibraryView(saved: string | null): LibraryView {
  try {
    const value: unknown = JSON.parse(saved ?? 'null');
    if (!value || typeof value !== 'object') return { ...DEFAULT_LIBRARY_VIEW };
    const fields = value as Record<string, unknown>;
    return {
      query: typeof fields.query === 'string' ? fields.query.slice(0, 300) : '',
      sort: fields.sort === 'added' || fields.sort === 'title' ? fields.sort : 'recent',
      filter: LIBRARY_FILTERS.find(({ id }) => id === fields.filter)?.id ?? 'all',
    };
  } catch {
    return { ...DEFAULT_LIBRARY_VIEW };
  }
}

export function matchesLibraryFilter(paper: DocumentSummary, filter: LibraryFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'tours':
      return paper.tourCount > 0;
    case 'preparing':
      return (
        paper.fileStatus === 'uploading' || paper.analysisStatus === 'queued' ||
        paper.analysisStatus === 'processing' || isTourGenerationActive(paper.tourGeneration)
      );
    case 'attention':
      return (
        paper.fileStatus === 'invalid' || paper.analysisStatus === 'failed' ||
        paper.analysisStatus === 'limited' || paper.tourGeneration?.status === 'failed' ||
        paper.tourGeneration?.status === 'needs_configuration'
      );
  }
}

export function selectLibraryPapers(papers: DocumentSummary[], view: LibraryView): DocumentSummary[] {
  const query = view.query.trim().toLocaleLowerCase();
  return papers
    .filter((paper) => matchesLibraryFilter(paper, view.filter) &&
      `${paper.title} ${paper.originalFilename}`.toLocaleLowerCase().includes(query))
    .sort((a, b) =>
      view.sort === 'title'
        ? a.title.localeCompare(b.title)
        : view.sort === 'added'
          ? Date.parse(b.createdAt) - Date.parse(a.createdAt)
          : Date.parse(b.lastOpenedAt ?? b.createdAt) - Date.parse(a.lastOpenedAt ?? a.createdAt),
    );
}
