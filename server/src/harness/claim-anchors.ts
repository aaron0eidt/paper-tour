import type { Doc, DocSentence } from '../../../shared/paper';
import type { IndexedElement } from '../../../shared/contracts';
import { indexElements } from '../elements';
import { bm25, searchTerms } from './ask-retrieval';
import { proseSentences } from './paper-block';

// Where a claim tour points (claims.ts). The authors state a claim in the abstract, the introduction and the
// conclusion, but a guide teaches it where the paper develops it: the method for how and why, the tables and figures
// for the evidence, the limitations for the catch. Code finds those places, so that the camera reads forward through
// the paper and does not return to the front at the start of every chapter.

/** Where things stand in a paper, and the sentences its body holds. */
export interface Reading {
  /** Page and then height on it (see `positions`) of a sentence, block, section, figure, table or equation; else 0. */
  at(id: string | undefined): number;
  /** The page of the same; 0 when unknown. */
  page(id: string | undefined): number;
  /** The section a sentence or equation is in; for a figure or table the last section that opens before it. */
  section(id: string): string | undefined;
  /** Prose of the body in reading order: no footnote, nothing in the abstract, the introduction or the background. */
  body: DocSentence[];
  /** The body sentence with that ID; none for anything else (a front-matter sentence, a figure). */
  sentence(id: string): DocSentence | undefined;
  /** The sentence's body neighbour after it in its block. */
  next(id: string): DocSentence | undefined;
  /** The body sentence before it in reading order. */
  previous(id: string): DocSentence | undefined;
  /** BM25 of every body sentence against a text, by ID. */
  scores(text: string): Map<string, number>;
  /** How many different words of a text each body sentence has, by ID. */
  shared(text: string): Map<string, number>;
  /** Body sentences that cite a figure or table. */
  citing(id: string): DocSentence[];
}

const HEIGHT = 10_000;

// Elements at the same height (sentences of one line) keep the order of the document.
const positionsOf = (index: IndexedElement[]) =>
  new Map(index.map((e, i) => [e.id, (e.page ?? 1) * HEIGHT + (e.bbox?.[1] ?? 0) + i / 1e7]));

/** Page and then height on it of every sentence, block, section, figure, table and equation. */
export const positions = (doc: Doc): Map<string, number> => positionsOf(indexElements(doc));

export function readingOf(doc: Doc, front: Set<string>): Reading {
  const index = indexElements(doc);
  const page = new Map(index.map((e) => [e.id, e.page ?? 1]));
  const at = positionsOf(index);
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  const blockOf = new Map([...doc.sentences, ...doc.equations].map((e) => [e.id, e.block]));
  const notes = new Set(doc.blocks.filter((b) => b.type === 'footnote').flatMap((b) => b.sentences));
  const body = proseSentences(doc).filter((s) => !notes.has(s.id) && !front.has(s.id));
  const byId = new Map(body.map((s) => [s.id, s]));
  const place = new Map(body.map((s, i) => [s.id, i]));
  const sections = doc.sections.map((s) => ({ id: s.id, at: at.get(s.block) ?? 0 })).sort((a, b) => a.at - b.at);
  const section = (id: string): string | undefined => {
    const block = blockOf.get(id);
    if (block) return blocks.get(block)?.section;
    const where = at.get(id);
    return where === undefined ? undefined : sections.filter((s) => s.at <= where).at(-1)?.id;
  };
  const terms = body.map((s) => searchTerms(s.text));
  const cache = new Map<string, Map<string, number>>();
  const sharing = new Map<string, Map<string, number>>();
  return {
    at: (id) => (id ? (at.get(id) ?? 0) : 0),
    page: (id) => (id ? (page.get(id) ?? 0) : 0),
    section,
    body,
    sentence: (id) => byId.get(id),
    previous: (id) => body[(place.get(id) ?? 0) - 1],
    next: (id) => {
      const block = blocks.get(byId.get(id)?.block ?? '');
      const following = block?.sentences[block.sentences.indexOf(id) + 1];
      return following ? byId.get(following) : undefined;
    },
    scores: (text) => {
      const known = cache.get(text);
      if (known) return known;
      const query = new Map<string, number>();
      for (const t of searchTerms(text)) query.set(t, 1);
      const scored = new Map(bm25(terms, query).map((score, i) => [body[i].id, score] as const));
      cache.set(text, scored);
      return scored;
    },
    shared: (text) => {
      const known = sharing.get(text);
      if (known) return known;
      const wanted = new Set(searchTerms(text));
      const counted = new Map(body.map((s, i) => [s.id, new Set(terms[i].filter((t) => wanted.has(t))).size] as const));
      sharing.set(text, counted);
      return counted;
    },
    citing: (id) =>
      (doc.figures.find((f) => f.id === id)?.referenced_by ?? [])
        .map((s) => byId.get(s))
        .filter((s): s is DocSentence => Boolean(s)),
  };
}

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;
/** A sentence of fewer words is a fragment (a heading run into text, a formula's tail): no passage starts there. */
const FRAGMENT = 6;
/** Sentences this long match a text on their full score; shorter ones count in proportion. */
const FULL_SCORE = 12;
/** A sentence with fewer different words of the claim in common matches it by chance. */
const RELATED = 3;

/**
 * The sentences among `list` that are about a text, best first: those that share enough words with it, ranked by BM25.
 * A short sentence with one word in common outranks a full one under BM25's length normalisation: it is weighed down.
 */
function related(reading: Reading, list: DocSentence[], text: string): { sentence: DocSentence; score: number }[] {
  const scores = reading.scores(text);
  const shared = reading.shared(text);
  return list
    .filter((s) => (shared.get(s.id) ?? 0) >= RELATED)
    .map((sentence) => ({
      sentence,
      score: (scores.get(sentence.id) ?? 0) * Math.min(1, wordCount(sentence.text) / FULL_SCORE),
    }))
    .sort((a, b) => b.score - a.score);
}

/** At most this many sentences point at the passage where a claim is developed. */
const SPAN = 2;
/** A sentence that matches the claim better is taken from the passages this many pages after the first. */
const REACH = 1;

/**
 * The sentences where the paper develops a claim. The things it rests on (a sentence of its reason or evidence, an
 * equation, a figure or a table, which is developed where the text first cites it) each have a passage: what their
 * section says before them. The step points at the sentence about the claim that matches best (in the passages as far
 * as the page after the earliest thing), else at the sentence among its own reason and evidence (`sources`) that
 * matches best; a step never points at a sentence that neither is the claim's nor shares enough words with it, and
 * the sentence after the first points with it only when it is one of the two. Sentences in `avoid` are the ones other
 * steps point at; those in `apart` are the first sentences of the steps that follow, which this step does not begin
 * with. Empty when there is nothing to point at, which leaves the step to the sentences where the authors state the claim.
 */
export function developedAt(
  reading: Reading,
  text: string,
  sources: string[],
  avoid: Set<string>,
  apart: ReadonlySet<string> = new Set(),
): string[] {
  // A figure is discussed where the body first cites it; its own place on the page is wherever the layout put it.
  const spot = (id: string) => reading.citing(id).sort((a, b) => reading.at(a.id) - reading.at(b.id))[0]?.id ?? id;
  const free = (list: DocSentence[]) => list.filter((s) => !avoid.has(s.id));
  const spots = sources
    .map(spot)
    .filter((id) => reading.at(id))
    .sort((a, b) => reading.at(a) - reading.at(b));
  const passages: { page: number; list: DocSentence[] }[] = [];
  for (const first of spots) {
    const limit = reading.at(first);
    const section = reading.section(first);
    const inSection = reading.body.filter((s) =>
      section ? reading.section(s.id) === section : reading.page(s.id) === reading.page(first),
    );
    const sentences = inSection.filter((s) => wordCount(s.text) >= FRAGMENT);
    const within = sentences.length ? sentences : inSection;
    const before = (list: DocSentence[]) => list.filter((s) => reading.at(s.id) <= limit);
    // The passage before the thing it rests on, else the rest of its section; only when every sentence of it is pointed
    // at by another step is the passage shared with that step. A thing in the front matter has no passage of its own.
    const list = [before(free(within)), free(within), before(within), within].find((l) => l.length);
    if (list) passages.push({ page: reading.page(first), list });
  }
  const reach = (passages[0]?.page ?? 0) + REACH;
  const matches = passages
    .filter((p) => p.page <= reach)
    .flatMap((p) => related(reading, p.list, text))
    .sort((a, b) => b.score - a.score);
  // The claim's own sentences, the best match first.
  const scores = reading.scores(text);
  const own = [...new Set(sources)]
    .flatMap((id) => reading.sentence(id) ?? [])
    .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0) || reading.at(a.id) - reading.at(b.id));
  const sentence = matches.find((m) => !apart.has(m.sentence.id))?.sentence ?? own.find((s) => !apart.has(s.id));
  if (!sentence) return [];
  const shared = reading.shared(text);
  const follower = reading.next(sentence.id);
  const fits = (s: DocSentence) => own.includes(s) || (shared.get(s.id) ?? 0) >= RELATED;
  return [
    sentence.id,
    ...(follower && !avoid.has(follower.id) && !apart.has(follower.id) && fits(follower) ? [follower.id] : []),
  ].slice(0, SPAN);
}

/** The body sentences among `list` that match a text best (none when nothing matches), in reading order. */
export function bestBody(reading: Reading, list: DocSentence[], text: string, most = SPAN): string[] {
  const scores = reading.scores(text);
  return list
    .filter((s) => (scores.get(s.id) ?? 0) > 0)
    .sort((a, b) => (scores.get(b.id) ?? 0) - (scores.get(a.id) ?? 0))
    .slice(0, most)
    .sort((a, b) => reading.at(a.id) - reading.at(b.id))
    .map((s) => s.id);
}

/**
 * What the camera costs on its way through a list of pages: the jumps back by more than a page, and the pages those
 * jumps go back beyond the first (a jump of a page is not counted, as a guide may turn back to the page before).
 */
export function backTravel(pages: number[]): { jumps: number; excess: number } {
  let jumps = 0;
  let excess = 0;
  for (let i = 1; i < pages.length; i++) {
    const back = pages[i - 1] - pages[i];
    if (back > 1) {
      jumps++;
      excess += back - 1;
    }
  }
  return { jumps, excess };
}

/**
 * The order of the items that costs the camera least on its way through their pages (`pages` of an item: the pages of
 * its steps in teaching order), between a fixed first page and last page: the fewest pages gone back, then the fewest
 * jumps back; the given order among equals. A tour has at most a handful of chapters, so every order is tried.
 */
export function bestOrder(count: number, pages: (item: number) => number[], first: number[], last: number[]): number[] {
  let winner: { order: number[]; cost: ReturnType<typeof backTravel> } | undefined;
  const visit = (order: number[], rest: number[]) => {
    if (!rest.length) {
      const cost = backTravel([...first, ...order.flatMap(pages), ...last]);
      if (
        !winner ||
        cost.excess < winner.cost.excess ||
        (cost.excess === winner.cost.excess && cost.jumps < winner.cost.jumps)
      )
        winner = { order, cost };
      return;
    }
    rest.forEach((item, i) => visit([...order, item], [...rest.slice(0, i), ...rest.slice(i + 1)]));
  };
  visit(
    [],
    Array.from({ length: count }, (_, i) => i),
  );
  return winner?.order ?? [];
}
