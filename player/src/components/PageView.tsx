import { getLivePage, isPdfOpen } from '../pdfLifetime';
import { memo, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { Detail } from '../canvasPlan';
import { BLOCK_COLORS, MARKER, STROKE } from '../colors';
import { isCancelled, renderPage } from '../pdf';
import type { PDFDocumentProxy } from '../pdf';
import type { PageBox } from '../layout';
import { BOX_PAD, SPOT_PAD } from '../scene';
import type { PageShapes, PenShape } from '../scene';
import type { BBox, DocBlock, DocEquation, DocFigure, DocPanel, DocSentence } from '../types';
import '../pen.css';

export interface DebugPage {
  blocks: DocBlock[];
  sentences: DocSentence[];
  figures: DocFigure[];
  panels: DocPanel[];
  equations: DocEquation[];
}

interface Props {
  box: PageBox;
  pdf: PDFDocumentProxy | null;
  /** Device pixels per point for the canvas; 0 = not rendered (far from the viewport). */
  scale: number;
  detail: Detail | null;
  shapes?: PageShapes;
  spotlight: boolean;
  debug: DebugPage | null;
}

function roundedRect([x0, y0, x1, y1]: BBox, r: number): string {
  const rr = Math.max(0, Math.min(r, (x1 - x0) / 2, (y1 - y0) / 2));
  return (
    `M${x0 + rr},${y0}H${x1 - rr}A${rr},${rr} 0 0 1 ${x1},${y0 + rr}V${y1 - rr}` +
    `A${rr},${rr} 0 0 1 ${x1 - rr},${y1}H${x0 + rr}A${rr},${rr} 0 0 1 ${x0},${y1 - rr}V${y0 + rr}A${rr},${rr} 0 0 1 ${x0 + rr},${y0}Z`
  );
}

const rectProps = ([x0, y0, x1, y1]: BBox) => ({ x: x0, y: y0, width: x1 - x0, height: y1 - y0 });

const PREVIEW_SCALE = 1;
const BOX_RADIUS = 5;
// Concentric with box corners (holes are padded SPOT_PAD - BOX_PAD more), so a box on the
// spotlit target is never clipped at its corners.
const HOLE_RADIUS = BOX_RADIUS + SPOT_PAD - BOX_PAD;

/** One page: a pdf.js canvas with SVG layers on top that use page points directly via viewBox. */
export const PageView = memo(function PageView({ box, pdf, scale, detail, shapes, spotlight, debug }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);
  const { width: w, height: h } = box;

  // Render into a fresh canvas and swap it in when done, so the old one stays visible meanwhile.
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    if (!pdf || scale <= 0) {
      for (const c of host.querySelectorAll('canvas')) c.width = c.height = 0; // free memory now
      host.replaceChildren();
      return;
    }
    let cancelled = false;
    let job: ReturnType<typeof renderPage> | null = null;
    // A blank page gets a fast low-resolution pass first, then the sharp one.
    const passes = !host.querySelector('canvas') && scale > PREVIEW_SCALE ? [PREVIEW_SCALE, scale] : [scale];
    getLivePage(pdf, box.n)
      .then(async (page) => {
        if (!page) return;
        for (const s of passes) {
          if (cancelled || !isPdfOpen(pdf)) return;
          job = renderPage(page, s);
          const canvas = await job.promise;
          if (cancelled || !isPdfOpen(pdf)) return;
          for (const c of host.querySelectorAll('canvas')) c.width = c.height = 0;
          host.replaceChildren(canvas);
        }
      })
      .catch((err) => {
        if (!cancelled && isPdfOpen(pdf) && !isCancelled(err))
          console.warn(`[pdf] page ${box.n} failed to render`, err);
      });
    return () => {
      cancelled = true;
      job?.cancel();
    };
  }, [pdf, box.n, scale]);

  // The detail canvas: the previous one stays until the new region is ready.
  useEffect(() => {
    const host = detailRef.current;
    if (!host) return;
    const clear = () => {
      for (const c of host.querySelectorAll('canvas')) c.width = c.height = 0;
      host.replaceChildren();
    };
    if (!pdf || !detail) {
      clear();
      return;
    }
    let cancelled = false;
    let job: ReturnType<typeof renderPage> | null = null;
    getLivePage(pdf, box.n)
      .then(async (page) => {
        if (!page || cancelled || !isPdfOpen(pdf)) return;
        job = renderPage(page, detail.scale, detail.rect);
        const canvas = await job.promise;
        if (cancelled || !isPdfOpen(pdf)) return;
        const [x0, y0, x1, y1] = detail.rect;
        Object.assign(canvas.style, { left: `${x0}px`, top: `${y0}px`, width: `${x1 - x0}px`, height: `${y1 - y0}px` });
        clear();
        host.appendChild(canvas);
      })
      .catch((err) => {
        if (!cancelled && isPdfOpen(pdf) && !isCancelled(err))
          console.warn(`[pdf] page ${box.n} detail failed to render`, err);
      });
    return () => {
      cancelled = true;
      job?.cancel();
    };
  }, [pdf, box.n, detail]);

  const viewBox = `0 0 ${w} ${h}`;
  return (
    <div className="page" style={{ left: box.x, top: box.y, width: w, height: h }} data-page={box.n}>
      <div className="page-canvas" ref={hostRef} />
      <div className="page-detail" ref={detailRef} />

      <svg className="layer layer-marker" viewBox={viewBox} preserveAspectRatio="none">
        {shapes?.markers.map((m) => (
          <g key={m.key} fill={MARKER[m.color]}>
            {m.rects.map((r, i) => (
              <rect
                key={i}
                className="hl-rect"
                {...rectProps([r[0] - 1.5, r[1] - 0.5, r[2] + 1.5, r[3] + 0.5])}
                rx={2}
                style={{ animationDelay: `${i * 110}ms` }}
              />
            ))}
          </g>
        ))}
      </svg>

      <svg className="layer layer-fx" viewBox={viewBox} preserveAspectRatio="none">
        {shapes?.underlines.map((m) => (
          <g key={m.key} fill={STROKE[m.color]}>
            {m.rects.map((r, i) => (
              <rect
                key={i}
                className="hl-rect"
                {...rectProps([r[0], r[3] - 0.4, r[2], r[3] + 1.4])}
                rx={0.9}
                style={{ animationDelay: `${i * 110}ms` }}
              />
            ))}
          </g>
        ))}
        {shapes?.boxes.map((b) => (
          <g key={b.key} className="box">
            <path className="box-fill" d={roundedRect(b.rect, BOX_RADIUS)} fill={STROKE[b.color]} />
            <path className="box-stroke" d={roundedRect(b.rect, BOX_RADIUS)} stroke={STROKE[b.color]} pathLength={1} />
          </g>
        ))}
        {/* Drawn last so boxes outside the hole dim like everything else. */}
        {spotlight && (
          <path
            className={shapes?.readingSpotlight ? 'spotlight spotlight-reading' : 'spotlight'}
            fillRule="evenodd"
            d={`M0,0H${w}V${h}H0Z ${(shapes?.holes ?? []).map((r) => roundedRect(r, HOLE_RADIUS)).join(' ')}`}
          />
        )}
      </svg>

      {/* Above the spotlight: an arrow's tail lies outside the target it points at. */}
      {!!shapes?.pens.length && (
        <svg className="layer layer-pen" viewBox={viewBox} preserveAspectRatio="none">
          {shapes.pens.map((p) => (
            <PenMark key={p.key} pen={p} />
          ))}
        </svg>
      )}

      {debug && <DebugLayer viewBox={viewBox} data={debug} />}
    </div>
  );
});

/** One pen stroke, drawn in by its dash; the paper remains visible beneath it. */
function PenMark({ pen }: { pen: PenShape }) {
  const kind = 'pen-stroke';
  const stroke = STROKE[pen.color];
  if (pen.kind === 'circle') return <path className={`${kind} pen-loop`} d={pen.d} stroke={stroke} pathLength={1} />;
  const [x, y] = pen.tip;
  const head = { '--pen-head-fit': pen.head.fit, '--pen-head-max': pen.head.max } as CSSProperties;
  return (
    <g stroke={stroke}>
      <path className={kind} d={pen.d} pathLength={1} />
      <g transform={`translate(${x} ${y}) rotate(${pen.angle})`} style={head}>
        {pen.wings.map((d, i) => (
          <path key={i} className={`${kind} pen-head`} d={d} pathLength={1} />
        ))}
      </g>
    </g>
  );
}

function DebugLayer({ viewBox, data }: { viewBox: string; data: DebugPage }) {
  return (
    <svg className="layer layer-debug" viewBox={viewBox} preserveAspectRatio="none">
      {data.blocks.map((b) => (
        <rect
          key={b.id}
          className="dbg-block"
          data-id={b.id}
          data-kind={`block · ${b.type}`}
          {...rectProps(b.bbox)}
          stroke={BLOCK_COLORS[b.type]}
        />
      ))}
      {data.sentences.map((s) => (
        <g key={s.id} className="dbg-sentence" data-id={s.id} data-kind="sentence">
          {s.rects.map((r, i) => (
            <rect key={i} {...rectProps(r)} />
          ))}
        </g>
      ))}
      {[...data.figures, ...data.panels, ...data.equations].map((el) => {
        const kind = 'kind' in el ? el.kind : el.id.includes('.') ? 'panel' : 'equation';
        return (
          <g key={el.id} className={`dbg-figure dbg-${kind}`} data-id={el.id} data-kind={kind}>
            <rect {...rectProps(el.bbox)} />
            <text x={el.bbox[0] + 2} y={el.bbox[1] + 2} className="dbg-label">
              {el.id}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
