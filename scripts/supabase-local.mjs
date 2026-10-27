import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (!['start', 'stop', 'status'].includes(args[0])) throw new Error('Expected start, stop or status.');
if (args[0] === 'start') args.push('--exclude', 'realtime,functions,studio,analytics,pooler');
const child = spawn(resolve(root, 'node_modules/.bin/supabase'), args, {
  cwd: root,
  stdio: 'inherit',
  env: {
    ...process.env,
    SUPABASE_HOME: process.env.SUPABASE_HOME ?? resolve(root, '.data/supabase'),
    SUPABASE_EXPERIMENTAL_STACK: '1',
  },
});
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
