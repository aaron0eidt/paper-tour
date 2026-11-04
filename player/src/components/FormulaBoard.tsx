// The formula board: the line being written, built term by term with its legend, under the earlier lines of the same
// worked solution (kept small and still, like the working on a tutor's whiteboard). Lines are typeset by KaTeX, with
// mhchem for chemistry (../tex); everything is drawn from the item alone, so any step can be shown on its own.

import { useLayoutEffect, useMemo, useRef } from 'react';
import type { CSSProperties, RefObject } from 'react';
import type { TrustContext } from 'katex';
import katex from '../tex';
import { BOARD_INK, termColor, workingLines, wrapTerms } from '../board';
import type { FormulaItem } from '../board';
import type { FormulaLine } from '../types';

const ink = (color: string): CSSProperties => ({ '--c': color }) as CSSProperties;
/** A part's place in the build: board.css staggers its entrance by it. */
const order = (i: number): CSSProperties => ({ '--i': i }) as CSSProperties;

// Only the board's own term classes are trusted; anything else that needs trust renders inert.
const trustTerms = (context: TrustContext) =>
  context.command === '\\htmlClass' && /^pt-term pt-term-\d+$/.test(context.class);

/** KaTeX HTML for the LaTeX, or null when it does not parse. */
export function tex(latex: string, display: boolean, terms = false): string | null {
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

export interface FormulaModel {
  /** The formula with its terms wrapped, or null when it does not parse (the source is shown instead). */
  html: string | null;
  inks: string[];
  /** Each term rendered on its own for the legend, or null to show its source. */
  symbols: (string | null)[];
}

export function formulaModel(item: FormulaItem): FormulaModel {
  const inks = item.terms.map((term, i) => BOARD_INK[termColor(term, i)]);
  const symbols = item.terms.map((term) => tex(term.latex, false));
  if (!tex(item.latex, true)) return { html: null, inks, symbols };
  const wrapped = wrapTerms(item.latex, item.terms, (latex) => tex(latex, true, true) !== null);
  return { html: tex(wrapped.latex, true, true), inks, symbols };
}

/** An earlier line of the working as the board draws it: no term colours, no legend. */
export interface WorkingModel extends FormulaLine {
  /** The line typeset, or null when it does not parse (the source is shown instead). */
  html: string | null;
}

export function workingModel(item: FormulaItem): WorkingModel[] {
  return workingLines(item).map((line) => ({ ...line, html: tex(line.latex, true) }));
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
      // A line hidden to make room has no width to fit to; it keeps its fit until it is shown again.
      if (!alive || !el.clientWidth) return;
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

/**
 * Keeps the current line and its legend whole on a board short of height: the oldest earlier lines are hidden, one at a
 * time, until the formula fits the body. The body scrolls only when the current line and its legend alone are too tall.
 */
function useWorkingRoom(ref: RefObject<HTMLElement>, lines: readonly unknown[]): void {
  useLayoutEffect(() => {
    const root = ref.current;
    const body = root?.parentElement;
    const working = root?.querySelector<HTMLElement>('.formula-working');
    if (!root || !body || !working) return;
    const rows = [...working.children] as HTMLElement[];
    const show = (hidden: number) => {
      rows.forEach((row, i) => (row.hidden = i < hidden));
      working.hidden = hidden >= rows.length;
    };
    let alive = true;
    const arrange = () => {
      if (!alive) return;
      let hidden = 0;
      show(hidden);
      while (hidden < rows.length && root.offsetHeight > body.clientHeight + 1) show(++hidden);
    };
    arrange();
    // The lines refit when fonts arrive or the board resizes, which changes how much room they take.
    const observer = new ResizeObserver(arrange);
    observer.observe(root);
    observer.observe(body);
    void document.fonts?.ready.then(arrange);
    return () => {
      alive = false;
      observer.disconnect();
    };
  }, [ref, lines]);
}

/** The mark of a line code checked. */
function Check() {
  return (
    <span className="formula-check" role="img" aria-label="checked" title="checked">
      ✓
    </span>
  );
}

function WorkingLine({ line }: { line: WorkingModel }) {
  const mathRef = useRef<HTMLDivElement>(null);
  useFitWidth(mathRef, line.html);
  return (
    <li className="formula-line">
      {line.html ? (
        <div className="formula-math" ref={mathRef} dangerouslySetInnerHTML={{ __html: line.html }} />
      ) : (
        <div className="formula-math formula-source" ref={mathRef}>
          <code>{line.latex}</code>
        </div>
      )}
      {(line.title || line.verified) && (
        <div className="formula-line-side">
          {line.title && <span className="formula-line-note">{line.title}</span>}
          {line.verified && <Check />}
        </div>
      )}
    </li>
  );
}

export function FormulaBoard({ item, focus }: { item: FormulaItem; focus: number | null }) {
  const model = useMemo(() => formulaModel(item), [item]);
  const working = useMemo(() => workingModel(item), [item]);
  const rootRef = useRef<HTMLDivElement>(null);
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
  // Last, so the lines above have fitted themselves before the room is measured.
  useWorkingRoom(rootRef, working);

  return (
    <div className={`formula${focused !== null ? ' has-focus' : ''}`} ref={rootRef}>
      {working.length > 0 && (
        <ol className="formula-working" aria-label="Earlier lines of the working">
          {working.map((line, i) => (
            <WorkingLine key={`${i}:${line.latex}`} line={line} />
          ))}
        </ol>
      )}
      <div className="formula-current">
        <div className={`formula-now${item.verified ? ' is-checked' : ''}`}>
          {model.html ? (
            <div className="formula-math" ref={mathRef} dangerouslySetInnerHTML={{ __html: model.html }} />
          ) : (
            <div className="formula-math formula-source" ref={mathRef}>
              <code>{item.latex}</code>
            </div>
          )}
          {item.verified && <Check />}
        </div>
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
    </div>
  );
}
