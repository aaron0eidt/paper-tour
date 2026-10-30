import Ajv2020 from 'ajv/dist/2020.js';
import type { Doc } from '../../../shared/paper';
import type { Beat, PlanChapter, Preset, TourPlan } from './beats';
import type { PaperCard } from './card';

// A lecture deck is planned slide by slide in its own order (notes/ROADMAP.md, wave 2): the title, the agenda, the thanks
// and the references are skipped, trivial neighbours merge into one step, and every step is narrated as the lecturer
// would say it: the slides are connected into a story, the point is explained, the bullets are never read. Code reads each
// page of doc.json into a slide card; one call plans the steps from the cards; code checks the plan and builds the beats.

/** What a slide is for in the deck, as far as its title and text say; only "content" slides are taught. */
export type SlideRole = 'title' | 'agenda' | 'thanks' | 'references' | 'licence' | 'content';

/** One slide, read from its page. */
export interface SlideCard {
  /** The page, which is the slide's number. */
  page: number;
  /** The slide's title: its first heading, or empty. */
  title: string;
  /** The sentence of the title, which a step can point at. */
  titleId?: string;
  /** The text of the slide besides its title, as sentences in reading order. */
  body: { id: string; text: string }[];
  words: number;
  role: SlideRole;
  /** A slide with hardly any text besides its title: a picture, a plot, a table or code the page image shows. */
  picture: boolean;
  /** Figures and tables ingestion found on the slide. */
  figures: string[];
}

/** The block types of a slide whose sentences a tour may speak about and highlight: the text, its titles and its notes. */
export const DECK_PROSE = new Set(['paragraph', 'footnote', 'title', 'authors', 'other', 'heading']);
/** Slides with fewer words than this besides their title are mostly a picture. */
const PICTURE_WORDS = 12;
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const norm = (text: string) =>
  text
    .toLowerCase()
    .replace(/\((?:cont(?:inued)?\.?|fortsetzung|suite)\)|\bcont(?:inued)?\.?\b/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

/** A title that is nothing but one of these phrases (with a short tail such as "of the lecture"), never a longer title that starts with one. */
const whole = (phrases: string) =>
  new RegExp(`^(?:${phrases})(?:\\s+(?:of the (?:lecture|talk|course|day)|for today|today|slide))?\\s*[:.!?]*$`, 'i');
const AGENDA = whole(
  "agenda|outline|overview|contents?|table of contents|today(?:'s)?(?: plan)?|plan|roadmap|inhalt(?:sverzeichnis)?|gliederung|übersicht|überblick|sommaire|índice|indice|announcements?|ankündigungen?|administrative(?: details| stuff| matters)?|admin|logistics|housekeeping|reminders?",
);
const THANKS = whole(
  'thank you(?: very much)?|thanks|questions|any questions|q\\s?&\\s?a|danke|vielen dank|fragen|noch fragen|merci|gracias|the end|ende',
);
const REFERENCES = whole(
  'references?|bibliography|literatur(?:verzeichnis)?|quellen(?:verzeichnis)?|sources|further reading|weiterführende literatur|référence|referencias|bibliograf\\w*',
);
const LICENCE =
  /(creative commons|terms of use|citing these materials|all rights reserved|©|\(c\)\s*\d{4}|licen[cs]ed under|open ?courseware|nutzungsbedingungen)/i;

/** The role of a slide: its title and text against the usual wording of a deck's opening, closing and housekeeping. */
function roleOf(card: Omit<SlideCard, 'role'>, last: number): SlideRole {
  const title = card.title.trim();
  const text = card.body.map((b) => b.text).join(' ');
  if (THANKS.test(title) || (!title && words(text) <= 6 && THANKS.test(text.trim()))) return 'thanks';
  if (REFERENCES.test(title)) return 'references';
  if (card.page >= last - 1 && card.words < 80 && LICENCE.test(`${title} ${text}`)) return 'licence';
  if (AGENDA.test(title)) return 'agenda';
  if (card.page === 1 && card.words <= 25 && card.body.length <= 3) return 'title';
  return 'content';
}

const cards = new WeakMap<Doc, SlideCard[]>();

/** Every page of a deck read as a slide card: its title, its text and what it is for. Cached per document. */
export function slideCards(doc: Doc): SlideCard[] {
  const known = cards.get(doc);
  if (known) return known;
  const sentences = new Map(doc.sentences.map((s) => [s.id, s.text]));
  const last = doc.pages.length;
  const out = doc.pages.map((page): SlideCard => {
    const blocks = doc.blocks.filter((b) => b.page === page.n && DECK_PROSE.has(b.type));
    const heading = blocks.find((b) => (b.type === 'heading' || b.type === 'title') && b.sentences.length);
    const body = blocks
      .filter((b) => b !== heading)
      .flatMap((b) => b.sentences)
      .flatMap((id) => (sentences.has(id) ? [{ id, text: sentences.get(id)! }] : []));
    const titleId = heading?.sentences[0];
    const card = {
      page: page.n,
      title: (titleId ? (sentences.get(titleId) ?? '') : '').replace(/\s+/g, ' ').trim(),
      ...(titleId ? { titleId } : {}),
      body,
      words: body.reduce((n, b) => n + words(b.text), 0),
      picture: false,
      figures: doc.figures.filter((f) => f.page === page.n).map((f) => f.id),
    };
    const base = { ...card, picture: card.words < PICTURE_WORDS };
    return { ...base, role: roleOf(base, last) };
  });
  cards.set(doc, out);
  return out;
}

// ---------------------------------------------------------------------------------------------------- the plan

/** Why a slide is not taught. */
export const SKIP_REASONS = [
  'title',
  'agenda',
  'admin',
  'thanks',
  'references',
  'licence',
  'duplicate',
  'other',
] as const;
export type SkipReason = (typeof SKIP_REASONS)[number];

/** One step of the tour: a slide or a few neighbouring ones that make one point together. */
export interface DeckBeat {
  slides: number[];
  /** The deck's own section, shared by the steps of it. */
  chapter: string;
  title: string;
  point: string;
  /** An earlier slide this step needs to make sense; 0 for none. */
  callback: number;
}
export interface DeckPlan {
  plan: string;
  /** The through-line of the lecture, which every step may lean on. */
  story: string;
  beats: DeckBeat[];
  skipped: { slide: number; reason: SkipReason }[];
}

/** Steps a deck tour may have by preset: about one per three content slides, always under the global limit of 30. */
export const DECK_STEPS: Record<Preset, number> = { quick: 5, standard: 10, deep: 18 };
/** Most slides one step covers. */
const BEAT_SLIDES = 4;
const POINT_WORDS = 30;

/**
 * The plan call's response schema. The provider does not enforce the sizes of lists, so the schema the code checks
 * answers against (`strict` false) leaves them to cleanDeckPlan, which cuts a step to four slides and asks for a merge.
 */
export function deckSchema(slides: number, preset: Preset, strict = true) {
  const object = (properties: Record<string, object>) => ({
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  });
  // Slide numbers are strings of an enum, the kind of constraint the provider is known to enforce; the code reads them as
  // numbers (and also accepts numbers from a model that answered with them).
  const numbers = (from: number) => Array.from({ length: slides + 1 - from }, (_, i) => String(from + i));
  const slide = strict ? { type: 'string', enum: numbers(1) } : { type: ['string', 'integer'] };
  const earlier = strict ? { type: 'string', enum: numbers(0) } : { type: ['string', 'integer'] };
  const short = (most: number) => ({ type: 'string', minLength: 1, maxLength: most });
  return object({
    plan: { type: 'string', maxLength: 1000 },
    story: short(420),
    beats: {
      type: 'array',
      ...(strict ? { minItems: 1, maxItems: DECK_STEPS[preset] } : {}),
      items: object({
        slides: { type: 'array', ...(strict ? { minItems: 1, maxItems: BEAT_SLIDES } : {}), items: slide },
        chapter: short(60),
        title: short(60),
        point: short(POINT_WORDS * 9),
        callback: earlier,
      }),
    },
    skipped: {
      type: 'array',
      items: object({ slide, reason: { type: 'string', enum: [...SKIP_REASONS] } }),
    },
  });
}

/** One slide as the planner reads it: number, title, what code thinks it is, and its text. */
export function slideLine(card: SlideCard, most = 260): string {
  const kind =
    card.role !== 'content' ? ` (looks like: ${card.role})` : card.picture ? ' (a picture, plot, table or code)' : '';
  const text = card.body
    .map((b) => b.text)
    .join(' ; ')
    .replace(/\s+/g, ' ');
  const shown = text.length > most ? `${text.slice(0, most - 3)}...` : text;
  return `SLIDE ${card.page} "${card.title || 'no title'}"${kind}${shown ? `: ${shown}` : ''}`;
}

export function deckTask(language: string, deck: SlideCard[], preset: Preset, title: string): string {
  const lang = JSON.stringify(language);
  const content = deck.filter((c) => c.role === 'content').length;
  return [
    `TASK: plan a guided tour of this lecture deck in ${lang}. The deck has ${deck.length} slides, ${content} of them teaching content, and the tour has at most ${DECK_STEPS[preset]} steps. Each step is narrated as the lecturer would say it, so plan what the lecturer teaches, not what the slides list.`,
    `1. A step covers one slide, or a few neighbouring slides that make one point together: builds of the same slide, a slide and the picture that illustrates it, a short run on one idea. List its slides in "slides", in deck order, at most ${BEAT_SLIDES}.`,
    `2. Skip the slides that teach nothing: the title slide, the agenda or outline, announcements, thanks and questions, references and licences. List every skipped slide in "skipped" with its reason.`,
    `3. Cover every other slide: put it in a step or skip it as a "duplicate" of a neighbour. A slide with only a title is usually a picture, a plot, a table or code (the tour sees its image): merge it into the step of the slide it illustrates, or give it a step of its own when it makes a point of its own.`,
    `4. The steps follow the deck's order. "point" is one plain sentence of at most ${POINT_WORDS} words in your own words: what the lecturer teaches with these slides, not a list of their bullets.`,
    `5. "chapter" is the deck's own section that the step belongs to, in at most 5 words; the steps of one section share the same text, and the tour has a handful of sections at most.`,
    `6. "callback" is 0, or the number of an earlier slide whose content this step needs to make sense (a baseline, a definition, a method it reuses).`,
    `7. "story" is the through-line of the whole lecture in at most 60 words: the question it starts from, how it proceeds and where it ends.`,
    `DECK: ${title}`,
    ...deck.map((c) => slideLine(c)),
  ].join('\n');
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
const flat = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
/** A slide number as the model wrote it, a numeral in a string or a number; NaN when it is neither. */
const slideNumber = (value: unknown): number =>
  typeof value === 'number' ? value : typeof value === 'string' && /^\s*\d+\s*$/.test(value) ? Number(value) : NaN;
const ids = (value: unknown, count: number): number[] =>
  [
    ...new Set(
      (Array.isArray(value) ? value : []).map(slideNumber).filter((n) => Number.isInteger(n) && n >= 1 && n <= count),
    ),
  ].sort((a, b) => a - b);

/** Slides that stay in the tour: those code takes for content. */
const taught = (deck: SlideCard[]) => deck.filter((c) => c.role === 'content');

/** The steps merged until at most `most` remain: the neighbours with the fewest slides together first. */
export function mergeToBudget(beats: DeckBeat[], most: number): DeckBeat[] {
  const out = beats.map((b) => ({ ...b, slides: [...b.slides] }));
  while (out.length > most && out.length > 1) {
    let at = 0;
    let least = Infinity;
    out.forEach((b, i) => {
      const next = out[i + 1];
      const size = next ? b.slides.length + next.slides.length : Infinity;
      if (size < least) [at, least] = [i, size];
    });
    const [a, b] = [out[at], out[at + 1]];
    out.splice(at, 2, {
      ...a,
      slides: [...a.slides, ...b.slides],
      chapter: a.chapter || b.chapter,
      point: `${a.point} ${b.point}`.trim().slice(0, 400),
    });
  }
  return out;
}

/**
 * The deck plan with only real slides, in deck order, each slide in at most one step and no step covering a slide of
 * another, or the problems for one repair turn. Boilerplate slides code recognises never stay in a step; content slides
 * that no step covers and the plan does not skip are reported. What is still uncovered is attached by `attachUncovered`.
 */
export function cleanDeckPlan(
  value: unknown,
  deck: SlideCard[],
  preset: Preset,
): { plan: DeckPlan | null; problems: string[] } {
  const check = ajv.compile(deckSchema(deck.length, preset, false));
  if (!check(value))
    return {
      plan: null,
      problems: (check.errors ?? []).slice(0, 8).map((e) => `${e.instancePath || '/'}: ${e.message}`),
    };
  const raw = value as {
    plan: string;
    story: string;
    beats: Record<string, unknown>[];
    skipped: Record<string, unknown>[];
  };
  const role = new Map(deck.map((c) => [c.page, c.role]));
  const problems: string[] = [];
  const used = new Set<number>();
  const beats: DeckBeat[] = [];
  const ordered = raw.beats
    .map((beat, i) => ({ beat, i, slides: ids(beat.slides, deck.length) }))
    .filter((entry) => entry.slides.length)
    .sort((a, b) => a.slides[0] - b.slides[0] || a.i - b.i);
  for (const { beat, slides } of ordered) {
    // A slide in a step already is not in this one; slides code takes for boilerplate are never taught.
    const own = slides.filter((n) => !used.has(n) && role.get(n) === 'content').slice(0, BEAT_SLIDES);
    if (!own.length) continue;
    const title = flat(beat.title);
    const point = flat(beat.point);
    if (!point) {
      problems.push(`step for slide ${own[0]}: give the point the lecturer makes`);
      continue;
    }
    const before = beats.at(-1);
    if (before && own[0] < Math.max(...before.slides)) {
      problems.push(
        `slides ${own.join(', ')}: a step may not start before the previous step ends; keep the deck's order`,
      );
      continue;
    }
    for (const n of own) used.add(n);
    const callback = slideNumber(beat.callback);
    beats.push({
      slides: own,
      chapter: flat(beat.chapter),
      title: title || point.split(' ').slice(0, 6).join(' '),
      point,
      callback: callback >= 1 && callback < own[0] ? callback : 0,
    });
  }
  const skipped = raw.skipped
    .map((s) => ({ slide: slideNumber(s.slide), reason: s.reason as SkipReason }))
    .filter((s) => Number.isInteger(s.slide) && s.slide >= 1 && s.slide <= deck.length && !used.has(s.slide));
  const skippedSlides = new Set(skipped.map((s) => s.slide));
  const loose = taught(deck)
    .map((c) => c.page)
    .filter((n) => !used.has(n) && !skippedSlides.has(n));
  if (loose.length) {
    const many = loose.length > 1;
    problems.push(
      `${many ? 'slides' : 'slide'} ${loose.join(', ')} ${many ? 'are' : 'is'} in no step and not skipped: add ${many ? 'each' : 'it'} to the step of a neighbouring slide, or list ${many ? 'each' : 'it'} in "skipped"`,
    );
  }
  if (raw.beats.length > DECK_STEPS[preset])
    problems.push(`use at most ${DECK_STEPS[preset]} steps: merge neighbouring slides into one step`);
  if (!beats.length)
    return { plan: null, problems: problems.length ? problems : ['beats: no step covers a content slide'] };
  return {
    plan: { plan: flat(raw.plan), story: flat(raw.story), beats, skipped },
    problems,
  };
}

/**
 * The plan with its loose ends tied: a content slide in no step joins the step that surrounds it, else the one before it
 * (a build or a continuation), else the one after it, as long as that has room and no content slide that is neither in
 * it nor skipped on purpose lies in the range it would then span; the steps are merged to the preset's limit. Slides that fit nowhere stay out and are
 * returned, so that the tour can say what it left.
 */
export function attachUncovered(plan: DeckPlan, deck: SlideCard[], preset: Preset): { plan: DeckPlan; left: number[] } {
  const beats = plan.beats.map((b) => ({ ...b, slides: [...b.slides] }));
  const used = new Set(beats.flatMap((b) => b.slides));
  const skipped = new Set(plan.skipped.map((s) => s.slide));
  const left: number[] = [];
  const first = (b: DeckBeat) => Math.min(...b.slides);
  const last = (b: DeckBeat) => Math.max(...b.slides);
  const content = taught(deck).map((c) => c.page);
  for (const card of taught(deck)) {
    if (used.has(card.page) || skipped.has(card.page)) continue;
    const near = (pick: (b: DeckBeat) => boolean, order: (a: DeckBeat, b: DeckBeat) => number) =>
      beats.filter(pick).sort(order)[0];
    const candidates = [
      near(
        (b) => first(b) < card.page && card.page < last(b),
        (a, b) => first(b) - first(a),
      ),
      near(
        (b) => last(b) < card.page,
        (a, b) => last(b) - last(a),
      ),
      near(
        (b) => first(b) > card.page,
        (a, b) => first(a) - first(b),
      ),
    ];
    const target = candidates.find((b) => {
      if (!b || b.slides.length >= BEAT_SLIDES) return false;
      const [lo, hi] = [Math.min(first(b), card.page), Math.max(last(b), card.page)];
      // The step then spans lo to hi, in which every content slide must be this one, the step's own or skipped on purpose.
      return !content.some((n) => n >= lo && n <= hi && n !== card.page && !b.slides.includes(n) && !skipped.has(n));
    });
    if (!target) {
      left.push(card.page);
      continue;
    }
    target.slides = [...target.slides, card.page].sort((a, b) => a - b);
    used.add(card.page);
  }
  return { plan: { ...plan, beats: mergeToBudget(beats, DECK_STEPS[preset]) }, left };
}

/** A plan from the cards alone, when the plan call cannot give one: equal titles are builds of one slide and merge. */
export function fallbackDeckPlan(deck: SlideCard[], preset: Preset, title: string): DeckPlan {
  const beats: DeckBeat[] = [];
  for (const card of taught(deck)) {
    const last = beats.at(-1);
    const same = last && norm(deck[last.slides.at(-1)! - 1].title) === norm(card.title) && norm(card.title) !== '';
    if (last && same && last.slides.length < BEAT_SLIDES) {
      last.slides.push(card.page);
      continue;
    }
    const first = card.body[0]?.text ?? '';
    beats.push({
      slides: [card.page],
      chapter: '',
      title: card.title || `Slide ${card.page}`,
      point: [card.title, first].filter(Boolean).join(': ').slice(0, 280) || `Slide ${card.page}`,
      callback: 0,
    });
  }
  return {
    plan: 'fallback',
    story: title,
    beats: mergeToBudget(beats, DECK_STEPS[preset]),
    skipped: deck.filter((c) => c.role !== 'content').map((c) => ({ slide: c.page, reason: skipReason(c.role) })),
  };
}

function skipReason(role: SlideRole): SkipReason {
  return role === 'content' ? 'other' : role === 'agenda' ? 'agenda' : role;
}

// ------------------------------------------------------------------------------------------------- the beats

/** The words a step's narration aims for: a picture or code slide needs more said than a slide of bullets. */
function sayRange(slides: SlideCard[]): [number, number] {
  const text = slides.reduce((n, c) => n + c.words, 0);
  const picture = slides.some((c) => c.picture);
  const most = picture ? 95 : text <= 40 ? 65 : 80;
  const merged = (slides.length - 1) * 12;
  return [picture ? 45 : 35, Math.min(120, most + merged)];
}

/** A slide as its step quotes it: its number, title and text with the IDs a highlight may use. */
function quoted(card: SlideCard): string[] {
  const title = card.title ? ` "${card.title}"${card.titleId ? ` [${card.titleId}]` : ''}` : '';
  return [
    `SLIDE ${card.page}${title}${card.picture ? ': hardly any text, so it is a picture, plot, table or code: read the attached image' : ''}`,
    ...card.body.map((b) => `  [${b.id}] ${b.text}`),
  ];
}

/** The slides a step covers, with the lecturer's story and the callback, for its direction brief. */
export function deckBrief(beat: Beat, doc: Doc): string[] {
  const all = slideCards(doc);
  const own = (beat.slides ?? []).flatMap((n) => all[n - 1] ?? []);
  const lines = ['THE SLIDES OF THIS STEP (the first is the lead; the page images of the first three are attached):'];
  for (const card of own) lines.push(...quoted(card));
  const earlier = (beat.callbacks ?? []).flatMap((n) => all[n - 1] ?? []);
  for (const card of earlier)
    lines.push(
      `CALLBACK: this step builds on slide ${card.page}${card.title ? ` "${card.title}"` : ''}. Say in one clause how it sets this up, naming it as "slide ${card.page}".`,
    );
  return lines;
}

/** The sentences of a step's slides: the text the learner can read, which the narration should not echo. */
export function slideText(beat: Beat, doc: Doc): string[] {
  const all = slideCards(doc);
  return (beat.slides ?? []).flatMap((n) => {
    const card = all[n - 1];
    return card ? [card.title, ...card.body.map((b) => b.text)].filter(Boolean) : [];
  });
}

/** Whether the narration names the earlier slide a step builds on: its number ("slide 13") or its title. */
export function namesCallback(say: string, beat: Beat, doc: Doc): boolean {
  const earlier = beat.callbacks ?? [];
  if (!earlier.length) return true;
  const all = slideCards(doc);
  const text = norm(say);
  return earlier.some((n) => {
    const title = norm(all[n - 1]?.title ?? '');
    return (
      new RegExp(`\\b(?:slide|slides|folie|folien|diapositive|diapositiva|dia)\\s*(?:number\\s*)?${n}\\b`, 'i').test(
        say,
      ) ||
      (title.length >= 5 && text.includes(title))
    );
  });
}

/**
 * The tour of a deck: one step per planned group of slides, in the deck's order, in chapters named after the deck's own
 * sections. Each step points at its lead slide's text, sees the pages of its slides, and carries the lecture's story, so
 * that the narration connects it to the ones before. A slide whose picture ingestion found as a figure is toured as that
 * figure; the others are read from their page image.
 */
export function deckTourPlan(plan: DeckPlan, card: PaperCard, doc: Doc): TourPlan {
  const deck = slideCards(doc);
  const chapters: PlanChapter[] = [];
  const beats: Omit<Beat, 'id'>[] = [];
  let arc = '';
  plan.beats.forEach((step, index) => {
    const own = step.slides.map((n) => deck[n - 1]).filter((c): c is SlideCard => Boolean(c));
    if (!own.length) return;
    const lead = own[0];
    // The chapter continues until the plan names another; the first step names it after its own title when none is given.
    const title = step.chapter || (index === 0 ? step.title : '');
    if (title && (!chapters.length || norm(chapters.at(-1)!.title) !== norm(title))) {
      arc = `chapter-${chapters.length + 1}`;
      chapters.push({ id: arc, title });
    }
    if (!chapters.length) {
      arc = 'chapter-1';
      chapters.push({ id: arc, title: card.title });
    }
    const pages = new Set(step.slides);
    const evidence = own.flatMap((c) => [...(c.titleId ? [c.titleId] : []), ...c.body.map((b) => b.id)]).slice(0, 12);
    const figure = lead.picture && lead.figures.length === 1 ? lead.figures[0] : undefined;
    const others = own.slice(1).map((c) => slideLine(c, 160));
    beats.push({
      kind: 'point',
      arc,
      point: step.point,
      evidence,
      page: lead.page,
      slides: step.slides,
      ...(step.callback ? { callbacks: [step.callback] } : {}),
      ...(figure ? { target: figure } : {}),
      say: sayRange(own),
      tint: 'blue',
      role: 'Teach these slides as the lecturer would, connected to the steps before them.',
      boardEvidence: [...new Set(deck.filter((c) => pages.has(c.page)).flatMap((c) => c.body.map((b) => b.id)))],
      notes: [
        ...(plan.story ? [`THE LECTURE'S STORY: ${plan.story}`] : []),
        ...(others.length ? [`MORE SLIDES IN THIS STEP (say what each adds): ${others.join(' | ')}`] : []),
      ],
    });
  });
  const last = beats.at(-1);
  if (last) last.questions = card.suggested_questions;
  const counts = new Map<string, number>();
  return {
    type: 'lecture',
    chapters,
    beats: beats.map((b) => {
      const n = (counts.get(b.kind) ?? 0) + 1;
      counts.set(b.kind, n);
      return { ...b, id: `${b.kind}-${n}` };
    }),
  };
}
