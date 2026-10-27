export interface ModelPricing {
  currency: 'USD';
  inputPerMillionTokens?: number;
  cachedInputPerMillionTokens?: number;
  outputPerMillionTokens?: number;
  perImage?: number;
  perHour?: number;
  perThousandImages?: number;
  perThousandVideoFrames?: number;
}
export interface ApiModel {
  id: string;
  name: string;
  kind: 'reasoning' | 'image_generation' | 'transcription' | 'segmentation' | 'unknown';
  tourCompatible: boolean;
  available: boolean | null;
  contributor: boolean;
  contextTokens?: number;
  pricing: ModelPricing | null;
}
export interface ModelCatalog {
  provider: 'meta';
  defaultModel: string;
  availability: 'live' | 'unavailable' | 'not_configured';
  checkedAt: string;
  pricingCheckedAt: string;
  pricingSourceUrl: string;
  models: ApiModel[];
}
