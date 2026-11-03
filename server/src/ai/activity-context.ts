import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { ActivityOperation, OperationKind } from '../../../shared/agentActivity';
import { VisualValidationError } from '../errors';

export type OperationObserver = (operation: ActivityOperation) => Promise<void>;
const context = new AsyncLocalStorage<ActivityChannel>();

/** One computation, many consumers. Late joiners receive the same public operation snapshots. */
export class ActivityChannel {
  private readonly operations = new Map<string, ActivityOperation>();
  private readonly observers = new Set<OperationObserver>();
  subscribe(observer?: OperationObserver): () => void {
    if (!observer) return () => {};
    this.observers.add(observer);
    for (const operation of this.operations.values()) void observer(operation).catch(() => {});
    return () => this.observers.delete(observer);
  }
  async publish(operation: ActivityOperation): Promise<void> {
    this.operations.set(operation.id, structuredClone(operation));
    // Observability cannot fail the underlying explanation or stop another cache consumer.
    await Promise.all([...this.observers].map((observer) => observer(operation).catch(() => {})));
  }
  start(label: string, kind: OperationKind = 'tool', refs?: string[]) {
    const operation: ActivityOperation = {
      id: randomUUID(),
      kind,
      label,
      state: 'running',
      startedAt: new Date().toISOString(),
      ...(refs?.length ? { refs } : {}),
    };
    let lastDraft = 0;
    let draftWrite: Promise<void> = Promise.resolve();
    const started = this.publish(operation);
    return {
      draft: async (text: string) => {
        operation.draft = text;
        if (Date.now() - lastDraft < 1000) return;
        lastDraft = Date.now();
        await started;
        draftWrite = this.publish({ ...operation });
        await draftWrite;
      },
      finish: async (state: ActivityOperation['state'] = 'completed', detail?: string, refs?: string[]) => {
        await started;
        await draftWrite;
        operation.state = state;
        operation.endedAt = new Date().toISOString();
        if (detail) operation.detail = detail;
        if (refs?.length) operation.refs = refs;
        await this.publish(operation);
      },
    };
  }
}
export const currentActivity = () => context.getStore();
export const currentActivityObserver = (): OperationObserver | undefined => {
  const channel = currentActivity();
  return channel ? (operation) => channel.publish(operation) : undefined;
};
export const withActivity = <T>(channel: ActivityChannel, work: () => Promise<T>): Promise<T> =>
  context.run(channel, work);

export async function activityTask<T>(
  label: string,
  kind: OperationKind,
  work: () => Promise<T>,
  refs?: string[] | ((result: T) => string[]),
): Promise<T> {
  const operation = currentActivity()?.start(label, kind, typeof refs === 'function' ? undefined : refs);
  try {
    const result = await work();
    await operation?.finish('completed', undefined, typeof refs === 'function' ? refs(result) : undefined);
    return result;
  } catch (error) {
    await operation?.finish(
      error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failed',
      error instanceof VisualValidationError ? error.publicMessage : undefined,
    );
    throw error;
  }
}
