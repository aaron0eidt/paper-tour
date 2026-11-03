/** Public workflow activity. Never a model's private reasoning or provider request. */
export type ActivityKind = 'tour' | 'answer' | 'reading';
export type ActivityStatus = 'queued' | 'running' | 'pausing' | 'paused' | 'completed' | 'failed' | 'cancelled';
export type OperationKind = 'source' | 'model' | 'tool' | 'cache' | 'validation' | 'preview';
export interface ActivityOperation {
  id: string;
  kind: OperationKind;
  label: string;
  state: 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt: string;
  endedAt?: string;
  /** Public speech only; unfinished text is explicitly a draft. */
  draft?: string;
  detail?: string;
  refs?: string[];
}
export interface ActivityRun {
  id: string;
  kind: ActivityKind;
  status: ActivityStatus;
  title: string;
  startedAt: string;
  updatedAt: string;
  operations: ActivityOperation[];
  progress?: { completed: number; total: number; label: string };
  page?: number;
  targetId?: string;
  agentRunId?: string;
  /** Reading preparation belongs to a browser queue; narration is independent. */
  controllable: boolean;
}
export interface DocumentActivity {
  runs: ActivityRun[];
  cursor: string;
  hasMore: boolean;
  before?: string;
}
export interface DocumentActivityFrame {
  runs?: (Omit<ActivityRun, 'operations'> & { operations?: ActivityOperation[] })[];
  operations?: { runId: string; value: ActivityOperation }[];
  cursor?: string;
  error?: string;
}
export const activeActivity = (status: ActivityStatus): boolean => ['queued', 'running', 'pausing'].includes(status);
/** JSONB key order is unrelated to execution order. Replayed operations use their actual start time. */
export const orderedOperations = (operations: Iterable<ActivityOperation>): ActivityOperation[] =>
  [...operations].sort((a, b) => a.startedAt.localeCompare(b.startedAt));

/** Explicit user selection wins. Otherwise foreground work precedes background preparation. */
export function preferredActivity(runs: ActivityRun[], foregroundReadingId?: string): ActivityRun | undefined {
  const rank = (run: ActivityRun) =>
    !activeActivity(run.status)
      ? 10
      : run.kind === 'answer'
        ? 0
        : run.kind === 'reading' && run.id === foregroundReadingId
          ? 1
          : run.kind === 'tour'
            ? 2
            : 3;
  return [...runs].sort((a, b) => rank(a) - rank(b) || b.startedAt.localeCompare(a.startedAt))[0];
}

/** Replayed snapshots replace by stable IDs, so reconnection never duplicates a tool or draft. */
export function mergeActivity(runs: ActivityRun[], frame: DocumentActivityFrame): ActivityRun[] {
  const next = new Map(runs.map((run) => [run.id, run]));
  for (const run of frame.runs ?? []) {
    const held = next.get(run.id);
    // A metadata refresh may omit operations; a full snapshot always includes them.
    next.set(run.id, { ...run, operations: orderedOperations(run.operations ?? held?.operations ?? []) });
  }
  for (const update of frame.operations ?? []) {
    const run = next.get(update.runId);
    if (run) {
      const operations = new Map(run.operations.map((op) => [op.id, op]));
      operations.set(update.value.id, update.value);
      next.set(run.id, { ...run, operations: orderedOperations(operations.values()) });
    }
  }
  return [...next.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}
