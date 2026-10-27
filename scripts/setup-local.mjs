import { execFileSync } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
process.env.SUPABASE_HOME ??= resolve(root, '.data/supabase');
process.env.SUPABASE_EXPERIMENTAL_STACK ??= '1';
const cli = resolve(root, 'node_modules/.bin/supabase');
let data;
try {
  const output = execFileSync(cli, ['status', '--output-format', 'json'], {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  data = JSON.parse(output.slice(output.indexOf('{')));
} catch {
  console.error(
    'Start local Supabase first: npm run supabase:start. For native mode set SUPABASE_EXPERIMENTAL_STACK=1 and run npx supabase start --runtime native.',
  );
  process.exit(1);
}
const env = data.env ?? data;
const url = env.API_URL;
const database = env.DB_URL;
const anon = env.ANON_KEY ?? env.PUBLISHABLE_KEY;
const service = env.SERVICE_ROLE_KEY ?? env.SECRET_KEY;
if (!url || !database || !anon || !service)
  throw new Error('Supabase status did not return the required local configuration.');
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(url).hostname))
  throw new Error('This setup helper only accepts a local Supabase instance.');
const files = [
  [
    resolve(root, '.env'),
    `DATABASE_URL=${database}\nSUPABASE_URL=${url}\nSUPABASE_SERVICE_ROLE_KEY=${service}\nAPP_ORIGINS=http://localhost:5174,http://127.0.0.1:5174\nVITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${anon}\nPYTHON_BIN=${resolve(root, 'ingest/.venv/bin/python')}\n`,
  ],
  [resolve(root, 'player/.env.local'), `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${anon}\n`],
];
for (const [path] of files)
  if (existsSync(path))
    throw new Error(`${path} already exists. Preserve it or remove it before generating local configuration.`);
for (const [path, value] of files) writeFileSync(path, value, { mode: 0o600 });
console.log(
  'Local backend and frontend configuration saved. No keys were printed. Restart the frontend and run npm run db:migrate, then npm run dev.',
);
