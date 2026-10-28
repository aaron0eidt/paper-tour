// Resolves doc.json IDs to page rects. Tours never carry coordinates; this is the only place where
// an ID becomes geometry.

import { checkBoardItem } from './board';
import { exerciseTargets } from '../../shared/exercises';
import { clipsTableRow, isTableTarget } from '../../shared/tableTargets';
import { DEFAULT_COLOR, DEFAULT_ZOOM_PADDING, splitWords } from './types';
import type { Action, BBox, Doc, DocBlock, DocEquation, DocFigure, DocPanel, DocSentence, Region, Tour } from './types';

export interface PageRects {
  page: number;
  rects: BBox[];
}

export interface PageSize {
  width: number;
  height: number;
}

export type TargetKind = 'sentence' | 'block' | 'section' | 'figure' | 'panel' | 'equation' | 'exercise' | 'page';

export interface Problem {
  level: 'error' | 'warning' | 'info';
  message: string;
}

export function unionRect(rects: BBox[]): BBox {
  return [
    Math.min(...rects.map((r) => r[0])),
    Math.min(...rects.map((r) => r[1])),
    Math.max(...rects.map((r) => r[2])),
    Math.max(...rects.map((r) => r[3])),
  ];
}

function normalize(r: BBox): BBox | null {
  if (!Array.isArray(r) || r.length !== 4 || !r.every(Number.isFinite)) return null;
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
}

/** Merge rects that sit on the same text line and touch, so a block highlight has one rect per line. */
function mergeLines(rects: BBox[]): BBox[] {
  const sorted = [...rects].sort((a, b) => a[1] - b[1] || a[0] - b[0]);
  const out: BBox[] = [];
  for (const r of sorted) {
    const prev = out[out.length - 1];
    if (prev) {
      const overlap = Math.min(prev[3], r[3]) - Math.max(prev[1], r[1]);
      const sameLine = overlap > 0.5 * Math.min(prev[3] - prev[1], r[3] - r[1]);
      const touching = r[0] <= prev[2] + 8 && prev[0] <= r[2] + 8;
      if (sameLine && touching) {
        out[out.length - 1] = unionRect([prev, r]);
        continue;
      }
    }
    out.push([...r]);
  }
  return out;
}

/** Sub-rect of the target's union bbox, given in coordinates normalized to that bbox. */
export function applyRegion(groups: PageRects[], region?: Region): PageRects[] {
  if (!region || !groups.length) return groups;
  const { page, rects } = groups[0];
  const [x0, y0, x1, y1] = unionRect(rects);
  const w = x1 - x0;
  const h = y1 - y0;
  const [a, b, c, d] = region.map((v) => Math.min(1, Math.max(0, v)));
  return [
    {
      page,
      rects: [[x0 + Math.min(a, c) * w, y0 + Math.min(b, d) * h, x0 + Math.max(a, c) * w, y0 + Math.max(b, d) * h]],
    },
  ];
}

export class Resolver {
  readonly doc: Doc | null;
  readonly pageSizes: PageSize[];
  private blocks = new Map<string, DocBlock>();
  private sentences = new Map<string, DocSentence>();
  private sections = new Map<string, string>(); // section id -> heading block id
  private figures = new Map<string, DocFigure>();
  private panels = new Map<string, DocPanel & { page: number }>();
  private equations = new Map<string, DocEquation>();
  private exercises = new Map<string, string[]>();

  constructor(doc: Doc | null, pageSizes: PageSize[]) {
    this.doc = doc;
    this.pageSizes = pageSizes;
    if (!doc) return;
    this.exercises = exerciseTargets(doc);
    for (const b of doc.blocks) this.blocks.set(b.id, b);
    for (const s of doc.sentences) this.sentences.set(s.id, s);
    for (const s of doc.sections) this.sections.set(s.id, s.block);
    for (const f of doc.figures) {
      this.figures.set(f.id, f);
      for (const p of f.panels) this.panels.set(p.id, { ...p, page: f.page });
    }
    for (const e of doc.equations) this.equations.set(e.id, e);
  }

  kind(id: string): TargetKind | null {
    if (this.exercises.has(id)) return 'exercise';
    if (this.sentences.has(id)) return 'sentence';
    if (this.blocks.has(id)) return 'block';
    if (this.sections.has(id)) return 'section';
    if (this.figures.has(id)) return 'figure';
    if (this.panels.has(id)) return 'panel';
    if (this.equations.has(id)) return 'equation';
    const m = /^page([1-9][0-9]*)$/.exec(id);
    if (m && Number(m[1]) <= this.pageSizes.length) return 'page';
    return null;
  }

  /**
   * Rects of an element on its page(s). Sentences give one rect per line; everything else its bbox.
   * With `lines`, blocks and sections give the text lines of their sentences instead (for highlights).
   */
  resolve(id: string, opts: { lines?: boolean } = {}): PageRects[] | null {
    const one = (page: number, rects: BBox[]): PageRects[] | null => {
      // An element on a page the loaded PDF does not have (or with no PDF at all) cannot be shown.
      if (!(page >= 1 && page <= this.pageSizes.length)) return null;
      const clean = rects.map(normalize).filter((r): r is BBox => r !== null);
      return clean.length ? [{ page, rects: clean }] : null;
    };
    const sentence = this.sentences.get(id);
    if (sentence) return one(sentence.page, sentence.rects);

    const task = this.exercises.get(id);
    if (task) {
      const pages = new Map<number, BBox[]>();
      for (const block of task)
        for (const group of this.resolve(block, opts) ?? [])
          pages.set(group.page, [...(pages.get(group.page) ?? []), ...group.rects]);
      const groups = [...pages].sort(([a], [b]) => a - b).map(([page, rects]) => ({ page, rects }));
      return groups.length ? groups : null;
    }

    const blockId = this.blocks.has(id) ? id : this.sections.get(id);
    const block = blockId ? this.blocks.get(blockId) : undefined;
    if (block) {
      if (opts.lines) {
        const lines = block.sentences.flatMap((s) => this.sentences.get(s)?.rects ?? []);
        const clean = lines.map(normalize).filter((r): r is BBox => r !== null);
        if (clean.length) return one(block.page, mergeLines(clean));
      }
      return one(block.page, [block.bbox]);
    }

    const fig = this.figures.get(id) ?? this.panels.get(id) ?? this.equations.get(id);
    if (fig) return one(fig.page, [fig.bbox]);

    if (this.kind(id) === 'page') {
      const n = Number(id.slice(4));
      const size = this.pageSizes[n - 1];
      return one(n, [[0, 0, size.width, size.height]]);
    }
    return null;
  }

  resolveTarget(id: string, region?: Region, opts: { lines?: boolean } = {}): PageRects[] | null {
    const groups = this.resolve(id, region ? {} : opts);
    return groups ? applyRegion(groups, region) : null;
  }

  /** The page an element is on according to doc.json, whether or not the loaded PDF has it. */
  pageOf(id: string): number | null {
    const task = this.exercises.get(id);
    if (task) return this.blocks.get(task[0])?.page ?? null;
    const el =
      this.sentences.get(id) ??
      this.blocks.get(this.sections.get(id) ?? id) ??
      this.figures.get(id) ??
      this.panels.get(id) ??
      this.equations.get(id);
    return el?.page ?? null;
  }
}

const COLORS: readonly string[] = ['yellow', 'blue', 'green', 'pink', 'orange'];
const STYLES: readonly string[] = ['marker', 'underline'];
const SIDES: readonly string[] = ['auto', 'right', 'left', 'top', 'bottom'];

/**
 * Values outside the schema fall back to their defaults, with a warning, instead of reaching the
 * renderer as undefined colors or NaN geometry (ingest/validate.py rejects them). A note without
 * text is dropped.
 */
function checkValues(a: Action, where: string, warn: (message: string) => void): Action | null {
  const given = a as unknown as Record<string, unknown>;
  const out: Record<string, unknown> = { ...given };
  const reset = (field: string, instead: string) => {
    warn(`${field} ${JSON.stringify(given[field])} in ${where} is not valid; using ${instead}.`);
    delete out[field];
  };
  const oneOf = (field: string, allowed: readonly string[], instead: string) => {
    if (given[field] !== undefined && !allowed.includes(given[field] as string)) reset(field, instead);
  };

  const at = given.at_word;
  if (at !== undefined && !(Number.isInteger(at) && (at as number) >= 0)) {
    const n = Math.floor(Number(at));
    const fixed = n >= 0 ? n : 0; // false for NaN too
    warn(`at_word ${JSON.stringify(at)} in ${where} is not a whole number from 0; using ${fixed}.`);
    out.at_word = fixed;
  }
  if (given.persist !== undefined && typeof given.persist !== 'boolean') reset('persist', 'false');
  const region = given.region;
  if (region !== undefined && !(Array.isArray(region) && region.length === 4 && region.every(Number.isFinite))) {
    reset('region', 'the whole target');
  }
  switch (a.type) {
    case 'highlight':
      oneOf('color', COLORS, DEFAULT_COLOR);
      oneOf('style', STYLES, 'marker');
      break;
    case 'box':
      oneOf('color', COLORS, DEFAULT_COLOR);
      if (given.label !== undefined && typeof given.label !== 'string') reset('label', 'no label');
      break;
    case 'zoom': {
      const p = given.padding;
      if (p !== undefined && !(typeof p === 'number' && p >= 0 && p <= 1))
        reset('padding', String(DEFAULT_ZOOM_PADDING));
      break;
    }
    case 'note':
      oneOf('side', SIDES, 'auto');
      if (typeof given.text !== 'string' || !given.text) {
        warn(`The note in ${where} has no text; skipped.`);
        return null;
      }
      break;
    case 'arrow':
      oneOf('from', SIDES, 'auto');
      oneOf('color', COLORS, DEFAULT_COLOR);
      if (given.label !== undefined && typeof given.label !== 'string') reset('label', 'no label');
      break;
    case 'circle':
      oneOf('color', COLORS, DEFAULT_COLOR);
      if (given.label !== undefined && typeof given.label !== 'string') reset('label', 'no label');
      break;
    case 'board': {
      // Retired video boards in saved tours clear the panel; their narration and PDF cues still work.
      if (given.item && typeof given.item === 'object' && 'kind' in given.item && given.item.kind === 'animation')
        return { type: 'board_clear' };
      const item = checkBoardItem(given.item, where, warn);
      if (!item) return null;
      out.item = item;
      break;
    }
    case 'board_focus':
      if (!(Number.isInteger(given.part) && (given.part as number) >= 0)) {
        warn(`board_focus in ${where} needs a part index from 0; skipped.`);
        return null;
      }
      break;
  }
  return out as unknown as Action;
}

/**
 * Drop actions whose IDs do not resolve (so the engine never sees them) and collect problems
 * for the UI. A highlight keeps whichever of its targets resolve.
 */
export function prepareTour(tour: Tour, resolver: Resolver): { tour: Tour; problems: Problem[] } {
  const problems: Problem[] = [];
  const tableRowWarnings: string[] = [];
  const seen = new Set<string>();
  const warn = (message: string) => {
    console.warn(`[tour] ${message}`);
    problems.push({ level: 'warning', message });
  };
  // IDs that doc.json has on pages the loaded PDF lacks are reported together, once.
  const offPage = new Set<string>();
  let offPageCount = 0;
  const known = (id: string, where: string): boolean => {
    if (resolver.resolve(id)) return true;
    const page = resolver.pageOf(id);
    if (page !== null && page > resolver.pageSizes.length) {
      offPage.add(id);
      offPageCount++;
      return false;
    }
    warn(`Unknown ID "${id}" in ${where}; skipped.`);
    return false;
  };

  const chapters = tour.chapters.map((chapter) => ({
    ...chapter,
    steps: chapter.steps.map((step) => {
      if (seen.has(step.id)) problems.push({ level: 'warning', message: `Duplicate step id "${step.id}".` });
      seen.add(step.id);
      const words = splitWords(step.say).length;
      const actions = step.actions.flatMap((raw): Action[] => {
        const where = `step "${step.id}" (${raw.type})`;
        let a = checkValues(raw, where, warn);
        if (!a) return [];
        if (a.type === 'box' && a.region && resolver.doc && clipsTableRow(resolver.doc, a.target, a.region)) {
          tableRowWarnings.push(where);
          console.warn(`[tour] Box cuts a printed table row in ${where}; using a table overview.`);
          const { region: _region, label: _label, ...overview } = a;
          a = overview;
        }
        if (
          (a.type === 'arrow' || a.type === 'circle' || a.type === 'box') &&
          resolver.doc &&
          isTableTarget(resolver.doc, a.target)
        ) {
          // Existing tours benefit too: the centre of a multi-row block is not
          // the narrated value. Outline its grounded extent without labels.
          const { target, color, at_word, persist } = a;
          a = {
            type: 'box',
            target,
            ...(color ? { color } : {}),
            ...(at_word !== undefined ? { at_word } : {}),
            ...(persist !== undefined ? { persist } : {}),
          };
        }
        if (a.at_word !== undefined && a.at_word >= words) {
          problems.push({
            level: 'info',
            message: `at_word ${a.at_word} in ${where} is past the last word (${words} words); it fires at the end.`,
          });
        }
        switch (a.type) {
          case 'clear':
          case 'board':
          case 'board_focus':
          case 'board_clear':
            return [a];
          case 'highlight': {
            const targets = a.targets.filter((t) => known(t, where));
            return targets.length ? [{ ...a, targets }] : [];
          }
          case 'note':
            return known(a.anchor, where) ? [a] : [];
          default:
            return known(a.target, where) ? [a] : [];
        }
      });
      return { ...step, actions };
    }),
  }));

  if (tableRowWarnings.length)
    warn(`${tableRowWarnings.length} table annotations need regeneration for precise rows; showing table overviews.`);

  if (offPage.size) {
    const pages = resolver.pageSizes.length;
    const ids = [...offPage];
    const list = `${ids.slice(0, 6).join(', ')}${ids.length > 6 ? ', …' : ''}`;
    const message = pages
      ? `${offPageCount} target(s) are on pages the PDF does not have (it has ${pages}); skipped: ${list}.`
      : `No PDF pages are loaded, so the tour's ${offPageCount} target(s) are skipped.`;
    console.warn(`[tour] ${message}`);
    // Without a PDF the load error already explains it.
    problems.push({ level: pages ? 'warning' : 'info', message });
  }
  return { tour: { ...tour, chapters }, problems };
}
