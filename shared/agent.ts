export type AgentRunStatus = 'queued' | 'running' | 'pausing' | 'paused' | 'completed' | 'failed' | 'cancelled';
export interface PaperSession {
  id: string;
  documentId: string;
  analysisId: string;
  model: string;
  contextVersion: string;
}
export interface AgentRun {
  id: string;
  sessionId: string | null;
  generationId: string;
  status: AgentRunStatus;
  turns: number;
  outputTokens: number;
  runtimeMs: number;
  reason: string | null;
}
