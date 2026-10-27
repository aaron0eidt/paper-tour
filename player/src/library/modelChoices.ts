import type { ApiModel, ModelCatalog, ModelPricing } from '../../../shared/models';

export function selectedApiModel(catalog: ModelCatalog | null, model: string): ApiModel | undefined {
  return catalog?.models.find((candidate) => candidate.id === model);
}

export function canUseModel(catalog: ModelCatalog | null, model: string, allowTraining: boolean): boolean {
  const selected = selectedApiModel(catalog, model);
  return !!selected && selected.tourCompatible && selected.available !== false && (!selected.contributor || allowTraining);
}

export function formatPrice(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) || value < 0
    ? 'Not published'
    : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 5 }).format(value);
}

export function modelDisplayName(model: ApiModel): string {
  return model.contributor && !/\bcontributor\b/i.test(model.name) ? `${model.name} · Contributor` : model.name;
}

export function tokenPrice(model: ApiModel, field: 'inputPerMillionTokens' | 'cachedInputPerMillionTokens' | 'outputPerMillionTokens'): string {
  const value = model.pricing?.[field];
  return value === undefined && model.kind !== 'reasoning' && model.kind !== 'unknown' ? '—' : formatPrice(value);
}

export function modelPurpose(model: ApiModel): string {
  if (model.tourCompatible) return 'PDF tours';
  switch (model.kind) {
    case 'image_generation': return 'Image generation';
    case 'transcription': return 'Speech to text';
    case 'segmentation': return 'Image and video segmentation';
    default: return 'Other API model';
  }
}

export function otherPricing(pricing: ModelPricing | null): string[] {
  if (!pricing) return [];
  const prices: string[] = [];
  if (pricing.perImage !== undefined) prices.push(`${formatPrice(pricing.perImage)} / image`);
  if (pricing.perHour !== undefined) prices.push(`${formatPrice(pricing.perHour)} / hour`);
  if (pricing.perThousandImages !== undefined) prices.push(`${formatPrice(pricing.perThousandImages)} / 1,000 images`);
  if (pricing.perThousandVideoFrames !== undefined) prices.push(`${formatPrice(pricing.perThousandVideoFrames)} / 1,000 video frames`);
  return prices;
}
