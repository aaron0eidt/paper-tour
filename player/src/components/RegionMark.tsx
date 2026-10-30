import { useLayoutEffect, useMemo, useRef } from 'react';
import type { PageBox } from '../layout';
import type { BBox } from '../types';
import type { SnapPhase } from '../ask/useRegionSnap';
import { MORPH_MS, boxPolygon, easeInOut, mix, outlinePath, pairOutlines } from '../ask/snapGeometry';
import type { Snapped } from '../ask/snapGeometry';

interface Props {
  page: PageBox;
  /** The learner's rectangle, as fractions of the page. */
  rect: BBox;
  /** `draft` while the drag is going; then the snap's phases. */
  phase: SnapPhase | 'draft';
  snapped?: Snapped | null;
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * The region a question is about. The learner's rectangle shows at once and shimmers quietly while the object inside
 * it is found; then it flows into the object's outline. When nothing is found it simply stays a rectangle.
 */
export function RegionMark({ page, rect, phase, snapped }: Props) {
  if (phase === 'snapped' && snapped) return <RegionOutline page={page} rect={rect} snapped={snapped} />;
  return (
    <div
      className={`pdf-region-selection${phase === 'snapping' ? ' snapping' : ''}`}
      style={{
        left: page.x + rect[0] * page.width,
        top: page.y + rect[1] * page.height,
        width: (rect[2] - rect[0]) * page.width,
        height: (rect[3] - rect[1]) * page.height,
      }}
    />
  );
}

/** The rectangle's four corners become the outline's points, in the page's own units (PDF points). */
function RegionOutline({ page, rect, snapped }: { page: PageBox; rect: BBox; snapped: Snapped }) {
  const line = useRef<SVGPathElement>(null);
  const glow = useRef<SVGPathElement>(null);
  const [from, to] = useMemo(
    () =>
      pairOutlines(
        boxPolygon([rect[0] * page.width, rect[1] * page.height, rect[2] * page.width, rect[3] * page.height]),
        snapped.polygon,
      ),
    [rect, page.width, page.height, snapped],
  );
  const start = useMemo(() => outlinePath(from), [from]);
  const end = useMemo(() => outlinePath(snapped.polygon), [snapped]);
  useLayoutEffect(() => {
    const draw = (d: string) => {
      line.current?.setAttribute('d', d);
      glow.current?.setAttribute('d', d);
    };
    if (prefersReducedMotion()) {
      draw(end);
      return;
    }
    let frame = 0;
    const began = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - began) / MORPH_MS);
      // The exact outline replaces the resampled one when it arrives.
      draw(t < 1 ? outlinePath(mix(from, to, easeInOut(t))) : end);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [from, to, end]);
  return (
    <svg
      className="pdf-region-outline"
      style={{ left: page.x, top: page.y, width: page.width, height: page.height }}
      viewBox={`0 0 ${page.width} ${page.height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path ref={glow} className="glow" d={start} />
      <path ref={line} className="line" d={start} />
    </svg>
  );
}
