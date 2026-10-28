import { transcribe } from './muse/transcribe';
import { generationRecorder } from './activity';
import { agentSummary, scheduleAgent } from './agent/store';
import type { AgentRun } from '../../shared/agent';
import type { GenerationActivity } from '../../shared/activity';
import { randomUUID } from 'node:crypto';
import type { QueryResultRow } from 'pg';
import type {
  AnalysisSummary,
  DocumentManifest,
  DocumentSummary,
  FigureContext,
  IndexedElement,
  ReaderState,
  SearchHit,
  UploadReservation,
  TourGenerationSummary,
  TourModelSelection,
} from '../../shared/contracts';
import type { Doc, Tour } from '../../shared/paper';
import type { ModelCatalog } from '../../shared/models';
import type { MetaModelCatalog } from './muse/models';
import { isContributorModel } from './muse/models';
import { Database, type Db } from './db';
import { HttpError, missing, ProcessingError } from './errors';
import { BUCKET, type FileStorage } from './storage';
import { ensureTourGeneration, generationSummary } from './tour-worker';
import type { TourImage } from './tour-generator';
import type { MuseConfig } from './config';
import type { SettingsService } from './settings';
import {
  answerQuestion,
  askError,
  askModel,
  demoImage,
  DEMO_ROOT,
  figureImage,
  loadDemo,
  type AskAnswer,
  type AskRequest,
} from './harness/ask';
import { MuseClient } from './muse/client';

export type Enqueue = (
  kind: 'analyze' | 'delete' | 'generate_tour' | 'agent_turn',
  data: { documentId: string; analysisId?: string; generationId?: string; agentRunId?: string; wakeIndex?: number },
  db?: Db,
) => Promise<void>;
type Row = QueryResultRow;
const iso = (date: Date | string) => new Date(date).toISOString();
const ELEMENT_COLUMNS = 'element_id as id,kind,page,text,bbox,data';
export interface Library {
  transcribe?(owner: string, id: string, audio: Uint8Array, signal?: AbortSignal): Promise<{ transcript: string }>;
  demoTranscribe?(paper: string, audio: Uint8Array, signal?: AbortSignal): Promise<{ transcript: string }>;
  agentRun?(owner: string, id: string, runId: string): Promise<AgentRun>;
  controlAgent?(owner: string, id: string, runId: string, action: 'pause' | 'resume' | 'cancel'): Promise<AgentRun>;
  list(owner: string): Promise<DocumentSummary[]>;
  models(owner?: string): Promise<ModelCatalog>;
  activity?(owner: string, id: string, generationId: string, after: string): Promise<GenerationActivity>;
  resumeConfigured?(owner: string): Promise<void>;
  reserve(owner: string, filename: string, size: number, selection?: TourModelSelection): Promise<UploadReservation>;
  complete(owner: string, id: string): Promise<{ analysisId: string }>;
  generateTour(
    owner: string,
    id: string,
    regenerate?: boolean,
    selection?: TourModelSelection,
  ): Promise<{ generation: TourGenerationSummary }>;
  analyze(owner: string, id: string): Promise<{ analysisId: string }>;
  manifest(owner: string, id: string, tourId?: string): Promise<DocumentManifest>;
  rename(owner: string, id: string, title: string): Promise<DocumentSummary>;
  remove(owner: string, id: string): Promise<void>;
  saveState(owner: string, id: string, state: ReaderState): Promise<void>;
  search(owner: string, id: string, analysisId: string | undefined, q: string): Promise<SearchHit[]>;
  outline(
    owner: string,
    id: string,
    analysisId?: string,
  ): Promise<{
    analysisId: string;
    sections: IndexedElement[];
    figures: IndexedElement[];
  }>;
  elements(owner: string, id: string, analysisId: string | undefined, ids: string[]): Promise<IndexedElement[]>;
  figure(owner: string, id: string, analysisId: string | undefined, elementId: string): Promise<FigureContext>;
  ask?(owner: string, id: string, request: AskRequest, signal?: AbortSignal): Promise<AskAnswer>;
  /** Local development only: a question about demo/<paper>/ without an account (see app.ts). */
  demoAsk?(paper: string, request: AskRequest, signal?: AbortSignal): Promise<AskAnswer>;
}

export class DocumentService implements Library {
  constructor(
    readonly db: Database,
    readonly storage: FileStorage,
    readonly enqueue: Enqueue,
    readonly maxBytes = 26214400,
    readonly tourModel = process.env.MUSE_MODEL ?? 'muse-spark-1.3',
    readonly catalog?: Pick<MetaModelCatalog, 'get' | 'validateSelection'>,
    readonly settings?: SettingsService,
    readonly agentEnabled = false,
  ) {}
  async models(owner?: string): Promise<ModelCatalog> {
    if (this.settings && owner) return this.settings.models(owner);
    if (!this.catalog) throw new HttpError(503, 'model_catalog_unavailable', 'The model catalog is unavailable.');
    return this.catalog.get();
  }
  private async selectedModel(owner: string, model: string, allowTraining: boolean) {
    if (isContributorModel(model) && !allowTraining)
      throw new HttpError(
        400,
        'contributor_training_consent_required',
        'Contributor models require explicit consent to Meta using the paper content for training.',
      );
    if (this.settings) return this.settings.validateModel(owner, model, allowTraining);
    if (this.catalog) return this.catalog.validateSelection(model, allowTraining);
    // Isolated service tests can supply a fixed model without a live provider catalog.
    if (model !== this.tourModel)
      throw new HttpError(503, 'model_catalog_unavailable', 'The model catalog is unavailable.');
    return model;
  }
  async owned(owner: string, id: string, db: Db = this.db.pool, lock = false): Promise<Row> {
    const { rows } = await db.query(
      `select * from documents where id=$1 and owner_id=$2 and deleted_at is null ${lock ? 'for update' : ''}`,
      [id, owner],
    );
    return rows[0] ?? missing();
  }
  async activity(owner: string, id: string, generationId: string, after: string): Promise<GenerationActivity> {
    await this.owned(owner, id);
    const {
      rows: [generation],
    } = await this.db.query('select status from tour_generations where id=$1 and document_id=$2', [generationId, id]);
    if (!generation) return missing();
    const { rows } = await this.db.query(
      'select id::text,type,data,created_at from generation_events where generation_id=$1 and id>$2 order by id limit 100',
      [generationId, after],
    );
    return {
      status: generation.status,
      events: rows.map((r) => ({ id: r.id, type: r.type, data: r.data, at: iso(r.created_at) })),
    };
  }
  async agentRun(owner: string, id: string, runId: string) {
    await this.owned(owner, id);
    const {
      rows: [run],
    } = await this.db.query(
      'select r.* from agent_runs r join tour_generations g on g.id=r.generation_id where r.id=$1 and g.document_id=$2',
      [runId, id],
    );
    if (!run) return missing();
    return agentSummary(run);
  }
  async controlAgent(owner: string, id: string, runId: string, action: 'pause' | 'resume' | 'cancel') {
    await this.owned(owner, id);
    return this.db.transaction(async (tx) => {
      const {
        rows: [run],
      } = await tx.query(
        'select r.* from agent_runs r join tour_generations g on g.id=r.generation_id where r.id=$1 and g.document_id=$2 for update of r',
        [runId, id],
      );
      if (!run) return missing();
      if (['completed', 'cancelled'].includes(run.status)) return agentSummary(run);
      if (action === 'cancel') {
        await tx.query(
          "update agent_runs set status='cancelled',reason='Cancelled by user',updated_at=now() where id=$1",
          [runId],
        );
        await tx.query("update tour_generations set status='cancelled',updated_at=now() where id=$1", [
          run.generation_id,
        ]);
      } else if (action === 'pause') {
        const status = run.status === 'running' ? 'pausing' : 'paused';
        await tx.query('update agent_runs set status=$2,updated_at=now() where id=$1', [runId, status]);
        if (status === 'paused')
          await tx.query("update tour_generations set status='paused',updated_at=now() where id=$1", [
            run.generation_id,
          ]);
      } else if (['paused', 'failed', 'pausing'].includes(run.status)) {
        if (['credentials_changed', 'context_changed'].includes(run.reason)) {
          await generationRecorder(
            tx,
            run.generation_id,
            '',
            run.id,
          )('context.reset', { reason: run.reason, previousSessionId: run.session_id });
          await tx.query(
            "update agent_runs set session_id=null,head_response_id=null,state=jsonb_set(jsonb_set(jsonb_set(state,'{presented}','{}'),'{delivered}','{}'),'{observations}','{}') where id=$1",
            [runId],
          );
          await tx.query('delete from agent_steps where run_id=$1 and step=$2', [runId, run.turn_index]);
        }
        if (run.reason === 'Context initialization unexpectedly requested tools.')
          await tx.query('delete from agent_steps where run_id=$1 and step=$2', [runId, run.turn_index]);
        // An unknown dispatch is retried only after this explicit resume, never automatically.
        await tx.query(
          "update agent_steps set status='prepared' where run_id=$1 and status='dispatching' and response_id is null",
          [runId],
        );
        const {
          rows: [failed],
        } = await tx.query("select * from agent_steps where run_id=$1 and step=$2 and status='received'", [
          runId,
          run.turn_index,
        ]);
        if (failed?.response && failed.response.status !== 'completed') {
          await tx.query("update agent_steps set status='done' where run_id=$1 and step=$2", [runId, run.turn_index]);
          await tx.query('update agent_runs set turn_index=turn_index+1 where id=$1', [runId]);
        }
        await tx.query(
          "update agent_runs set status='queued',reason=null,budget_base=jsonb_build_object('turns',turns,'output',output_tokens,'runtime',runtime_ms),updated_at=now() where id=$1",
          [runId],
        );
        await tx.query(
          "update tour_generations set status='queued',error=null,error_code=null,updated_at=now() where id=$1",
          [run.generation_id],
        );
        await scheduleAgent(tx, this.enqueue, runId, id);
      }
      const {
        rows: [updated],
      } = await tx.query('select * from agent_runs where id=$1', [runId]);
      await generationRecorder(tx, run.generation_id, '', run.id)('run.control', { action, status: updated.status });
      return agentSummary(updated);
    });
  }
  private async summary(row: Row): Promise<DocumentSummary> {
    return {
      id: row.id,
      title: row.title,
      originalFilename: row.original_filename,
      pageCount: row.page_count,
      fileStatus: row.file_status,
      analysisStatus: row.analysis_status ?? null,
      analysisError: row.analysis_error ?? null,
      thumbnailUrl: row.thumbnail_path ? await this.storage.sign(row.thumbnail_path) : null,
      tourCount: Number(row.tour_count ?? 0),
      tourModel: row.tour_model,
      tourAllowTraining: row.tour_allow_training === true,
      tourGeneration: row.tour_generation ? generationSummary(row.tour_generation) : null,
      createdAt: iso(row.created_at),
      updatedAt: iso(row.updated_at),
      lastOpenedAt: row.last_opened_at ? iso(row.last_opened_at) : null,
    };
  }
  private selectSummary = `select d.*,a.status as analysis_status,a.error as analysis_error,
    (select storage_path from assets where document_id=d.id and analysis_id=d.current_analysis_id and kind='thumbnail' limit 1) as thumbnail_path,
    (select count(*) from tours t where t.document_id=d.id) as tour_count,
    (select to_jsonb(g) from tour_generations g where g.document_id=d.id and g.analysis_id=d.current_analysis_id order by g.created_at desc,g.id desc limit 1) as tour_generation
    from documents d left join lateral(select status,error from analyses where document_id=d.id order by created_at desc,id desc limit 1) a on true`;
  async list(owner: string) {
    const { rows } = await this.db.query(
      `${this.selectSummary} where d.owner_id=$1 and d.deleted_at is null order by coalesce(d.last_opened_at,d.created_at) desc`,
      [owner],
    );
    return Promise.all(rows.map((row) => this.summary(row)));
  }
  async reserve(owner: string, filename: string, size: number, selection: TourModelSelection = {}) {
    if (!filename.toLowerCase().endsWith('.pdf') || !Number.isSafeInteger(size) || size < 1 || size > this.maxBytes)
      throw new HttpError(400, 'invalid_upload', 'Choose a PDF up to 25 MiB.');
    const allowTraining = selection.allowTraining === true;
    const defaultModel = this.settings ? (await this.settings.get(owner)).defaultModel : this.tourModel;
    const model = await this.selectedModel(owner, selection.model ?? defaultModel, allowTraining);
    const id = randomUUID();
    const safeName = filename
      .split(/[\\/]/)
      .pop()!
      .replace(/[\u0000-\u001f]/g, '')
      .slice(0, 255);
    const title = safeName.replace(/\.pdf$/i, '').slice(0, 300) || 'Untitled document';
    const path = `${owner}/${id}/original.pdf`;
    await this.db.query(
      `insert into documents(id,owner_id,title,original_filename,upload_size,upload_path,tour_model,tour_allow_training) values($1,$2,$3,$4,$5,$6,$7,$8)`,
      [id, owner, title, safeName, size, path, model, allowTraining],
    );
    return { documentId: id, bucket: BUCKET, path };
  }
  async complete(owner: string, id: string) {
    const document = await this.owned(owner, id);
    const file = await this.storage.info(document.upload_path);
    if (!file)
      throw new HttpError(409, 'upload_missing', 'The PDF upload has not finished. Retry once it is complete.');
    if (file.size !== Number(document.upload_size) || file.size > this.maxBytes)
      throw new HttpError(400, 'invalid_upload', 'The uploaded file size does not match its reservation.');
    return this.db.transaction(async (tx) => {
      const d = await this.owned(owner, id, tx, true);
      if (d.file_status === 'invalid')
        throw new HttpError(422, 'invalid_pdf', 'This file could not be opened as a supported PDF.');
      const {
        rows: [latest],
      } = await tx.query(
        `select id,status from analyses where document_id=$1 order by created_at desc,id desc limit 1`,
        [id],
      );
      // Complete is idempotent even after a completed/failed job. Retry uses /analyze.
      if (latest) return { analysisId: latest.id as string };
      await tx.query(`update documents set file_status='uploaded',updated_at=now() where id=$1`, [id]);
      await tx.query(
        `insert into assets(document_id,kind,logical_path,storage_path,content_type) values($1,'pdf','paper.pdf',$2,'application/pdf') on conflict do nothing`,
        [id, d.upload_path],
      );
      return this.createAnalysis(tx, id);
    });
  }
  private async createAnalysis(tx: Db, documentId: string) {
    const {
      rows: [active],
    } = await tx.query(`select id from analyses where document_id=$1 and status in ('queued','processing')`, [
      documentId,
    ]);
    if (active) return { analysisId: active.id as string };
    const analysisId = randomUUID();
    await tx.query(`insert into analyses(id,document_id) values($1,$2)`, [analysisId, documentId]);
    await this.enqueue('analyze', { documentId, analysisId }, tx);
    return { analysisId };
  }
  async analyze(owner: string, id: string) {
    return this.db.transaction(async (tx) => {
      const d = await this.owned(owner, id, tx, true);
      if (d.file_status !== 'uploaded')
        throw new HttpError(409, 'pdf_not_ready', 'Complete a valid PDF upload before analyzing it.');
      return this.createAnalysis(tx, id);
    });
  }
  async generateTour(owner: string, id: string, regenerate = false, selection: TourModelSelection = {}) {
    const defaultModel = this.settings ? (await this.settings.get(owner)).defaultModel : undefined;
    return this.db.transaction(async (tx) => {
      const document = await this.owned(owner, id, tx, true);
      const model = (selection.model ?? defaultModel ?? document.tour_model ?? this.tourModel).trim();
      const allowTraining = selection.allowTraining === true;
      const {
        rows: [analysis],
      } = await tx.query("select id from analyses where document_id=$1 and id=$2 and status in ('ready','limited')", [
        id,
        document.current_analysis_id,
      ]);
      if (!analysis) throw new HttpError(409, 'analysis_not_ready', 'The document analysis is not ready yet.');
      const {
        rows: [latest],
      } = await tx.query(
        'select * from tour_generations where analysis_id=$1 order by created_at desc,id desc limit 1 for update',
        [analysis.id],
      );
      if (
        latest &&
        (['queued', 'generating', 'paused'].includes(latest.status) ||
          (latest.engine === 'agent' && latest.status === 'needs_configuration'))
      ) {
        if (latest.model !== model)
          throw new HttpError(
            409,
            'generation_in_progress',
            'A tour is already being created with another model. Wait for it to finish before changing models.',
          );
        // An active request is a read of the existing job, never a change to model or consent.
        return { generation: generationSummary(latest) };
      }
      if (latest?.status === 'ready' && latest.model === model && !regenerate)
        return { generation: generationSummary(latest) };
      const validated = await this.selectedModel(owner, model, allowTraining);
      if (latest?.status === 'ready' && latest.model !== validated && !regenerate)
        throw new HttpError(409, 'regeneration_required', 'Create a new tour to use a different model.');
      const generation = await ensureTourGeneration(
        tx,
        this.enqueue,
        id,
        analysis.id,
        validated,
        true,
        regenerate,
        this.agentEnabled ? 'agent' : 'legacy',
      );
      await tx.query('update documents set tour_model=$2,tour_allow_training=$3 where id=$1', [
        id,
        validated,
        allowTraining,
      ]);
      return { generation: generationSummary(generation) };
    });
  }
  async resumeConfigured(owner: string) {
    if (!this.settings || !(await this.settings.resolveMuse(owner)).config.apiKey) return;
    const { rows } = await this.db.query(
      `select g.document_id,g.analysis_id,g.model,g.agent_run_id from tour_generations g
      join documents d on d.id=g.document_id where d.owner_id=$1 and d.deleted_at is null and g.status='needs_configuration'`,
      [owner],
    );
    for (const row of rows) {
      if (row.agent_run_id) {
        await this.controlAgent(owner, row.document_id, row.agent_run_id, 'resume');
        continue;
      }
      await this.db.transaction(async (tx) => {
        await this.owned(owner, row.document_id, tx, true);
        await ensureTourGeneration(tx, this.enqueue, row.document_id, row.analysis_id, row.model, true);
      });
    }
  }
  async rename(owner: string, id: string, title: string) {
    title = title.trim();
    if (!title || title.length > 300)
      throw new HttpError(400, 'invalid_title', 'Use a title between 1 and 300 characters.');
    await this.owned(owner, id);
    await this.db.query(
      'update documents set title=$1,updated_at=now() where id=$2 and owner_id=$3 and deleted_at is null',
      [title, id, owner],
    );
    const {
      rows: [row],
    } = await this.db.query(`${this.selectSummary} where d.id=$1 and d.owner_id=$2 and d.deleted_at is null`, [
      id,
      owner,
    ]);
    if (!row) missing();
    return this.summary(row);
  }
  async remove(owner: string, id: string) {
    await this.db.transaction(async (tx) => {
      await this.owned(owner, id, tx, true);
      await tx.query('update documents set deleted_at=now(),updated_at=now() where id=$1', [id]);
      await this.enqueue('delete', { documentId: id }, tx);
    });
  }
  async manifest(owner: string, id: string, tourId?: string): Promise<DocumentManifest> {
    const d = await this.owned(owner, id);
    const {
      rows: [row],
    } = await this.db.query(`${this.selectSummary} where d.id=$1 and d.owner_id=$2 and d.deleted_at is null`, [
      id,
      owner,
    ]);
    if (!row) missing();
    const {
      rows: [latest],
    } = await this.db.query('select * from analyses where document_id=$1 order by created_at desc,id desc limit 1', [
      id,
    ]);
    const { rows: tours } = await this.db.query(
      'select t.id,t.title,t.analysis_id,t.script,g.model from tours t left join tour_generations g on g.id=t.generation_id where t.document_id=$1 order by t.created_at desc,t.id desc',
      [id],
    );
    const {
      rows: [saved],
    } = await this.db.query('select state from reader_states where owner_id=$1 and document_id=$2', [owner, id]);
    const selected = tourId ? tours.find((t) => t.id === tourId) : tours[0];
    if (tourId && !selected) missing();
    const aid = selected?.analysis_id ?? d.current_analysis_id;
    const {
      rows: [analysis],
    } = aid
      ? await this.db.query("select * from analyses where id=$1 and document_id=$2 and status in ('ready','limited')", [
          aid,
          id,
        ])
      : { rows: [] };
    const assets: Record<string, string> = {};
    if (analysis) {
      const { rows: files } = await this.db.query(
        "select logical_path,storage_path from assets where document_id=$1 and analysis_id=$2 and kind <> 'visual_context'",
        [id, analysis.id],
      );
      await Promise.all(
        files.map(async (a) => {
          assets[a.logical_path] = await this.storage.sign(a.storage_path);
        }),
      );
    }
    const summary: AnalysisSummary | null = latest
      ? {
          id: latest.id,
          status: latest.status,
          parserVersion: latest.parser_version,
          warnings: latest.warnings,
          error: latest.error,
        }
      : null;
    return {
      document: await this.summary(row),
      pdfUrl: d.file_status === 'uploaded' ? await this.storage.sign(d.upload_path) : null,
      analysis: summary,
      doc: (analysis?.doc as Doc) ?? null,
      docAnalysisId: analysis?.id ?? null,
      tours: tours.map((t) => ({
        id: t.id,
        title: t.title,
        analysisId: t.analysis_id,
        model: t.model ?? null,
      })),
      selectedTour:
        selected && analysis
          ? {
              id: selected.id,
              analysisId: analysis.id,
              doc: analysis.doc as Doc,
              tour: selected.script as Tour,
              model: selected.model ?? null,
            }
          : null,
      assets,
      readerState: saved?.state ?? null,
      tourGeneration: row.tour_generation ? generationSummary(row.tour_generation) : null,
    };
  }
  async saveState(owner: string, id: string, state: ReaderState) {
    const d = await this.owned(owner, id);
    if (state.page > (d.page_count ?? 100))
      throw new HttpError(400, 'invalid_position', 'The page is outside this PDF.');
    if (!state.tourId && state.stepId) throw new HttpError(400, 'invalid_position', 'A tour step needs its tour.');
    if (state.tourId) {
      const {
        rows: [tour],
      } = await this.db.query('select script from tours where id=$1 and document_id=$2', [state.tourId, id]);
      if (!tour) missing();
      if (state.stepId && !(tour.script as Tour).chapters.some((c) => c.steps.some((s) => s.id === state.stepId)))
        throw new HttpError(400, 'invalid_position', 'Unknown tour step.');
    }
    await this.db.transaction(async (tx) => {
      await this.owned(owner, id, tx, true);
      await tx.query(
        `insert into reader_states(owner_id,document_id,state) values($1,$2,$3) on conflict(owner_id,document_id) do update set state=excluded.state,updated_at=now()`,
        [owner, id, state],
      );
      await tx.query('update documents set last_opened_at=now() where id=$1', [id]);
    });
  }
  private async published(owner: string, id: string, analysisId?: string) {
    const d = await this.owned(owner, id);
    const aid = analysisId ?? d.current_analysis_id;
    if (!aid) throw new HttpError(409, 'analysis_not_ready', 'The document analysis is not ready yet.');
    const {
      rows: [a],
    } = await this.db.query(
      "select id,doc from analyses where id=$1 and document_id=$2 and status in ('ready','limited')",
      [aid, id],
    );
    return a ?? missing();
  }
  async search(owner: string, id: string, analysisId: string | undefined, q: string) {
    const a = await this.published(owner, id, analysisId);
    q = q.trim().slice(0, 300);
    if (q.length < 2) return [];
    const { rows } = await this.db.query(
      `select ${ELEMENT_COLUMNS} from elements where analysis_id=$1 and kind in ('sentence','section','figure','table','equation') and search_vector @@ plainto_tsquery('simple',$2)
      order by ts_rank(search_vector,plainto_tsquery('simple',$2)) desc,page,element_id limit 40`,
      [a.id, q],
    );
    return rows.map((e) => ({
      ref: { documentId: id, analysisId: a.id, elementId: e.id },
      kind: e.kind,
      page: e.page,
      text: e.text.slice(0, 1500),
    })) as SearchHit[];
  }
  async outline(owner: string, id: string, analysisId?: string) {
    const a = await this.published(owner, id, analysisId);
    const { rows } = await this.db.query(
      `select ${ELEMENT_COLUMNS} from elements where analysis_id=$1 and kind in ('section','figure','table') order by page,element_id`,
      [a.id],
    );
    return {
      analysisId: a.id as string,
      sections: rows.filter((e) => e.kind === 'section') as IndexedElement[],
      figures: rows.filter((e) => e.kind !== 'section') as IndexedElement[],
    };
  }
  async elements(owner: string, id: string, analysisId: string | undefined, ids: string[]) {
    const a = await this.published(owner, id, analysisId);
    if (!ids.length || ids.length > 30)
      throw new HttpError(400, 'invalid_elements', 'Request between 1 and 30 element IDs.');
    const { rows } = await this.db.query(
      `select ${ELEMENT_COLUMNS} from elements where analysis_id=$1 and element_id=any($2::text[])`,
      [a.id, ids],
    );
    return ids.flatMap((id) => {
      const r = rows.find((e) => e.id === id);
      return r ? [r as IndexedElement] : [];
    });
  }
  async figure(owner: string, id: string, analysisId: string | undefined, elementId: string): Promise<FigureContext> {
    const a = await this.published(owner, id, analysisId);
    const {
      rows: [f],
    } = await this.db.query(
      `select ${ELEMENT_COLUMNS} from elements where analysis_id=$1 and element_id=$2 and kind in ('figure','table')`,
      [a.id, elementId],
    );
    if (!f) missing();
    const ids = [f.data.caption_block, ...(f.data.referenced_by ?? [])].filter(
      (x): x is string => typeof x === 'string',
    );
    const { rows: related } = await this.db.query(
      `select ${ELEMENT_COLUMNS} from elements where analysis_id=$1 and element_id=any($2::text[])`,
      [a.id, ids],
    );
    const {
      rows: [asset],
    } = await this.db.query('select storage_path from assets where analysis_id=$1 and logical_path=$2', [
      a.id,
      f.data.image,
    ]);
    return {
      figure: f as IndexedElement,
      caption: (related.find((e) => e.id === f.data.caption_block) as IndexedElement) ?? null,
      references: (f.data.referenced_by ?? []).flatMap((rid: string) =>
        related.filter((e) => e.id === rid),
      ) as IndexedElement[],
      imageUrl: asset ? await this.storage.sign(asset.storage_path) : null,
    };
  }
  /** Questions in flight per owner, and for all demo papers together: each one is a paid model call. */
  private readonly asking = new Map<string, number>();
  /** Where demo papers are read from (demo/ in the repository); tests point it at a temporary folder. */
  demoRoot = DEMO_ROOT;
  /** A question about one of the owner's documents, answered as a short micro-tour (harness/ask.ts). */
  async ask(owner: string, id: string, request: AskRequest, signal?: AbortSignal): Promise<AskAnswer> {
    const settings = this.askSettings();
    const asked = askedRequest(request);
    const document = await this.owned(owner, id);
    let analysisId: string | null = document.current_analysis_id;
    let tour: Tour | undefined;
    if (request.tourId) {
      const {
        rows: [row],
      } = await this.db.query('select script,analysis_id from tours where id=$1 and document_id=$2', [
        request.tourId,
        id,
      ]);
      if (!row) missing();
      // The tour's own analysis, so the answer points at the IDs the tour on screen uses.
      tour = row.script as Tour;
      analysisId = row.analysis_id;
    }
    const {
      rows: [analysis],
    } = analysisId
      ? await this.db.query(
          "select id,doc from analyses where id=$1 and document_id=$2 and status in ('ready','limited')",
          [analysisId, id],
        )
      : { rows: [] };
    if (!analysis) throw new HttpError(409, 'analysis_not_ready', 'The document analysis is not ready yet.');
    const doc = analysis.doc as Doc;
    const model = askModel(document.tour_model, document.tour_allow_training === true, this.tourModel);
    return this.answer(owner, {
      documentId: id,
      doc,
      tour,
      request: asked,
      model,
      muse: async () => (await settings.resolveMuse(owner, model)).config,
      image: () => figureImage(this.db.pool, this.storage, analysis.id, doc, asked.figureId),
      signal,
    });
  }
  /**
   * A question about a demo paper (demo/<paper>/) without an account, on the server's own Meta key and model. Only
   * local development exposes it (app.ts).
   */
  async demoAsk(paper: string, request: AskRequest, signal?: AbortSignal): Promise<AskAnswer> {
    const settings = this.askSettings();
    const asked = askedRequest(request);
    const demo = (await loadDemo(paper, this.demoRoot)) ?? missing();
    const model = askModel(settings.base.model, false, this.tourModel);
    return this.answer('demo', {
      documentId: paper,
      doc: demo.doc,
      tour: demo.tour,
      request: asked,
      model,
      muse: async () => ({ ...settings.base, model }),
      image: () => demoImage(paper, demo.doc, asked.figureId, this.demoRoot),
      signal,
      demo: true,
    });
  }
  async transcribe(owner: string, id: string, audio: Uint8Array, signal?: AbortSignal) {
    await this.owned(owner, id);
    return this.voice(owner, audio, async () => (await this.askSettings().resolveMuse(owner)).config, signal);
  }
  async demoTranscribe(paper: string, audio: Uint8Array, signal?: AbortSignal) {
    if (!(await loadDemo(paper, this.demoRoot))) missing();
    return this.voice('demo', audio, async () => this.askSettings().base, signal);
  }
  private async voice(key: string, audio: Uint8Array, config: () => Promise<MuseConfig>, signal?: AbortSignal) {
    const limitKey = `voice:${key}`;
    if (this.asking.get(limitKey)) throw new HttpError(429, 'voice_busy', 'Wait for the current transcription.');
    this.asking.set(limitKey, 1);
    try {
      return await transcribe(await config(), audio, this.askSettings().transport, signal);
    } finally {
      this.asking.delete(limitKey);
    }
  }
  private askSettings(): SettingsService {
    if (!this.settings) throw new HttpError(503, 'ask_unavailable', 'Questions are not available on this server.');
    return this.settings;
  }
  /** Answer under a limit of two questions in flight per key, and log what it cost in calls and time. */
  private async answer(
    key: string,
    input: {
      documentId: string;
      doc: Doc;
      tour?: Tour;
      request: AskRequest;
      model: string;
      muse(): Promise<MuseConfig>;
      image(): Promise<TourImage | undefined>;
      signal?: AbortSignal;
      demo?: boolean;
    },
  ): Promise<AskAnswer> {
    const active = this.asking.get(key) ?? 0;
    if (active >= 2) throw new HttpError(429, 'too_many_questions', 'Wait for the current answer, then ask again.');
    this.asking.set(key, active + 1);
    const started = Date.now();
    try {
      const [config, image] = await Promise.all([input.muse(), input.image()]);
      if (!config.apiKey) throw askError(new ProcessingError('muse_not_configured', 'No Meta API key.'), input.demo);
      const { answer, completions } = await answerQuestion({
        client: new MuseClient(config, this.askSettings().transport),
        doc: input.doc,
        documentId: input.documentId,
        request: input.request,
        tour: input.tour,
        image,
        language: input.tour?.voices?.host?.lang ?? config.language,
        signal: input.signal,
      });
      console.log(
        JSON.stringify({
          event: 'question_answered',
          ...(input.demo ? { demo: input.documentId } : { documentId: input.documentId }),
          model: input.model,
          answerable: answer.answerable,
          steps: answer.steps.length,
          modelCalls: completions.length,
          durationMs: Date.now() - started,
        }),
      );
      return answer;
    } catch (error) {
      throw askError(error, input.demo);
    } finally {
      const left = (this.asking.get(key) ?? 1) - 1;
      if (left > 0) this.asking.set(key, left);
      else this.asking.delete(key);
    }
  }
}

/** The question and the conversation before it on one line each; an empty question is refused. */
function askedRequest(request: AskRequest): AskRequest {
  const line = (text: string) => text.replace(/\s+/g, ' ').trim();
  const question = line(request.question);
  if (!question) throw new HttpError(400, 'invalid_question', 'Type a question first.');
  const history = (request.history ?? [])
    .map((turn) => ({ question: line(turn.question), answer: line(turn.answer) }))
    .filter((turn) => turn.question && turn.answer)
    .slice(-4);
  return { ...request, question, history };
}
