import Ajv2020 from 'ajv/dist/2020.js';
import type { Doc, DocSection, DocSentence } from '../../../shared/paper';
import type { Beat, BeatKind, Preset, TourPlan } from './beats';
import { bestBody, bestOrder, developedAt, positions, readingOf } from './claim-anchors';
import type { PaperCard } from './card';
import type { BoardKind } from './board';
import { MOVE_SPECS, type Move } from './moves';
import { proseSentences } from './paper-block';
import { equationIds, figureIds, idEnum } from './schema-budget';

// A paper tour organised by claims (notes/ROADMAP.md, wave 2): the 2 to 4 statements the authors make in at least two of
// the abstract, the introduction and the conclusion. Each claim is taught as what changed, why it works, the evidence
// with its scope and, where the authors state one, the catch. One call picks the claims from sentences that code
// found in those three places; code checks every ID, the places and the ownership of evidence, and builds the beats.

export const CLAIM_REGIONS = ['abstract', 'introduction', 'conclusion'] as const;
export type ClaimRegion = (typeof CLAIM_REGIONS)[number];

/** Most claims a preset teaches; each costs two to four steps. */
export const CLAIM_LIMITS: Record<Preset, number> = { quick: 3, standard: 3, deep: 4 };
/** Steps a claim tour may have by preset: standard 10 to 12, quick about 6, deep up to 22. */
export const CLAIM_STEPS: Record<Preset, number> = { quick: 6, standard: 12, deep: 22 };
/** Catches a tour tells: one honest step in a short tour, two in a standard one, one per claim in a deep one. */
const CATCH_LIMITS: Record<Preset, number> = { quick: 1, standard: 2, deep: 4 };

const ABSTRACT = /^(abstract|summary|zusammenfassung|resumen|résumé|resume|sommario)$/i;
const INTRODUCTION = /\b(introduction|einleitung|introducción|introduccion|introduzione)\b/i;
const CONCLUSION =
  /\b(conclusions?|concluding|discussion|summary|synthesis|outlook|future (?:work|directions)|fazit|schlussfolgerungen?|diskussion|ausblick|conclusión|conclusiones|conclusioni|discussione)\b/i;
const LIMITS_TITLE =
  /\b(limitations?|caveats?|threats|shortcomings|einschränkungen|grenzen|limitaciones|limitazioni)\b/i;
/** A section that only reviews what others did: front matter, which a claim is not taught from, wherever it stands. */
const RELATED =
  /^(?:background\s+(?:and|&)\s+)?(?:(?:related\s+(?:works?|literature|research)|prior\s+(?:works?|art)|previous\s+works?|literature\s+review|state\s+of\s+the\s+art)(?:\s+(?:and|&)\s+(?:background|motivation))?|verwandte\s+arbeiten|stand\s+der\s+(?:technik|forschung)|trabajos?\s+relacionados|estado\s+del\s+arte|travaux\s+(?:connexes|antérieurs)|état\s+de\s+l['’]art|lavori\s+correlati|stato\s+dell['’]arte)$/i;
/** A section on the background: front matter only in the first sections of a paper, and when it holds no equation. */
const BACKGROUND = /^(?:background|hintergrund|antecedentes)(?:\s+(?:and|&)\s+motivation)?$/i;
type Place = ClaimRegion | 'background';

const CLAIM_CUE =
  /\b(we (?:propose|introduce|present|show|find|found|demonstrate|develop|achieve|obtain|prove|derive|report|conclude|identify|establish)|our (?:method|approach|model|results?|findings?|analysis|system)|(?:results?|findings?|experiments?|data) (?:show|indicate|suggest|demonstrate|reveal)|outperform\w*|achiev\w*|improv\w*|state-of-the-art|first to|novel|contributions?|in this (?:paper|work|article|study)|this (?:paper|work|study)|main (?:result|finding)|key (?:result|finding)|wir (?:zeigen|schlagen|stellen)|nous (?:montrons|proposons)|mostramos|proponemos)\b/i;
const LIMIT_CUE =
  /\b(limitations?|however|nevertheless|cannot|can not|could not|do(?:es)? not (?:prove|establish|show|capture|generali[sz]e|hold)|not (?:yet|sufficient|enough|clear|established)|only (?:tested|evaluated|holds|applies|works|in)|restricted to|remains? (?:open|unclear|unknown|challenging)|future work|we leave|caveats?|drawbacks?|shortcomings?|weakness\w*|fails?|failure|assum\w+|singular|simulation results?|small sample|unlike)\b/i;

/** The leading number of a section: its printed number, else the one its title starts with ("4.2 | Limitations"). */
function numberOf(section: DocSection): string {
  return section.number ?? /^((?:\d+(?:\.\d+)*|[IVXLC]+))(?=[\s.|:)-])/i.exec(section.title.trim())?.[1] ?? '';
}

/** The place a section opens, by its title; the abstract is a place only near the start of the document. */
function placeOf(section: DocSection): Place | 'basics' | null {
  // Only an arabic number in front is taken off: a roman one would eat the first letter of "Introduction".
  const title = section.title.replace(/^\d+(?:\.\d+)*\.?\s*[|:)\-–]?\s*/, '').trim();
  if (ABSTRACT.test(title) && section.page <= 2) return 'abstract';
  if (INTRODUCTION.test(title)) return 'introduction';
  if (CONCLUSION.test(title) || LIMITS_TITLE.test(title)) return 'conclusion';
  // A roman number in front is taken off only here, where the whole title has to be a background title.
  const whole = title.replace(/^[IVXLC]+\s*[|:).\-–]\s*/, '');
  if (RELATED.test(whole)) return 'background';
  return BACKGROUND.test(whole) ? 'basics' : null;
}

/**
 * The place each section belongs to: a place runs over the subsections nested in it, by number or by level. A section
 * on the background is front matter in the sections that follow the introduction and come before the first of the body,
 * unless it holds an equation (the preliminaries the method builds on); later, or inside a section of the body, it is
 * body.
 */
function sectionPlaces(doc: Doc): Map<string, Place> {
  const places = new Map<string, Place>();
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  const formal = new Set(doc.equations.map((e) => blocks.get(e.block ?? '')?.section));
  let anchor: { place: Place; number: string; level: number; members: string[]; basics: boolean } | null = null;
  const settle = () => {
    if (anchor?.basics && anchor.members.some((id) => formal.has(id)))
      anchor.members.forEach((id) => places.delete(id));
  };
  let introduced = false;
  let leading = true;
  for (const section of doc.sections) {
    const number = numberOf(section);
    const nested =
      anchor && ((number && anchor.number && number.startsWith(`${anchor.number}.`)) || section.level > anchor.level);
    if (anchor && nested) {
      places.set(section.id, anchor.place);
      anchor.members.push(section.id);
      continue;
    }
    settle();
    const opened = placeOf(section);
    if (opened === 'introduction') introduced = true;
    const basics = opened === 'basics';
    const place = basics ? (introduced && leading ? 'background' : null) : opened;
    // The first section of the body, after the introduction, ends the front matter.
    if (!place && introduced) leading = false;
    anchor = place ? { place, number, level: section.level, members: [section.id], basics } : null;
    if (place) places.set(section.id, place);
  }
  settle();
  return places;
}

/** The place of every prose sentence in the abstract, the introduction, the background or the conclusion. */
function allPlaces(doc: Doc): Map<string, Place> {
  const places = sectionPlaces(doc);
  const prose = new Set(proseSentences(doc).map((s) => s.id));
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  const sections = new Map(doc.sections.map((s) => [s.id, s]));
  const out = new Map<string, Place>();
  const hasAbstract = [...places.values()].includes('abstract');
  const intro = doc.sections.find((s) => places.get(s.id) === 'introduction');
  const introAt = intro ? doc.blocks.findIndex((b) => b.id === intro.block) : -1;
  doc.blocks.forEach((block, index) => {
    const section = block.section ? sections.get(block.section) : undefined;
    const place = section ? places.get(section.id) : undefined;
    for (const id of block.sentences) {
      if (!prose.has(id)) continue;
      if (place) out.set(id, place);
      else if (
        !hasAbstract &&
        introAt > 0 &&
        index < introAt &&
        block.page <= 2 &&
        blocks.get(block.id)?.type === 'paragraph'
      )
        out.set(id, 'abstract');
    }
  });
  return out;
}

/**
 * The place of every prose sentence in the abstract, the introduction or the conclusion. Without an abstract section,
 * the prose before the introduction on the first pages counts as the abstract.
 */
export function sentencePlaces(doc: Doc): Map<string, ClaimRegion> {
  return new Map([...allPlaces(doc)].filter((entry): entry is [string, ClaimRegion] => entry[1] !== 'background'));
}

/**
 * The sentences of the front matter: the abstract, the introduction and the background. The authors state their claims
 * there, but only the opening of a tour is taught from them.
 */
export function frontSentences(doc: Doc): Set<string> {
  return new Set([...allPlaces(doc)].filter(([, place]) => place !== 'conclusion').map(([id]) => id));
}

/**
 * The figures, tables and equations that belong to the front matter alone: a teaser printed before the body that no
 * sentence of the body cites, and an equation of the abstract, the introduction or the background. A claim's reason and
 * evidence do not rest on them. A figure the body cites is developed there, wherever the layout printed it.
 */
export function frontElements(doc: Doc, front: Set<string>): Set<string> {
  const at = positions(doc);
  const notes = new Set(doc.blocks.filter((b) => b.type === 'footnote').flatMap((b) => b.sentences));
  const bodyAt = proseSentences(doc)
    .filter((s) => !notes.has(s.id) && !front.has(s.id))
    .map((s) => at.get(s.id) ?? Infinity);
  const start = Math.min(Infinity, ...bodyAt);
  const cited = (id: string) => at.has(id) && !front.has(id);
  const places = sectionPlaces(doc);
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  return new Set([
    ...doc.figures.filter((f) => !f.referenced_by.some(cited) && (at.get(f.id) ?? Infinity) < start).map((f) => f.id),
    ...doc.equations
      .filter((e) => {
        const place = places.get(blocks.get(e.block ?? '')?.section ?? '');
        return place !== undefined && place !== 'conclusion';
      })
      .map((e) => e.id),
  ]);
}

const score = (s: DocSentence) => (CLAIM_CUE.test(s.text) ? 2 : 0) + (/\d/.test(s.text) ? 1 : 0);

/** What the claims call is given, found by code: sentences by place, and the authors' own limits. */
export interface ClaimContext {
  places: Map<string, ClaimRegion>;
  /** The sentences of the abstract, the introduction and the background: claims are stated there, not taught. */
  front: Set<string>;
  /** The figures, tables and equations of the front matter alone (a teaser): no reason or evidence rests on them. */
  frontElements: Set<string>;
  /** Sentences the claims may be stated in, by place, in reading order. */
  candidates: Record<ClaimRegion, DocSentence[]>;
  /** Sentences where the authors state a limit or an exception. */
  limits: DocSentence[];
}

/** The most sentences listed per place after the abstract, which is listed in full. */
const PER_PLACE = 22;
const MAX_LIMITS = 12;

/**
 * The places and candidate sentences of a paper, or null when the paper does not show at least two places with
 * something to say: a claim cannot be checked against what the authors state twice.
 */
export function claimContext(doc: Doc): ClaimContext | null {
  const places = sentencePlaces(doc);
  // A footnote (author notes, equal-contribution marks) states no claim.
  const notes = new Set(doc.blocks.filter((b) => b.type === 'footnote').flatMap((b) => b.sentences));
  const prose = proseSentences(doc).filter((s) => !notes.has(s.id));
  const inPlace = (place: ClaimRegion) => prose.filter((s) => places.get(s.id) === place);
  const top = (list: DocSentence[], most: number) => {
    const keep = new Set(
      list
        .map((s, i) => ({ s, i, k: score(s) }))
        .sort((a, b) => b.k - a.k || a.i - b.i)
        .slice(0, most)
        .map(({ s }) => s.id),
    );
    return list.filter((s) => keep.has(s.id));
  };
  const candidates: Record<ClaimRegion, DocSentence[]> = {
    abstract: inPlace('abstract').slice(0, 14),
    introduction: top(inPlace('introduction'), PER_PLACE),
    conclusion: top(inPlace('conclusion'), PER_PLACE),
  };
  if (CLAIM_REGIONS.filter((place) => candidates[place].length).length < 2) return null;
  const titled = new Set(doc.sections.filter((s) => LIMITS_TITLE.test(s.title)).map((s) => s.id));
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  const front = frontSentences(doc);
  // A catch cites the body of the paper, so the list holds no sentence of the abstract or the introduction: the limits
  // section, the conclusion and any later sentence that states a limit, the last ones first.
  const limits = prose
    .filter((s) => !front.has(s.id))
    .filter((s) => LIMIT_CUE.test(s.text) || titled.has(blocks.get(s.block)?.section ?? ''))
    .map((s, i) => ({
      s,
      i,
      k: (titled.has(blocks.get(s.block)?.section ?? '') ? 2 : 0) + (places.get(s.id) === 'conclusion' ? 1 : 0),
    }))
    .sort((a, b) => b.k - a.k || b.i - a.i)
    .slice(0, MAX_LIMITS)
    .sort((a, b) => a.i - b.i)
    .map(({ s }) => s);
  return { places, front, frontElements: frontElements(doc, front), candidates, limits };
}

// ---------------------------------------------------------------------------------------------------- the call

const SENTENCE = '#/$defs/sentenceId';
const BODY = '#/$defs/bodyId';
const ELEMENT = '#/$defs/elementId';

/** The most body sentences a claim may cite from. */
const BODY_IDS = 800;

/**
 * Sentences the claims may cite: the candidates of the three places, the authors' own limits and the claim-like body of
 * the paper (not its front matter, which a long paper's pool would otherwise fill), within the enum budget.
 */
export function claimSentenceIds(doc: Doc, context: ClaimContext): string[] {
  const notes = new Set(doc.blocks.filter((b) => b.type === 'footnote').flatMap((b) => b.sentences));
  const body = proseSentences(doc).filter((s) => !context.front.has(s.id) && !notes.has(s.id));
  const keep = new Set(
    body
      .map((s, i) => ({ id: s.id, i, k: score(s) }))
      .sort((a, b) => b.k - a.k || a.i - b.i)
      .slice(0, BODY_IDS)
      .map(({ id }) => id),
  );
  return [
    ...new Set([
      ...CLAIM_REGIONS.flatMap((place) => context.candidates[place].map((s) => s.id)),
      ...context.limits.map((s) => s.id),
      ...body.filter((s) => keep.has(s.id)).map((s) => s.id),
    ]),
  ];
}

/**
 * The claims call's response schema; `strict` adds the ID enums the model must choose from (cleanClaims re-checks them).
 * A claim is stated in the abstract, the introduction or the conclusion, but its reason, evidence and catch are cited
 * from the body: those lists offer no sentence of the front matter, which would send every chapter back to the start.
 */
export function claimsSchema(doc: Doc, sentenceIds: string[], preset: Preset, strict = true) {
  const elementIds = [...figureIds(doc), ...equationIds(doc)];
  const front = frontSentences(doc);
  const places = sentencePlaces(doc);
  const stated = sentenceIds.filter((id) => places.has(id));
  const bodyIds = sentenceIds.filter((id) => !front.has(id));
  const sentence = strict ? { $ref: SENTENCE } : { type: 'string' };
  const body = strict ? { $ref: BODY } : { type: 'string' };
  const element = strict ? { $ref: ELEMENT } : { type: 'string' };
  const text = (most: number) => ({ type: 'string', minLength: 1, maxLength: most });
  const object = (properties: Record<string, object>) => ({
    type: 'object',
    additionalProperties: false,
    required: Object.keys(properties),
    properties,
  });
  // The provider does not enforce the sizes of lists, so the schema the code checks answers against leaves them to
  // cleanClaims, which keeps what is usable instead of rejecting the whole answer.
  const list = (items: object, fewest: number, most: number) => ({
    type: 'array',
    ...(strict ? { ...(fewest ? { minItems: fewest } : {}), maxItems: most } : {}),
    items,
  });
  return {
    ...(strict
      ? {
          $defs: {
            sentenceId: idEnum(stated),
            bodyId: idEnum(bodyIds),
            elementId: idEnum(elementIds),
          },
        }
      : {}),
    ...object({
      plan: { type: 'string', maxLength: 1200 },
      claims: list(
        object({
          title: text(60),
          claim: text(240),
          stated: list(object({ place: { type: 'string', enum: [...CLAIM_REGIONS] }, sentence }), 2, 3),
          changed: text(240),
          why: object({ text: text(240), sentences: list(body, 0, 3), elements: list(element, 0, 1) }),
          evidence: object({ elements: list(element, 0, 2), sentences: list(body, 0, 3), scope: text(160) }),
          catches: list(object({ text: text(200), sentences: list(body, 1, 2) }), 0, 1),
        }),
        2,
        CLAIM_LIMITS[preset],
      ),
    }),
  };
}

export function claimsTask(language: string, context: ClaimContext, preset: Preset): string {
  const lang = JSON.stringify(language);
  const quote = (list: DocSentence[]) => (list.length ? list.map((s) => `[${s.id}] ${s.text}`).join('\n') : 'none');
  return [
    `TASK: find the main claims of this paper, for a short guided tour in ${lang}.`,
    `A claim counts only when the authors state it in at least two of three places: the abstract, the introduction and the conclusion (with the discussion). Skip what only one place says, training details, related work and anything the paper only describes.`,
    `1. Choose ${preset === 'deep' ? '3-4' : '2-3'} claims, the most important first. "claim" is one plain sentence of at most 30 words in your own words; "title" is the same claim in at most 8 words, in ${lang}.`,
    `2. "stated" lists 2-3 sentences where the authors state this claim, each from a different place and copied from that place's list below, with its place.`,
    `3. "changed" is one sentence: what changes compared with what (the old way, the baseline or the usual assumption).`,
    `4. "why" gives one "because" in one sentence, and 1-3 sentences from the method, analysis or results of the paper text that give the reason (the places below only state claims). Add one figure, table or equation only when it is what makes the idea work. Leave "sentences" and "elements" empty when the paper gives no reason.`,
    `5. "evidence" names up to 2 figures or tables and up to 3 sentences of the results that carry the key numbers. "scope" is at most 20 words: what the evidence was tested on and what it does not cover (settings, data, number of runs). A figure or table serves one claim only.`,
    `6. "catches" has at most one entry per claim, and only when the authors state a limit or an exception for it: "text" says in at most 25 words what the learner should not conclude, "sentences" are 1-2 sentences that state the limit, preferably from the list of the authors' own limits. Leave it empty when there is none; never invent a catch.`,
    `7. Every ID comes from the schema.`,
    `SENTENCES BY PLACE (the places for "stated"):`,
    `ABSTRACT:\n${quote(context.candidates.abstract)}`,
    `INTRODUCTION:\n${quote(context.candidates.introduction)}`,
    `CONCLUSION:\n${quote(context.candidates.conclusion)}`,
    `THE AUTHORS' OWN LIMITS (candidates for a catch):\n${quote(context.limits)}`,
  ].join('\n');
}

// ------------------------------------------------------------------------------------------------ the claims

/** One claim the tour teaches, with only known IDs. */
export interface Claim {
  title: string;
  claim: string;
  stated: { place: ClaimRegion; sentence: string }[];
  changed: string;
  why: { text: string; sentences: string[]; element?: string };
  evidence: { elements: string[]; sentences: string[]; scope: string };
  catch?: { text: string; sentences: string[] };
}

const ajv = new Ajv2020({ strict: false, allErrors: true });
const flat = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
const strings = (value: unknown, known: Set<string>) => [
  ...new Set(Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string' && known.has(v)) : []),
];

/**
 * The claims with only known IDs and their places checked, or the problems for one repair turn. A claim is dropped when
 * its sentences do not stand in two different places, when its evidence is gone, or when it repeats an earlier claim;
 * a figure or an equation serves one claim only (the first that names it). The reason, the evidence and the catch rest on
 * the body of the paper: a sentence of the front matter is taken out of them. Fewer than two claims left is no plan.
 */
export function cleanClaims(
  value: unknown,
  doc: Doc,
  context: ClaimContext,
  preset: Preset,
): { claims: Claim[] | null; problems: string[] } {
  const check = ajv.compile(claimsSchema(doc, [], preset, false));
  if (!check(value))
    return {
      claims: null,
      problems: (check.errors ?? []).slice(0, 8).map((e) => `${e.instancePath || '/'}: ${e.message}`),
    };
  const sentences = new Set(doc.sentences.map((s) => s.id));
  const elements = new Set([...doc.figures.map((f) => f.id), ...doc.equations.map((e) => e.id)]);
  const at = positions(doc);
  const limitIds = new Set(context.limits.map((s) => s.id));
  const text = new Map(doc.sentences.map((s) => [s.id, s.text]));
  const raw = (value as { claims: Record<string, any>[] }).claims;
  const claims: Claim[] = [];
  const problems: string[] = [];
  const owned = new Set<string>();
  for (const [index, item] of raw.entries()) {
    const name = `claim ${index + 1}`;
    const stated = (Array.isArray(item.stated) ? item.stated : [])
      .filter(
        (s: Record<string, unknown>) =>
          typeof s.sentence === 'string' && sentences.has(s.sentence) && context.places.get(s.sentence) === s.place,
      )
      .map((s: Record<string, string>) => ({ place: s.place as ClaimRegion, sentence: s.sentence }));
    const places = new Set(stated.map((s: { place: string }) => s.place));
    if (places.size < 2) {
      problems.push(
        `${name}: the authors must state it in two different places, and each sentence must come from the list of the place you name (abstract, introduction or conclusion)`,
      );
      continue;
    }
    // A claim that the authors state in the same sentences as an earlier one (two of three, or all) is that claim again;
    // sharing one sentence, as two claims of one abstract sentence do, is not.
    const repeated = claims.some((c) => {
      const shared = c.stated.filter((s) => stated.some((t: { sentence: string }) => t.sentence === s.sentence)).length;
      return shared === stated.length || (shared >= 2 && shared * 3 >= stated.length * 2);
    });
    if (repeated) {
      problems.push(`${name}: it repeats an earlier claim; give a different claim`);
      continue;
    }
    // A figure, table or equation serves one claim; a later claim keeps its sentences and loses the element.
    const free = (ids: string[]) => ids.filter((id) => !owned.has(id));
    // The sentences of the body, in the order of the paper: a step points at the first, and the rest follow it.
    const body = (ids: string[]) =>
      ids.filter((id) => !context.front.has(id)).sort((a, b) => (at.get(a) ?? 0) - (at.get(b) ?? 0));
    // A figure printed in the front matter (a teaser) is no reason; as evidence it stays only when nothing else is left.
    const printed = (id: string) => context.frontElements.has(id);
    const why = {
      text: flat(item.why?.text),
      sentences: body(strings(item.why?.sentences, sentences)),
      element: free(strings(item.why?.elements, elements)).filter((id) => !printed(id))[0],
    };
    const shown = free(strings(item.evidence?.elements, elements).filter((id) => id !== why.element));
    const cited = body(strings(item.evidence?.sentences, sentences));
    const inBody = shown.filter((id) => !printed(id));
    const evidence = {
      elements: inBody.length || cited.length ? inBody : shown,
      sentences: cited,
      scope: flat(item.evidence?.scope),
    };
    if (!evidence.elements.length && !evidence.sentences.length) {
      problems.push(
        `${name}: give the figures, tables or sentences of the results that carry its evidence (not an element another claim uses, and no sentence of the abstract, the introduction or the background)`,
      );
      continue;
    }
    const catches = Array.isArray(item.catches) ? item.catches : [];
    const kept = catches
      .map((c: Record<string, unknown>) => ({ text: flat(c.text), sentences: body(strings(c.sentences, sentences)) }))
      .find(
        (c: { text: string; sentences: string[] }) =>
          c.text && c.sentences.some((id) => limitIds.has(id) || LIMIT_CUE.test(text.get(id) ?? '')),
      );
    if (catches.length && !kept)
      problems.push(`${name}: a catch must cite a sentence in which the authors state the limit; it was left out`);
    for (const id of [...evidence.elements, ...(why.element ? [why.element] : [])]) owned.add(id);
    claims.push({
      title: flat(item.title),
      claim: flat(item.claim),
      stated,
      changed: flat(item.changed),
      why,
      evidence,
      ...(kept ? { catch: kept } : {}),
    });
  }
  const usable = claims.slice(0, CLAIM_LIMITS[preset]);
  if (usable.length < 2)
    return { claims: null, problems: problems.length ? problems : ['claims: give at least 2 claims'] };
  return { claims: usable, problems: [] };
}

/** The claims as the activity log records them. */
export const claimsEvent = (claims: Claim[]) =>
  claims.map((c) => ({
    title: c.title,
    places: [...new Set(c.stated.map((s) => s.place))],
    elements: [...c.evidence.elements, ...(c.why.element ? [c.why.element] : [])],
    catch: Boolean(c.catch),
  }));

// ------------------------------------------------------------------------------------------------- the plan

/** The sentences a claim's opening step marks when the body has none for it: where the authors state it, on one page. */
function statedEvidence(claim: Claim, doc: Doc): string[] {
  const order: ClaimRegion[] = ['introduction', 'abstract', 'conclusion'];
  const page = new Map(doc.sentences.map((s) => [s.id, s.page]));
  const ranked = [...claim.stated].sort((a, b) => order.indexOf(a.place) - order.indexOf(b.place));
  const lead = ranked[0].sentence;
  return [
    lead,
    ...ranked.filter((s) => s.sentence !== lead && page.get(s.sentence) === page.get(lead)).map((s) => s.sentence),
  ].slice(0, 3);
}

/**
 * The step that opens a claim-organised paper tour, as far as the card alone decides it: the problem, in the places the
 * card cites for it and for the key idea. The claims it names are added by the plan.
 */
export const thesisBeat = (card: PaperCard): Omit<Beat, 'id'> => ({
  kind: 'problem',
  arc: 'problem',
  point: card.problem.text || card.key_idea.text,
  evidence: [...new Set([...card.problem.evidence, ...card.key_idea.evidence])].slice(0, 3),
  move: 'thesis',
  role: MOVE_SPECS.thesis.role,
  say: MOVE_SPECS.thesis.words,
});

type Part = Omit<Beat, 'id'>;
interface Planned {
  beat: Part;
  /** The first steps to go when the tour is long. */
  extra?: boolean;
}
interface Chapter {
  id: string;
  title: string;
  parts: Planned[];
}

/**
 * A paper's tour organised by its claims: the thesis, then each claim in its own chapter (what changed, why it works, the
 * evidence with its scope, the catch), then the takeaway, sized by the preset. The tour reads forward through the paper
 * like a guide. The places where the authors state a claim open the tour only: every later step points where the paper
 * develops the claim, "what changed" at the passage of the earliest thing the claim rests on (the writer is given the
 * authors' own sentences for the claim as a note), the evidence at its tables and figures. The chapters come in the order that costs the camera the fewest jumps back, and a catch that
 * stands later in the paper than the next chapter begins is told after the last claim, as a chapter of its own. A step
 * the claim has no material for is left out.
 */
export function claimPlan(claims: Claim[], card: PaperCard, doc: Doc, preset: Preset): TourPlan {
  const front = frontSentences(doc);
  const reading = readingOf(doc, front);
  const listed = claims.slice(0, CLAIM_LIMITS[preset]);
  const tables = new Set(doc.figures.filter((f) => f.kind === 'table').map((f) => f.id));
  const pageOf = (beat: Part) => reading.page(beat.target ?? beat.evidence[0]);
  const pagesOf = (parts: Planned[]) => parts.map(({ beat }) => pageOf(beat)).filter(Boolean);

  const opening: Part = thesisBeat(card);
  // The takeaway points at the conclusion: its own sentences when the card cites any outside the front matter.
  const closingEvidence = (() => {
    const cited = card.takeaway.evidence;
    if (cited.some((id) => !front.has(id))) return cited.filter((id) => !front.has(id));
    const places = sentencePlaces(doc);
    const ended = reading.body.filter((s) => places.get(s.id) === 'conclusion');
    const found = bestBody(reading, ended, card.takeaway.text);
    return found.length ? found : cited;
  })();

  // Catches: told once each, and only as many as the preset keeps; the claims the model lists first keep theirs.
  const catching = new Set(listed.filter((c) => c.catch).slice(0, CATCH_LIMITS[preset]));

  // The sentences a claim cites that its steps show: a reason or evidence that is an element shows the element only.
  const shown = (claim: Claim) => [
    ...(preset !== 'quick' && !claim.why.element ? claim.why.sentences : []),
    ...(preset !== 'quick' && !claim.evidence.elements.length ? claim.evidence.sentences : []),
    ...(catching.has(claim) ? (claim.catch?.sentences ?? []) : []),
  ];
  const cited = (claim: Claim) => [
    ...claim.why.sentences,
    ...claim.evidence.sentences,
    ...(claim.catch?.sentences ?? []),
  ];
  // Where each claim is developed: the sentences other steps point at are not taken twice, nor the ones another claim
  // cites that no step shows (they are kept for that claim, as its own best sentence).
  const pointed = new Set([...opening.evidence, ...closingEvidence, ...listed.flatMap(shown)]);
  const developed = new Map<Claim, string[]>();
  /** The claims whose "what changed" step points at the front matter, where the authors state them. */
  const stated = new Set<Claim>();
  for (const claim of listed) {
    const sources = [
      ...claim.why.sentences,
      ...(claim.why.element ? [claim.why.element] : []),
      ...claim.evidence.elements,
      ...claim.evidence.sentences,
    ];
    // The step after it begins at its own sentence, which this one does not point at first.
    const next = [
      ...(preset === 'quick' ? [claim.catch?.sentences[0]] : []),
      ...(preset !== 'quick' && !claim.why.element ? [claim.why.sentences[0]] : []),
      ...(preset !== 'quick' && !claim.evidence.elements.length ? [claim.evidence.sentences[0]] : []),
    ].filter((id): id is string => Boolean(id));
    const mine = new Set(cited(claim));
    const avoid = new Set([...pointed, ...listed.flatMap(cited).filter((id) => !mine.has(id))]);
    const found = developedAt(reading, `${claim.claim} ${claim.changed} ${claim.title}`, sources, avoid, new Set(next));
    found.forEach((id) => pointed.add(id));
    // Without a sentence of the body to point at, the step rests on where the authors state the claim.
    developed.set(claim, found.length ? found : statedEvidence(claim, doc));
    if (!found.length) stated.add(claim);
  }
  const texts = new Map(doc.sentences.map((s) => [s.id, s.text]));
  // The authors' own sentence for a claim whose step points at the body: for the narration, not for the camera.
  const quoted = (claim: Claim) => {
    const order: ClaimRegion[] = ['conclusion', 'introduction', 'abstract'];
    const own = [...claim.stated].sort((a, b) => order.indexOf(a.place) - order.indexOf(b.place)).slice(0, 2);
    const said = own.map((s) => `"${(texts.get(s.sentence) ?? '').slice(0, 240)}"`).join(' | ');
    return `THE AUTHORS STATE THE CLAIM (put it in your own words; these sentences are not on the page now): ${said}`;
  };

  /** The steps of a claim in teaching order. */
  const chapterOf = (claim: Claim, k: number, of: number): Chapter => {
    const n = k + 1;
    const arc = `claim-${n}`;
    const context = { n, of, text: claim.claim, ...(claim.evidence.scope ? { scope: claim.evidence.scope } : {}) };
    const base = (kind: BeatKind, move: Move, rest: Partial<Part>): Part => ({
      kind,
      arc,
      point: claim.claim,
      evidence: [],
      move,
      claim: context,
      role: MOVE_SPECS[move].role,
      say: MOVE_SPECS[move].words,
      ...rest,
    });
    const parts: Planned[] = [];
    const scope = claim.evidence.scope ? `SCOPE of the evidence: ${claim.evidence.scope}` : '';
    // What changed: the claim as the authors state it. A short tour also says why and the headline evidence here.
    parts.push({
      beat: base('idea', 'change', {
        point: `${claim.claim} ${claim.changed}`.trim(),
        evidence: developed.get(claim)!,
        notes: [
          ...(stated.has(claim) ? [] : [quoted(claim)]),
          ...(preset === 'quick'
            ? [
                `ALSO SAY, in one clause each: why it works (${claim.why.text}) and the headline evidence. ${scope}`.trim(),
              ]
            : []),
        ],
      }),
    });
    if (preset !== 'quick') {
      const reason: Planned[] = [];
      const proof: Planned[] = [];
      const why = claim.why;
      const target = why.element;
      const kind: BeatKind = target ? (doc.equations.some((e) => e.id === target) ? 'formula' : 'figure') : 'method';
      if (target || why.sentences.length) {
        const board: BoardKind | undefined = kind === 'formula' ? 'formula' : undefined;
        reason.push({
          beat: base(kind, 'why', {
            point: why.text || claim.claim,
            evidence: target ? [] : why.sentences,
            ...(target ? { target } : {}),
            ...(board ? { board } : {}),
          }),
        });
        if (preset === 'deep' && kind === 'formula')
          reason.push({
            beat: {
              ...base('formula', 'why', {
                point: why.text || claim.claim,
                target,
                board: 'formula',
                detail: true,
                say: [90, 140],
                role: 'Apply the equation to an explicitly labelled small worked case: change an input, compute the consequence and explain the intuition. The symbols were defined in the preceding step.',
              }),
            },
            extra: true,
          });
      }
      // The evidence in the order of the paper; the one the claim lists first is its headline, the others go first.
      const sources = claim.evidence.elements;
      const inOrder = [...sources].sort((a, b) => reading.at(a) - reading.at(b));
      inOrder.forEach((id) => {
        const table = tables.has(id);
        proof.push({
          beat: base('figure', 'evidence', {
            point: claim.evidence.scope ? `${claim.claim} Scope: ${claim.evidence.scope}` : claim.claim,
            target: id,
            ...(table ? { board: 'bars' as const } : {}),
            notes: [
              scope,
              ...(table
                ? [
                    'COMPARISON: choose one meaningful contrast on one metric and one dataset, with matching conditions; explain the gap, not a list of scores.',
                  ]
                : []),
            ].filter(Boolean),
          }),
          extra: id !== sources[0],
        });
      });
      if (!sources.length && claim.evidence.sentences.length)
        proof.push({
          beat: base('result', 'evidence', {
            point: claim.claim,
            evidence: claim.evidence.sentences,
            board: 'bars',
            boardEvidence: claim.evidence.sentences,
            notes: [scope].filter(Boolean),
          }),
        });
      // The reason comes first; evidence the paper prints more than a page before the passage that gives the reason
      // comes before it, so that the camera does not go back for it.
      const earlier = reason.length ? proof.filter((e) => pageOf(e.beat) + 1 < pageOf(reason[0].beat)) : [];
      parts.push(...earlier, ...reason, ...proof.filter((e) => !earlier.includes(e)));
    }
    if (claim.catch && catching.has(claim))
      parts.push({
        beat: base('limitation', 'catch', {
          point: claim.catch.text,
          evidence: claim.catch.sentences,
        }),
      });
    return { id: arc, title: claim.title, parts };
  };

  const closing: Part = {
    kind: 'takeaway',
    arc: 'takeaway',
    point: card.takeaway.text,
    evidence: closingEvidence,
    move: 'takeaway',
    role: MOVE_SPECS.takeaway.role,
    say: MOVE_SPECS.takeaway.words,
    questions: card.suggested_questions,
  };
  const keepOpening = opening.evidence.length > 0;
  const keepClosing = closing.evidence.length > 0 && closing.point.length > 0;
  // Past the preset's length, the extra steps go first and then the catches, from the last claim backwards.
  const fit = (list: Chapter[]) => {
    const total = () => Number(keepOpening) + Number(keepClosing) + list.reduce((sum, c) => sum + c.parts.length, 0);
    const dropFrom = (matches: (part: Planned) => boolean) => {
      for (let k = list.length - 1; k >= 0; k--)
        for (let i = list[k].parts.length - 1; i >= 0 && total() > CLAIM_STEPS[preset]; i--)
          if (matches(list[k].parts[i])) list[k].parts.splice(i, 1);
    };
    dropFrom((part) => Boolean(part.extra));
    dropFrom((part) => part.beat.move === 'catch');
  };

  // The order of the chapters that costs the camera the fewest jumps back, the claims' own order among equals, over the
  // steps that fit the preset. A catch is left out of the count: it goes where the camera is already (below) or is told
  // after the last claim.
  const trial = listed.map((claim) => chapterOf(claim, 0, listed.length));
  fit(trial);
  const order = bestOrder(
    listed.length,
    (i) => pagesOf(trial[i].parts.filter(({ beat }) => beat.move !== 'catch')),
    pagesOf([{ beat: opening }]),
    pagesOf([{ beat: closing }]),
  );
  const ordered = order.map((i) => listed[i]);
  const of = ordered.length;
  const chapters = ordered.map((claim, k) => chapterOf(claim, k, of));
  // A catch that stands later in the paper than the next chapter begins would send the camera back: it is told after
  // the last claim, with the paper's other limits, and names its claim.
  const limits: Chapter = { id: 'limits', title: card.chapter_titles.limits, parts: [] };
  chapters.forEach((chapter, k) => {
    const last = chapter.parts.at(-1);
    const next = chapters.slice(k + 1).find((c) => c.parts.length)?.parts[0];
    if (last?.beat.move === 'catch' && next && pageOf(last.beat) > pageOf(next.beat) + 1) {
      chapter.parts.pop();
      limits.parts.push({
        beat: {
          ...last.beat,
          arc: limits.id,
          notes: [
            ...(last.beat.notes ?? []),
            `THE CLAIM THIS CATCH QUALIFIES, named in your first words: ${chapter.title}`,
          ],
        },
      });
    }
  });
  limits.parts.sort((a, b) => reading.at(a.beat.evidence[0]) - reading.at(b.beat.evidence[0]));
  const told = [...chapters, limits];
  fit(told);
  opening.notes = [`THE TOUR'S CLAIMS, in order: ${ordered.map((c, i) => `${i + 1}) ${c.claim}`).join(' | ')}`];
  const beats: Omit<Beat, 'id'>[] = [
    ...(keepOpening ? [opening] : []),
    ...told.flatMap((chapter) => chapter.parts.map(({ beat }) => beat)),
    ...(keepClosing ? [closing] : []),
  ];
  const counts = new Map<string, number>();
  const plan: TourPlan = {
    type: 'research_paper',
    chapters: [
      ...(keepOpening ? [{ id: 'problem', title: card.chapter_titles.problem }] : []),
      ...told.filter((c) => c.parts.length).map(({ id, title }) => ({ id, title })),
      ...(keepClosing ? [{ id: 'takeaway', title: card.chapter_titles.takeaway }] : []),
    ],
    beats: beats.map((beat) => {
      const n = (counts.get(beat.kind) ?? 0) + 1;
      counts.set(beat.kind, n);
      return { ...beat, id: `${beat.kind}-${n}` };
    }),
  };
  return plan;
}
