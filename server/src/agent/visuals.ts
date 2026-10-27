import { createHash } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { checkImages } from '../muse/context';
import type { Database } from '../db';
import type { FileStorage } from '../storage';
import type { Doc } from '../../../shared/paper';
import type { PrepareTourImages } from '../tour-worker';
import type { VisualSource } from './tools';
export async function preparedVisuals(
  db: Database,
  storage: FileStorage,
  prepare: PrepareTourImages,
  owner: string,
  documentId: string,
  analysisId: string,
  uploadPath: string,
  doc: Doc,
  signal: AbortSignal,
): Promise<VisualSource[]> {
  const logicalPrefix = 'agent-visual@1/';
  const { rows: cached } = await db.query(
    "select logical_path,storage_path,content_type from assets where analysis_id=$1 and kind='visual_context' order by logical_path",
    [analysisId],
  );
  const expected = [
    ...doc.pages.map((p) => ({ targetId: `page${p.n}`, kind: 'page' as const, page: p.n, label: `Page ${p.n}` })),
    ...doc.figures.map((f) => ({ targetId: f.id, kind: f.kind, page: f.page, label: f.caption })),
  ];
  const parse = (row: Record<string, any>) => {
    const key = row.logical_path.slice(logicalPrefix.length).split('/');
    return { targetId: key[0], sha256: key[1], storagePath: row.storage_path };
  };
  if (
    expected.every((source) => cached.some((row) => row.logical_path.startsWith(logicalPrefix + source.targetId + '/')))
  ) {
    const sources = expected.map((source) => ({
      ...source,
      ...parse(cached.find((row) => row.logical_path.startsWith(logicalPrefix + source.targetId + '/'))!),
    })) as VisualSource[];
    if ((await Promise.all(sources.map((source) => storage.info(source.storagePath)))).every(Boolean)) return sources;
  }
  const folder = await mkdtemp(resolve(tmpdir(), 'paper-agent-'));
  try {
    const images = await prepare({ documentId, analysisId, uploadPath, doc, folder }, signal),
      sources: VisualSource[] = [];
    checkImages({ documentId, analysisId, doc, images });
    for (const image of images) {
      const bytes = Buffer.from(image.dataUrl.slice(image.dataUrl.indexOf(',') + 1), 'base64');
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const logicalPath = logicalPrefix + image.targetId + '/' + sha256;
      const contentType = image.dataUrl.startsWith('data:image/png;') ? 'image/png' : 'image/jpeg';
      const storagePath = `${owner}/${documentId}/${analysisId}/${logicalPath}.${contentType === 'image/png' ? 'png' : 'jpg'}`;
      if (!(await storage.info(storagePath))) await storage.upload(storagePath, bytes, contentType);
      await db.query(
        "insert into assets(document_id,analysis_id,kind,logical_path,storage_path,content_type) values($1,$2,'visual_context',$3,$4,$5) on conflict(analysis_id,logical_path) do nothing",
        [documentId, analysisId, logicalPath, storagePath, contentType],
      );
      sources.push({
        targetId: image.targetId,
        kind: image.kind,
        page: image.page,
        label: image.label,
        sha256,
        storagePath,
        contentType,
      });
    }
    if (expected.some((source) => !sources.some((image) => image.targetId === source.targetId)))
      throw new Error('Some required visual sources could not be prepared.');
    return sources;
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
export async function hydrateImages(
  items: unknown[],
  storage: FileStorage,
  visuals: VisualSource[],
): Promise<unknown[]> {
  return Promise.all(
    items.map(async (item: any) => {
      if (!item || typeof item !== 'object') return item;
      if (item.type === 'input_image' && item.storagePath) {
        if (!visuals.some((v) => v.storagePath === item.storagePath && v.sha256 === item.sha256))
          throw new Error('Image is outside the run sources.');
        const bytes = await storage.download(item.storagePath);
        if (createHash('sha256').update(bytes).digest('hex') !== item.sha256)
          throw new Error('Visual source hash mismatch.');
        return {
          type: 'input_image',
          image_url: `data:${visuals.find((v) => v.storagePath === item.storagePath)?.contentType ?? 'image/jpeg'};base64,${bytes.toString('base64')}`,
        };
      }
      return Object.fromEntries(
        await Promise.all(
          Object.entries(item).map(async ([key, value]) => [
            key,
            Array.isArray(value) ? await hydrateImages(value, storage, visuals) : value,
          ]),
        ),
      );
    }),
  );
}
