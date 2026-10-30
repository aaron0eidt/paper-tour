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
import { ENUM_ROOM } from './schema-budget';

const ajv = new Ajv2020({ strict: false, allErrors: true });
const text = (maxLength: number) => ({ type: 'string', minLength: 1, maxLength });
const explanation = { type: 'string', minLength: 1 };

/** All citable sources remain available; schema compression never removes paper content. */
export function teachingEvidence(doc: Doc): string[] {
  return [...proseSentences(doc).map((sentence) => sentence.id), ...doc.equations.map((equation) => equation.id), ...doc.figures.map((figure) => figure.id)];
}

export function teachingPlanSchema(doc: Doc, strict = true) {
  const sources = teachingEvidence(doc);
  const enumerated = sources.length <= ENUM_ROOM && (sources.length <= 250 || sources.join('').length <= 15000);
  const source = strict ? { $ref: '#/$defs/source' } : { type: 'string' };
  const concept = {
    type: 'object',
    additionalProperties: false,
    required: [
      'id',
      'title',
      'summary',
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
      summary: {
        ...explanation,
        description:
          'A concise source-grounded explanation addressed to the reader. Declarative sentences, never author instructions or a learning objective.',
      },
      role: { type: 'string', enum: CONCEPT_ROLES },
      evidence: { type: 'array', minItems: 1, items: source },
      prerequisites: { type: 'array', items: text(64) },
      importance: { type: 'string', enum: TEACHING_LEVELS },
      importanceReason: explanation,
      difficulty: { type: 'string', enum: TEACHING_LEVELS },
      difficultyReason: explanation,
      confidence: { type: 'string', enum: TEACHING_LEVELS },
      objective: explanation,
      misconception: { type: 'string' },
      visual: { type: 'string', enum: ['source', 'new', 'none'] },
      visualBenefit: { type: 'string' },
      visibleChange: { type: 'string' },
    },
  };
  return {
    ...(strict
      ? {
          $defs: {
            source: sources.length
              ? enumerated ? { type: 'string', enum: sources } : { type: 'string', description: 'An actual source ID from the full supplied document. Every ID is verified by the server.' }
              : { type: 'string', not: {} },
          },
        }
      : {}),
    type: 'object',
    additionalProperties: false,
    required: ['question', 'audienceAssumption', 'concepts', 'sections'],
    properties: {
      question: text(400),
      audienceAssumption: text(400),
      concepts: {
        type: 'array',
        minItems: 1,
        items: concept,
      },
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
    'Choose the number and granularity of concepts from this paper’s complexity, contribution, dependencies and the selected teaching profile. There is no target or maximum concept count. Preserve every concept the reader needs; split difficult mechanisms into distinct explanations rather than compressing or dropping them to fit a quota.',
    'Understand the complete paper before beginning its narration. Do not replace careful initial understanding with a generic opening or optimize the content to start playback sooner. An overview changes emphasis, not factual accuracy or the prerequisites needed to understand a claim.',
    'For each concept give stable short IDs, source evidence and prerequisite concept IDs. The first evidence ID is the primary passage/figure/equation where this concept is taught; put secondary support afterwards. Dependencies must be acyclic.',
    'Importance explains why understanding this concept is needed for the paper’s main question; difficulty estimates this audience’s required prior knowledge or multi-step reasoning. They are different decisions.',
    'State the audience assumption and confidence honestly. A likely misconception is a teaching hypothesis, not an observed fact about the learner.',
    'The objective says what the reader should be able to explain. A new visual must name the relationship or change it reveals and why source annotation alone is insufficient. Use none when no visual adds understanding.',
    'Keep summary separate from objective: summary is neutral, source-grounded spoken text explaining the concept and its consequence at the length it needs. Never write author commands such as Explain/Interpret/Show in summary. The objective is only planning guidance.',
    'A worked example is useful when computed from the paper’s formula and explicitly distinguished from measured data. Never invent measured results.',
    'Account for every actual section in sections: teach, background or omit with a reason. Keep the paper’s own headings; do not invent a Methods section.',
    `Additional profile instructions: ${preferences.instructions || 'Use a neutral, source-faithful explanation.'}`,
  ].join('\n');
}

/** A section and all its parents count as covered when a concept actually cites material inside it. */
export function taughtSections(doc: Doc, concepts: TeachingConcept[]): Set<string> {
  const blocks = new Map(doc.blocks.map((block, rank) => [block.id, { block, rank }]));
  const ancestors = new Map<string, string[]>(), stack: typeof doc.sections = [];
  const sections = [...doc.sections].sort((a, b) => (blocks.get(a.block)?.rank ?? 0) - (blocks.get(b.block)?.rank ?? 0));
  for (const section of sections) {
    while (stack.length && stack.at(-1)!.level >= section.level) stack.pop();
    stack.push(section); ancestors.set(section.id, stack.map((entry) => entry.id));
  }
  const covered = new Set<string>();
  for (const id of concepts.flatMap((concept) => concept.evidence)) {
    const sentence = doc.sentences.find((entry) => entry.id === id), equation = doc.equations.find((entry) => entry.id === id), figure = doc.figures.find((entry) => entry.id === id);
    const page = sentence?.page ?? equation?.page ?? figure?.page;
    const blockId = sentence?.block ?? equation?.block ?? figure?.caption_block;
    const source = blocks.get(blockId ?? '') ?? [...blocks.values()].filter(({ block }) => block.page === page)
      .sort((a, b) => Math.abs(a.block.bbox[1] - (equation?.bbox[1] ?? figure?.bbox[1] ?? 0)) - Math.abs(b.block.bbox[1] - (equation?.bbox[1] ?? figure?.bbox[1] ?? 0)))[0];
    const section = source?.block.section ?? [...sections].reverse().find((entry) => (blocks.get(entry.block)?.rank ?? Infinity) <= (source?.rank ?? -1))?.id;
    for (const ancestor of ancestors.get(section ?? '') ?? []) covered.add(ancestor);
  }
  return covered;
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
  const taught = taughtSections(doc, held.concepts);
  for (const section of held.sections)
    if (section.treatment === 'teach' && !taught.has(section.sectionId))
      problems.push(`Section ${section.sectionId} is marked teach but no concept cites its material. Add the actual concepts/evidence, or explain its different treatment.`);
  if (!held.concepts.some((c) => c.role === 'contribution')) problems.push('Include the paper’s main contribution.');
  if (!held.concepts.some((c) => c.role === 'evidence')) problems.push('Include the evidence for the contribution.');
  if (problems.length) return { plan: null, problems: problems.slice(0, 12) };
  return { plan: { version: 'teaching-plan@1', ...held }, problems: [] };
}

const priority = { low: 0, medium: 1, high: 2 };
export function selectedTeachingConcepts(plan: TeachingPlan, _preferences?: TeachingPreferences): TeachingConcept[] {
  // The model already planned the selected profile. Ordering must not silently delete its concepts or prerequisites.
  const byId = new Map(plan.concepts.map((concept) => [concept.id, concept]));
  const result: TeachingConcept[] = [], visited = new Set<string>();
  function append(id: string) {
    if (visited.has(id)) return;
    visited.add(id);
    const concept = byId.get(id);
    if (!concept) return;
    for (const prerequisite of concept.prerequisites) append(prerequisite);
    result.push(concept);
  }
  for (const concept of [...plan.concepts].sort((a, b) => priority[b.importance] - priority[a.importance])) append(concept.id);
  return result;
}

export function teachingNotes(concept: TeachingConcept): string[] {
  return [
    `CONCEPT: ${concept.title}. Sources: ${concept.evidence.join(', ')}.`,
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
  const blocks = new Map(doc.blocks.map((block, rank) => [block.id, { block, rank }]));
  const locate = (id: string) => {
    const element = elements.get(id);
    if (!element) return undefined;
    const sentence = doc.sentences.find((s) => s.id === id);
    const equation = doc.equations.find((e) => e.id === id);
    const figure = doc.figures.find((f) => f.id === id);
    const blockId = sentence?.block ?? equation?.block ?? figure?.caption_block ?? id;
    const entry = blocks.get(blockId);
    // Ingestion's block sequence preserves multi-column reading order. Geometry is only a last resort for an unlinked crop.
    const near =
      entry ??
      [...blocks.values()]
        .filter(({ block }) => block.page === element.page)
        .sort(
          (a, b) =>
            Math.abs(a.block.bbox[1] - (element.bbox?.[1] ?? 0)) - Math.abs(b.block.bbox[1] - (element.bbox?.[1] ?? 0)),
        )[0];
    const fraction = sentence && near ? (near.block.sentences.indexOf(id) + 1) / (near.block.sentences.length + 1) : 0;
    return { ...element, rank: near ? near.rank + fraction : Number.MAX_SAFE_INTEGER, sectionId: near?.block.section };
  };
  const location = (concept: TeachingConcept) => concept.evidence.map(locate).find((source) => source !== undefined);
  let selected = selectedTeachingConcepts(teaching, preferences);
  if (preferences.structure === 'paper')
    selected = selected.sort((a, b) => {
      const x = location(a),
        y = location(b);
      return (x?.rank ?? Number.MAX_SAFE_INTEGER) - (y?.rank ?? Number.MAX_SAFE_INTEGER);
    });
  const chapters: TourPlan['chapters'] = [];
  const beats: Beat[] = [];
  for (const concept of selected) {
    const where = location(concept);
    const section =
      doc.sections.find((s) => s.id === where?.sectionId) ??
      doc.sections
        .filter((s) => (blocks.get(s.block)?.rank ?? Infinity) <= (where?.rank ?? -1))
        .sort((a, b) => (blocks.get(b.block)?.rank ?? 0) - (blocks.get(a.block)?.rank ?? 0))[0];
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
                contribution: card.chapter_titles.idea,
                prerequisite: card.chapter_titles.problem,
                mechanism: card.chapter_titles.method,
                evidence: card.chapter_titles.evidence,
                limitation: card.chapter_titles.limits,
              }[concept.role],
      });
    const primary = concept.evidence[0];
    const target = doc.equations.some((e) => e.id === primary) || doc.figures.some((f) => f.id === primary) ? primary : undefined;
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
      point: concept.summary,
      evidence: concept.evidence.filter((id) => doc.sentences.some((s) => s.id === id)),
      ...(target ? { target } : {}),
      role: concept.importanceReason,
      notes: teachingNotes(concept),
      ...(concept.visual === 'none' ? {} : equation ? { board: 'formula' as const } : {}),
    });
    if (preferences.depth === 'deep' && preferences.structure !== 'overview' && concept.difficulty === 'high')
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
