import Ajv2020 from 'ajv/dist/2020.js';
import type { Color, Doc } from '../../../shared/paper';
import type { BoardKind } from './board';
import { MAX_STEPS, type Beat, type BeatKind, type PlanChapter, type Preset, type TourPlan } from './beats';
import type { CardItem, PaperCard } from './card';
import { DOC_TYPE_HELP, type DocType } from './doctype';
import { proseSentences } from './paper-block';

// Tours of documents that are neither papers nor exercise sheets (notes/HARNESS.md, stage B with the model): one call
// picks the points each chapter of the type's arc makes, with evidence; code turns them into beats.

export type ArcType = Exclude<DocType, 'research_paper' | 'exercise_sheet'>;

/** One chapter of a type's arc: what its points are, how many a preset allows, and how they look. */
interface ArcSpec {
  id: string;
  help: string;
  min: number;
  max: Record<Preset, number>;
  kind: BeatKind;
  tint: Color;
  /** The board the chapter's first step may draw. */
  board?: BoardKind;
  /** The chapter title when the model gives none. */
  title: string;
}

const sizes = (quick: number, standard: number, deep: number) => ({ quick, standard, deep });
const once = sizes(1, 1, 1);
const overview = (help: string): ArcSpec => ({
  id: 'overview',
  help,
  min: 1,
  max: once,
  kind: 'overview',
  tint: 'yellow',
  title: 'Overview',
});
const takeaway = (help: string): ArcSpec => ({
  id: 'takeaway',
  help,
  min: 1,
  max: once,
  kind: 'takeaway',
  tint: 'yellow',
  title: 'Takeaway',
});
const point = (id: string, help: string, min: number, max: Record<Preset, number>, tint: Color, title: string) => ({
  id,
  help,
  min,
  max,
  kind: 'point' as const,
  tint,
  title,
});

export const ARC_SPECS: Record<ArcType, ArcSpec[]> = {
  lecture: [
    overview('what the lecture covers and what the student can do after it'),
    point('topics', "the lecture's main topics, in the lecture's own order", 2, sizes(3, 6, 10), 'blue', 'Topics'),
    takeaway('what to remember from the lecture'),
  ],
  contract: [
    overview('what the document is: who agrees with whom about what, and from when'),
    point(
      'terms',
      'what the reader agrees to: the main duties and rights',
      1,
      sizes(1, 2, 3),
      'blue',
      'What you agree to',
    ),
    {
      ...point(
        'costs',
        'what it costs: every amount the reader pays or may have to pay',
        0,
        sizes(1, 2, 3),
        'green',
        'Costs',
      ),
      board: 'bars',
    },
    {
      ...point(
        'deadlines',
        'deadlines, notice periods, the term and how to end it',
        0,
        sizes(1, 2, 3),
        'pink',
        'Deadlines',
      ),
      board: 'flow',
    },
    point(
      'risks',
      'risks and catches: penalties, liability, automatic renewals and anything easy to miss',
      1,
      sizes(1, 2, 3),
      'orange',
      'Risks',
    ),
    takeaway('what to keep in mind before accepting it'),
  ],
  letter: [
    overview('who writes, about what, and why the reader gets this letter or form'),
    {
      ...point('actions', 'what the reader must do, one action per item, in order', 1, sizes(1, 2, 3), 'blue', 'To do'),
      board: 'flow',
    },
    point('deadlines', 'by when: every date or period the reader must meet', 0, sizes(1, 1, 2), 'pink', 'By when'),
    point(
      'consequences',
      'what happens if the reader does not act, and other facts the reader must know',
      0,
      sizes(0, 1, 2),
      'orange',
      'If you do not act',
    ),
    takeaway('the to-do list in one sentence'),
  ],
  other: [
    overview('what the document is about and why it matters to the reader'),
    point('points', "the main points, in the document's order", 1, sizes(2, 4, 6), 'blue', 'Main points'),
    point('caveats', 'catches, limits or open questions', 0, sizes(0, 1, 2), 'orange', 'Caveats'),
    takeaway('what to remember'),
  ],
};
const TOPIC_BOARDS = ['none', 'formula', 'flow', 'bars'] as const;

export interface ArcItem {
  text: string;
  evidence: string[];
  /** Lecture topics: a short title, the board to draw and a figure or equation the topic is about. */
  title?: string;
  board?: BoardKind;
  visual?: string;
}
export interface ArcPlan {
  plan: string;
  titles: Record<string, string>;
  items: Record<string, ArcItem[]>;
  disclaimer?: string;
}

/** The plan call's response schema; `strict` adds the ID enums the model must choose from. */
export function arcSchema(type: ArcType, doc: Doc, sentenceIds: string[], preset: Preset, strict = true) {
  const specs = ARC_SPECS[type];
  const short = { type: 'string', minLength: 1, maxLength: 80 };
  const evidence = {
    type: 'array',
    minItems: 1,
    maxItems: 3,
    items: strict ? { type: 'string', enum: sentenceIds } : { type: 'string' },
  };
  const object = (properties: Record<string, object>) => ({
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  });
  const text = { type: 'string', minLength: 1, maxLength: 300 };
  const visuals = ['', ...doc.figures.map((f) => f.id), ...doc.equations.map((e) => e.id)];
  const topic = object({
    title: short,
    text,
    evidence,
    board: { type: 'string', enum: TOPIC_BOARDS },
    visual: strict ? { type: 'string', enum: visuals } : { type: 'string' },
  });
  const titled = specs.filter((s) => !(type === 'lecture' && s.id === 'topics'));
  return object({
    plan: { type: 'string', maxLength: 1500 },
    chapter_titles: object(Object.fromEntries(titled.map((s) => [s.id, short]))),
    ...Object.fromEntries(
      specs.map((s) => [
        s.id,
        {
          type: 'array',
          minItems: s.min,
          maxItems: s.max[preset],
          items: type === 'lecture' && s.id === 'topics' ? topic : object({ text, evidence }),
        },
      ]),
    ),
    ...(type === 'contract' ? { disclaimer: { type: 'string', minLength: 1, maxLength: 200 } } : {}),
  });
}

export function arcTask(type: ArcType, language: string, preset: Preset) {
  const lang = JSON.stringify(language);
  const lists = ARC_SPECS[type].map((s) => {
    const most = s.max[preset];
    const count = s.min === most ? `${most}` : `${s.min}-${most}`;
    return `   - ${s.id} (${count}): ${s.help}.`;
  });
  const extra =
    type === 'lecture'
      ? [
          `Each topic has a "title" of at most 5 words in ${lang}. "board" draws the topic on a side board: formula when
   it centres on one formula, flow for a process with stages, bars for numbers the lecture compares, else none.
   "visual" is the ID of a figure or equation the topic is about, or "".`,
        ]
      : type === 'contract'
        ? [`"disclaimer" is one short sentence in ${lang}: this tour explains the document and is not legal advice.`]
        : [];
  const rules = [
    `Fill each list with the points the tour makes, in the order the reader should hear them:\n${lists.join('\n')}`,
    `Each "text" is one plain sentence of at most 30 words in your own words. Keep amounts, dates, periods and names
   exactly as the document writes them.`,
    '"evidence" gives 1-3 sentence IDs from the list in the schema: the sentences that state the point best.',
    'Leave a list empty when the document says nothing about it. Never invent a point.',
    `"chapter_titles" are at most 5 words each, in ${lang}.`,
    ...extra,
  ];
  return [
    `TASK: plan a short guided tour of this document in ${lang}. It is ${DOC_TYPE_HELP[type]}.`,
    ...rules.map((rule, i) => `${i + 1}. ${rule}`),
  ].join('\n');
}

const ajv = new Ajv2020({ strict: false, allErrors: true });

/** A usable plan with only known evidence, or the problems for one repair turn. */
export function cleanArcPlan(
  value: unknown,
  type: ArcType,
  doc: Doc,
  preset: Preset,
): { plan: ArcPlan | null; problems: string[] } {
  const check = ajv.compile(arcSchema(type, doc, [], preset, false));
  if (!check(value))
    return {
      plan: null,
      problems: (check.errors ?? []).slice(0, 8).map((e) => `${e.instancePath || '/'}: ${e.message}`),
    };
  const raw = value as Record<string, unknown> & { plan: string; chapter_titles: Record<string, string> };
  const known = new Set(doc.sentences.map((s) => s.id));
  const visuals = new Set([...doc.figures.map((f) => f.id), ...doc.equations.map((e) => e.id)]);
  const items: Record<string, ArcItem[]> = {};
  const problems: string[] = [];
  for (const spec of ARC_SPECS[type]) {
    const given = (raw[spec.id] ?? []) as (Omit<ArcItem, 'board'> & { board?: string })[];
    items[spec.id] = given
      .map((item) => ({
        text: item.text.replace(/\s+/g, ' ').trim(),
        evidence: [...new Set(item.evidence)].filter((id) => known.has(id)),
        ...(item.title?.trim() ? { title: item.title.trim() } : {}),
        ...(item.board && item.board !== 'none' && TOPIC_BOARDS.includes(item.board as (typeof TOPIC_BOARDS)[number])
          ? { board: item.board as BoardKind }
          : {}),
        ...(item.visual && visuals.has(item.visual) ? { visual: item.visual } : {}),
      }))
      .filter((item) => item.text && item.evidence.length);
    if (items[spec.id].length < spec.min) problems.push(`/${spec.id}: needs ${spec.min} item(s) with known evidence`);
  }
  const titles = Object.fromEntries(
    Object.entries(raw.chapter_titles ?? {})
      .map(([k, v]) => [k, String(v).trim()])
      .filter(([, v]) => v),
  );
  const disclaimer = typeof raw.disclaimer === 'string' ? raw.disclaimer.replace(/\s+/g, ' ').trim() : '';
  if (problems.length) return { plan: null, problems };
  return { plan: { plan: raw.plan, titles, items, ...(disclaimer ? { disclaimer } : {}) }, problems: [] };
}

/** A plan from the card's own items, when the plan call cannot give one. */
export function fallbackArcPlan(card: PaperCard, type: ArcType): ArcPlan {
  const usable = (list: CardItem[]) => list.filter((i) => i.text && i.evidence.length);
  const items: Record<string, ArcItem[]> = Object.fromEntries(ARC_SPECS[type].map((s) => [s.id, []]));
  items.overview = usable([card.problem]);
  items.takeaway = usable([card.takeaway]);
  items[ARC_SPECS[type].find((s) => s.kind === 'point')!.id] = usable([card.key_idea, ...card.method_steps]);
  const catches = { contract: 'risks', letter: 'consequences', other: 'caveats', lecture: '' }[type];
  if (catches) items[catches] = usable(card.limitations);
  return { plan: 'fallback', titles: {}, items };
}

/** "Not legal advice" in the tour's language, when the plan did not word it. */
const NOT_ADVICE: Record<string, string> = {
  en: 'This tour explains the document in plain words; it is not legal advice.',
  de: 'Diese Tour erklärt das Dokument in einfachen Worten; sie ist keine Rechtsberatung.',
  fr: "Cette visite explique le document avec des mots simples ; ce n'est pas un conseil juridique.",
  es: 'Este recorrido explica el documento con palabras sencillas; no es asesoramiento legal.',
  it: 'Questo tour spiega il documento con parole semplici; non è una consulenza legale.',
};
export const notAdvice = (language: string) => NOT_ADVICE[language.slice(0, 2).toLowerCase()] ?? NOT_ADVICE.en;

/** Document order of a point: where its first evidence sentence stands. */
function position(doc: Doc, item: ArcItem): number {
  const order = new Map(doc.sentences.map((s, i) => [s.id, i]));
  return Math.min(...item.evidence.map((id) => order.get(id) ?? Infinity));
}

/**
 * The beats and chapters of the type's arc. A lecture follows its own order, one chapter per topic, with the topic's
 * figure or equation right after it; the other types keep the arc's chapters, and each chapter's first step may draw
 * the chapter's board (a contract's costs as bars, its deadlines as a timeline, a letter's to-dos as a flow).
 */
export function arcTourPlan(
  plan: ArcPlan,
  type: ArcType,
  card: PaperCard,
  doc: Doc,
  preset: Preset,
  language: string,
): TourPlan {
  const beats: Omit<Beat, 'id'>[] = [];
  const chapters: PlanChapter[] = [];
  const figures = new Map(doc.figures.map((f) => [f.id, f]));
  const pageOf = new Map(doc.sentences.map((s) => [s.id, s.page]));
  const prose = proseSentences(doc);
  for (const spec of ARC_SPECS[type]) {
    const items = (plan.items[spec.id] ?? []).slice(0, spec.max[preset]);
    const base = { kind: spec.kind, tint: spec.tint, role: spec.help };
    if (type === 'lecture' && spec.id === 'topics') {
      [...items]
        .sort((a, b) => position(doc, a) - position(doc, b))
        .forEach((topic, i) => {
          const arc = `topic-${i + 1}`;
          chapters.push({ id: arc, title: topic.title ?? topic.text.split(' ').slice(0, 5).join(' ') });
          const figure = topic.visual ? figures.get(topic.visual) : undefined;
          const equation = topic.visual && !figure ? topic.visual : undefined;
          const own = topic.visual ? undefined : topic.board;
          // A slide's numbers often stand in a table the topic does not cite: the bars may use its pages' text.
          const pages = new Set(topic.evidence.map((id) => pageOf.get(id)));
          beats.push({
            ...base,
            arc,
            point: topic.text,
            evidence: topic.evidence,
            ...(own ? { board: own } : {}),
            ...(own === 'formula' ? { page: pageOf.get(topic.evidence[0]) } : {}),
            ...(own === 'bars' ? { boardEvidence: prose.filter((s) => pages.has(s.page)).map((s) => s.id) } : {}),
          });
          if (figure)
            beats.push({
              kind: 'figure',
              arc,
              point: topic.text,
              evidence: [],
              target: figure.id,
              ...(figure.kind === 'table'
                ? { board: 'bars' as const }
                : topic.board === 'flow'
                  ? { board: 'flow' as const }
                  : {}),
            });
          if (equation)
            beats.push({ kind: 'formula', arc, point: topic.text, evidence: [], target: equation, board: 'formula' });
        });
      continue;
    }
    if (!items.length) continue;
    chapters.push({ id: spec.id, title: plan.titles[spec.id] || spec.title });
    items.forEach((item, i) => {
      // Each direction call sees only its own point; naming the others keeps the steps of a chapter from repeating.
      const others = items.filter((_, k) => k !== i).map((it) => it.text);
      beats.push({
        ...base,
        arc: spec.id,
        point: item.text,
        evidence: item.evidence,
        ...(i === 0 && spec.board ? { board: spec.board } : {}),
        // Bars may compare every amount of the chapter, not only the first point's.
        ...(i === 0 && spec.board === 'bars' ? { boardEvidence: items.flatMap((it) => it.evidence) } : {}),
        ...(others.length
          ? { notes: [`OTHER STEPS IN THIS CHAPTER (leave their points to them): ${others.join(' | ')}`] }
          : {}),
      });
    });
  }
  const kept = beats.slice(0, MAX_STEPS - 1).concat(beats.length > MAX_STEPS - 1 ? beats.slice(-1) : []);
  const last = kept.at(-1);
  if (last?.kind === 'takeaway') last.questions = card.suggested_questions;
  const counts = new Map<string, number>();
  return {
    type,
    chapters: chapters.filter((c) => kept.some((b) => b.arc === c.id)),
    beats: kept.map((b) => {
      const n = (counts.get(b.kind) ?? 0) + 1;
      counts.set(b.kind, n);
      return { ...b, id: `${b.kind}-${n}` };
    }),
    ...(type === 'contract' ? { frame: plan.disclaimer || notAdvice(language) } : {}),
  };
}
