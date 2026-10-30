import Ajv2020 from 'ajv/dist/2020.js';
import type { Doc } from '../../../shared/paper';
import {
  CONCEPT_ROLES,
  TEACHING_LEVELS,
  type TeachingConcept,
  type TeachingPlan,
  type TeachingPreferences,
} from '../../../shared/teachingPlan';
import { indexElements } from '../elements';
import type { Beat, TourPlan } from './beats';
import type { PaperCard } from './card';
import { proseSentences } from './paper-block';

const ajv = new Ajv2020({ strict: false, allErrors: true });
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });

/** Spread a long paper's citable pool across its body, retaining equations and figures as first-class sources. */
export function teachingEvidence(doc: Doc, budget = 850): string[] {
  const visuals = [...doc.equations.map((e) => e.id), ...doc.figures.map((f) => f.id)].slice(0, Math.floor(budget / 4));
  const prose = proseSentences(doc);
  const remaining = budget - visuals.length;
  if (prose.length <= remaining) return [...prose.map((s) => s.id), ...visuals];
  const bySection = new Map<string, string[]>();
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  for (const sentence of prose) {
    const section = blocks.get(sentence.block)?.section ?? `page-${sentence.page}`;
    const bucket = bySection.get(section) ?? [];
    bucket.push(sentence.id);
    bySection.set(section, bucket);
  }
  const selected: string[] = [];
  const buckets = [...bySection.values()];
  for (let round = 0; selected.length < remaining; round++) {
    let added = false;
    for (const bucket of buckets) {
      if (round >= bucket.length || selected.length >= remaining) continue;
      // Alternate ends, then move inward: retain a late section's conclusion as well as its opening.
      const at = round % 2 ? bucket.length - 1 - Math.floor(round / 2) : round / 2;
      selected.push(bucket[at]);
      added = true;
    }
    if (!added) break;
  }
  const keep = new Set(selected);
  return [...prose.filter((s) => keep.has(s.id)).map((s) => s.id), ...visuals];
}

export function teachingPlanSchema(doc: Doc, strict = true) {
  const source = strict ? { $ref: '#/$defs/source' } : { type: 'string' };
  const concept = {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'title',
      'role',
      'evidence',
      'prerequisites',
      'importance',
      'importanceReason',
      'difficulty',
      'difficultyReason',
      'confidence',
      'objective',
      'misconception',
      'visual',
      'visualBenefit',
      'visibleChange',
    ],
    properties: {
      id: text(64),
      title: text(120),
      role: { type: 'string', enum: CONCEPT_ROLES },
      evidence: { type: 'array', minItems: 1, maxItems: 6, items: source },
      prerequisites: { type: 'array', maxItems: 12, items: text(64) },
      importance: { type: 'string', enum: TEACHING_LEVELS },
      importanceReason: text(400),
      difficulty: { type: 'string', enum: TEACHING_LEVELS },
      difficultyReason: text(400),
      confidence: { type: 'string', enum: TEACHING_LEVELS },
      objective: text(500),
      misconception: { type: 'string', maxLength: 400 },
      visual: { type: 'string', enum: ['source', 'new', 'none'] },
      visualBenefit: { type: 'string', maxLength: 500 },
      visibleChange: { type: 'string', maxLength: 500 },
    },
  };
  return {
    ...(strict ? { $defs: { source: { type: 'string', enum: teachingEvidence(doc) } } } : {}),
    type: 'object',
    additionalProperties: false,
    required: ['question', 'audienceAssumption', 'concepts', 'sections'],
    properties: {
      question: text(400),
      audienceAssumption: text(400),
      concepts: { type: 'array', minItems: 1, maxItems: 48, items: concept },
      sections: {
        type: 'array',
        maxItems: Math.max(1, doc.sections.length),
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['sectionId', 'treatment', 'reason'],
          properties: {
            sectionId: text(100),
            treatment: { type: 'string', enum: ['teach', 'background', 'omit'] },
            reason: text(400),
          },
        },
      },
    },
  };
}

export function teachingPlanTask(preferences: TeachingPreferences, language: string): string {
  return [
    `Plan what this paper should teach in ${language}. Audience familiarity: ${preferences.audience}; scope: ${preferences.structure}; depth: ${preferences.depth}.`,
    'Read the full document, including methods, results and limitations. Repetition in abstract/introduction/conclusion is a signal, never a requirement.',
    'Separate the new contribution from prerequisite background, the mechanism that supports it, actual evidence and limitations.',
    'Choose a small set of teachable concepts, not one entry per paragraph: normally 4–8 for an overview, 6–12 for a standard tour, and 10–18 for a deep tour. Include only concepts needed to answer the main question.',
    'For each concept give stable short IDs, source evidence and prerequisite concept IDs. Dependencies must be acyclic.',
    'Importance explains why understanding this concept is needed for the paper’s main question; difficulty estimates this audience’s required prior knowledge or multi-step reasoning. They are different decisions.',
    'State the audience assumption and confidence honestly. A likely misconception is a teaching hypothesis, not an observed fact about the learner.',
    'The objective says what the reader should be able to explain. A new visual must name the relationship or change it reveals and why source annotation alone is insufficient. Use none when no visual adds understanding.',
    'A worked example is useful when computed from the paper’s formula and explicitly distinguished from measured data. Never invent measured results.',
    'Account for every actual section in sections: teach, background or omit with a reason. Keep the paper’s own headings; do not invent a Methods section.',
    `Additional profile instructions: ${preferences.instructions || 'Use a neutral, source-faithful explanation.'}`,
  ].join('\n');
}

export function cleanTeachingPlan(value: unknown, doc: Doc): { plan: TeachingPlan | null; problems: string[] } {
  const check = ajv.compile(teachingPlanSchema(doc, false));
  if (!check(value))
    return { plan: null, problems: (check.errors ?? []).slice(0, 8).map((e) => `${e.instancePath}: ${e.message}`) };
  const held = value as Omit<TeachingPlan, 'version'>;
  const problems: string[] = [];
  const concepts = new Map(held.concepts.map((c) => [c.id, c]));
  const sources = new Set(teachingEvidence(doc));
  if (concepts.size !== held.concepts.length) problems.push('Concept IDs must be unique.');
  for (const concept of held.concepts) {
    for (const source of concept.evidence)
      if (!sources.has(source)) problems.push(`${concept.id}: unknown source ${source}.`);
    for (const dependency of concept.prerequisites)
      if (!concepts.has(dependency) || dependency === concept.id)
        problems.push(`${concept.id}: invalid prerequisite ${dependency}.`);
    if (concept.visual === 'new' && (!concept.visualBenefit.trim() || !concept.visibleChange.trim()))
      problems.push(`${concept.id}: a new visual needs a concrete benefit and visible relationship/change.`);
  }
  const seen = new Set<string>(),
    active = new Set<string>();
  function visit(id: string) {
    if (active.has(id)) {
      problems.push(`Cyclic prerequisites at ${id}.`);
      return;
    }
    if (seen.has(id)) return;
    active.add(id);
    for (const dependency of concepts.get(id)?.prerequisites ?? []) if (concepts.has(dependency)) visit(dependency);
    active.delete(id);
    seen.add(id);
  }
  for (const id of concepts.keys()) visit(id);
  const sections = new Set(doc.sections.map((s) => s.id));
  const covered = new Set(held.sections.map((s) => s.sectionId));
  if (covered.size !== held.sections.length) problems.push('Section coverage entries must be unique.');
  for (const section of held.sections)
    if (!sections.has(section.sectionId)) problems.push(`Unknown section ${section.sectionId}.`);
  for (const section of sections)
    if (!covered.has(section)) problems.push(`Explain the treatment of section ${section}.`);
  if (!held.concepts.some((c) => c.role === 'contribution')) problems.push('Include the paper’s main contribution.');
  if (!held.concepts.some((c) => c.role === 'evidence')) problems.push('Include the evidence for the contribution.');
  if (problems.length) return { plan: null, problems: problems.slice(0, 12) };
  return { plan: { version: 'teaching-plan@1', ...held }, problems: [] };
}

const priority = { low: 0, medium: 1, high: 2 };
export function selectedTeachingConcepts(plan: TeachingPlan, preferences: TeachingPreferences): TeachingConcept[] {
  const chosen = new Set(
    plan.concepts
      .filter((c) =>
        preferences.structure === 'overview'
          ? c.importance === 'high' && c.role !== 'prerequisite'
          : preferences.depth === 'quick'
            ? c.importance !== 'low' && c.role !== 'prerequisite'
            : preferences.audience === 'expert'
              ? c.role !== 'prerequisite' || c.importance === 'high'
              : true,
      )
      .map((c) => c.id),
  );
  const byId = new Map(plan.concepts.map((c) => [c.id, c]));
  function prerequisites(id: string) {
    for (const dependency of byId.get(id)?.prerequisites ?? []) {
      const concept = byId.get(dependency);
      if (!concept || chosen.has(dependency)) continue;
      if (preferences.audience === 'expert' && concept.role === 'prerequisite') continue;
      chosen.add(dependency);
      prerequisites(dependency);
    }
  }
  for (const id of [...chosen]) prerequisites(id);
  const result: TeachingConcept[] = [],
    visited = new Set<string>();
  function append(id: string) {
    if (visited.has(id) || !chosen.has(id)) return;
    visited.add(id);
    for (const prerequisite of byId.get(id)?.prerequisites ?? []) append(prerequisite);
    if (byId.has(id)) result.push(byId.get(id)!);
  }
  for (const concept of [...plan.concepts].sort((a, b) => priority[b.importance] - priority[a.importance]))
    append(concept.id);
  return result;
}

export function teachingNotes(concept: TeachingConcept): string[] {
  return [
    `LEARNING OBJECTIVE: ${concept.objective}`,
    `IMPORTANCE (${concept.importance}): ${concept.importanceReason}`,
    `ESTIMATED DIFFICULTY (${concept.difficulty}, confidence ${concept.confidence}): ${concept.difficultyReason}`,
    ...(concept.misconception ? [`POSSIBLE MISUNDERSTANDING: ${concept.misconception}`] : []),
    `VISUAL DECISION: ${concept.visual}. ${concept.visualBenefit} ${concept.visibleChange}`,
    'The illustration and spoken sentence must explain the same operation. Preserve verified values and distinguish illustrative inputs from paper measurements.',
  ];
}

/** Source locations determine paper order, never a fixed Abstract/Methods/Results template. */
export function teachingTourPlan(
  teaching: TeachingPlan,
  doc: Doc,
  preferences: TeachingPreferences,
  card: PaperCard,
  existing: TourPlan,
): TourPlan {
  const elements = new Map(indexElements(doc).map((e) => [e.id, e]));
  const location = (concept: TeachingConcept) =>
    concept.evidence
      .map((id) => elements.get(id))
      .filter((e) => e !== undefined)
      .sort((a, b) => a.page - b.page || (a.bbox?.[1] ?? 0) - (b.bbox?.[1] ?? 0))[0];
  if (preferences.structure === 'concepts') {
    // Preserve the current narrative grammar. Add important body-only concepts that the earlier claim extractor missed.
    const selected = selectedTeachingConcepts(teaching, preferences);
    const mapped = existing.beats.map((beat) => {
      const matches = teaching.concepts.filter((concept) =>
        concept.evidence.some((id) => id === beat.target || beat.evidence.includes(id)),
      );
      const strongest = matches.sort((a, b) => priority[b.importance] - priority[a.importance])[0];
      return strongest ? { ...beat, notes: [...(beat.notes ?? []), ...teachingNotes(strongest)] } : beat;
    });
    const chapters = [...existing.chapters];
    for (const concept of selected) {
      if (
        concept.importance !== 'high' ||
        mapped.some((beat) => concept.evidence.some((id) => id === beat.target || beat.evidence.includes(id)))
      )
        continue;
      const arc = {
        contribution: 'idea',
        prerequisite: 'method',
        mechanism: 'method',
        evidence: 'evidence',
        limitation: 'limits',
      }[concept.role];
      if (!chapters.some((chapter) => chapter.id === arc))
        chapters.splice(Math.max(0, chapters.length - 1), 0, { id: arc, title: concept.title });
      const target = concept.evidence.find(
        (id) => doc.equations.some((e) => e.id === id) || doc.figures.some((f) => f.id === id),
      );
      mapped.splice(
        Math.max(
          0,
          mapped.findIndex((beat) => beat.kind === 'takeaway'),
        ),
        0,
        {
          id: `teach-${concept.id}`,
          kind: target
            ? doc.equations.some((e) => e.id === target)
              ? 'formula'
              : 'figure'
            : concept.role === 'evidence'
              ? 'result'
              : concept.role === 'limitation'
                ? 'limitation'
                : 'method',
          arc,
          point: concept.objective,
          evidence: concept.evidence.filter((id) => doc.sentences.some((s) => s.id === id)),
          ...(target ? { target } : {}),
          notes: teachingNotes(concept),
        },
      );
    }
    // Keep writer order identical to the chapter order used by the player and incremental publishing.
    return {
      ...existing,
      chapters,
      beats: chapters.flatMap((chapter) => mapped.filter((beat) => beat.arc === chapter.id)),
    };
  }
  let selected = selectedTeachingConcepts(teaching, preferences);
  if (preferences.structure === 'paper')
    selected = selected.sort((a, b) => {
      const x = location(a),
        y = location(b);
      return (x?.page ?? 1) - (y?.page ?? 1) || (x?.bbox?.[1] ?? 0) - (y?.bbox?.[1] ?? 0);
    });
  const chapters: TourPlan['chapters'] = [];
  const beats: Beat[] = [];
  for (const concept of selected) {
    const where = location(concept);
    const section = doc.sections
      .filter(
        (s) =>
          s.page < (where?.page ?? 1) ||
          (s.page === where?.page && (elements.get(s.block)?.bbox?.[1] ?? 0) <= (where?.bbox?.[1] ?? 0)),
      )
      .sort(
        (a, b) => b.page - a.page || (elements.get(b.block)?.bbox?.[1] ?? 0) - (elements.get(a.block)?.bbox?.[1] ?? 0),
      )[0];
    // A chapter is a contiguous sequence; repeated roles must not reorder dependencies at assembly time.
    const group = preferences.structure === 'paper' ? (section?.id ?? 'opening') : concept.role;
    const arc = chapters.at(-1)?.id.startsWith(`${group}:`) ? chapters.at(-1)!.id : `${group}:${chapters.length}`;
    if (!chapters.some((c) => c.id === arc))
      chapters.push({
        id: arc,
        title:
          preferences.structure === 'paper'
            ? (section?.title ?? 'Opening')
            : {
                contribution: 'The contribution',
                prerequisite: 'What you need to know',
                mechanism: 'How it works',
                evidence: 'What the results show',
                limitation: 'What remains open',
              }[concept.role],
      });
    const target = concept.evidence.find(
      (id) => doc.equations.some((e) => e.id === id) || doc.figures.some((f) => f.id === id),
    );
    const equation = !!target && doc.equations.some((e) => e.id === target);
    const kind: Beat['kind'] = target
      ? equation
        ? 'formula'
        : 'figure'
      : ({
          contribution: 'idea',
          prerequisite: 'overview',
          mechanism: 'method',
          evidence: 'result',
          limitation: 'limitation',
        }[concept.role] as Beat['kind']);
    beats.push({
      id: `teach-${concept.id}`,
      kind,
      arc,
      point: concept.objective,
      evidence: concept.evidence.filter((id) => doc.sentences.some((s) => s.id === id)),
      ...(target ? { target } : {}),
      role: concept.importanceReason,
      notes: teachingNotes(concept),
      ...(concept.visual === 'none' ? {} : equation ? { board: 'formula' as const } : {}),
    });
    if (preferences.depth === 'deep' && preferences.structure !== 'overview' && concept.difficulty === 'high' && target)
      beats.push({
        ...beats.at(-1)!,
        id: `teach-${concept.id}-worked`,
        detail: true,
        role: 'Work a concrete computed example or trace one source-grounded causal path; change an input and explain the resulting difference.',
      });
  }
  if (!beats.length) return existing;
  // A conclusion stays attached to the same source-grounded question, after the selected material.
  chapters.push({ id: 'teaching-takeaway', title: 'What to remember' });
  beats.push({
    id: 'takeaway-1',
    kind: 'takeaway',
    arc: 'teaching-takeaway',
    point: card.takeaway.text,
    evidence: card.takeaway.evidence,
    notes: [`Answer the learning question: ${teaching.question}`],
  });
  return { ...existing, chapters, beats };
}
