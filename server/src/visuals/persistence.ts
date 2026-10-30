import { isDeepStrictEqual } from 'node:util';
import type { BoardItem, Step, Tour } from '../../../shared/paper';
import type { VisualParameter } from '../../../shared/program';
import { mapTourVisuals, type VisualArtifact, type VisualArtifactRef } from '../../../shared/visualArtifacts';
import type { AskAnswer } from '../harness/ask-types';
import { Database, type Db } from '../db';
import { HttpError } from '../errors';
import { VisualArtifactService } from './artifacts';

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
const reference = ({ id, revision }: VisualArtifactRef): VisualArtifactRef => ({ id, revision });
/** A failed traversal must not leave sibling writes running after its transaction rolls back. */
function serialWriter() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(write: () => Promise<T>): Promise<T> => {
    const next = tail.then(write);
    tail = next;
    return next;
  };
}

/** Code, expressions, source data and parameter bounds always come from the saved server artifact. */
export function withVisualParameters(baseline: BoardItem, supplied: unknown): BoardItem {
  const item = structuredClone(baseline);
  const client = record(supplied);
  if (!client || client.kind !== baseline.kind) return item;
  function value(parameter: VisualParameter, requested: unknown): number {
    if (requested === undefined) return parameter.value;
    if (
      typeof requested !== 'number' ||
      !Number.isFinite(requested) ||
      requested < parameter.min ||
      requested > parameter.max
    )
      throw new HttpError(400, 'invalid_visual_parameter', `Choose ${parameter.label} within its saved range.`);
    return requested;
  }
  if (item.kind === 'program' && Array.isArray(client.parameters)) {
    const parameters = client.parameters.map(record);
    item.parameters = item.parameters.map((parameter) => ({
      ...parameter,
      value: value(parameter, parameters.find((candidate) => candidate?.name === parameter.name)?.value),
    }));
  } else if (item.kind === 'plotly' && item.parameter) {
    const parameter = record(client.parameter);
    if (parameter?.name === item.parameter.name)
      item.parameter = { ...item.parameter, value: value(item.parameter, parameter.value) };
  }
  return item;
}

/** The latest visible server-owned board, respecting explicit clears and the selected playback step. */
export function activeBoard(steps: readonly Step[], stepId?: string) {
  const at = stepId ? steps.findIndex((step) => step.id === stepId) : -1;
  let active: { item: BoardItem; artifact?: VisualArtifactRef } | undefined;
  for (const step of steps.slice(0, at >= 0 ? at + 1 : steps.length))
    for (const action of step.actions) {
      if (action.type === 'board') active = { item: action.item, artifact: action.artifact };
      else if (action.type === 'board_clear') active = undefined;
    }
  return active;
}

/** Attach refs inside the same transaction that publishes the tour. Identical boards share a ref within that tour. */
export function persistTourVisuals(
  artifacts: VisualArtifactService,
  owner: string,
  documentId: string,
  analysisId: string,
  tourId: string,
  tour: Tour,
  tx: Db,
) {
  const stored = new Map<string, Promise<VisualArtifactRef>>();
  const write = serialWriter();
  return mapTourVisuals(tour, (item) => {
    const key = JSON.stringify(item);
    let pending = stored.get(key);
    if (!pending) {
      pending = write(() => artifacts.create(owner, documentId, { analysisId, tourId, item }, tx)).then(reference);
      stored.set(key, pending);
    }
    return pending;
  });
}

/** The first answer board revises its selected thread visual or forks its source; other boards stay independent. */
export async function persistAnswerVisuals(
  db: Database,
  artifacts: VisualArtifactService,
  owner: string,
  documentId: string,
  analysisId: string,
  answer: AskAnswer,
  conversationId?: string,
  parent?: VisualArtifact,
): Promise<AskAnswer> {
  if (!answer.steps.some((step) => step.actions.some((action) => action.type === 'board'))) return answer;
  return db.transaction(async (tx) => {
    const stored = new Map<string, Promise<VisualArtifactRef>>();
    const write = serialWriter();
    let selected = parent;
    const save = (item: BoardItem) => {
      const key = JSON.stringify(item);
      const previous = stored.get(key);
      if (previous) return previous;
      const source = selected;
      selected = undefined;
      const pending = write(() =>
        source && conversationId && source.conversationId === conversationId
          ? isDeepStrictEqual(source.item, item)
            ? Promise.resolve(source)
            : artifacts.revise(owner, documentId, source, item, tx)
          : artifacts.create(
              owner,
              documentId,
              {
                analysisId,
                conversationId,
                item,
                ...(source ? { parent: { id: source.id, revision: source.revision } } : {}),
              },
              tx,
            ),
      );
      const ref = pending.then(reference);
      stored.set(key, ref);
      return ref;
    };
    return {
      ...answer,
      steps: await Promise.all(
        answer.steps.map(async (step) => ({
          ...step,
          actions: await Promise.all(
            step.actions.map(async (action) =>
              action.type === 'board' ? { ...action, artifact: await save(action.item) } : action,
            ),
          ),
        })),
      ),
    };
  });
}
