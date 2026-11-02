import type { ProgramItem } from '../../../shared/program';
import type { ReadingPassage } from '../../../shared/reading';
import type { ProgramTheme } from '../../../shared/programRuntime';
import { readVisualTheme } from './theme';

const frames = new Map<string, string>();
let plotly: Promise<typeof import('plotly.js-dist-min')> | undefined;

/** The visible board and background preparation share the same module load. */
export function loadPlotly() {
  return plotly ??= import('plotly.js-dist-min').catch((error) => { plotly = undefined; throw error; });
}

export function preparedProgramFrame(item: ProgramItem, theme = readVisualTheme()): string | undefined {
  return frames.get(JSON.stringify([item, theme]));
}

/** Evaluate only the first frame, in the same isolated worker used for live playback. */
async function prepareProgram(item: ProgramItem, signal: AbortSignal, theme: ProgramTheme): Promise<void> {
  signal.throwIfAborted();
  const key = JSON.stringify([item, theme]);
  if (frames.has(key) || typeof Worker === 'undefined') return;
  await new Promise<void>((resolve, reject) => {
    const worker = new Worker(new URL('./program.worker.ts', import.meta.url), { type: 'module' });
    const finish = (error?: unknown) => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
      worker.terminate();
      error ? reject(error) : resolve();
    };
    const abort = () => finish(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('The illustration could not be prepared in time.')), 5_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('The illustration could not start.'));
    worker.onmessage = (event) => {
      if (event.data.error) return finish(new Error(event.data.error));
      if (signal.aborted) return abort();
      const svg = event.data.frame?.svg;
      if (typeof svg !== 'string') return finish(new Error('The illustration returned no frame.'));
      frames.set(key, `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`);
      // Bound decoded preview memory; full scene definitions remain in the durable reading cache.
      if (frames.size > 24) frames.delete(frames.keys().next().value!);
      finish();
    };
    worker.postMessage({ id: 0, item, t: 0, parameters: {}, theme });
  });
}

/** Native boards already carry their data. Authored scenes also warm a preview and their rendering assets. */
export async function prepareReadingVisuals(passage: ReadingPassage, signal: AbortSignal, theme = readVisualTheme()): Promise<void> {
  for (const action of passage.actions ?? []) {
    signal.throwIfAborted();
    if (action.type !== 'board') continue;
    if (action.item.kind === 'program') await prepareProgram(action.item, signal, theme);
    if (action.item.kind === 'plotly') await loadPlotly();
  }
  signal.throwIfAborted();
}
