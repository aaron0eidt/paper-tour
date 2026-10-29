import type { Doc } from '../../../../shared/paper';
import type { ResponseItem } from '../responses';
import type { DocumentService } from '../../service';
import { type TourDraft } from '../../muse/schema';
import { walkthroughGoals } from '../../muse/planning';
import { indexElements } from '../../elements';

export interface VisualSource {
  targetId: string;
  kind: 'page' | 'figure' | 'table';
  page: number;
  label: string;
  sha256: string;
  storagePath: string;
  contentType?: string;
}
export interface RunState {
  title?: string;
  plan: { id: string; title: string }[];
  chapters: Record<string, TourDraft['chapters'][number]>;
  observations: Record<string, unknown>;
  presented: Record<string, string>;
  delivered?: Record<string, string>;
  /** Provider history failed; subsequent turns replay the committed local transcript. */
  historyMode?: 'local';
  loopWatch?: Record<string, number>;
}
export interface ToolScope {
  owner: string;
  documentId: string;
  analysisId: string;
  doc: Doc;
  visuals: VisualSource[];
  language: string;
  availableSources?: string[];
  service: DocumentService;
}
export function draftFromState(state: RunState): TourDraft {
  return {
    title: state.title ?? 'Paper tour',
    chapters: state.plan.flatMap((chapter) => (state.chapters[chapter.id] ? [state.chapters[chapter.id]] : [])),
  };
}
export function requiredVisuals(doc: Doc, visuals: VisualSource[]) {
  const pages = new Set(walkthroughGoals(doc).requiredPages);
  return visuals.filter((source) => source.kind !== 'page' || pages.has(source.page));
}
export function paperManifest(doc: Doc) {
  return {
    sourceHash: doc.source.sha256,
    requiredVisualIds: [...walkthroughGoals(doc).requiredPages.map((n) => `page${n}`), ...doc.figures.map((f) => f.id)],
    pages: doc.pages.map((p) => `page${p.n}`),
    figures: doc.figures.map((f) => ({ id: f.id, page: f.page, caption: f.caption })),
    elements: indexElements(doc).length,
  };
}
export function toolOutput(callId: string, value: unknown, images: VisualSource[] = []): ResponseItem {
  return {
    type: 'function_call_output',
    call_id: callId,
    output: [
      { type: 'input_text', text: JSON.stringify(value) },
      ...images.map((source) => ({
        type: 'input_image',
        sourceId: source.targetId,
        storagePath: source.storagePath,
        sha256: source.sha256,
      })),
    ],
  };
}
