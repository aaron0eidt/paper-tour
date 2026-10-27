// The side board: checks that a board item can be drawn, and lays out flows. Rendering is in
// components/Board.tsx.

import type { BoardItem, Color, FormulaTerm } from './types';

const COLORS: readonly string[] = ['yellow', 'blue', 'green', 'pink', 'orange'];
/** Term colours in order, when the tour does not choose one: distinct and readable on the dark board. */
export const BOARD_PALETTE: Color[] = ['blue', 'orange', 'green', 'pink', 'yellow'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const color = (c: unknown) => (COLORS.includes(c as string) ? { color: c as Color } : {});
const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null);

/** A board item with its unusable parts dropped, or null (with a warning) when nothing drawable is left. */
export function checkBoardItem(raw: unknown, where: string, warn: (message: string) => void): BoardItem | null {
  const fail = (why: string) => {
    warn(`The board item in ${where} ${why}; skipped.`);
    return null;
  };
  if (!isObj(raw)) return fail('is missing');
  const title = text(raw.title) ? { title: raw.title as string } : {};
  const list = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
  switch (raw.kind) {
    case 'formula': {
      const latex = text(raw.latex);
      if (!latex) return fail('has no formula');
      // A term must be part of the formula, so it can be coloured where it appears.
      const terms: FormulaTerm[] = list(raw.terms)
        .filter((t) => text(t.latex) && typeof t.label === 'string' && latex.includes(t.latex as string))
        .map((t) => ({ latex: t.latex as string, label: t.label as string, ...color(t.color) }));
      return { kind: 'formula', ...title, latex, terms };
    }
    case 'flow': {
      const nodes = list(raw.nodes)
        .filter((n) => text(n.id) && text(n.label))
        .map((n) => ({ id: n.id as string, label: n.label as string, ...color(n.color) }));
      if (nodes.length < 2) return fail('needs at least two boxes');
      const ids = new Set(nodes.map((n) => n.id));
      const edges = (Array.isArray(raw.edges) ? raw.edges : []).filter(
        (e): e is [string, string] => Array.isArray(e) && e.length === 2 && ids.has(e[0]) && ids.has(e[1]) && e[0] !== e[1],
      );
      return { kind: 'flow', ...title, nodes, edges };
    }
    case 'bars': {
      const bars = list(raw.bars)
        .filter((b) => text(b.label) && typeof b.value === 'number' && Number.isFinite(b.value))
        .map((b) => ({ label: b.label as string, value: b.value as number, ...color(b.color) }));
      if (bars.length < 2) return fail('needs at least two bars');
      return {
        kind: 'bars',
        ...title,
        ...(text(raw.unit) ? { unit: raw.unit as string } : {}),
        ...(typeof raw.higher_is_better === 'boolean' ? { higher_is_better: raw.higher_is_better } : {}),
        bars,
      };
    }
    default:
      return fail(`has an unknown kind ${JSON.stringify(raw.kind)}`);
  }
}

/**
 * Columns for a flow: each node goes one column right of its furthest predecessor (cycles are cut),
 * and nodes keep their listed order inside a column. Returns [column, row] per node index.
 */
export function flowLayout(item: Extract<BoardItem, { kind: 'flow' }>): [number, number][] {
  const index = new Map(item.nodes.map((n, i) => [n.id, i]));
  const column = item.nodes.map(() => 0);
  for (let pass = 0; pass < item.nodes.length; pass++) {
    let changed = false;
    for (const [from, to] of item.edges) {
      const a = index.get(from)!,
        b = index.get(to)!;
      if (a < b && column[b] < column[a] + 1) {
        column[b] = column[a] + 1;
        changed = true;
      }
    }
    if (!changed) break;
  }
  const rows = new Map<number, number>();
  return column.map((c) => {
    const r = rows.get(c) ?? 0;
    rows.set(c, r + 1);
    return [c, r];
  });
}
