import type { Doc, DocExercise, DocExercisePart, DocSentence } from '../../../shared/paper';
import { deckLike, paperLike } from './doctype';
import { DECK_PROSE, slideCards } from './deck';
import { equationTag } from './equations';

/** Block types whose sentences a tour may speak about and highlight (headings appear as section lines). */
const PROSE = new Set(['paragraph', 'footnote']);
/**
 * Outside papers, the lines ingestion takes for a title page are content: a contract's opening sentence names the
 * parties, a letter's first lines name the sender. A paper's author block stays out.
 */
const PROSE_OUTSIDE_PAPERS = new Set([...PROSE, 'title', 'authors', 'other']);

export function proseSentences(doc: Doc): DocSentence[] {
  // A deck's slide titles are content too: a slide with a picture and a title has nothing else a tour could cite.
  const prose = deckLike(doc) ? DECK_PROSE : paperLike(doc) ? PROSE : PROSE_OUTSIDE_PAPERS;
  const types = new Map(doc.blocks.map((b) => [b.id, b.type]));
  return doc.sentences.filter((s) => prose.has(types.get(s.block) ?? ''));
}

/** A task's printed name, without its points or the statement run in after it: "Aufgabe 1: Lineare Gleichungen". */
export function taskName(doc: Doc, task: DocExercise): string {
  const text = (doc.blocks.find((b) => b.id === task.block)?.text ?? '').replace(/\s+/g, ' ').trim();
  const at = text.indexOf(task.number);
  let name = at > 0 ? text.slice(0, at + task.number.length) : at === 0 ? (/^\S+\s*\S+/.exec(text)?.[0] ?? '') : '';
  name = name.replace(/[.:\s]+$/, '') || task.number;
  return task.title && name.length < 40 ? `${name}: ${task.title}` : name;
}

/**
 * Tasks and parts of an exercise sheet: the sentences of each, and the text of the blocks that carry no sentences
 * (display maths, matrices), which the reading-order text above leaves out.
 */
function exerciseLines(doc: Doc): string[] {
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  const prose = new Set(proseSentences(doc).map((s) => s.id));
  const content = (ids: string[]) => {
    const sentences = ids.flatMap((id) => blocks.get(id)?.sentences ?? []).filter((id) => prose.has(id));
    const maths = ids
      .map((id) => blocks.get(id))
      .filter((b) => b && !b.sentences.length && ['equation', 'other', 'paragraph'].includes(b.type) && b.text.trim())
      .map((b) => `[${b!.id}] ${b!.text.replace(/\s+/g, ' ').trim()}`);
    return [
      sentences.length ? `sentences ${sentences.join(', ')}` : '',
      maths.length ? `maths as extracted (often garbled, read it on the page): ${maths.join(' | ')}` : '',
    ].filter(Boolean);
  };
  const points = (p?: number) => (p === undefined ? '' : `, ${p} points`);
  const lines: string[] = [];
  const part = (p: DocExercisePart, depth: number, inner: Set<string>) => {
    const own = p.blocks.filter((id) => !inner.has(id));
    lines.push(
      `${'  '.repeat(depth)}[${p.id}] part ${p.label}${points(p.points)}, page ${p.page}: ${content(own).join('; ')}`,
    );
    for (const sub of p.parts ?? []) part(sub, depth + 1, new Set());
  };
  for (const task of doc.exercises ?? []) {
    lines.push(`[${task.id}] ${taskName(doc, task)}${points(task.points)}, page ${task.page}`);
    const inParts = new Set(task.parts.flatMap((p) => p.blocks));
    const statement = content(task.blocks.filter((id) => !inParts.has(id)));
    if (statement.length) lines.push(`  statement: ${statement.join('; ')}`);
    for (const p of task.parts) part(p, 1, new Set((p.parts ?? []).flatMap((s) => s.blocks)));
  }
  return lines;
}

/**
 * The paper as compact text in reading order: sections, then every prose sentence as `[p3.s12] text`, then figures,
 * tables and equations, and an exercise sheet's tasks. Identical for every call on a document, so the provider can
 * cache it as a shared prefix.
 */
export function paperBlock(doc: Doc): string {
  const deck = deckLike(doc);
  const lines = [
    `TITLE: ${doc.source.title ?? 'Untitled document'}`,
    `PAGES: ${doc.pages.length}${deck ? ' (a slide deck: each page is one slide)' : ''}`,
    '',
  ];
  const prose = new Set(proseSentences(doc).map((s) => s.id));
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const sectionTitle = new Map(doc.sections.map((s) => [s.id, `${s.number ? `${s.number} ` : ''}${s.title}`]));
  let section: string | undefined;
  if (deck) {
    // Every slide is listed, also one with a title and a picture only, so that each can be named by its number.
    lines.push("SLIDES (in order; a slide's title sentence is in brackets after its number):");
    for (const slide of slideCards(doc)) {
      const note =
        slide.role !== 'content'
          ? ` (${slide.role} slide)`
          : slide.picture
            ? ' (hardly any text: a picture, plot, table or code)'
            : '';
      lines.push(
        `## SLIDE ${slide.page}${slide.titleId ? ` [${slide.titleId}]` : ''}: ${slide.title || 'no title'}${note}`,
      );
      for (const { id, text } of slide.body) if (prose.has(id)) lines.push(`[${id}] ${text}`);
    }
  } else lines.push('TEXT (reading order):');
  for (const block of deck ? [] : doc.blocks) {
    const ids = block.sentences.filter((id) => prose.has(id));
    if (!ids.length) continue;
    if (block.section !== section) {
      section = block.section;
      if (section) lines.push(`## [${section}] ${sectionTitle.get(section) ?? ''}`);
    }
    lines.push(ids.map((id) => `[${id}] ${sentences.get(id)!.text}`).join('\n'));
  }
  if (doc.figures.length) lines.push('', 'FIGURES AND TABLES:');
  for (const f of doc.figures) {
    const panels = f.panels.map((p) => `${p.id}${p.label ? ` (${p.label})` : ''}`).join(', ');
    const columns = f.grid ? f.grid.columns.map((c) => c.name) : [];
    lines.push(
      `[${f.id}] ${f.kind} ${f.number}, page ${f.page}: ${f.caption}` +
        (f.referenced_by.length ? ` | cited by ${f.referenced_by.slice(0, 8).join(', ')}` : '') +
        (panels ? ` | panels ${panels}` : '') +
        (f.grid
          ? ` | ${f.grid.rows.length} rows, columns ${columns.slice(0, 8).join(', ')}${columns.length > 8 ? ', ...' : ''}`
          : ''),
    );
  }
  if (doc.equations.length) lines.push('', 'EQUATIONS (extracted text, may be garbled):');
  for (const e of doc.equations) lines.push(`[${e.id}] ${equationTag(e)}, page ${e.page}: ${e.text}`);
  if (doc.exercises?.length) lines.push('', 'EXERCISES (tasks and their parts):', ...exerciseLines(doc));
  return lines.join('\n');
}
