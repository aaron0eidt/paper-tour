import Ajv2020 from 'ajv/dist/2020.js';
import type { Doc } from '../../../shared/paper';
import type { TeachingConcept, TeachingPlan, TeachingPreferences } from '../../../shared/teachingPlan';
import { ProcessingError } from '../errors';
import type { MuseMessage } from '../muse/client';
import { cleanTeachingPlan, teachingEvidence, teachingPlanSchema, teachingPlanTask } from './teaching-plan';

const ajv = new Ajv2020({ strict: false, allErrors: true });

/** Output-sized pages limit an individual API response, never the paper's concept map. */
export function teachingPageSchema(doc: Doc, strict = true) {
  const schema = teachingPlanSchema(doc, strict);
  return {
    ...schema,
    required: [...schema.required, 'complete'],
    properties: {
      ...schema.properties,
      concepts: { ...schema.properties.concepts, minItems: 0 },
      complete: { type: 'boolean' },
    },
  };
}

interface TeachingPage {
  question: string;
  audienceAssumption: string;
  concepts: TeachingConcept[];
  sections: TeachingPlan['sections'];
  complete: boolean;
}

interface TeachingAuthorInput {
  doc: Doc;
  preferences: TeachingPreferences;
  language: string;
  prefix: MuseMessage[];
  signal: AbortSignal;
  call: (messages: MuseMessage[], schema: object) => Promise<{ value: unknown }>;
  retryable: (error: unknown) => boolean;
  onProblems?: (problems: string[], consecutiveFailures: number) => Promise<void>;
}

/** A cancelled reader need not wait for a provider transport to acknowledge its signal. */
async function cancellable<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  let abort: (() => void) | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        signal.throwIfAborted();
        return run();
      }),
      new Promise<never>((_, reject) => {
        abort = () => reject(signal.reason ?? new DOMException('Planning cancelled.', 'AbortError'));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      }),
    ]);
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
  }
}

/** Forward prerequisite references are allowed; already-known source/graph errors are repaired immediately. */
function pageProblems(
  page: TeachingPage,
  concepts: Map<string, TeachingConcept>,
  sources: Set<string>,
  sections: Set<string>,
): string[] {
  const problems: string[] = [];
  if (
    new Set(page.concepts.map((entry) => entry.id)).size !== page.concepts.length ||
    new Set(page.sections.map((entry) => entry.sectionId)).size !== page.sections.length
  )
    problems.push('Each response must use unique concept and section IDs. Correct an entry by reusing its ID once.');
  for (const concept of page.concepts) {
    for (const source of concept.evidence)
      if (!sources.has(source))
        problems.push(`${concept.id}: unknown source ${source}. Use an actual ID from the supplied paper.`);
    if (concept.prerequisites.includes(concept.id))
      problems.push(`${concept.id}: a concept cannot be its own prerequisite.`);
    if (concept.visual === 'new' && (!concept.visualBenefit.trim() || !concept.visibleChange.trim()))
      problems.push(`${concept.id}: a new visual needs a concrete benefit and visible relationship/change.`);
  }
  for (const section of page.sections)
    if (!sections.has(section.sectionId))
      problems.push(`Unknown section ${section.sectionId}. Use the paper's actual section IDs.`);
  const merged = new Map([...concepts, ...page.concepts.map((concept) => [concept.id, concept] as const)]);
  const done = new Set<string>(),
    active = new Set<string>();
  for (const id of merged.keys()) {
    const pending = [{ id, leave: false }];
    while (pending.length) {
      const next = pending.pop()!;
      if (next.leave) {
        active.delete(next.id);
        done.add(next.id);
        continue;
      }
      if (done.has(next.id) || !merged.has(next.id)) continue;
      if (active.has(next.id)) {
        problems.push(`Cyclic prerequisites at ${next.id}. Keep dependencies acyclic.`);
        return problems.slice(0, 12);
      }
      active.add(next.id);
      pending.push({ id: next.id, leave: true });
      for (const prerequisite of merged.get(next.id)!.prerequisites) pending.push({ id: prerequisite, leave: false });
    }
  }
  return problems.slice(0, 12);
}

/** Monotonic planning facts exclude header/prose rewrites, entry order and previously seen grounding. */
function planningFacts(
  concepts: Map<string, TeachingConcept>,
  sections: Map<string, TeachingPlan['sections'][number]>,
): Set<string> {
  const facts = new Set<string>();
  for (const concept of concepts.values()) {
    facts.add(JSON.stringify(['concept', concept.id]));
    for (const source of concept.evidence) facts.add(JSON.stringify(['source', concept.id, source]));
    for (const prerequisite of concept.prerequisites)
      if (concepts.has(prerequisite)) facts.add(JSON.stringify(['dependency', concept.id, prerequisite]));
  }
  for (const id of sections.keys()) facts.add(JSON.stringify(['section', id]));
  return facts;
}

/**
 * Build the entire evidence map before narration. Sources and dependencies are checked on the merged map so a
 * prerequisite may be supplied on a later page. Stable IDs also let a correction replace one entry, rather than
 * rewriting or dropping an already understood part of the paper.
 */
export async function authorTeachingPlan(input: TeachingAuthorInput): Promise<TeachingPlan> {
  const schema = teachingPageSchema(input.doc),
    check = ajv.compile(teachingPageSchema(input.doc, false));
  const concepts = new Map<string, TeachingConcept>();
  const sections = new Map<string, TeachingPlan['sections'][number]>();
  const sources = new Set(teachingEvidence(input.doc)),
    sectionIds = new Set(input.doc.sections.map((section) => section.id));
  const seenFacts = new Set<string>();
  let question = '',
    audienceAssumption = '',
    failures = 0,
    feedback = '';
  let outstanding: string[] = [],
    rejected: unknown;
  const fail = async (problems: string[], value?: unknown) => {
    failures++;
    await input.onProblems?.(problems, failures);
    input.signal.throwIfAborted();
    if (failures >= 2)
      throw new ProcessingError(
        'invalid_teaching_plan',
        `The teaching plan could not be validated. ${problems.join(' ')}`,
      );
    feedback = `Correct these specific problems without reducing the paper's coverage:\n${problems.join('\n')}`;
    if (problems.some((problem) => /main contribution/i.test(problem)))
      feedback +=
        '\nIf an already saved concept explains the paper\'s actual novel contribution, return that concept with its same ID and role:"contribution". Correct that role only when its source evidence supports the novelty. Do not add a duplicate concept or merely change its title. Preserve the other concepts and evidence roles; do not invent a contribution or resend unchanged section treatments.';
    rejected = value;
  };
  while (true) {
    input.signal.throwIfAborted();
    const held = { question, audienceAssumption, concepts: [...concepts.values()], sections: [...sections.values()] };
    const task: MuseMessage[] = [
      ...input.prefix,
      {
        role: 'user',
        content: [
          teachingPlanTask(input.preferences, input.language),
          `Actual document sections (complete inventory, including sections without prose; account for every ID):\n${JSON.stringify(input.doc.sections.map(({ id, title, level, page }) => ({ id, title, level, page })))}`,
          'The entire map may span multiple responses. Return complete:false if more concepts or section accounting remain. Each response must contain whole entries and fit the API output budget. There is no total page or concept quota. Do not shorten the overall plan to fit one response.',
          'Return complete:true only after the complete paper has been understood and accounted for. On later responses supply the remaining entries or corrections using stable IDs. Prerequisites may refer to a concept supplied on a later page. Do not resend unchanged entries.',
          concepts.size || sections.size
            ? `Already saved planning entries:\n${JSON.stringify(held)}`
            : 'Start the complete teaching map.',
          rejected === undefined
            ? ''
            : `The rejected response below was not saved. Resubmit its whole corrected entries, including its useful concepts, without discarding any required content:\n${JSON.stringify(rejected)}`,
          feedback,
        ]
          .filter(Boolean)
          .join('\n\n'),
      },
    ];
    let value: unknown;
    try {
      value = (await cancellable(input.signal, () => input.call(task, schema))).value;
      input.signal.throwIfAborted();
    } catch (error) {
      input.signal.throwIfAborted();
      if (!input.retryable(error)) throw error;
      const smaller = error instanceof ProcessingError && error.code === 'muse_output_truncated';
      await fail([
        error instanceof Error ? error.message : 'The response could not be read.',
        smaller
          ? 'The response exhausted its output budget. Return a smaller batch of whole entries with complete:false, then continue the remaining paper in later responses. Preserve all saved entries and required content; do not shorten or drop concepts to fit one response.'
          : 'Return valid whole entries. If the response was too large, use a smaller batch with complete:false and continue afterwards without dropping content.',
      ]);
      continue;
    }
    if (!check(value)) {
      await fail(
        (check.errors ?? []).slice(0, 8).map((error) => `${error.instancePath}: ${error.message}`),
        value,
      );
      continue;
    }
    const page = value as unknown as TeachingPage;
    const problems = pageProblems(page, concepts, sources, sectionIds);
    if (problems.length) {
      await fail(problems, value);
      continue;
    }
    const nextConcepts = new Map([...concepts, ...page.concepts.map((concept) => [concept.id, concept] as const)]);
    const nextSections = new Map([
      ...sections,
      ...page.sections.map((section) => [section.sectionId, section] as const),
    ]);
    const merged = {
      question: page.question,
      audienceAssumption: page.audienceAssumption,
      concepts: [...nextConcepts.values()],
      sections: [...nextSections.values()],
    };
    const checked = page.complete || outstanding.length ? cleanTeachingPlan(merged, input.doc) : null;
    const facts = planningFacts(nextConcepts, nextSections);
    const addsFacts = [...facts].some((fact) => !seenFacts.has(fact));
    const repairs =
      outstanding.length > 0 &&
      !!checked &&
      checked.problems.length < outstanding.length &&
      checked.problems.every((problem) => outstanding.includes(problem));
    if (!page.complete && !addsFacts && !repairs) {
      await fail(
        [
          'The continuation made no planning progress. Changing metadata, repeating saved entries or rewording their prose is not progress. Supply remaining concepts/section treatments, resolve the outstanding validation problems, or return complete:true if the full paper has been accounted for.',
        ],
        value,
      );
      continue;
    }
    question = page.question;
    audienceAssumption = page.audienceAssumption;
    for (const concept of page.concepts) concepts.set(concept.id, concept);
    for (const section of page.sections) sections.set(section.sectionId, section);
    for (const fact of facts) seenFacts.add(fact);
    if (page.complete) {
      if (checked!.plan) return checked!.plan;
      if (repairs) failures = 0;
      outstanding = checked!.problems;
      // Valid entries remain saved; the next response may supply only the missing facts or targeted corrections.
      await fail(outstanding);
    } else {
      failures = 0;
      outstanding = checked?.problems ?? outstanding;
      feedback = outstanding.length
        ? `Resolve these outstanding issues before complete:true:\n${outstanding.join('\n')}`
        : '';
      rejected = undefined;
    }
  }
}
