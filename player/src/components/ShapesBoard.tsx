// The shapes board: matrices as blocks whose sides follow their dimensions, built left to right with the operators
// between them. A product colours the dimension both operands share and shows it struck out under the result, where it
// is gone. board_focus i lights up matrix i. The clock follows speech (see useBuildClock); layout is in shapes.ts.

import katex from 'katex';
import { useMemo } from 'react';
import type { CSSProperties } from 'react';
import type { ShapesItem, ShapesOpTerm } from '../../../shared/shapes';
import { BOARD_INK, EASE_OUT, cubicBezier } from '../board';
import type { BoardPlayback } from '../engine';
import { ramp } from '../scatter';
import {
  SHAPES_TIME,
  dimensionTex,
  ghostStart,
  lightStart,
  plainTex,
  shapesDescription,
  shapesDuration,
  shapesLayout,
  shapesPlan,
  termArrival,
} from '../shapes';
import type { Contraction } from '../shapes';
import { textMeasure, useBoxSize, useBuildClock, useFontsVersion } from './ScatterBoard';
import '../shapes.css';

const easeOut = cubicBezier(...EASE_OUT);
const BLOCK = 'var(--accent)';
const RESULT = BOARD_INK.green;

/** KaTeX HTML for the LaTeX, or null when it does not parse. */
function tex(latex: string): string | null {
  try {
    return katex.renderToString(latex, { throwOnError: true, strict: 'ignore', trust: false });
  } catch {
    return null;
  }
}

/** A name or dimension in KaTeX, or as plain text when it does not parse (or, for a number, always). */
function Tex({ latex, plain = latex }: { latex: string; plain?: string }) {
  const html = useMemo(() => tex(latex), [latex]);
  return html ? <span className="shapes-tex" dangerouslySetInnerHTML={{ __html: html }} /> : <span>{plain}</span>;
}

function Dim({ dim }: { dim: string }) {
  const latex = dimensionTex(dim);
  return latex ? <Tex latex={latex} plain={dim} /> : <span>{dim}</span>;
}

/** An operator's mark, drawn in strokes so every one has the same weight; apply is an arrow as long as its slot. */
function Operator({ op, width }: { op: ShapesOpTerm['op']; width: number }) {
  const arrow = width - 14;
  return (
    <svg
      width={op === 'apply' ? arrow : 20}
      height={20}
      viewBox={`0 0 ${op === 'apply' ? arrow : 20} 20`}
      aria-hidden="true"
    >
      {op === 'times' && <path d="M6 6l8 8M14 6l-8 8" />}
      {op === 'plus' && <path d="M10 4v12M4 10h12" />}
      {op === 'equals' && <path d="M4 7.5h12M4 12.5h12" />}
      {op === 'hadamard' && (
        <>
          <circle cx={10} cy={10} r={6.2} />
          <circle className="shapes-dot" cx={10} cy={10} r={1.4} />
        </>
      )}
      {op === 'apply' && <path d={`M1 10h${arrow - 2}M${arrow - 7} 5l6 5-6 5`} />}
    </svg>
  );
}

const vars = (values: Record<string, string | number>): CSSProperties => values as CSSProperties;

export function ShapesBoard({
  item,
  focus,
  playback,
}: {
  item: ShapesItem;
  focus: number | null;
  playback: BoardPlayback;
}) {
  const [boxRef, box] = useBoxSize<HTMLDivElement>();
  const plan = useMemo(() => shapesPlan(item), [item]);
  const elapsed = useBuildClock(plan ? shapesDuration(plan) : 0, playback);
  const fontsVersion = useFontsVersion();
  const measure = useMemo(() => textMeasure(500, 13), [fontsVersion]);
  const layout = useMemo(() => (plan && box ? shapesLayout(plan, box.width, measure) : null), [plan, box, measure]);
  const focused = layout && focus !== null && focus < layout.blocks.length ? focus : null;

  // A contracted dimension's colour comes up on both operands once the right one has landed.
  const heat = (matrix: number, side: 'rows' | 'cols') => {
    const c = plan?.contractions.find((k) => (side === 'cols' ? k.left : k.right) === matrix);
    return c ? { color: BOARD_INK[c.color], hot: easeOut(ramp(elapsed, lightStart(c), SHAPES_TIME.light)) } : null;
  };
  const ghosts = (matrix: number): Contraction[] => plan?.contractions.filter((c) => c.result === matrix) ?? [];

  return (
    <div className={`shapes${focused !== null ? ' has-focus' : ''}`} ref={boxRef}>
      {plan && layout && (
        <div
          className="shapes-stage"
          style={{ width: layout.width, height: layout.height }}
          role="img"
          aria-label={shapesDescription(item)}
        >
          {layout.ops.map((op) => (
            <div
              key={op.term}
              className={`shapes-op is-${op.op}`}
              style={{
                left: op.x,
                top: op.cy - 14,
                width: op.w,
                opacity: easeOut(ramp(elapsed, termArrival(op.term), SHAPES_TIME.op)),
              }}
            >
              {op.op === 'apply' && op.label && <span className="shapes-op-label">{op.label}</span>}
              <Operator op={op.op} width={op.w} />
            </div>
          ))}

          {layout.blocks.map((block) => {
            const arrive = easeOut(ramp(elapsed, termArrival(block.term), SHAPES_TIME.grow));
            const dims = ramp(elapsed, termArrival(block.term) + 140, 360);
            return (
              <div
                key={block.matrix}
                className={['shapes-matrix', block.matrix === focused && 'is-focus', block.result && 'is-result']
                  .filter(Boolean)
                  .join(' ')}
                style={{
                  left: block.x,
                  top: block.y,
                  width: block.w,
                  height: block.h,
                  opacity: arrive,
                  transform:
                    arrive < 1
                      ? `translateY(${((1 - arrive) * 8).toFixed(2)}px) scale(${(0.94 + 0.06 * arrive).toFixed(3)})`
                      : undefined,
                  ...vars({ '--c': block.result ? RESULT : BLOCK }),
                }}
              >
                <div className="shapes-body">
                  <div className="shapes-block">
                    {!block.nameBelow && (
                      <span className="shapes-name" style={{ fontSize: block.nameSize }}>
                        <Tex latex={block.name} plain={plainTex(block.name)} />
                      </span>
                    )}
                  </div>
                  {block.nameBelow && (
                    <span className="shapes-name is-below" style={{ fontSize: block.nameSize }}>
                      <Tex latex={block.name} plain={plainTex(block.name)} />
                    </span>
                  )}
                  {(['cols', 'rows'] as const).map((side) => {
                    const hot = heat(block.matrix, side);
                    return (
                      <div
                        key={side}
                        className={`shapes-dim is-${side}`}
                        style={{
                          opacity: dims,
                          ...(hot ? vars({ '--dim': hot.color, '--hot': hot.hot.toFixed(3) }) : {}),
                        }}
                      >
                        <span className="shapes-dim-text">
                          <Dim dim={block[side]} />
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {layout.blocks
            .filter((block) => ghosts(block.matrix).length)
            .map((block) => (
              <div
                key={block.matrix}
                className="shapes-ghosts"
                style={{ left: block.x, top: block.ghostY, width: block.w }}
              >
                {ghosts(block.matrix).map((c) => {
                  const start = ghostStart(c) ?? 0;
                  const shown = easeOut(ramp(elapsed, start, 260));
                  const struck = easeOut(ramp(elapsed, start + 260, SHAPES_TIME.ghost - 260));
                  return (
                    <span
                      key={c.op}
                      className="shapes-ghost"
                      title={`${plainTex(c.dim)} is summed over, so it is not in the result`}
                      style={{
                        opacity: shown * (1 - 0.4 * struck),
                        ...vars({ '--c': BOARD_INK[c.color], '--strike': struck.toFixed(3) }),
                      }}
                    >
                      <Dim dim={c.dim} />
                    </span>
                  );
                })}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
