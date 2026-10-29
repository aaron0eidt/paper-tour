import type { QueryResultRow } from 'pg';
import type { BBox, Doc } from '../../shared/paper';
import type { RegionSelection } from '../../shared/selection';
import { maskOutline, segment, SAM_TIMEOUT_MS, type Point, type PixelBox } from './ai/sam';
import type { MuseConfig } from './config';
import type { Database } from './db';
import { HttpError, missing, ProcessingError } from './errors';
import { demoSelectionImages, DEMO_ROOT, loadDemo } from './harness/ask-assets';
import { selectionImages } from './selection-image';
import type { FileStorage } from './storage';
import type { TourImage } from './tour-generator';

/** A loose box dragged over a figure, in PDF points from the top-left of the page (as in doc.json). */
export interface SnapRequest {
  page: number;
  box: BBox;
  /** The analysis the reader shows, when it is not the document's current one. */
  analysisId?: string;
}

/** Why the rectangle stays: the guards below, no object found, or the model could not be used right now. */
export type SnapFailure =
  | 'low_confidence'
  | 'overshoot'
  | 'too_large'
  | 'no_object'
  | 'rejected'
  | 'timeout'
  | 'busy'
  | 'unavailable'
  | 'not_configured'
  | 'invalid_response'
  | 'render_failed'
  | 'cancelled';

export type SnapResult =
  | {
      ok: true;
      /** The object's outline, clockwise from its top-most point, in PDF points. */
      polygon: Point[];
      /** The outline's bounding box [x1, y1, x2, y2] in PDF points. */
      bbox: BBox;
      confidence: number;
      ms: number;
      /** Set when an earlier snap of nearly the same box answered. */
      cached?: true;
    }
  | { ok: false; reason: SnapFailure };

/** Guards fitted on 46 real snaps: all 42 good ones passed, the bad ones failed. */
export const SNAP_MIN_CONFIDENCE = 0.6;
/** How far the object may reach past the drag box on any side, as a fraction of the box's size. */
export const SNAP_MAX_OVERSHOOT = 0.15;
/** The most of the drag box the object may fill; a mask that fills it is the background, not an object. */
export const SNAP_MAX_AREA = 0.9;
/** The crop around the drag: the box grown by this fraction of its size on every side, at least MIN_MARGIN points. */
const CROP_MARGIN = 0.3;
const MIN_MARGIN = 10;
const MIN_BOX = 1;
/** A dragged box can be this far past the page edge (rounding in the reader) and is clamped to it. */
const EDGE_SLACK = 0.01;
/** Boxes within CACHE_STEP points of each other share an answer. */
const CACHE_STEP = 2;
const CACHE_SIZE = 256;
/** Snaps in flight per learner (and for all demo papers together): each one is a paid model call. */
const MAX_ACTIVE = 3;

/** Reasons that stay true for the same box; the rest (timeouts, a busy model) may pass on the next try. */
const STABLE: ReadonlySet<SnapFailure> = new Set(['low_confidence', 'overshoot', 'too_large', 'no_object', 'rejected']);
const FAILURES: Record<string, SnapFailure> = {
  muse_not_configured: 'not_configured',
  muse_auth_failed: 'not_configured',
  muse_rate_limited: 'busy',
  muse_unavailable: 'unavailable',
  muse_network_error: 'unavailable',
  muse_timeout: 'timeout',
  muse_cancelled: 'cancelled',
  muse_request_rejected: 'rejected',
  muse_invalid_response: 'invalid_response',
};

/** The parts of DocumentService (service.ts) that snapping reads; the service itself provides them. */
export interface SnapLibrary {
  owned(owner: string, id: string): Promise<QueryResultRow>;
  db: Pick<Database, 'query'>;
  storage: Pick<FileStorage, 'download'>;
  settings?: SnapSettings;
  /** Where demo papers are read from; defaults to demo/ in the repository. */
  demoRoot?: string;
}

/** The server's Meta connection (settings.ts): its own key for demos, the learner's choice for their documents. */
export interface SnapSettings {
  base: MuseConfig;
  transport: typeof fetch;
  resolveMuse(owner: string): Promise<{ config: MuseConfig }>;
}

/** What one snap needs of a paper: its page sizes and a renderer for the crop from the original PDF. */
interface SnapSource {
  doc: Doc;
  images(selection: RegionSelection, signal?: AbortSignal): Promise<TourImage[]>;
}

export interface SnapOptions {
  timeoutMs?: number;
  /** Renders the crop in place of the PDF renderer (tests). */
  images?: SnapSource['images'];
  log?: (event: Record<string, unknown>) => void;
}

/** The crop around a drag: the box grown on every side and clamped to the page. */
export function cropRect(page: { width: number; height: number }, box: BBox): BBox {
  const [x1, y1, x2, y2] = box;
  const mx = Math.max(CROP_MARGIN * (x2 - x1), MIN_MARGIN);
  const my = Math.max(CROP_MARGIN * (y2 - y1), MIN_MARGIN);
  return [Math.max(0, x1 - mx), Math.max(0, y1 - my), Math.min(page.width, x2 + mx), Math.min(page.height, y2 + my)];
}

/** The page and box of a request, checked against the document: finite, non-empty and inside the page. */
export function validateSnap(
  doc: Doc,
  request: SnapRequest,
): { page: { n: number; width: number; height: number }; box: BBox } {
  const page = Number.isInteger(request.page) ? doc.pages.find((p) => p.n === request.page) : undefined;
  if (!page) throw new HttpError(400, 'invalid_selection', 'Select a page that belongs to this document.');
  const box = request.box;
  if (
    !Array.isArray(box) ||
    box.length !== 4 ||
    !box.every((n) => typeof n === 'number' && Number.isFinite(n)) ||
    box[0] < -EDGE_SLACK ||
    box[1] < -EDGE_SLACK ||
    box[2] > page.width + EDGE_SLACK ||
    box[3] > page.height + EDGE_SLACK ||
    box[2] - box[0] < MIN_BOX ||
    box[3] - box[1] < MIN_BOX
  )
    throw new HttpError(400, 'invalid_selection', 'Drag a box inside the PDF page.');
  return {
    page,
    box: [Math.max(0, box[0]), Math.max(0, box[1]), Math.min(page.width, box[2]), Math.min(page.height, box[3])],
  };
}

/** The checks on what SAM returned, all in image pixels: null when the object may replace the drag box. */
export function snapRejection(
  found: { confidence?: number; bbox: PixelBox; area: number },
  drag: PixelBox,
): SnapFailure | null {
  if (found.confidence === undefined || found.confidence < SNAP_MIN_CONFIDENCE) return 'low_confidence';
  const width = drag.right - drag.left;
  const height = drag.bottom - drag.top;
  const overshoot = Math.max(
    (drag.left - found.bbox.left) / width,
    (drag.top - found.bbox.top) / height,
    (found.bbox.right - drag.right) / width,
    (found.bbox.bottom - drag.bottom) / height,
  );
  if (overshoot > SNAP_MAX_OVERSHOOT) return 'overshoot';
  if (found.area > SNAP_MAX_AREA * width * height) return 'too_large';
  return null;
}

/** Width and height from a JPEG's start-of-frame marker; null when the bytes are not a JPEG. */
export function jpegSize(data: Uint8Array): { width: number; height: number } | null {
  if (data[0] !== 0xff || data[1] !== 0xd8) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let at = 2;
  while (at + 9 <= data.length) {
    if (data[at] !== 0xff) return null;
    const marker = data[at + 1];
    if (marker === 0xff) at++;
    else if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) at += 2;
    else if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc)
      return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
    else at += 2 + view.getUint16(at + 2);
  }
  return null;
}

const round = (n: number) => Math.round(n * 100) / 100;
const aborted = (error: unknown) => error instanceof Error && error.name === 'AbortError';

/**
 * Region snapping: a learner drags a loose box over a figure, SAM 3.1 finds the object inside, and the reader morphs
 * the rectangle into its outline. Every failure leaves the rectangle as it is, so a result says why instead of
 * throwing; only a bad request or an unreadable document is an HTTP error.
 */
export class SnapService {
  private readonly cache = new Map<string, SnapResult>();
  private readonly active = new Map<string, number>();
  constructor(
    private readonly library: SnapLibrary,
    private readonly settings: SnapSettings,
    private readonly options: SnapOptions = {},
  ) {}

  /** A drag over one of the owner's documents. */
  async snap(owner: string, id: string, request: SnapRequest, signal?: AbortSignal): Promise<SnapResult> {
    const document = await this.library.owned(owner, id);
    const analysisId = request.analysisId ?? document.current_analysis_id;
    const {
      rows: [analysis],
    } = analysisId
      ? await this.library.db.query(
          "select id,doc from analyses where id=$1 and document_id=$2 and status in ('ready','limited')",
          [analysisId, id],
        )
      : { rows: [] };
    if (!analysis) throw new HttpError(409, 'analysis_not_ready', 'The document analysis is not ready yet.');
    const doc = analysis.doc as Doc;
    const storage = this.library.storage;
    return this.run(
      { scope: owner, key: `document:${id}`, log: { documentId: id } },
      {
        doc,
        images: (selection, abortable) => selectionImages(storage, document.upload_path, doc, selection, abortable),
      },
      request,
      async () => (await this.settings.resolveMuse(owner)).config,
      signal,
    );
  }

  /** A drag over a demo paper (demo/<paper>/) on the server's own key; app.ts exposes it only in local development. */
  async demoSnap(paper: string, request: SnapRequest, signal?: AbortSignal): Promise<SnapResult> {
    const root = this.library.demoRoot ?? DEMO_ROOT;
    const demo = (await loadDemo(paper, root)) ?? missing();
    return this.run(
      { scope: 'demo', key: `demo:${paper}`, log: { demo: paper } },
      {
        doc: demo.doc,
        images: (selection, abortable) => demoSelectionImages(paper, demo.doc, selection, root, abortable),
      },
      request,
      async () => this.settings.base,
      signal,
    );
  }

  private async run(
    who: { scope: string; key: string; log: Record<string, unknown> },
    source: SnapSource,
    request: SnapRequest,
    muse: () => Promise<MuseConfig>,
    signal?: AbortSignal,
  ): Promise<SnapResult> {
    const started = Date.now();
    const { page, box } = validateSnap(source.doc, request);
    const key = `${who.key}|${page.n}|${box.map((n) => Math.round(n / CACHE_STEP)).join(',')}`;
    const known = this.cache.get(key);
    if (known) {
      this.cache.delete(key);
      this.cache.set(key, known);
      const hit: SnapResult = known.ok ? { ...known, ms: Date.now() - started, cached: true } : known;
      this.record(who.log, page.n, hit, {});
      return hit;
    }
    const active = this.active.get(who.scope) ?? 0;
    if (active >= MAX_ACTIVE) return { ok: false, reason: 'busy' };
    this.active.set(who.scope, active + 1);
    const timings: Record<string, number> = {};
    let result: SnapResult;
    try {
      result = await this.find(source, page, box, muse, timings, signal);
    } finally {
      const left = (this.active.get(who.scope) ?? 1) - 1;
      if (left > 0) this.active.set(who.scope, left);
      else this.active.delete(who.scope);
    }
    if (result.ok) result = { ...result, ms: Date.now() - started };
    if (result.ok || STABLE.has(result.reason)) {
      this.cache.set(key, result);
      if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    }
    this.record(who.log, page.n, result, timings);
    return result;
  }

  private record(who: Record<string, unknown>, page: number, result: SnapResult, timings: Record<string, number>) {
    const log = this.options.log ?? ((event) => console.log(JSON.stringify(event)));
    log({
      event: result.ok ? 'snap_done' : 'snap_rejected',
      ...who,
      page,
      ...(result.ok
        ? { confidence: result.confidence, ms: result.ms, cached: result.cached === true }
        : { reason: result.reason }),
      ...timings,
    });
  }

  private async find(
    source: SnapSource,
    page: { n: number; width: number; height: number },
    box: BBox,
    muse: () => Promise<MuseConfig>,
    timings: Record<string, number>,
    signal?: AbortSignal,
  ): Promise<SnapResult> {
    const fail = (reason: SnapFailure): SnapResult => ({ ok: false, reason });
    let config: MuseConfig;
    try {
      config = await muse();
    } catch (error) {
      if (error instanceof ProcessingError) return fail(FAILURES[error.code] ?? 'unavailable');
      throw error;
    }
    if (!config.apiKey) return fail('not_configured');
    const [cx1, cy1, cx2, cy2] = cropRect(page, box);
    const rendering = Date.now();
    let crop: TourImage | undefined;
    try {
      const rect: BBox = [cx1 / page.width, cy1 / page.height, cx2 / page.width, cy2 / page.height];
      const render = this.options.images ?? source.images;
      crop = (await render({ page: page.n, rect }, signal)).find((image) => image.targetId.startsWith('selection-'));
    } catch (error) {
      if (aborted(error)) return fail('cancelled');
      if (error instanceof HttpError) throw error;
      console.warn(JSON.stringify({ event: 'snap_render_failed', page: page.n }));
      return fail('render_failed');
    }
    timings.renderMs = Date.now() - rendering;
    const size = crop ? jpegSize(Buffer.from(crop.dataUrl.slice(crop.dataUrl.indexOf(',') + 1), 'base64')) : null;
    if (!crop || !size) return fail('render_failed');
    // The crop is size.width x size.height pixels for the rectangle (cx1, cy1)-(cx2, cy2) in points.
    const sx = size.width / (cx2 - cx1);
    const sy = size.height / (cy2 - cy1);
    const drag: PixelBox = {
      left: (box[0] - cx1) * sx,
      top: (box[1] - cy1) * sy,
      right: (box[2] - cx1) * sx,
      bottom: (box[3] - cy1) * sy,
    };
    const left = Math.min(size.width - 1, Math.max(0, Math.floor(drag.left)));
    const top = Math.min(size.height - 1, Math.max(0, Math.floor(drag.top)));
    const centre: Point = [(drag.left + drag.right) / 2, (drag.top + drag.bottom) / 2];
    const calling = Date.now();
    let mask;
    try {
      mask = await segment(
        config,
        this.settings.transport,
        {
          width: size.width,
          height: size.height,
          box: {
            left,
            top,
            right: Math.min(size.width, Math.max(left + 1, Math.ceil(drag.right))),
            bottom: Math.min(size.height, Math.max(top + 1, Math.ceil(drag.bottom))),
          },
          point: {
            x: Math.min(size.width - 1, Math.max(0, Math.floor(centre[0]))),
            y: Math.min(size.height - 1, Math.max(0, Math.floor(centre[1]))),
          },
        },
        crop.dataUrl,
        { signal, timeoutMs: this.options.timeoutMs ?? SAM_TIMEOUT_MS },
      );
    } catch (error) {
      if (error instanceof ProcessingError) return fail(FAILURES[error.code] ?? 'unavailable');
      throw error;
    }
    timings.samMs = Date.now() - calling;
    const outline = mask && maskOutline(mask, centre);
    if (!mask || !outline) return fail('no_object');
    const rejected = snapRejection({ confidence: mask.confidence, bbox: outline.bbox, area: outline.area }, drag);
    if (rejected) return fail(rejected);
    const x = (px: number) => round(cx1 + px / sx);
    const y = (py: number) => round(cy1 + py / sy);
    return {
      ok: true,
      polygon: outline.polygon.map(([px, py]): Point => [x(px), y(py)]),
      bbox: [x(outline.bbox.left), y(outline.bbox.top), x(outline.bbox.right), y(outline.bbox.bottom)],
      confidence: mask.confidence!,
      ms: 0,
    };
  }
}

/**
 * The snap service for a library that has what it needs (DocumentService does), else undefined. A caller that has no
 * such library passes its own SnapService to createApp.
 */
export function snapService(library: object, settings?: SnapSettings): SnapService | undefined {
  const candidate = library as Partial<SnapLibrary>;
  const connection = settings ?? candidate.settings;
  return typeof candidate.owned === 'function' &&
    typeof candidate.db === 'object' &&
    typeof candidate.storage === 'object' &&
    connection
    ? new SnapService(candidate as SnapLibrary, connection)
    : undefined;
}
