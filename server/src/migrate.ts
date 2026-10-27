import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Database } from './db';
import { ROOT } from './config';
const url = process.env.DATABASE_URL;
if (!url) throw new Error('Set DATABASE_URL to run migrations.');
const db = new Database(url);
try {
  await db.transaction(async (tx) => {
    await tx.query("select pg_advisory_xact_lock(hashtext('paper-tour-migrations'))");
    await tx.query(
      'create table if not exists public.paper_tour_migrations(name text primary key, applied_at timestamptz default now())',
    );
    const {
      rows: [tracker],
    } = await tx.query("select to_regclass('supabase_migrations.schema_migrations') as name");
    const folder = resolve(ROOT, 'supabase/migrations');
    for (const name of (await readdir(folder)).filter((x) => x.endsWith('.sql')).sort()) {
      if ((await tx.query('select 1 from public.paper_tour_migrations where name=$1', [name])).rowCount) continue;
      const version = name.split('_')[0];
      const alreadyAppliedBySupabase =
        tracker.name &&
        (await tx.query('select 1 from supabase_migrations.schema_migrations where version=$1', [version])).rowCount;
      if (!alreadyAppliedBySupabase) await tx.query(await readFile(resolve(folder, name), 'utf8'));
      await tx.query('insert into public.paper_tour_migrations(name) values($1)', [name]);
      console.log(`Applied ${name}`);
    }
  });
} finally {
  await db.close();
}
