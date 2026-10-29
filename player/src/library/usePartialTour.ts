import { useEffect, useRef, useState } from 'react';
import type { TourGenerationStatus } from '../../../shared/contracts';
import type { HeldPartial } from '../partialTour';
import { followPartial } from './followPartial';
import type { PartialFollow, PartialSource } from './followPartial';

export type { PartialFollow, PartialSource };

/**
 * Follow a running generation's partial tour (followPartial) while `source` is set, about every 1.5 s. `onSettled` is
 * called when the generation is no longer running, with its final status, so that the reader loads the finished tour (or
 * learns what happened) at once instead of at its next refresh. `restart` is anything that should start the poll again
 * at once, such as the generation's status changing under it (a retry).
 */
export function usePartialTour(
  source: PartialSource | null,
  restart: string,
  onSettled: (status: TourGenerationStatus) => void,
): PartialFollow {
  const [follow, setFollow] = useState<PartialFollow>({ held: null, status: null });
  const held = useRef<HeldPartial | null>(null);
  const settled = useRef(onSettled);
  settled.current = onSettled;
  const followed = useRef<string | undefined>();
  const key = source?.key;
  useEffect(() => {
    if (!source) return;
    // Another generation: the steps held stay until it brings its own, but its predecessor's status is no longer true.
    if (followed.current !== source.key) {
      followed.current = source.key;
      setFollow((previous) => (previous.status === null ? previous : { ...previous, status: null }));
    }
    const controller = new AbortController();
    void followPartial(
      source,
      held,
      (next) => setFollow((previous) => (previous.held === next.held && previous.status === next.status ? previous : next)),
      (status) => settled.current(status),
      controller.signal,
    );
    return () => controller.abort();
    // `source` is built for `key`; `restart` starts the poll again when the generation changes under it.
  }, [key, restart]);
  return follow;
}
