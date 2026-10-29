import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import type { Doc, Tour } from '../../../shared/paper';
import type { RegionSelection } from '../../../shared/selection';
import { ROOT } from '../config';
import type { Db } from '../db';
import { HttpError } from '../errors';
import { selectionImages } from '../selection-image';
import type { FileStorage } from '../storage';
import type { TourImage } from '../tour-generator';

const isRaw = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const IMAGE_WAIT_MS = 2_500;
const IMAGE_MAX_BYTES = 1_500_000;

/** The figure (or the figure of the panel) asked about. */
const figureOf = (doc: Doc, id?: string) =>
  id ? doc.figures.find((f) => f.id === id || f.panels.some((p) => p.id === id)) : undefined;

function imageOf(figure: Doc['figures'][number], data: Buffer | null, jpeg: boolean): TourImage | undefined {
  if (!data || data.length > IMAGE_MAX_BYTES) return undefined;
  const dataUrl = `data:image/${jpeg ? 'jpeg' : 'png'};base64,${data.toString('base64')}`;
  return {
    targetId: figure.id,
    kind: figure.kind,
    page: figure.page,
    label: `${figure.kind === 'table' ? 'Table' : 'Figure'} ${figure.number}`,
    dataUrl,
  };
}

/** The crop of the figure asked about, only when it is small and arrives quickly; otherwise the caption is enough. */
export async function figureImage(
  db: Db,
  storage: FileStorage,
  analysisId: string,
  doc: Doc,
  figureId?: string,
): Promise<TourImage | undefined> {
  const figure = figureOf(doc, figureId);
  if (!figure) return undefined;
  try {
    const {
      rows: [asset],
    } = await db.query(
      "select storage_path,content_type from assets where analysis_id=$1 and logical_path=$2 and kind='figure'",
      [analysisId, figure.image],
    );
    if (!asset) return undefined;
    const data = await Promise.race([
      storage.download(asset.storage_path),
      new Promise<null>((resolve) => setTimeout(resolve, IMAGE_WAIT_MS, null).unref()),
    ]);
    return imageOf(figure, data, asset.content_type === 'image/jpeg');
  } catch {
    return undefined;
  }
}

// ------------------------------------------------------------- demo papers

/** Demo papers live in demo/<paper>/ (doc.json, tour.json, figures/), as the player serves them in development. */
export const DEMO_ROOT = resolve(ROOT, 'demo');
/** A demo folder name: letters, digits, "_", "." and "-", not starting with a dot and without "..". */
export const DEMO_PAPER = /^(?!.*\.\.)\w[\w.-]{0,79}$/;
const DEMO_MAX_BYTES = 32 * 1024 * 1024;

export interface DemoPaper {
  doc: Doc;
  tour?: Tour;
}

/** A file inside the demo root once links are followed (demo folders link to each other's files), else null. */
async function demoFile(root: string, ...path: string[]): Promise<string | null> {
  try {
    const base = await realpath(root);
    const file = await realpath(resolve(base, ...path));
    return file.startsWith(`${base}${sep}`) && (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

async function demoJson(file: string | null): Promise<unknown> {
  try {
    return file && (await stat(file)).size <= DEMO_MAX_BYTES ? JSON.parse(await readFile(file, 'utf8')) : undefined;
  } catch {
    return undefined;
  }
}

const isDoc = (v: unknown): v is Doc =>
  isRaw(v) &&
  v.schema === 'paper-tour/doc@0.1' &&
  isRaw(v.source) &&
  ['pages', 'sections', 'blocks', 'sentences', 'figures', 'equations'].every((key) => Array.isArray(v[key]));
const isTour = (v: unknown): v is Tour =>
  isRaw(v) &&
  Array.isArray(v.chapters) &&
  v.chapters.every(
    (c) =>
      isRaw(c) &&
      Array.isArray(c.steps) &&
      c.steps.every((s) => isRaw(s) && typeof s.say === 'string' && Array.isArray(s.actions)),
  );

/** A demo paper's doc.json and, when it has a usable one, its tour.json; null for a bad name or no doc.json. */
export async function loadDemo(paper: string, root = DEMO_ROOT): Promise<DemoPaper | null> {
  if (!DEMO_PAPER.test(paper)) return null;
  const doc = await demoJson(await demoFile(root, paper, 'doc.json'));
  if (!isDoc(doc)) return null;
  const tour = await demoJson(await demoFile(root, paper, 'tour.json'));
  return isTour(tour) ? { doc, tour } : { doc };
}

/** The crop of the demo figure asked about, from the paper folder the player shows it from. */
export async function demoImage(
  paper: string,
  doc: Doc,
  figureId?: string,
  root = DEMO_ROOT,
): Promise<TourImage | undefined> {
  const figure = figureOf(doc, figureId);
  const type = /\.(png|jpe?g)$/i.exec(figure?.image ?? '')?.[1].toLowerCase();
  if (!figure || !type || !DEMO_PAPER.test(paper)) return undefined;
  const file = await demoFile(root, paper, figure.image);
  try {
    return file && (await stat(file)).size <= IMAGE_MAX_BYTES
      ? imageOf(figure, await readFile(file), type !== 'png')
      : undefined;
  } catch {
    return undefined;
  }
}

/** A region question in local demos uses the same verified PDF renderer as signed-in documents. */
export async function demoSelectionImages(
  paper: string,
  doc: Doc,
  selection: RegionSelection,
  root = DEMO_ROOT,
  signal?: AbortSignal,
): Promise<TourImage[]> {
  const file = DEMO_PAPER.test(paper) ? await demoFile(root, paper, 'paper.pdf') : null;
  if (!file || (await stat(file)).size > DEMO_MAX_BYTES)
    throw new HttpError(409, 'source_unavailable', 'The original PDF is unavailable for this selection.');
  const local = { download: () => readFile(file) };
  return selectionImages(local, file, doc, selection, signal);
}
