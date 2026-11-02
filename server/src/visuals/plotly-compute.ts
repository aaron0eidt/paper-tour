import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { ROOT } from '../config';
import { parseExpression } from '../../../shared/plot';
import { plotlyProblems, type PlotlyFigure, type PlotlyItem } from '../../../shared/plotly';

/** Fixed Python math/figure contract, not an arbitrary Python-code sandbox. Credentials are absent. */
export function computePlotlyPython(
  item: PlotlyItem,
  parameter = item.parameter?.value ?? 1,
  signal?: AbortSignal,
): Promise<PlotlyFigure> {
  const problems = plotlyProblems(item);
  if (problems.length) return Promise.reject(new Error(problems.join('; ')));
  return new Promise((accept, reject) => {
    const child = execFile(
      process.env.PYTHON_BIN ?? 'python3',
      ['-I', resolve(ROOT, 'ingest/plotly_compute.py')],
      { timeout: 5000, maxBuffer: 1 << 20, signal, env: { PATH: process.env.PATH, LANG: 'C.UTF-8' } },
      (error, stdout) => {
        if (error) return reject(new Error('Bounded Python figure computation failed.'));
        try {
          const figure = JSON.parse(stdout) as PlotlyFigure;
          if (!Array.isArray(figure.data)) throw Error('Missing figure data');
          accept(figure);
        } catch {
          reject(new Error('Python returned invalid figure data.'));
        }
      },
    );
    child.stdin?.on('error', () => {});
    child.stdin?.end(
      JSON.stringify({
        figure: JSON.parse(item.figure),
        parameter,
        functions: item.functions.map((fn) => ({ ...fn, tree: parseExpression(fn.expression) })),
      }),
    );
  });
}
