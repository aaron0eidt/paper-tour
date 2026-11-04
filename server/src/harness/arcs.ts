import Ajv2020 from 'ajv/dist/2020.js';
import type { Color, Doc } from '../../../shared/paper';
import type { BoardKind } from './board';
import { MAX_STEPS, type Beat, type BeatKind, type PlanChapter, type Preset, type TourPlan } from './beats';
import type { CardItem, PaperCard } from './card';
import { DOC_TYPE_HELP, type DocType } from './doctype';
import { proseSentences } from './paper-block';
import { equationIds, figureIds, idEnum } from './schema-budget';

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
    point('deadlines', 'deadlines, notice periods, the term and how to end it', 0, sizes(1, 2, 3), 'pink', 'Deadlines'),
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
    point('actions', 'what the reader must do, one action per item, in order', 1, sizes(1, 2, 3), 'blue', 'To do'),
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
  manual: [
    overview('what the document is, what it covers and what the reader can do with it'),
    point(
      'parts',
      'the parts, controls, pins, ingredients or components the reader needs, and where they are in the figures',
      1,
      sizes(1, 2, 3),
      'blue',
      'Parts and controls',
    ),
    {
      ...point(
        'steps',
        'the procedures in order, one step or stage per item, with their exact values: times, temperatures, settings and commands',
        1,
        sizes(2, 4, 6),
        'green',
        'Step by step',
      ),
      board: 'flow',
    },
    point(
      'warnings',
      'cautions, limits and maximum ratings: what not to do or exceed, and what happens otherwise',
      1,
      sizes(1, 2, 3),
      'orange',
      'Warnings and limits',
    ),
    point(
      'reference',
      'troubleshooting (a symptom and its fix) or the specifications the reader may look up, exactly as written',
      0,
      sizes(0, 1, 2),
      'pink',
      'Troubleshooting and specs',
    ),
    takeaway('what to remember before starting'),
  ],
  report: [
    overview('who reports on what, for which period, and the headline'),
    {
      ...point(
        'figures',
        'the numbers that matter and how they changed, each with its unit, currency and period',
        1,
        sizes(1, 3, 4),
        'green',
        'Key figures',
      ),
      board: 'bars',
    },
    point('drivers', 'the causes the report gives for these figures', 1, sizes(1, 2, 3), 'blue', 'What drove it'),
    point(
      'risks',
      'the risks, uncertainties and outlook the report names',
      1,
      sizes(1, 1, 2),
      'orange',
      'Risks and outlook',
    ),
    takeaway('the result and the outlook in one sentence'),
  ],
  article: [
    overview('the story and its main claim'),
    point(
      'claims',
      'the claims the article makes, each with the evidence it gives: numbers, studies, quotes',
      1,
      sizes(1, 3, 5),
      'blue',
      'Claims and evidence',
    ),
    point(
      'voices',
      'who argues what, including critics and opposing views, each attributed to the person or group',
      0,
      sizes(0, 1, 2),
      'green',
      'Voices',
    ),
    point(
      'gaps',
      'what the article does not show or leaves open: a claim stated without evidence, a question raised and not answered',
      0,
      sizes(0, 1, 2),
      'orange',
      'What is left open',
    ),
    takeaway('what the article establishes and what it does not'),
  ],
  literature: [
    overview('author, form and situation, and the first impression'),
    point(
      'structure',
      'stanzas, rhyme scheme, metre, turning points or narrative perspective, each pointed at in the text',
      1,
      sizes(1, 2, 3),
      'blue',
      'Structure',
    ),
    point(
      'devices',
      'images, metaphors, symbols and sound, each pointed at in the exact words and what it does to the reader',
      1,
      sizes(2, 3, 5),
      'pink',
      'Devices',
    ),
    point('meaning', 'the interpretation, and how the form supports it', 1, sizes(1, 2, 3), 'green', 'Meaning'),
    takeaway('what stays with the reader after the text'),
  ],
  medical: [
    overview('what the document is for and whom it concerns'),
    {
      ...point(
        'values',
        'how to use it or what the values are: doses and timing, or each value against its reference range, exactly as written',
        1,
        sizes(1, 3, 4),
        'blue',
        'Use and values',
      ),
      board: 'bars',
    },
    point(
      'effects',
      'side effects with their frequency categories, or the values flagged as outside their range',
      0,
      sizes(1, 2, 3),
      'orange',
      'Effects and flags',
    ),
    point(
      'warnings',
      'when to be careful, when to see a doctor, and what to avoid',
      1,
      sizes(1, 2, 3),
      'pink',
      'When to be careful',
    ),
    takeaway('what to remember and what to ask a doctor or pharmacist'),
  ],
};
/** What a type's points must keep exactly as the document writes them, besides the amounts, dates and names of all. */
const ARC_RULES: Partial<Record<ArcType, string>> = {
  manual:
    'Keep times, temperatures, settings, part and pin names and commands exactly as written. A step item is one step, or a stage of consecutive steps, with all of its values.',
  report:
    'Copy every figure with its unit, currency and period exactly as written, compare only what the report compares, and give the causes as the report states them.',
  article:
    'Attribute every claim to whoever makes it (the author, a named person or study) and give the evidence the article cites, never your own. Gaps are only what the article itself leaves open.',
  literature:
    'Each "text" says what the words do to the reader and names at most a few words of the text; its "evidence" points at the exact lines. Never retell or paraphrase the whole text, and call a reading an interpretation.',
  medical:
    'Keep doses, times, values, units, reference ranges and frequency categories (such as very common, common, rare) exactly as written. Never diagnose and never advise changing a treatment: the tour only explains what the document says.',
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

/** The longest disclaimer the plan may word: the medical one has two clauses. A longer one is replaced by the code's. */
const DISCLAIMER_MAX = 300;

/** The plan call's response schema; `strict` adds the ID enums the model must choose from. */
export function arcSchema(type: ArcType, doc: Doc, sentenceIds: string[], preset: Preset, strict = true) {
  const specs = ARC_SPECS[type];
  const short = { type: 'string', minLength: 1, maxLength: 80 };
  // Every list shares the one definition of the sentence IDs: written into each field they would be counted once for
  // each, and a long document's sentences would exceed the provider's enum budget (schema-budget.ts).
  const evidence = {
    type: 'array',
    minItems: 1,
    maxItems: 3,
    items: strict ? { $ref: '#/$defs/sentenceId' } : { type: 'string' },
  };
  const object = (properties: Record<string, object>) => ({
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  });
  const text = { type: 'string', minLength: 1, maxLength: 300 };
  const visuals = ['', ...figureIds(doc), ...equationIds(doc)];
  const topic = object({
    title: short,
    text,
    evidence,
    board: { type: 'string', enum: TOPIC_BOARDS },
    visual: strict ? { type: 'string', enum: visuals } : { type: 'string' },
  });
  const titled = specs.filter((s) => !(type === 'lecture' && s.id === 'topics'));
  const kind = disclaimerOf(type);
  const body = object({
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
    // The provider is asked for it, but the code has a fallback wording: cleaning takes any or no disclaimer and
    // cleanArcPlan drops what it cannot use, so a long sentence never costs the plan.
    ...(kind ? { disclaimer: strict ? { type: 'string', minLength: 1, maxLength: DISCLAIMER_MAX } : {} } : {}),
  });
  return {
    ...(strict ? { $defs: { sentenceId: idEnum(sentenceIds) } } : {}),
    ...body,
    ...(strict ? {} : { required: body.required.filter((key) => key !== 'disclaimer') }),
  };
}

export function arcTask(type: ArcType, language: string, preset: Preset) {
  const lang = JSON.stringify(language);
  const lists = ARC_SPECS[type].map((s) => {
    const most = s.max[preset];
    const count = s.min === most ? `${most}` : `${s.min}-${most}`;
    return `   - ${s.id} (${count}): ${s.help}.`;
  });
  const kind = disclaimerOf(type);
  const extra = [
    ...(type === 'lecture'
      ? [
          `Each topic has a "title" of at most 5 words in ${lang}. "board" draws the topic on a side board: formula when
   it centres on one formula, flow for a process with a branch, merge or loop, bars for numbers the lecture compares, else none.
   "visual" is the ID of a figure or equation the topic is about, or "".`,
        ]
      : []),
    ...(ARC_RULES[type] ? [ARC_RULES[type]!] : []),
    ...(kind ? [`"disclaimer" is one short sentence in ${lang}: ${DISCLAIMER_TASK[kind]}.`] : []),
  ];
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
  const worded = typeof raw.disclaimer === 'string' ? raw.disclaimer.replace(/\s+/g, ' ').trim() : '';
  // A missing or over-long wording is not a reason to reject the plan: the tour uses the code's own sentence.
  const disclaimer = worded.length <= DISCLAIMER_MAX ? worded : '';
  if (problems.length) return { plan: null, problems };
  return { plan: { plan: raw.plan, titles, items, ...(disclaimer ? { disclaimer } : {}) }, problems: [] };
}

/**
 * Where a plan from the card puts the card's items: the first point chapter takes the key idea and the method steps,
 * `results` takes the results, and `catches` takes the limitations.
 */
const FALLBACK: Record<ArcType, { main: string; results?: string; catches?: string }> = {
  lecture: { main: 'topics' },
  contract: { main: 'terms', catches: 'risks' },
  letter: { main: 'actions', catches: 'consequences' },
  manual: { main: 'steps', results: 'reference', catches: 'warnings' },
  report: { main: 'drivers', results: 'figures', catches: 'risks' },
  article: { main: 'claims', catches: 'gaps' },
  literature: { main: 'structure', results: 'devices' },
  medical: { main: 'values', results: 'effects', catches: 'warnings' },
  other: { main: 'points', catches: 'caveats' },
};

/** A plan from the card's own items, when the plan call cannot give one. */
export function fallbackArcPlan(card: PaperCard, type: ArcType): ArcPlan {
  const usable = (list: CardItem[]) => list.filter((i) => i.text && i.evidence.length);
  const items: Record<string, ArcItem[]> = Object.fromEntries(ARC_SPECS[type].map((s) => [s.id, []]));
  items.overview = usable([card.problem]);
  items.takeaway = usable([card.takeaway]);
  const { main, results, catches } = FALLBACK[type];
  items[main] = usable([card.key_idea, ...card.method_steps]);
  if (results) items[results] = usable(card.results);
  if (catches) items[catches] = usable(card.limitations);
  return { plan: 'fallback', titles: {}, items };
}

/** Which "this is not ... advice" sentence a kind of document opens and closes its tour with. */
export type Disclaimer = 'legal' | 'medical' | 'investment';
const DISCLAIMERS: Record<DocType, Disclaimer | null> = {
  research_paper: null,
  exercise_sheet: null,
  lecture: null,
  contract: 'legal',
  letter: null,
  manual: null,
  report: 'investment',
  article: null,
  literature: null,
  medical: 'medical',
  other: null,
};
/** The disclaimer a type's tour carries, or null when it has none. */
export const disclaimerOf = (type: DocType): Disclaimer | null => DISCLAIMERS[type];

/** What the plan call is asked to say for each disclaimer, in the tour's language. */
const DISCLAIMER_TASK: Record<Disclaimer, string> = {
  legal: 'this tour explains the document and is not legal advice',
  medical:
    'this tour explains the document and is not medical advice, and questions about the reader’s own health go to a doctor or pharmacist',
  investment: 'this tour explains the document and is not investment advice',
};

/** The disclaimer in the tour's language, when the plan did not word it. */
const NOT_ADVICE: Record<Disclaimer, Record<string, string>> = {
  legal: {
    en: 'This tour explains the document in plain words; it is not legal advice.',
    de: 'Diese Tour erklärt das Dokument in einfachen Worten; sie ist keine Rechtsberatung.',
    fr: "Cette visite explique le document avec des mots simples ; ce n'est pas un conseil juridique.",
    es: 'Este recorrido explica el documento con palabras sencillas; no es asesoramiento legal.',
    it: 'Questo tour spiega il documento con parole semplici; non è una consulenza legale.',
  },
  medical: {
    en: 'This tour explains the document in plain words; it is not medical advice, so ask a doctor or pharmacist about your own health.',
    de: 'Diese Tour erklärt das Dokument in einfachen Worten; sie ist keine medizinische Beratung, bei Fragen zu Ihrer Gesundheit hilft Ihr Arzt oder Ihre Apotheke.',
    fr: "Cette visite explique le document avec des mots simples ; ce n'est pas un avis médical : pour toute question sur votre santé, demandez à votre médecin ou à votre pharmacien.",
    es: 'Este recorrido explica el documento con palabras sencillas; no es asesoramiento médico, así que consulte a su médico o farmacéutico para dudas sobre su salud.',
    it: 'Questo tour spiega il documento con parole semplici; non è una consulenza medica, quindi per dubbi sulla tua salute chiedi al tuo medico o al farmacista.',
  },
  investment: {
    en: 'This tour explains the document in plain words; it is not investment advice.',
    de: 'Diese Tour erklärt das Dokument in einfachen Worten; sie ist keine Anlageberatung.',
    fr: "Cette visite explique le document avec des mots simples ; ce n'est pas un conseil en investissement.",
    es: 'Este recorrido explica el documento con palabras sencillas; no es asesoramiento de inversión.',
    it: 'Questo tour spiega il documento con parole semplici; non è una consulenza finanziaria.',
  },
};
export const notAdvice = (language: string, kind: Disclaimer = 'legal') =>
  NOT_ADVICE[kind][language.slice(0, 2).toLowerCase()] ?? NOT_ADVICE[kind].en;

/** Document order of a point: where its first evidence sentence stands. */
function position(doc: Doc, item: ArcItem): number {
  const order = new Map(doc.sentences.map((s, i) => [s.id, i]));
  return Math.min(...item.evidence.map((id) => order.get(id) ?? Infinity));
}

/**
 * The beats and chapters of the type's arc. A lecture follows its own order, one chapter per topic, with the topic's
 * figure or equation right after it; the other types keep the arc's chapters, and each chapter's first step may draw
 * the chapter's board (a contract's costs as bars).
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
    ...(disclaimerOf(type) ? { frame: plan.disclaimer || notAdvice(language, disclaimerOf(type)!) } : {}),
  };
}
