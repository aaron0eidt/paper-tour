import type { Doc, Step } from '../../../shared/paper';
import type { MuseConfig } from '../config';
import { ProcessingError } from '../errors';
import type { GeneratedTour, TourGenerationInput, TourGenerator, TourImage, TourProgress } from '../tour-generator';
import { MuseClient, type MuseMessage } from '../muse/client';
import { checkImages, imageEvidence } from '../muse/context';
import { OFFICIAL_MODELS } from '../muse/pricing';
import { arcSchema, arcTask, arcTourPlan, cleanArcPlan, fallbackArcPlan, type ArcPlan, type ArcType } from './arcs';
import { assembleTour, beatStep, boardProblems, frameSteps, tourProblems, tourSeconds } from './assemble';
import { paperPlan, type Beat, type Preset, type TourPlan } from './beats';
import { imageParts, pool, recordedCalls } from './calls';
import { cardProblems, cardSchema, cleanCard, evidencePool, fallbackCard, repairTurn, type PaperCard } from './card';
import {
  beatBrief,
  beatTargets,
  boardRepair,
  cleanDirection,
  directOptions,
  directionSchema,
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
  unitSteps,
  type Solution,
} from './exercise';
import { paperBlock } from './paper-block';
import { HARNESS_VERSION, SHARED_RULES, cardTask, directTask } from './prompts';
import { pythonVerifier, type LineCheck, type MathVerifier } from './verify';

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

/** What stage C gives back for a beat: a directed step, or an exercise part's steps. */
type BeatResult =
  | { targets: BeatTargets; direction: Direction | null }
  | { steps: Step[]; solved: boolean; checks: LineCheck[] };

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
      : new HarnessTourGenerator({ ...this.config, model }, this.preset, this.transport, this.verifier);
  }
  async generate(
    input: TourGenerationInput,
    onProgress?: (progress: TourProgress) => Promise<void>,
    externalSignal?: AbortSignal,
  ): Promise<GeneratedTour> {
    if (!this.configured)
      throw new ProcessingError('muse_not_configured', 'Tour creation needs a Muse API key on the server.');
    const signal = AbortSignal.any([
      AbortSignal.timeout(this.config.timeoutMs),
      ...(externalSignal ? [externalSignal] : []),
    ]);
    checkImages(input);
    const { doc } = input;
    const language = this.config.language;
    const { call, completions } = recordedCalls(this.client, input, this.model);
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

    // B. Plan the beats for the kind of document: a paper's argument or a sheet's parts in code, the arc of the other
    // kinds with one call, all sized by the preset. A sheet without tasks found by ingestion is toured as "other".
    const type = card!.doc_type;
    let plan: TourPlan;
    let planSource = 'code';
    if (type === 'exercise_sheet' && doc.exercises?.length) plan = exercisePlan(card!, doc, this.preset);
    else if (type === 'research_paper') plan = paperPlan(card!, doc, this.preset);
    else {
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
    await input.onEvent?.('plan.ready', {
      preset: this.preset,
      docType: plan.type,
      cardSource,
      planSource,
      beats: beats.map(({ id, kind, arc, target }) => ({ id, kind, arc, ...(target ? { target } : {}) })),
    });

    // C. Direct each beat in parallel: narration plus cues limited to the beat's own targets; an exercise part is
    // solved, checked and taught as several steps.
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
          const completion = await call(task, 'exercise_solution', solveSchema(unit), 24_000, 'high', signal);
          const { solution, problems } = cleanSolution(completion.value, unit);
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
      await progress('writing', ++directed, beats.length);
      if (!best) {
        await input.onEvent?.('beat.fallback', { beat: beat.id });
        return { steps: unitFallback(unit, doc), solved: false, checks: [] };
      }
      return { steps: unitSteps(unit, best.solution, best.checks, language), solved: true, checks: best.checks };
    };
    const results = await pool(beats, 6, async (beat): Promise<BeatResult> => {
      if (beat.unit) return teach(beat);
      const targets = beatTargets(beat, doc);
      const beatSchema = directionSchema(beat, targets);
      const image = beatImage(beat, doc, input.images);
      const options = directOptions(beat, plan.type);
      const text = directTask(language, beatBrief(beat, doc, targets), options);
      const task: MuseMessage[] = [
        ...prefix,
        { role: 'user', content: [{ type: 'text', text }, ...imageParts(image ? [image] : [])] },
      ];
      let direction: Direction | null = null;
      // One repair at most: for an unusable answer, or for a board that failed its checks (the step keeps its first
      // usable direction either way, without the board if the repair does not fix it).
      for (let attempt = 0; attempt < 2 && !(direction && !direction.boardProblems?.length); attempt++) {
        try {
          const completion = await call(task, 'beat_direction', beatSchema, 6_000, 'low', signal);
          const next = cleanDirection(completion.value, beat, targets);
          if (next && (!direction || !next.boardProblems?.length)) direction = next;
          if (next?.boardProblems?.length) {
            await input.onEvent?.('board.rejected', {
              beat: beat.id,
              problems: next.boardProblems,
              attempt: attempt + 1,
            });
            task.push(...boardRepair(completion.value, beat.board!, next.boardProblems));
          } else if (!next)
            task.push(
              ...repairTurn(completion.value, [
                `say must be 25-${options.words} spoken words.`,
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
      if (!direction) await input.onEvent?.('beat.fallback', { beat: beat.id });
      return { targets, direction };
    });

    // F. Assemble and validate in code. A contract's first and last steps say that the tour is no legal advice.
    await progress('validating', beats.length, beats.length);
    const used = new Set<string>();
    const steps = beats.map((beat, i) => {
      const result = results[i];
      return 'steps' in result ? result.steps : [beatStep(beat, result.targets, result.direction, doc, used)];
    });
    const tour = assembleTour(
      card!,
      plan,
      plan.frame ? frameSteps(steps, plan.frame) : steps,
      doc,
      input.documentId,
      language,
      this.preset,
    );
    const directions = results.map((result) => ('direction' in result ? result.direction : null));
    const problems = [...tourProblems(tour, doc), ...boardProblems(tour)];
    if (problems.length) {
      await input.onEvent?.('validation.failed', { stage: 'assemble', problems });
      throw new ProcessingError('invalid_tour', 'The generated tour did not pass document validation.');
    }
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
        paperCard: card,
        fallbackBeats: beats
          .filter((_, i) => {
            const result = results[i];
            return 'solved' in result ? !result.solved : !result.direction;
          })
          .map((beat) => beat.id),
        boards: {
          shown: directions.flatMap((direction, i) =>
            direction?.board ? [`${beats[i].id}:${direction.board.kind}`] : [],
          ),
          dropped: directions.flatMap((direction, i) =>
            direction?.boardProblems?.length ? [{ beat: beats[i].id, problems: direction.boardProblems }] : [],
          ),
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
