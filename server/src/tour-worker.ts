import { BUILTIN_TOUR_PROFILES, profileSnapshot, sameTourProfile, validTourDepth } from '../../shared/tourProfiles';
import type { TourProfileSnapshot } from '../../shared/tourProfiles';
import { generationRecorder } from './activity';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import type { QueryResultRow } from 'pg';
import type { TourGenerationSummary } from '../../shared/contracts';
import type { Doc } from '../../shared/paper';
import { ROOT, type Config } from './config';
import { Database, type Db } from './db';
import { HttpError, ProcessingError } from './errors';
import type { Enqueue } from './service';
import type { FileStorage } from './storage';
import type { TourGenerator, TourImage, TourProgress } from './tour-generator';
import { clearPartial, partialSink } from './tour-partial';
import { VisualArtifactService } from './visuals/artifacts';
import { persistTourVisuals } from './visuals/persistence';
import { isContributorModel } from './muse/models';
const execute = promisify(execFile);

export function generationSummary(row: QueryResultRow): TourGenerationSummary {
  return {
    agentRunId: row.agent_run_id ?? null,
    profile: row.profile ?? null,
    id: row.id,
    analysisId: row.analysis_id,
    status: row.status,
    stage: row.stage,
    imagesDone: row.images_done,
    imagesTotal: row.images_total,
    error: row.error ?? null,
    model: row.model,
    tourId: row.result_tour_id ?? null,
  };
}

/** Caller locks the document; generation creation and its queue job share that transaction. */
export async function ensureTourGeneration(
  tx: Db,
  enqueue: Enqueue,
  documentId: string,
  analysisId: string,
  model: string,
  retry = false,
  regenerate = false,
  engine: 'legacy' | 'agent' = 'legacy',
  profile: TourProfileSnapshot = profileSnapshot(BUILTIN_TOUR_PROFILES[0], {
    depth: validTourDepth(process.env.TOUR_PRESET) ? process.env.TOUR_PRESET : 'standard',
  }),
): Promise<QueryResultRow> {
  const {
    rows: [existing],
  } = await tx.query(
    'select * from tour_generations where analysis_id=$1 order by created_at desc,id desc limit 1 for update',
    [analysisId],
  );
  if (existing && ['queued', 'generating', 'paused'].includes(existing.status)) return existing;
  if (existing?.engine === 'agent' && existing.status === 'needs_configuration') return existing;
  if (existing?.status === 'ready' && !regenerate) return existing;
  if (existing && ['failed', 'needs_configuration'].includes(existing.status) && !retry) return existing;
  let row: QueryResultRow;
  if (
    existing &&
    existing.status !== 'ready' &&
    existing.engine !== 'agent' &&
    sameTourProfile(existing.profile, profile)
  ) {
    const {
      rows: [updated],
    } = await tx.query(
      `update tour_generations set status='queued',stage='preparing',images_done=0,images_total=0,error=null,error_code=null,model=$2,profile=$3,metadata='{}',updated_at=now(),completed_at=null where id=$1 returning *`,
      [existing.id, model, profile],
    );
    row = updated;
  } else {
    const {
      rows: [created],
    } = await tx.query(
      'insert into tour_generations(id,document_id,analysis_id,model,profile) values($1,$2,$3,$4,$5) returning *',
      [randomUUID(), documentId, analysisId, model, profile],
    );
    row = created;
  }
  if (!existing || row.id !== existing.id) {
    await tx.query('update tour_generations set engine=$2 where id=$1', [row.id, engine]);
    row.engine = engine;
    if (engine === 'agent') {
      const {
        rows: [run],
      } = await tx.query('insert into agent_runs(generation_id) values($1) returning id', [row.id]);
      await tx.query('update tour_generations set agent_run_id=$2 where id=$1', [row.id, run.id]);
      row.agent_run_id = run.id;
    }
  }
  await enqueue('generate_tour', { documentId, analysisId, generationId: row.id }, tx);
  return row;
}

export interface TourImagePreparation {
  documentId: string;
  analysisId: string;
  uploadPath: string;
  doc: Doc;
  folder: string;
}
export type PrepareTourImages = (input: TourImagePreparation, signal: AbortSignal) => Promise<TourImage[]>;

function inside(folder: string, relative: string) {
  const path = resolve(folder, relative);
  if (!path.startsWith(resolve(folder) + sep))
    throw new ProcessingError('invalid_image_path', 'A paper image has an invalid path.');
  return path;
}
export function isMissingStorageObject(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const record = error as { status?: unknown; statusCode?: unknown };
  return String(record.status) === '404' || String(record.statusCode) === '404';
}
export function imagePreparationFailure(error: unknown): ProcessingError {
  const failure = error as { stderr?: string; code?: unknown };
  if (failure?.code === 'ENOENT')
    return new ProcessingError('parser_unavailable', 'The image preparation tool is unavailable.');
  let code: unknown;
  try {
    code = JSON.parse(failure?.stderr?.trim().split('\n').at(-1) ?? '').code;
  } catch {
    /* native or unstructured failure */
  }
  if (code === 'resource_limit')
    return new ProcessingError('context_limit', 'This paper exceeds the current tour generation limits.');
  if (code === 'source_mismatch')
    return new ProcessingError('source_mismatch', 'The original PDF does not match this analysis.');
  const permanent = [
    'invalid_document',
    'invalid_pdf',
    'invalid_asset_path',
    'invalid_asset',
    'render_failed',
    'invalid_arguments',
  ];
  return new ProcessingError(
    'image_preparation_failed',
    'The paper images could not be prepared.',
    !permanent.includes(String(code)),
  );
}
export function safeTourDiagnostics(error: unknown, secret?: string): string[] | undefined {
  if (!(error instanceof ProcessingError) || error.code !== 'invalid_tour') return undefined;
  const problems = (error as ProcessingError & { problems?: unknown }).problems;
  if (!Array.isArray(problems)) return undefined;
  return problems
    .filter((item): item is string => typeof item === 'string')
    .slice(0, 8)
    .map((item) => {
      let safe = item
        .replace(/data:[^\s]+/gi, '[image data redacted]')
        .replace(/Bearer\s+[^\s]+/gi, 'Bearer [redacted]');
      if (secret) safe = safe.split(secret).join('[redacted]');
      return safe.replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, 240);
    });
}
function safeFailure(error: unknown, signal: AbortSignal) {
  const known = error instanceof ProcessingError ? error : null;
  const code = known?.code ?? (signal.aborted ? 'generation_timeout' : 'tour_temporarily_unavailable');
  const configuration = [
    'muse_not_configured',
    'muse_auth_failed',
    'missing_api_key',
    'invalid_api_key',
    'configuration_error',
  ].includes(code);
  let message = configuration
    ? 'Open Profile & Settings to check your Meta API connection.'
    : code === 'context_limit'
      ? 'This paper exceeds the current tour generation limits.'
      : code === 'generation_timeout'
        ? 'Tour creation exceeded the five-minute time limit. Please retry.'
        : ['invalid_tour', 'muse_invalid_response', 'muse_output_truncated'].includes(code)
          ? 'The model returned an incomplete or invalid tour. Please retry.'
          : code === 'document_deleted'
            ? 'This document has been deleted.'
            : code === 'muse_request_rejected'
              ? 'The model could not process this paper. Check the server model configuration.'
              : 'Tour creation is temporarily unavailable. Please retry.';
  if (code === 'image_preparation_failed' || code === 'invalid_image_path')
    message = 'The paper images could not be prepared for the model.';
  return { code, message, configuration, transient: known?.transient ?? !signal.aborted };
}

/** Owns lifecycle and persistence; the injected generator owns model protocol and validated content. */
export class TourWorker {
  constructor(
    readonly db: Database,
    readonly storage: FileStorage,
    readonly config: Config,
    readonly generator: TourGenerator,
    readonly prepareImages?: PrepareTourImages,
    readonly resolveGenerator?: (
      owner: string,
      model: string,
    ) => Promise<{ generator: TourGenerator; secret: string; source: string; version: string }>,
  ) {}
  private async locked<T>(documentId: string, run: () => Promise<T>) {
    const connection = await this.db.pool.connect();
    try {
      await connection.query('select pg_advisory_lock(hashtextextended($1,0))', [documentId]);
      return await run();
    } finally {
      await connection.query('select pg_advisory_unlock(hashtextextended($1,0))', [documentId]);
      connection.release();
    }
  }
  async loadImages(input: TourImagePreparation, signal: AbortSignal): Promise<TourImage[]> {
    signal.throwIfAborted();
    const pdf = await this.storage.download(input.uploadPath);
    if (createHash('sha256').update(pdf).digest('hex') !== input.doc.source.sha256)
      throw new ProcessingError('source_mismatch', 'The original PDF does not match this analysis.');
    const pdfPath = resolve(input.folder, 'paper.pdf'),
      docPath = resolve(input.folder, 'doc.json');
    const assetsDir = resolve(input.folder, 'assets'),
      outputDir = resolve(input.folder, 'images');
    await mkdir(assetsDir, { recursive: true });
    await writeFile(pdfPath, pdf);
    await writeFile(docPath, JSON.stringify(input.doc));
    const { rows: assets } = await this.db.query(
      "select logical_path,storage_path from assets where document_id=$1 and analysis_id=$2 and kind='figure'",
      [input.documentId, input.analysisId],
    );
    for (const asset of assets) {
      signal.throwIfAborted();
      const path = inside(assetsDir, asset.logical_path);
      await mkdir(dirname(path), { recursive: true });
      try {
        await writeFile(path, await this.storage.download(asset.storage_path));
      } catch (error) {
        // Missing derived crops can be reconstructed from the immutable original PDF.
        if (!isMissingStorageObject(error)) throw error;
      }
    }
    signal.throwIfAborted();
    try {
      await execute(
        this.config.python,
        [
          resolve(ROOT, 'ingest/tour_assets.py'),
          pdfPath,
          '--doc',
          docPath,
          '--assets-dir',
          assetsDir,
          '--out',
          outputDir,
        ],
        { signal, maxBuffer: 2 * 1024 * 1024 },
      );
    } catch (error) {
      if (signal.aborted) throw error;
      throw imagePreparationFailure(error);
    }
    const manifest = JSON.parse(await readFile(resolve(outputDir, 'images.json'), 'utf8')) as {
      images: {
        target_id: string;
        kind: 'page' | 'figure' | 'table';
        page: number;
        label: string;
        path: string;
        mime_type: string;
      }[];
    };
    if (!Array.isArray(manifest.images) || !manifest.images.length || manifest.images.length > 200)
      throw new ProcessingError('image_preparation_failed', 'The image manifest is invalid.');
    const images: TourImage[] = [];
    for (const image of manifest.images) {
      signal.throwIfAborted();
      if (image.mime_type !== 'image/jpeg')
        throw new ProcessingError('image_preparation_failed', 'An image is not a supported JPEG.');
      const data = await readFile(inside(outputDir, image.path));
      images.push({
        targetId: image.target_id,
        kind: image.kind,
        page: image.page,
        label: image.label,
        dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`,
      });
    }
    return images;
  }
  async generate(
    documentId: string,
    analysisId: string,
    generationId: string,
    finalAttempt = false,
    jobSignal?: AbortSignal,
  ) {
    return this.locked(documentId, async () => {
      const {
        rows: [row],
      } = await this.db.query(
        `select g.*,a.doc,d.upload_path,d.tour_allow_training,d.owner_id from tour_generations g join analyses a on a.id=g.analysis_id join documents d on d.id=g.document_id
        where g.id=$1 and g.document_id=$2 and g.analysis_id=$3 and d.deleted_at is null and a.status in ('ready','limited')`,
        [generationId, documentId, analysisId],
      );
      if (!row || ['ready', 'failed'].includes(row.status)) return;
      if (isContributorModel(row.model) && row.tour_allow_training !== true) {
        await this.db.query(
          "update tour_generations set status='failed',error_code='contributor_training_consent_required',error=$2,updated_at=now(),completed_at=now() where id=$1",
          [
            generationId,
            'This Contributor model requires explicit consent to Meta using this paper content for training.',
          ],
        );
        return;
      }
      let generator: TourGenerator | undefined;
      let access: { secret: string; source: string; version: string } | undefined;
      try {
        if (this.resolveGenerator) {
          const resolved = await this.resolveGenerator(row.owner_id, row.model);
          generator = resolved.generator;
          access = resolved;
        } else generator = row.model === this.generator.model ? this.generator : this.generator.withModel?.(row.model);
      } catch {
        await this.db.query(
          "update tour_generations set status='needs_configuration',error_code='configuration_error',error=$2,updated_at=now() where id=$1",
          [generationId, 'Open Profile & Settings to check your Meta connection.'],
        );
        return;
      }
      if (!generator || generator.model !== row.model) {
        await this.db.query(
          "update tour_generations set status='failed',error_code='unsupported_model',error=$2,updated_at=now(),completed_at=now() where id=$1",
          [generationId, 'The selected model is not supported by this tour generator. Choose another model.'],
        );
        return;
      }
      if (!generator.configured) {
        await this.db.query(
          "update tour_generations set status='needs_configuration',error_code='muse_not_configured',error=$2,model=$3,updated_at=now() where id=$1 and status<>'ready'",
          [generationId, 'Open Profile & Settings to connect a Meta API key for this tour.', generator.model],
        );
        return;
      }
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(new Error('Tour generation timed out.')),
        this.config.muse?.timeoutMs ?? 300_000,
      );
      timeout.unref();
      const abort = () => controller.abort(jobSignal?.reason);
      jobSignal?.addEventListener('abort', abort, { once: true });
      if (jobSignal?.aborted) abort();
      const signal = controller.signal;
      let folder: string | undefined;
      const started = Date.now();
      const record = generationRecorder(this.db.pool, generationId, access?.secret ?? this.config.muse?.apiKey);
      try {
        await record('run.started', { model: generator.model, analysisId });
        await record('step.started', { stage: 'preparing' });
        await this.db.query(
          "update tour_generations set status='generating',stage='preparing',model=$2,error=null,error_code=null,updated_at=now() where id=$1",
          [generationId, generator.model],
        );
        // Each attempt writes its own partial tour; the last one's steps may differ.
        await clearPartial(this.db.pool, generationId);
        signal.throwIfAborted();
        folder = await mkdtemp(resolve(tmpdir(), 'paper-tour-generation-'));
        const input = { documentId, analysisId, uploadPath: row.upload_path as string, doc: row.doc as Doc, folder };
        const images = await (this.prepareImages?.(input, signal) ?? this.loadImages(input, signal));
        await record('sources.prepared', {
          sources: images.map(({ targetId, kind, page, label }) => ({ targetId, kind, page, label })),
        });
        let lastStage = 'preparing';
        const onProgress = async (progress: TourProgress) => {
          signal.throwIfAborted();
          if (lastStage !== progress.stage) {
            await record('step.started', { stage: progress.stage });
            lastStage = progress.stage;
          }
          await this.db.query(
            "update tour_generations set stage=$2,images_done=$3,images_total=$4,updated_at=now() where id=$1 and status='generating'",
            [generationId, progress.stage, progress.imagesDone, progress.imagesTotal],
          );
        };
        // Partial tours go to their own store (tour-partial.ts); the rest of the events to the journal.
        const onEvent = partialSink(this.db.pool, generationId, input.doc, record, (event) =>
          console.warn(JSON.stringify({ event, documentId, generationId })),
        );
        const generated = await generator.generate(
          {
            documentId,
            analysisId,
            doc: input.doc,
            images,
            profile: row.profile ?? undefined,
            onEvent,
          },
          onProgress,
          signal,
        );
        generated.metadata = { ...generated.metadata, profile: row.profile ?? null };
        if (access)
          generated.metadata = {
            ...generated.metadata,
            credentialSource: access.source,
            credentialVersion: access.version,
          };
        signal.throwIfAborted();
        if (generated.tour.doc_sha256 !== input.doc.source.sha256)
          throw new ProcessingError('invalid_tour', 'The generated tour does not match this document.');
        await onProgress({ stage: 'validating', imagesDone: images.length, imagesTotal: images.length });
        await this.db.transaction(async (tx) => {
          const {
            rows: [document],
          } = await tx.query('select deleted_at from documents where id=$1 for update', [documentId]);
          if (!document || document.deleted_at)
            throw new ProcessingError('document_deleted', 'This document has been deleted.');
          const {
            rows: [current],
          } = await tx.query('select status from tour_generations where id=$1 for update', [generationId]);
          if (!current || current.status === 'ready') return;
          if (current.status !== 'generating')
            throw new ProcessingError('generation_superseded', 'This generation is no longer active.');
          signal.throwIfAborted();
          const {
            rows: [tour],
          } = await tx.query(
            'insert into tours(document_id,analysis_id,title,script,generation_id) values($1,$2,$3,$4,$5) on conflict(generation_id) do update set generation_id=excluded.generation_id returning id',
            [documentId, analysisId, generated.tour.title, generated.tour, generationId],
          );
          let script;
          try {
            script = await persistTourVisuals(
              new VisualArtifactService(this.db),
              row.owner_id,
              documentId,
              analysisId,
              tour.id,
              generated.tour,
              tx,
            );
          } catch (error) {
            if (error instanceof HttpError && error.code === 'invalid_visual')
              throw new ProcessingError('invalid_tour', 'A generated visual did not pass its publication checks.');
            throw error;
          }
          await tx.query('update tours set script=$2 where id=$1', [tour.id, script]);
          await tx.query(
            "update tour_generations set status='ready',stage='validating',images_done=$2,images_total=$2,result_tour_id=$3,metadata=$4,error=null,error_code=null,updated_at=now(),completed_at=now() where id=$1",
            [generationId, images.length, tour.id, generated.metadata],
          );
          await generationRecorder(tx, generationId)('run.completed', {
            durationMs: Date.now() - started,
            tourId: tour.id,
          });
          await tx.query('update documents set updated_at=now() where id=$1', [documentId]);
        });
        // The finished tour is the tour of record; a partial is no longer served and is cleared when this succeeds.
        await clearPartial(this.db.pool, generationId);
        console.log(
          JSON.stringify({
            event: 'tour_ready',
            documentId,
            analysisId,
            generationId,
            model: generator.model,
            durationMs: Date.now() - started,
          }),
        );
      } catch (error) {
        const failure = safeFailure(error, signal);
        const terminal = failure.configuration || !failure.transient || finalAttempt;
        await record('run.failed', { code: failure.code, message: failure.message, retrying: !terminal });
        const status = failure.configuration ? 'needs_configuration' : terminal ? 'failed' : 'queued';
        await this.db.query(
          "update tour_generations set status=$2,error_code=$3,error=$4,updated_at=now(),completed_at=case when $2='failed' then now() else null end where id=$1 and status<>'ready'",
          [generationId, status, failure.code, failure.message],
        );
        console.error(
          JSON.stringify({
            event: 'tour_failed',
            documentId,
            analysisId,
            generationId,
            code: failure.code,
            terminal,
            diagnostics: safeTourDiagnostics(error, access?.secret ?? this.config.muse?.apiKey),
          }),
        );
        if (!terminal) throw new ProcessingError(failure.code, failure.message, true);
      } finally {
        clearTimeout(timeout);
        jobSignal?.removeEventListener('abort', abort);
        if (folder) await rm(folder, { recursive: true, force: true });
      }
    });
  }
  async reconcile(enqueue: Enqueue, documentId?: string) {
    const { rows: documents } = await this.db.query(
      `select d.id,d.tour_model,a.id as analysis_id from documents d join analyses a on a.id=d.current_analysis_id
       left join lateral(select status from tour_generations where analysis_id=a.id order by created_at desc,id desc limit 1) g on true
       where d.deleted_at is null and a.status in ('ready','limited')
       and (not exists(select 1 from tours t where t.analysis_id=a.id) or g.status='needs_configuration')
       and ($1::uuid is null or d.id=$1)`,
      [documentId ?? null],
    );
    for (const document of documents)
      await this.db.transaction(async (tx) => {
        const {
          rows: [live],
        } = await tx.query(
          'select current_analysis_id,tour_model from documents where id=$1 and deleted_at is null for update',
          [document.id],
        );
        if (!live || live.current_analysis_id !== document.analysis_id) return;
        const {
          rows: [generation],
        } = await tx.query(
          'select status,engine from tour_generations where analysis_id=$1 order by created_at desc,id desc limit 1',
          [document.analysis_id],
        );
        if (generation?.engine === 'agent' || generation?.status === 'failed') return;
        const {
          rows: [hasTour],
        } = await tx.query('select id from tours where analysis_id=$1 limit 1', [document.analysis_id]);
        if (hasTour && generation?.status !== 'needs_configuration') return;
        await ensureTourGeneration(
          tx,
          enqueue,
          document.id,
          document.analysis_id,
          live.tour_model,
          generation?.status === 'needs_configuration' && this.generator.configured,
          false,
          this.config.agent?.enabled ? 'agent' : 'legacy',
        );
      });
  }
}
