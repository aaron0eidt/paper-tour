import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, RefObject } from 'react';
import { getLivePage, isPdfOpen } from '../pdfLifetime';
import { isCancelled, renderPage } from '../pdf';
import type { PDFDocumentProxy } from '../pdf';
import type { PageSize } from '../resolve';
import './filmstrip.css';

/** Height of a thumbnail on screen, in CSS pixels; the slide is drawn at this size times the device's pixel ratio. */
const THUMB_H = 56;

interface Props {
  pdf: PDFDocumentProxy | null;
  sizes: readonly PageSize[];
  /** The slide showing. */
  slide: number;
  /** The tour's steps on each slide, in tour order; slides the tour does not visit are absent. */
  stepsOn: ReadonlyMap<number, readonly number[]>;
  /** The tour's current step, or null before it starts. */
  step: number | null;
  onPick(slide: number): void;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The deck's slides as thumbnails under the stage, with the tour's steps as dots on the slides it visits. A click goes to
 * that slide (to its first step when the tour has one there). The strip follows the slide showing.
 */
export function Filmstrip({ pdf, sizes, slide, stepsOn, step, onPick }: Props) {
  const track = useRef<HTMLDivElement>(null);
  const first = useRef(true);

  // The slide showing stays in the middle of the strip.
  useEffect(() => {
    const strip = track.current;
    const thumb = strip?.querySelector<HTMLElement>(`[data-slide="${slide}"]`);
    if (!strip || !thumb) return;
    const left = thumb.offsetLeft - (strip.clientWidth - thumb.offsetWidth) / 2;
    strip.scrollTo({ left: Math.max(0, left), behavior: first.current || reducedMotion() ? 'auto' : 'smooth' });
    first.current = false;
  }, [slide, sizes.length]);

  return (
    <nav className="filmstrip" aria-label="Slides">
      <div className="film-track" ref={track}>
        {sizes.map((size, i) => (
          <Thumb
            key={i}
            n={i + 1}
            size={size}
            pdf={pdf}
            track={track}
            current={i + 1 === slide}
            steps={stepsOn.get(i + 1)}
            step={step}
            onPick={onPick}
          />
        ))}
      </div>
    </nav>
  );
}

interface ThumbProps {
  n: number;
  size: PageSize;
  pdf: PDFDocumentProxy | null;
  track: RefObject<HTMLDivElement>;
  current: boolean;
  steps?: readonly number[];
  step: number | null;
  onPick(slide: number): void;
}

const MAX_DOTS = 6;

function Thumb({ n, size, pdf, track, current, steps, step, onPick }: ThumbProps) {
  const button = useRef<HTMLButtonElement>(null);
  const picture = useRef<HTMLSpanElement>(null);
  // Only the thumbnails in or near the strip's view are drawn, so a long deck costs what the strip shows.
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = button.current;
    if (!el || typeof IntersectionObserver === 'undefined') return setNear(true);
    const watch = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), { root: track.current, rootMargin: '0px 360px' });
    watch.observe(el);
    return () => watch.disconnect();
  }, [track]);

  useEffect(() => {
    const slot = picture.current;
    if (!slot) return;
    const clear = () => {
      for (const canvas of slot.querySelectorAll('canvas')) canvas.width = canvas.height = 0;
      slot.replaceChildren();
    };
    if (!pdf || !near) return clear();
    let cancelled = false;
    let job: ReturnType<typeof renderPage> | null = null;
    const scale = Math.min(1, (THUMB_H * (window.devicePixelRatio || 1)) / size.height);
    getLivePage(pdf, n)
      .then(async (page) => {
        if (!page || cancelled || !isPdfOpen(pdf)) return;
        job = renderPage(page, scale);
        const canvas = await job.promise;
        if (cancelled || !isPdfOpen(pdf)) return;
        clear();
        slot.appendChild(canvas);
      })
      .catch((err) => {
        if (!cancelled && isPdfOpen(pdf) && !isCancelled(err)) console.warn(`[pdf] thumbnail ${n} failed to render`, err);
      });
    return () => {
      cancelled = true;
      job?.cancel();
    };
  }, [pdf, near, n, size.height]);
  useEffect(() => () => picture.current?.replaceChildren(), []);

  const dots = steps?.slice(0, MAX_DOTS) ?? [];
  const label = `Slide ${n}${steps?.length ? `, ${steps.length === 1 ? '1 step' : `${steps.length} steps`}` : ''}`;
  return (
    <button
      type="button"
      ref={button}
      className={`film-thumb${current ? ' current' : ''}${steps?.length ? ' visited' : ''}`}
      data-slide={n}
      aria-label={label}
      aria-current={current ? 'true' : undefined}
      tabIndex={current ? 0 : -1}
      style={{ '--ar': size.width / size.height } as CSSProperties}
      onClick={() => onPick(n)}
    >
      <span className="film-picture" ref={picture} />
      <span className="film-number" aria-hidden="true">{n}</span>
      <span className="film-dots" aria-hidden="true">
        {dots.map((index) => (
          <i key={index} className={step === null ? '' : index === step ? 'now' : index < step ? 'done' : ''} />
        ))}
        {steps && steps.length > MAX_DOTS && <em>+</em>}
      </span>
    </button>
  );
}
