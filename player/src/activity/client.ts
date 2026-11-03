import type { ActivityRun } from '../../../shared/agentActivity';

export interface LocalActivityControls {
  pause?(): void;
  resume?(): void;
  cancel?(): void;
  retry?(): void;
}
interface LocalActivity {
  run: ActivityRun;
  controls: LocalActivityControls;
  foreground?: boolean;
}
const documents = new Map<string, Map<string, LocalActivity>>();
const listeners = new Map<string, Set<() => void>>();
const empty: LocalActivity[] = [];
const snapshots = new Map<string, LocalActivity[]>();

/** Browser-owned work registers controls; the server's persisted facts replace these initial local states. */
export function localActivity(
  documentId: string,
  run: ActivityRun,
  controls: LocalActivityControls = {},
  foreground = false,
) {
  let runs = documents.get(documentId);
  if (!runs) documents.set(documentId, (runs = new Map()));
  runs.set(run.id, { run, controls, foreground });
  snapshots.set(documentId, [...runs.values()]);
  listeners.get(documentId)?.forEach((notify) => notify());
}
export function localActivitySnapshot(documentId?: string): LocalActivity[] {
  return documentId ? (snapshots.get(documentId) ?? empty) : empty;
}
export function subscribeLocalActivity(documentId: string | undefined, notify: () => void): () => void {
  if (!documentId) return () => {};
  let subscriptions = listeners.get(documentId);
  if (!subscriptions) listeners.set(documentId, (subscriptions = new Set()));
  subscriptions.add(notify);
  return () => {
    subscriptions.delete(notify);
  };
}
export function forgetLocalActivity(documentId: string, id: string) {
  const runs = documents.get(documentId);
  if (!runs?.delete(id)) return;
  snapshots.set(documentId, [...runs.values()]);
  listeners.get(documentId)?.forEach((notify) => notify());
}
