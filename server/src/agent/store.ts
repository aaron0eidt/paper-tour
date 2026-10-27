import type { AgentRun } from '../../../shared/agent';
import type { Db } from '../db';
import type { Enqueue } from '../service';
export async function scheduleAgent(db: Db, enqueue: Enqueue, runId: string, documentId: string) {
  const {
    rows: [run],
  } = await db.query(
    'update agent_runs set wake_index=wake_index+1,updated_at=now() where id=$1 returning wake_index',
    [runId],
  );
  await enqueue('agent_turn', { documentId, agentRunId: runId, wakeIndex: run.wake_index }, db);
}
export const agentSummary = (row: Record<string, any>): AgentRun => ({
  id: row.id,
  sessionId: row.session_id,
  generationId: row.generation_id,
  status: row.status,
  turns: row.turns,
  outputTokens: Number(row.output_tokens),
  runtimeMs: Number(row.runtime_ms),
  reason: row.reason ?? null,
});
