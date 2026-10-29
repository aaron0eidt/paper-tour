import { useEffect, useMemo, useState } from 'react';
import type { AskSource } from './api';
import type { RegionSelection } from './regionSelection';
import { snapObject } from './snap';
import { canSnap, regionFromSnap } from './snapGeometry';
import type { PageSize, Snapped } from './snapGeometry';

/**
 * The region while it is snapped: `snapping` from the moment it is chosen (the learner's rectangle shows at once,
 * shimmering), then `snapped` with the object's outline or `kept` with the rectangle alone.
 */
export type SnapPhase = 'idle' | 'snapping' | 'snapped' | 'kept';

export interface RegionSnap {
  phase: SnapPhase;
  snapped: Snapped | null;
  /** What a question carries about this region: the object's box once it is found, otherwise the rectangle. */
  region: RegionSelection | null;
}

/**
 * Snap a chosen region to the object inside it. One request per selection, dropped when the selection goes or
 * changes; asking never waits for it (a question sent meanwhile carries the rectangle).
 */
export function useRegionSnap(
  source: AskSource,
  selection: RegionSelection | null,
  pageSize: (page: number) => PageSize | undefined,
  analysisId?: string,
): RegionSnap {
  const [done, setDone] = useState<{ selection: RegionSelection; snapped: Snapped | null } | null>(null);
  // The page sizes only change with the document, and a selection is on one page: read them when it is chosen.
  const size = selection ? pageSize(selection.page) : undefined;
  // A drag too small to hold an object, or over most of the page, keeps its rectangle without asking.
  const eligible = !!selection && !!size && canSnap(selection, size);
  useEffect(() => {
    if (!selection || !size || !eligible) return;
    const controller = new AbortController();
    void snapObject(source, selection, size, analysisId, controller.signal).then((snapped) => {
      if (!controller.signal.aborted) setDone({ selection, snapped });
    });
    return () => controller.abort();
  }, [selection, source, analysisId, size, eligible]);

  const settled = selection && done?.selection === selection ? done : null;
  return useMemo<RegionSnap>(() => {
    if (!selection) return { phase: 'idle', snapped: null, region: null };
    if (!size || !eligible) return { phase: 'kept', snapped: null, region: selection };
    if (!settled) return { phase: 'snapping', snapped: null, region: selection };
    const region = settled.snapped ? regionFromSnap(settled.snapped, selection.page, size) : null;
    return region
      ? { phase: 'snapped', snapped: settled.snapped, region }
      : { phase: 'kept', snapped: null, region: selection };
  }, [selection, size, eligible, settled]);
}
