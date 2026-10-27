import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { tmpdir } from 'node:os';
import { resolve, sep } from 'node:path';
import type { Doc, Tour } from '../../shared/paper';
import type { Config } from './config';
import { ROOT } from './config';
import { Database, type Db } from './db';
import { ProcessingError } from './errors';
import type { FileStorage } from './storage';
import { indexElements } from './elements';
import { ensureTourGeneration } from './tour-worker';
import type { Enqueue } from './service';
const execute = promisify(execFile);
export interface ProcessResult {
  parser_version: string;
  sha256: string;
  page_count: number;
  title: string | null;
  warnings: string[];
  status: 'ready' | 'limited';
  assets: { kind: 'thumbnail' | 'figure'; path: string; element_id?: string }[];
}
export interface ExistingAnalysis {
  doc: string;
  tour: string;
}
export interface PreparedAnalysis {
  doc: Doc;
  result: ProcessResult;
  folder: string;
  tour: Tour | null;
  sha: string;
}

/** Execute with an argument array; document names never become shell commands. */
export async function prepareAnalysis(
  pdf: Buffer,
  folder: string,
  c: Pick<Config, 'python' | 'maxBytes' | 'maxPages' | 'analysisTimeoutMs'>,
  existing?: ExistingAnalysis,
): Promise<PreparedAnalysis> {
  if (pdf.length > c.maxBytes) throw new ProcessingError('file_too_large', 'The PDF exceeds the upload size limit.');
  const sha = createHash('sha256').update(pdf).digest('hex');
  const input = resolve(folder, 'input.pdf'),
    output = resolve(folder, 'output');
  await writeFile(input, pdf);
  const args = [resolve(ROOT, 'ingest/process.py'), input, '--out', output, '--max-pages', String(c.maxPages)];
  if (existing) args.push('--existing-doc', resolve(existing.doc), '--tour', resolve(existing.tour));
  try {
    await execute(c.python, args, {
      timeout: c.analysisTimeoutMs,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch (error) {
    const e = error as Error & {
      stderr?: string;
      killed?: boolean;
      code?: string | number;
    };
    if (e.killed) throw new ProcessingError('analysis_timeout', 'Analysis exceeded the five-minute time limit.');
    if (e.code === 'ENOENT')
      throw new ProcessingError('parser_unavailable', 'The PDF parser is not installed on the server.');
    let structured: { code?: string; message?: string } | undefined;
    try {
      structured = JSON.parse(e.stderr?.trim().split('\n').at(-1) ?? '');
    } catch {
      /* unexpected native parser failure */
    }
    throw new ProcessingError(
      structured?.code ?? 'analysis_failed',
      structured?.message ?? 'The PDF could not be analyzed.',
    );
  }
  const result = JSON.parse(await readFile(resolve(output, 'result.json'), 'utf8')) as ProcessResult;
  const doc = JSON.parse(await readFile(resolve(output, 'doc.json'), 'utf8')) as Doc;
  if (result.sha256 !== sha || doc.source.sha256 !== sha)
    throw new ProcessingError('hash_mismatch', 'Analysis does not match the original PDF.');
  if (
    !['ready', 'limited'].includes(result.status) ||
    !Number.isInteger(result.page_count) ||
    result.page_count < 1 ||
    result.page_count > c.maxPages
  )
    throw new ProcessingError('invalid_analysis', 'The parser returned invalid metadata.');
  indexElements(doc); // Ensure IDs are unique before any publication.
  const tour = existing ? (JSON.parse(await readFile(resolve(output, 'tour.json'), 'utf8')) as Tour) : null;
  if (tour && tour.doc_sha256 !== sha)
    throw new ProcessingError('hash_mismatch', 'The tour does not match the original PDF.');
  return { result, doc, tour, folder: output, sha };
}
function safeOutput(folder: string, path: string) {
  const file = resolve(folder, path);
  if (!file.startsWith(resolve(folder) + sep))
    throw new ProcessingError('invalid_asset', 'The parser returned an invalid file path.');
  return file;
}
export class AnalysisWorker {
  constructor(
    readonly db: Database,
    readonly storage: FileStorage,
    readonly config: Config,
    readonly enqueue?: Enqueue,
  ) {}
  private async locked<T>(documentId: string, run: () => Promise<T>): Promise<T> {
    const connection = await this.db.pool.connect();
    try {
      await connection.query('select pg_advisory_lock(hashtextextended($1,0))', [documentId]);
      return await run();
    } finally {
      await connection.query('select pg_advisory_unlock(hashtextextended($1,0))', [documentId]);
      connection.release();
    }
  }
  async analyze(documentId: string, analysisId: string, finalAttempt = false, existing?: ExistingAnalysis) {
    return this.locked(documentId, async () => {
      const {
        rows: [document],
      } = await this.db.query('select * from documents where id=$1 and deleted_at is null', [documentId]);
      const {
        rows: [analysis],
      } = await this.db.query('select * from analyses where id=$1 and document_id=$2', [analysisId, documentId]);
      if (!document || !analysis || ['ready', 'limited'].includes(analysis.status)) return;
      const folder = await mkdtemp(resolve(tmpdir(), 'paper-tour-'));
      const uploaded: string[] = [];
      const started = Date.now();
      try {
        await this.db.query("update analyses set status='processing',error=null,error_code=null where id=$1", [
          analysisId,
        ]);
        const pdf = await this.storage.download(document.upload_path);
        if (pdf.length !== Number(document.upload_size))
          throw new ProcessingError('size_mismatch', 'The uploaded PDF has an unexpected size.');
        const prepared = await prepareAnalysis(
          pdf,
          folder,
          {
            ...this.config,
            analysisTimeoutMs: Math.max(1, this.config.analysisTimeoutMs - (Date.now() - started)),
          },
          existing,
        );
        if (document.sha256 && document.sha256 !== prepared.sha)
          throw new ProcessingError('hash_mismatch', 'The original PDF changed after upload.');
        const files: {
          kind: string;
          logicalPath: string;
          storagePath: string;
          contentType: string;
        }[] = [];
        const attempt = randomUUID();
        for (const asset of prepared.result.assets) {
          if (Date.now() - started > this.config.analysisTimeoutMs)
            throw new ProcessingError('analysis_timeout', 'Analysis exceeded the five-minute time limit.');
          const path = `${document.owner_id}/${documentId}/${analysisId}/${attempt}/${asset.path}`;
          await this.storage.upload(path, await readFile(safeOutput(prepared.folder, asset.path)), 'image/png');
          uploaded.push(path);
          files.push({
            kind: asset.kind,
            logicalPath: asset.path,
            storagePath: path,
            contentType: 'image/png',
          });
        }
        if (Date.now() - started > this.config.analysisTimeoutMs)
          throw new ProcessingError('analysis_timeout', 'Analysis exceeded the five-minute time limit.');
        await this.db.transaction(async (tx) => {
          const {
            rows: [current],
          } = await tx.query('select * from documents where id=$1 for update', [documentId]);
          if (!current || current.deleted_at)
            throw new ProcessingError('document_deleted', 'The document was deleted.');
          const {
            rows: [active],
          } = await tx.query('select status from analyses where id=$1 for update', [analysisId]);
          if (!active || active.status !== 'processing')
            throw new ProcessingError('analysis_superseded', 'Analysis is no longer active.');
          await this.publish(tx, documentId, analysisId, prepared, files);
        });
        console.log(
          JSON.stringify({
            event: 'analysis_complete',
            documentId,
            analysisId,
            status: prepared.result.status,
            durationMs: Date.now() - started,
            parserVersion: prepared.result.parser_version,
          }),
        );
      } catch (error) {
        await this.storage.remove(uploaded).catch(() => {});
        const e =
          error instanceof ProcessingError
            ? error
            : new ProcessingError('temporary_failure', 'Document processing is temporarily unavailable.', true);
        const terminal = !e.transient || finalAttempt;
        await this.db.query(
          `update analyses set status=$2,error=$3,error_code=$4,completed_at=case when $2='failed' then now() else null end where id=$1 and status not in ('ready','limited')`,
          [analysisId, terminal ? 'failed' : 'queued', e.message, e.code],
        );
        if (
          [
            'invalid_pdf',
            'password_required',
            'encrypted_pdf',
            'empty_pdf',
            'too_many_pages',
            'file_too_large',
            'size_mismatch',
            'page_limit',
          ].includes(e.code)
        )
          await this.db.query(
            "update documents set file_status='invalid' where id=$1 and current_analysis_id is null",
            [documentId],
          );
        console.error(
          JSON.stringify({
            event: 'analysis_failed',
            documentId,
            analysisId,
            code: e.code,
            durationMs: Date.now() - started,
            terminal,
          }),
        );
        if (e.transient && !finalAttempt) throw e;
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    });
  }
  async publish(
    tx: Db,
    documentId: string,
    analysisId: string,
    p: PreparedAnalysis,
    files: {
      kind: string;
      logicalPath: string;
      storagePath: string;
      contentType: string;
    }[],
  ) {
    for (const f of files)
      await tx.query(
        `insert into assets(document_id,analysis_id,kind,logical_path,storage_path,content_type) values($1,$2,$3,$4,$5,$6)`,
        [documentId, analysisId, f.kind, f.logicalPath, f.storagePath, f.contentType],
      );
    const index = indexElements(p.doc).map((e) => ({
      element_id: e.id,
      kind: e.kind,
      page: e.page,
      text: e.text,
      bbox: e.bbox,
      data: e.data,
    }));
    await tx.query(
      `insert into elements(analysis_id,element_id,kind,page,text,bbox,data)
      select $1,x.element_id,x.kind,x.page,x.text,x.bbox,x.data from jsonb_to_recordset($2::jsonb) as x(element_id text,kind text,page integer,text text,bbox jsonb,data jsonb)`,
      [analysisId, JSON.stringify(index)],
    );
    await tx.query(
      `update analyses set status=$2,doc=$3,parser_version=$4,source_sha256=$5,warnings=$6,error=null,error_code=null,completed_at=now() where id=$1`,
      [analysisId, p.result.status, p.doc, p.result.parser_version, p.sha, p.result.warnings],
    );
    await tx.query(
      `update documents set current_analysis_id=$2,sha256=$3,page_count=$4,file_status='uploaded',updated_at=now() where id=$1`,
      [documentId, analysisId, p.sha, p.result.page_count],
    );
    if (p.tour)
      await tx.query('insert into tours(document_id,analysis_id,title,script) values($1,$2,$3,$4)', [
        documentId,
        analysisId,
        p.tour.title,
        p.tour,
      ]);
    else {
      if (!this.enqueue) throw new Error('Tour job enqueue is required for analysis publication.');
      await ensureTourGeneration(tx, this.enqueue, documentId, analysisId, this.config.muse.model);
    }
  }
  async remove(documentId: string) {
    await this.locked(documentId, async () => {
      const {
        rows: [d],
      } = await this.db.query('select * from documents where id=$1 and deleted_at is not null', [documentId]);
      if (!d) return;
      await this.storage.remove(await this.storage.list(`${d.owner_id}/${documentId}`));
      await this.db.query('delete from documents where id=$1 and deleted_at is not null', [documentId]);
    });
  }
  async cleanup() {
    // Reservation expiration avoids permanently orphaned, unconfirmed uploads.
    const { rows } = await this.db.query(
      `update documents set deleted_at=coalesce(deleted_at,now()) where deleted_at is not null or (file_status='uploading' and created_at<now()-interval '24 hours') returning id`,
    );
    for (const d of rows) await this.remove(d.id);
    // Failed attempts use fresh prefixes; remove all files not referenced by an asset row.
    const { rows: documents } = await this.db.query(
      'select id,owner_id,upload_path from documents where deleted_at is null',
    );
    for (const document of documents)
      await this.locked(document.id, async () => {
        const { rows: active } = await this.db.query(
          "select 1 from analyses where document_id=$1 and status in ('queued','processing')",
          [document.id],
        );
        if (active.length) return;
        const { rows: assets } = await this.db.query('select storage_path from assets where document_id=$1', [
          document.id,
        ]);
        const kept = new Set([document.upload_path, ...assets.map((a) => a.storage_path)]);
        const all = await this.storage.list(`${document.owner_id}/${document.id}`);
        await this.storage.remove(all.filter((path) => !kept.has(path)));
      });
  }
}
