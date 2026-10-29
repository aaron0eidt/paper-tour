import {
  buildObjectPrompt,
  decodeMaskToRaster,
  parseImageStream,
  recordsOfKind,
  type ResponsesEvent,
} from '@meta-sam/parser';
import type { MuseConfig } from '../config';
import { ProcessingError } from '../errors';
import { modelBaseUrl, providerFetch } from './provider';

/** Meta's SAM 3.1 answers a box prompt in a median 1.2 s (p90 2.2 s); a drag that waits longer keeps its rectangle. */
export const SAM_TIMEOUT_MS = 8_000;
/** Outline simplification in image pixels (Douglas-Peucker). */
export const SIMPLIFY_PX = 1.5;

export type Point = [number, number];
export interface PixelBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** One object prompt on an image: the drag box (half-open, in pixels) and optionally a positive point inside it. */
export interface SamPrompt {
  width: number;
  height: number;
  box: PixelBox;
  point?: { x: number; y: number };
}

/** The mask SAM returned: a 0/1 raster of height x width whose top-left pixel sits at bounds.left, bounds.top. */
export interface SamMask {
  confidence?: number;
  bounds: PixelBox;
  width: number;
  height: number;
  raster: Uint8Array;
}

/** The text of the object prompt: the box with an inclusive far corner, then the point (buildObjectPrompt). */
export function samPromptText(prompt: SamPrompt): string {
  return buildObjectPrompt({
    size: { width: prompt.width, height: prompt.height },
    objects: [{ id: 0, prompts: [{ box: prompt.box, ...(prompt.point ? { points: [prompt.point] } : {}) }] }],
  });
}

/** The request body for one non-streaming SAM 3.1 call with the image as a data URL. */
export function samRequestBody(prompt: SamPrompt, imageUrl: string) {
  return {
    model: 'sam-3.1',
    input: [
      {
        type: 'message',
        role: 'user',
        content: [
          { type: 'input_text', text: samPromptText(prompt) },
          { type: 'input_image', image_url: imageUrl },
        ],
      },
    ],
    stream: false,
    metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
  };
}

/** The output text of a Responses API reply (output[0].content[0].text), or undefined when it has none. */
function outputText(payload: unknown): string | undefined {
  const output = (payload as { output?: unknown } | null)?.output;
  if (!Array.isArray(output)) return undefined;
  for (const item of output) {
    const content = (item as { content?: unknown } | null)?.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      const text = (part as { text?: unknown } | null)?.text;
      if (typeof text === 'string') return text;
    }
  }
  return undefined;
}

const invalid = () =>
  new ProcessingError('muse_invalid_response', 'The segmentation model returned an unusable response.');

/** The parser reads events; one finished reply is the same three events a stream ends with. */
async function* replyEvents(text: string): AsyncIterable<ResponsesEvent> {
  const lane = { item_id: 'sam', output_index: 0, content_index: 0 };
  yield { type: 'response.output_text.delta', delta: text, ...lane };
  yield { type: 'response.output_text.done', text, ...lane };
  yield { type: 'response.completed' };
}

/** The object's mask from the reply text; null when SAM found nothing (an empty reply, or no mask in it). */
export async function parseSamMask(text: string): Promise<SamMask | null> {
  if (!text.trim()) return null;
  try {
    const result = await parseImageStream(replyEvents(text)).finalResult;
    const masks = recordsOfKind(result.records, 'mask');
    // One object, id 0, was prompted; take its mask, or the only one the reply carries.
    const record = masks.find((m) => m.objectId === '0') ?? masks[0];
    if (!record) {
      if (result.diagnostics.some((d) => d.severity === 'error')) throw invalid();
      return null;
    }
    const { bounds } = record;
    if (bounds.right - bounds.left !== record.mask.width || bounds.bottom - bounds.top !== record.mask.height)
      throw invalid();
    const confidence =
      record.confidence ?? recordsOfKind(result.records, 'box').find((b) => b.objectId === record.objectId)?.confidence;
    return {
      ...(confidence === undefined ? {} : { confidence }),
      bounds: { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
      width: record.mask.width,
      height: record.mask.height,
      raster: decodeMaskToRaster(record.mask),
    };
  } catch (error) {
    throw error instanceof ProcessingError ? error : invalid();
  }
}

/**
 * Ask SAM 3.1 for the object inside a box on one image. Resolves null when it finds nothing; every failure is a
 * ProcessingError with a muse_* code (provider.ts maps the statuses: a 400 is permanent, 429 and 5xx transient),
 * and none carries the key, the image or the reply.
 */
export async function segment(
  config: MuseConfig,
  transport: typeof fetch,
  prompt: SamPrompt,
  imageUrl: string,
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<SamMask | null> {
  const url = `${modelBaseUrl(config)}/responses`;
  const timeout = AbortSignal.timeout(options.timeoutMs ?? SAM_TIMEOUT_MS);
  const signal = AbortSignal.any([timeout, ...(options.signal ? [options.signal] : [])]);
  let text: string | undefined;
  try {
    const response = await providerFetch(transport)(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.apiKey}` },
      body: JSON.stringify(samRequestBody(prompt, imageUrl)),
      signal,
    });
    text = outputText(await response.json());
  } catch (error) {
    if (error instanceof ProcessingError) throw error;
    if (options.signal?.aborted) throw new ProcessingError('muse_cancelled', 'The request was cancelled.');
    if (timeout.aborted) throw new ProcessingError('muse_timeout', 'The segmentation request timed out.', true);
    if (error instanceof SyntaxError) throw invalid();
    throw new ProcessingError('muse_network_error', 'The segmentation model could not be reached.', true);
  }
  if (text === undefined) throw invalid();
  return parseSamMask(text);
}

// ------------------------------------------------------------- mask post-processing

/** The connected component (8-neighbour) of the mask that holds the seed pixel, else the largest one. */
export function maskComponent(mask: SamMask, seed: Point): { pixels: Uint8Array; area: number; bbox: PixelBox } | null {
  const { width, height, raster } = mask;
  const labels = new Int32Array(width * height);
  const stack = new Int32Array(width * height);
  const areas: number[] = [0];
  for (let start = 0; start < raster.length; start++) {
    if (!raster[start] || labels[start]) continue;
    const label = areas.length;
    let area = 0;
    let top = 0;
    stack[top++] = start;
    labels[start] = label;
    while (top) {
      const at = stack[--top];
      area++;
      const x = at % width;
      const y = (at - x) / width;
      for (let dy = -1; dy <= 1; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= width) continue;
          const next = ny * width + nx;
          if (!raster[next] || labels[next]) continue;
          labels[next] = label;
          stack[top++] = next;
        }
      }
    }
    areas.push(area);
  }
  if (areas.length === 1) return null;
  const sx = Math.floor(seed[0]) - mask.bounds.left;
  const sy = Math.floor(seed[1]) - mask.bounds.top;
  let keep = sx >= 0 && sy >= 0 && sx < width && sy < height ? labels[sy * width + sx] : 0;
  if (!keep) for (let i = 1; i < areas.length; i++) if (!keep || areas[i] > areas[keep]) keep = i;
  const pixels = new Uint8Array(width * height);
  let [minX, minY, maxX, maxY] = [width, height, -1, -1];
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] !== keep) continue;
    pixels[i] = 1;
    const x = i % width;
    const y = (i - x) / width;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return {
    pixels,
    area: areas[keep],
    bbox: {
      left: mask.bounds.left + minX,
      top: mask.bounds.top + minY,
      right: mask.bounds.left + maxX + 1,
      bottom: mask.bounds.top + maxY + 1,
    },
  };
}

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];
/** Directions are 0 east, 1 south, 2 west, 3 north; these are the turns to try in order: left, straight, right. */
const TURNS = [3, 0, 1];

/**
 * The outer boundary of a binary raster along pixel edges, as lattice points in walking order (inside on the right,
 * so clockwise on screen). Diagonal pixels count as joined, and holes are ignored: the longest loop is the outline.
 */
export function outerContour(pixels: Uint8Array, width: number, height: number): Point[] {
  const stride = width + 1;
  const leaving = new Uint8Array(stride * (height + 1));
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < width && y < height && pixels[y * width + x] === 1;
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      if (!pixels[y * width + x]) continue;
      if (!inside(x, y - 1)) leaving[y * stride + x] |= 1; // top edge, east
      if (!inside(x + 1, y)) leaving[y * stride + x + 1] |= 2; // right edge, south
      if (!inside(x, y + 1)) leaving[(y + 1) * stride + x + 1] |= 4; // bottom edge, west
      if (!inside(x - 1, y)) leaving[(y + 1) * stride + x] |= 8; // left edge, north
    }
  const seen = new Uint8Array(leaving.length);
  let best: Point[] = [];
  let bestArea = -1;
  for (let at = 0; at < leaving.length; at++)
    for (let first = 0; first < 4; first++) {
      if (!(leaving[at] & (1 << first)) || seen[at] & (1 << first)) continue;
      const loop: Point[] = [];
      let vertex = at;
      let dir = first;
      do {
        seen[vertex] |= 1 << dir;
        const x = vertex % stride;
        const y = (vertex - x) / stride;
        loop.push([x, y]);
        vertex = (y + DY[dir]) * stride + x + DX[dir];
        // Prefer the left turn: at a pinch it follows the outside, so diagonal pixels stay one region.
        for (const turn of TURNS) {
          const next = (dir + turn) & 3;
          if (leaving[vertex] & (1 << next)) {
            dir = next;
            break;
          }
        }
      } while (!(vertex === at && dir === first));
      const area = Math.abs(ringArea(loop));
      if (area > bestArea) [best, bestArea] = [loop, area];
    }
  return best;
}

/** Twice the signed area of a ring (positive when clockwise on screen). */
function ringArea(ring: Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % ring.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

/** Douglas-Peucker on an open polyline: the end points stay, and so does every point farther than the tolerance. */
function simplifyLine(line: Point[], tolerance: number): Point[] {
  const keep = new Uint8Array(line.length);
  keep[0] = keep[line.length - 1] = 1;
  const spans: [number, number][] = [[0, line.length - 1]];
  while (spans.length) {
    const [from, to] = spans.pop()!;
    const [ax, ay] = line[from];
    const [bx, by] = line[to];
    const length = Math.hypot(bx - ax, by - ay);
    let far = -1;
    let farthest = tolerance;
    for (let i = from + 1; i < to; i++) {
      const [px, py] = line[i];
      const d =
        length === 0 ? Math.hypot(px - ax, py - ay) : Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / length;
      if (d > farthest) [far, farthest] = [i, d];
    }
    if (far < 0) continue;
    keep[far] = 1;
    spans.push([from, far], [far, to]);
  }
  return line.filter((_, i) => keep[i]);
}

/** Douglas-Peucker on a closed ring, anchored at its first point and the point farthest from it. */
export function simplifyRing(ring: Point[], tolerance = SIMPLIFY_PX): Point[] {
  if (ring.length <= 3) return ring;
  const away = (i: number) => Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
  let far = 1;
  for (let i = 2; i < ring.length; i++) if (away(i) > away(far)) far = i;
  const first = simplifyLine(ring.slice(0, far + 1), tolerance);
  const second = simplifyLine([...ring.slice(far), ring[0]], tolerance);
  return [...first.slice(0, -1), ...second.slice(0, -1)];
}

/** Clockwise on screen, starting at the top-most (then left-most) point, so equal outlines come out equal. */
export function normalizeRing(ring: Point[]): Point[] {
  const ordered = ringArea(ring) < 0 ? [...ring].reverse() : ring;
  let start = 0;
  for (let i = 1; i < ordered.length; i++)
    if (ordered[i][1] < ordered[start][1] || (ordered[i][1] === ordered[start][1] && ordered[i][0] < ordered[start][0]))
      start = i;
  return [...ordered.slice(start), ...ordered.slice(0, start)];
}

/** What the reader draws: the object's outline in image pixels, with the pixel box and area it came from. */
export interface MaskOutline {
  polygon: Point[];
  bbox: PixelBox;
  area: number;
}

/**
 * The outline of the object under the seed: its connected component, the external contour (holes from text and
 * lines are filled), simplified, in image pixels. Null for an empty mask or a sliver with no three-point outline.
 */
export function maskOutline(mask: SamMask, seed: Point, tolerance = SIMPLIFY_PX): MaskOutline | null {
  const component = maskComponent(mask, seed);
  if (!component) return null;
  const contour = outerContour(component.pixels, mask.width, mask.height);
  const ring = simplifyRing(contour, tolerance);
  if (ring.length < 3) return null;
  const polygon = normalizeRing(ring.map(([x, y]): Point => [mask.bounds.left + x, mask.bounds.top + y]));
  return { polygon, bbox: component.bbox, area: component.area };
}
