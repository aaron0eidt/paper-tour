import { randomUUID } from 'node:crypto';
import type { Doc, Step, Tour } from '../../../shared/paper';
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
import { ANSWERABLE, type Answerable, type AskAnswer, type AskRequest, type StepSink } from './ask-types';
import { evidenceText, findStep, retrieve } from './ask-retrieval';
import { answerSchema, askContext, askInstructions } from './ask-authoring';
import { shownBoards } from './ask-boards';
import {
  answerBoardProblems,
  answerVisualProblems,
  buildAnswer,
  hasWorkedExample,
  readySteps,
  type AnswerContext,
} from './ask-answer';
import { currentSink, StepScanner } from './ask-stream';

// Preserve the existing Q&A API while keeping search and source I/O independent of authoring.
export { ANSWERABLE } from './ask-types';
export type { Answerable, AskAnswer, AskRequest, AskTurn } from './ask-types';
export { bm25, evidenceText, findStep, namedElements, namedExercise, retrieve, searchTerms } from './ask-retrieval';
export type { Passage, Retrieval } from './ask-retrieval';
export { DEMO_PAPER, DEMO_ROOT, demoImage, demoSelectionImages, figureImage, loadDemo } from './ask-assets';
export type { DemoPaper } from './ask-assets';

export { CUE_ACTIONS, answerProviderSchema, answerSchema, askContext, askInstructions } from './ask-authoring';
export {
  answerBoardProblems,
  answerVisualProblems,
  boardFromAnswer,
  buildAnswer,
  buildSteps,
  readySteps,
  spoken,
} from './ask-answer';
export type { AnswerContext, BoardRules } from './ask-answer';
export { answerBoardSchema, shownBoards } from './ask-boards';
export { NDJSON, StepScanner, answerResponse, currentSink, withSink } from './ask-stream';
export type { AnswerEvent, StepSink } from './ask-types';

const MODEL_FAULTS = new Set(['muse_invalid_response', 'muse_output_truncated', 'muse_refused']);
// A checked multi-frame visual answer can need one correction. Keep a bounded
// request deadline without aborting ordinary scene authoring before it returns.
const ASK_TIMEOUT_MS = 180_000;
/** The provider's lowest reasoning setting; MuseClient forwards the word as it is. */
const MINIMAL = 'minimal' as unknown as Effort;
/** Questions that are worked out: a calculation, a derivation, a proof, a worked example. They keep a little reasoning. */
const WORKED_OUT =
  /\b(?:calculat\w*|comput\w*|deriv\w*|prove\w*|proof|solv\w*|solution|work(?:ed|ing)?[ -](?:out|through)|step[- ]by[- ]step|numerical\w*|examples?|berechne\w*|herleit\w*|beweis\w*|löse\w*|loese\w*|beispiel\w*)\b/iu;

/**
 * How much the model thinks before it writes. Most questions are answered from a passage, and the hidden reasoning is
 * most of the wait (about a thousand tokens at low effort, a few hundred at minimal, with the same answers on the
 * questions tried), so they start at minimal. A calculation, a derivation or a question on an exercise sheet is worked
 * out and keeps low. The retry after an unusable answer always thinks more.
 */
export function askEffort(request: AskRequest, doc: Doc): Effort {
  return doc.exercises?.length || WORKED_OUT.test(request.question) ? 'low' : MINIMAL;
}

/**
 * Budgets include reasoning. The first attempt's effort is chosen per question (askEffort). The retry thinks more
 * (medium) when the answer is unusable, and only low when it just corrects a board, which the learner waits for while an
 * earlier step is spoken.
 */
const RETRY: { effort: Effort; maxTokens: number } = { effort: 'medium', maxTokens: 12_000 };
const BOARD_RETRY: { effort: Effort; maxTokens: number } = { effort: 'low', maxTokens: 8_000 };
const FIRST_TOKENS = 6_000;

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
  /**
   * Gets each step as soon as it is whole and checked, while the rest is still being written. Defaults to the sink of
   * the request being answered (ask-stream.ts), which the streaming route installs.
   */
  onStep?: StepSink;
}

/**
 * Answer one question: retrieve, call the model behind the shared prefix (SHARED_RULES and the paper block, as the tour
 * writer sends them, so the provider can reuse its cache), and convert the answer into checked steps. The first call is
 * read while it is written: each step that is whole and passes its checks goes to the sink at once, so the reader can
 * start on it while the rest is written, and a repair afterwards keeps the steps already shown.
 */
export async function answerQuestion(input: AskInput): Promise<{ answer: AskAnswer; completions: Completion[] }> {
  const { client, doc, request } = input;
  const started = Date.now();
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
  const shown = shownBoards(input.tour, request.stepId);
  const task = `${askInstructions(language)}\n${authoringRules.join(' ')}\nKeep quotations in the original document language. Explain them in the answer language.\n\n${askContext(request, retrieval, doc, step, input.image, shown)}`;
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
  const reasons = new Set<string>();
  const context: AnswerContext = {
    doc,
    retrieval,
    documentId: input.documentId,
    question: request.question,
    history: request.history ?? [],
    evidence: evidenceText(doc, retrieval),
    imaged: request.selection || input.image?.kind !== 'figure' ? undefined : input.image.targetId,
    idPrefix: `ask-${randomUUID().slice(0, 8)}`,
    boards: {
      results: retrieval.tables.length > 0,
      shown,
      dropped: (kind, problems) => {
        const reason = JSON.stringify([kind, problems]);
        if (reasons.has(reason)) return;
        reasons.add(reason);
        console.warn(JSON.stringify({ event: 'answer_board_dropped', documentId: input.documentId, kind, problems }));
      },
    },
  };
  const completions: Completion[] = [];
  let answer: AskAnswer | null = null;
  // The steps the learner already has: they never change, and a repair is told to keep them.
  const shownSteps: Step[] = [];
  let verdict: Answerable | undefined;
  let firstStepMs: number | undefined;
  const sink = input.onStep ?? currentSink();
  // The answer language the learner chose is spoken from the first step on; otherwise the tour's voice speaks.
  const spokenIn = responseLanguage(request.responseLanguage) ? language : undefined;
  const reader = (): ((text: string) => Promise<void>) | undefined => {
    if (!sink) return undefined;
    const scanner = new StepScanner();
    let stopped = false;
    return async (text) => {
      if (stopped) return;
      try {
        const found = scanner.push(text);
        verdict ??= ANSWERABLE.find((a) => a === scanner.answerable);
        if (!scanner.ok) stopped = true;
        if (stopped || !found.length) return;
        // Only an answer the document gives is spoken early: a "no" is retried first, and a verdict that has not come
        // before the first step cannot be assumed.
        if (verdict === undefined || verdict === 'no') {
          stopped = true;
          return;
        }
        // One step at a time, so a step that fails its checks does not hold back the whole steps before it.
        while (shownSteps.length < scanner.steps.length) {
          const ready = readySteps(scanner.steps.slice(0, shownSteps.length + 1), context, authoringRules);
          const next = ready?.[shownSteps.length];
          if (!next) {
            stopped = true;
            return;
          }
          shownSteps.push(next);
          firstStepMs ??= Date.now() - started;
          sink(verdict, next, spokenIn);
        }
      } catch (error) {
        // Reading ahead is only a head start: the whole answer still comes from the finished call.
        stopped = true;
        console.warn(
          JSON.stringify({ event: 'answer_stream_stopped', documentId: input.documentId, error: String(error) }),
        );
      }
    };
  };
  const first = { effort: askEffort(request, doc), maxTokens: FIRST_TOKENS };
  let retry = RETRY;
  /** Send the answer back for a correction; the steps the learner already has stay as they are. */
  const correct = (value: unknown, instruction: string) =>
    messages.push(
      { role: 'assistant', content: JSON.stringify(value) },
      {
        role: 'user',
        content: shownSteps.length
          ? `${instruction} Steps 1 to ${shownSteps.length} have already been spoken to the learner: keep them exactly as they are and correct only the later steps.`
          : instruction,
      },
    );
  for (let attempt = 0; attempt < 2; attempt++) {
    const { effort, maxTokens } = attempt === 0 ? first : retry;
    let value: unknown;
    try {
      const completion = await client.complete(
        messages,
        'ask_answer',
        schema,
        maxTokens,
        signal,
        attempt === 0 ? reader() : undefined,
        undefined,
        effort,
      );
      completions.push(completion);
      value = completion.value;
    } catch (error) {
      // A usable first answer survives a failed retry; otherwise only the model's own faults earn a retry.
      if (answer || (attempt > 0 && shownSteps.length)) break;
      if (attempt > 0 || !(error instanceof ProcessingError && MODEL_FAULTS.has(error.code))) throw error;
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
      correct(
        value,
        `Correct the visual targeting or worked example below. Keep valid evidence; correct the narration if example values or steps must change: ${[...new Set(visualProblems)].join(' ')}`,
      );
      continue;
    }
    const candidate = buildAnswer(value, context);
    if (candidate?.steps.some((step) => readsSource(step.say, doc))) {
      correct(
        value,
        'Explain the mechanism, consequence or intuition in your own words. Do not read the source aloud; retain its facts and exact quotations only when needed.',
      );
      continue;
    }
    const narrationProblems = candidate ? answerNarrationProblems(candidate.steps, authoringRules) : [];
    if (narrationProblems.length) {
      console.warn(
        JSON.stringify({ event: 'answer_narration_repair', documentId: input.documentId, problems: narrationProblems }),
      );
      correct(
        value,
        `Repair the answer: ${narrationProblems.join(' ')} Keep valid evidence and useful native boards. Return one coherent explanation without repeating steps or speaking internal instructions.`,
      );
      continue;
    }
    answer = candidate ?? answer;
    // A board that fails its checks is only dropped, unless the learner is already listening to an earlier step: then
    // its correction is made while that step is spoken.
    const boardProblems =
      attempt === 0 && shownSteps.length ? answerBoardProblems(value, context, shownSteps.length) : [];
    if (boardProblems.length) {
      console.warn(
        JSON.stringify({ event: 'answer_board_repair', documentId: input.documentId, problems: boardProblems }),
      );
      retry = BOARD_RETRY;
      correct(
        value,
        `Correct the boards below, keeping every step's narration and cues; where a board cannot be made right, set its kind to none and keep the explanation: ${boardProblems.join(' ')}`,
      );
      continue;
    }
    if (answer && answer.answerable !== 'no') break;
  }
  // A step already spoken is never taken back: it opens the answer, and the answer is only what the learner has if the
  // rest could not be made.
  if (shownSteps.length)
    answer = {
      answerable: answer?.answerable ?? verdict ?? 'partly',
      steps: [...shownSteps, ...(answer?.steps.slice(shownSteps.length) ?? [])],
      followups: answer?.followups ?? [],
    };
  if (!answer) throw new ProcessingError('muse_invalid_response', 'The model returned no usable answer.');
  console.log(
    JSON.stringify({
      event: 'answer_visuals',
      documentId: input.documentId,
      effort: first.effort,
      measuredTargets: retrieval.measured?.length ?? 0,
      ...(firstStepMs !== undefined ? { firstStepMs, earlySteps: shownSteps.length } : {}),
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
