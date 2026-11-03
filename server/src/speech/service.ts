import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, readdir, stat, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  DEFAULT_SPEECH_PREFERENCES,
  type AudioSpeechProvider,
  type SpeechPreferences,
  type SpeechSettings,
  type SpeechAudio,
  type SpeechInput,
} from '../../../shared/speech';
import { Database, type Db } from '../db';
import { HttpError } from '../errors';
import type { SpeechConfig } from './config';
import { SpeechProviders } from './providers';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const CLOUD = ['openai', 'elevenlabs'] as const;
const PROVIDERS: AudioSpeechProvider[] = [...CLOUD];
export function speechPreferences(value: unknown): SpeechPreferences {
  const input = value as Partial<SpeechPreferences> | null;
  const defaults = structuredClone(DEFAULT_SPEECH_PREFERENCES);
  if (!input || typeof input !== 'object') return defaults;
  const result: SpeechPreferences = {
    provider: input.provider ?? defaults.provider,
    connections: { ...defaults.connections },
  };
  if (!['browser', ...PROVIDERS].includes(result.provider))
    throw new HttpError(
      400,
      'speech_settings_invalid',
      'Choose Browser voices, ElevenLabs or OpenAI. Retired GPU model settings require the API-only speech migration.',
    );
  for (const provider of PROVIDERS) {
    const c = { ...defaults.connections[provider], ...input.connections?.[provider] };
    if (typeof c.model !== 'string' || typeof c.voice !== 'string' || !['app', 'personal'].includes(c.credentialSource))
      throw new HttpError(400, 'speech_settings_invalid', 'Choose a supported speech connection.');
    if (
      provider === 'openai' &&
      (!['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'].includes(c.model) ||
        ![
          'alloy',
          'ash',
          'ballad',
          'coral',
          'echo',
          'fable',
          'nova',
          'onyx',
          'sage',
          'shimmer',
          'verse',
          'marin',
          'cedar',
        ].includes(c.voice) ||
        (c.model !== 'gpt-4o-mini-tts' && ['ballad', 'verse', 'marin', 'cedar'].includes(c.voice)))
    )
      throw new HttpError(400, 'speech_settings_invalid', 'This OpenAI model and voice combination is unavailable.');
    if (
      provider === 'elevenlabs' &&
      (!['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_v3'].includes(c.model) ||
        !/^[A-Za-z0-9_-]{8,100}$/.test(c.voice))
    )
      throw new HttpError(
        400,
        'speech_settings_invalid',
        'Choose a supported ElevenLabs model and enter a voice ID from your account.',
      );
    result.connections[provider] = c;
  }
  return result;
}
/** Owner identity and Vault keys are resolved on the server, never accepted from the request body. */
export class SpeechService {
  readonly providers: SpeechProviders;
  private readonly pending = new Map<string, Promise<SpeechAudio>>();
  private readonly active = new Map<string, number>();
  constructor(
    readonly db: Database,
    readonly config: SpeechConfig,
    transport: typeof fetch = fetch,
  ) {
    this.providers = new SpeechProviders(config, transport);
  }
  private async row(owner: string, db: Db = this.db.pool, lock = false) {
    await db.query('insert into speech_settings(owner_id) values($1) on conflict do nothing', [owner]);
    return (await db.query(`select * from speech_settings where owner_id=$1${lock ? ' for update' : ''}`, [owner]))
      .rows[0]!;
  }
  async get(owner: string): Promise<SpeechSettings> {
    const r = await this.row(owner);
    const preferences = speechPreferences(r.preferences);
    const credentials = (
      await this.db.query('select provider,secret_id,key_last4 from speech_credentials where owner_id=$1', [owner])
    ).rows;
    const providers = {} as SpeechSettings['providers'];
    for (const provider of PROVIDERS) {
      const key = credentials.find((c) => c.provider === provider);
      const appKeyAvailable = Boolean(provider === 'openai' ? this.config.openaiKey : this.config.elevenlabsKey);
      const configured =
        preferences.connections[provider].credentialSource === 'personal' ? Boolean(key?.secret_id) : appKeyAvailable;
      providers[provider] = {
        configured,
        appKeyAvailable,
        personalKey: { configured: Boolean(key?.secret_id), masked: key?.secret_id ? `••••${key.key_last4}` : null },
        message:
          provider === 'openai'
            ? 'Optional paid API. Speech API models shut down on 6 January 2027. No generation until selected.'
            : 'Uses your ElevenLabs credits. The next sentence is prepared automatically during playback.',
      };
    }
    return { preferences, version: r.version, providers };
  }
  async update(owner: string, input: SpeechPreferences): Promise<SpeechSettings> {
    const preferences = speechPreferences(input);
    await this.row(owner);
    await this.db.query(
      'update speech_settings set preferences=$2,version=gen_random_uuid(),updated_at=now() where owner_id=$1',
      [owner, preferences],
    );
    return this.get(owner);
  }
  async saveKey(owner: string, provider: 'openai' | 'elevenlabs', raw: string): Promise<SpeechSettings> {
    const key = raw.trim();
    if (!/^[\x21-\x7e]{16,8192}$/.test(key))
      throw new HttpError(400, 'speech_key_invalid', 'Enter a valid speech API key.');
    await this.providers.verifyKey(provider, key);
    try {
      await this.db.transaction(async (tx) => {
        const r = await this.row(owner, tx, true);
        const previous = (
          await tx.query('select secret_id from speech_credentials where owner_id=$1 and provider=$2', [
            owner,
            provider,
          ])
        ).rows[0];
        const secret = (
          await tx.query('select vault.create_secret($1,$2) as id', [
            key,
            `paper-tour:speech:${provider}:${owner}:${randomUUID()}`,
          ])
        ).rows[0].id;
        await tx.query(
          `insert into speech_credentials(owner_id,provider,secret_id,key_last4) values($1,$2,$3,$4)
          on conflict(owner_id,provider) do update set secret_id=excluded.secret_id,key_last4=excluded.key_last4`,
          [owner, provider, secret, key.slice(-4)],
        );
        const preferences = speechPreferences(r.preferences);
        preferences.connections[provider].credentialSource = 'personal';
        await tx.query(
          'update speech_settings set preferences=$2,version=gen_random_uuid(),updated_at=now() where owner_id=$1',
          [owner, preferences],
        );
        if (previous?.secret_id) await tx.query('delete from vault.secrets where id=$1', [previous.secret_id]);
      });
    } catch {
      throw new HttpError(503, 'speech_key_storage_unavailable', 'The speech key could not be stored securely. Retry.');
    }
    return this.get(owner);
  }
  async removeKey(owner: string, provider: 'openai' | 'elevenlabs'): Promise<SpeechSettings> {
    await this.db.transaction(async (tx) => {
      const r = await this.row(owner, tx, true);
      await tx.query('delete from speech_credentials where owner_id=$1 and provider=$2', [owner, provider]);
      const preferences = speechPreferences(r.preferences);
      preferences.connections[provider].credentialSource = 'personal';
      await tx.query(
        'update speech_settings set preferences=$2,version=gen_random_uuid(),updated_at=now() where owner_id=$1',
        [owner, preferences],
      );
    });
    return this.get(owner);
  }
  async synthesize(owner: string, input: SpeechInput, signal?: AbortSignal): Promise<SpeechAudio> {
    const text = input.text.trim();
    if (!text || text.length > 2500 || !/^[a-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})?$/i.test(input.language))
      throw new HttpError(400, 'speech_input_invalid', 'Speech needs 1–2500 characters and a valid language.');
    const r = await this.row(owner);
    if (r.version !== input.version)
      throw new HttpError(409, 'speech_settings_changed', 'Speech settings changed. Reload the reader before playing.');
    const preferences = speechPreferences(r.preferences),
      provider = preferences.provider;
    if (provider === 'browser')
      throw new HttpError(
        400,
        'speech_browser_selected',
        'Browser speech runs on this device. Select an audio provider first.',
      );
    const connection = preferences.connections[provider];
    let apiKey = provider === 'openai' ? this.config.openaiKey : this.config.elevenlabsKey;
    if (connection.credentialSource === 'personal') {
      const key = await this.db.query(
        'select v.decrypted_secret from speech_credentials c join vault.decrypted_secrets v on v.id=c.secret_id where c.owner_id=$1 and c.provider=$2',
        [owner, provider],
      );
      apiKey = key.rows[0]?.decrypted_secret ?? '';
    }
    if (!apiKey)
      throw new HttpError(
        503,
        'speech_not_configured',
        'The selected speech connection has no API key. Add one in Settings or explicitly select another provider.',
      );
    const folder = resolve(this.config.cacheDir, hash(owner));
    const identity = hash(
      JSON.stringify([r.version, provider, connection.model, connection.voice, input.language, text]),
    );
    const path = resolve(folder, `${identity}.json`),
      key = `${hash(owner)}:${identity}`;
    try {
      const metadata = await stat(path);
      if (Date.now() - metadata.mtimeMs < 7 * 86400_000 && metadata.size <= 34 * 1024 * 1024) {
        const cached = JSON.parse(await readFile(path, 'utf8')) as SpeechAudio;
        return { ...cached, cached: true };
      }
    } catch {
      /* A missing or unreadable cache entry is regenerated by the same provider. */
    }
    const pending = this.pending.get(key);
    if (pending) return pending;
    if ((this.active.get(owner) ?? 0) >= 2)
      throw new HttpError(429, 'speech_busy', 'Wait for the current speech generation before starting another.');
    const run = (async () => {
      this.active.set(owner, (this.active.get(owner) ?? 0) + 1);
      try {
        const audio = await this.providers.synthesize(
          { provider, ...connection, apiKey, text, language: input.language },
          signal,
        );
        const result = { ...audio, cached: false };
        try {
          await mkdir(folder, { recursive: true, mode: 0o700 });
          const temp = `${path}.${randomUUID()}.tmp`;
          try {
            await writeFile(temp, JSON.stringify(result), { mode: 0o600 });
            await rename(temp, path);
          } finally {
            await unlink(temp).catch(() => {});
          }
          // Bound each account's private disk cache to 128 MiB and seven days.
          const entries = (
            await Promise.all(
              (await readdir(folder))
                .filter((name) => name.endsWith('.json'))
                .map(async (name) => {
                  try {
                    return { path: resolve(folder, name), info: await stat(resolve(folder, name)) };
                  } catch {
                    return null;
                  }
                }),
            )
          ).filter((entry) => entry !== null);
          let bytes = entries.reduce((sum, entry) => sum + entry.info.size, 0);
          for (const entry of entries.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs)) {
            if (bytes <= 128 * 1024 * 1024 && Date.now() - entry.info.mtimeMs < 7 * 86400_000) break;
            await unlink(entry.path).catch(() => {});
            bytes -= entry.info.size;
          }
        } catch {
          /* Caching is best effort; a concurrent prune or full disk must not discard generated audio. */
        }
        return result;
      } finally {
        this.active.set(owner, Math.max(0, (this.active.get(owner) ?? 1) - 1));
      }
    })();
    this.pending.set(key, run);
    try {
      return await run;
    } finally {
      this.pending.delete(key);
    }
  }
}
