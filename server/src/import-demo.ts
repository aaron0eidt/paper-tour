import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { config, ROOT } from './config';
import { Database } from './db';
import { storageClient } from './storage';
import { DocumentService } from './service';
import { AnalysisWorker, prepareAnalysis } from './worker';
const args = process.argv.slice(2);
const value = (name: string) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const owner = value('--owner');
if (!owner || !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(owner))
  throw new Error('Usage: npm run import-demo -- --owner USER_UUID [--folder ../demo/attention]');
const folder = resolve(value('--folder') ?? resolve(ROOT, 'demo/attention'));
const c = config(),
  db = new Database(c.databaseUrl);
const { storage } = storageClient(c.supabaseUrl, c.serviceKey);
const temp = await mkdtemp(resolve(tmpdir(), 'paper-tour-import-'));
try {
  const pdf = await readFile(resolve(folder, 'paper.pdf'));
  const sha = createHash('sha256').update(pdf).digest('hex');
  const {
    rows: [existing],
  } = await db.query(
    `select d.id from documents d where d.owner_id=$1 and d.sha256=$2 and d.deleted_at is null and exists(select 1 from tours t where t.document_id=d.id) limit 1`,
    [owner, sha],
  );
  if (existing) console.log(`Demo already imported: ${existing.id}`);
  else {
    const source = {
      doc: resolve(folder, 'doc.json'),
      tour: resolve(folder, 'tour.json'),
    };
    // Validate the exact original and tour before storing anything.
    await prepareAnalysis(pdf, temp, c, source);
    const service = new DocumentService(db, storage, async () => {});
    const reserved = await service.reserve(owner, 'Attention Is All You Need.pdf', pdf.length);
    await storage.upload(reserved.path, pdf, 'application/pdf');
    const analysisId = randomUUID();
    await db.transaction(async (tx) => {
      await tx.query("update documents set file_status='uploaded' where id=$1", [reserved.documentId]);
      await tx.query(
        "insert into assets(document_id,kind,logical_path,storage_path,content_type) values($1,'pdf','paper.pdf',$2,'application/pdf')",
        [reserved.documentId, reserved.path],
      );
      await tx.query('insert into analyses(id,document_id) values($1,$2)', [analysisId, reserved.documentId]);
    });
    await new AnalysisWorker(db, storage, c).analyze(reserved.documentId, analysisId, true, source);
    const {
      rows: [a],
    } = await db.query('select status,error from analyses where id=$1', [analysisId]);
    if (!['ready', 'limited'].includes(a.status)) throw new Error(a.error ?? 'Import failed.');
    console.log(`Imported demo with its original tour: ${reserved.documentId}`);
  }
} finally {
  await rm(temp, { recursive: true, force: true });
  await db.close();
}
