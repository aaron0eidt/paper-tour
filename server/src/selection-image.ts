import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Doc } from '../../shared/paper';
import { SelectionError, validateSelection, type RegionSelection } from '../../shared/selection';
import { ROOT } from './config';
import { HttpError } from './errors';
import type { FileStorage } from './storage';
import type { InkMap, TourImage } from './tour-generator';

const execute = promisify(execFile);

/** The crop's ink from the renderer's file, or undefined when it is missing or not of the crop's size. */
export function inkOf(bits: Buffer | null, rendered: string): InkMap | undefined {
  try {
    const [width, height] = (JSON.parse(rendered) as { dimensions: [number, number][] }).dimensions[1];
    return bits && Number.isInteger(width) && Number.isInteger(height) && bits.length === Math.ceil((width * height) / 8)
      ? { width, height, bits: new Uint8Array(bits) }
      : undefined;
  } catch {
    return undefined;
  }
}

/** Full-page context plus an enlarged crop from the immutable original PDF; the crop also carries its ink map. */
export async function selectionImages(
  storage: Pick<FileStorage, 'download'>,
  uploadPath: string,
  doc: Doc,
  raw: RegionSelection,
  signal?: AbortSignal,
): Promise<TourImage[]> {
  let selection: RegionSelection;
  try { selection = validateSelection(raw, doc); }
  catch (error) {
    if (error instanceof SelectionError) throw new HttpError(400, 'invalid_selection', error.message);
    throw error;
  }
  signal?.throwIfAborted();
  const pdf = await storage.download(uploadPath);
  signal?.throwIfAborted();
  if (createHash('sha256').update(pdf).digest('hex') !== doc.source.sha256)
    throw new HttpError(409, 'source_mismatch', 'The original PDF does not match this document analysis.');
  const folder = await mkdtemp(join(tmpdir(), 'paper-tour-selection-'));
  try {
    const pdfPath = join(folder, 'source.pdf');
    await writeFile(pdfPath, pdf);
    signal?.throwIfAborted();
    const page = doc.pages.find(p => p.n === selection.page)!;
    const { stdout } = await execute(process.env.PYTHON_BIN ?? resolve(ROOT, 'ingest/.venv/bin/python'), [
      '-I', resolve(ROOT, 'ingest/selection_image.py'), pdfPath, '--out', folder,
      '--page', String(selection.page), '--rect', JSON.stringify(selection.rect),
      '--sha256', doc.source.sha256, '--size', JSON.stringify([page.width, page.height]),
    ], { timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024, ...(signal ? { signal } : {}) });
    signal?.throwIfAborted();
    const [full, crop, bits] = await Promise.all([
      readFile(join(folder, 'page.jpg')), readFile(join(folder, 'selection.jpg')),
      readFile(join(folder, 'selection.ink')).catch(() => null),
    ]);
    signal?.throwIfAborted();
    const ink = inkOf(bits, stdout);
    return [
      { targetId: `page${selection.page}`, kind: 'page', page: selection.page,
        label: `Full page ${selection.page} — context for the selected region`, dataUrl: `data:image/jpeg;base64,${full.toString('base64')}` },
      { targetId: `selection-page${selection.page}`, kind: 'page', page: selection.page,
        label: `Selected region on page ${selection.page} (${selection.rect.map(n => Math.round(n * 100)).join(', ')}% of page). Image context only; use existing document IDs for actions.`,
        dataUrl: `data:image/jpeg;base64,${crop.toString('base64')}`, ...(ink ? { ink } : {}) },
    ];
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}
