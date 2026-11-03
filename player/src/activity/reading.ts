import type { ActivityRun } from '../../../shared/agentActivity';
import type { ReadingPreparation, PreparationSnapshot } from '../readingPreparation';
import { apiRequest } from '../library/client';
import { forgetLocalActivity, localActivity } from './client';

/** Bridge browser-owned lookahead and its persisted activity. It never controls speech playback. */
export class ReadingActivity {
  private run?: ActivityRun;
  private registered = false;
  private sealed = false;
  private reported = '';
  private writes = Promise.resolve();
  private stop?: () => void;
  constructor(
    private readonly documentId: string | undefined,
    private readonly loader: ReadingPreparation,
  ) {}

  activate() {
    this.stop = this.loader.subscribe(() => this.update(this.loader.getSnapshot()));
  }
  dispose() {
    this.stop?.();
    if (this.documentId && this.run) {
      const runId = this.run.id;
      if (this.registered && !['completed', 'failed'].includes(this.run.status))
        void this.report(this.loader.getSnapshot(), 'paused');
      forgetLocalActivity(this.documentId, runId);
    }
  }
  begin(): string | undefined {
    if (!this.documentId) return;
    if (!this.run || this.sealed || this.run.status === 'cancelled') {
      this.run = {
        id: crypto.randomUUID(),
        kind: 'reading',
        title: 'Prepare read aloud',
        status: 'running',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        operations: [],
        controllable: true,
      };
      this.registered = false;
      this.sealed = false;
      this.reported = '';
    }
    this.update(this.loader.getSnapshot());
    return this.run.id;
  }
  received() {
    this.registered = true;
    this.update(this.loader.getSnapshot());
  }
  private update(snapshot: PreparationSnapshot) {
    if (!this.documentId || !this.run) return;
    if (this.sealed && snapshot.completed < snapshot.total) return;
    const status =
      snapshot.total > 0 && snapshot.completed === snapshot.total
        ? 'completed'
        : snapshot.blocked || (!snapshot.active && snapshot.failed > 0 && !snapshot.paused)
          ? 'failed'
          : snapshot.paused || !snapshot.active
            ? 'paused'
            : 'running';
    this.run = {
      ...this.run,
      status,
      updatedAt: new Date().toISOString(),
      progress: { completed: snapshot.completed, total: snapshot.total, label: 'passages prepared' },
    };
    if (status === 'completed') this.sealed = true;
    localActivity(
      this.documentId,
      this.run,
      {
        pause: this.loader.pauseBackground,
        resume: this.loader.resumeBackground,
      },
      snapshot.foreground,
    );
    if (this.registered)
      void this.report(
        snapshot,
        status === 'completed' || status === 'paused' || status === 'failed' ? status : undefined,
      );
  }
  private report(snapshot: PreparationSnapshot, status?: 'completed' | 'paused' | 'failed') {
    if (!this.documentId || !this.run) return Promise.resolve();
    const body = JSON.stringify({
      completed: snapshot.completed,
      total: snapshot.total,
      ...(status ? { status } : {}),
    });
    if (body === this.reported) return this.writes;
    this.reported = body;
    const path = `/api/documents/${this.documentId}/activity/${this.run.id}/progress`;
    // Serialized reports cannot let an older completion count overwrite a newer one.
    this.writes = this.writes
      .catch(() => {})
      .then(() => apiRequest<void>(path, { method: 'POST', body }))
      .catch(() => {
        this.reported = '';
      });
    return this.writes;
  }
  async preview(targetId: string, state: 'running' | 'completed' | 'failed') {
    if (!this.documentId || !this.run || !this.registered) return;
    const snapshot = this.loader.getSnapshot();
    await apiRequest(`/api/documents/${this.documentId}/activity/${this.run.id}/progress`, {
      method: 'POST',
      body: JSON.stringify({
        completed: snapshot.completed,
        total: snapshot.total,
        preview: targetId,
        previewState: state,
      }),
    }).catch(() => {});
  }
}
