import type {
  ActivityKind,
  ActivityOperation,
  ActivityRun,
  ActivityStatus,
  DocumentActivity,
  DocumentActivityFrame,
} from '../../shared/agentActivity';
import { orderedOperations } from '../../shared/agentActivity';
import { generationTimeline } from '../../shared/generationTimeline';
import { ActivityChannel, withActivity } from './ai/activity-context';
import type { Database } from './db';
import { HttpError, missing } from './errors';

const iso = (value: string | Date) => new Date(value).toISOString();
const statuses: Record<string, ActivityStatus> = {
  generating: 'running',
  ready: 'completed',
  needs_configuration: 'failed',
};
const final = (status: string) => ['completed', 'failed', 'cancelled'].includes(status);

interface RunInput {
  id?: string;
  kind: Exclude<ActivityKind, 'tour'>;
  title: string;
  analysisId: string;
  page?: number;
  targetId?: string;
}

/** Durable public activity alongside the existing tour journal. Activity reads never execute agent work. */
export class DocumentActivityStore {
  private readonly live = new Map<string, AbortController>();
  private readonly readingLive = new Map<string, Set<AbortController>>();
  constructor(private readonly db: Database) {}

  async owned(owner: string, documentId: string) {
    if (
      !(
        await this.db.query('select 1 from documents where id=$1 and owner_id=$2 and deleted_at is null', [
          documentId,
          owner,
        ])
      ).rowCount
    )
      missing();
  }

  async run<T>(
    owner: string,
    documentId: string,
    input: RunInput,
    signal: AbortSignal | undefined,
    work: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    // Requests without an activity ID remain compatible with older clients and tests.
    if (!input.id) return work(signal ?? new AbortController().signal);
    await this.owned(owner, documentId);
    const {
      rows: [row],
    } = await this.db.query(
      `insert into document_activity_runs(id,document_id,analysis_id,kind,title,page,target_id)
       select $1,$2,a.id,$4,$5,$6,$7 from analyses a where a.id=$3 and a.document_id=$2
       on conflict(id) do update set updated_at=now(),status=case when document_activity_runs.kind='reading' and document_activity_runs.status='failed' then 'running' else document_activity_runs.status end where document_activity_runs.document_id=$2
         and document_activity_runs.analysis_id=$3 and document_activity_runs.kind=$4
       returning *`,
      [input.id, documentId, input.analysisId, input.kind, input.title, input.page ?? null, input.targetId ?? null],
    );
    if (!row) throw new HttpError(409, 'activity_conflict', 'This activity belongs to another document or analysis.');
    if (final(row.status) && !(input.kind === 'reading' && row.status === 'failed'))
      throw new HttpError(409, 'activity_finished', 'Start a new activity to try again.');
    const controller = new AbortController();
    if (input.kind === 'answer') {
      if (this.live.has(input.id))
        throw new HttpError(409, 'activity_in_progress', 'This answer is already being prepared.');
      this.live.set(input.id, controller);
    } else {
      const readers = this.readingLive.get(input.id) ?? new Set<AbortController>();
      readers.add(controller);
      this.readingLive.set(input.id, readers);
    }
    const combined = AbortSignal.any([controller.signal, ...(signal ? [signal] : [])]);
    const channel = new ActivityChannel();
    let writes = Promise.resolve();
    const detach = channel.subscribe((operation) => {
      writes = writes.catch(() => {}).then(() => this.record(input.id!, operation));
      return writes;
    });
    try {
      const result = await withActivity(channel, () => work(combined));
      combined.throwIfAborted();
      await writes.catch(() => {});
      if (input.kind === 'answer') await this.status(input.id, 'completed');
      return result;
    } catch (error) {
      await writes.catch(() => {});
      if (input.kind === 'answer') await this.status(input.id, combined.aborted ? 'cancelled' : 'failed');
      else if ((this.readingLive.get(input.id)?.size ?? 0) <= 1)
        await this.status(input.id, combined.aborted ? 'paused' : 'failed');
      // Reading errors affect a passage, not every remaining passage in the browser's queue.
      throw error;
    } finally {
      detach();
      if (this.live.get(input.id) === controller) this.live.delete(input.id);
      const readers = this.readingLive.get(input.id);
      readers?.delete(controller);
      if (!readers?.size) this.readingLive.delete(input.id);
    }
  }

  private async record(runId: string, operation: ActivityOperation) {
    await this.db.transaction(async (tx) => {
      await tx.query(
        `update document_activity_runs set operations=jsonb_set(operations,array[$2],$3::jsonb),updated_at=now() where id=$1`,
        [runId, operation.id, JSON.stringify(operation)],
      );
      await tx.query(`insert into agent_events(activity_run_id,type,data) values($1,'activity.operation',$2)`, [
        runId,
        JSON.stringify(operation),
      ]);
    });
  }
  private async status(id: string, status: ActivityStatus) {
    await this.db.query('update document_activity_runs set status=$2,updated_at=now() where id=$1', [id, status]);
  }

  /** On API restart there is no surviving HTTP reader/answer computation. Saved results are untouched. */
  async interruptOrphans() {
    await this.db
      .query(`update document_activity_runs set status=case when kind='reading' then 'paused' else 'cancelled' end,
      updated_at=now() where status='running'`);
  }

  async control(owner: string, documentId: string, id: string, action: 'pause' | 'resume' | 'cancel') {
    await this.owned(owner, documentId);
    const {
      rows: [run],
    } = await this.db.query('select * from document_activity_runs where id=$1 and document_id=$2', [id, documentId]);
    if (!run) missing();
    if (final(run.status) && !(run.kind === 'reading' && run.status === 'failed')) return;
    if (run.kind === 'answer' && action !== 'cancel')
      throw new HttpError(400, 'unsupported_control', 'Answers can be stopped and retried.');
    if (run.kind === 'answer') this.live.get(id)?.abort(new DOMException('Answer stopped', 'AbortError'));
    await this.status(id, action === 'pause' ? 'paused' : action === 'resume' ? 'running' : 'cancelled');
  }

  /** Browser-owned preparation reports actual completed previews and queue counts, never a predicted percentage. */
  async readingProgress(
    owner: string,
    documentId: string,
    id: string,
    input: {
      completed: number;
      total: number;
      status?: 'completed' | 'paused' | 'failed';
      preview?: string;
      previewState?: 'running' | 'completed' | 'failed';
    },
  ) {
    await this.owned(owner, documentId);
    if (input.completed > input.total)
      throw new HttpError(400, 'invalid_progress', 'Prepared passages cannot exceed the queue.');
    if (input.status === 'completed' && input.completed !== input.total)
      throw new HttpError(400, 'invalid_progress', 'Unprepared passages cannot be marked complete.');
    const {
      rows: [run],
    } = await this.db.query(
      `update document_activity_runs set progress=$3,updated_at=now(),
      status=coalesce($4,status) where id=$1 and document_id=$2 and kind='reading' and status not in ('cancelled','completed') returning id`,
      [
        id,
        documentId,
        JSON.stringify({ completed: input.completed, total: input.total, label: 'passages prepared' }),
        input.status ?? null,
      ],
    );
    if (!run) missing();
    if (input.preview) {
      const {
        rows: [previous],
      } = await this.db.query('select operations->$2 as operation from document_activity_runs where id=$1', [
        id,
        `preview:${input.preview}`,
      ]);
      const now = new Date().toISOString();
      await this.record(id, {
        id: `preview:${input.preview}`,
        kind: 'preview',
        label: 'Prepare visual preview',
        state: input.previewState ?? 'completed',
        startedAt: previous?.operation?.startedAt ?? now,
        ...(input.previewState === 'running' ? {} : { endedAt: now }),
        refs: [input.preview],
      });
    }
  }

  async list(owner: string, documentId: string, before?: string, full = true): Promise<DocumentActivity> {
    await this.owned(owner, documentId);
    // Capture the watermark before loading snapshots. Anything committed later is replayed by the stream.
    const {
      rows: [watermark],
    } = await this.db.query('select coalesce(max(id),0)::text as cursor from agent_events');
    const { rows } = await this.db.query(
      `with runs as (
      select id,kind,status,title,page,target_id,progress,case when $3 then operations else '{}'::jsonb end as operations,started_at,updated_at,null::uuid as agent_run_id from document_activity_runs where document_id=$1
      union all select id,'tour',status,'Create guided tour',null,null,
        case when stage='images' and images_total>0 then jsonb_build_object('completed',images_done,'total',images_total,'label','sources reviewed') end,
        '{}'::jsonb,created_at,updated_at,agent_run_id from tour_generations where document_id=$1
    ) select * from runs where status in ('queued','running','generating','pausing') or $2::uuid is null or
      (started_at,id)<(select started_at,id from runs where id=$2)
      order by (status in ('queued','running','generating','pausing')) desc,started_at desc,id desc limit 21`,
      [documentId, before ?? null, full],
    );
    const selected = rows.slice(0, 20);
    const runs: ActivityRun[] = [];
    for (const row of selected) {
      let operations: ActivityOperation[] = orderedOperations(Object.values(row.operations));
      if (row.kind === 'tour' && full) operations = await this.tourOperations(row.id, watermark.cursor);
      runs.push({
        id: row.id,
        kind: row.kind,
        status: statuses[row.status] ?? row.status,
        title: row.title,
        startedAt: iso(row.started_at),
        updatedAt: iso(row.updated_at),
        operations,
        ...(row.progress ? { progress: row.progress } : {}),
        ...(row.page ? { page: row.page } : {}),
        ...(row.target_id ? { targetId: row.target_id } : {}),
        ...(row.agent_run_id ? { agentRunId: row.agent_run_id } : {}),
        controllable: row.kind === 'tour' ? !!row.agent_run_id : row.kind === 'reading' || this.live.has(row.id),
      });
    }
    return { runs, cursor: watermark.cursor, hasMore: rows.length > 20, before: selected.at(-1)?.id };
  }

  private async tourOperations(id: string, cursor: string): Promise<ActivityOperation[]> {
    const { rows } = await this.db.query(
      `select id::text,type,created_at,jsonb_build_object(
      'callId',data->'callId','name',data->'name',
      'durationMs',data->'durationMs','text',case when type='model.narration' then data->'text' end,
      'arguments',jsonb_build_object('ids',data->'arguments'->'ids','query',data->'arguments'->'query',
        'chapter',jsonb_build_object('title',data->'arguments'->'chapter'->'title')),
      'output',jsonb_build_object('say',data->'output'->'say','error',data->'output'->'error' is not null,
        'savedSteps',data->'output'->'savedSteps','published',data->'output'->'published')) as data
      from agent_events where generation_id=$1 and id<=$2 and type in
      ('model.started','model.narration','model.completed','model.failed','tool.started','tool.completed') order by id`,
      [id, cursor],
    );
    return generationTimeline(rows.map((r) => ({ id: r.id, type: r.type, at: iso(r.created_at), data: r.data }))).map(
      (entry) => ({
        id: entry.id,
        kind: entry.kind,
        label: entry.title,
        state: entry.state === 'done' ? 'completed' : entry.state,
        startedAt: entry.at,
        ...(entry.durationMs !== undefined
          ? { endedAt: new Date(Date.parse(entry.at) + entry.durationMs).toISOString() }
          : {}),
        ...(entry.text ? { draft: entry.text } : {}),
        ...(entry.detail ? { detail: entry.detail } : {}),
      }),
    );
  }

  async changes(owner: string, documentId: string, after: string): Promise<DocumentActivityFrame> {
    await this.owned(owner, documentId);
    const snapshot = await this.list(owner, documentId, undefined, false);
    const { rows } = await this.db.query(
      `select e.id::text,e.activity_run_id,e.generation_id,e.type,
      case when e.type='activity.operation' then e.data end as data from agent_events e
      left join document_activity_runs a on a.id=e.activity_run_id
      left join tour_generations g on g.id=e.generation_id
      where coalesce(a.document_id,g.document_id)=$1 and e.id>$2 and e.id<=$3 order by e.id limit 100`,
      [documentId, after, snapshot.cursor],
    );
    const changedTours = new Set(
      rows
        .filter(
          (row) =>
            row.generation_id &&
            [
              'model.started',
              'model.narration',
              'model.completed',
              'model.failed',
              'tool.started',
              'tool.completed',
            ].includes(row.type),
        )
        .map((row) => row.generation_id),
    );
    const cursor = rows.length === 100 ? rows.at(-1)!.id : snapshot.cursor;
    const runs: NonNullable<DocumentActivityFrame['runs']> = [];
    for (const { operations: _operations, ...run } of snapshot.runs)
      runs.push({
        ...run,
        ...(changedTours.has(run.id) ? { operations: await this.tourOperations(run.id, cursor) } : {}),
      });
    return {
      runs,
      operations: rows
        .filter((row) => row.type === 'activity.operation')
        .map((row) => ({ runId: row.activity_run_id, value: row.data })),
      cursor,
    };
  }
}
