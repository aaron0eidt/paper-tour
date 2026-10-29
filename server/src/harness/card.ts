import Ajv2020 from 'ajv/dist/2020.js';
import type { Doc, DocSentence } from '../../../shared/paper';
import type { MuseMessage } from '../muse/client';
import { DOC_TYPES, guessType, type DocType } from './doctype';
import { proseSentences } from './paper-block';

export interface CardItem {
  text: string;
  evidence: string[];
}
export interface CardRef {
  id: string;
  why: string;
}
export const ARCS = ['problem', 'idea', 'method', 'evidence', 'limits', 'takeaway'] as const;
export type Arc = (typeof ARCS)[number];
export interface PaperCard {
  plan: string;
  /** What kind of document this is; it chooses the tour's arc, tone and board use. */
  doc_type: DocType;
  title: string;
  chapter_titles: Record<Arc, string>;
  problem: CardItem;
  key_idea: CardItem;
  method_steps: CardItem[];
  key_figures: CardRef[];
  key_formulas: CardRef[];
  results: CardItem[];
  limitations: CardItem[];
  takeaway: CardItem;
  suggested_questions: string[];
}
export const DEFAULT_CHAPTERS: Record<Arc, string> = {
  problem: 'The problem',
  idea: 'The key idea',
  method: 'How it works',
  evidence: 'The evidence',
  limits: 'Limits',
  takeaway: 'Takeaway',
};

const CLAIM_RE =
  /\b(we (propose|introduce|present|show|find|demonstrate)|in this (paper|work)|outperform|achiev|result|improv|limitation|however|future work|conclu|contribution|defin|denote)/i;

/** Sentence IDs the card may cite: all prose, or for long documents the most claim-like 900 of it, in order. */
export function evidencePool(doc: Doc, max = 900): DocSentence[] {
  const prose = proseSentences(doc);
  if (prose.length <= max) return prose;
  const score = (s: DocSentence, i: number) =>
    (i < 80 ? 2 : 0) + (CLAIM_RE.test(s.text) ? 1 : 0) + (/\d/.test(s.text) ? 1 : 0);
  const keep = new Set(
    prose
      .map((s, i) => ({ s, k: score(s, i), i }))
      .sort((a, b) => b.k - a.k || a.i - b.i)
      .slice(0, max)
      .map(({ s }) => s.id),
  );
  return prose.filter((s) => keep.has(s.id));
}

function enumOrNone(values: string[]) {
  return values.length ? { type: 'string', enum: values } : { type: 'string', maxLength: 0 };
}

/** The card's response schema; `strict` adds the ID enums the model must choose from (cleanCard re-checks them). */
export function cardSchema(doc: Doc, sentenceIds: string[], strict = true) {
  const text = { type: 'string', minLength: 1, maxLength: 300 };
  // Repeating the same long enum in six fields exceeds the provider's total
  // enum budget. A shared definition preserves every allowed source ID.
  const evidence = strict ? { $ref: '#/$defs/evidenceId' } : { type: 'string' };
  const item = {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'evidence'],
    properties: { text, evidence: { type: 'array', minItems: 1, maxItems: 3, items: evidence } },
  };
  const ref = (ids: string[], max: number) => ({
    type: 'array',
    maxItems: ids.length ? max : 0,
    items: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'why'],
      properties: { id: strict ? enumOrNone(ids) : { type: 'string' }, why: text },
    },
  });
  const short = { type: 'string', minLength: 1, maxLength: 80 };
  return {
    ...(strict ? { $defs: { evidenceId: { type: 'string', enum: sentenceIds } } } : {}),
    type: 'object',
    additionalProperties: false,
    required: [
      'plan',
      'doc_type',
      'title',
      'chapter_titles',
      'problem',
      'key_idea',
      'method_steps',
      'key_figures',
      'key_formulas',
      'results',
      'limitations',
      'takeaway',
      'suggested_questions',
    ],
    properties: {
      plan: { type: 'string', maxLength: 1200 },
      doc_type: { type: 'string', enum: DOC_TYPES },
      title: short,
      chapter_titles: {
        type: 'object',
        additionalProperties: false,
        required: [...ARCS],
        properties: Object.fromEntries(ARCS.map((arc) => [arc, short])),
      },
      problem: item,
      key_idea: item,
      method_steps: { type: 'array', minItems: 1, maxItems: 4, items: item },
      key_figures: ref(
        doc.figures.map((f) => f.id),
        3,
      ),
      key_formulas: ref(
        doc.equations.map((e) => e.id),
        2,
      ),
      results: { type: 'array', maxItems: 3, items: item },
      limitations: { type: 'array', maxItems: 2, items: item },
      takeaway: item,
      suggested_questions: {
        type: 'array',
        minItems: 3,
        maxItems: 3,
        items: { type: 'string', minLength: 1, maxLength: 160 },
      },
    },
  };
}

const ajv = new Ajv2020({ strict: false, allErrors: true });

/** Schema problems as short messages for one repair turn, or [] when the card is valid. */
export function cardProblems(value: unknown, schema: object): string[] {
  const check = ajv.compile(schema);
  if (check(value)) return [];
  return (check.errors ?? []).slice(0, 8).map((e) => `${e.instancePath || '/'}: ${e.message}`);
}

export function repairTurn(previous: unknown, problems: string[]): MuseMessage[] {
  return [
    { role: 'assistant', content: JSON.stringify(previous) },
    {
      role: 'user',
      content: `The answer did not match the schema:\n${problems.join('\n')}\nReturn the complete corrected answer, using only listed IDs.`,
    },
  ];
}

/** A card from the document's own words, used when the model cannot produce one. */
export function fallbackCard(doc: Doc): PaperCard {
  const prose = proseSentences(doc);
  const pick = (re: RegExp, from = 0) => prose.slice(from).find((s) => re.test(s.text)) ?? prose[from] ?? prose[0];
  const one = (s: DocSentence | undefined): CardItem => ({
    text: s?.text.slice(0, 300) ?? '',
    evidence: s ? [s.id] : [],
  });
  const idea = pick(/\b(we (propose|introduce|present)|in this (paper|work))/i);
  const conclusion = prose.length
    ? pick(/\b(conclu|in summary|we (have )?(shown|presented))/i, Math.floor(prose.length * 0.7))
    : undefined;
  return {
    plan: 'fallback',
    doc_type: guessType(doc),
    title: (doc.source.title ?? 'A guided tour').slice(0, 80),
    chapter_titles: { ...DEFAULT_CHAPTERS },
    problem: one(prose[0]),
    key_idea: one(idea),
    method_steps: [one(prose[Math.min(prose.length - 1, Math.max(0, prose.indexOf(idea!) + 1))])],
    key_figures: doc.figures.slice(0, 1).map((f) => ({ id: f.id, why: f.caption.slice(0, 300) })),
    key_formulas: [],
    results: [one(pick(/\d/, Math.floor(prose.length * 0.4)))],
    limitations: [],
    takeaway: one(conclusion),
    suggested_questions: [],
  };
}

/** Trim texts and drop items whose evidence is gone, so later stages can trust every ID. */
export function cleanCard(card: PaperCard, doc: Doc): PaperCard {
  const sentences = new Set(doc.sentences.map((s) => s.id));
  const figures = new Set(doc.figures.map((f) => f.id));
  const equations = new Set(doc.equations.map((e) => e.id));
  const item = (i: CardItem): CardItem => ({
    text: i.text.trim(),
    evidence: [...new Set(i.evidence)].filter((id) => sentences.has(id)),
  });
  const items = (list: CardItem[]) => list.map(item).filter((i) => i.text && i.evidence.length);
  const refs = (list: CardRef[], known: Set<string>) =>
    list.filter((r, i) => known.has(r.id) && list.findIndex((o) => o.id === r.id) === i);
  return {
    ...card,
    doc_type: DOC_TYPES.includes(card.doc_type) ? card.doc_type : guessType(doc),
    chapter_titles: { ...DEFAULT_CHAPTERS, ...card.chapter_titles },
    problem: item(card.problem),
    key_idea: item(card.key_idea),
    method_steps: items(card.method_steps),
    key_figures: refs(card.key_figures, figures),
    key_formulas: refs(card.key_formulas, equations),
    results: items(card.results),
    limitations: items(card.limitations),
    takeaway: item(card.takeaway),
    suggested_questions: card.suggested_questions
      .map((q) => q.trim())
      .filter(Boolean)
      .slice(0, 3),
  };
}
