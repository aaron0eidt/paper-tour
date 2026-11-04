import type { Doc } from '../../../shared/paper';
import type { Db } from '../db';
import type { FileStorage } from '../storage';
import type { TourImage } from '../tour-generator';

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
