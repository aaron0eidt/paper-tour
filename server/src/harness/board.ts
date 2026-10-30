import { SCENE_SCHEMA, SCENE_MAX_OBJECTS, sceneProblems, type SceneItem } from '../../../shared/scene';
import { PLOT_BOARD_SCHEMA, PLOT_LIMITS, plotProblems, type PlotItem } from '../../../shared/plot';
import {
  HEATMAP_LIMITS,
  HEATMAP_SCHEMA,
  canonicalHeatmap,
  heatmapMasked,
  heatmapProblems,
} from '../../../shared/heatmap';
import { SCATTER_LIMITS, SCATTER_SCHEMA, canonicalScatter, scatterProblems } from '../../../shared/scatter';
import { SHAPES_LIMITS, SHAPES_SCHEMA, canonicalShapes, shapesProblems } from '../../../shared/shapes';
import {
  TIMELINE_LIMITS,
  TIMELINE_SCHEMA,
  canonicalTimeline,
  timelineProblems,
  timelineQuotes,
} from '../../../shared/timeline';
import {
  DISTRIBUTION_SCHEMA,
  canonicalDistribution,
  distributionProblems,
  distributionQuotes,
} from '../../../shared/distribution';
import katex, { type KatexOptions } from 'katex';
import type { BoardItem } from '../../../shared/paper';

// Native visualization contracts: schemas, local checks and focus identities.
// Validators return actionable diagnostics; the workflow owns model calls and bounded repair attempts.

export type BoardKind = BoardItem['kind'];
export type FormulaItem = Extract<BoardItem, { kind: 'formula' }>;
export type FlowItem = Extract<BoardItem, { kind: 'flow' }>;
export type BarsItem = Extract<BoardItem, { kind: 'bars' }>;

/** A checked item, or null with the reasons; null without problems means the model chose to draw nothing. */
export interface BoardCheck<T extends BoardItem = BoardItem> {
  item: T | null;
  problems: string[];
}

/** Sizes that keep the board calm and readable. */
export const BOARD_LIMITS = {
  title: 60,
  terms: [2, 6],
  termLatex: 200,
  termLabelWords: 7,
  termLabel: 48,
  bars: [1, 6],
  barLabelWords: 4,
  barLabel: 32,
  unit: 12,
  nodes: [3, 7],
  nodeLabelWords: 4,
  nodeLabel: 28,
  edges: 12,
} as const;
/** Flow node IDs the model chooses from; a board_focus cue names a node by its ID. */
export const FLOW_NODE_IDS = Array.from({ length: BOARD_LIMITS.nodes[1] }, (_, i) => `node-${i + 1}`);

type Obj = Record<string, unknown>;
const none = () => ({ item: null, problems: [] });
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const rows = (v: unknown) => (Array.isArray(v) ? v.filter(isObj) : []);
const text = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '');
/** Words a listener hears: tokens with a letter or digit, so "+" or "&" do not count. */
const wordCount = (s: string) => s.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const titled = (v: unknown) => {
  const title = text(v);
  return title && title.length <= BOARD_LIMITS.title ? { title } : {};
};

// ------------------------------------------------------------------------------------------------- formula

/** Commands KaTeX renders without trust as red error text: links, images and raw HTML. */
const UNSAFE_LATEX = /\\(?:href|url|includegraphics|html[A-Za-z]*)(?![A-Za-z])/;
/** Colour commands, which would paint over the colours the board gives the terms. */
const COLOR_LATEX = /\\(?:color|textcolor|colorbox|fcolorbox)(?![A-Za-z])/;
/** KaTeX as the board runs it (player/src/components/Board.tsx): only its own term classes are trusted. */
const KATEX: KatexOptions = {
  displayMode: true,
  throwOnError: true,
  strict: 'ignore',
  trust: (context) => context.command === '\\htmlClass' && /^pt-term pt-term-\d+$/.test(context.class),
};

/** Why KaTeX cannot render `latex` on the board (display mode), or null when it can. */
export function latexError(latex: string): string | null {
  if (UNSAFE_LATEX.test(latex)) return 'links, images and HTML commands are not allowed';
  if (COLOR_LATEX.test(latex)) return 'colour commands are not allowed, since the board colours the terms itself';
  try {
    katex.renderToString(latex, KATEX);
    return null;
  } catch (error) {
    const raw = (error as { rawMessage?: unknown }).rawMessage;
    return typeof raw === 'string' ? raw.slice(0, 160) : 'it does not parse';
  }
}

/** Drop what papers carry around an equation but the board does not show: $ wrappers, numbers, final punctuation. */
function tidyLatex(v: unknown): string {
  return text(v)
    .replace(/^(?:\$\$?|\\\[|\\\()\s*|\s*(?:\$\$?|\\\]|\\\))$/g, '')
    .replace(/\\(?:begin|end)\{(?:equation|displaymath)\*?\}/g, '')
    .replace(/\\(?:label|tag)\*?\{[^{}]*\}|\\(?:nonumber|notag)(?![A-Za-z])/g, '')
    .replace(/(?:\s|\\[,;:! ]|~)*(?<!\\)[,.;]\s*$/, '')
    .trim();
}

/** The term as it is written in latex: exact, else the same characters spaced differently; '' when it is not there. */
function locate(latex: string, term: string): string {
  if (!term || latex.includes(term)) return term;
  const chars = [...term.replace(/\s+/g, '')].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return chars.length ? (new RegExp(chars.join('\\s*')).exec(latex)?.[0] ?? '') : '';
}

// Term placement mirrors the player's wrapTerms (player/src/board.ts), so a formula passes here exactly when the board
// can colour every term: a term takes its first occurrence that starts and ends between tokens and does not cross a
// term placed before it, preferring one that overlaps nothing; it may nest inside another term, never cross it.
type Span = [number, number];
const overlaps = (a: Span, b: Span) => a[0] < b[1] && b[0] < a[1];
const contains = (a: Span, b: Span) => a[0] <= b[0] && b[1] <= a[1];
const crosses = (a: Span, b: Span) => overlaps(a, b) && !contains(a, b) && !contains(b, a);
const CONTROL_WORD = /\\[a-zA-Z]+/y;

/** Positions between LaTeX tokens: a control word, a control symbol or one character. */
function tokenBounds(latex: string): boolean[] {
  const bounds = new Array<boolean>(latex.length + 1).fill(false);
  for (let i = 0; i < latex.length; ) {
    bounds[i] = true;
    CONTROL_WORD.lastIndex = i;
    const word = CONTROL_WORD.exec(latex);
    const code = latex.charCodeAt(i);
    i += word ? word[0].length : latex[i] === '\\' ? 2 : code >= 0xd800 && code <= 0xdbff ? 2 : 1;
  }
  bounds[latex.length] = true;
  return bounds;
}

/** The LaTeX with each span wrapped in a group as the board wraps it: closes before opens, outer spans outside. */
function wrapSpans(latex: string, spans: Span[]): string {
  const marks = spans.flatMap(([start, end], term) => [
    { at: start, open: true, len: end - start, term },
    { at: end, open: false, len: end - start, term },
  ]);
  marks.sort((a, b) => {
    if (a.at !== b.at) return a.at - b.at;
    if (a.open !== b.open) return a.open ? 1 : -1;
    return a.open ? b.len - a.len || a.term - b.term : a.len - b.len || b.term - a.term;
  });
  let out = '',
    last = 0;
  for (const m of marks) {
    out += latex.slice(last, m.at) + (m.open ? `\\htmlClass{pt-term pt-term-${m.term}}{` : '}');
    last = m.at;
  }
  return out + latex.slice(last);
}

/** KaTeX's HTML for the formula as the board renders it, or null when it does not parse. */
function rendered(latex: string): string | null {
  try {
    return katex.renderToString(latex, KATEX);
  } catch {
    return null;
  }
}
/** How many big operators show their limits above and below, such as a sum from i = 1 to n. */
const limitsIn = (html: string) => html.split('op-limits').length - 1;

/**
 * Where the board colours a term, given the terms placed before it; a problem when it cannot be coloured, or only by
 * changing how the formula is typeset: an exponent cut from its symbol, or an operator cut from its limits.
 */
function placeTerm(latex: string, bounds: boolean[], placed: Span[], term: string): Span | string {
  if (/^[_^]/.test(term)) return `"${term}" is an exponent or index without its symbol; include the symbol, as in K^T`;
  const found: Span[] = [];
  for (let at = latex.indexOf(term); at >= 0; at = latex.indexOf(term, at + 1)) found.push([at, at + term.length]);
  const whole = found.filter(([start, end]) => bounds[start] && bounds[end]);
  if (!whole.length) return `"${term}" only appears inside a longer command or symbol; choose a longer piece around it`;
  const options = whole.filter((span) => !placed.some((s) => crosses(s, span)));
  if (!options.length) {
    const other = placed.findIndex((s) => crosses(s, whole[0]));
    return `"${term}" cuts across term ${other + 1}; choose parts that do not cut each other`;
  }
  const taken = (span: Span) => (placed.some((s) => overlaps(s, span)) ? 1 : 0);
  options.sort((a, b) => taken(a) - taken(b) || a[0] - b[0]);
  // The board takes the first option that renders; judge that one.
  for (const span of options) {
    const html = rendered(wrapSpans(latex, [...placed, span]));
    if (html === null) continue;
    if (limitsIn(html) < limitsIn(rendered(latex) ?? ''))
      return `"${term}" leaves its limits behind; include them, as in \\sum_{i=1}^{n}`;
    return span;
  }
  return `"${term}" is not a complete symbol or group of the formula`;
}

/**
 * A formula the board builds term by term: KaTeX renders the LaTeX, every term is a complete symbol or group copied
 * from it that the board can colour (it may sit inside another term, never cut across one), and labels are short.
 * Colours stay unset, so the player's palette applies. Reusable for any board formula, such as one in an answer; a
 * line of a worked solution may light up a single term (`minTerms`).
 */
export function checkFormula(
  raw: unknown,
  { minTerms = BOARD_LIMITS.terms[0] }: { minTerms?: number } = {},
): BoardCheck<FormulaItem> {
  if (!isObj(raw)) return none();
  const latex = tidyLatex(raw.latex);
  const given = rows(raw.terms);
  if (!latex && !given.length) return none();
  const problems: string[] = [];
  const error = latex ? (latex.length > 400 ? 'it is longer than 400 characters' : latexError(latex)) : 'it is empty';
  if (error) problems.push(`latex cannot be rendered: ${error}`);
  const [fewest, most] = [minTerms, BOARD_LIMITS.terms[1]];
  if (given.length < fewest) problems.push(`give ${fewest} to ${most} terms`);
  const terms = given.slice(0, most).map((t) => ({ latex: locate(latex, text(t.latex)), label: text(t.label) }));
  const bounds = tokenBounds(latex);
  const placed: Span[] = [];
  terms.forEach((term, i) => {
    const name = `term ${i + 1}`;
    const repeated = terms.findIndex((t) => t.latex === term.latex);
    if (!term.latex) problems.push(`${name}: its latex is not copied exactly from the formula's latex`);
    else if (repeated < i) problems.push(`${name}: it repeats term ${repeated + 1}`);
    else if (term.latex.length > BOARD_LIMITS.termLatex)
      problems.push(`${name}: it is longer than ${BOARD_LIMITS.termLatex} characters; choose a smaller part`);
    else if (!error) {
      const place = placeTerm(latex, bounds, placed, term.latex);
      if (typeof place === 'string') problems.push(`${name}: ${place}`);
      else placed.push(place);
    }
    if (!term.label) problems.push(`${name}: the label is empty`);
    else if (wordCount(term.label) > BOARD_LIMITS.termLabelWords || term.label.length > BOARD_LIMITS.termLabel)
      problems.push(`${name}: the label "${term.label}" is too long; use at most 5 words`);
  });
  if (problems.length) return { item: null, problems };
  return { item: { kind: 'formula', ...titled(raw.title), latex, terms }, problems: [] };
}

// ---------------------------------------------------------------------------------------------------- bars

const NUMBER = /([-−–+]?)(\d[\d,]*(?:\.\d+)?|\.\d+)(?:[eE]([+−-]?\d+))?(?:\s?([kKMB])(?!\p{L}))?/gu;
const SCALE: Record<string, number> = { k: 1e3, K: 1e3, M: 1e6, B: 1e9 };

// Scientific notation as documents print it. Explicit forms are rewritten to e-notation before the numbers are read:
// "2.3 × 10^19", "2.3·10¹⁹", "2.3 x 10^{19}", "2,3 \cdot 10^{-9}", "10^(-3)" and a bare "10^{19}" (a power of ten is
// one number, not a 10 and a 19). A mantissa is a plain number; in "(a+b) × 10^3" only the power is read. LaTeX spacing
// (\, \; ~) may surround the multiplication sign.
const SPACE = String.raw`(?:\s|\\[,;:!]|~)*`;
const MULTIPLY = String.raw`(?:\\times|\\cdot|[×*·⋅∙]|[xX](?=${SPACE}10))`;
const SIGNED = String.raw`[+−–-]?\d{1,3}`;
const EXPONENT = String.raw`(?:\^\s*\{\s*\(?\s*(${SIGNED})\s*\)?\s*\}|\^\s*\(\s*(${SIGNED})\s*\)|(?:\^|\*\*)\s*(${SIGNED})|([⁺⁻]?[⁰¹²³⁴⁵⁶⁷⁸⁹]{1,3}))(?![.,]?\d)`;
const MANTISSA = String.raw`[+−-]?(?:\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:[.,]\d+)?|\.\d+)`;
const POWER = new RegExp(
  String.raw`(?<![\p{L}\p{N}.,^])(?:(${MANTISSA})${SPACE}${MULTIPLY}${SPACE})?10\s*${EXPONENT}`,
  'gu',
);
const SUPERSCRIPT_DIGITS = '⁰¹²³⁴⁵⁶⁷⁸⁹';

/** A mantissa as e-notation takes it: no grouping commas, a decimal point for a German decimal comma. */
const plainMantissa = (text: string) =>
  /^\d{1,3}(?:,\d{3})+(?:\.\d+)?$/.test(text) ? text.replace(/,/g, '') : text.replace(',', '.');

/** A power of ten as the text of its exponent has it: "−9", "⁻⁹" and "{-9}" are all -9. */
const exponentOf = (written: string) =>
  written
    .replace(/[−–⁻]/g, '-')
    .replace(/⁺/g, '+')
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]/g, (d) => String(SUPERSCRIPT_DIGITS.indexOf(d)));

/**
 * Scientific notation whose exponent a PDF flattened to full size digits ("2.3 · 1019" for 2.3 · 10^19), as the number
 * it was. It is only that where nothing else is plausible: a mantissa from 1.0 to 9.99 (a decimal point, one or two
 * decimals, no thousands grouping, and a sign of its own, read as in NUMBER), a multiplication sign (· × ⋅ ∙, never the
 * letter x), "10", and an exponent of exactly two digits 10 to 99 or a minus and one or two digits. Anything else
 * ("12.3 · 1019", "0.5 · 1000", "3 · 1019", "2.3 · 105", "1,500 · 1024", "1019.5") stays the digits it is. The reading is added to the plain
 * numbers, never in place of them: "1.5 · 1024" may be that product.
 */
const FLATTENED = /(?<![\p{L}\p{N}.,])([+−–-]?)([1-9][.,]\d{1,2})(?!\d)\s*[·×⋅∙]\s*10(?:([1-9]\d)|[−–-]([1-9]\d?))(?![.,]?\d)/gu;

/** A text with its explicit powers of ten written as e-notation: "2.3 × 10^19" is "2.3e19" and "10⁻⁹" is "1e-9". */
export function eNotation(source: string): string {
  return source.replace(POWER, (whole, mantissa: string | undefined, braced, paren, bare, script) => {
    const exponent = exponentOf(braced ?? paren ?? bare ?? script);
    if (Math.abs(Number(exponent)) > 300) return whole;
    if (mantissa === undefined) return `1e${exponent}`;
    const sign = /^[+−-]/.test(mantissa) ? mantissa[0] : '';
    return `${sign}${plainMantissa(mantissa.slice(sign.length))}e${exponent}`;
  });
}

/**
 * Every number a text prints, read the way a reader would: 1,024 is 1024, 0,5 may also be 0.5, −2.1 is negative while
 * the 20 in "10-20" is not, 100K is both 100 and 100000, and 2.3 × 10^19 is 2.3e19 (see POWER and FLATTENED).
 */
export function numbersIn(source: string): number[] {
  const out: number[] = [];
  const flattened: number[] = [];
  for (const m of source.matchAll(FLATTENED)) {
    // The mantissa's own sign, as NUMBER reads it: after ")" or "]" it subtracts (after a digit or letter it never matches).
    const negative = m[1] !== '' && m[1] !== '+' && !/[)\]]/.test(source[m.index - 1] ?? ' ');
    flattened.push(Number(`${negative ? '-' : ''}${m[2].replace(',', '.')}e${m[3] ?? `-${m[4]}`}`));
  }
  source = eNotation(source);
  for (const m of source.matchAll(NUMBER)) {
    const before = source[m.index - 1] ?? ' ';
    const sign = m[1] && m[1] !== '+' && !/[\p{L}\p{N})\]]/u.test(before) ? -1 : 1;
    const digits = m[2].replace(/,+$/, '');
    const grouped = /^[1-9]\d{0,2}(?:,\d{3})+(?:\.\d+)?$/.test(digits);
    const parts = grouped ? [digits.replace(/,/g, '')] : digits.split(',').filter(Boolean);
    if (!grouped && /^\d+,\d+$/.test(digits)) parts.push(digits.replace(',', '.'));
    for (const part of parts) {
      // Read from the printed digits, so 9.6e18 is the double a table's own 9.6e18 is.
      const scientific = sign * Number(m[3] === undefined ? part : `${part}e${exponentOf(m[3])}`);
      if (!Number.isFinite(scientific)) continue;
      out.push(scientific);
      if (m[4]) out.push(scientific * SCALE[m[4]]);
    }
  }
  return [...out, ...flattened];
}

const sameNumber = (a: number, b: number) => a === b || Math.abs(a - b) <= 1e-9 * Math.max(Math.abs(a), Math.abs(b));
/** Citation markers such as [38] or [3, 7], which table rows carry but bar labels do not need. */
const CITATION = /\s*\[\d+(?:\s*[,–-]\s*\d+)*\]/g;

/**
 * Bars of the document's own numbers: 2 to 6 bars with short, distinct labels, and every value printed in `evidence`
 * (the text the model was shown). A board of invented numbers is dropped.
 */
export function checkBars(raw: unknown, evidence: string): BoardCheck<BarsItem> {
  if (!isObj(raw)) return none();
  const given = rows(raw.bars);
  if (!given.length) return none();
  const problems: string[] = [];
  const [fewest, most] = BOARD_LIMITS.bars;
  if (given.length < fewest || given.length > most)
    problems.push(`give ${fewest} to ${most} bars, not ${given.length}`);
  const printed = numbersIn(evidence);
  const bars = given.map((b, i) => {
    const name = `bar ${i + 1}`;
    const label = text(b.label).replace(CITATION, '').trim();
    if (!label) problems.push(`${name}: the label is empty`);
    else if (wordCount(label) > BOARD_LIMITS.barLabelWords || label.length > BOARD_LIMITS.barLabel)
      problems.push(`${name}: the label "${label}" is too long; use at most 4 words`);
    else if (given.slice(0, i).some((o) => text(o.label).replace(CITATION, '').trim() === label))
      problems.push(`${name}: the label "${label}" is used twice`);
    const value = b.value;
    if (typeof value !== 'number' || !Number.isFinite(value)) problems.push(`${name}: the value is not a number`);
    else if (!printed.some((n) => sameNumber(n, value)))
      problems.push(`${name}: ${value} does not appear in the evidence; copy numbers exactly as printed`);
    return { label, value: value as number };
  });
  if (problems.length) return { item: null, problems };
  const unit = text(raw.unit);
  return {
    item: {
      kind: 'bars',
      ...titled(raw.title),
      ...(unit && unit.length <= BOARD_LIMITS.unit ? { unit } : {}),
      ...(typeof raw.higher_is_better === 'boolean' ? { higher_is_better: raw.higher_is_better } : {}),
      bars,
    },
    problems: [],
  };
}

// ---------------------------------------------------------------------------------------------------- flow

/**
 * Nodes in a stable topological order, so every arrow points forward; a flow with a cycle keeps its listed order and
 * its loop-back arrow, which the board draws beside the nodes.
 */
function forward(ids: string[], edges: [string, string][]): string[] {
  const waiting = new Map(ids.map((id) => [id, 0]));
  for (const [, to] of edges) waiting.set(to, waiting.get(to)! + 1);
  const ready = ids.filter((id) => !waiting.get(id));
  const order: string[] = [];
  while (ready.length) {
    const id = ready.shift()!;
    order.push(id);
    for (const [from, to] of edges) {
      if (from !== id) continue;
      waiting.set(to, waiting.get(to)! - 1);
      if (!waiting.get(to)) ready.push(to);
    }
    ready.sort((a, b) => ids.indexOf(a) - ids.indexOf(b));
  }
  return order.length === ids.length ? order : ids;
}

/**
 * A small flow of boxes and arrows: 3 to 7 nodes with short labels and distinct IDs in the order the work flows, and
 * every node connected. Unknown, repeated and self arrows are dropped first.
 */
export function checkFlow(raw: unknown): BoardCheck<FlowItem> {
  if (!isObj(raw)) return none();
  const given = rows(raw.nodes);
  if (!given.length) return none();
  const problems: string[] = [];
  const [fewest, most] = BOARD_LIMITS.nodes;
  if (given.length < fewest || given.length > most)
    problems.push(`give ${fewest} to ${most} nodes, not ${given.length}`);
  const nodes = given.map((n) => ({ id: text(n.id), label: text(n.label) }));
  nodes.forEach((node, i) => {
    const name = `node ${i + 1}`;
    if (!FLOW_NODE_IDS.includes(node.id)) problems.push(`${name}: the id must be one of ${FLOW_NODE_IDS.join(', ')}`);
    else if (nodes.findIndex((o) => o.id === node.id) < i) problems.push(`${name}: the id ${node.id} is used twice`);
    if (!node.label) problems.push(`${name}: the label is empty`);
    else if (wordCount(node.label) > BOARD_LIMITS.nodeLabelWords || node.label.length > BOARD_LIMITS.nodeLabel)
      problems.push(`${name}: the label "${node.label}" is too long; use at most 3 words`);
  });
  if (problems.length) return { item: null, problems };
  const ids = nodes.map((n) => n.id);
  const pairs = new Map<string, [string, string]>();
  for (const e of Array.isArray(raw.edges) ? raw.edges : []) {
    const [from, to] = Array.isArray(e) ? e.map(text) : isObj(e) ? [text(e.from), text(e.to)] : [];
    if (from && to && from !== to && ids.includes(from) && ids.includes(to)) pairs.set(`${from}>${to}`, [from, to]);
  }
  const edges = [...pairs.values()];
  // Every node joins one connected picture: no loose boxes.
  const group = new Map(ids.map((id) => [id, id]));
  const root = (id: string): string => (group.get(id) === id ? id : root(group.get(id)!));
  for (const [a, b] of edges) group.set(root(a), root(b));
  const loose = nodes.filter((n) => root(n.id) !== root(ids[0]));
  if (!edges.length) problems.push('add arrows from each node to the next');
  else if (edges.length > BOARD_LIMITS.edges)
    problems.push(`use at most ${BOARD_LIMITS.edges} arrows, not ${edges.length}`);
  else if (loose.length) problems.push(`connect ${loose.map((n) => n.id).join(', ')} to the others with arrows`);
  if (problems.length) return { item: null, problems };
  const order = forward(ids, edges);
  return {
    item: { kind: 'flow', ...titled(raw.title), nodes: order.map((id) => nodes.find((n) => n.id === id)!), edges },
    problems: [],
  };
}

export function sceneTeachingProblem(item: SceneItem): string | null {
  const quantitative = item.objects.some((object) => ['matrix', 'plot', 'vector'].includes(object.type));
  const nodes = item.objects.filter((object) => ['rect', 'circle'].includes(object.type) && !object.background);
  const relationship = item.objects.some((object) => object.type === 'arrow') && nodes.length >= 2;
  return quantitative || relationship
    ? null
    : 'A scene must show a meaningful quantitative transformation or spatial relationship, not colored prose or decorative boxes. Floating text plus tiny arrows is still a text slide. Use a plot, numeric matrix/vector, or at least two actual diagram nodes connected by meaningful arrows. For measured comparisons use bars/plots rather than numbers written in prose. For a source-table overview, keep grounded PDF cues and omit the board unless an actual comparison adds insight.';
}

/** A scene's structural, pedagogical, math and value-provenance checks. */
function checkScene(raw: unknown, evidence: string): BoardCheck {
  if (raw === undefined) return none();
  if (!isObj(raw)) return { item: null, problems: sceneProblems(raw) };
  const item = { ...raw, kind: 'scene' } as unknown as SceneItem;
  const problems = sceneProblems(item);
  if (!problems.length) {
    const teachingProblem = sceneTeachingProblem(item);
    if (teachingProblem) problems.push(teachingProblem);
    const printed = [0, 1, ...numbersIn(evidence)];
    for (const object of item.objects) {
      if (object.type === 'math' && object.text) {
        const error = latexError(object.text);
        if (error) problems.push(`Scene object ${object.id}: ${error}.`);
      }
      for (const value of object.values?.flat() ?? [])
        if (!printed.some((n) => sameNumber(n, value)))
          problems.push(
            `Scene object ${object.id}: value ${value} needs quoted evidence or declared illustrative example inputs/calculations.`,
          );
    }
  }
  return { item: problems.length ? null : item, problems };
}

/** Constants in an expression that a document's own formula would print: the small ones every formula uses are free. */
const FREE_CONSTANTS = [0, 1, 2, 10];

/** A plot of the document's own formula prints its constants, and measured points are always printed. */
function plotEvidence(item: PlotItem, evidence: string): string[] {
  const problems: string[] = [];
  if (item.points?.length)
    problems.push(
      ...unprinted(
        item.points.flatMap((point, i) => [
          { where: `point ${i + 1} x`, value: point.x },
          { where: `point ${i + 1} y`, value: point.y },
        ]),
        evidence,
        'points',
        { fix: 'or leave the point out: a point is a measurement, never an invented one' },
      ),
    );
  if (item.source === 'document')
    problems.push(
      ...unprinted(
        [
          ...item.curves.flatMap((curve, i) =>
            numbersIn(curve.expression)
              .filter((n) => !FREE_CONSTANTS.includes(n))
              .map((value) => ({ where: `curve ${i + 1} constant`, value })),
          ),
          ...(item.marks ?? []).flatMap((mark, i) =>
            mark.type === 'value' && mark.at !== undefined ? [{ where: `mark ${i + 1} at`, value: mark.at }] : [],
          ),
        ],
        evidence,
        'source',
        { fix: 'or set source to illustrative: document is for the document’s own formula' },
      ),
    );
  return problems;
}

/** A plot: the shared check (ranges, scales, expressions, marks that exist, points inside the axes), then the evidence for points. */
function checkPlot(raw: unknown, evidence = ''): BoardCheck {
  const item = isObj(raw) ? { ...raw, kind: 'plot' as const } : raw;
  const problems = plotProblems(item);
  if (!problems.length) problems.push(...plotEvidence(item as PlotItem, evidence));
  return { item: problems.length ? null : (item as BoardItem), problems };
}

/** Empty lists are how a model says "no board": a missing value, or an array with nothing in it. */
const blank = (v: unknown) => v === undefined || (Array.isArray(v) && !v.length);

/** Numbers written out in words ("three months", "a fortnight", "third"), which a period or a step in a document often is. */
const NUMBER_WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  fifteen: 15,
  twenty: 20,
  thirty: 30,
  forty: 40,
  sixty: 60,
  ninety: 90,
  fortnight: 14,
  first: 1,
  second: 2,
  third: 3,
  fourth: 4,
  fifth: 5,
  sixth: 6,
  seventh: 7,
  eighth: 8,
  ninth: 9,
  tenth: 10,
};
function numbersInWords(source: string): number[] {
  const out = [...source.toLowerCase().matchAll(/\b[a-z]+\b/g)].flatMap((m) =>
    Object.hasOwn(NUMBER_WORDS, m[0]) ? [NUMBER_WORDS[m[0]]] : [],
  );
  // "a month" and "a week" are one; "a fortnight" is also two weeks.
  if (/\b(?:an?|per|each|every)\s+(?:day|week|month|year)/i.test(source)) out.push(1);
  if (/\bfortnight/i.test(source)) out.push(2);
  return out;
}

/**
 * What a board that claims the document's own numbers is told when some are not printed in `evidence`: the first few by
 * position, then how to fix it. Empty when every value is printed. A value may also count as printed through one of its
 * `alternatives` (a variance printed for a spread, a percentage for a chance), or, with `words`, written out in words.
 */
function unprinted(
  values: { where: string; value: number; alternatives?: number[] }[],
  evidence: string,
  field: string,
  { fix = 'or set source to illustrative and say so in the title', words = false } = {},
): string[] {
  const printed = [...numbersIn(evidence), ...(words ? numbersInWords(evidence) : [])];
  const missing = values.filter(
    ({ value, alternatives = [] }) => ![value, ...alternatives].some((v) => printed.some((n) => sameNumber(n, v))),
  );
  if (!missing.length) return [];
  const shown = missing.slice(0, 3).map(({ where, value }) => `${where} = ${value}`);
  const more = missing.length > shown.length ? ` (and ${missing.length - shown.length} more)` : '';
  return [`${field}: not printed in the evidence: ${shown.join('; ')}${more}. Copy numbers exactly as printed, ${fix}`];
}

/**
 * A heatmap: shape, labels and values from the shared check (it also rejects a grid whose visible cells are all equal); a
 * grid of the document's own values must be printed in the evidence, a formula's values are computed here.
 */
function checkHeatmap(raw: unknown, evidence: string): BoardCheck {
  if (isObj(raw) && blank(raw.rows) && blank(raw.cols) && blank(raw.values)) return none();
  const item = isObj(raw) ? { ...raw, kind: 'heatmap' as const } : raw;
  const problems = heatmapProblems(item);
  if (problems.length) return { item: null, problems };
  const checked = canonicalHeatmap(item);
  if (checked.source === 'document')
    problems.push(
      ...unprinted(
        checked.values.flatMap((row, r) =>
          row.flatMap((value, c) =>
            heatmapMasked(checked.mask, r, c)
              ? []
              : [{ where: `row "${checked.rows[r]}", column "${checked.cols[c]}"`, value }],
          ),
        ),
        evidence,
        'values',
      ),
    );
  return { item: problems.length ? null : checked, problems };
}

/** A scatter plot: labels, finite coordinates, log axes and series from the shared check; document coordinates must be printed. */
function checkScatter(raw: unknown, evidence: string): BoardCheck {
  if (isObj(raw) && blank(raw.points)) return none();
  const item = isObj(raw) ? { ...raw, kind: 'scatter' as const } : raw;
  const problems = scatterProblems(item);
  if (problems.length) return { item: null, problems };
  const checked = canonicalScatter(item);
  if (checked.source === 'document')
    problems.push(
      ...unprinted(
        checked.points.flatMap((point) => [
          { where: `"${point.label}" x`, value: point.x },
          { where: `"${point.label}" y`, value: point.y },
        ]),
        evidence,
        'points',
      ),
    );
  return { item: problems.length ? null : checked, problems };
}

/** Matrix shapes through an operation: the dimension algebra comes from the shared check, and every name must render. */
function checkShapes(raw: unknown): BoardCheck {
  if (isObj(raw) && blank(raw.terms)) return none();
  const item = isObj(raw) ? { ...raw, kind: 'shapes' as const } : raw;
  const problems = shapesProblems(item);
  (isObj(raw) && Array.isArray(raw.terms) ? raw.terms : []).forEach((term, i) => {
    const name = isObj(term) && term.kind === 'matrix' ? text(term.name) : '';
    const error = name && latexError(name);
    if (error) problems.push(`term ${i + 1}: the name "${name}" cannot be rendered as LaTeX: ${error}`);
  });
  return { item: problems.length ? null : canonicalShapes(item), problems };
}

/**
 * A timeline: the shared check resolves every position from the dates, offsets and lengths the model wrote (cycles,
 * unknown references and a number in a label that the resolved length contradicts are refused); the periods and dates of
 * a document's own timeline must be printed in the evidence, in digits or in words.
 */
function checkTimeline(raw: unknown, evidence: string): BoardCheck {
  if (isObj(raw) && blank(raw.events)) return none();
  const item = isObj(raw) ? { ...raw, kind: 'timeline' as const } : raw;
  const problems = timelineProblems(item);
  if (problems.length) return { item: null, problems };
  const checked = canonicalTimeline(item);
  if (checked.source === 'document')
    problems.push(...unprinted(timelineQuotes(checked), evidence, 'events', { words: true }));
  return { item: problems.length ? null : checked, problems };
}

/** One or two distributions: parameter domains, one kind of axis and a region from the shared check; document parameters must be printed. */
function checkDistribution(raw: unknown, evidence: string): BoardCheck {
  if (isObj(raw) && blank(raw.dists)) return none();
  const item = isObj(raw) ? { ...raw, kind: 'distribution' as const } : raw;
  const problems = distributionProblems(item);
  if (problems.length) return { item: null, problems };
  const checked = canonicalDistribution(item);
  if (checked.source === 'document')
    problems.push(...unprinted(distributionQuotes(checked), evidence, 'dists', { words: true }));
  return { item: problems.length ? null : checked, problems };
}

/** Dispatch schema-validated tool data through the same checks in tours, examples and Q&A. */
export function checkBoard(kind: BoardKind, raw: unknown, evidence = ''): BoardCheck {
  return BOARD_TOOLS[kind].check(raw, evidence);
}

export const boardParts = (item: BoardItem) => BOARD_TOOLS[item.kind].parts(item).length;

/** IDs offered to the model for speech-timed emphasis of a tool's parts. */
export function boardPartIds(kind: BoardKind | undefined): string[] {
  return kind ? [...BOARD_TOOLS[kind].focusIds] : [];
}

/** Resolve the real displayed order, including a reordered flow's original node IDs. */
export function boardPart(item: BoardItem, id: string): number {
  return BOARD_TOOLS[item.kind].parts(item).indexOf(id);
}

// ------------------------------------------------------------------------------------------------- schemas

const field = (maxLength: number, description: string) => ({ type: 'string', maxLength, description });
const object = (properties: Record<string, object>) => ({
  type: 'object',
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
});

function formulaSchema() {
  return object({
    title: field(BOARD_LIMITS.title, 'What the formula computes, at most 6 words.'),
    latex: {
      ...field(
        400,
        'The whole equation in LaTeX that KaTeX renders, without its number. Mathematics only, never words.',
      ),
      minLength: 1,
    },
    terms: {
      type: 'array',
      minItems: BOARD_LIMITS.terms[0],
      maxItems: BOARD_LIMITS.terms[1],
      items: object({
        latex: {
          ...field(
            BOARD_LIMITS.termLatex,
            'Copied character for character from latex: one symbol or a complete group.',
          ),
          minLength: 1,
        },
        label: { ...field(BOARD_LIMITS.termLabel, 'What this part means, at most 5 plain words.'), minLength: 1 },
      }),
    },
  });
}

function barsSchema() {
  return object({
    title: field(BOARD_LIMITS.title, 'What the bars compare, at most 6 words.'),
    unit: field(BOARD_LIMITS.unit, 'The metric, such as BLEU, % or F1.'),
    higher_is_better: { type: 'boolean' },
    bars: {
      type: 'array',
      maxItems: BOARD_LIMITS.bars[1],
      description: '2-6 results for one metric, or empty for no board.',
      items: object({
        label: { ...field(BOARD_LIMITS.barLabel, 'The method or setting, at most 4 words.'), minLength: 1 },
        value: { type: 'number', description: 'Copied exactly as printed in the evidence.' },
      }),
    },
  });
}

function flowSchema() {
  const node = { type: 'string', enum: FLOW_NODE_IDS };
  return object({
    title: field(BOARD_LIMITS.title, 'What the flow shows, at most 6 words.'),
    nodes: {
      type: 'array',
      maxItems: BOARD_LIMITS.nodes[1],
      description: '3-7 stages in the order the work flows, or empty for no board.',
      items: object({ id: node, label: { ...field(BOARD_LIMITS.nodeLabel, 'At most 3 words.'), minLength: 1 } }),
    },
    edges: {
      type: 'array',
      maxItems: BOARD_LIMITS.edges,
      description: 'Arrows from an earlier node to a later one.',
      items: object({ from: node, to: node }),
    },
  });
}

interface BoardTool {
  schema: () => object;
  check: (raw: unknown, evidence: string) => BoardCheck;
  focusIds: readonly string[];
  parts: (item: BoardItem) => string[];
}
const partIds = (prefix: string, count: number) => Array.from({ length: count }, (_, i) => `${prefix}-${i + 1}`);

/** One registration per native visualization. A new BoardItem kind must register all four capabilities. */
const BOARD_TOOLS = {
  formula: {
    schema: formulaSchema,
    check: (raw) => checkFormula(raw),
    focusIds: partIds('term', BOARD_LIMITS.terms[1]),
    parts: (item) => (item.kind === 'formula' ? partIds('term', item.terms.length) : []),
  },
  flow: {
    schema: flowSchema,
    check: checkFlow,
    focusIds: FLOW_NODE_IDS,
    parts: (item) => (item.kind === 'flow' ? item.nodes.map((node) => node.id) : []),
  },
  bars: {
    schema: barsSchema,
    check: checkBars,
    focusIds: partIds('bar', BOARD_LIMITS.bars[1]),
    parts: (item) => (item.kind === 'bars' ? partIds('bar', item.bars.length) : []),
  },
  plot: {
    schema: () => PLOT_BOARD_SCHEMA,
    check: checkPlot,
    focusIds: [...partIds('curve', PLOT_LIMITS.curves), ...partIds('mark', PLOT_LIMITS.marks)],
    parts: (item) =>
      item.kind === 'plot'
        ? [...partIds('curve', item.curves.length), ...partIds('mark', item.marks?.length ?? 0)]
        : [],
  },
  scene: {
    schema: () => SCENE_SCHEMA,
    check: checkScene,
    focusIds: partIds('object', SCENE_MAX_OBJECTS),
    parts: (item) => (item.kind === 'scene' ? partIds('object', item.objects.length) : []),
  },
  heatmap: {
    schema: () => HEATMAP_SCHEMA,
    check: checkHeatmap,
    focusIds: partIds('row', HEATMAP_LIMITS.labels[1]),
    parts: (item) => (item.kind === 'heatmap' ? partIds('row', item.rows.length) : []),
  },
  scatter: {
    schema: () => SCATTER_SCHEMA,
    check: checkScatter,
    focusIds: partIds('point', SCATTER_LIMITS.points[1]),
    parts: (item) => (item.kind === 'scatter' ? partIds('point', item.points.length) : []),
  },
  shapes: {
    schema: () => SHAPES_SCHEMA,
    check: checkShapes,
    focusIds: partIds('matrix', SHAPES_LIMITS.matrices),
    parts: (item) =>
      item.kind === 'shapes' ? partIds('matrix', item.terms.filter((term) => term.kind === 'matrix').length) : [],
  },
  timeline: {
    schema: () => TIMELINE_SCHEMA,
    check: checkTimeline,
    focusIds: [...partIds('event', TIMELINE_LIMITS.events[1]), ...partIds('span', TIMELINE_LIMITS.spans)],
    parts: (item) =>
      item.kind === 'timeline'
        ? [...partIds('event', item.events.length), ...partIds('span', item.spans?.length ?? 0)]
        : [],
  },
  distribution: {
    schema: () => DISTRIBUTION_SCHEMA,
    check: checkDistribution,
    focusIds: ['dist-1', 'dist-2', 'region'],
    parts: (item) =>
      item.kind === 'distribution' ? [...partIds('dist', item.dists.length), ...(item.region ? ['region'] : [])] : [],
  },
} satisfies Record<BoardKind, BoardTool>;

export const BOARD_KINDS = Object.freeze(Object.keys(BOARD_TOOLS) as BoardKind[]);
/** The kinds questions and worked-example frames offer; the newer kinds are for tour steps only (for now). */
export const LEGACY_BOARD_KINDS: readonly BoardKind[] = Object.freeze(['formula', 'flow', 'bars', 'plot', 'scene']);

/** Provider schemas stay separate from canonical player validation. */
export function boardSchema(kind: BoardKind) {
  return BOARD_TOOLS[kind].schema();
}
