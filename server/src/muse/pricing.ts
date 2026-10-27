import type { ApiModel, ModelPricing } from '../../../shared/models';

/** Official list-price snapshot. Availability is separately discovered from the team's API. */
export const PRICING_SOURCE_URL = 'https://dev.meta.ai/docs/pricing-rate-limits';
export const PRICING_CHECKED_AT = '2026-10-27';
const standard: ModelPricing = { currency: 'USD', inputPerMillionTokens: 1.25, cachedInputPerMillionTokens: 0.15, outputPerMillionTokens: 4.25 };
const contributor: ModelPricing = { currency: 'USD', inputPerMillionTokens: 0.10, cachedInputPerMillionTokens: 0.002, outputPerMillionTokens: 0.20 };
const reasoning = (id: string, name: string, pricing: ModelPricing, training = false): Omit<ApiModel, 'available'> => ({
  id, name, kind: 'reasoning', tourCompatible: true, contributor: training, contextTokens: 1_048_576, pricing,
});
export const OFFICIAL_MODELS: Record<string, Omit<ApiModel, 'available'>> = {
  'muse-spark-1.3': reasoning('muse-spark-1.3', 'Muse Spark 1.3', standard),
  'muse-wonder-1.0': reasoning('muse-wonder-1.0', 'Muse Wonder 1.0', { currency: 'USD', inputPerMillionTokens: 4, cachedInputPerMillionTokens: 0.20, outputPerMillionTokens: 20 }),
  'muse-spark-1.2': reasoning('muse-spark-1.2', 'Muse Spark 1.2', standard),
  'muse-spark-1.1': reasoning('muse-spark-1.1', 'Muse Spark 1.1', standard),
  'muse-spark-1.3-contributor': reasoning('muse-spark-1.3-contributor', 'Muse Spark 1.3 · Contributor', contributor, true),
  'muse-spark-1.2-contributor': reasoning('muse-spark-1.2-contributor', 'Muse Spark 1.2 · Contributor', contributor, true),
  'muse-image-1.0': { id: 'muse-image-1.0', name: 'Muse Image 1.0', kind: 'image_generation', tourCompatible: false, contributor: false, pricing: { currency: 'USD', perImage: 0.01 } },
  'muse-voice-transcribe-1.0': { id: 'muse-voice-transcribe-1.0', name: 'Muse Voice Transcribe 1.0', kind: 'transcription', tourCompatible: false, contributor: false, pricing: { currency: 'USD', perHour: 0.18 } },
  'sam-3.1': { id: 'sam-3.1', name: 'Segment Anything 3.1', kind: 'segmentation', tourCompatible: false, contributor: false, pricing: { currency: 'USD', perThousandImages: 2.50, perThousandVideoFrames: 0.20 } },
};
