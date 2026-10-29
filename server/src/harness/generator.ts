import { claimsNumericExample } from './example';
import { splitWords, type Doc, type Step, type Tour } from '../../../shared/paper';
import { tourDirection } from '../../../shared/tourDirection';
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
  type Claim,
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
import { deckLike, type DocType } from './doctype';
import { moveProblems } from './moves';
import { imageParts, pool } from './calls';
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
import { boardStepsOf, degradeDirection, withoutBoards, type Degraded } from './degrade';
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
import { HARNESS_VERSION, SHARED_RULES, cardTask, directTask } from './prompts';
import { measuredFigureTargets } from './measured-visuals';
import { pythonVerifier, type LineCheck, type MathVerifier } from './verify';
import {
  allocateFrames,
  cleanVisualPlan,
  plannableBeats,
  visualPlanBrief,
  visualPlanEvent,
  visualPlanSchema,
  visualPlanTask,
  withTableBoard,
  type PlanAdjustment,
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
  | { targets: BeatTargets; direction: Direction | null; degraded?: Degraded }
  | { steps: Step[]; solved: boolean; checks: LineCheck[]; visual?: BoardKind; degraded?: Degraded };

const MODEL_FAULTS = new Set(['muse_invalid_response', 'muse_output_truncated', 'muse_refused']);
/** A beat survives the model's own faults and transient provider errors; credentials and rejected requests do not. */
const recoverable = (error: unknown) =>
  error instanceof ProcessingError && (MODEL_FAULTS.has(error.code) || error.transient);
const pause = (ms: number) => new Promise((done) => setTimeout(done, ms));

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
        );
  }
  async generate(
    input: TourGenerationInput,
    onProgress?: (progress: TourProgress) => Promise<void>,
    externalSignal?: AbortSignal,
  ): Promise<GeneratedTour> {
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
    const { call, completions } = recordedCalls(this.client, input, this.model, HARNESS_VERSION);
    const progress = (stage: TourProgress['stage'], done: number, total: number) =>
      onProgress?.({ stage, imagesDone: done, imagesTotal: total });
    const prefix: MuseMessage[] = [
      { role: 'developer', content: SHARED_RULES },
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
    let card: PaperCard | null = null;
    for (let attempt = 0; attempt < 2 && !card; attempt++) {
      try {
        const completion = await call(messages, 'paper_card', schema, 12_000, 'medium', signal);
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
      const context = claimContext(doc);
      if (context) {
        const task: MuseMessage[] = [
          ...prefix,
          { role: 'user', content: [{ type: 'text', text: claimsTask(language, context, this.preset) }] },
        ];
        const sentenceIds = claimSentenceIds(doc, context);
        for (let attempt = 0; attempt < 2 && !claims; attempt++) {
          try {
            const completion = await call(
              task,
              'claims',
              claimsSchema(doc, sentenceIds, this.preset),
              10_000,
              'medium',
              signal,
            );
            const checked = cleanClaims(completion.value, doc, context, this.preset);
            claims = checked.claims;
            if (!claims) {
              await input.onEvent?.('validation.failed', {
                stage: 'claims',
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
      }
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
    let visuals: VisualPlan | null = null;
    let adjusted: PlanAdjustment[] = [];
    const sheetTour = beats.some((beat) => beat.unit);
    const plannable = plannableBeats(beats);
    if (plannable.length) {
      const options = { sheet: sheetTour };
      const task: MuseMessage[] = [
        ...prefix,
        {
          role: 'user',
          content: [
            { type: 'text', text: `${visualPlanTask(language, options)}\n\n${visualPlanBrief(card!, plannable, doc)}` },
          ],
        },
      ];
      for (let attempt = 0; attempt < 2 && !visuals; attempt++) {
        try {
          const completion = await call(
            task,
            'visual_plan',
            visualPlanSchema(plannable, options),
            8_000,
            'medium',
            signal,
          );
          const checked = cleanVisualPlan(completion.value, plannable, options);
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
        const withData = withTableBoard(visuals, plannable, doc);
        visuals = withData.plan;
        adjusted = [...adjusted, ...withData.adjusted];
        // A sheet's overview and takeaway have no visual of their own.
        for (const beat of beats)
          if (!visuals.has(beat.id)) visuals.set(beat.id, { visual: 'none', idea: '', data: '' });
        visuals = allocateFrames(visuals, beats);
      }
      await input.onEvent?.('visual.plan', {
        source: visuals ? 'model' : 'fallback',
        beats: visuals
          ? visualPlanEvent(visuals, plannable)
          : plannable.map(({ id, board }) => ({ beat: id, ...(board ? { suggested: board } : {}) })),
        ...(adjusted.length ? { adjusted } : {}),
      });
    }

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
      // One repair at most, for an unusable answer or for lines that cannot be shown or do not check out; the part
      // keeps its best answer, and a line still in doubt is marked on the board.
      for (let attempt = 0; attempt < 2 && !(best && !best.problems.length); attempt++) {
        try {
          const completion = await call(task, 'exercise_solution', solveSchema(unit), 24_000, 'high', signal, {
            id: beat.id,
            label: beat.point,
          });
          const { solution, problems } = cleanSolution(completion.value, unit, doc);
          if (!solution) {
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
          if ((error as ProcessingError).transient) await pause(1500 * (attempt + 1));
        }
      }
      if (!best) {
        await progress('writing', ++directed, beats.length);
        await input.onEvent?.('beat.fallback', { beat: beat.id });
        return { steps: unitFallback(unit, doc), solved: false, checks: [] };
      }
      // The method visual the plan gave this task, drawn once the part is solved so that it fits the solution; one
      // repair, and a visual that still fails is dropped, flagged, with the solution lines as they were.
      const planned = visuals?.get(beat.id);
      const hosted = hasVisualHost(unit, best.solution);
      let drawn: UnitVisual | null = null;
      let lost = hosted ? [] : ['the part has no method step to show it'];
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
            if (!drawn) ask.push(...repairTurn(completion.value, checked.problems));
          } catch (error) {
            signal.throwIfAborted();
            if (!recoverable(error)) throw error;
            if ((error as ProcessingError).transient) await pause(1500 * (attempt + 1));
          }
        }
      }
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
                problems: lost.length ? lost.slice(0, 8) : ['the model gave no usable board'],
              },
            }
          : {}),
      };
    };
    const results: BeatResult[] = new Array(beats.length);
    const direct = async (beat: Beat): Promise<BeatResult> => {
      if (beat.unit) return teach(beat);
      const visual = visuals?.get(beat.id);
      const targets = beatTargets(beat, doc, visual);
      const image = beatImage(beat, doc, input.images);
      if (image && image.kind !== 'page') targets.imaged = image.targetId;
      // A step on slides sees the page of each (up to three), so that code, plots and tables on them are explained.
      const pages = (beat.slides ?? [])
        .slice(0, 3)
        .flatMap((n) => input.images.find((i) => i.kind === 'page' && i.targetId === `page${n}`) ?? [])
        .filter((page) => page !== image);
      const seen = [...(image ? [image] : []), ...pages];
      if (image?.kind === 'figure') {
        const started = Date.now();
        targets.measured = await this.measureFigure(image, signal);
        await input.onEvent?.('visual.targets', {
          source: image.targetId,
          count: targets.measured.length,
          durationMs: Date.now() - started,
        });
      }
      const beatSchema = directionSchema(beat, targets, true, visual);
      const options = directOptions(beat, plan.type, targets, visual);
      const overviewIndex = beat.detail
        ? beats.findIndex((b) => !b.detail && b.kind === beat.kind && b.target === beat.target)
        : -1;
      const overviewResult = results[overviewIndex];
      const overview = overviewResult && 'direction' in overviewResult ? overviewResult.direction?.say : undefined;
      const beatIndex = beats.indexOf(beat);
      const outline = beats.map((b, i) => `${i + 1}. ${b.point}`).join('\n');
      const brief =
        `SOURCE OUTLINE (you write step ${beatIndex + 1}; build on the steps before it and never repeat what they say):\n${outline}\n` +
        beatBrief(beat, doc, targets, visual) +
        (overview ? `\nPRECEDING OVERVIEW (already heard; do not repeat):\n${overview}` : '');
      const text = directTask(language, brief, options);
      const task: MuseMessage[] = [...prefix, { role: 'user', content: [{ type: 'text', text }, ...imageParts(seen)] }];
      let direction: Direction | null = null;
      const example = exampleRules(beat, visual);
      let requireExample = example.required;
      // A step that mostly restates its highlighted sentences, or runs past its cap, is sent back once; until then its
      // direction is kept. A rewrite that was only to shorten it and is not shorter does not replace it.
      let rewrites = 0;
      let rewriting = false;
      let shortenedFrom: number | null = null;
      // The model can correct its complete direction twice, with all validation faults in each reply. What still fails
      // afterwards is dropped and flagged (degradeDirection), never published and never a reason to fail the tour.
      for (
        let attempt = 0;
        attempt < 3 &&
        !(
          direction &&
          !rewriting &&
          !direction.boardProblems?.length &&
          !direction.visualProblems?.length &&
          !direction.exampleProblems?.length
        );
        attempt++
      ) {
        try {
          // Reasoning shares the provider's output budget. Complex scenes exhausted
          // 6k tokens in reasoning alone and returned incomplete JSON on every retry.
          const detailed = beat.detail || attempt > 0;
          const completion = await call(
            task,
            'beat_direction',
            beatSchema,
            detailed ? 12_000 : 6_000,
            detailed ? 'medium' : 'low',
            signal,
            { id: beat.id, label: beat.point },
          );
          const rawSay = (completion.value as { say?: unknown } | null)?.say;
          requireExample ||=
            example.offered &&
            ((completion.value as { example?: unknown } | null)?.example !== undefined ||
              (typeof rawSay === 'string' && claimsNumericExample(rawSay)));
          const corruption = typeof rawSay === 'string' ? narrationProblems(rawSay) : [];
          const cleaned = corruption.length
            ? null
            : cleanDirection(completion.value, beat, targets, requireExample, visual);
          if (corruption.length) {
            await input.onEvent?.('validation.failed', {
              stage: 'narration',
              beat: beat.id,
              problems: corruption,
              attempt: attempt + 1,
            });
            task.push(...repairTurn(completion.value, corruption));
          }
          const copied = cleaned && readsSource(cleaned.say, doc);
          const repeated = cleaned && overview && repeatsExplanation(cleaned.say, overview);
          const next = copied || repeated ? null : cleaned;
          if (repeated) {
            await input.onEvent?.('beat.duplicate', { beat: beat.id, attempt: attempt + 1 });
            task.push(
              ...repairTurn(completion.value, [
                'This repeats the preceding overview. Teach a new worked example, cause-and-effect mechanism or comparison instead; do not rephrase the same symbol definitions.',
              ]),
            );
          }
          if (copied)
            task.push(
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
            task.push(...repairTurn(completion.value, issues));
            continue;
          }
          if (next && !rewrites && attempt < 2) {
            // A step on slides is held against the slides' whole text, which the learner can read; any other against
            // the sentences it highlights.
            const highlighted = beat.slides
              ? slideText(beat, doc)
              : highlightedSentences(next, beat, targets).flatMap((id) => sentenceText.get(id) ?? []);
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
              task.push(...repairTurn(completion.value, repairs));
            }
          }
          if (!next)
            task.push(
              ...repairTurn(completion.value, [
                `say must be 8-${sayLimit(beat)} spoken words.`,
                'Every cue needs an allowed action, a listed target and an anchor copied from say.',
              ]),
            );
        } catch (error) {
          signal.throwIfAborted();
          if (!recoverable(error)) throw error;
          if ((error as ProcessingError).transient) await pause(1500 * (attempt + 1));
        }
      }
      await progress('writing', ++directed, beats.length);
      if (!direction) {
        await input.onEvent?.(beat.detail ? 'beat.omitted' : 'beat.fallback', { beat: beat.id });
        return { targets, direction };
      }
      // A board, example or pen mark that still fails is dropped; the narration and the page cues stay.
      const settled = degradeDirection(direction);
      const filled = withReadyView(settled.direction, targets, visual);
      if (filled) await input.onEvent?.('board.table', { beat: beat.id, kind: visual!.visual });
      return {
        targets,
        direction: filled ?? settled.direction,
        ...(settled.degraded ? { degraded: settled.degraded } : {}),
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
      const late: { beat: string; dropped: ['board']; problems: string[] }[] = [];
      const named = boardStepsOf(tour, problems);
      if (named.size) {
        const bare = settleBoards(withoutBoards(tour, new Set(named.keys())));
        if (!check(bare).length) {
          tour = bare;
          problems = [];
          for (const [beat, why] of named) late.push({ beat, dropped: ['board'], problems: why.slice(0, 8) });
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
        const started = Date.now();
        await input.onEvent?.('beat.started', { beat: beat.id });
        try {
          const result = await direct(beat);
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
                : beat.detail
                  ? 'omitted'
                  : 'fallback';
          await input.onEvent?.('beat.completed', { beat: beat.id, outcome, durationMs: Date.now() - started });
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

    // F. Assemble and validate in code. A contract's first and last steps say that the tour is no legal advice.
    await progress('validating', beats.length, beats.length);
    if (!beats.some((_, i) => stepsOf(i).length))
      throw new ProcessingError(
        'invalid_tour',
        'The writer only repeated the source after repair. Try generating again.',
      );
    const { tour: assembled, repeats } = buildTour(beats.length);
    if (repeats.dropped.length) await input.onEvent?.('board.duplicate', { dropped: repeats.dropped });
    const { tour, problems, late } = settle(assembled);
    for (const drop of late) await input.onEvent?.('beat.degraded', drop);
    const directions = results.map((result) => ('direction' in result ? result.direction : null));
    if (problems.length) {
      await input.onEvent?.('validation.failed', { stage: 'assemble', problems });
      throw new ProcessingError('invalid_tour', 'The generated tour did not pass document validation.');
    }
    await input.onEvent?.('tour.direction', tourDirection(tour));
    return {
      tour,
      metadata: {
        provider: 'meta',
        engine: 'harness',
        model: this.model,
        language,
        promptVersion: HARNESS_VERSION,
        preset: this.preset,
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
        fallbackBeats: beats
          .filter((_, i) => {
            const result = results[i];
            return 'solved' in result ? !result.solved : !beats[i].detail && !result.direction;
          })
          .map((beat) => beat.id),
        omittedDetails: beats
          .filter(
            (beat, i) =>
              beat.detail && 'direction' in results[i] && !(results[i] as { direction: Direction | null }).direction,
          )
          .map((beat) => beat.id),
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
            if ('steps' in result) return result.visual ? [`${beat.id}:visual:${result.visual}`] : [];
            const direction = result.direction;
            return late.some((drop) => drop.beat === beat.id)
              ? []
              : direction?.example
                ? direction.example.frames.map((frame, n) => `${beat.id}:frame-${n + 1}:${frame.item.kind}`)
                : direction?.board && !repeats.dropped.some((drop) => drop.step === beat.id)
                  ? [`${beat.id}:${direction.board.kind}`]
                  : [];
          }),
          dropped: [
            ...directions.flatMap((direction, i) =>
              direction?.boardProblems?.length ? [{ beat: beats[i].id, problems: direction.boardProblems }] : [],
            ),
            ...repeats.dropped.map((drop) => ({
              beat: drop.step,
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
