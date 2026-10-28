import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT } from '../config';

// Checks the lines of a worked solution in code, not by the model that wrote them (notes/HARNESS.md, rule 7):
// ingest/verify_math.py evaluates each line numerically and says ok, failed (with the reason) or unknown.

export type LineStatus = 'ok' | 'failed' | 'unknown';
export interface LineCheck {
  status: LineStatus;
  problem?: string;
}
export type MathVerifier = (lines: string[], signal?: AbortSignal) => Promise<LineCheck[]>;

const STATUSES: LineStatus[] = ['ok', 'failed', 'unknown'];
const unknown = (lines: string[]): LineCheck[] => lines.map(() => ({ status: 'unknown' }));

/** The helper's answer for each line, or every line unknown when the helper fails or answers out of shape. */
export function readChecks(stdout: string, count: number): LineCheck[] | null {
  try {
    const lines = (JSON.parse(stdout) as { lines?: unknown }).lines;
    if (!Array.isArray(lines) || lines.length !== count) return null;
    return lines.map((line) => {
      const { status, problem } = (line ?? {}) as { status?: unknown; problem?: unknown };
      return {
        status: STATUSES.includes(status as LineStatus) ? (status as LineStatus) : 'unknown',
        ...(typeof problem === 'string' && problem ? { problem: problem.slice(0, 240) } : {}),
      };
    });
  } catch {
    return null;
  }
}

/** Runs ingest/verify_math.py with the ingestion venv's Python (PYTHON_BIN overrides it, as for ingestion). */
export function pythonVerifier(
  python = process.env.PYTHON_BIN ?? resolve(ROOT, 'ingest/.venv/bin/python'),
  timeoutMs = 15_000,
): MathVerifier {
  const script = resolve(ROOT, 'ingest/verify_math.py');
  return (lines, signal) =>
    new Promise((done) => {
      if (!lines.length) return done([]);
      const child = execFile(
        python,
        ['-I', script],
        { timeout: timeoutMs, maxBuffer: 1 << 20, ...(signal ? { signal } : {}) },
        (error, stdout) => done((!error && readChecks(stdout, lines.length)) || unknown(lines)),
      );
      child.stdin?.on('error', () => undefined);
      child.stdin?.end(JSON.stringify({ lines }));
    });
}
