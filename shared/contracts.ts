import type { Doc, Tour, BBox } from './paper';

export type FileStatus = 'uploading' | 'uploaded' | 'invalid';
export type AnalysisStatus = 'queued' | 'processing' | 'ready' | 'limited' | 'failed';
export type TourGenerationStatus = 'queued' | 'generating' | 'ready' | 'failed' | 'needs_configuration';
export type TourGenerationStage = 'preparing' | 'images' | 'writing' | 'validating';
export interface TourGenerationSummary {
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
  id: string;
  title: string;
  analysisId: string;
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
  selectedTour: { id: string; analysisId: string; doc: Doc; tour: Tour } | null;
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
