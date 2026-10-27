import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
try {
  process.loadEnvFile(resolve(root, '.env'));
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
const database = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!database || !['localhost', '127.0.0.1', '[::1]'].includes(new URL(database).hostname)) {
  throw new Error('Integration tests require a local TEST_DATABASE_URL or local DATABASE_URL.');
}
const child = spawn('npm', ['test'], {
  cwd: resolve(root, 'server'),
  stdio: 'inherit',
  env: { ...process.env, TEST_DATABASE_URL: database },
});
child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
