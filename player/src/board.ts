import { canonicalDistribution, distributionProblems } from '../../shared/distribution';
import { canonicalHeatmap, heatmapProblems } from '../../shared/heatmap';
import { plotProblems, powerOfTen, type PlotItem } from '../../shared/plot';
import { canonicalScatter, scatterProblems } from '../../shared/scatter';
import { sceneProblems } from '../../shared/scene';
import { canonicalShapes, shapesProblems } from '../../shared/shapes';
import { canonicalTimeline, timelineProblems } from '../../shared/timeline';
// The side board: checks that a board item can be drawn, and computes what the board draws (term
// wrapping, flow and bar geometry, easing). Pure, so it can be tested; rendering is in
// components/Board.tsx.

import type { BoardItem, Color, FormulaTerm } from './types';

const COLORS: readonly string[] = ['yellow', 'blue', 'green', 'pink', 'orange'];
/** Term colours in order, when the tour does not choose one: distinct and readable on the dark board. */
export const BOARD_PALETTE: Color[] = ['blue', 'orange', 'green', 'pink', 'yellow'];

/**
 * Ink for each colour on the dark board: lighter steps of the page colours, for glyphs and strokes.
 * Every pair stays apart under protanopia and deuteranopia (OKLab ΔE ≥ 8.9) and for full colour
 * vision (ΔE ≥ 15.9), and each clears 3:1 on the board.
 */
export const BOARD_INK: Record<Color, string> = {
  blue: '#4c95ff',
  orange: '#ff9a4d',
  green: '#36c793',
  pink: '#f497e0',
  yellow: '#ecdc5c',
};

export type FlowItem = Extract<BoardItem, { kind: 'flow' }>;
export type BarsItem = Extract<BoardItem, { kind: 'bars' }>;

/** A formula term's colour: its own, else the palette in order. */
export function termColor(term: FormulaTerm, index: number): Color {
  return term.color ?? BOARD_PALETTE[index % BOARD_PALETTE.length];
}

type BoardFrame = { key: string; item: BoardItem };

function forwardFrame(previous: BoardFrame | null, next: BoardFrame): boolean {
  if (!previous) return false;
  const a = /^(\d+):(\d+)$/.exec(previous.key), b = /^(\d+):(\d+)$/.exec(next.key);
  return !!a && !!b && a[1] === b[1] && Number(a[2]) < Number(b[2]);
}

/** Preserve a quantity's established colour when the next authored frame omits
 * it. Explicit choices win; names never carry colours across unrelated steps. */
export function boardFrameColors(previous: BoardFrame | null, next: BoardFrame): BoardItem {
  if (!forwardFrame(previous, next) || !previous) return next.item;
  const before = previous.item, item = next.item;
  if (before.kind === 'formula' && item.kind === 'formula') {
    return { ...item, terms: item.terms.map(term => {
      const index = before.terms.findIndex(old => term.label.trim() ? old.label === term.label : old.latex === term.latex);
      return term.color || index < 0 ? term : { ...term, color: termColor(before.terms[index], index) };
    }) };
  }
  if (before.kind === 'flow' && item.kind === 'flow') {
    return { ...item, nodes: item.nodes.map(node => {
      const color = before.nodes.find(old => old.id === node.id)?.color;
      return node.color || !color ? node : { ...node, color };
    }) };
  }
  if (before.kind === 'bars' && item.kind === 'bars') {
    return { ...item, bars: item.bars.map(bar => {
      const color = before.bars.find(old => old.label === bar.label)?.color;
      return bar.color || !color ? bar : { ...bar, color };
    }) };
  }
  if (before.kind === 'scene' && item.kind === 'scene') {
    return { ...item, objects: item.objects.map(object => {
      const color = before.objects.find(old => old.id === object.id && old.type === object.type)?.color;
      return object.color || !color ? object : { ...object, color };
    }) };
  }
  return item;
}

/** These frames update the same rendered objects in place. A different process,
 * board kind, or seek gets its own presentation rather than a false morph. */
export function continuousBoardFrame(previous: BoardFrame | null, next: BoardFrame): boolean {
  if (!forwardFrame(previous, next) || !previous) return false;
  const before = previous.item, item = next.item;
  if (before.kind === 'formula' && item.kind === 'formula') {
    return before.latex === item.latex || item.terms.some(term => before.terms.some(old =>
      term.label.trim() ? old.label === term.label : old.latex === term.latex));
  }
  if (before.kind === 'flow' && item.kind === 'flow') {
    return before.nodes.length === item.nodes.length && before.nodes.every((node, i) => node.id === item.nodes[i].id) &&
      JSON.stringify(before.edges) === JSON.stringify(item.edges);
  }
  if (before.kind === 'scene' && item.kind === 'scene') {
    return item.objects.some(object => before.objects.some(old => old.id === object.id && old.type === object.type));
  }
  return false;
}

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
    case 'scene': {
      const problems = sceneProblems(raw);
      return problems.length ? fail(problems.join(' ')) : (raw as unknown as BoardItem);
    }
    case 'plot': {
      const problems = plotProblems(raw);
      return problems.length ? fail(problems.join(' ')) : (raw as unknown as BoardItem);
    }
    // The newer kinds share their checks with the server and keep only what the check keeps (values of a formula
    // computed, unused options dropped).
    case 'heatmap': {
      const problems = heatmapProblems(raw);
      return problems.length ? fail(problems.join(' ')) : canonicalHeatmap(raw);
    }
    case 'scatter': {
      const problems = scatterProblems(raw);
      return problems.length ? fail(problems.join(' ')) : canonicalScatter(raw);
    }
    case 'shapes': {
      const problems = shapesProblems(raw);
      return problems.length ? fail(problems.join(' ')) : canonicalShapes(raw);
    }
    case 'timeline': {
      const problems = timelineProblems(raw);
      return problems.length ? fail(problems.join(' ')) : canonicalTimeline(raw);
    }
    case 'distribution': {
      const problems = distributionProblems(raw);
      return problems.length ? fail(problems.join(' ')) : canonicalDistribution(raw);
    }
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
        (e): e is [string, string] =>
          Array.isArray(e) && e.length === 2 && ids.has(e[0]) && ids.has(e[1]) && e[0] !== e[1],
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
export function flowLayout(item: FlowItem): [number, number][] {
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

// ------------------------------------------------------------------ formula

type Span = [number, number];
const overlaps = (a: Span, b: Span) => a[0] < b[1] && b[0] < a[1];
const contains = (a: Span, b: Span) => a[0] <= b[0] && b[1] <= a[1];
const crosses = (a: Span, b: Span) => overlaps(a, b) && !contains(a, b) && !contains(b, a);
const CONTROL_WORD = /\\[a-zA-Z]+/y;

/** Positions between LaTeX tokens: a control word, a control symbol or one character. */
function tokenBounds(latex: string): boolean[] {
  const bounds = new Array<boolean>(latex.length + 1).fill(false);
  let i = 0;
  while (i < latex.length) {
    bounds[i] = true;
    CONTROL_WORD.lastIndex = i;
    const word = CONTROL_WORD.exec(latex);
    const code = latex.charCodeAt(i);
    if (word) i += word[0].length;
    else if (latex[i] === '\\') i = Math.min(latex.length, i + 2);
    else i += code >= 0xd800 && code <= 0xdbff ? 2 : 1;
  }
  bounds[latex.length] = true;
  return bounds;
}

/** The LaTeX with each span wrapped in \htmlClass{pt-term pt-term-N}{…}; spans nest but never cross. */
function wrapSpans(latex: string, spans: (Span | null)[]): string {
  const marks: { at: number; open: boolean; len: number; term: number }[] = [];
  spans.forEach((s, term) => {
    if (!s) return;
    marks.push({ at: s[0], open: true, len: s[1] - s[0], term }, { at: s[1], open: false, len: s[1] - s[0], term });
  });
  // At one position: closes before opens; inner spans close first and outer spans open first.
  marks.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    if (a.open !== b.open) return a.open ? 1 : -1;
    return a.open ? b.len - a.len || a.term - b.term : a.len - b.len || b.term - a.term;
  });
  let out = '';
  let last = 0;
  for (const m of marks) {
    out += latex.slice(last, m.at) + (m.open ? `\\htmlClass{pt-term pt-term-${m.term}}{` : '}');
    last = m.at;
  }
  return out + latex.slice(last);
}

/**
 * The formula with each term wrapped in \htmlClass{pt-term pt-term-N}{…}, so the board can colour it.
 * A term takes its first occurrence that starts and ends between tokens and is free of the terms
 * placed before it; only when none is free does it nest inside (or around) one. A wrap that does not
 * parse (it splits a group, say) is not used, so a bad term loses only its colour.
 */
export function wrapTerms(
  latex: string,
  terms: FormulaTerm[],
  parses: (latex: string) => boolean,
): { latex: string; placed: boolean[] } {
  const bounds = tokenBounds(latex);
  const spans: (Span | null)[] = [];
  for (const term of terms) {
    const options: Span[] = [];
    for (let at = term.latex ? latex.indexOf(term.latex) : -1; at >= 0; at = latex.indexOf(term.latex, at + 1)) {
      const span: Span = [at, at + term.latex.length];
      if (bounds[span[0]] && bounds[span[1]] && !spans.some((s) => s && crosses(s, span))) options.push(span);
    }
    const taken = (span: Span) => (spans.some((s) => s && overlaps(s, span)) ? 1 : 0);
    options.sort((a, b) => taken(a) - taken(b) || a[0] - b[0]);
    spans.push(options.find((span) => parses(wrapSpans(latex, [...spans, span]))) ?? null);
  }
  return { latex: wrapSpans(latex, spans), placed: spans.map((s) => s !== null) };
}

// --------------------------------------------------------------------- flow

/** Text width in px at the size the board draws it. */
export type Measure = (text: string) => number;

export interface FlowNodeBox {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The label, wrapped to the box. */
  lines: string[];
}

export interface FlowEdgePath {
  from: number;
  to: number;
  /** The curve, ending just short of the target. */
  d: string;
  /** The arrowhead: two short strokes that meet at the end of the curve. */
  head: string;
}

export interface FlowGeometry {
  /** Natural size in px; the board draws it at `scale` (never above 1). */
  width: number;
  height: number;
  scale: number;
  /** Ranks run top to bottom (else left to right). */
  vertical: boolean;
  nodes: FlowNodeBox[];
  edges: FlowEdgePath[];
}

/** Line height of node labels; labels are drawn at 13px. */
export const FLOW_LINE = 17;
const FLOW_PAD = { x: 14, y: 10 };
const FLOW_W = { min: 92, max: 176 };
// Gaps between ranks (room for the arrows): they grow within these limits to use the board.
const FLOW_RANK_GAP = { vertical: [30, 50], horizontal: [38, 64] };
const FLOW_FILL = 0.8;
const FLOW_MIN_SCALE = 0.8;
const FLOW_LANE_GAP = 14;
// Room around the nodes for the focus ring, and beside them for edges that loop back.
const FLOW_MARGIN = 8;
const FLOW_LOOP = 28;
const FLOW_HEAD = 5;
const FLOW_GAP = 3;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const round = (v: number) => Math.round(v * 10) / 10;
const pt = (x: number, y: number) => `${round(x)} ${round(y)}`;

function ellipsize(text: string, width: number, measure: Measure): string {
  let t = text;
  while (t.length > 1 && measure(`${t}…`) > width) t = t.slice(0, -1);
  return `${t.trimEnd()}…`;
}

/** The text, cut with an ellipsis when it is wider than `width` px. */
export function fitText(text: string, width: number, measure: Measure): string {
  return measure(text) <= width ? text : ellipsize(text, width, measure);
}

/** Greedy word wrap to `width` px in at most `max` lines; text that does not fit ends in an ellipsis. */
export function wrapLabel(text: string, width: number, measure: Measure, max = 3): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.trim().split(/\s+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && measure(next) > width) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length > max) lines.splice(max - 1, lines.length, lines.slice(max - 1).join(' '));
  return lines.map((l) => (measure(l) > width ? ellipsize(l, width, measure) : l));
}

/** An arrowhead at `tip` pointing along the unit vector (ux, uy). */
function arrowHead(tipX: number, tipY: number, ux: number, uy: number): string {
  const bx = tipX - ux * FLOW_HEAD;
  const by = tipY - uy * FLOW_HEAD;
  const px = -uy * FLOW_HEAD * 0.8;
  const py = ux * FLOW_HEAD * 0.8;
  return `M${pt(bx + px, by + py)} L${pt(tipX, tipY)} L${pt(bx - px, by - py)}`;
}

/**
 * A forward edge leaves the source's far side for the target's near side; a back edge loops beside
 * both, out past `clear`: the furthest right (or, across the board, the lowest) edge of the boxes
 * in the ranks it passes, so it never runs through one of them.
 */
function edgePath(
  a: FlowNodeBox,
  b: FlowNodeBox,
  vertical: boolean,
  forward: boolean,
  clear = -Infinity,
): Omit<FlowEdgePath, 'from' | 'to'> {
  if (forward && vertical) {
    const [sx, sy, ex, ey] = [a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y - FLOW_GAP];
    const k = Math.max(10, (ey - sy) / 2);
    return { d: `M${pt(sx, sy)} C${pt(sx, sy + k)} ${pt(ex, ey - k)} ${pt(ex, ey)}`, head: arrowHead(ex, ey, 0, 1) };
  }
  if (forward) {
    const [sx, sy, ex, ey] = [a.x + a.w, a.y + a.h / 2, b.x - FLOW_GAP, b.y + b.h / 2];
    const k = Math.max(10, (ex - sx) / 2);
    return { d: `M${pt(sx, sy)} C${pt(sx + k, sy)} ${pt(ex - k, ey)} ${pt(ex, ey)}`, head: arrowHead(ex, ey, 1, 0) };
  }
  // Both handles at one offset C: the curve's furthest point, at its middle, is (s + e) / 8 + 0.75 C,
  // which is set to lie FLOW_LOOP * 0.75 beyond the boxes it passes.
  const handle = (s: number, e: number, edge: number) => (Math.max(s, e, edge) + 0.75 * FLOW_LOOP - (s + e) / 8) / 0.75;
  if (vertical) {
    const [sx, sy, ex, ey] = [a.x + a.w, a.y + a.h / 2, b.x + b.w + FLOW_GAP, b.y + b.h / 2];
    const c = handle(sx, ex, clear);
    return { d: `M${pt(sx, sy)} C${pt(c, sy)} ${pt(c, ey)} ${pt(ex, ey)}`, head: arrowHead(ex, ey, -1, 0) };
  }
  const [sx, sy, ex, ey] = [a.x + a.w / 2, a.y + a.h, b.x + b.w / 2, b.y + b.h + FLOW_GAP];
  const c = handle(sy, ey, clear);
  return { d: `M${pt(sx, sy)} C${pt(sx, c)} ${pt(ex, c)} ${pt(ex, ey)}`, head: arrowHead(ex, ey, 0, -1) };
}

/**
 * An edge between two boxes of one rank (listed against the flow, so flowLayout could not put a
 * rank between them): straight across the gap between their lanes.
 */
function laneEdge(a: FlowNodeBox, b: FlowNodeBox, vertical: boolean): Omit<FlowEdgePath, 'from' | 'to'> {
  if (vertical) {
    const right = b.x > a.x;
    const [sx, ex] = right ? [a.x + a.w, b.x - FLOW_GAP] : [a.x, b.x + b.w + FLOW_GAP];
    const [sy, ey] = [a.y + a.h / 2, b.y + b.h / 2];
    return { d: `M${pt(sx, sy)} L${pt(ex, ey)}`, head: arrowHead(ex, ey, right ? 1 : -1, 0) };
  }
  const down = b.y > a.y;
  const [sx, ex] = [a.x + a.w / 2, b.x + b.w / 2];
  const [sy, ey] = down ? [a.y + a.h, b.y - FLOW_GAP] : [a.y, b.y + b.h + FLOW_GAP];
  return { d: `M${pt(sx, sy)} L${pt(ex, ey)}`, head: arrowHead(ex, ey, 0, down ? 1 : -1) };
}

/** A forward edge running right to left: from the source's left side to the target's right side. */
function leftwardEdge(a: FlowNodeBox, b: FlowNodeBox): Omit<FlowEdgePath, 'from' | 'to'> {
  const [sx, sy, ex, ey] = [a.x, a.y + a.h / 2, b.x + b.w + FLOW_GAP, b.y + b.h / 2];
  const k = Math.max(10, (sx - ex) / 2);
  return { d: `M${pt(sx, sy)} C${pt(sx - k, sy)} ${pt(ex + k, ey)} ${pt(ex, ey)}`, head: arrowHead(ex, ey, -1, 0) };
}

/**
 * Where a flow's boxes and arrows go in a board of `box` px: ranks from flowLayout run along the
 * board's long side, so a tall side panel stacks them and a wide one lines them up. Both ways are
 * laid out and the one that needs less shrinking wins; when both fit, the one shaped like the board.
 * A chain that fits neither way (a short, wide board under the stage) winds into rows instead.
 */
export function flowGeometry(item: FlowItem, box: { width: number; height: number }, measure: Measure): FlowGeometry {
  const place = flowLayout(item);
  const index = new Map(item.nodes.map((n, i) => [n.id, i]));
  const ranks = Math.max(...place.map(([c]) => c)) + 1;
  const inRank = Array.from({ length: ranks }, (_, r) => place.flatMap(([c], i) => (c === r ? [i] : [])));
  const w = clamp(Math.max(...item.nodes.map((n) => measure(n.label))) + 2 * FLOW_PAD.x, FLOW_W.min, FLOW_W.max);
  const lines = item.nodes.map((n) => wrapLabel(n.label, w - 2 * FLOW_PAD.x, measure));
  const heights = lines.map((l) => l.length * FLOW_LINE + 2 * FLOW_PAD.y);
  const forward = item.edges.map(([a, b]) => place[index.get(b)!][0] > place[index.get(a)!][0]);
  // Room beside the boxes for edges that loop back to an earlier rank.
  const loops = item.edges.some(([a, b]) => place[index.get(b)!][0] < place[index.get(a)!][0]) ? FLOW_LOOP : 0;

  const build = (vertical: boolean): FlowGeometry => {
    const nodes: FlowNodeBox[] = new Array(item.nodes.length);
    let width: number;
    let height: number;
    // The gap that spreads the ranks over FLOW_FILL of the board's length, within limits.
    const rankGap = (room: number, used: number, [min, max]: number[]) =>
      ranks > 1 ? clamp((room * FLOW_FILL - used - 2 * FLOW_MARGIN) / (ranks - 1), min, max) : 0;
    if (vertical) {
      const depth = inRank.map((ids) => Math.max(...ids.map((i) => heights[i])));
      const span = inRank.map((ids) => ids.length * w + (ids.length - 1) * FLOW_LANE_GAP);
      const used = depth.reduce((s, d) => s + d, 0);
      const gap = rankGap(box.height, used, FLOW_RANK_GAP.vertical);
      width = Math.max(...span) + 2 * FLOW_MARGIN + loops;
      height = used + (ranks - 1) * gap + 2 * FLOW_MARGIN;
      let y = FLOW_MARGIN;
      inRank.forEach((ids, r) => {
        const x0 = (width - loops - span[r]) / 2;
        ids.forEach((i, lane) => {
          nodes[i] = {
            x: x0 + lane * (w + FLOW_LANE_GAP),
            y: y + (depth[r] - heights[i]) / 2,
            w,
            h: heights[i],
            lines: lines[i],
          };
        });
        y += depth[r] + gap;
      });
    } else {
      const stack = inRank.map((ids) => ids.reduce((s, i) => s + heights[i], 0) + (ids.length - 1) * FLOW_LANE_GAP);
      const gap = rankGap(box.width, ranks * w, FLOW_RANK_GAP.horizontal);
      width = ranks * w + (ranks - 1) * gap + 2 * FLOW_MARGIN;
      height = Math.max(...stack) + 2 * FLOW_MARGIN + loops;
      inRank.forEach((ids, r) => {
        let y = (height - loops - stack[r]) / 2;
        for (const i of ids) {
          nodes[i] = { x: FLOW_MARGIN + r * (w + gap), y, w, h: heights[i], lines: lines[i] };
          y += heights[i] + FLOW_LANE_GAP;
        }
      });
    }
    const edges = item.edges.map(([a, b], e) => {
      const from = index.get(a)!;
      const to = index.get(b)!;
      const [lo, hi] = [place[to][0], place[from][0]];
      if (lo === hi) return { from, to, ...laneEdge(nodes[from], nodes[to], vertical) };
      // The boxes a back edge passes: those in its ranks, which may stand wider than its own two.
      const passed = nodes.filter((_, i) => place[i][0] >= lo && place[i][0] <= hi);
      const clear = Math.max(...passed.map((n) => (vertical ? n.x + n.w : n.y + n.h)));
      return { from, to, ...edgePath(nodes[from], nodes[to], vertical, forward[e], clear) };
    });
    const scale = Math.min(1, box.width / width, box.height / height);
    return { width, height, scale, vertical, nodes, edges };
  };

  // A chain (one box per rank, each arrow to the next) can also wind down the board in rows of
  // `per` boxes, left to right, then right to left below, like a path down a page.
  const wind = (per: number): FlowGeometry => {
    const [gapX, gapY] = [FLOW_RANK_GAP.horizontal[0], FLOW_RANK_GAP.vertical[0]];
    const rows = Array.from({ length: Math.ceil(ranks / per) }, (_, r) =>
      inRank.slice(r * per, r * per + per).map(([i]) => i),
    );
    const rowH = rows.map((ids) => Math.max(...ids.map((i) => heights[i])));
    const width = per * w + (per - 1) * gapX + 2 * FLOW_MARGIN;
    const height = rowH.reduce((s, d) => s + d, 0) + (rows.length - 1) * gapY + 2 * FLOW_MARGIN;
    const nodes: FlowNodeBox[] = new Array(item.nodes.length);
    let y = FLOW_MARGIN;
    rows.forEach((ids, r) => {
      ids.forEach((i, c) => {
        const x = FLOW_MARGIN + (r % 2 ? per - 1 - c : c) * (w + gapX);
        nodes[i] = { x, y: y + (rowH[r] - heights[i]) / 2, w, h: heights[i], lines: lines[i] };
      });
      y += rowH[r] + gapY;
    });
    const edges = item.edges.map(([a, b]) => {
      const [from, to] = [index.get(a)!, index.get(b)!];
      const row = Math.floor(place[from][0] / per);
      // Down at the end of a row (the next box is right below), else along the row's direction.
      const path =
        row !== Math.floor(place[to][0] / per)
          ? edgePath(nodes[from], nodes[to], true, true)
          : row % 2
            ? leftwardEdge(nodes[from], nodes[to])
            : edgePath(nodes[from], nodes[to], false, true);
      return { from, to, ...path };
    });
    return { width, height, scale: Math.min(1, box.width / width, box.height / height), vertical: true, nodes, edges };
  };

  const v = build(true);
  const h = build(false);
  let best = Math.abs(v.scale - h.scale) > 0.001 ? (v.scale > h.scale ? v : h) : box.height >= box.width ? v : h;
  const chain =
    inRank.every((ids) => ids.length === 1) &&
    item.edges.every(([a, b]) => place[index.get(b)!][0] === place[index.get(a)!][0] + 1);
  // Winding only when it clearly beats shrinking, and with the fewest turns that does.
  if (chain && best.scale < 1) {
    for (let per = ranks - 1; per >= 2; per--) {
      const wound = wind(per);
      if (wound.scale > best.scale + 0.04) best = wound;
    }
  }
  // Labels stay readable: a flow that would shrink further scrolls on the board instead.
  return { ...best, scale: Math.max(FLOW_MIN_SCALE, best.scale) };
}

// --------------------------------------------------------------------- bars

/** Whether a bar stands out: the one the narration is on, or all of them while it is on none. Size never singles a
 * bar out: a tour shows a few chosen rows, and the largest of them need not be the best in the document. */
export function barStandsOut(focused: number | null, index: number): boolean {
  return focused === null || index === focused;
}

/** The tag of a board whose numbers are not the paper's: invented example values, or values computed from a formula. */
export function sourceTag(item: BoardItem): { text: string; label: string } | null {
  if (item.kind !== 'heatmap' && item.kind !== 'scatter' && item.kind !== 'timeline' && item.kind !== 'distribution')
    return null;
  if (item.source === 'illustrative') return { text: 'illustrative', label: 'Invented example values, not measured' };
  if (item.kind === 'heatmap' && item.source === 'formula')
    return { text: 'from the formula', label: 'Computed from the formula' };
  return null;
}

/** "higher is better" or "lower is better" when the tour says which way is better, else null. */
export function betterWay(item: BarsItem): string | null {
  return item.higher_is_better === undefined ? null : `${item.higher_is_better ? 'higher' : 'lower'} is better`;
}

/** The unit chip of a bars board, with the way that is better in the notation papers use ("BLEU ↑", "PPL ↓").
 * Percent is printed on every value, so it shows only beside an arrow; without a unit the direction is spelled out. */
export function barsUnit(item: BarsItem): { text: string; label: string } | null {
  const better = betterWay(item);
  const unit = item.unit && (item.unit !== '%' || better) ? item.unit : null;
  if (!unit) return better ? { text: better, label: better } : null;
  const arrow = item.higher_is_better === undefined ? '' : item.higher_is_better ? ' ↑' : ' ↓';
  return { text: `${unit}${arrow}`, label: better ? `${unit}, ${better}` : unit };
}

/** Only forward frames of one spoken step share a numeric transition. Matching
 * labels/units identify the same quantities; seeking or changing units does not. */
export function barFrameSource(previous: { key: string; item: BoardItem } | null, next: { key: string; item: BoardItem }): BarsItem | null {
  if (!previous || previous.item.kind !== 'bars' || next.item.kind !== 'bars') return null;
  if (!forwardFrame(previous, next)) return null;
  const current = next.item;
  if (!current.unit || previous.item.unit !== current.unit || previous.item.bars.length !== current.bars.length ||
    previous.item.bars.some((bar, i) => bar.label !== current.bars[i].label)) return null;
  return previous.item;
}

export function interpolateBars(from: BarsItem, to: BarsItem, progress: number): BarsItem {
  const t = Math.max(0, Math.min(1, progress));
  return { ...to, bars: to.bars.map((bar, i) => ({ ...bar, value: from.bars[i].value + (bar.value - from.bars[i].value) * t })) };
}

/** A parameter sweep holds the input probe fixed, so only one independent
 * variable changes. Without a parameter, narration moves the input across x. */
export function plotCursor(item: PlotItem, progress: number): { x: number; a: number } {
  const t = Math.max(0, Math.min(1, progress));
  return {
    x: item.x[0] + (item.parameter ? 0.5 : t) * (item.x[1] - item.x[0]),
    a: item.parameter ? item.parameter.from + t * (item.parameter.to - item.parameter.from) : 1,
  };
}

/** Preserve short reported precision. Long calculated fractional tails need
 * only three places; this affects the label, never the stored value/geometry. */
export function decimalsOf(value: number): number {
  const text = Math.abs(value).toString();
  if (text.includes('e')) return Math.abs(value) < 1 ? 4 : 0;
  const dot = text.indexOf('.');
  const places = dot < 0 ? 0 : text.length - dot - 1;
  return places > 6 ? 3 : Math.min(4, places);
}

/** A value of a thousand trillion or more as a power of ten, its mantissa with the places it was reported with
 * (1.2345e20 is "1.2345×10²⁰", not twenty-one digits). `value` is what is shown, `final` the value it is counting to. */
function powerValue(value: number, final: number): string {
  const [lead, exp] = Math.abs(final).toExponential().split('e'); // the shortest digits that read back as the value
  const places = decimalsOf(Number(lead));
  let exponent = Number(exp);
  if (Number((Math.abs(final) / 10 ** exponent).toFixed(places)) >= 10) exponent++; // 9.99996 rounds up to 10.0000
  const mantissa = Number((value / 10 ** exponent).toFixed(places));
  return mantissa === 0 ? '0' : `${mantissa.toFixed(places)}×${powerOfTen(exponent)}`;
}

/** A value as the board prints it: grouped digits, fixed places, and a % sign when that is the unit. A count that
 * runs up to `final` keeps the form of that value, so that it does not change on the way. */
export function formatValue(value: number, places: number, unit?: string, final = value): string {
  const rounded = Number(value.toFixed(places)) || 0; // no "-0.0" on the way up from zero
  // A nonzero result must never disappear merely because the normal decimal
  // label has fewer places than its magnitude requires; a count of operations
  // (2.3×10¹⁹) is a power of ten, not twenty digits.
  const text = Math.abs(final) >= 1e15
    ? powerValue(value, final)
    : value !== 0 && rounded === 0
    ? Number(value.toPrecision(3)).toExponential()
    : rounded.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
  return unit === '%' ? `${text}%` : text;
}

export interface BarRow {
  /** Top of the bar. */
  y: number;
  /** The bar runs from x0 to x1; one of them is the zero line. */
  x0: number;
  x1: number;
  /** Vertical centre of the label, which starts at the left edge. */
  labelY: number;
  /** Where the value is printed: after the tip of a positive bar, before the tip of a negative one. */
  valueX: number;
  valueAnchor: 'start' | 'end';
}

export interface BarsLayout {
  width: number;
  height: number;
  /** Labels sit above their bars when a label column would leave the bars too little room. */
  labelsAbove: boolean;
  zeroX: number;
  rows: BarRow[];
}

/** Bars are this thick: thin marks, with air between rows. */
export const BAR_THICKNESS = 12;
// Row pitch [tightest, roomiest]: rows close up towards the tightest on a short board.
const BAR_PITCH = { beside: [26, 34], above: [40, 50] };
const BAR_LABEL_GAP = 14;
const BAR_VALUE_GAP = 8;
// Room past the longest value for its last glyph's overhang, so the board never clips or scrolls it.
const BAR_VALUE_SLACK = 2;
// Beside a label column the bars must keep this share of the width, else the labels go above them.
const BAR_MIN_TRACK = 0.55;

/**
 * Horizontal bars from a shared zero line, in a board `width` px wide and, when given, `height`
 * px tall. `labelWidths` and `valueWidths` are the measured texts (a value's width includes its
 * badge, if it has one).
 */
export function barsLayout(
  item: BarsItem,
  width: number,
  labelWidths: number[],
  valueWidths: number[],
  height = Infinity,
  rangeValues: number[] = [],
): BarsLayout {
  const values = item.bars.map((b) => b.value);
  const domain = [...values, ...rangeValues];
  const lo = Math.min(0, ...domain);
  const hi = Math.max(0, ...domain);
  const after = Math.max(0, ...valueWidths.filter((_, i) => values[i] >= 0)) + BAR_VALUE_GAP + BAR_VALUE_SLACK;
  const before = domain.some((v) => v < 0)
    ? Math.max(0, ...valueWidths) + BAR_VALUE_GAP
    : 0;
  const column = Math.max(...labelWidths) + BAR_LABEL_GAP;
  const labelsAbove = width - column - before - after < width * BAR_MIN_TRACK;
  const start = (labelsAbove ? 0 : column) + before;
  const end = Math.max(start + 1, width - after);
  const x = (v: number) => start + ((v - lo) / (hi - lo || 1)) * (end - start);
  const zeroX = x(0);
  const top = labelsAbove ? 22 : 0;
  const [tight, roomy] = labelsAbove ? BAR_PITCH.above : BAR_PITCH.beside;
  const pitch = clamp((height - top - BAR_THICKNESS - 2) / Math.max(1, values.length - 1), tight, roomy);
  const rows = values.map((v, i): BarRow => {
    const y = top + i * pitch;
    const tip = x(v);
    return {
      y,
      x0: Math.min(zeroX, tip),
      x1: Math.max(zeroX, tip),
      labelY: labelsAbove ? y - 13 : y + BAR_THICKNESS / 2,
      valueX: v < 0 ? tip - BAR_VALUE_GAP : tip + BAR_VALUE_GAP,
      valueAnchor: v < 0 ? 'end' : 'start',
    };
  });
  return { width, height: top + (values.length - 1) * pitch + BAR_THICKNESS + 2, labelsAbove, zeroX, rows };
}

/** Radius of a bar's tip, the end away from zero; its base on the zero line is square. */
const BAR_RADIUS = 4;

/** A bar from x0 to x1 (x0 < x1), with its tip on the right or the left; empty when it has no length. */
export function barPath(x0: number, x1: number, y: number, tipRight: boolean): string {
  const h = BAR_THICKNESS;
  const r = Math.min(BAR_RADIUS, (x1 - x0) / 2);
  if (r <= 0) return '';
  const [tip, base, side] = tipRight ? [x1, x0, 1] : [x0, x1, -1];
  // From the base along the top edge, round the tip's two corners, and back along the bottom.
  return (
    `M${round(base)} ${y}H${round(tip - side * r)}A${r} ${r} 0 0 ${tipRight ? 1 : 0} ${round(tip)} ${y + r}` +
    `V${y + h - r}A${r} ${r} 0 0 ${tipRight ? 1 : 0} ${round(tip - side * r)} ${y + h}H${round(base)}Z`
  );
}

/** CSS clip that shows `progress` (0..1) of a bar from the zero line, its edge rounded like the tip. */
export function barClip(progress: number, tipRight: boolean): string {
  const hidden = `${((1 - Math.max(0, Math.min(1, progress))) * 100).toFixed(2)}%`;
  return tipRight
    ? `inset(0 ${hidden} 0 0 round 0 ${BAR_RADIUS}px ${BAR_RADIUS}px 0)`
    : `inset(0 0 0 ${hidden} round ${BAR_RADIUS}px 0 0 ${BAR_RADIUS}px)`;
}

// ------------------------------------------------------------------- easing

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of time 0..1, so script can follow a CSS animation. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (t: number) => number {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (s: number) => ((ax * s + bx) * s + cx) * s;
  const y = (s: number) => ((ay * s + by) * s + cy) * s;
  const slope = (s: number) => (3 * ax * s + 2 * bx) * s + cx;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    // Newton's method converges in a few steps; bisection covers flat stretches.
    let s = t;
    for (let i = 0; i < 8; i++) {
      const err = x(s) - t;
      if (Math.abs(err) < 1e-7) return y(s);
      const d = slope(s);
      if (Math.abs(d) < 1e-6) break;
      s = clamp(s - err / d, 0, 1);
    }
    let lo = 0;
    let hi = 1;
    s = t;
    for (let i = 0; i < 40 && Math.abs(x(s) - t) > 1e-7; i++) {
      if (x(s) < t) lo = s;
      else hi = s;
      s = (lo + hi) / 2;
    }
    return y(s);
  };
}

/** The board's ease-out (also --board-ease-out in board.css): quick to start, long and soft to land. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
