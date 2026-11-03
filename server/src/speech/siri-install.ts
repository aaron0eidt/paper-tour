import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, chmod, copyFile, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { SiriConfig } from './config';

export type SiriCommand = (file: string, args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv; signal?: AbortSignal; timeout?: number }) => Promise<{ stdout: string; stderr: string }>;
const execute = promisify(execFile);
export const siriCommand: SiriCommand = (file, args, options) => execute(file, args, {
  timeout: 45_000, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL', ...options,
});
// A fresh install always builds the exact reviewed source, even if the upstream tag moves.
export const SIRI_SOURCE_COMMIT = '6e818c56bfcc0120c234ac2d95d5d6b9ad486ff7';

export async function findSiriBinary(config: SiriConfig, run: SiriCommand = siriCommand): Promise<string | undefined> {
  for (const binary of [...new Set([config.binary, join(config.dataDir, 'bin/siri-tts'), 'siri-tts'].filter((value): value is string => !!value))]) {
    try {
      const result = await run(binary, ['--version'], { timeout: 5000 });
      if (/^2\./m.test(result.stdout.trim())) return binary;
    } catch { /* Try the managed helper and PATH before requiring installation. */ }
  }
}

/** No global Homebrew changes, sudo, shell interpolation or unpinned install scripts. */
async function buildSiriBinary(config: SiriConfig, signal: AbortSignal, run: SiriCommand): Promise<string> {
  const source = join(config.dataDir, 'source');
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  try { await run('xcrun', ['swift', '--version'], { signal, timeout: 10_000 }); }
  catch { throw new Error('Apple developer tools are required. Install Xcode or Command Line Tools, then retry Siri setup.'); }
  try { await access(join(source, '.git')); }
  catch {
    await run('git', ['init', source], { signal });
    await run('git', ['-C', source, 'remote', 'add', 'origin', 'https://github.com/maximilianromer/siri-tts-cli.git'], { signal });
  }
  await run('git', ['-C', source, 'fetch', '--depth', '1', 'origin', SIRI_SOURCE_COMMIT], { signal, timeout: 120_000 });
  // Do not overwrite a different checkout someone placed in this managed directory.
  let current = '';
  try { current = (await run('git', ['-C', source, 'rev-parse', 'HEAD'], { signal })).stdout.trim(); } catch { /* New checkout. */ }
  if (current && current !== SIRI_SOURCE_COMMIT) throw new Error('The managed Siri source has a different version. Move .data/siri/source aside, then retry.');
  if (!current) await run('git', ['-C', source, 'checkout', '--detach', SIRI_SOURCE_COMMIT], { signal });
  const verified = (await run('git', ['-C', source, 'rev-parse', 'HEAD'], { signal })).stdout.trim();
  if (verified !== SIRI_SOURCE_COMMIT) throw new Error('The Siri source version could not be verified.');
  const env = { ...process.env };
  // Xcode 27.2 removed an optional private setter; the installed 27.0 CLT SDK builds v2 unchanged.
  try { await access('/Library/Developer/CommandLineTools/SDKs/MacOSX27.0.sdk'); env.DEVELOPER_DIR = '/Library/Developer/CommandLineTools'; } catch { /* Use the selected developer tools. */ }
  try {
    await run('swift', ['build', '-c', 'release'], { cwd: source, env, signal, timeout: 900_000 });
  } catch (error) {
    const diagnostic = String((error as { stderr?: string; stdout?: string }).stderr ?? '') + String((error as { stdout?: string }).stdout ?? '');
    if (!diagnostic.includes('voiceAcousticsOverride') || !diagnostic.includes('Undefined symbols'))
      throw new Error('The Siri helper could not be built with these Apple developer tools. Update Command Line Tools, then retry.');
    // This optional control is not used by Paper Tour. Fail explicitly if another caller asks for it.
    const path = join(source, 'Sources/SiriTTSCore/SiriRuntimeControls.swift');
    const original = await readFile(path, 'utf8');
    const patched = original.replace(/        if let acoustics = controls\.acoustics \{\n[\s\S]*?\n        \}/, '        if controls.acoustics != nil { throw unsupported("acoustic overrides") }');
    if (patched === original) throw new Error('This SDK needs a Siri compatibility update. No source changes were applied.');
    await writeFile(path, patched);
    await run('swift', ['build', '-c', 'release'], { cwd: source, env, signal, timeout: 900_000 });
  }
  const built = join(source, '.build/release/siri-tts');
  await run('/usr/bin/codesign', ['--force', '--sign', '-', built], { signal });
  const folder = join(config.dataDir, 'bin');
  await mkdir(folder, { recursive: true, mode: 0o700 });
  const binary = join(folder, 'siri-tts');
  await copyFile(built, `${binary}.tmp`);
  await chmod(`${binary}.tmp`, 0o755);
  await rename(`${binary}.tmp`, binary);
  await copyFile(join(source, 'LICENSE'), join(folder, 'LICENSE.siri-tts-cli'));
  return binary;
}

export async function installSiriBinary(config: SiriConfig, signal: AbortSignal, run: SiriCommand = siriCommand): Promise<string> {
  await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
  const path = join(config.dataDir, 'install.lock');
  let lock;
  try { lock = await open(path, 'wx', 0o600); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    let alive = true;
    try {
      const pid = Number(await readFile(path, 'utf8'));
      if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Invalid lock');
      process.kill(pid, 0);
    } catch (cause) { alive = (cause as NodeJS.ErrnoException).code === 'EPERM'; }
    if (alive) throw new Error('Siri setup is already running in another Paper Tour process. Retry after it finishes.');
    await rm(path);
    lock = await open(path, 'wx', 0o600);
  }
  try { await lock.writeFile(String(process.pid)); return await buildSiriBinary(config, signal, run); }
  finally { await lock.close(); await rm(path, { force: true }); }
}
