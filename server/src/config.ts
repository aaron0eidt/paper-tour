import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const ROOT = fileURLToPath(new URL('../../', import.meta.url));
try {
  process.loadEnvFile(resolve(ROOT, '.env'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
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
}
export function config(): Config {
  const needed = (name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`Missing ${name}; configure the root .env before starting the backend.`);
    return value;
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
  };
}
