import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
}
export interface MuseConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  language: string;
  timeoutMs: number;
}
export interface Config {
  databaseUrl: string;
  supabaseUrl: string;
  serviceKey: string;
  port: number;
  host: string;
  origins: string[];
  python: string;
  maxBytes: number;
  maxPages: number;
  analysisTimeoutMs: number;
  muse: MuseConfig;
  /** Guided tour length (notes/HARNESS.md); persistent agents are configured separately. */
  tours: { preset: 'quick' | 'standard' | 'deep' };
  agent?: { enabled: boolean; maxTurns: number; maxOutputTokens: number; maxRuntimeMs: number };
}
export function config(): Config {
  const needed = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name}; configure the root .env before starting the backend.`);
    return value;
  };
  const budget = (name: string, fallback: number) => {
    if (process.env[name] === undefined) return fallback;
    const value = Number(process.env[name]);
    if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
    return value;
  };
  const choice = <T extends string>(name: string, options: readonly T[], fallback: T): T => {
    const value = process.env[name] ?? fallback;
    if (!options.includes(value as T)) throw new Error(`${name} must be one of ${options.join(', ')}.`);
    return value as T;
  };
  return {
    databaseUrl: needed('DATABASE_URL'),
    supabaseUrl: needed('SUPABASE_URL'),
    serviceKey: needed('SUPABASE_SERVICE_ROLE_KEY'),
    port: Number(process.env.PORT ?? 3001),
    host: process.env.HOST ?? '127.0.0.1',
    origins: (process.env.APP_ORIGINS ?? 'http://localhost:5174,http://localhost:5173').split(',').map((x) => x.trim()),
    python: process.env.PYTHON_BIN ?? resolve(ROOT, 'ingest/.venv/bin/python'),
    maxBytes: 25 * 1024 * 1024,
    maxPages: 100,
    analysisTimeoutMs: 300_000,
    tours: {
      preset: choice('TOUR_PRESET', ['quick', 'standard', 'deep'], 'deep'),
    },
    agent: {
      enabled: process.env.PAPER_AGENT_ENABLED === 'true',
      maxTurns: budget('PAPER_AGENT_MAX_TURNS', 64),
      maxOutputTokens: budget('PAPER_AGENT_MAX_OUTPUT_TOKENS', 128000),
      maxRuntimeMs: budget('PAPER_AGENT_MAX_RUNTIME_MS', 1200000),
    },
    muse: {
      apiKey: process.env.MODEL_API_KEY?.trim() || process.env.MUSE_API_KEY?.trim() || '',
      baseUrl: process.env.MUSE_BASE_URL ?? 'https://api.meta.ai/v1',
      model: process.env.MUSE_MODEL ?? 'muse-spark-1.3',
      language: process.env.MUSE_TOUR_LANGUAGE ?? 'en-US',
      timeoutMs: Math.max(1000, Math.min(300_000, Number(process.env.MUSE_TIMEOUT_MS) || 300_000)),
    },
  };
}
