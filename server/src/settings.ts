import { randomUUID } from 'node:crypto';
import type { ModelCatalog } from '../../shared/models';
import type { SettingsUpdate, UserSettings } from '../../shared/settings';
import type { MuseConfig } from './config';
import { Database, type Db } from './db';
import { HttpError } from './errors';
import { MetaModelCatalog } from './muse/models';

/** Vault owns encryption. This service returns secret-free settings and resolves keys only for server calls. */
export class SettingsService {
  private readonly catalogs = new Map<string, { expires: number; value: ModelCatalog }>();
  private readonly pendingCatalogs = new Map<string, Promise<ModelCatalog>>();
  constructor(readonly db: Database, readonly base: MuseConfig, readonly transport: typeof fetch = fetch) {}

  private async row(owner: string, db: Db = this.db.pool, lock = false) {
    await db.query('insert into user_settings(owner_id,default_model) values($1,$2) on conflict do nothing', [owner, this.base.model]);
    return (await db.query(`select * from user_settings where owner_id=$1${lock ? ' for update' : ''}`, [owner])).rows[0]!;
  }
  async get(owner: string): Promise<UserSettings> {
    const r = await this.row(owner);
    return {
      defaultModel: r.default_model, credentialSource: r.credential_source, appKeyAvailable: Boolean(this.base.apiKey),
      personalKey: { configured: Boolean(r.secret_id), masked: r.secret_id ? `••••${r.key_last4}` : null,
        updatedAt: r.key_updated_at?.toISOString() ?? null, checkedAt: r.key_checked_at?.toISOString() ?? null, status: r.key_status ?? null },
    };
  }
  private invalidate(owner: string) {
    for (const key of this.catalogs.keys()) if (key.startsWith(`${owner}:`)) this.catalogs.delete(key);
  }
  async resolveMuse(owner: string, model?: string): Promise<{ config: MuseConfig; source: string; version: string }> {
    const r = await this.row(owner);
    let apiKey = this.base.apiKey;
    if (r.credential_source === 'personal') {
      apiKey = '';
      if (r.secret_id) {
        const result = await this.db.query('select decrypted_secret from vault.decrypted_secrets where id=$1', [r.secret_id]);
        apiKey = result.rows[0]?.decrypted_secret ?? '';
      }
    }
    return { config: { ...this.base, apiKey, model: model ?? r.default_model }, source: r.credential_source, version: r.credential_version };
  }
  async models(owner: string, force = false): Promise<ModelCatalog> {
    const r = await this.row(owner);
    const cacheKey = `${owner}:${r.credential_version}`;
    const cached = this.catalogs.get(cacheKey);
    if (!force && cached && cached.expires > Date.now()) return { ...structuredClone(cached.value), defaultModel: r.default_model };
    if (!force && this.pendingCatalogs.has(cacheKey)) return { ...structuredClone(await this.pendingCatalogs.get(cacheKey)!), defaultModel: r.default_model };
    const pending = (async () => {
      const resolved = await this.resolveMuse(owner);
      const result = await new MetaModelCatalog(resolved.config, this.transport).get();
      // ponytail: bounded per-process metadata cache; provider clients and personal keys are never cached.
      if (this.catalogs.size >= 100) this.catalogs.delete(this.catalogs.keys().next().value!);
      this.catalogs.set(cacheKey, { value: structuredClone(result), expires: Date.now() + 300_000 });
      return result;
    })();
    this.pendingCatalogs.set(cacheKey, pending);
    try { return { ...structuredClone(await pending), defaultModel: r.default_model }; }
    finally { if (this.pendingCatalogs.get(cacheKey) === pending) this.pendingCatalogs.delete(cacheKey); }
  }
  async validateModel(owner: string, model: string, allowTraining: boolean): Promise<string> {
    // Validate supported models and consent without a provider request first.
    const id = await new MetaModelCatalog({ ...this.base, apiKey: '' }).validateSelection(model, allowTraining);
    const catalog = await this.models(owner);
    if (catalog.models.find((m) => m.id === id)?.available === false)
      throw new HttpError(400, 'model_not_available', 'This model is not available to your selected Meta connection.');
    return id;
  }
  async update(owner: string, value: SettingsUpdate): Promise<UserSettings> {
    if (value.defaultModel) await this.validateModel(owner, value.defaultModel, true); // Saving a preference never starts inference.
    await this.db.transaction(async (tx) => {
      const r = await this.row(owner, tx, true);
      await tx.query(`update user_settings set default_model=$2,credential_source=$3,
        credential_version=case when credential_source<>$3 then gen_random_uuid() else credential_version end,updated_at=now() where owner_id=$1`,
      [owner, value.defaultModel ?? r.default_model, value.credentialSource ?? r.credential_source]);
    });
    this.invalidate(owner);
    return this.get(owner);
  }
  async saveKey(owner: string, raw: string): Promise<UserSettings> {
    const apiKey = raw.trim();
    if (!/^[\x21-\x7e]{16,8192}$/.test(apiKey)) throw new HttpError(400, 'invalid_api_key', 'Enter a valid Meta API key.');
    const checked = await new MetaModelCatalog({ ...this.base, apiKey }, this.transport).get();
    if (checked.availability !== 'live') throw new HttpError(400, 'key_not_verified', 'Meta could not verify this key. Check the key or try again.');
    try {
      await this.db.transaction(async (tx) => {
        const previous = await this.row(owner, tx, true);
        const version = randomUUID();
        const secret = (await tx.query('select vault.create_secret($1,$2) as id', [apiKey, `paper-tour:meta:${owner}:${version}`])).rows[0].id;
        await tx.query(`update user_settings set secret_id=$2,key_last4=$3,key_updated_at=now(),key_checked_at=now(),
          key_status='valid',credential_source='personal',credential_version=$4,updated_at=now() where owner_id=$1`, [owner, secret, apiKey.slice(-4), version]);
        if (previous.secret_id) await tx.query('delete from vault.secrets where id=$1', [previous.secret_id]);
      });
    } catch { throw new HttpError(503, 'key_storage_unavailable', 'The key could not be saved securely. Please retry.'); }
    this.invalidate(owner);
    return this.get(owner);
  }
  async removeKey(owner: string): Promise<UserSettings> {
    await this.db.transaction(async (tx) => {
      const r = await this.row(owner, tx, true);
      await tx.query(`update user_settings set secret_id=null,key_last4=null,key_updated_at=null,key_checked_at=null,key_status=null,
        credential_version=gen_random_uuid(),updated_at=now() where owner_id=$1`, [owner]);
      if (r.secret_id) await tx.query('delete from vault.secrets where id=$1', [r.secret_id]);
    });
    this.invalidate(owner);
    return this.get(owner);
  }
  async test(owner: string): Promise<UserSettings> {
    const catalog = await this.models(owner, true);
    const r = await this.row(owner);
    if (r.credential_source === 'personal' && r.secret_id)
      await this.db.query('update user_settings set key_checked_at=now(),key_status=$2 where owner_id=$1', [owner, catalog.availability === 'live' ? 'valid' : 'unavailable']);
    if (catalog.availability !== 'live') throw new HttpError(400, 'connection_unavailable', 'The selected Meta connection could not be verified.');
    return this.get(owner);
  }
}
