import type { ApiModel, ModelCatalog } from '../../../shared/models';
import type { MuseConfig } from '../config';
import { HttpError, ProcessingError } from '../errors';
import { OFFICIAL_MODELS, PRICING_CHECKED_AT, PRICING_SOURCE_URL } from './pricing';

const CACHE_MS = 5 * 60 * 1000;
const RESPONSE_LIMIT_BYTES = 512 * 1024;

export function isContributorModel(model: string): boolean {
  const id = model.trim();
  return OFFICIAL_MODELS[id]?.contributor ?? id.endsWith('-contributor');
}

/** Server-only availability lookup; documented prices never imply account access. */
export class MetaModelCatalog {
  private readonly endpoint: string;
  private cached?: { expiresAt: number; value: ModelCatalog };
  private pending?: Promise<ModelCatalog>;

  constructor(
    private readonly config: MuseConfig,
    private readonly transport: typeof fetch = fetch,
  ) {
    let url: URL;
    try {
      url = new URL(config.baseUrl);
    } catch {
      throw new ProcessingError('muse_not_configured', 'The Muse API address is invalid.');
    }
    if (
      url.protocol !== 'https:' &&
      !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    ) {
      throw new ProcessingError('muse_not_configured', 'Muse requires a secure API connection.');
    }
    if (url.username || url.password || url.search || url.hash)
      throw new ProcessingError('muse_not_configured', 'The Muse API address must not contain credentials or query parameters.');
    this.endpoint = `${url.href.replace(/\/$/, '')}/models`;
  }

  async get(): Promise<ModelCatalog> {
    if (this.cached && this.cached.expiresAt > Date.now()) return structuredClone(this.cached.value);
    this.pending ??= this.load().then((value) => {
      this.cached = { expiresAt: Date.now() + CACHE_MS, value };
      return value;
    }).finally(() => { this.pending = undefined; });
    // Returning copies prevents a caller from changing cached availability/prices.
    return structuredClone(await this.pending);
  }

  async validateSelection(model: string, allowTraining = false): Promise<string> {
    const id = typeof model === 'string' ? model.trim() : '';
    const known = OFFICIAL_MODELS[id];
    if (!known?.tourCompatible)
      throw new HttpError(400, 'unsupported_model', 'Choose a text model that supports paper tour generation.');
    if (known.contributor && allowTraining !== true)
      throw new HttpError(400, 'contributor_training_consent_required', 'Contributor models require explicit consent to Meta using the paper content for training.');
    const catalog = await this.get();
    if (catalog.availability === 'live' && catalog.models.find((item) => item.id === id)?.available === false)
      throw new HttpError(400, 'model_not_available', 'This model is not available to the configured Meta API account.');
    return known.id;
  }

  private catalog(availability: ModelCatalog['availability'], liveIds?: Set<string>): ModelCatalog {
    const models: ApiModel[] = Object.values(OFFICIAL_MODELS).map((model) => ({
      ...model,
      available: liveIds ? liveIds.has(model.id) : null,
    }));
    for (const id of liveIds ?? []) {
      if (Object.hasOwn(OFFICIAL_MODELS, id)) continue;
      models.push({ id, name: id, kind: 'unknown', tourCompatible: false, available: true,
        contributor: isContributorModel(id), pricing: null });
    }
    return {
      provider: 'meta',
      defaultModel: this.config.model,
      availability,
      checkedAt: new Date().toISOString(),
      pricingCheckedAt: PRICING_CHECKED_AT,
      pricingSourceUrl: PRICING_SOURCE_URL,
      models,
    };
  }

  private async load(): Promise<ModelCatalog> {
    if (!this.config.apiKey.trim()) return this.catalog('not_configured');
    const timeout = Number.isFinite(this.config.timeoutMs)
      ? Math.max(1, Math.min(10_000, Math.floor(this.config.timeoutMs))) : 10_000;
    try {
      const response = await this.transport(this.endpoint, {
        method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeout),
        headers: { Authorization: `Bearer ${this.config.apiKey.trim()}`, Accept: 'application/json' },
      });
      // Error responses can echo credentials or private request content. Never read them.
      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        return this.catalog('unavailable');
      }
      const reader = response.body?.getReader();
      if (!reader) return this.catalog('unavailable');
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > RESPONSE_LIMIT_BYTES) {
          await reader.cancel();
          return this.catalog('unavailable');
        }
        chunks.push(value);
      }
      const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || !('data' in parsed) || !Array.isArray(parsed.data) || parsed.data.length > 1000)
        return this.catalog('unavailable');
      const ids = new Set<string>();
      for (const model of parsed.data) {
        if (!model || typeof model !== 'object' || typeof model.id !== 'string' || !model.id.trim()
            || model.id.length > 200 || /[\u0000-\u001f\u007f]/.test(model.id))
          return this.catalog('unavailable');
        ids.add(model.id.trim());
      }
      return this.catalog('live', ids);
    } catch {
      return this.catalog('unavailable');
    }
  }
}
