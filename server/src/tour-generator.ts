import type { ActivitySink } from './activity';
import type { Doc, Tour } from '../../shared/paper';
import type { TourGenerationStage } from '../../shared/contracts';

export interface TourImage {
  targetId: string;
  kind: 'page' | 'figure' | 'table';
  page: number;
  label: string;
  dataUrl: string;
}
export interface TourGenerationInput {
  documentId: string;
  analysisId: string;
  doc: Doc;
  images: TourImage[];
  /** Candidate only: generator must validate image hashes, observations and inspection version. */
  previousVisualInspection?: Record<string, unknown>;
  onEvent?: ActivitySink;
  previousVisualBatches?: { cacheKey: string; observations: unknown; generationId: string }[];
}
export interface TourProgress {
  stage: TourGenerationStage;
  imagesDone: number;
  imagesTotal: number;
}
export interface GeneratedTour {
  tour: Tour;
  metadata: Record<string, unknown>;
}
export interface TourGenerator {
  readonly model: string;
  readonly configured: boolean;
  /** Bind a persisted job model without changing the provider credentials or application state. */
  withModel?(model: string): TourGenerator;
  generate(
    input: TourGenerationInput,
    onProgress?: (progress: TourProgress) => Promise<void>,
    signal?: AbortSignal,
  ): Promise<GeneratedTour>;
}
