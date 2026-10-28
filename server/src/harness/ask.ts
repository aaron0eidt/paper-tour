import type { Doc, Tour } from '../../../shared/paper';
import { validateSelection } from '../../../shared/selection';
import { responseLanguage } from '../../../shared/languages';
import { HttpError, ProcessingError } from '../errors';
import type { Completion, MuseClient, MuseMessage } from '../muse/client';
import { isContributorModel } from '../muse/models';
import { OFFICIAL_MODELS } from '../muse/pricing';
import type { TourImage } from '../tour-generator';
import { imageParts, type Effort } from './calls';
import { REGION_NAMES } from './direct';
import { answerNarrationProblems, readsSource } from './insight';
import { documentLanguage } from './language';
import { measuredFigureTargets } from './measured-visuals';
import { paperBlock } from './paper-block';
import { SHARED_RULES } from './prompts';
import type { AskAnswer, AskRequest } from './ask-types';
import { findStep, retrieve } from './ask-retrieval';
import { answerSchema, askContext, askInstructions } from './ask-authoring';
import { answerVisualProblems, buildAnswer, hasWorkedExample, type AnswerContext } from './ask-answer';

// Preserve the existing Q&A API while keeping search and source I/O independent of authoring.
export { ANSWERABLE } from './ask-types';
export type { Answerable, AskAnswer, AskRequest, AskTurn } from './ask-types';
export { bm25, findStep, namedElements, namedExercise, retrieve, searchTerms } from './ask-retrieval';
export type { Passage, Retrieval } from './ask-retrieval';
export { DEMO_PAPER, DEMO_ROOT, demoImage, demoSelectionImages, figureImage, loadDemo } from './ask-assets';
export type { DemoPaper } from './ask-assets';

export { CUE_ACTIONS, answerProviderSchema, answerSchema, askContext, askInstructions } from './ask-authoring';
export { answerVisualProblems, boardFromAnswer, buildAnswer, spoken } from './ask-answer';
export type { AnswerContext } from './ask-answer';

const MODEL_FAULTS = new Set(['muse_invalid_response', 'muse_output_truncated', 'muse_refused']);
// A checked multi-frame visual answer can need one correction. Keep a bounded
// request deadline without aborting ordinary scene authoring before it returns.
const ASK_TIMEOUT_MS = 180_000;
/** Low effort first; medium once when the first answer cannot answer or is unusable. Budgets include reasoning. */
const ATTEMPTS: { effort: Effort; maxTokens: number }[] = [
  { effort: 'low', maxTokens: 6_000 },
  { effort: 'medium', maxTokens: 12_000 },
];

export interface AskInput {
  client: MuseClient;
  doc: Doc;
  documentId: string;
  request: AskRequest;
  tour?: Tour;
  /** The crop of the figure asked about, when it was cheap to load. */
  image?: TourImage;
  /** Full-page context and crop rendered from the original PDF for a region question. */
  images?: TourImage[];
  language: string;
  signal?: AbortSignal;
  measureFigure?: typeof measuredFigureTargets;
}

/**
 * Answer one question: retrieve, call the model behind the shared prefix (SHARED_RULES and the paper block, as the tour
 * writer sends them, so the provider can reuse its cache), and convert the answer into checked steps.
 */
export async function answerQuestion(input: AskInput): Promise<{ answer: AskAnswer; completions: Completion[] }> {
  const { client, doc, request } = input;
  if (request.selection) validateSelection(request.selection, doc);
  const step = findStep(input.tour, request.stepId);
  const retrieval = retrieve(doc, request, step);
  const signal = AbortSignal.any([AbortSignal.timeout(ASK_TIMEOUT_MS), ...(input.signal ? [input.signal] : [])]);
  if (input.image?.kind === 'figure' && !request.selection) {
    retrieval.measured = await (input.measureFigure ?? measuredFigureTargets)(input.image, signal);
    retrieval.visuals.push(...retrieval.measured.map((t) => t.id));
  }
  const language = responseLanguage(request.responseLanguage)
    ? request.responseLanguage
    : (input.tour?.voices?.host?.lang ?? documentLanguage(doc, input.language));
  const authoringRules = [
    'The say fields contain only explanations addressed to the learner.',
    'Never narrate schema, rendering instructions or authoring rules.',
  ];
  const task = `${askInstructions(language)}\n${authoringRules.join(' ')}\nKeep quotations in the original document language. Explain them in the answer language.\n\n${askContext(request, retrieval, doc, step, input.image)}`;
  const messages: MuseMessage[] = [
    { role: 'developer', content: SHARED_RULES },
    { role: 'user', content: `<DOCUMENT>\n${paperBlock(doc)}\n</DOCUMENT>` },
    {
      role: 'user',
      content: [
        { type: 'text', text: task },
        ...imageParts([...(input.images ?? []), ...(input.image ? [input.image] : [])]),
      ],
    },
  ];
  const schema = answerSchema(
    retrieval,
    input.image?.kind === 'figure' && !request.selection ? REGION_NAMES : ['whole'],
  );
  const context: AnswerContext = {
    doc,
    retrieval,
    documentId: input.documentId,
    question: request.question,
    history: request.history ?? [],
    evidence: [...retrieval.focus, ...retrieval.ranked]
      .map((p) => p.text)
      .concat(retrieval.tables.flatMap((t) => t.lines))
      .join('\n'),
    imaged: request.selection || input.image?.kind !== 'figure' ? undefined : input.image.targetId,
  };
  const completions: Completion[] = [];
  let answer: AskAnswer | null = null;
  for (const { effort, maxTokens } of ATTEMPTS) {
    let value: unknown;
    try {
      const completion = await client.complete(
        messages,
        'ask_answer',
        schema,
        maxTokens,
        signal,
        undefined,
        undefined,
        effort,
      );
      completions.push(completion);
      value = completion.value;
    } catch (error) {
      // A usable first answer survives a failed retry; otherwise only the model's own faults earn a retry.
      if (answer) break;
      if (effort !== 'low' || !(error instanceof ProcessingError && MODEL_FAULTS.has(error.code))) throw error;
      continue;
    }
    context.requireExample ||= hasWorkedExample(value);
    const visualProblems = answerVisualProblems(value, context);
    if (visualProblems.length) {
      console.warn(
        JSON.stringify({
          event: 'answer_visual_repair',
          documentId: input.documentId,
          attempt: completions.length,
          problems: visualProblems,
        }),
      );
      messages.push(
        { role: 'assistant', content: JSON.stringify(value) },
        {
          role: 'user',
          content: `Correct the visual targeting or worked example below. Keep valid evidence; correct the narration if example values or steps must change: ${[...new Set(visualProblems)].join(' ')}`,
        },
      );
      continue;
    }
    const candidate = buildAnswer(value, context);
    if (candidate?.steps.some((step) => readsSource(step.say, doc))) {
      messages.push(
        { role: 'assistant', content: JSON.stringify(value) },
        {
          role: 'user',
          content:
            'Explain the mechanism, consequence or intuition in your own words. Do not read the source aloud; retain its facts and exact quotations only when needed.',
        },
      );
      continue;
    }
    const narrationProblems = candidate ? answerNarrationProblems(candidate.steps, authoringRules) : [];
    if (narrationProblems.length) {
      console.warn(
        JSON.stringify({ event: 'answer_narration_repair', documentId: input.documentId, problems: narrationProblems }),
      );
      messages.push(
        { role: 'assistant', content: JSON.stringify(value) },
        {
          role: 'user',
          content: `Repair the answer: ${narrationProblems.join(' ')} Keep valid evidence and useful native boards. Return one coherent explanation without repeating steps or speaking internal instructions.`,
        },
      );
      continue;
    }
    answer = candidate ?? answer;
    if (answer && answer.answerable !== 'no') break;
  }
  if (!answer) throw new ProcessingError('muse_invalid_response', 'The model returned no usable answer.');
  console.log(
    JSON.stringify({
      event: 'answer_visuals',
      documentId: input.documentId,
      measuredTargets: retrieval.measured?.length ?? 0,
      steps: answer.steps.map((step) => ({
        id: step.id,
        actions: step.actions.reduce<Record<string, number>>((counts, action) => {
          counts[action.type] = (counts[action.type] ?? 0) + 1;
          return counts;
        }, {}),
      })),
    }),
  );
  if (responseLanguage(request.responseLanguage)) answer = { ...answer, language };
  return { answer, completions };
}

// ------------------------------------------------------------- service glue

/** The document's own model answers its questions; a Contributor model only with this paper's training consent. */
export function askModel(model: unknown, allowTraining: boolean, fallback: string): string {
  let id = typeof model === 'string' ? model.trim() : '';
  if (isContributorModel(id) && !allowTraining) id = id.replace(/-contributor$/, '');
  const known = Object.hasOwn(OFFICIAL_MODELS, id) ? OFFICIAL_MODELS[id] : undefined;
  return known?.tourCompatible && (allowTraining || !known.contributor) ? id : fallback;
}

/** Model failures in plain words for the learner; a key problem points to the settings, or for demos to the .env. */
export function askError(error: unknown, demo = false): unknown {
  if (!(error instanceof ProcessingError)) return error;
  if (['muse_not_configured', 'muse_auth_failed'].includes(error.code))
    return new HttpError(
      409,
      'model_not_configured',
      demo
        ? 'Demo questions use the server’s Meta API key: set MODEL_API_KEY in the root .env.'
        : 'Check your Meta API key under Profile & Settings, then ask again.',
    );
  if (error.code === 'muse_rate_limited')
    return new HttpError(429, 'model_busy', 'The model is busy right now. Ask again in a moment.');
  if (error.code === 'muse_timeout')
    return new HttpError(504, 'answer_timeout', 'The answer took too long. Ask again, or ask a shorter question.');
  if (error.transient)
    return new HttpError(503, 'model_unavailable', 'The model could not be reached. Ask again in a moment.');
  return new HttpError(502, 'answer_failed', 'The model could not answer this. Try asking it another way.');
}
