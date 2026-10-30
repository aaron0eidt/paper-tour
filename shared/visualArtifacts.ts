import type { BoardItem, Tour } from './paper';
export interface VisualArtifactRef {
  id: string;
  revision: number;
}
export interface VisualArtifact extends VisualArtifactRef {
  documentId: string;
  conversationId?: string;
  tourId?: string;
  parent?: VisualArtifactRef;
  item: BoardItem;
  createdAt: string;
}
export interface VisualArtifactInput {
  item: BoardItem;
  conversationId?: string;
  tourId?: string;
  parent?: VisualArtifactRef;
}
/** Pure immutable traversal; storing a conversation variant never rewrites the source tour. */
export async function mapTourVisuals(
  tour: Tour,
  store: (item: BoardItem, stepId: string) => Promise<VisualArtifactRef>,
): Promise<Tour> {
  return {
    ...tour,
    chapters: await Promise.all(
      tour.chapters.map(async (chapter) => ({
        ...chapter,
        steps: await Promise.all(
          chapter.steps.map(async (step) => ({
            ...step,
            actions: await Promise.all(
              step.actions.map(async (action) =>
                action.type === 'board' ? { ...action, artifact: await store(action.item, step.id) } : action,
              ),
            ),
          })),
        ),
      })),
    ),
  };
}
