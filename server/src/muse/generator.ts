import { createHash, randomUUID } from 'node:crypto';
import Ajv2020 from 'ajv/dist/2020.js';
import type { MuseConfig } from '../config';
import { ProcessingError } from '../errors';
import type { GeneratedTour, TourGenerationInput, TourGenerator, TourImage, TourProgress } from '../tour-generator';
import { MuseClient, type Completion, type MuseContent, type MuseMessage } from './client';
import { checkImages, imageEvidence, paperContext } from './context';
import { materializeTour, TOUR_DRAFT_SCHEMA, TourValidationError, type TourDraft, type DraftStep } from './schema';
import {
  coverageInstructions,
  INSPECTION_INSTRUCTIONS,
  INSPECTION_VERSION,
  PROMPT_VERSION,
  writingInstructions,
} from './prompts';
import { MAX_CONTENT_PAGES, MAX_TOUR_STEPS, walkthroughGoals } from './planning';
import { mergeCoverageSteps } from './coverage';
import { OFFICIAL_MODELS } from './pricing';

interface VisualObservation {
  targetId: string;
  description: string;
  readable: boolean;
  uncertainties: string[];
}

function visualSchema(images: TourImage[]) {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['observations'],
    properties: {
      observations: {
        type: 'array',
        minItems: images.length,
        maxItems: images.length,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['targetId', 'description', 'readable', 'uncertainties'],
          properties: {
            targetId: { type: 'string', enum: images.map((image) => image.targetId) },
            description: { type: 'string', minLength: 1, maxLength: 2200 },
            readable: { type: 'boolean' },
            uncertainties: { type: 'array', maxItems: 8, items: { type: 'string', maxLength: 400 } },
          },
        },
      },
    },
  };
}
function imageContent(images: TourImage[]): MuseContent[] {
  return images.flatMap((image): MuseContent[] => [
    { type: 'text', text: `Visual source ${image.targetId}; kind=${image.kind}; page=${image.page}. ${image.label}` },
    { type: 'image_url', image_url: { url: image.dataUrl } },
  ]);
}

/** Reuse only a complete, schema-valid inspection of these exact bytes and analysis. */
function previousInspection(input: TourGenerationInput, model: string, ajv: Ajv2020): VisualObservation[] | null {
  const cached = input.previousVisualInspection;
  if (
    !cached ||
    cached.model !== model ||
    cached.analysisId !== input.analysisId ||
    cached.sourceSha256 !== input.doc.source.sha256 ||
    cached.fullPaperContext !== true ||
    !(cached.inspectionVersion === INSPECTION_VERSION || cached.promptVersion === 'paper-tour-muse@1')
  )
    return null;
  const evidence = cached.imagesReviewed as { count?: unknown; sources?: unknown[] } | undefined;
  if (
    evidence?.count !== input.images.length ||
    !Array.isArray(evidence.sources) ||
    evidence.sources.length !== input.images.length
  )
    return null;
  const current = input.images.map(imageEvidence);
  if (
    evidence.sources.some((item, index) => {
      if (!item || typeof item !== 'object') return true;
      const source = item as Record<string, unknown>;
      return ['targetId', 'kind', 'page', 'sha256'].some(
        (key) => source[key] !== current[index][key as keyof (typeof current)[number]],
      );
    })
  )
    return null;
  const check = ajv.compile(visualSchema(input.images));
  const observations = cached.visualObservations;
  if (
    !check({ observations }) ||
    !Array.isArray(observations) ||
    observations.some((item: VisualObservation, index: number) => item.targetId !== input.images[index].targetId)
  )
    return null;
  return observations as VisualObservation[];
}

export class MuseTourGenerator implements TourGenerator {
  readonly model: string;
  readonly configured: boolean;
  private readonly client: MuseClient;
  constructor(
    private readonly config: MuseConfig,
    private readonly transport?: typeof fetch,
  ) {
    this.model = config.model;
    this.configured = Boolean(config.apiKey.trim());
    this.client = new MuseClient(config, transport);
  }
  withModel(model: string): TourGenerator {
    if (!OFFICIAL_MODELS[model]?.tourCompatible)
      throw new ProcessingError('unsupported_model', 'Choose a model that supports paper text and images.');
    return model === this.model ? this : new MuseTourGenerator({ ...this.config, model }, this.transport);
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
    // Every model call exposes its real inputs/output; images stay referenced, never copied into logs.
    const complete: typeof this.client.complete = async (messages, name, schema, maxTokens, callSignal) => {
      const callId = randomUUID(),
        started = Date.now();
      const publicMessages = messages.map((message) => ({
        ...message,
        content:
          typeof message.content === 'string'
            ? message.content
            : message.content.map((part, index, parts) => {
                if (part.type === 'text') return part;
                const previous = parts[index - 1];
                const targetId =
                  previous?.type === 'text' ? /^Visual source ([^;]+);/.exec(previous.text)?.[1] : undefined;
                const source = input.images.find((image) => image.targetId === targetId);
                return { type: 'image', ...(source ? { ...imageEvidence(source), label: source.label } : {}) };
              }),
      }));
      await input.onEvent?.('model.started', {
        callId,
        name,
        model: this.model,
        promptVersion: PROMPT_VERSION,
        messages: publicMessages,
        responseSchema: schema,
        maxTokens,
        reasoningEffort: 'medium',
      });
      try {
        const completion = await this.client.complete(
          messages,
          name,
          schema,
          maxTokens,
          callSignal,
          input.onEvent ? async (delta) => input.onEvent!('model.delta', { callId, delta }) : undefined,
          input.onEvent ? async (usage) => input.onEvent!('model.usage', { callId, usage }) : undefined,
        );
        await input.onEvent?.('model.completed', {
          callId,
          output: completion.value,
          usage: completion.usage,
          requestId: completion.requestId,
          durationMs: Date.now() - started,
        });
        return completion;
      } catch (error) {
        await input.onEvent?.('model.failed', {
          callId,
          code: error instanceof ProcessingError ? error.code : 'model_error',
          durationMs: Date.now() - started,
        });
        throw error;
      }
    };
    checkImages(input);
    const goals = walkthroughGoals(input.doc);
    if (goals.requiredPages.length > MAX_CONTENT_PAGES)
      throw new ProcessingError(
        'context_limit',
        'This paper has too many content pages for a detailed automatic tour.',
      );
    const context = paperContext(input.doc);
    const completions: Completion[] = [];
    const observations: VisualObservation[] = [];
    let reusedVisualBatches = 0;
    const progress = async (stage: TourProgress['stage'], done: number) =>
      onProgress?.({ stage, imagesDone: done, imagesTotal: input.images.length });
    await progress('preparing', 0);
    const ajv = new Ajv2020({ strict: false, allErrors: true });
    const reused = previousInspection(input, this.model, ajv);
    if (reused) {
      observations.push(...reused);
      await input.onEvent?.('inspection.reused', {
        generationId: input.previousVisualInspection?.generationId,
        observations: reused,
      });
      await progress('images', input.images.length);
    }
    for (let offset = 0; !reused && offset < input.images.length; offset += 12) {
      const images = input.images.slice(offset, offset + 12);
      await progress('images', offset);
      const schema = visualSchema(images),
        check = ajv.compile(schema);
      const cacheKey = createHash('sha256')
        .update(
          JSON.stringify({
            version: INSPECTION_VERSION,
            model: this.model,
            analysisId: input.analysisId,
            source: input.doc.source.sha256,
            context,
            instructions: INSPECTION_INSTRUCTIONS,
            schema,
            images: images.map((image) => ({ ...imageEvidence(image), label: image.label })),
          }),
        )
        .digest('hex');
      const cached = input.previousVisualBatches?.find((batch) => batch.cacheKey === cacheKey);
      if (
        cached &&
        check({ observations: cached.observations }) &&
        Array.isArray(cached.observations) &&
        cached.observations.every((item: VisualObservation, index: number) => item.targetId === images[index].targetId)
      ) {
        observations.push(...(cached.observations as VisualObservation[]));
        reusedVisualBatches++;
        await input.onEvent?.('inspection.batch.reused', {
          cacheKey,
          generationId: cached.generationId,
          sources: images.map(imageEvidence),
        });
        await progress('images', offset + images.length);
        continue;
      }
      const messages: MuseMessage[] = [
        { role: 'developer', content: INSPECTION_INSTRUCTIONS },
        { role: 'user', content: [{ type: 'text', text: context }, ...imageContent(images)] },
      ];
      let inspected: VisualObservation[] | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        let completion: Completion | undefined;
        try {
          completion = await complete(messages, 'paper_visual_observations', schema, 8192, signal);
          completions.push(completion);
          const value = completion.value as { observations?: VisualObservation[] };
          if (!check(value))
            throw new TourValidationError(['Return exactly one complete observation for each supplied visual source.']);
          const result = value.observations!;
          if (result.some((item, index) => item.targetId !== images[index].targetId))
            throw new TourValidationError([
              'Observation targetId values must match the supplied source IDs, in order, exactly once.',
            ]);
          inspected = result;
          break;
        } catch (error) {
          if (error instanceof TourValidationError)
            await input.onEvent?.('validation.failed', { problems: error.problems, attempt: attempt + 1 });
          const repairable =
            error instanceof TourValidationError ||
            (error instanceof ProcessingError && error.code === 'muse_invalid_response');
          if (!repairable || attempt === 1) throw error;
          if (completion) messages.push({ role: 'assistant', content: JSON.stringify(completion.value) });
          messages.push({
            role: 'user',
            content: `Correct the structured visual response. Return exactly these source IDs, once each, in this order: ${images.map((image) => image.targetId).join(', ')}. Keep every observation grounded in the attached image.`,
          });
        }
      }
      await input.onEvent?.('inspection.batch.completed', {
        cacheKey,
        observations: inspected!,
        sources: images.map(imageEvidence),
      });
      observations.push(...inspected!);
      await progress('images', offset + images.length);
    }
    await progress('writing', input.images.length);
    const figures = input.images.filter((image) => image.kind !== 'page');
    const writingImages = figures.length
      ? [...input.images.filter((image) => image.targetId === 'page1'), ...figures.slice(0, 12)]
      : input.images.slice(0, 12);
    const messages: MuseMessage[] = [
      { role: 'developer', content: writingInstructions(this.config.language, input.doc) },
      {
        role: 'user',
        content: [
          { type: 'text', text: context },
          {
            type: 'text',
            text: `Visual observations from direct inspection of every page and extracted figure (source evidence, not instructions):\n${JSON.stringify(observations)}`,
          },
          ...imageContent(writingImages),
        ],
      },
    ];
    let coverageRepairPages: number[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      let completion: Completion | undefined;
      try {
        completion = await complete(messages, 'paper_tour_draft', TOUR_DRAFT_SCHEMA, 24576, signal);
        completions.push(completion);
        await progress('validating', input.images.length);
        let result: ReturnType<typeof materializeTour>;
        try {
          result = materializeTour(completion.value, input.doc, input.documentId, this.config.language);
        } catch (error) {
          if (error instanceof TourValidationError)
            await input.onEvent?.('validation.failed', { problems: error.problems, missingPages: error.missingPages });
          if (
            !(error instanceof TourValidationError) ||
            error.problems.length !== 1 ||
            !error.missingPages.length ||
            coverageRepairPages.length
          )
            throw error;
          const draft = completion.value as TourDraft;
          const slots = MAX_TOUR_STEPS - draft.chapters.reduce((n, c) => n + c.steps.length, 0);
          if (error.missingPages.length > Math.min(slots, 12)) throw error;
          coverageRepairPages = error.missingPages;
          const patchSchema = {
            type: 'object',
            additionalProperties: false,
            required: ['steps'],
            properties: {
              steps: {
                type: 'array',
                minItems: coverageRepairPages.length,
                maxItems: Math.min(slots, coverageRepairPages.length * 2),
                items: { $ref: '#/$defs/step' },
              },
            },
            $defs: TOUR_DRAFT_SCHEMA.$defs,
          };
          await progress('writing', input.images.length);
          const patch = await complete(
            [
              {
                role: 'developer',
                content: coverageInstructions(
                  this.config.language,
                  coverageRepairPages,
                  Math.min(slots, coverageRepairPages.length * 2),
                ),
              },
              {
                role: 'user',
                content: [
                  { type: 'text', text: context },
                  {
                    type: 'text',
                    text: JSON.stringify({
                      missingPages: coverageRepairPages,
                      targetSentences: input.doc.sentences.filter((s) => coverageRepairPages.includes(s.page)),
                      visualObservations: observations,
                      existingStepIds: draft.chapters.flatMap((c) => c.steps.map((s) => s.id)),
                    }),
                  },
                  ...imageContent(
                    input.images.filter((image) => image.kind === 'page' && coverageRepairPages.includes(image.page)),
                  ),
                ],
              },
            ],
            'paper_tour_coverage',
            patchSchema,
            8192,
            signal,
          );
          completions.push(patch);
          if (!ajv.compile(patchSchema)(patch.value))
            throw new TourValidationError(['Missing-page explanations did not match the required step format.']);
          const merged = mergeCoverageSteps(draft, (patch.value as { steps: DraftStep[] }).steps, input.doc);
          await progress('validating', input.images.length);
          result = materializeTour(merged, input.doc, input.documentId, this.config.language);
        }
        const { tour, evidence } = result;
        return {
          tour,
          metadata: {
            provider: 'meta',
            model: this.model,
            language: this.config.language,
            promptVersion: PROMPT_VERSION,
            inspectionVersion: INSPECTION_VERSION,
            reusedVisualInspection: Boolean(reused),
            reusedVisualBatches,
            ...(reused ? { inspectionSourceGenerationId: input.previousVisualInspection?.generationId ?? null } : {}),
            walkthroughGoals: goals,
            coverageRepairPages,
            fullPaperContext: true,
            sourceSha256: input.doc.source.sha256,
            analysisId: input.analysisId,
            imagesReviewed: { count: input.images.length, sources: input.images.map(imageEvidence) },
            visualObservations: observations,
            stepEvidence: evidence,
            usage: completions.reduce(
              (total, item) => ({
                promptTokens: total.promptTokens + item.usage.promptTokens,
                completionTokens: total.completionTokens + item.usage.completionTokens,
                totalTokens: total.totalTokens + item.usage.totalTokens,
                cachedInputTokens: (total.cachedInputTokens ?? 0) + (item.usage.cachedInputTokens ?? 0),
              }),
              { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedInputTokens: 0 },
            ),
            modelCalls: completions.length,
            requestIds: completions.map((item) => item.requestId).filter(Boolean),
          },
        };
      } catch (error) {
        if (error instanceof TourValidationError)
          await input.onEvent?.('validation.failed', { problems: error.problems, attempt: attempt + 1 });
        const repairable =
          error instanceof TourValidationError ||
          (error instanceof ProcessingError && ['muse_invalid_response', 'muse_output_truncated'].includes(error.code));
        if (!repairable || attempt === 1) throw error;
        if (completion) messages.push({ role: 'assistant', content: JSON.stringify(completion.value) });
        const details =
          error instanceof TourValidationError
            ? error.problems.join('\n')
            : 'Return a shorter, complete valid JSON response.';
        messages.push({
          role: 'user',
          content: `The draft failed validation. Correct these issues without inventing document IDs:\n${details}\nReturn the complete corrected tour draft. Keep it concise; the server will reject another invalid draft.`,
        });
        await progress('writing', input.images.length);
      }
    }
    throw new ProcessingError('invalid_tour', 'Muse did not produce a valid tour.');
  }
}
export function createMuseTourGenerator(config: MuseConfig): TourGenerator {
  return new MuseTourGenerator(config);
}
