/** Creates a disposable speech-validation database. Never resets the application's database. */
import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { ROOT } from '../src/config';
const path = resolve(ROOT, '.data/speech-test-database.json');
const adminUrl = process.env.TTS_TEST_ADMIN_DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
if (!['127.0.0.1', 'localhost', '[::1]'].includes(new URL(adminUrl).hostname))
  throw new Error('Use a local test database server.');
const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
try {
  if (process.argv.includes('--remove')) {
    const { name } = JSON.parse(await readFile(path, 'utf8'));
    if (!/^paper_tour_tts_test_[a-f0-9]+$/.test(name)) throw new Error('Invalid isolated test database name.');
    await admin.query(`drop database if exists "${name}" with (force)`);
    await unlink(path);
    console.log('Removed isolated speech test database.');
  } else {
    const name = `paper_tour_tts_test_${randomUUID().replaceAll('-', '')}`;
    await admin.query(`create database "${name}"`);
    const url = new URL(adminUrl);
    url.pathname = `/${name}`;
    const isolated = new pg.Pool({ connectionString: url.href, max: 1 });
    try {
      await writeFile(path, JSON.stringify({ name, url: url.href }), { mode: 0o600 });
      await isolated.query(
        `create schema vault; create schema auth; create table auth.users(id uuid primary key,email text); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;`,
      );
      for (const file of [
        '202610270005_user_settings.sql',
        '202611030002_speech_providers.sql',
        '202611030003_api_only_speech.sql',
      ])
        await isolated.query(await readFile(resolve(ROOT, 'supabase/migrations', file), 'utf8'));
      await writeFile(path, JSON.stringify({ name, url: url.href }), { mode: 0o600 });
      console.log('Created isolated speech test database; configuration saved under .data.');
    } finally {
      await isolated.end();
    }
  }
} finally {
  await admin.end();
}
