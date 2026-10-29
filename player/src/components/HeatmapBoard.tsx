// The heatmap board: a grid of values with labelled rows and columns, or the same values as curves between two rows
// of tokens. Rows fade in one after another; a normalized grid then turns its scores into weights. The build runs
// on the board's clock, so it pauses with the narration, and it is complete at once when seeking or under reduced
// motion.

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { heatmapMasked } from '../../../shared/heatmap';
import type { HeatmapItem } from '../../../shared/heatmap';
import { BOARD_INK } from '../board';
import type { Measure } from '../board';
import type { BoardPlayback } from '../engine';
import {
  LABEL_LINE,
  cellLook,
  gridLayout,
  heatmapAlt,
  heatmapEnd,
  heatmapLegend,
  heatmapModel,
  heatmapRamp,
  heatmapTexts,
  linkLook,
  linksLayout,
  morphProgress,
  rowMorph,
  rowShown,
} from '../heatmap';
import type { GridLayout, HeatmapModel, LabelBlock, LinksLayout } from '../heatmap';
import '../heatmap.css';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Room under the drawing, so the last row never sits in the body's fading edge. */
const BOTTOM_ROOM = 12;
/** A curve this faint is not drawn. */
const FAINT = 0.015;

/** The element's content-box size in px, kept up to date; null before the first layout. */
function useBox<T extends HTMLElement>(): [RefObject<T>, { width: number; height: number } | null] {
  const ref = useRef<T>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () =>
      setSize((prev) =>
        prev && prev.width === el.clientWidth && prev.height === el.clientHeight
          ? prev
          : { width: el.clientWidth, height: el.clientHeight },
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

let measureContext: CanvasRenderingContext2D | null | undefined;

/** Measures text in the player's font at the given weight and size, the way the SVG draws it. */
function textMeasure(weight: number, size: number): Measure {
  measureContext ??= document.createElement('canvas').getContext('2d');
  const family = getComputedStyle(document.documentElement).fontFamily;
  const font = `${weight} ${size}px ${family}`;
  return (text) => {
    if (!measureContext) return text.length * size * 0.56;
    measureContext.font = font;
    return measureContext.measureText(text).width;
  };
}

/** Milliseconds into the build, ticking until it is done; it holds while the narration is paused. */
function useClock(end: number, playback: BoardPlayback): number {
  const { playing } = playback;
  const complete = !playing && playback.progress >= 1;
  const [elapsed, setElapsed] = useState(() => (reducedMotion() || !playing ? end : 0));
  const current = useRef(elapsed);
  useEffect(() => {
    if (reducedMotion() || complete) {
      current.current = end;
      setElapsed(end);
      return;
    }
    if (!playing || current.current >= end) return;
    const start = performance.now() - current.current;
    let frame = requestAnimationFrame(function tick(now) {
      const t = Math.min(end, now - start);
      current.current = t;
      setElapsed(t);
      if (t < end) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [end, playing, complete]);
  return elapsed;
}

export function HeatmapBoard({
  item,
  focus,
  playback,
}: {
  item: HeatmapItem;
  focus: number | null;
  playback: BoardPlayback;
}) {
  const [boxRef, box] = useBox<HTMLDivElement>();
  const [footRef, foot] = useBox<HTMLDivElement>();
  const hatch = useId();
  const rows = item.rows.length;
  const links = item.view === 'links';
  const elapsed = useClock(heatmapEnd(rows, !!item.normalize), playback);
  const model = useMemo(() => heatmapModel(item), [item]);
  const label = useMemo(() => heatmapAlt(item), [item]);
  const measures = useMemo(() => ({ label: textMeasure(450, 12), value: textMeasure(600, 11) }), []);
  const valueWidth = useMemo(
    () => Math.max(...heatmapTexts(model).map((text) => measures.value(text))),
    [model, measures],
  );
  const [width, height] = [box?.width, box && foot ? box.height - foot.height - BOTTOM_ROOM : undefined];
  const grid = useMemo(
    () =>
      !links && width !== undefined && height !== undefined
        ? gridLayout(item, { width, height: Math.max(0, height) }, measures.label, valueWidth)
        : null,
    [item, links, width, height, measures, valueWidth],
  );
  const curves = useMemo(
    () =>
      links && width !== undefined && height !== undefined
        ? linksLayout(item, { width, height: Math.max(0, height) }, measures.label, valueWidth)
        : null,
    [item, links, width, height, measures, valueWidth],
  );
  const focused = focus !== null && focus < rows ? focus : null;

  // While the scores turn into weights the legend and the caption fade out, change, and fade back in.
  const morph = item.normalize ? morphProgress(elapsed, rows) : 0;
  const dip = item.normalize ? Math.abs(2 * morph - 1) : 1;
  const late = morph >= 0.5;
  const legend = heatmapLegend(
    late && model.weights ? model.weights : model.raw,
    late && model.weights ? undefined : item.unit,
  );
  const caption = item.normalize
    ? late
      ? 'After softmax: each row sums to one'
      : 'Raw scores'
    : links
      ? 'Thicker curves mean larger values'
      : null;
  const intro = rowShown(elapsed, 0);

  return (
    <div
      className={`heatmap${focused !== null ? ' has-focus' : ''}`}
      ref={boxRef}
      data-paused={!playback.playing && playback.progress < 1 ? '' : undefined}
    >
      {grid && (
        <Grid item={item} model={model} layout={grid} elapsed={elapsed} focused={focused} hatch={hatch} label={label} />
      )}
      {curves && <Links item={item} model={model} layout={curves} elapsed={elapsed} focused={focused} label={label} />}
      <div className="hm-foot" ref={footRef} style={{ opacity: intro }}>
        {!links && (
          <div className="hm-legend" style={{ opacity: dip }} aria-hidden>
            <span>{legend.low}</span>
            <i
              className="hm-ramp"
              style={{ background: heatmapRamp(late && model.weights ? false : item.scale === 'diverging') }}
            />
            <span>{legend.high}</span>
          </div>
        )}
        {!links && item.mask && (
          <span className="hm-key">
            <i className="hm-hatch-swatch" />
            masked
          </span>
        )}
        {caption && (
          <p className="hm-caption" style={{ opacity: dip }}>
            {caption}
          </p>
        )}
      </div>
    </div>
  );
}

interface DrawProps {
  item: HeatmapItem;
  model: HeatmapModel;
  elapsed: number;
  focused: number | null;
  label: string;
}

/** A column or token label: on one line, wrapped, or turned to read upward. `up` puts it above `edge`, else below. */
function Label({
  block,
  index,
  x,
  edge,
  up,
}: {
  block: LabelBlock;
  index: number;
  x: number;
  edge: number;
  up: boolean;
}) {
  const lines = block.lines[index];
  if (block.mode === 'rotated')
    return (
      <text
        className="hm-label"
        x={x}
        y={edge}
        transform={`rotate(-90 ${x} ${edge})`}
        textAnchor={up ? 'start' : 'end'}
        dominantBaseline="central"
      >
        {lines[0]}
      </text>
    );
  return (
    <text className="hm-label" textAnchor="middle" dominantBaseline="central">
      {lines.map((line, k) => (
        <tspan
          key={k}
          x={x}
          y={up ? edge - (lines.length - 1 - k) * LABEL_LINE - LABEL_LINE / 2 : edge + k * LABEL_LINE + LABEL_LINE / 2}
        >
          {line}
        </tspan>
      ))}
    </text>
  );
}

// -------------------------------------------------------------------- grid

function Grid({
  item,
  model,
  layout,
  elapsed,
  focused,
  hatch,
  label,
}: DrawProps & { layout: GridLayout; hatch: string }) {
  const { cw, ch, gap, x0, y0 } = layout;
  const rows = item.rows.length;
  const across = item.cols.length * (cw + gap) - gap;
  const x = (c: number) => x0 + c * (cw + gap);
  const y = (r: number) => y0 + r * (ch + gap);
  return (
    <svg className="hm-svg" width={layout.width} height={layout.height} role="img" aria-label={label}>
      {item.mask && (
        <defs>
          <pattern id={hatch} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line className="hm-hatch-line" x1={0} y1={0} x2={0} y2={6} />
          </pattern>
        </defs>
      )}
      <g opacity={rowShown(elapsed, 0)}>
        {item.cols.map((_, c) => (
          <Label key={c} block={layout.cols} index={c} x={x(c) + cw / 2} edge={y0 - 6} up />
        ))}
      </g>
      {item.rows.map((row, r) => {
        const shown = rowShown(elapsed, r);
        const morph = item.normalize ? rowMorph(elapsed, r, rows) : 0;
        return (
          <g key={r} className={`hm-row${r === focused ? ' is-focus' : ''}`}>
            <g opacity={shown} transform={`translate(0 ${((1 - shown) * 5).toFixed(2)})`}>
              <text
                className="hm-label hm-row-label"
                x={layout.labelX}
                y={y(r) + ch / 2}
                textAnchor="end"
                dominantBaseline="central"
              >
                {layout.rowLabels[r]}
              </text>
              {item.cols.map((col, c) => {
                if (heatmapMasked(item.mask, r, c))
                  return (
                    <rect
                      key={c}
                      className="hm-masked"
                      x={x(c)}
                      y={y(r)}
                      width={cw}
                      height={ch}
                      rx={3}
                      fill={`url(#${hatch})`}
                    />
                  );
                const look = cellLook(model, r, c, morph);
                const [cx, cy] = [x(c) + cw / 2, y(r) + ch / 2];
                return (
                  <g key={c}>
                    <rect x={x(c)} y={y(r)} width={cw} height={ch} rx={3} fill={look.fill}>
                      <title>{`${row}, ${col}: ${morph < 0.5 ? look.rawText : look.weightText}`}</title>
                    </rect>
                    {layout.values && look.rawOpacity > 0 && (
                      <text
                        className="hm-value"
                        x={cx}
                        y={cy}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={look.ink}
                        opacity={look.rawOpacity}
                      >
                        {look.rawText}
                      </text>
                    )}
                    {layout.values && look.weightOpacity > 0 && (
                      <text
                        className="hm-value"
                        x={cx}
                        y={cy}
                        textAnchor="middle"
                        dominantBaseline="central"
                        fill={look.ink}
                        opacity={look.weightOpacity}
                      >
                        {look.weightText}
                      </text>
                    )}
                  </g>
                );
              })}
              {layout.sumX !== null && morph > 0 && (
                <text className="hm-sum" x={layout.sumX} y={y(r) + ch / 2} dominantBaseline="central" opacity={morph}>
                  Σ 1
                </text>
              )}
            </g>
          </g>
        );
      })}
      {/* Over every row, so the next row's cells never cut into the edge. */}
      {item.rows.map((_, r) => (
        <rect
          key={r}
          className={`hm-ring${r === focused ? ' is-on' : ''}`}
          x={x0 - 4}
          y={y(r) - 3}
          width={across + 8}
          height={ch + 6}
          rx={6}
        />
      ))}
    </svg>
  );
}

// ------------------------------------------------------------------- links

function Links({ item, model, layout, elapsed, focused, label }: DrawProps & { layout: LinksLayout }) {
  const rows = item.rows.length;
  const morphOf = (r: number) => (item.normalize ? rowMorph(elapsed, r, rows) : 0);
  return (
    <svg className="hm-svg" width={layout.width} height={layout.height} role="img" aria-label={label}>
      {item.rows.map((_, r) => {
        const morph = morphOf(r);
        // The strongest curve last, so it lies over the faint ones.
        const lit = r === focused;
        const looks = item.cols
          .map((_, c) => ({ c, d: layout.curves[r][c], ...linkLook(model, r, c, morph) }))
          .filter((curve) => curve.d && curve.strength > FAINT)
          .sort((a, b) => a.strength - b.strength);
        return (
          <g key={r} className={`hm-links${lit ? ' is-focus' : ''}`}>
            <g opacity={rowShown(elapsed, r)}>
              {looks.map((curve) => (
                <path
                  key={curve.c}
                  className="hm-link"
                  d={curve.d}
                  pathLength={1}
                  strokeWidth={((lit ? 1 : 0.6) + curve.strength * layout.maxStroke).toFixed(2)}
                  strokeOpacity={(lit ? 0.3 + 0.7 * curve.strength : 0.12 + 0.88 * curve.strength).toFixed(2)}
                  style={curve.negative ? { stroke: BOARD_INK.orange } : undefined}
                />
              ))}
            </g>
          </g>
        );
      })}
      <g opacity={rowShown(elapsed, 0)}>
        {item.cols.map((_, c) => (
          <g key={c} className="hm-token">
            <circle className="hm-dot" cx={layout.topX[c]} cy={layout.topY} r={3} />
            <Label block={layout.top} index={c} x={layout.topX[c]} edge={layout.topEdge} up />
          </g>
        ))}
      </g>
      {item.rows.map((_, r) => (
        <g key={r} className={`hm-token${r === focused ? ' is-focus' : ''}`}>
          <g opacity={rowShown(elapsed, r)}>
            <circle className="hm-dot" cx={layout.bottomX[r]} cy={layout.bottomY} r={r === focused ? 4.5 : 3} />
            <Label block={layout.bottom} index={r} x={layout.bottomX[r]} edge={layout.bottomEdge} up={false} />
          </g>
        </g>
      ))}
      {focused !== null && layout.valueY !== null && (
        <g key={focused} className="hm-link-values">
          {item.cols.map((_, c) => {
            if (heatmapMasked(item.mask, focused, c)) return null;
            const morph = morphOf(focused);
            const look = cellLook(model, focused, c, morph);
            const weight = 0.4 + 0.6 * linkLook(model, focused, c, morph).strength;
            const at = {
              x: layout.topX[c],
              y: layout.valueY!,
              textAnchor: 'middle' as const,
              dominantBaseline: 'central' as const,
            };
            return (
              <g key={c}>
                {look.rawOpacity > 0 && (
                  <text className="hm-link-value" {...at} opacity={look.rawOpacity * weight}>
                    {look.rawText}
                  </text>
                )}
                {look.weightOpacity > 0 && (
                  <text className="hm-link-value" {...at} opacity={look.weightOpacity * weight}>
                    {look.weightText}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      )}
    </svg>
  );
}
