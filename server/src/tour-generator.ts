import type { ActivitySink } from './activity';
import type { Doc, Tour } from '../../shared/paper';
import type { TourGenerationStage } from '../../shared/contracts';

/**
 * Which pixels of an image differ from its paper colour (ingest/selection_image.py): a bit a pixel, row by row, the
 * high bit of each byte first. Rendered with a selection crop so a snapped outline can be weighed against what is on
 * the page under it.
 */
export interface InkMap {
  width: number;
  height: number;
  bits: Uint8Array;
}
export interface TourImage {
  targetId: string;
  kind: 'page' | 'figure' | 'table';
  page: number;
  label: string;
  dataUrl: string;
  /** Set on the crop of a selection; the model never sees it. */
  ink?: InkMap;
}
export interface TourGenerationInput {
  documentId: string;
  analysisId: string;
  doc: Doc;
  images: TourImage[];
  /**
   * Journal events. 'tour.partial' with { tour, ready, planned } is special: the worker keeps the latest as the
   * reader's partial tour instead of journalling it (tour-partial.ts).
   */
  onEvent?: ActivitySink;
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
