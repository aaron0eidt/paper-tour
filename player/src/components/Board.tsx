import { HeatmapBoard } from './HeatmapBoard';
import { ScatterBoard } from './ScatterBoard';
import { ShapesBoard } from './ShapesBoard';
import { PlotBoard } from './Plot';
import { SceneBoard } from './SceneBoard';
// The side board beside the stage: it shows the engine's board item (a formula built term by term,
// a flow of boxes and arrows, or bars of the paper's numbers) and lights the part in focus. The board
// opens alongside camera travel; the reader retargets the remaining flight when the stage resizes.

import katex from 'katex';
import type { TrustContext } from 'katex';
import 'katex/dist/katex.min.css';
import { memo, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { CSSProperties, ReactNode, RefObject } from 'react';
import {
  BAR_THICKNESS,
  BOARD_INK,
  EASE_OUT,
  FLOW_LINE,
  barClip,
  barFrameSource,
  boardFrameColors,
  continuousBoardFrame,
  interpolateBars,
  barPath,
  barsLayout,
  barStandsOut,
  barsUnit,
  betterWay,
  cubicBezier,
  decimalsOf,
  fitText,
  flowGeometry,
  formatValue,
  sourceTag,
  termColor,
  wrapTerms,
} from '../board';
import type { BarsItem, FlowItem } from '../board';
import type { BoardPlayback, BoardState } from '../engine';
import type { BoardItem } from '../types';
import '../board.css';

interface Shown {
  key: string;
  viewKey?: string;
  item: BoardItem;
  continuous?: boolean;
  from?: BarsItem;
  range?: number[];
}

/** What the dock shows: the current item, and the one it replaces while that fades out. */
interface Dock {
  open: boolean;
  current: Shown | null;
  leaving: Shown | null;
}

type DockAction = { type: 'show'; shown: Shown; animate: boolean } | { type: 'close' } | { type: 'closed' } | { type: 'left' };

function dockReducer(dock: Dock, action: DockAction): Dock {
  switch (action.type) {
    case 'show':
      if (dock.current?.key === action.shown.key) return dock.open ? dock : { ...dock, open: true };
      // Related frames keep their colours and rendered objects. Numeric frames
      // also retain their axis instead of returning to zero.
      const shown = { ...action.shown, item: boardFrameColors(dock.current, action.shown) };
      const continuous = action.animate && continuousBoardFrame(dock.current, shown);
      const from = action.animate ? barFrameSource(dock.current, shown) : null;
      const range = from ? [...new Set([...(dock.current?.range ?? from.bars.map(bar => bar.value)),
        ...(shown.item.kind === 'bars' ? shown.item.bars.map(bar => bar.value) : [])])] : undefined;
      const current = { ...shown, continuous, viewKey: continuous ? dock.current?.viewKey ?? dock.current?.key : shown.key, ...(from ? { from, range } : {}) };
      return { open: true, current, leaving: dock.open && !from && !continuous ? dock.current : null };
    case 'close':
      return dock.open ? { ...dock, open: false, leaving: null } : dock;
    case 'closed':
      return dock.open ? dock : { open: false, current: null, leaving: null };
    case 'left':
      return dock.leaving ? { ...dock, leaving: null } : dock;
  }
}

// Match the dock and cross-fade transitions in board.css.
const DOCK_MS = 560;
const SWAP_MS = 280;

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

// KaTeX loads a font only once a formula uses it; ask for the common ones up front, so the first
// formula is measured and fitted in its own fonts rather than refitted when they arrive.
for (const font of ['20px KaTeX_Main', 'italic 20px KaTeX_Math', '20px KaTeX_Size1', '20px KaTeX_Size2']) {
  void document.fonts?.load(font).catch(() => undefined);
}

/**
 * The stage (children) with the board beside it: right of it where the space is wide, below it
 * where it is tall or narrow. Renders only the stage while the engine's board is empty.
 */
export function BoardSplit({ board, playback = { playing: false, progress: 1 }, children }: { board: BoardState; playback?: BoardPlayback; children: ReactNode }) {
  const [dock, dispatch] = useReducer(dockReducer, { open: false, current: null, leaving: null });

  useEffect(() => {
    dispatch(
      board.item && board.key && ['formula', 'flow', 'bars', 'plot', 'scene', 'heatmap', 'scatter', 'shapes'].includes(board.item.kind)
        ? { type: 'show', shown: { key: board.key, item: board.item }, animate: playback.playing }
        : { type: 'close' },
    );
  }, [board.key, board.item]);

  useEffect(() => {
    if (dock.open || !dock.current) return;
    const timer = setTimeout(() => dispatch({ type: 'closed' }), DOCK_MS);
    return () => clearTimeout(timer);
  }, [dock.open, dock.current]);

  useEffect(() => {
    if (!dock.leaving) return;
    const timer = setTimeout(() => dispatch({ type: 'left' }), SWAP_MS);
    return () => clearTimeout(timer);
  }, [dock.leaving]);

  const focus = dock.current && board.key === dock.current.key ? board.focus : null;
  // The split is the container its own shape is queried on (board.css); the frame inside it lays out.
  return (
    <div className="board-split">
      <div className="board-frame">
        {children}
        <div className="board-dock" data-open={dock.open ? '' : undefined}>
          {dock.current && (
            <aside className="board" aria-label="Board" aria-hidden={!dock.open}>
              {dock.leaving && <BoardView key={`leaving:${dock.leaving.viewKey ?? dock.leaving.key}`} item={dock.leaving.item} focus={null} playback={{ playing: false, progress: 1 }} leaving />}
              <BoardView key={dock.current.viewKey ?? dock.current.key} item={dock.current.item} focus={focus} playback={playback} from={dock.current.from} range={dock.current.range} continuous={dock.current.continuous} />
            </aside>
          )}
        </div>
      </div>
    </div>
  );
}

// Memoized: the reader re-renders on every camera frame while the board resizes the stage.
const BoardView = memo(function BoardView({
  item,
  focus,
  leaving,
  playback,
  from,
  range,
  continuous,
}: {
  item: BoardItem;
  focus: number | null;
  leaving?: boolean;
  playback: BoardPlayback;
  from?: BarsItem;
  range?: number[];
  continuous?: boolean;
}) {
  const unit = item.kind === 'bars' ? barsUnit(item) : null;
  const tag = sourceTag(item);
  const bodyRef = useRef<HTMLDivElement>(null);
  useFocusInView(bodyRef, focus);
  return (
    <div className={`board-view${leaving ? ' leaving' : ''}${from || continuous ? ' is-frame-transition' : ''}`} data-kind={item.kind}>
      {(item.title || unit || tag) && (
        <header className="board-head">
          {item.title && <h2 className="board-title">{item.title}</h2>}
          {unit && (
            <span className="board-unit" title={unit.label}>
              {unit.text}
            </span>
          )}
          {tag && (
            <span className="board-unit board-source" title={tag.label}>
              {tag.text}
            </span>
          )}
        </header>
      )}
      <div className="board-body" ref={bodyRef}>
        {item.kind === 'formula' && <FormulaBoard item={item} focus={focus} />}
        {item.kind === 'flow' && <FlowBoard item={item} focus={focus} playing={playback.playing} />}
        {item.kind === 'bars' && <BarsBoard item={item} focus={focus} playback={playback} from={from} range={range} />}
        {item.kind === 'plot' && <PlotBoard item={item} focus={focus} playback={playback} />}
        {item.kind === 'scene' && <SceneBoard item={item} focus={focus} playback={playback} />}
        {item.kind === 'heatmap' && <HeatmapBoard item={item} focus={focus} playback={playback} />}
        {item.kind === 'scatter' && <ScatterBoard item={item} focus={focus} playback={playback} />}
        {item.kind === 'shapes' && <ShapesBoard item={item} focus={focus} playback={playback} />}
      </div>
    </div>
  );
});

// ------------------------------------------------------------------ shared

/**
 * On a board too small for its item (under the stage on a phone), scrolls the body so the parts in
 * focus are in view. Only the body scrolls: scrollIntoView would also move the dock's clipped overflow.
 */
function useFocusInView(ref: RefObject<HTMLElement>, focus: number | null): void {
  useEffect(() => {
    const body = ref.current;
    const parts = body ? [...body.querySelectorAll('.is-focus')].map((el) => el.getBoundingClientRect()) : [];
    if (!body || focus === null || !parts.length) return;
    const view = body.getBoundingClientRect();
    const margin = 16;
    const shift = (start: number, end: number, from: number, to: number) =>
      end > to - margin
        ? Math.min(end - (to - margin), start - (from + margin))
        : start < from + margin
          ? start - (from + margin)
          : 0;
    const top = shift(
      Math.min(...parts.map((r) => r.top)),
      Math.max(...parts.map((r) => r.bottom)),
      view.top,
      view.bottom,
    );
    const left = shift(
      Math.min(...parts.map((r) => r.left)),
      Math.max(...parts.map((r) => r.right)),
      view.left,
      view.right,
    );
    if (top || left) body.scrollBy({ top, left, behavior: reducedMotion() ? 'auto' : 'smooth' });
  }, [ref, focus]);
}

/** The element's content-box size in px, kept up to date; null before the first layout. */
function useBoxSize<T extends HTMLElement>(): [RefObject<T>, { width: number; height: number } | null] {
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
function textMeasure(weight: number, size: number): (text: string) => number {
  measureContext ??= document.createElement('canvas').getContext('2d');
  const family = getComputedStyle(document.documentElement).fontFamily;
  const font = `${weight} ${size}px ${family}`;
  return (text) => {
    if (!measureContext) return text.length * size * 0.56;
    measureContext.font = font;
    return measureContext.measureText(text).width;
  };
}

const ink = (color: string): CSSProperties => ({ '--c': color }) as CSSProperties;
/** A part's place in the build: board.css staggers its entrance by it. */
const order = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;

// ----------------------------------------------------------------- formula

type FormulaItem = Extract<BoardItem, { kind: 'formula' }>;

// Only the board's own term classes are trusted; anything else that needs trust renders inert.
const trustTerms = (context: TrustContext) =>
  context.command === '\\htmlClass' && /^pt-term pt-term-\d+$/.test(context.class);

/** KaTeX HTML for the LaTeX, or null when it does not parse. */
function tex(latex: string, display: boolean, terms = false): string | null {
  try {
    return katex.renderToString(latex, {
      displayMode: display,
      throwOnError: true,
      strict: 'ignore',
      trust: terms && trustTerms,
    });
  } catch {
    return null;
  }
}

interface FormulaModel {
  /** The formula with its terms wrapped, or null when it does not parse (the source is shown instead). */
  html: string | null;
  inks: string[];
  /** Each term rendered on its own for the legend, or null to show its source. */
  symbols: (string | null)[];
}

function formulaModel(item: FormulaItem): FormulaModel {
  const inks = item.terms.map((term, i) => BOARD_INK[termColor(term, i)]);
  const symbols = item.terms.map((term) => tex(term.latex, false));
  if (!tex(item.latex, true)) return { html: null, inks, symbols };
  const wrapped = wrapTerms(item.latex, item.terms, (latex) => tex(latex, true, true) !== null);
  return { html: tex(wrapped.latex, true, true), inks, symbols };
}

// A formula shrinks to fit one line down to ONE_LINE_FIT; past that it breaks after a relation
// or operator (KaTeX's top-level boxes) instead, and only a single box too wide for the board
// shrinks further, down to MIN_FIT, before it scrolls.
const ONE_LINE_FIT = 0.82;
const MIN_FIT = 0.55;

/** Fits the rendered formula to the element's width: --fit scales its font, .is-wrapped lets it break. */
function useFitWidth(ref: RefObject<HTMLElement>, html: string | null): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !html) return;
    let alive = true;
    const measure = () => {
      if (!alive) return;
      // Measure on one line at full size; KaTeX scales with the font size.
      el.classList.remove('is-wrapped');
      el.style.setProperty('--fit', '1');
      // The formula's top-level boxes (.katex-base in KaTeX 0.19, .base before it).
      const boxes = [...el.querySelectorAll('.katex-html > *')].map((b) => b.getBoundingClientRect());
      if (!boxes.length) return;
      const line = Math.max(...boxes.map((r) => r.right)) - Math.min(...boxes.map((r) => r.left));
      const widest = Math.max(...boxes.map((r) => r.width));
      const style = getComputedStyle(el);
      const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      const wrap = line * ONE_LINE_FIT > room && boxes.length > 1;
      el.classList.toggle('is-wrapped', wrap);
      const fit = Math.max(MIN_FIT, Math.min(1, room / (wrap ? widest : line)));
      el.style.setProperty('--fit', fit.toFixed(3));
      width = el.clientWidth;
    };
    let width = -1;
    measure();
    // Refit when the width changes (fitting itself changes only the height).
    const observer = new ResizeObserver(() => el.clientWidth !== width && measure());
    observer.observe(el);
    void document.fonts?.ready.then(measure);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [ref, html]);
}

function FormulaBoard({ item, focus }: { item: FormulaItem; focus: number | null }) {
  const model = useMemo(() => formulaModel(item), [item]);
  const mathRef = useRef<HTMLDivElement>(null);
  const focused = focus !== null && focus < item.terms.length ? focus : null;

  // KaTeX made the term spans: give each its colour and place in the build, and mark the one in
  // focus. Runs before the fit below measures, so the build starts with the right delays.
  useLayoutEffect(() => {
    const root = mathRef.current;
    if (!root) return;
    model.inks.forEach((color, i) => {
      root.querySelectorAll<HTMLElement>(`.pt-term-${i}`).forEach((el) => {
        el.style.setProperty('--c', color);
        el.style.setProperty('--i', String(i));
        el.classList.toggle('is-focus', i === focused);
      });
    });
  }, [model, focused]);
  useFitWidth(mathRef, model.html);

  return (
    <div className={`formula${focused !== null ? ' has-focus' : ''}`}>
      {model.html ? (
        <div className="formula-math" ref={mathRef} dangerouslySetInnerHTML={{ __html: model.html }} />
      ) : (
        <div className="formula-math formula-source" ref={mathRef}>
          <code>{item.latex}</code>
        </div>
      )}
      {item.terms.length > 0 && (
        <ul className="formula-legend">
          {item.terms.map((term, i) => (
            <li key={i} style={{ ...ink(model.inks[i]), ...order(i) }}>
              <div className={`formula-row${i === focused ? ' is-focus' : ''}`}>
                {model.symbols[i] ? (
                  <span className="formula-symbol" dangerouslySetInnerHTML={{ __html: model.symbols[i]! }} />
                ) : (
                  <code className="formula-symbol">{term.latex}</code>
                )}
                <span className="formula-label">{term.label}</span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// -------------------------------------------------------------------- flow

const ACCENT = 'var(--accent)';

function FlowBoard({ item, focus, playing }: { item: FlowItem; focus: number | null; playing: boolean }) {
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const geometry = useMemo(() => (box ? flowGeometry(item, box, textMeasure(500, 13)) : null), [item, box]);
  const focused = focus !== null && focus < item.nodes.length ? focus : null;
  const inks = item.nodes.map((n) => (n.color ? BOARD_INK[n.color] : ACCENT));
  const label = `Flow: ${item.edges.map(([a, b]) => `${nodeLabel(item, a)} to ${nodeLabel(item, b)}`).join(', ')}`;

  return (
    <div className={`flow${focused !== null ? ' has-focus' : ''}`} ref={boxRef}>
      {geometry && (
        <svg
          className="flow-svg"
          viewBox={`0 0 ${geometry.width} ${geometry.height}`}
          width={geometry.width * geometry.scale}
          height={geometry.height * geometry.scale}
          role="img"
          aria-label={label}
          style={focused !== null ? ink(inks[focused]) : undefined}
        >
          {geometry.edges.map((edge, i) => (
            <g
              key={`${item.nodes[edge.from].id}:${item.nodes[edge.to].id}:${i}`}
              className={`flow-edge${focused !== null && (edge.from === focused || edge.to === focused) ? ' is-lit' : ''}`}
              style={order(Math.max(edge.from, edge.to))}
            >
              <path className="flow-edge-line" d={edge.d} pathLength={1} />
              <path className="flow-edge-head" d={edge.head} />
              {edge.to === focused && <path key={`trace-${focused}`} className="flow-edge-trace" d={edge.d} pathLength={1} style={{ animationPlayState: playing ? 'running' : 'paused' }} />}
            </g>
          ))}
          {geometry.nodes.map((node, i) => (
            <g
              key={item.nodes[i].id}
              className={`flow-node${item.nodes[i].color ? ' has-color' : ''}${i === focused ? ' is-focus' : ''}`}
              style={{ ...ink(inks[i]), ...order(i) }}
            >
              <g className="flow-node-state">
                <rect
                  className="flow-ring"
                  x={node.x - 4}
                  y={node.y - 4}
                  width={node.w + 8}
                  height={node.h + 8}
                  rx={13}
                />
                <rect className="flow-box" x={node.x} y={node.y} width={node.w} height={node.h} rx={9} />
                <text className="flow-label" textAnchor="middle" dominantBaseline="central">
                  {node.lines.map((line, j) => (
                    <tspan
                      key={j}
                      x={node.x + node.w / 2}
                      y={node.y + node.h / 2 + (j - (node.lines.length - 1) / 2) * FLOW_LINE}
                    >
                      {line}
                    </tspan>
                  ))}
                </text>
              </g>
            </g>
          ))}
        </svg>
      )}
    </div>
  );
}

const nodeLabel = (item: FlowItem, id: string) => item.nodes.find((n) => n.id === id)?.label ?? id;

// -------------------------------------------------------------------- bars

// Bars grow one after another from the zero line, with the board's ease-out (EASE_OUT).
const BAR_FIRST_MS = 320;
const BAR_EVERY_MS = 110;
const BAR_GROW_MS = 1100;
const easeOut = cubicBezier(...EASE_OUT);

/** Milliseconds since the bars started growing, ticking until they are done; the end at once under reduced motion. */
function useBarClock(count: number, playback: BoardPlayback, changing: boolean): number {
  const { playing } = playback;
  const complete = !playing && playback.progress >= 1;
  const end = changing ? 650 : BAR_FIRST_MS + (count - 1) * BAR_EVERY_MS + BAR_GROW_MS;
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

function BarsBoard({ item, focus, playback, from, range }: { item: BarsItem; focus: number | null; playback: BoardPlayback; from?: BarsItem; range?: number[] }) {
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const elapsed = useBarClock(item.bars.length, playback, !!from);
  const transition = from ? easeOut(Math.min(1, elapsed / 650)) : 1;
  const displayed = useMemo(() => from ? interpolateBars(from, item, transition) : item, [from, item, transition]);
  const focused = focus !== null && focus < item.bars.length ? focus : null;
  const places = useMemo(() => item.bars.map((b) => decimalsOf(b.value)), [item]);
  const values = useMemo(() => item.bars.map((b, i) => formatValue(b.value, places[i], item.unit)), [item, places]);
  const measured = useMemo(() => {
    const label = textMeasure(450, 12.5);
    const value = textMeasure(600, 13);
    return { label, value, widths: values.map((v, i) => Math.max(value(v), from ? value(formatValue(from.bars[i].value, decimalsOf(from.bars[i].value), item.unit)) : 0)) };
  }, [values, from, item.unit]);
  const layout = useMemo(() => {
    if (!box) return null;
    const labelWidths = item.bars.map((b) => measured.label(b.label));
    return barsLayout(displayed, box.width, labelWidths, measured.widths, box.height, range);
  }, [item, displayed, range, box, measured]);
  // One colour for the series; the bar the narration is on stands out in the accent.
  const fill = (i: number) => {
    const own = item.bars[i].color;
    if (own) return BOARD_INK[own];
    return barStandsOut(focused, i) ? ACCENT : 'var(--board-bar)';
  };
  const direction = betterWay(item);
  const label = item.bars
    .map((b, i) => `${b.label}: ${values[i]}${item.unit && item.unit !== '%' ? ` ${item.unit}` : ''}`)
    .concat(direction ? [direction] : [])
    .join(', ');

  return (
    <div className={`bars${focused !== null ? ' has-focus' : ''}`} ref={boxRef}>
      {layout && (
        <svg className="bars-svg" width={layout.width} height={layout.height} role="img" aria-label={label}>
          <line
            className="bars-zero"
            x1={layout.zeroX}
            x2={layout.zeroX}
            y1={layout.rows[0].y - 4}
            y2={layout.height}
          />
          {layout.rows.map((row, i) => {
            const positive = displayed.bars[i].value >= 0;
            const progress = from ? 1 : easeOut(
              Math.max(0, Math.min(1, (elapsed - BAR_FIRST_MS - i * BAR_EVERY_MS) / BAR_GROW_MS)),
            );
            const length = row.x1 - row.x0;
            const ride = (positive ? -1 : 1) * length * (1 - progress);
            const digits = from && transition < 1 ? Math.max(places[i], decimalsOf(from.bars[i].value)) : places[i];
            const text = formatValue(displayed.bars[i].value * progress, digits, item.unit);
            return (
              <g key={i} className={`bar${i === focused ? ' is-focus' : ''}`} style={ink(fill(i))}>
                <g className="bar-state">
                  <text className="bar-label" x={0} y={row.labelY} dominantBaseline="central">
                    {fitText(item.bars[i].label, layout.labelsAbove ? layout.width : row.x0, measured.label)}
                  </text>
                  <path
                    className="bar-fill"
                    d={barPath(row.x0, row.x1, row.y, positive)}
                    style={{ clipPath: barClip(progress, positive) }}
                  />
                  <g
                    className="bar-value"
                    transform={`translate(${ride.toFixed(2)} 0)`}
                    opacity={Math.min(1, progress * 4)}
                  >
                    <text
                      x={row.valueX}
                      y={row.y + BAR_THICKNESS / 2}
                      textAnchor={row.valueAnchor}
                      dominantBaseline="central"
                    >
                      {text}
                    </text>
                  </g>
                </g>
              </g>
            );
          })}
        </svg>
      )}
    </div>
  );
}
