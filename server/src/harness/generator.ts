import { claimsNumericExample } from './example';
import type { Doc, Step } from '../../../shared/paper';
import { tourDirection } from '../../../shared/tourDirection';
import type { MuseConfig } from '../config';
import { ProcessingError } from '../errors';
import type { GeneratedTour, TourGenerationInput, TourGenerator, TourImage, TourProgress } from '../tour-generator';
import { MuseClient, type MuseMessage } from '../muse/client';
import { checkImages, imageEvidence } from '../muse/context';
import { OFFICIAL_MODELS } from '../muse/pricing';
import { arcSchema, arcTask, arcTourPlan, cleanArcPlan, fallbackArcPlan, type ArcPlan, type ArcType } from './arcs';
import { assembleTour, beatStep, boardProblems, frameSteps, tourProblems, tourSeconds } from './assemble';
import { paperPlan, type Beat, type Preset, type TourPlan } from './beats';
import { imageParts, pool } from './calls';
import { recordedCalls } from '../ai/recorded-calls';
import { cardProblems, cardSchema, cleanCard, evidencePool, fallbackCard, repairTurn, type PaperCard } from './card';
import {
  beatBrief,
  beatTargets,
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
import { narrationProblems, readsSource, repeatsExplanation } from './insight';
import { documentLanguage } from './language';
import { HARNESS_VERSION, SHARED_RULES, cardTask, directTask } from './prompts';
import { measuredFigureTargets } from './measured-visuals';
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
      beats: beats.map(({ id, kind, arc, target, point, detail }) => ({
        id,
        kind,
        arc,
        label: point,
        detail: !!detail,
        ...(target ? { target } : {}),
      })),
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
          const completion = await call(task, 'exercise_solution', solveSchema(unit), 24_000, 'high', signal, {
            id: beat.id,
            label: beat.point,
          });
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
    const results: BeatResult[] = new Array(beats.length);
    const direct = async (beat: Beat): Promise<BeatResult> => {
      if (beat.unit) return teach(beat);
      const targets = beatTargets(beat, doc);
      const image = beatImage(beat, doc, input.images);
      if (image && image.kind !== 'page') targets.imaged = image.targetId;
      if (image?.kind === 'figure') {
        const started = Date.now();
        targets.measured = await this.measureFigure(image, signal);
        await input.onEvent?.('visual.targets', {
          source: image.targetId,
          count: targets.measured.length,
          durationMs: Date.now() - started,
        });
      }
      const beatSchema = directionSchema(beat, targets);
      const options = directOptions(beat, plan.type, targets);
      const overviewIndex = beat.detail
        ? beats.findIndex((b) => !b.detail && b.kind === beat.kind && b.target === beat.target)
        : -1;
      const overviewResult = results[overviewIndex];
      const overview = overviewResult && 'direction' in overviewResult ? overviewResult.direction?.say : undefined;
      const beatIndex = beats.indexOf(beat);
      const outline = beats.map((b, i) => `${i + 1}. ${b.point}`).join('\n');
      const brief =
        `SOURCE OUTLINE (you write step ${beatIndex + 1}; follow the document structure, do not repeat other steps):\n${outline}\n` +
        beatBrief(beat, doc, targets) +
        (overview ? `\nPRECEDING OVERVIEW (already heard; do not repeat):\n${overview}` : '');
      const text = directTask(language, brief, options);
      const task: MuseMessage[] = [
        ...prefix,
        { role: 'user', content: [{ type: 'text', text }, ...imageParts(image ? [image] : [])] },
      ];
      let direction: Direction | null = null;
      let requireExample = beat.kind === 'formula' && !!beat.detail;
      // The model can correct its complete direction twice, with all validation
      // faults in each reply. Required visuals are never silently discarded.
      for (
        let attempt = 0;
        attempt < 3 &&
        !(
          direction &&
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
            (completion.value as { example?: unknown } | null)?.example !== undefined ||
            (typeof rawSay === 'string' && claimsNumericExample(rawSay));
          const corruption = typeof rawSay === 'string' ? narrationProblems(rawSay) : [];
          const cleaned = corruption.length ? null : cleanDirection(completion.value, beat, targets, requireExample);
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
          if (next) direction = next;
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
          if (!next)
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
      if (!direction && requireExample)
        throw new ProcessingError(
          'worked_example_failed',
          'The worked example could not be authored after two corrections; no incomplete example was published.',
        );
      if (direction?.boardProblems?.some((problem) => problem.startsWith('scene:')))
        throw new ProcessingError('scene_invalid', direction.boardProblems.join(' '));
      if (direction?.exampleProblems?.length)
        throw new ProcessingError('worked_example_failed', direction.exampleProblems.join(' '));
      if (direction?.visualProblems?.length)
        throw new ProcessingError('visual_grounding_failed', direction.visualProblems.join(' '));
      await progress('writing', ++directed, beats.length);
      if (!direction) await input.onEvent?.(beat.detail ? 'beat.omitted' : 'beat.fallback', { beat: beat.id });
      return { targets, direction };
    };
    // Detail calls receive their actual overview, not a parallel guess at what it
    // might say. Independent calls in each stage still share the same worker pool.
    const write = async ({ beat, index }: { beat: Beat; index: number }) => {
      const started = Date.now();
      await input.onEvent?.('beat.started', { beat: beat.id });
      try {
        const result = await direct(beat);
        results[index] = result;
        const outcome =
          'steps' in result
            ? result.solved
              ? 'directed'
              : 'fallback'
            : result.direction
              ? 'directed'
              : beat.detail
                ? 'omitted'
                : 'fallback';
        await input.onEvent?.('beat.completed', { beat: beat.id, outcome, durationMs: Date.now() - started });
      } catch (error) {
        await input.onEvent?.('beat.failed', {
          beat: beat.id,
          code: signal.aborted ? 'cancelled' : error instanceof ProcessingError ? error.code : 'generation_error',
          durationMs: Date.now() - started,
        });
        throw error;
      }
    };
    const indexed = beats.map((beat, index) => ({ beat, index }));
    await pool(
      indexed.filter(({ beat }) => !beat.detail),
      6,
      write,
      (error) => siblings.abort(error),
    );
    await pool(
      indexed.filter(({ beat }) => beat.detail),
      6,
      write,
      (error) => siblings.abort(error),
    );

    // F. Assemble and validate in code. A contract's first and last steps say that the tour is no legal advice.
    await progress('validating', beats.length, beats.length);
    const used = new Set<string>();
    const steps = beats.map((beat, i) => {
      const result = results[i];
      if ('steps' in result) return result.steps;
      if (beat.detail && !result.direction) return [];
      const previous = new Set(used);
      const step = beatStep(beat, result.targets, result.direction, doc, used);
      if (!readsSource(step.say, doc)) return [step];
      used.clear();
      for (const id of previous) used.add(id);
      return [];
    });
    if (!steps.some((part) => part.length))
      throw new ProcessingError(
        'invalid_tour',
        'The writer only repeated the source after repair. Try generating again.',
      );
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
    const problems = [
      ...tourProblems(tour, doc),
      ...boardProblems(tour),
      ...tour.chapters.flatMap((chapter) =>
        chapter.steps.flatMap((step) => narrationProblems(step.say).map((problem) => `${step.id}: ${problem}`)),
      ),
    ];
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
        boards: {
          shown: directions.flatMap((direction, i) =>
            direction?.example
              ? direction.example.frames.map((frame, n) => `${beats[i].id}:frame-${n + 1}:${frame.item.kind}`)
              : direction?.board
                ? [`${beats[i].id}:${direction.board.kind}`]
                : [],
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
