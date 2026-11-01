import type { TourProfileSnapshot, TourProfileSelection } from './tourProfiles';
import type { Doc, Tour, BBox } from './paper';

export type FileStatus = 'uploading' | 'uploaded' | 'invalid';
export type AnalysisStatus = 'queued' | 'processing' | 'ready' | 'limited' | 'failed';
export type TourGenerationStatus =
  | 'queued'
  | 'generating'
  | 'ready'
  | 'failed'
  | 'needs_configuration'
  | 'paused'
  | 'cancelled';
export type TourGenerationStage = 'preparing' | 'images' | 'writing' | 'validating';
export interface TourGenerationSummary {
  profile?: TourProfileSnapshot | null;
  agentRunId?: string | null;
  id: string;
  analysisId: string;
  status: TourGenerationStatus;
  stage: TourGenerationStage;
  imagesDone: number;
  imagesTotal: number;
  error: string | null;
  model: string;
  tourId: string | null;
}
/**
 * What GET /api/documents/:id/generations/:generationId/partial[?after=N&attempt=ID] returns (server/src/tour-partial.ts):
 * the leading steps of a tour still being written, so the reader can play them before the rest exists.
 *
 * - Poll while `status` is `queued` or `generating`; on `ready` the finished tour comes through the manifest (`tourId`).
 * - `tour`, `ready`, `planned` and `attempt` are set only while `generating` with a partial stored; otherwise `tour` and
 *   `attempt` are null and the counts are 0.
 * - `tour` is a playable tour of the first `ready` steps. Within one attempt steps only append and keep their ids.
 * - `attempt` names one run of the generator. After a retry it changes and the steps may differ.
 * - A client that holds a partial sends `after` (its ready) and `attempt`; while both still match, `tour` is null and
 *   only the counts come back.
 */
export interface TourPartialView {
  generationId: string;
  status: TourGenerationStatus;
  stage: TourGenerationStage;
  /** The finished tour once status is `ready`. */
  tourId: string | null;
  attempt: string | null;
  ready: number;
  planned: number;
  tour: Tour | null;
}
export interface TourModelSelection extends TourProfileSelection {
  model?: string;
  allowTraining?: boolean;
}
export interface ElementRef {
  documentId: string;
  analysisId: string;
  elementId: string;
}
export interface DocumentSummary {
  id: string;
  title: string;
  originalFilename: string;
  pageCount: number | null;
  fileStatus: FileStatus;
  analysisStatus: AnalysisStatus | null;
  analysisError: string | null;
  thumbnailUrl: string | null;
  tourCount: number;
  tourModel?: string;
  tourAllowTraining?: boolean;
  tourGeneration?: TourGenerationSummary | null;
  createdAt: string;
  updatedAt: string;
  lastOpenedAt: string | null;
}
export interface AnalysisSummary {
  id: string;
  status: AnalysisStatus;
  parserVersion: string;
  warnings: string[];
  error: string | null;
}
export interface TourSummary {
  profile?: TourProfileSnapshot | null;
  id: string;
  title: string;
  analysisId: string;
  model?: string | null;
}
export interface ReaderState {
  page: number;
  pageOffset: number;
  zoom: number | null;
  tourId: string | null;
  stepId: string | null;
}
export interface DocumentManifest {
  document: DocumentSummary;
  pdfUrl: string | null;
  analysis: AnalysisSummary | null;
  /** Analysis that actually supplies doc; can differ from a newly queued/failed analysis. */
  docAnalysisId: string | null;
  doc: Doc | null;
  tours: TourSummary[];
  selectedTour: {
    id: string;
    analysisId: string;
    doc: Doc;
    tour: Tour;
    model?: string | null;
    profile?: TourProfileSnapshot | null;
  } | null;
  tourGeneration?: TourGenerationSummary | null;
  assets: Record<string, string>;
  readerState: ReaderState | null;
}
export interface IndexedElement {
  id: string;
  kind: 'page' | 'section' | 'block' | 'sentence' | 'figure' | 'table' | 'panel' | 'equation';
  page: number;
  text: string;
  bbox: BBox | null;
  data: Record<string, unknown>;
}
export interface SearchHit {
  ref: ElementRef;
  kind: IndexedElement['kind'];
  page: number;
  text: string;
}
export interface FigureContext {
  figure: IndexedElement;
  caption: IndexedElement | null;
  references: IndexedElement[];
  imageUrl: string | null;
}
export interface UploadReservation {
  documentId: string;
  bucket: string;
  path: string;
}
export interface ApiError {
  error: { code: string; message: string };
}
export const DEFAULT_READER_STATE: ReaderState = { page: 1, pageOffset: 0, zoom: null, tourId: null, stepId: null };
