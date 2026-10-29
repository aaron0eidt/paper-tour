import type { TourImage } from '../tour-generator';
import type { MuseContent } from '../muse/client';

export type { Effort } from '../ai/recorded-calls';

/** Image parts in the convention the activity log understands: "Visual source <id>; <label>" before each image. */
export function imageParts(images: TourImage[]): MuseContent[] {
  return images.flatMap((image) => [
    { type: 'text' as const, text: `Visual source ${image.targetId}; ${image.label}, page ${image.page}.` },
    { type: 'image_url' as const, image_url: { url: image.dataUrl } },
  ]);
}

/** Stop assigning work on failure, then drain in-flight tasks before returning.
 * The optional callback can cancel siblings; their errors never replace the first one.
 */
export async function pool<T, R>(
  items: T[],
  limit: number,
  task: (item: T, index: number) => Promise<R>,
  onFailure?: (error: unknown) => void,
) {
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Pool concurrency must be a positive integer.');
  const results = new Array<R>(items.length);
  let next = 0;
  let failed = false;
  let failure: unknown;
  const worker = async () => {
    while (!failed && next < items.length) {
      const index = next++;
      try {
        results[index] = await task(items[index], index);
      } catch (error) {
        if (!failed) {
          failed = true;
          failure = error;
          try {
            onFailure?.(error);
          } catch {
            /* Preserve the task failure while draining siblings. */
          }
        }
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  if (failed) throw failure;
  return results;
}
