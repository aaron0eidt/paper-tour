import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

interface RasterPreview {
  png: string;
  bounds?: { x: number; y: number; width: number; height: number };
  width: number;
  height: number;
}
/** Native rasterization runs in a killable process with no credentials, bounded I/O and a real wall-clock budget. */
export function rasterProgram(svg: string, signal?: AbortSignal): Promise<RasterPreview> {
  return new Promise((accept, reject) => {
    const server = fileURLToPath(new URL('../../', import.meta.url));
    const child = execFile(
      process.execPath,
      [
        '--import',
        resolve(server, 'node_modules/tsx/dist/loader.mjs'),
        fileURLToPath(new URL('./program-raster.ts', import.meta.url)),
      ],
      {
        timeout: 5000,
        killSignal: 'SIGKILL',
        maxBuffer: 6 * 1024 * 1024,
        signal,
        env: { PATH: process.env.PATH, LANG: 'C.UTF-8' },
        cwd: server,
      },
      (error, stdout) => {
        if (error) return reject(new Error('Scene rasterization failed or exceeded its five-second budget.'));
        try {
          accept(JSON.parse(stdout) as RasterPreview);
        } catch {
          reject(new Error('Scene rasterization returned invalid output.'));
        }
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(JSON.stringify({ svg }));
  });
}
