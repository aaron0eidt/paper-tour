import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { ROOT } from '../config';
import type { TourImage } from '../tour-generator';
import { exactBounds, type MeasuredTarget } from './visual-grounding';

export type VisualTargetRunner = (image: string, signal?: AbortSignal) => Promise<unknown>;

/** Fixed local image analysis only; no model-authored code, shell, files, credentials or network. */
const runTargets: VisualTargetRunner = (image, signal) =>
  new Promise((accept, reject) => {
    const child = spawn(
      process.env.PYTHON_BIN ?? resolve(ROOT, 'ingest/.venv/bin/python'),
      [resolve(ROOT, 'ingest/visual_targets.py')],
      {
        stdio: ['pipe', 'pipe', 'pipe'],
        signal,
        timeout: 8_000,
        killSignal: 'SIGKILL',
        env: {
          PATH: process.env.PATH,
          LANG: 'en_US.UTF-8',
          OMP_THREAD_LIMIT: '1',
          ...(process.env.TESSDATA_PREFIX ? { TESSDATA_PREFIX: process.env.TESSDATA_PREFIX } : {}),
        },
      },
    );
    let output = '',
      error = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
      if (output.length > 1_000_000) child.kill('SIGKILL');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      if (error.length < 2_000) error += chunk.toString();
    });
    child.once('error', reject);
    child.once('close', (code) => {
      if (code !== 0 || output.length > 1_000_000)
        return reject(new Error(`Local visual analysis failed (${code ?? 'terminated'}): ${error.slice(0, 300)}`));
      try {
        accept(JSON.parse(output));
      } catch {
        reject(new Error('Local visual analysis returned invalid JSON'));
      }
    });
    child.stdin.on('error', () => {}); // A rejected/aborted process may close before reading.
    child.stdin.end(JSON.stringify({ image }));
  });

type Detected = Omit<MeasuredTarget, 'id' | 'target'>;
export function parseMeasuredTargets(value: unknown): Detected[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { targets?: unknown }).targets))
    throw new Error('Local visual analysis response needs a targets array');
  return (value as { targets: unknown[] }).targets
    .map((item): Detected => {
      if (!item || typeof item !== 'object') throw new Error('Local visual analysis returned an invalid target');
      const t = item as Record<string, unknown>;
      const region = exactBounds(t.region);
      if (!region || !['component', 'panel', 'text'].includes(String(t.kind)) || typeof t.label !== 'string')
        throw new Error('Local visual analysis returned invalid target geometry');
      return { kind: t.kind as Detected['kind'], region, label: t.label.replace(/\s+/g, ' ').trim().slice(0, 220) };
    })
    .slice(0, 80);
}

/** Bounded per-process cache; IDs are bound to the caller's source after hash lookup. */
export function createMeasuredFigureTargets(run: VisualTargetRunner = runTargets, capacity = 24) {
  const cache = new Map<string, Detected[]>();
  return async (image: TourImage, signal?: AbortSignal): Promise<MeasuredTarget[]> => {
    signal?.throwIfAborted();
    if (image.kind !== 'figure') return [];
    const match = /^data:image\/(?:png|jpeg|jpg);base64,([A-Za-z0-9+/=\s]+)$/.exec(image.dataUrl);
    if (!match || match[1].length > 12_000_000) throw new Error('Figure image is not a supported bounded PNG/JPEG');
    const key = createHash('sha256').update(match[1]).digest('hex');
    let detected = cache.get(key);
    if (!detected) {
      detected = parseMeasuredTargets(await run(match[1], signal));
      signal?.throwIfAborted();
      cache.set(key, detected);
      if (cache.size > capacity) cache.delete(cache.keys().next().value!);
    }
    signal?.throwIfAborted();
    return detected.map((t, i) => ({
      ...t,
      region: [...t.region],
      target: image.targetId,
      id: `measured:${image.targetId}:${i + 1}`,
    }));
  };
}

export const measuredFigureTargets = createMeasuredFigureTargets();
