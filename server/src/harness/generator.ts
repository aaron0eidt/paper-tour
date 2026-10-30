import { claimsNumericExample } from './example';
import { randomUUID } from 'node:crypto';
import { indexElements } from '../elements';
import { isAuthoredVisual } from '../visuals/inspect';
import { reviewAuthoredWithModel } from '../visuals/model-author';
import type { TeachingPlan } from '../../../shared/teachingPlan';
import {
  cleanTeachingPlan,
  teachingEvidence,
  teachingPlanSchema,
  teachingPlanTask,
  teachingTourPlan,
} from './teaching-plan';
import { lossSentence } from '../../../shared/coverage';
import { splitWords, type BoardItem, type Doc, type LossCause, type Step, type Tour } from '../../../shared/paper';
import { tourDirection } from '../../../shared/tourDirection';
import { tourProfileGuidance } from '../../../shared/tourProfiles';
import type { MuseConfig } from '../config';
import { ProcessingError } from '../errors';
import type { GeneratedTour, TourGenerationInput, TourGenerator, TourImage, TourProgress } from '../tour-generator';
import { MuseClient, type MuseMessage } from '../muse/client';
import { checkImages, imageEvidence } from '../muse/context';
import { OFFICIAL_MODELS } from '../muse/pricing';
import { arcSchema, arcTask, arcTourPlan, cleanArcPlan, fallbackArcPlan, type ArcPlan, type ArcType } from './arcs';
import {
  assembleTour,
  beatStep,
  boardProblems,
  dropRepeatedBoards,
  frameSteps,
  settleBoards,
  tourProblems,
  tourSeconds,
} from './assemble';
import { paperPlan, type Beat, type Preset, type TourPlan } from './beats';
import {
  claimContext,
  claimPlan,
  claimSentenceIds,
  claimsEvent,
  claimsSchema,
  claimsTask,
  cleanClaims,
  thesisBeat,
  type Claim,
  type ClaimContext,
} from './claims';
import {
  attachUncovered,
  cleanDeckPlan,
  deckSchema,
  deckTask,
  deckTourPlan,
  fallbackDeckPlan,
  namesCallback,
  slideCards,
  slideText,
  type DeckPlan,
} from './deck';
import { deckLike, guessType, type DocType } from './doctype';
import { moveProblems } from './moves';
import { imageParts, pool, type Effort } from './calls';
import { recordedCalls } from '../ai/recorded-calls';
import { cardProblems, cardSchema, cleanCard, evidencePool, fallbackCard, repairTurn, type PaperCard } from './card';
import {
  CHECK_STEPS,
  checkBrief,
  checkMaterial,
  checkSchema,
  checkSites,
  checkSteps,
  checkTargets,
  checkTask,
  cleanCheck,
  type CheckSite,
} from './check';
import type { BoardKind } from './board';
import {
  boardStepsOf,
  degradeDirection,
  leftOutOf,
  withoutBoards,
  type Degraded,
  type DroppedPart,
  type Omission,
  type StepOutcome,
} from './degrade';
import {
  beatBrief,
  beatTargets,
  cleanDirection,
  directOptions,
  directionSchema,
  exampleRules,
  highlightedSentences,
  lengthProblems,
  sayLimit,
  withReadyView,
  type BeatTargets,
  type Direction,
} from './direct';
import {
  cleanSolution,
  exercisePlan,
  lineName,
  solutionLines,
  solutionRepair,
  solveSchema,
  solveTask,
  unitBrief,
  unitFallback,
  unitOverhead,
  unitSteps,
  type Solution,
} from './exercise';
import { cleanUnitVisual, hasVisualHost, unitVisualSchema, unitVisualTask, type UnitVisual } from './exercise-visual';
import { paperBlock } from './paper-block';
import {
  RESTATEMENT_REPAIR,
  RESTATEMENT_SHARE,
  narrationProblems,
  readsSource,
  repeatsExplanation,
  restatedShare,
} from './insight';
import { documentLanguage } from './language';
import { PACE, limited, outlasting, type Pace } from './pace';
import { HARNESS_VERSION, SHARED_RULES, cardTask, directTask } from './prompts';
import { measuredFigureTargets } from './measured-visuals';
import { pythonVerifier, type LineCheck, type MathVerifier } from './verify';
import {
  allocateFrames,
  cleanOpeningPlan,
  cleanVisualPlan,
  openingPlanTask,
  plannableBeats,
  visualPlanBrief,
  visualPlanEvent,
  visualPlanSchema,
  visualPlanTask,
  withTableBoard,
  type PlanAdjustment,
  type StepVisual,
  type VisualPlan,
} from './visual-plan';

/**
 * The image a beat's direction sees: the figure's own crop, or for a formula the page with the typeset equation (or,
 * for a formula printed in the text, the page that prints it).
 */
function beatImage(beat: Beat, doc: Doc, images: TourImage[]): TourImage | undefined {
  const equation = doc.equations.find((e) => e.id === beat.target);
  const page = equation?.page ?? (beat.target ? undefined : beat.page);
  if (page) return images.find((i) => i.kind === 'page' && i.targetId === `page${page}`);
  return images.find((i) => i.targetId === beat.target && i.kind !== 'page');
}

/**
 * What stage C gives back for a beat: a directed step, with what it lost on the way (degrade.ts), or an exercise
 * part's steps.
 */
type BeatResult =
  | { targets: BeatTargets; direction: Direction | null; degraded?: Degraded; omission?: Omission }
  | {
      steps: Step[];
      solved: boolean;
      checks: LineCheck[];
      visual?: BoardKind;
      degraded?: Degraded;
      omission?: Omission;
    };

const MODEL_FAULTS = new Set(['muse_invalid_response', 'muse_output_truncated', 'muse_refused', 'muse_slow']);
/** A beat survives the model's own faults and transient provider errors; credentials and rejected requests do not. */
const recoverable = (error: unknown) =>
  error instanceof ProcessingError && (MODEL_FAULTS.has(error.code) || error.transient);
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));
/** Why a model call gave nothing: it took too long, the provider could not be reached, or its answer was no use. */
const faultOf = (error: unknown): LossCause =>
  error instanceof ProcessingError && error.transient
    ? 'unavailable'
    : error instanceof ProcessingError && error.code === 'muse_slow'
      ? 'slow'
      : 'invalid';
/** What a part's problems say of the correction that did not mend it: it came too late, was no use, or never came. */
const lateNote = (correction: LossCause | null, cause: LossCause): string[] =>
  correction === 'slow'
    ? ['the correction took too long to write']
    : correction === 'invalid'
      ? ['the correction came back unusable']
      : correction === 'unavailable'
        ? ['the model was not available for the correction']
        : correction
          ? []
          : [cause === 'slow' ? 'there was no time left to correct it' : 'the tries to correct it ran out'];
const EFFORTS: readonly Effort[] = ['minimal', 'low', 'medium', 'high'];
/** The reasoning effort one rung below the given one; minimal is the least. */
const lower = (effort: Effort): Effort => EFFORTS[Math.max(0, EFFORTS.indexOf(effort) - 1)];
const atMost = (effort: Effort, cap: Effort): Effort =>
  EFFORTS[Math.min(EFFORTS.indexOf(effort), EFFORTS.indexOf(cap))];

/**
 * Short tours of a document's main ideas (notes/HARNESS.md): understand the document once and say what kind it is
 * (stage A), plan beats for that kind by preset (B: in code for a paper or an exercise sheet, with one call for the
 * other kinds), direct every beat in parallel with enum-constrained targets, or solve and check an exercise part (C),
 * assemble and validate in code (F).
 */
export class HarnessTourGenerator implements TourGenerator {
  readonly model: string;
  readonly configured: boolean;
  private readonly client: MuseClient;
  constructor(
    private readonly config: MuseConfig,
    private readonly preset: Preset = 'standard',
    private readonly transport?: typeof fetch,
    private readonly verifier: MathVerifier = pythonVerifier(),
    private readonly measureFigure: typeof measuredFigureTargets = measuredFigureTargets,
    private readonly pace: Pace = PACE,
  ) {
    this.model = config.model;
    this.configured = Boolean(config.apiKey.trim());
    this.client = new MuseClient(config, transport);
  }
  withModel(model: string): TourGenerator {
    if (!OFFICIAL_MODELS[model]?.tourCompatible)
      throw new ProcessingError('unsupported_model', 'Choose a model that supports paper text and images.');
    return model === this.model
      ? this
      : new HarnessTourGenerator(
          { ...this.config, model },
          this.preset,
          this.transport,
          this.verifier,
          this.measureFigure,
          this.pace,
        );
  }
  async generate(
    input: TourGenerationInput,
    onProgress?: (progress: TourProgress) => Promise<void>,
    externalSignal?: AbortSignal,
  ): Promise<GeneratedTour> {
    if (input.profile && input.profile.depth !== this.preset)
      return new HarnessTourGenerator(
        this.config,
        input.profile.depth,
        this.transport,
        this.verifier,
        this.measureFigure,
        this.pace,
      ).generate(input, onProgress, externalSignal);
    if (!this.configured)
      throw new ProcessingError('muse_not_configured', 'Tour creation needs a Muse API key on the server.');
    const siblings = new AbortController();
    const signal = AbortSignal.any([
      siblings.signal,
      AbortSignal.timeout(this.config.timeoutMs),
      ...(externalSignal ? [externalSignal] : []),
    ]);
    checkImages(input);
    const { doc } = input;
    const language = documentLanguage(doc, this.config.language);
    const { call: record, completions } = recordedCalls(this.client, input, this.model, HARNESS_VERSION);
    /**
     * A model call with the time limit of its name (pace.ts); a slower call fails with `muse_slow` and is tried again by
     * its caller. A provider that could not take the call (a 5xx or a 429) is waited out here first (Pace.outages), each
     * try with its own time limit, so that a burst of a few seconds costs a step nothing.
     */
    const call = (
      messages: MuseMessage[],
      name: string,
      schema: object,
      maxTokens: number,
      effort: Effort,
      signal: AbortSignal,
      task?: { id: string; label: string },
      ms = this.pace.callMs(name, effort),
    ) =>
      outlasting(signal, this.pace.outages, () =>
        limited(signal, ms, (within) => record(messages, name, schema, maxTokens, effort, within, task)),
      );
    const progress = (stage: TourProgress['stage'], done: number, total: number) =>
      onProgress?.({ stage, imagesDone: done, imagesTotal: total });
    const elements = new Map(indexElements(doc).map((element) => [element.id, element]));
    const inspectVisual = async (
      item: BoardItem,
      narration: string,
      brief: string,
      images: TourImage[],
      beat: Beat,
    ): Promise<BoardItem> => {
      if (!isAuthoredVisual(item)) return item;
      const callId = randomUUID(),
        started = Date.now();
      await input.onEvent?.('tool.started', {
        callId,
        name: 'render_visual',
        arguments: { beat: beat.id, kind: item.kind },
      });
      try {
        const reviewed = await reviewAuthoredWithModel(item, {
          client: {
            complete: (...args: Parameters<MuseClient['complete']>) => {
              const [messages, name, schema, maxTokens, within] = args;
              return call(messages, name, schema, maxTokens, 'low', within ?? signal, {
                id: beat.id,
                label:
                  name === 'authored_visual_review'
                    ? 'Check the rendered explanation'
                    : 'Correct the rendered explanation',
              });
            },
          },
          narration,
          evidence: [
            brief,
            ...item.sourceRefs.map((id) => `[${id}] ${elements.get(id)?.text ?? 'Unknown source'}`),
          ].join('\n'),
          sourceImages: images.map((image) => image.dataUrl),
          allowedSourceRefs: [...elements.keys()],
          signal,
        });
        await input.onEvent?.('tool.completed', {
          callId,
          name: 'render_visual',
          beat: beat.id,
          kind: reviewed.kind,
          durationMs: Date.now() - started,
        });
        return reviewed;
      } catch (error) {
        await input.onEvent?.('tool.completed', {
          callId,
          name: 'render_visual',
          beat: beat.id,
          failed: true,
          durationMs: Date.now() - started,
          error: error instanceof Error ? error.message : 'Visual inspection failed.',
        });
        throw error;
      }
    };
    const prefix: MuseMessage[] = [
      { role: 'developer', content: SHARED_RULES },
      ...(tourProfileGuidance(input.profile)
        ? [{ role: 'user' as const, content: tourProfileGuidance(input.profile) }]
        : []),
      { role: 'user', content: `<DOCUMENT>\n${paperBlock(doc)}\n</DOCUMENT>` },
    ];

    // A. Understand: one paper card with evidence, from the text, page 1 and the most cited figures.
    await progress('writing', 0, 1);
    const evidenceIds = evidencePool(doc).map((s) => s.id);
    const schema = cardSchema(doc, evidenceIds);
    const looseSchema = cardSchema(doc, evidenceIds, false);
    const cited = [...doc.figures].sort((a, b) => b.referenced_by.length - a.referenced_by.length).slice(0, 4);
    const keyImages = ['page1', ...cited.map((f) => f.id)]
      .map((id) => input.images.find((image) => image.targetId === id))
      .filter((image): image is TourImage => Boolean(image));
    const messages: MuseMessage[] = [
      ...prefix,
      { role: 'user', content: [{ type: 'text', text: cardTask(language) }, ...imageParts(keyImages)] },
    ];
    // The claims of a paper do not depend on its card, only the choice to look for them does: a document laid out like a
    // paper, with claims in two places, gets its claims call now, in parallel with the card, and the call is dropped
    // when the card says the document is something else.
    const speculation = new AbortController();
    const findClaims = async (context: ClaimContext, within: AbortSignal): Promise<Claim[] | null> => {
      const task: MuseMessage[] = [
        ...prefix,
        { role: 'user', content: [{ type: 'text', text: claimsTask(language, context, this.preset) }] },
      ];
      const sentenceIds = claimSentenceIds(doc, context);
      let found: Claim[] | null = null;
      for (let attempt = 0; attempt < 2 && !found; attempt++) {
        try {
          // The first try reasons lightly (the schema and the places do the checking); a repair reasons more.
          const completion = await call(
            task,
            'claims',
            claimsSchema(doc, sentenceIds, this.preset),
            10_000,
            attempt ? 'medium' : 'low',
            within,
          );
          const checked = cleanClaims(completion.value, doc, context, this.preset);
          found = checked.claims;
          if (!found) {
            await input.onEvent?.('validation.failed', {
              stage: 'claims',
              problems: checked.problems,
              attempt: attempt + 1,
            });
            task.push(...repairTurn(completion.value, checked.problems));
          }
        } catch (error) {
          within.throwIfAborted();
          if (!recoverable(error)) throw error;
          if ((error as ProcessingError).transient) await pause(1500 * (attempt + 1));
        }
      }
      return found;
    };
    const conceptLed = !input.profile || input.profile.structure === 'concepts';
    const claimsContext = conceptLed && guessType(doc) === 'research_paper' ? claimContext(doc) : null;
    const early = claimsContext ? findClaims(claimsContext, AbortSignal.any([signal, speculation.signal])) : null;
    // A call nobody waits for must not fail the process; whoever uses its claims sees the error.
    early?.catch(() => {});

    let card: PaperCard | null = null;
    try {
      for (let attempt = 0; attempt < 2 && !card; attempt++) {
        try {
          // The first try reasons as little as the API allows: the card is read off the document, the schema holds every
          // ID to a listed one and the checks below hold the rest; a repair reasons more.
          const completion = await call(messages, 'paper_card', schema, 12_000, attempt ? 'medium' : 'minimal', signal);
          const problems = cardProblems(completion.value, looseSchema);
          if (!problems.length) card = cleanCard(completion.value as PaperCard, doc);
          else {
            await input.onEvent?.('validation.failed', { stage: 'card', problems, attempt: attempt + 1 });
            messages.push(...repairTurn(completion.value, problems));
          }
        } catch (error) {
          // The model's own faults fall back to a card from the document; a transient provider error is retried once
          // and then fails the job, which the worker retries later, rather than settling for a weaker tour.
          signal.throwIfAborted();
          if (!recoverable(error)) throw error;
          if ((error as ProcessingError).transient) {
            if (attempt) throw error;
            await pause(1500);
          }
        }
      }
    } catch (error) {
      speculation.abort();
      throw error;
    }
    const usable =
      card && card.problem.evidence.length && card.key_idea.evidence.length && card.takeaway.evidence.length;
    const cardSource = usable ? 'model' : 'fallback';
    if (!usable) card = { ...fallbackCard(doc), ...(card ? { doc_type: card.doc_type } : {}) };

    // B. Plan the beats for the kind of document: a paper's claims (one call) or its argument in code, a deck slide by
    // slide (one call), a sheet's parts in code, the arc of the other kinds with one call, all sized by the preset. A
    // sheet without tasks found by ingestion is toured as "other".
    const sheet = card!.doc_type === 'exercise_sheet' && Boolean(doc.exercises?.length);
    const deck = !sheet && deckLike(doc) && ['lecture', 'other', 'research_paper'].includes(card!.doc_type);
    const type: DocType = deck ? 'lecture' : card!.doc_type;
    const paper = !sheet && !deck && type === 'research_paper';
    if (!paper) speculation.abort();
    // Interpret importance and reader-relative difficulty independently of the opening-claim extractor.
    // This call overlaps claim planning; its verified objectives guide both the writer and visual planner.
    const prepareTeaching = async (): Promise<TeachingPlan | null> => {
      if (!paper || !input.profile) return null;
      if (!teachingEvidence(doc).length)
        throw new ProcessingError(
          'missing_teaching_sources',
          'This paper has no citable text, equations or figures. Check PDF extraction before generating a tour.',
        );
      const task: MuseMessage[] = [...prefix, { role: 'user', content: teachingPlanTask(input.profile, language) }];
      let problems: string[] = [];
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const completion = await call(
            task,
            'teaching_plan',
            teachingPlanSchema(doc, true, input.profile),
            12_000,
            attempt ? 'medium' : 'low',
            signal,
          );
          const checked = cleanTeachingPlan(completion.value, doc);
          if (checked.plan) return checked.plan;
          problems = checked.problems;
          await input.onEvent?.('validation.failed', { stage: 'teaching_plan', attempt: attempt + 1, problems });
          task.push(...repairTurn(completion.value, problems));
        } catch (error) {
          signal.throwIfAborted();
          if (!recoverable(error)) throw error;
          problems = [error instanceof Error ? error.message : 'The teaching plan could not be read.'];
        }
      }
      throw new ProcessingError(
        'invalid_teaching_plan',
        `The teaching plan could not be validated. ${problems.join(' ')}`,
      );
    };
    const preparingTeaching = prepareTeaching();
    preparingTeaching.catch(() => {});
    /**
     * The visual of a paper's opening step, planned alone from the card while the claims are still being found, so that
     * the step the learner waits for does not wait for the plan of the whole tour (visual-plan.ts, openingPlanTask).
     * The plan of the other steps keeps this choice and counts it. Without a usable answer the step waits for that plan.
     */
    const planOpening = async (beat: Beat): Promise<StepVisual | null> => {
      const started = Date.now();
      const task: MuseMessage[] = [
        ...prefix,
        {
          role: 'user',
          content: [{ type: 'text', text: `${openingPlanTask(language)}\n\n${visualPlanBrief(card!, [beat], doc)}` }],
        },
      ];
      let chosen: StepVisual | null = null;
      try {
        for (let attempt = 0; attempt < 2 && !chosen; attempt++) {
          try {
            const completion = await call(task, 'opening_visual', visualPlanSchema([beat]), 4_000, 'minimal', signal, {
              id: beat.id,
              label: 'Design the opening visual',
            });
            const checked = cleanOpeningPlan(completion.value, beat);
            chosen = checked.visual;
            if (!chosen) {
              await input.onEvent?.('validation.failed', {
                stage: 'opening',
                problems: checked.problems,
                attempt: attempt + 1,
              });
              task.push(...repairTurn(completion.value, checked.problems));
            }
          } catch (error) {
            signal.throwIfAborted();
            if (!recoverable(error)) throw error;
            // A slow answer is not waited for twice: the step would rather wait for the plan of the whole tour.
            if ((error as ProcessingError).code === 'muse_slow') break;
            if ((error as ProcessingError).transient) await pause(1500 * (attempt + 1));
          }
        }
      } catch {
        // The plan of the whole tour decides the opening step as it does the others.
      }
      if (signal.aborted) return null;
      await input.onEvent?.('visual.opening', {
        beat: beat.id,
        source: chosen ? 'model' : 'fallback',
        durationMs: Date.now() - started,
        ...(chosen ? { visual: chosen.visual, idea: chosen.idea, data: chosen.data } : {}),
      });
      return chosen;
    };
    const thesis: Beat | null =
      paper && conceptLed && thesisBeat(card!).evidence.length ? { id: 'problem-1', ...thesisBeat(card!) } : null;
    const opening = thesis ? planOpening(thesis).catch(() => null) : null;
    let plan: TourPlan;
    let planSource = 'code';
    let claims: Claim[] | null = null;
    let deckPlan: DeckPlan | null = null;
    let uncovered: number[] = [];
    if (sheet) plan = exercisePlan(card!, doc, this.preset);
    else if (deck) {
      const slides = slideCards(doc);
      const title = card!.title || doc.source.title || 'the lecture';
      const task: MuseMessage[] = [
        ...prefix,
        { role: 'user', content: [{ type: 'text', text: deckTask(language, slides, this.preset, title) }] },
      ];
      // The plan with the fewest faults is kept: a repair that is worse than the first answer does not replace it.
      let best: { plan: DeckPlan; problems: string[] } | null = null;
      for (let attempt = 0; attempt < 2 && !(best && !best.problems.length); attempt++) {
        try {
          const completion = await call(
            task,
            'deck_plan',
            deckSchema(slides.length, this.preset),
            8_000,
            'medium',
            signal,
          );
          const checked = cleanDeckPlan(completion.value, slides, this.preset);
          if (checked.plan && (!best || checked.problems.length <= best.problems.length))
            best = { plan: checked.plan, problems: checked.problems };
          if (checked.problems.length) {
            await input.onEvent?.('validation.failed', {
              stage: 'deck',
              problems: checked.problems,
              attempt: attempt + 1,
            });
            task.push(...repairTurn(completion.value, checked.problems));
          }
        } catch (error) {
          signal.throwIfAborted();
          if (!recoverable(error)) throw error;
          if ((error as ProcessingError).transient) await pause(1500 * (attempt + 1));
        }
      }
      planSource = best ? 'model' : 'fallback';
      const tied = attachUncovered(best?.plan ?? fallbackDeckPlan(slides, this.preset, title), slides, this.preset);
      deckPlan = tied.plan;
      uncovered = tied.left;
      plan = deckTourPlan(tied.plan, card!, doc);
    } else if (type === 'research_paper') {
      // The paper's claims: what the authors state in at least two of the abstract, the introduction and the
      // conclusion, with the evidence for each. Without usable claims the tour follows the paper's argument instead.
      const context = conceptLed ? (claimsContext ?? claimContext(doc)) : null;
      if (context) claims = await (early ?? findClaims(context, signal));
      const byClaims = claims ? claimPlan(claims, card!, doc, this.preset) : null;
      // A claim plan too thin to teach (no evidence to point at) is no plan.
      if (byClaims && byClaims.beats.length >= 4) {
        plan = byClaims;
        planSource = 'claims';
        await input.onEvent?.('claims.ready', { claims: claimsEvent(claims!) });
      } else {
        claims = null;
        plan = paperPlan(card!, doc, this.preset);
      }
    } else {
      const arcType: ArcType = type === 'exercise_sheet' ? 'other' : type;
      const schema = arcSchema(arcType, doc, evidenceIds, this.preset);
      const page1 = keyImages.filter((image) => image.targetId === 'page1');
      const task: MuseMessage[] = [
        ...prefix,
        {
          role: 'user',
          content: [{ type: 'text', text: arcTask(arcType, language, this.preset) }, ...imageParts(page1)],
        },
      ];
      let arcs: ArcPlan | null = null;
      for (let attempt = 0; attempt < 2 && !arcs; attempt++) {
        try {
          const completion = await call(task, 'tour_plan', schema, 8_000, 'medium', signal);
          const { plan: next, problems } = cleanArcPlan(completion.value, arcType, doc, this.preset);
          arcs = next;
          if (!next) {
            await input.onEvent?.('validation.failed', { stage: 'plan', problems, attempt: attempt + 1 });
            task.push(...repairTurn(completion.value, problems));
          }
        } catch (error) {
          signal.throwIfAborted();
          if (!recoverable(error)) throw error;
          if ((error as ProcessingError).transient) await pause(1500 * (attempt + 1));
        }
      }
      planSource = arcs ? 'model' : 'fallback';
      plan = arcTourPlan(arcs ?? fallbackArcPlan(card!, arcType), arcType, card!, doc, this.preset, language);
    }
    const teachingPlan = await preparingTeaching;
    if (teachingPlan && input.profile) {
      plan = teachingTourPlan(teachingPlan, doc, input.profile, card!, plan);
      planSource = `adaptive-${input.profile.structure}`;
      await input.onEvent?.('teaching.ready', {
        question: teachingPlan.question,
        audienceAssumption: teachingPlan.audienceAssumption,
        concepts: teachingPlan.concepts,
        sections: teachingPlan.sections,
      });
    }
    const { beats } = plan;
    if (!beats.length) throw new ProcessingError('invalid_tour', 'This document has no text a tour could explain.');
    // Quick checks close a few chapters of a paper or a lecture; each is written once the chapter's steps are.
    const sites = checkSites(plan, this.preset);
    await input.onEvent?.('plan.ready', {
      preset: this.preset,
      docType: plan.type,
      cardSource,
      planSource,
      beats: beats.map(({ id, kind, arc, target, point, detail, move, slides }) => ({
        id,
        kind,
        arc,
        label: point,
        detail: !!detail,
        ...(target ? { target } : {}),
        ...(move ? { move } : {}),
        ...(slides ? { slides } : {}),
      })),
      ...(deckPlan
        ? {
            skipped: deckPlan.skipped,
            ...(uncovered.length ? { uncovered } : {}),
          }
        : {}),
      ...(sites.length
        ? { checks: sites.map((site) => ({ chapter: site.chapter.id, after: beats[site.beats.at(-1)!].id })) }
        : {}),
    });

    // B2. Plan the side-board visuals of the whole tour with one call that sees every beat, so each step gets the picture
    // that makes its point click and no two steps draw the same thing. On an exercise sheet the call plans the method
    // visual of each task (at most one, diversity first across the sheet) and the solution lines stay formula boards.
    // Without a usable plan every beat keeps the board its kind suggests, and a sheet's tasks have no visual. Worked
    // examples count: the plan allots the kinds of their frames, so that they stay within the tour's limits.
    // The plan is made while the steps that do not need it are written: a paper's opening step has its own choice
    // (planOpening), which the plan keeps, and a sheet's tasks are solved before their method visual is drawn.
    let visuals: VisualPlan | null = null;
    let adjusted: PlanAdjustment[] = [];
    const sheetTour = beats.some((beat) => beat.unit);
    const plannable = plannableBeats(beats);
    // The opening step was planned ahead when the plan's first step is the step it was planned for.
    const ahead = thesis && beats[0]?.id === thesis.id && beats[0].kind === thesis.kind ? opening : null;
    const planning = (async () => {
      if (!plannable.length) return;
      const decided = ahead ? await ahead : null;
      const settled: VisualPlan = decided ? new Map([[thesis!.id, decided]]) : new Map();
      const options = {
        sheet: sheetTour,
        ...(input.profile ? { adaptive: true } : {}),
        ...(settled.size ? { settled: true } : {}),
      };
      const rest = plannable.filter((beat) => !settled.has(beat.id));
      const task: MuseMessage[] = [
        ...prefix,
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${visualPlanTask(language, options)}\n\n${visualPlanBrief(card!, plannable, doc, settled)}`,
            },
          ],
        },
      ];
      if (!rest.length) visuals = new Map(settled);
      for (let attempt = 0; attempt < 2 && !visuals; attempt++) {
        try {
          // The plan sets the tour's visuals, so it reasons at medium; the opening step no longer waits for it.
          const completion = await call(task, 'visual_plan', visualPlanSchema(rest, options), 8_000, 'medium', signal);
          const checked = cleanVisualPlan(completion.value, plannable, options, settled);
          visuals = checked.plan;
          adjusted = checked.adjusted;
          if (!checked.plan) {
            await input.onEvent?.('validation.failed', {
              stage: 'visuals',
              problems: checked.problems,
              attempt: attempt + 1,
            });
            task.push(...repairTurn(completion.value, checked.problems));
          }
        } catch (error) {
          signal.throwIfAborted();
          if (!recoverable(error)) throw error;
          if ((error as ProcessingError).transient) await pause(1500 * (attempt + 1));
        }
      }
      if (visuals) {
        // A results step on a table with ready boards draws the table's own numbers when the plan left them out.
        const kept = new Set(settled.keys());
        const withData = withTableBoard(visuals, plannable, doc, kept);
        visuals = withData.plan;
        adjusted = [...adjusted, ...withData.adjusted];
        // A sheet's overview and takeaway have no visual of their own.
        for (const beat of beats)
          if (!visuals.has(beat.id)) visuals.set(beat.id, { visual: 'none', idea: '', data: '' });
        visuals = allocateFrames(visuals, beats, kept);
      }
      await input.onEvent?.('visual.plan', {
        source: visuals ? 'model' : 'fallback',
        beats: visuals
          ? visualPlanEvent(visuals, plannable)
          : plannable.map(({ id, board }) => ({ beat: id, ...(board ? { suggested: board } : {}) })),
        ...(adjusted.length ? { adjusted } : {}),
      });
    })();
    // The steps that wait for the plan see its failure; a plan nobody waits for must not fail the process.
    planning.catch(() => {});
    /** The planned visual of a step: ahead of the plan for the opening, none for a sheet's overview and takeaway. */
    const visualOf = async (beat: Beat): Promise<StepVisual | undefined> => {
      if (sheetTour && !beat.unit) return { visual: 'none', idea: '', data: '' };
      const early = ahead && beat.id === thesis!.id ? await ahead : null;
      if (early) return early;
      await planning;
      return visuals?.get(beat.id);
    };

    // C. Direct each beat in parallel: narration plus cues limited to the beat's own targets; an exercise part is
    // solved, checked and taught as several steps.
    const sentenceText = new Map(doc.sentences.map((s) => [s.id, s.text]));
    let directed = 0;
    await progress('writing', 0, beats.length);
    const teach = async (beat: Beat): Promise<BeatResult> => {
      const unit = beat.unit!;
      const pages = unit.pages
        .slice(0, 2)
        .map((n) => input.images.find((image) => image.kind === 'page' && image.targetId === `page${n}`))
        .filter((image): image is TourImage => Boolean(image));
      const task: MuseMessage[] = [
        ...prefix,
        {
          role: 'user',
          content: [{ type: 'text', text: solveTask(language, unitBrief(unit, doc), unit) }, ...imageParts(pages)],
        },
      ];
      let best: { solution: Solution; checks: LineCheck[]; problems: string[] } | null = null;
      let fault: LossCause = 'invalid';
      // A solution that outlived its time is asked again at one rung less reasoning (pace.ts), so that the part keeps it.
      let effort: Effort = 'high';
      // One repair at most, for an unusable answer or for lines that cannot be shown or do not check out; the part
      // keeps its best answer, and a line still in doubt is marked on the board.
      for (let attempt = 0; attempt < 2 && !(best && !best.problems.length); attempt++) {
        try {
          const completion = await call(task, 'exercise_solution', solveSchema(unit), 24_000, effort, signal, {
            id: beat.id,
            label: beat.point,
          });
          const { solution, problems } = cleanSolution(completion.value, unit, doc);
          if (!solution) {
            fault = 'invalid';
            await input.onEvent?.('validation.failed', {
              stage: 'solution',
              beat: beat.id,
              problems,
              attempt: attempt + 1,
            });
            task.push(...repairTurn(completion.value, problems));
            continue;
          }
          const checks = await this.verifier(solutionLines(solution), signal);
          const wrong = checks.flatMap((check, i) =>
            check.status === 'failed'
              ? [`${lineName(solution, i)}: ${check.problem ?? 'the maths does not check out'}`]
              : [],
          );
          const all = [...problems, ...wrong];
          await input.onEvent?.('solution.checked', {
            beat: beat.id,
            lines: checks.map((check) => check.status),
            problems: all,
            attempt: attempt + 1,
          });
          if (!best || all.length <= best.problems.length) best = { solution, checks, problems: all };
          if (all.length) task.push(...solutionRepair(completion.value, all));
        } catch (error) {
          signal.throwIfAborted();
          if (!recoverable(error)) throw error;
          fault = faultOf(error);
          if ((error as ProcessingError).transient) await pause(1500 * (attempt + 1));
          else if (fault === 'slow') {
            effort = lower(effort);
            if (attempt < 1) await input.onEvent?.('beat.lean', { beat: beat.id, effort, attempt: attempt + 1 });
          }
        }
      }
      if (!best) {
        await progress('writing', ++directed, beats.length);
        await input.onEvent?.('beat.fallback', { beat: beat.id, code: fault });
        return { steps: unitFallback(unit, doc), solved: false, checks: [], omission: { code: fault } };
      }
      // The method visual the plan gave this task, drawn once the part is solved so that it fits the solution; one
      // repair, and a visual that still fails is dropped, flagged, with the solution lines as they were.
      await planning;
      const planned = visuals?.get(beat.id);
      const hosted = hasVisualHost(unit, best.solution);
      let drawn: UnitVisual | null = null;
      let lost = hosted ? [] : ['the part has no method step to show it'];
      // Why the visual is missing: a check rejected it, or no usable answer came.
      let why: LossCause = 'checks';
      if (planned && planned.visual !== 'none' && hosted) {
        const kind = planned.visual;
        const ask: MuseMessage[] = [
          ...prefix,
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: unitVisualTask(language, unitBrief(unit, doc), { ...planned, visual: kind }, best.solution),
              },
              ...imageParts(pages),
            ],
          },
        ];
        for (let attempt = 0; attempt < 2 && !drawn; attempt++) {
          try {
            const completion = await call(ask, 'exercise_visual', unitVisualSchema(kind), 8_000, 'medium', signal, {
              id: beat.id,
              label: beat.point,
            });
            const checked = cleanUnitVisual(completion.value, kind, unit, doc, best.solution, planned);
            await input.onEvent?.('exercise.visual', {
              beat: beat.id,
              kind,
              problems: checked.problems,
              attempt: attempt + 1,
            });
            drawn = checked.visual;
            lost = checked.problems;
            why = 'checks';
            if (!drawn) ask.push(...repairTurn(completion.value, checked.problems));
          } catch (error) {
            signal.throwIfAborted();
            if (!recoverable(error)) throw error;
            why = faultOf(error);
            if ((error as ProcessingError).transient) await pause(1500 * (attempt + 1));
          }
        }
      }
      if (drawn)
        drawn = {
          ...drawn,
          item: await inspectVisual(
            drawn.item,
            unitSteps(unit, best.solution, best.checks, language, drawn)
              .filter((step) => step.actions.some((action) => action.type === 'board' && action.item === drawn!.item))
              .map((step) => step.say)
              .join('\n'),
            unitBrief(unit, doc),
            pages,
            beat,
          ),
        };
      await progress('writing', ++directed, beats.length);
      return {
        steps: unitSteps(unit, best.solution, best.checks, language, drawn),
        solved: true,
        checks: best.checks,
        ...(drawn ? { visual: drawn.item.kind } : {}),
        ...(planned && planned.visual !== 'none' && !drawn
          ? {
              degraded: {
                dropped: ['board' as const],
                problems: lost.length
                  ? lost.slice(0, 8)
                  : [why === 'slow' ? 'the board took too long to write' : 'the model gave no usable board'],
                causes: { board: why },
              },
            }
          : {}),
      };
    };
    const results: BeatResult[] = new Array(beats.length);
    /** A step asked for its narration alone: no board, no worked example (a slow step, below). */
    const alone: StepVisual = { visual: 'none', idea: '', data: '', bare: true };
    const faulty = (direction: Direction) =>
      Boolean(direction.boardProblems?.length || direction.visualProblems?.length || direction.exampleProblems?.length);
    const direct = async (beat: Beat, chosen: StepVisual | undefined): Promise<BeatResult> => {
      if (beat.unit) return teach(beat);
      const began = Date.now();
      const image = beatImage(beat, doc, input.images);
      // A step on slides sees the page of each (up to three), so that code, plots and tables on them are explained.
      const pages = (beat.slides ?? [])
        .slice(0, 3)
        .flatMap((n) => input.images.find((i) => i.kind === 'page' && i.targetId === `page${n}`) ?? [])
        .filter((page) => page !== image);
      const seen = [...(image ? [image] : []), ...pages];
      let measured: BeatTargets['measured'];
      if (image?.kind === 'figure') {
        const started = Date.now();
        measured = await this.measureFigure(image, signal);
        await input.onEvent?.('visual.targets', {
          source: image.targetId,
          count: measured.length,
          durationMs: Date.now() - started,
        });
      }
      const overviewIndex = beat.detail
        ? beats.findIndex((b) => !b.detail && b.kind === beat.kind && b.target === beat.target)
        : -1;
      const overviewResult = results[overviewIndex];
      const overview = overviewResult && 'direction' in overviewResult ? overviewResult.direction?.say : undefined;
      const beatIndex = beats.indexOf(beat);
      const outline = beats.map((b, i) => `${i + 1}. ${b.point}`).join('\n');
      /** Everything one try is made of, for the visual the step is written with. */
      const setup = (visual: StepVisual | undefined) => {
        const targets = beatTargets(beat, doc, visual);
        if (image && image.kind !== 'page') targets.imaged = image.targetId;
        if (measured) targets.measured = measured;
        const options = directOptions(beat, plan.type, targets, visual);
        const brief =
          `SOURCE OUTLINE (you write step ${beatIndex + 1}; build on the steps before it and never repeat what they say):\n${outline}\n` +
          beatBrief(beat, doc, targets, visual) +
          (overview ? `\nPRECEDING OVERVIEW (already heard; do not repeat):\n${overview}` : '');
        const text = directTask(language, brief, options);
        const task: MuseMessage[] = [
          ...prefix,
          { role: 'user', content: [{ type: 'text', text }, ...imageParts(seen)] },
        ];
        return {
          visual,
          targets,
          task,
          asked: task.length,
          schema: directionSchema(beat, targets, true, visual),
          example: exampleRules(beat, visual),
        };
      };
      let now = setup(chosen);
      let direction: Direction | null = null;
      let requireExample = now.example.required;
      // A step that mostly restates its highlighted sentences, or runs past its cap, is sent back once; until then its
      // direction is kept. A rewrite that was only to shorten it and is not shorter does not replace it.
      let rewrites = 0;
      let rewriting = false;
      let shortenedFrom: number | null = null;
      // A call that outlived its time with nothing to repair is asked again for less (pace.ts), so that a slow step keeps
      // its narration instead of vanishing: one rung less reasoning each time, and without the board it was planned to
      // draw, which is what takes the time. A worked example the step must show is asked for once more at less effort,
      // then given up; the step says what it lost, and that it was the time.
      let slow = 0;
      let ceiling: Effort = 'high';
      let tries = 3;
      const gave = new Set<'board' | 'example'>();
      // Why the latest try gave no usable narration, for a step that ends without any; and whether that narration, asked
      // for alone, was nothing without the worked example (it repeated the overview).
      let fault: LossCause = 'invalid';
      let hollow = false;
      // What came of the latest correction of a faulty board, example or mark; null while none was asked for.
      let correction: LossCause | null = null;
      const spent = () => Date.now() - began;
      /** Asks for less from the next try; false when the step is already asked for its narration alone. */
      const lighter = (attempt: number) => {
        if (now.visual?.bare || (slow < 2 && now.example.required)) return false;
        if (now.example.required) gave.add('example');
        else if (now.visual && now.visual.visual !== 'none') gave.add('board');
        // What the tries before were told still holds, and the lighter try has a repair of its own.
        const told = now.task.slice(now.asked);
        now = setup(alone);
        now.task.push(...told);
        now.asked = now.task.length;
        requireExample = false;
        tries = Math.max(tries, attempt + 3);
        return true;
      };
      // The model can correct its complete direction twice, with all validation faults in each reply. What still fails
      // afterwards is dropped and flagged (degradeDirection), never published and never a reason to fail the tour. A
      // step whose narration is usable stops asking once it has used its time for repairs: the board that still fails
      // goes the same way, so that one board that will not come right cannot hold the tour back.
      let attempt = 0;
      for (
        ;
        attempt < tries && !(direction && !rewriting && (!faulty(direction) || spent() >= this.pace.stepMs));
        attempt++
      ) {
        // Reasoning shares the provider's output budget. Complex scenes exhausted
        // 6k tokens in reasoning alone and returned incomplete JSON on every retry.
        const detailed = !gave.size && (beat.detail || attempt > 0);
        const effort = atMost(detailed ? 'medium' : 'low', ceiling);
        const own = this.pace.callMs('beat_direction', effort);
        hollow = false;
        // A faulty board, example or pen mark is being corrected by this try.
        const correcting = !!direction && faulty(direction);
        try {
          // A repair gets what is left of the step's time, and at least repairMs: one of a faulty board, and one after a
          // first try that gave nothing usable (its task carries the turn that says what to fix).
          const repairing = direction ? correcting : now.task.length > now.asked;
          const completion = await call(
            now.task,
            'beat_direction',
            now.schema,
            detailed ? 12_000 : 6_000,
            effort,
            signal,
            { id: beat.id, label: beat.point },
            repairing ? Math.min(own, Math.max(this.pace.repairMs, this.pace.stepMs - spent())) : own,
          );
          const rawSay = (completion.value as { say?: unknown } | null)?.say;
          requireExample ||=
            now.example.offered &&
            ((completion.value as { example?: unknown } | null)?.example !== undefined ||
              (typeof rawSay === 'string' && claimsNumericExample(rawSay)));
          const corruption = typeof rawSay === 'string' ? narrationProblems(rawSay) : [];
          const cleaned = corruption.length
            ? null
            : cleanDirection(completion.value, beat, now.targets, requireExample, now.visual);
          if (corruption.length) {
            await input.onEvent?.('validation.failed', {
              stage: 'narration',
              beat: beat.id,
              problems: corruption,
              attempt: attempt + 1,
            });
            now.task.push(...repairTurn(completion.value, corruption));
          }
          const copied = cleaned && readsSource(cleaned.say, doc);
          const repeated = cleaned && overview && repeatsExplanation(cleaned.say, overview);
          const next = copied || repeated ? null : cleaned;
          // Reading the source aloud is no use, which is not the same as repeating what the tour already said.
          if (!next) fault = repeated ? 'repeats' : 'invalid';
          hollow = !!now.visual?.bare && !!repeated;
          if (correcting) correction = next ? 'checks' : 'invalid';
          if (repeated) {
            await input.onEvent?.('beat.duplicate', { beat: beat.id, attempt: attempt + 1 });
            now.task.push(
              ...repairTurn(completion.value, [
                `This repeats the preceding overview. Teach a new ${now.visual?.bare ? '' : 'worked example, '}cause-and-effect mechanism or comparison instead; do not rephrase the same symbol definitions.`,
              ]),
            );
          }
          if (copied)
            now.task.push(
              ...repairTurn(completion.value, [
                'Explain the mechanism, consequence or intuition in your own words; do not read the source aloud.',
              ]),
            );
          if (next) {
            if (shortenedFrom === null || splitWords(next.say).length < shortenedFrom) direction = next;
            rewriting = false;
          }
          // Report every fault together. Previously an example error skipped
          // the board error below, so the only repair never saw the bad scene.
          const issues = [
            ...(next?.exampleProblems ?? []),
            ...(next?.visualProblems ?? []),
            ...(next?.boardProblems ?? []),
          ];
          if (next && issues.length) {
            await input.onEvent?.('validation.failed', {
              stage: 'direction',
              beat: beat.id,
              problems: issues,
              attempt: attempt + 1,
            });
            now.task.push(...repairTurn(completion.value, issues));
            continue;
          }
          if (next && !rewrites && attempt < 2) {
            // A step on slides is held against the slides' whole text, which the learner can read; any other against
            // the sentences it highlights.
            const highlighted = beat.slides
              ? slideText(beat, doc)
              : highlightedSentences(next, beat, now.targets).flatMap((id) => sentenceText.get(id) ?? []);
            const share = restatedShare(next.say, highlighted);
            const moves = moveProblems(next.say, beat.move);
            const callback =
              beat.slides && !namesCallback(next.say, beat, doc)
                ? [
                    `This step builds on slide ${beat.callbacks![0]}: name it once as "slide ${beat.callbacks![0]}" and say in one clause how it sets this step up.`,
                  ]
                : [];
            const long = lengthProblems(next.say, beat);
            const repairs = [
              ...(share >= RESTATEMENT_SHARE ? [RESTATEMENT_REPAIR] : []),
              ...moves,
              ...callback,
              ...long,
            ];
            if (repairs.length) {
              rewrites++;
              rewriting = true;
              if (long.length === repairs.length) shortenedFrom = splitWords(next.say).length;
              if (share >= RESTATEMENT_SHARE)
                await input.onEvent?.('beat.restates', {
                  beat: beat.id,
                  share: Number(share.toFixed(2)),
                  attempt: attempt + 1,
                });
              if (moves.length || callback.length || long.length)
                await input.onEvent?.('beat.guarded', {
                  beat: beat.id,
                  problems: [...moves, ...callback, ...long],
                  attempt: attempt + 1,
                });
              now.task.push(...repairTurn(completion.value, repairs));
            }
          }
          if (!next)
            now.task.push(
              ...repairTurn(completion.value, [
                `say must be 8-${sayLimit(beat)} spoken words.`,
                'Every cue needs an allowed action, a listed target and an anchor copied from say.',
              ]),
            );
        } catch (error) {
          signal.throwIfAborted();
          if (!recoverable(error)) throw error;
          fault = faultOf(error);
          if (correcting) correction = fault;
          if ((error as ProcessingError).transient) await pause(1500 * (attempt + 1));
          else if (fault === 'slow') {
            slow++;
            ceiling = lower(effort);
            if (!direction) {
              const before = gave.size;
              const asksLess = lighter(attempt) || ceiling !== effort;
              // Said only when the next try asks for less than this one did: what was given up for the time, if anything, and its effort.
              if (asksLess && attempt + 1 < tries)
                await input.onEvent?.('beat.lean', {
                  beat: beat.id,
                  ...(gave.size > before && gave.has('board') && chosen ? { visual: chosen.visual } : {}),
                  ...(gave.size > before ? { dropped: [...gave] } : {}),
                  effort: ceiling,
                  attempt: attempt + 1,
                });
            }
          }
        }
      }
      await progress('writing', ++directed, beats.length);
      if (!direction) {
        // A step whose worked example was given up for the time, and whose narration alone is nothing without it, is left
        // out for that; any other, for what went wrong with its latest try.
        const omission: Omission =
          gave.has('example') && hollow ? { code: 'slow', because: 'example' } : { code: fault };
        // The step is left out when nothing stands in for it: a detail always, any other step when its stand-in (the
        // planned point) only reads the source aloud.
        const vanished = !ownSteps(beatIndex, { targets: now.targets, direction }).length;
        await input.onEvent?.(vanished ? 'beat.omitted' : 'beat.fallback', { beat: beat.id, ...omission });
        return { targets: now.targets, direction, omission };
      }
      const lean: Degraded | undefined = gave.size
        ? {
            dropped: [...gave],
            problems: [...gave].map((part) =>
              part === 'example'
                ? 'the worked example took too long to write'
                : `the ${chosen?.visual} took too long to write`,
            ),
            causes: Object.fromEntries([...gave].map((part) => [part, 'slow' as const])),
          }
        : undefined;
      // A board, example or pen mark that still fails is dropped; the narration and the page cues stay. Its cause is how
      // the latest correction ended; with none asked for, it is the time when the step used its own up, else the tries.
      const failed: LossCause = faulty(direction) ? (correction ?? (attempt < tries ? 'slow' : 'checks')) : 'checks';
      const settled = degradeDirection(direction);
      const filled = withReadyView(settled.direction, now.targets, now.visual);
      if (filled) await input.onEvent?.('board.table', { beat: beat.id, kind: now.visual!.visual });
      const ready = filled ?? settled.direction;
      if (ready.board)
        ready.board = await inspectVisual(
          ready.board,
          ready.say,
          beatBrief(beat, doc, now.targets, now.visual),
          seen,
          beat,
        );
      // What was given up for the time went for that; what failed its checks after the corrections, for that.
      const dropped = [...new Set<DroppedPart>([...(lean?.dropped ?? []), ...(settled.degraded?.dropped ?? [])])];
      const degraded: Degraded | undefined =
        lean || settled.degraded
          ? {
              dropped,
              problems: [
                ...(lean?.problems ?? []),
                ...(settled.degraded?.problems ?? []),
                ...(settled.degraded ? lateNote(correction, failed) : []),
              ].slice(0, 8),
              // A worked example the plan never asked for (a false alarm of the example check) is no loss to tell of.
              causes: Object.fromEntries(
                dropped
                  .filter((part) => part !== 'example' || exampleRules(beat, chosen).required)
                  .map((part) => [part, lean?.causes?.[part] ?? failed]),
              ),
            }
          : undefined;
      return {
        targets: now.targets,
        direction: ready,
        ...(degraded ? { degraded } : {}),
      };
    };
    // The tour as one step list per beat: a beat's own steps, or none for an omitted detail or a step that only read the
    // source aloud. Built once per beat, since a finished beat never changes.
    const beatSteps = new Map<number, Step[]>();
    // The quick check that closes a beat's chapter (check.ts): written with the beat, and its steps follow the beat's own.
    const quick = new Map<number, Step[]>();
    const quickChecks: { id: string; chapter: string; kind: string; hints: number }[] = [];
    const siteAt = new Map(sites.map((site) => [site.beats.at(-1)!, site]));
    const ownSteps = (i: number, result: BeatResult): Step[] => {
      if ('steps' in result) return result.steps;
      if (beats[i].detail && !result.direction) return [];
      const step = beatStep(beats[i], result.targets, result.direction, doc);
      return readsSource(step.say, doc) ? [] : [step];
    };
    const stepsOf = (i: number): Step[] => {
      const known = beatSteps.get(i);
      if (known) return known;
      const out = [...ownSteps(i, results[i]), ...(quick.get(i) ?? [])];
      beatSteps.set(i, out);
      return out;
    };
    /** The tour of the first `count` beats, assembled like the final one; the final one closes its frame, a part does not. */
    const buildTour = (count: number) => {
      const lists = beats.slice(0, count).map((_, i) => stepsOf(i));
      // A board that repeats an earlier step's data is dropped with its cues; the narration stays.
      const repeats = dropRepeatedBoards(
        lists,
        new Set(beats.slice(0, count).flatMap((beat, i) => (beat.unit ? [i] : []))),
      );
      const whole = count === beats.length;
      const tour = assembleTour(
        card!,
        whole ? plan : { ...plan, beats: beats.slice(0, count) },
        plan.frame ? frameSteps(repeats.steps, plan.frame, whole) : repeats.steps,
        doc,
        input.documentId,
        language,
        this.preset,
      );
      return { tour, repeats, lists };
    };
    const check = (candidate: Tour) => [
      ...tourProblems(candidate, doc),
      ...boardProblems(candidate),
      ...candidate.chapters.flatMap((chapter) =>
        chapter.steps.flatMap((step) => narrationProblems(step.say).map((problem) => `${step.id}: ${problem}`)),
      ),
    ];
    /**
     * The last rung of the ladder: a board that passed its own checks but not the tour's goes, with its cues, from the
     * steps the problems name. The tour only fails when its other contents do.
     */
    const settle = (candidate: Tour) => {
      let tour = candidate;
      let problems = check(tour);
      const late: { beat: string; dropped: ['board']; problems: string[]; causes: { board: 'checks' } }[] = [];
      const named = boardStepsOf(tour, problems);
      if (named.size) {
        const bare = settleBoards(withoutBoards(tour, new Set(named.keys())));
        if (!check(bare).length) {
          tour = bare;
          problems = [];
          for (const [beat, why] of named)
            late.push({ beat, dropped: ['board'], problems: why.slice(0, 8), causes: { board: 'checks' } });
        }
      }
      return { tour, problems, late };
    };

    // Progressive tours: each time the next steps in tour order are complete, the tour of exactly those leading steps is
    // announced (assembled and checked like the final one, so that it can be played while the rest is written).
    // Counting the quick checks still to come; a check the writer skips takes its two steps off again.
    let planned =
      beats.reduce((n, beat) => n + (beat.unit ? unitOverhead(beat.unit) + beat.unit.steps : 1), 0) +
      sites.length * CHECK_STEPS;
    let announced = 0;
    let announcing: Promise<void> = Promise.resolve();
    const announce = () => {
      announcing = announcing.then(async () => {
        let ready = 0;
        while (ready < beats.length && results[ready] !== undefined) ready++;
        if (ready <= announced || signal.aborted) return;
        announced = ready;
        try {
          const settled = settle(buildTour(ready).tour);
          const count = settled.tour.chapters.reduce((n, chapter) => n + chapter.steps.length, 0);
          if (count && !settled.problems.length)
            await input.onEvent?.('tour.partial', { tour: settled.tour, ready: count, planned });
        } catch {
          // A part that cannot be built is skipped; the final tour is written from the finished beats either way.
        }
      });
      return announcing;
    };

    // Detail calls receive their actual overview, not a parallel guess at what it might say: a detail waits for it, and
    // the steps are written in tour order so that the leading ones finish first. Calls share one worker pool.
    const finished = beats.map(() => {
      let done!: () => void;
      const promise = new Promise<void>((resolve) => (done = resolve));
      return { promise, done };
    });
    /**
     * The steps of the quick check that closes a chapter (check.ts), written from the chapter's finished steps, so the
     * beats before the last one are awaited first. A check is optional: nothing to ask about, an answer the model cannot
     * fix or a provider fault costs the check, never the tour.
     */
    const closeChapter = async (site: CheckSite, last: () => Step[]): Promise<Step[]> => {
      const skip = async (reason: string): Promise<Step[]> => {
        planned -= CHECK_STEPS;
        await input.onEvent?.('check.skipped', { chapter: site.chapter.id, reason });
        return [];
      };
      const before = site.beats.slice(0, -1);
      for (const i of before) await finished[i].promise;
      signal.throwIfAborted();
      if (before.some((i) => results[i] === undefined)) return skip('a step of the chapter failed');
      let chapter: Step[];
      try {
        chapter = [...before.flatMap(stepsOf), ...last()];
      } catch {
        return skip('a step of the chapter could not be built');
      }
      const material = checkMaterial(
        site.chapter.title,
        chapter,
        site.beats.map((i) => beats[i]),
        doc,
        plan.type === 'research_paper',
      );
      if (!material.ready) return skip('too little to ask about');
      const task: MuseMessage[] = [
        ...prefix,
        { role: 'user', content: [{ type: 'text', text: checkTask(language, checkBrief(material)) }] },
      ];
      const lastBeat = beats[site.beats.at(-1)!];
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const completion = await call(
            task,
            'quick_check',
            checkSchema(checkTargets(material)),
            6_000,
            'low',
            signal,
            { id: lastBeat.id, label: `Quick check: ${site.chapter.title}` },
          );
          const checked = cleanCheck(completion.value, material, doc);
          if (checked.declined) return skip('nothing in the chapter to predict or recall');
          if (checked.check) {
            const { kind, hints, target } = checked.check;
            quickChecks.push({ id: `check-${site.n}`, chapter: site.chapter.id, kind, hints: hints.length });
            await input.onEvent?.('check.written', {
              chapter: site.chapter.id,
              check: `check-${site.n}`,
              kind,
              hints: hints.length,
              target,
            });
            return checkSteps(checked.check, site.n, chapter, doc);
          }
          await input.onEvent?.('validation.failed', {
            stage: 'check',
            chapter: site.chapter.id,
            problems: checked.problems,
            attempt: attempt + 1,
          });
          task.push(...repairTurn(completion.value, checked.problems));
        } catch (error) {
          signal.throwIfAborted();
          if (!recoverable(error)) throw error;
          // The model's own fault gets the one retry; a provider fault ends the attempts.
          if ((error as ProcessingError).transient) break;
        }
      }
      return skip('no usable check');
    };
    const write = async ({ beat, index }: { beat: Beat; index: number }) => {
      try {
        const overview = beat.detail
          ? beats.findIndex((b) => !b.detail && b.kind === beat.kind && b.target === beat.target)
          : -1;
        if (overview >= 0 && overview < index) {
          await finished[overview].promise;
          signal.throwIfAborted();
        }
        // A step waits for its planned visual before it starts, so that its time is the time of its own work. An exercise
        // part waits for it only once it is solved.
        const chosen = beat.unit ? undefined : await visualOf(beat);
        signal.throwIfAborted();
        const started = Date.now();
        await input.onEvent?.('beat.started', { beat: beat.id });
        try {
          const result = await direct(beat, chosen);
          // The check follows the chapter's last step, and the beat counts as done only with it, so that the
          // progressive tour never shows the chapter without it.
          const site = siteAt.get(index);
          if (site) {
            const steps = await closeChapter(site, () => ownSteps(index, result));
            if (steps.length) quick.set(index, steps);
          }
          results[index] = result;
          if ('degraded' in result && result.degraded)
            await input.onEvent?.('beat.degraded', { beat: beat.id, ...result.degraded });
          const outcome =
            'steps' in result
              ? result.solved
                ? 'directed'
                : 'fallback'
              : result.direction
                ? result.degraded
                  ? 'degraded'
                  : 'directed'
                : ownSteps(index, result).length
                  ? 'fallback'
                  : 'omitted';
          await input.onEvent?.('beat.completed', {
            beat: beat.id,
            outcome,
            ...(result.omission ? { code: result.omission.code } : {}),
            durationMs: Date.now() - started,
          });
          void announce();
        } catch (error) {
          await input.onEvent?.('beat.failed', {
            beat: beat.id,
            code: signal.aborted ? 'cancelled' : error instanceof ProcessingError ? error.code : 'generation_error',
            durationMs: Date.now() - started,
          });
          throw error;
        }
      } finally {
        finished[index].done();
      }
    };
    try {
      await pool(
        beats.map((beat, index) => ({ beat, index })),
        6,
        write,
        (error) => siblings.abort(error),
      );
    } finally {
      // No announcement outlives the generation, whether it succeeded or failed.
      await announcing;
    }
    await planning;

    // F. Assemble and validate in code. A contract's first and last steps say that the tour is no legal advice.
    await progress('validating', beats.length, beats.length);
    if (!beats.some((_, i) => stepsOf(i).length))
      throw new ProcessingError(
        'invalid_tour',
        'The writer only repeated the source after repair. Try generating again.',
      );
    const { tour: assembled, repeats } = buildTour(beats.length);
    // The tour's own checks name steps; what a step lost is the loss of its beat (an exercise part has several steps).
    const owner = new Map(beats.flatMap((beat, i) => stepsOf(i).map((step) => [step.id, beat.id] as const)));
    const beatOf = (step: string) => owner.get(step) ?? step;
    // A dropped board names its beat too when that is not its step.
    if (repeats.dropped.length)
      await input.onEvent?.('board.duplicate', {
        dropped: repeats.dropped.map((drop) => ({
          ...drop,
          ...(beatOf(drop.step) === drop.step ? {} : { beat: beatOf(drop.step) }),
        })),
      });
    const settled = settle(assembled);
    const { tour, problems } = settled;
    const late = settled.late.map((drop) => ({ ...drop, beat: beatOf(drop.beat) }));
    for (const drop of late) await input.onEvent?.('beat.degraded', drop);
    const directions = results.map((result) => ('direction' in result ? result.direction : null));
    if (problems.length) {
      await input.onEvent?.('validation.failed', { stage: 'assemble', problems });
      throw new ProcessingError('invalid_tour', 'The generated tour did not pass document validation.');
    }
    // What the plan had and the tour does not, with why (coverage.ts): the tour says so when it starts and ends.
    const outcomes: StepOutcome[] = beats.map((beat, i) => {
      const result = results[i];
      const gone = (id: string) => late.some((drop) => drop.beat === id);
      return {
        beat: beat.id,
        present: ownSteps(i, result).length > 0,
        fallback: 'solved' in result ? !result.solved : !result.direction,
        ...(result.omission ? { omission: result.omission } : {}),
        ...(result.degraded ? { degraded: result.degraded } : {}),
        ...(gone(beat.id) ? { late: true } : {}),
        ...(repeats.dropped.some((drop) => beatOf(drop.step) === beat.id) ? { repeated: true } : {}),
      };
    });
    const leftOut = leftOutOf(outcomes);
    const published: Tour = leftOut.length ? { ...tour, left_out: leftOut } : tour;
    await input.onEvent?.('tour.direction', tourDirection(published));
    return {
      tour: published,
      metadata: {
        provider: 'meta',
        engine: 'harness',
        model: this.model,
        language,
        promptVersion: HARNESS_VERSION,
        preset: this.preset,
        profile: input.profile ?? null,
        ...(teachingPlan ? { teachingPlan } : {}),
        docType: plan.type,
        cardSource,
        planSource,
        ...(claims ? { claims: claimsEvent(claims) } : {}),
        ...(deckPlan
          ? {
              deck: {
                story: deckPlan.story,
                steps: deckPlan.beats.map((step) => step.slides),
                skipped: deckPlan.skipped,
                uncovered,
              },
            }
          : {}),
        paperCard: card,
        // The steps that stand in for their own explanation, and the steps left out whole (a detail, or a step whose
        // fallback only read the document aloud), as the tour's record of what it left out (leftOut) has them.
        fallbackBeats: outcomes.filter((outcome) => outcome.present && outcome.fallback).map((outcome) => outcome.beat),
        // The steps left out whole, with the cause in a word (code) and in plain words (reason).
        omittedDetails: outcomes.flatMap(({ beat, present, omission }) => {
          if (present) return [];
          const { code, because } = omission ?? { code: 'invalid' as const, because: undefined };
          return [
            {
              beat,
              code,
              ...(because ? { because } : {}),
              reason: lossSentence({ step: beat, part: 'step', cause: code, ...(because ? { because } : {}) }),
            },
          ];
        }),
        // Everything the tour lacks of its plan, as the tour itself says it.
        leftOut,
        // The quick checks that close chapters (check.ts).
        ...(quickChecks.length ? { quickChecks: [...quickChecks].sort((a, b) => a.id.localeCompare(b.id)) } : {}),
        // What steps lost so that the tour could play: their board, worked example or pen marks, and why.
        degraded: [
          ...beats.flatMap((beat, i) => {
            const result = results[i];
            return 'degraded' in result && result.degraded ? [{ beat: beat.id, ...result.degraded }] : [];
          }),
          ...late,
        ],
        visualPlan: visuals
          ? { source: 'model', beats: visualPlanEvent(visuals, plannable), ...(adjusted.length ? { adjusted } : {}) }
          : { source: 'fallback' },
        boards: {
          shown: beats.flatMap((beat, i) => {
            const result = results[i];
            // A part's method visual shows on its method step.
            if ('steps' in result)
              return result.visual && !late.some((drop) => drop.beat === beat.id)
                ? [`${beat.id}:visual:${result.visual}`]
                : [];
            const direction = result.direction;
            return late.some((drop) => drop.beat === beat.id)
              ? []
              : direction?.example
                ? direction.example.frames.map((frame, n) => `${beat.id}:frame-${n + 1}:${frame.item.kind}`)
                : direction?.board && !repeats.dropped.some((drop) => beatOf(drop.step) === beat.id)
                  ? [`${beat.id}:${direction.board.kind}`]
                  : [];
          }),
          dropped: [
            ...directions.flatMap((direction, i) =>
              direction?.boardProblems?.length ? [{ beat: beats[i].id, problems: direction.boardProblems }] : [],
            ),
            ...repeats.dropped.map((drop) => ({
              beat: beatOf(drop.step),
              problems: [`${drop.kind}: it repeats the board of step ${drop.repeats}`],
            })),
            ...late.map(({ beat, problems }) => ({ beat, problems })),
          ],
        },
        ...(plan.type === 'exercise_sheet'
          ? {
              exercises: beats.flatMap((beat, i) => {
                const result = results[i];
                if (!beat.unit || !('checks' in result)) return [];
                const count = (status: string) => result.checks.filter((c) => c.status === status).length;
                return [
                  {
                    id: beat.unit.id,
                    solved: result.solved,
                    ok: count('ok'),
                    failed: count('failed'),
                    unknown: count('unknown'),
                    ...(result.visual ? { visual: result.visual } : {}),
                  },
                ];
              }),
            }
          : {}),
        estimatedSeconds: tourSeconds(tour),
        sourceSha256: doc.source.sha256,
        analysisId: input.analysisId,
        imagesReviewed: { count: keyImages.length, sources: keyImages.map(imageEvidence) },
        usage: completions.reduce(
          (total, item) => ({
            promptTokens: total.promptTokens + item.usage.promptTokens,
            completionTokens: total.completionTokens + item.usage.completionTokens,
            totalTokens: total.totalTokens + item.usage.totalTokens,
            cachedInputTokens: total.cachedInputTokens + (item.usage.cachedInputTokens ?? 0),
          }),
          { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedInputTokens: 0 },
        ),
        modelCalls: completions.length,
        requestIds: completions.map((item) => item.requestId).filter(Boolean),
      },
    };
  }
}
