import type { MuseConfig } from '../config';
import { ProcessingError } from '../errors';
import type { GeneratedTour, TourGenerationInput, TourGenerator, TourImage, TourProgress } from '../tour-generator';
import { MuseClient, type MuseMessage } from '../muse/client';
import { checkImages, imageEvidence } from '../muse/context';
import { OFFICIAL_MODELS } from '../muse/pricing';
import { assembleTour, beatStep, tourProblems } from './assemble';
import { planBeats, type Preset } from './beats';
import { imageParts, pool, recordedCalls } from './calls';
import { cardProblems, cardSchema, cleanCard, evidencePool, fallbackCard, repairTurn, type PaperCard } from './card';
import { beatBrief, beatTargets, cleanDirection, directionSchema, type Direction } from './direct';
import { paperBlock } from './paper-block';
import { HARNESS_VERSION, SHARED_RULES, cardTask, directTask } from './prompts';

const MODEL_FAULTS = new Set(['muse_invalid_response', 'muse_output_truncated', 'muse_refused']);
/** A beat survives the model's own faults and transient provider errors; credentials and rejected requests do not. */
const recoverable = (error: unknown) =>
  error instanceof ProcessingError && (MODEL_FAULTS.has(error.code) || error.transient);

/**
 * Short tours of a document's main ideas (notes/HARNESS.md): understand the document once (stage A), plan beats in
 * code by preset (B), direct every beat in parallel with enum-constrained targets (C), assemble and validate in code (F).
 */
export class HarnessTourGenerator implements TourGenerator {
  readonly model: string;
  readonly configured: boolean;
  private readonly client: MuseClient;
  constructor(
    private readonly config: MuseConfig,
    private readonly preset: Preset = 'standard',
    private readonly transport?: typeof fetch,
  ) {
    this.model = config.model;
    this.configured = Boolean(config.apiKey.trim());
    this.client = new MuseClient(config, transport);
  }
  withModel(model: string): TourGenerator {
    if (!OFFICIAL_MODELS[model]?.tourCompatible)
      throw new ProcessingError('unsupported_model', 'Choose a model that supports paper text and images.');
    return model === this.model ? this : new HarnessTourGenerator({ ...this.config, model }, this.preset, this.transport);
  }
  async generate(
    input: TourGenerationInput,
    onProgress?: (progress: TourProgress) => Promise<void>,
    externalSignal?: AbortSignal,
  ): Promise<GeneratedTour> {
    if (!this.configured)
      throw new ProcessingError('muse_not_configured', 'Tour creation needs a Muse API key on the server.');
    const signal = AbortSignal.any([AbortSignal.timeout(this.config.timeoutMs), ...(externalSignal ? [externalSignal] : [])]);
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
        if (!(error instanceof ProcessingError && MODEL_FAULTS.has(error.code))) throw error;
      }
    }
    const usable = card && card.problem.evidence.length && card.key_idea.evidence.length && card.takeaway.evidence.length;
    const cardSource = usable ? 'model' : 'fallback';
    if (!usable) card = fallbackCard(doc);

    // B. Plan beats in code: the paper's argument, sized by the preset.
    const beats = planBeats(card!, doc, this.preset);
    if (!beats.length) throw new ProcessingError('invalid_tour', 'This document has no text a tour could explain.');
    await input.onEvent?.('plan.ready', {
      preset: this.preset,
      cardSource,
      beats: beats.map(({ id, kind, arc, target }) => ({ id, kind, arc, ...(target ? { target } : {}) })),
    });

    // C. Direct each beat in parallel: narration plus cues limited to the beat's own targets.
    let directed = 0;
    await progress('writing', 0, beats.length);
    const results = await pool(beats, 6, async (beat) => {
      const targets = beatTargets(beat, doc);
      const beatSchema = directionSchema(beat, targets);
      const image = input.images.find((i) => i.targetId === beat.target && i.kind !== 'page');
      const task: MuseMessage[] = [
        ...prefix,
        {
          role: 'user',
          content: [{ type: 'text', text: directTask(language, beatBrief(beat, doc, targets)) }, ...imageParts(image ? [image] : [])],
        },
      ];
      let direction: Direction | null = null;
      for (let attempt = 0; attempt < 2 && !direction; attempt++) {
        try {
          const completion = await call(task, 'beat_direction', beatSchema, 6_000, 'low', signal);
          direction = cleanDirection(completion.value, beat, targets);
          if (!direction)
            task.push(
              ...repairTurn(completion.value, [
                'say must be 25-45 spoken words; every cue needs an allowed action, a listed target and an anchor copied from say.',
              ]),
            );
        } catch (error) {
          signal.throwIfAborted();
          if (!recoverable(error)) throw error;
          if ((error as ProcessingError).transient) await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
        }
      }
      await progress('writing', ++directed, beats.length);
      if (!direction) await input.onEvent?.('beat.fallback', { beat: beat.id });
      return { targets, direction };
    });

    // F. Assemble and validate in code.
    await progress('validating', beats.length, beats.length);
    const used = new Set<string>();
    const steps = beats.map((beat, i) => beatStep(beat, results[i].targets, results[i].direction, doc, used));
    const tour = assembleTour(card!, beats, steps, doc, input.documentId, language, this.preset);
    const problems = tourProblems(tour, doc);
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
        cardSource,
        paperCard: card,
        fallbackBeats: beats.filter((_, i) => !results[i].direction).map((beat) => beat.id),
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
