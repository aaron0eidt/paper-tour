import Ajv2020 from 'ajv/dist/2020.js';
import type { Doc } from '../../../shared/paper';
import type { TeachingConcept, TeachingPlan, TeachingPreferences } from '../../../shared/teachingPlan';
import { ProcessingError } from '../errors';
import type { MuseMessage } from '../muse/client';
import { cleanTeachingPlan, teachingPlanSchema, teachingPlanTask } from './teaching-plan';

const ajv = new Ajv2020({ strict: false, allErrors: true });

/** Output-sized pages limit an individual API response, never the paper's concept map. */
export function teachingPageSchema(doc: Doc) {
  const schema = teachingPlanSchema(doc);
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

/**
 * Build the entire evidence map before narration. Sources and dependencies are checked on the merged map so a
 * prerequisite may be supplied on a later page. Stable IDs also let a correction replace one entry, rather than
 * rewriting or dropping an already understood part of the paper.
 */
export async function authorTeachingPlan(input: TeachingAuthorInput): Promise<TeachingPlan> {
  const schema = teachingPageSchema(input.doc), check = ajv.compile(schema);
  const concepts = new Map<string, TeachingConcept>();
  const sections = new Map<string, TeachingPlan['sections'][number]>();
  let question = '', audienceAssumption = '', failures = 0, feedback = '';
  const fail = async (problems: string[]) => {
    failures++;
    await input.onProblems?.(problems, failures);
    if (failures >= 2)
      throw new ProcessingError('invalid_teaching_plan', `The teaching plan could not be validated. ${problems.join(' ')}`);
    feedback = `Correct these specific problems without reducing the paper's coverage:\n${problems.join('\n')}`;
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
          'The entire map may span multiple responses. Return complete:false if more concepts or section accounting remain. Each response must contain whole entries and fit the API output budget. There is no total page or concept quota. Do not shorten the overall plan to fit one response.',
          'Return complete:true only after the complete paper has been understood and accounted for. On later responses supply the remaining entries or corrections using stable IDs. Prerequisites may refer to a concept supplied on a later page. Do not resend unchanged entries.',
          concepts.size || sections.size ? `Already saved planning entries:\n${JSON.stringify(held)}` : 'Start the complete teaching map.',
          feedback,
        ].filter(Boolean).join('\n\n'),
      },
    ];
    let value: unknown;
    try {
      value = (await input.call(task, schema)).value;
    } catch (error) {
      input.signal.throwIfAborted();
      if (!input.retryable(error)) throw error;
      await fail([error instanceof Error ? error.message : 'The response could not be read. Return a smaller batch of whole entries and continue afterwards.']);
      continue;
    }
    if (!check(value)) {
      await fail((check.errors ?? []).slice(0, 8).map((error) => `${error.instancePath}: ${error.message}`));
      continue;
    }
    const page = value as unknown as TeachingPage;
    if (new Set(page.concepts.map((entry) => entry.id)).size !== page.concepts.length ||
        new Set(page.sections.map((entry) => entry.sectionId)).size !== page.sections.length) {
      await fail(['Each response must use unique concept and section IDs. Correct an entry by reusing its ID once.']);
      continue;
    }
    const before = JSON.stringify(held);
    question = page.question;
    audienceAssumption = page.audienceAssumption;
    for (const concept of page.concepts) concepts.set(concept.id, concept);
    for (const section of page.sections) sections.set(section.sectionId, section);
    const merged = { question, audienceAssumption, concepts: [...concepts.values()], sections: [...sections.values()] };
    if (page.complete) {
      const checked = cleanTeachingPlan(merged, input.doc);
      if (checked.plan) return checked.plan;
      await fail(checked.problems);
    } else if (before === JSON.stringify(merged) || !page.concepts.length && !page.sections.length) {
      await fail(['The continuation made no planning progress. Supply the remaining concepts/section treatments or complete the already finished map.']);
    } else {
      failures = 0;
      feedback = '';
    }
  }
}
