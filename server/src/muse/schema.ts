import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import { ROOT } from '../config';
import { ProcessingError } from '../errors';
import { indexElements } from '../elements';
import type { Action, Doc, Tour } from '../../../shared/paper';
import { MAX_TOUR_STEPS, textReadingOrder, walkthroughGoals } from './planning';

const canonical = JSON.parse(readFileSync(resolve(ROOT, 'schema/tour.schema.json'), 'utf8'));
const defs = structuredClone(canonical.$defs);
// Provider output carries explicit evidence; server supplies immutable document identity.
const step = defs.step;
step.properties.evidence = { type: 'array', minItems: 1, maxItems: 12, items: { type: 'string', minLength: 1 } };
step.required.push('evidence');
step.properties.source = { type: 'string', minLength: 1, description: 'Primary element, in paper reading order.' };
step.required.push('source');
delete step.properties.audio;
delete step.properties.speaker;
step.properties.say.maxLength = 1600;
step.properties.actions.maxItems = 12;
step.properties.hold_ms.maximum = 3000;
const chapters = structuredClone(canonical.properties.chapters);
chapters.maxItems = 10;
chapters.items.properties.steps.maxItems = 24;
export const TOUR_DRAFT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['title', 'chapters'],
  properties: { title: { type: 'string', minLength: 1, maxLength: 200 }, chapters },
  $defs: defs,
};
const ajv = new Ajv2020({ strict: false, allErrors: true });
const checkDraft = ajv.compile(TOUR_DRAFT_SCHEMA);
const checkCanonical = ajv.compile(canonical);
export interface DraftStep {
  id: string;
  source: string;
  say: string;
  actions: Action[];
  evidence: string[];
  hold_ms?: number;
}
export interface TourDraft {
  title: string;
  chapters: { id: string; title: string; steps: DraftStep[] }[];
}

function formatErrors(errors: typeof checkDraft.errors): string[] {
  return (errors ?? []).slice(0, 8).map((e) => `${e.instancePath || '/'}: ${e.message}`);
}
export function validateDraft(
  value: unknown,
  doc: Doc,
  partial = false,
): { draft: TourDraft; evidence: Record<string, string[]> } {
  if (!checkDraft(value)) throw new TourValidationError(formatErrors(checkDraft.errors));
  const draft = value as unknown as TourDraft;
  const elements = new Map(indexElements(doc).map((element) => [element.id, element]));
  const ids = new Set(elements.keys());
  const sentenceIds = new Set(doc.sentences.map((s) => s.id));
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  const order = textReadingOrder(doc);
  const goals = walkthroughGoals(doc);
  const proseSentenceIds = new Set(goals.proseSentenceIds);
  const coveredPages = new Set<number>(),
    highlighted = new Set<string>();
  let lastPage = 0,
    lastTextOrder = -1;
  const chapters = new Set<string>(),
    steps = new Set<string>();
  const evidence: Record<string, string[]> = Object.create(null);
  const problems: string[] = [];
  let totalSteps = 0,
    visuallyExplained = false;
  const known = (id: string, where: string) => {
    if (!ids.has(id)) problems.push(`${where}: unknown document element ${id}`);
  };
  for (const chapter of draft.chapters) {
    if (!chapter.id.trim() || chapters.has(chapter.id))
      problems.push(`chapter ID ${chapter.id} must be nonempty and unique`);
    chapters.add(chapter.id);
    for (const item of chapter.steps) {
      totalSteps++;
      if (!item.id.trim() || steps.has(item.id)) problems.push(`step ID ${item.id} must be nonempty and unique`);
      steps.add(item.id);
      const words = item.say.trim().split(/\s+/).filter(Boolean).length;
      if (!words) problems.push(`${item.id}: narration is empty`);
      item.evidence.forEach((id) => known(id, `${item.id} evidence`));
      known(item.source, `${item.id} source`);
      const source = elements.get(item.source);
      if (source) {
        coveredPages.add(source.page);
        const textOrder = order.get(item.source);
        if (
          source.page < lastPage ||
          (source.page === lastPage && textOrder !== undefined && textOrder < lastTextOrder)
        )
          problems.push(`${item.id}: source ${item.source} moves backward; follow page and text reading order`);
        if (source.page > lastPage) lastTextOrder = -1;
        lastPage = source.page;
        if (textOrder !== undefined) lastTextOrder = textOrder;
      }
      evidence[item.id] = [...new Set([...item.evidence, item.source])];
      if (!item.actions.length) problems.push(`${item.id}: at least one visual action is required`);
      const navigation = item.actions.find((a) => a.type === 'focus' || a.type === 'zoom');
      const navigationTarget = navigation && 'target' in navigation ? elements.get(navigation.target) : undefined;
      if (!navigationTarget || !source || navigationTarget.page !== source.page)
        problems.push(`${item.id}: first focus/zoom must show the source page for ${item.source}`);
      let hasSentenceHighlight = false;
      for (const action of item.actions) {
        if ('target' in action) known(action.target, item.id);
        if ('anchor' in action) known(action.anchor, item.id);
        if ('targets' in action) action.targets.forEach((id) => known(id, item.id));
        const targets =
          'target' in action
            ? [action.target]
            : 'anchor' in action
              ? [action.anchor]
              : 'targets' in action
                ? action.targets
                : [];
        if (source && targets.some((id) => elements.has(id) && elements.get(id)!.page !== source.page))
          problems.push(`${item.id}: visual actions must stay on source page ${source.page}`);
        if (action.type === 'highlight') {
          if (action.targets.length > 3 || action.targets.some((id) => !sentenceIds.has(id)))
            problems.push(`${item.id}: highlight 1–3 exact sentence IDs per action`);
          for (const id of action.targets)
            if (sentenceIds.has(id)) {
              if (proseSentenceIds.has(id)) highlighted.add(id);
              hasSentenceHighlight = true;
            }
        }
        if (action.at_word !== undefined && action.at_word >= words)
          problems.push(`${item.id}: at_word ${action.at_word} exceeds ${words} words`);
        if (
          'region' in action &&
          action.region &&
          !(action.region[0] < action.region[2] && action.region[1] < action.region[3])
        )
          problems.push(`${item.id}: region must have positive width and height`);
        if (
          'target' in action &&
          ['zoom', 'box', 'spotlight'].includes(action.type) &&
          doc.figures.some((f) => f.id === action.target || f.panels.some((p) => p.id === action.target))
        )
          visuallyExplained = true;
      }
      const sourceBlock = source?.kind === 'sentence' ? blocks.get(String(source.data.block)) : blocks.get(item.source);
      const isProse =
        sourceBlock?.type === 'paragraph' ||
        (source?.kind === 'section' && doc.sentences.some((s) => s.page === source.page && proseSentenceIds.has(s.id)));
      if (isProse && !hasSentenceHighlight)
        problems.push(`${item.id}: prose explanation needs a precise sentence highlight`);
    }
  }
  if (totalSteps > MAX_TOUR_STEPS) problems.push(`Tour exceeds ${MAX_TOUR_STEPS} steps; use a shorter walkthrough`);
  if (!partial && totalSteps < goals.minimumSteps)
    problems.push(`Tour is too coarse: use at least ${goals.minimumSteps} small explanation steps`);
  const missingPages = goals.requiredPages.filter((page) => !coveredPages.has(page));
  if (!partial && missingPages.length)
    problems.push(`Missing walkthrough of content pages: ${missingPages.join(', ')}`);
  const minimumHighlights = goals.minimumDistinctHighlights;
  if (!partial && highlighted.size < minimumHighlights)
    problems.push(
      `Highlight at least ${minimumHighlights} distinct important sentences, currently ${highlighted.size}`,
    );
  if (draft.chapters.reduce((n, c) => n + c.steps.reduce((m, s) => m + s.say.length, 0), 0) > 40_000)
    problems.push('Tour narration exceeds the supported length');
  if (!partial && doc.figures.length && !visuallyExplained)
    problems.push('Explain at least one actual figure or table using a zoom, box or spotlight action');
  if (problems.length) throw new TourValidationError(problems.slice(0, 12), missingPages);
  return { draft, evidence };
}
export class TourValidationError extends ProcessingError {
  constructor(
    readonly problems: string[],
    readonly missingPages: number[] = [],
  ) {
    super('invalid_tour', 'The generated tour did not pass document validation.');
  }
}
export function materializeTour(value: unknown, doc: Doc, documentId: string, language: string) {
  const { draft, evidence } = validateDraft(value, doc);
  const textSources = new Set([
    ...doc.sentences.map((s) => s.id),
    ...doc.blocks.map((b) => b.id),
    ...doc.sections.map((s) => s.id),
  ]);
  const tour: Tour = {
    schema: 'paper-tour/tour@0.1',
    title: draft.title,
    paper: documentId,
    doc_sha256: doc.source.sha256,
    level: 'grad',
    voices: { host: { lang: language, rate: 1 } },
    chapters: draft.chapters.map((chapter) => ({
      ...chapter,
      steps: chapter.steps.map(({ evidence: _evidence, source, ...item }) => {
        // Pin prose to its exact reading anchor, while preserving a visual panel/region camera move.
        // Changing a panel target would also change the coordinate frame of its region.
        const navigation = item.actions.findIndex((a) => a.type === 'focus' || a.type === 'zoom');
        return {
          ...item,
          actions: item.actions.map((a, index) =>
            index === navigation && textSources.has(source) ? { ...a, target: source } : a,
          ),
        };
      }),
    })),
  };
  if (!checkCanonical(tour)) throw new TourValidationError(formatErrors(checkCanonical.errors));
  return { tour, evidence };
}
