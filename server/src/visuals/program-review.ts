import { rasterProgram } from './raster';
import type { ProgramItem } from '../../../shared/program';
import { inspectProgramSvg } from '../../../shared/programRuntime';
import { programRuntime, renderProgramFrame } from './program-runtime';

export interface RenderedProgramFrame {
  t: number;
  image: string;
  labels: string[];
  calculations: { label: string; value: number | number[] }[];
}
export interface ProgramReview {
  problems: string[];
  frames: RenderedProgramFrame[];
}

/** Actual execution and rasterization before publication. The author receives these same rendered frames for repair. */
export async function reviewProgram(item: ProgramItem, signal?: AbortSignal): Promise<ProgramReview> {
  const frames: RenderedProgramFrame[] = [],
    problems: string[] = [];
  for (const t of [0, 0.25, 0.5, 0.75, 1]) {
    signal?.throwIfAborted();
    try {
      const frame = await renderProgramFrame(item, t);
      const inspection = inspectProgramSvg(frame.svg, programRuntime.parseSvg);
      if (inspection.problems.length || !inspection.canvas) throw new Error(inspection.problems.join('; '));
      const preview = await rasterProgram(frame.svg, signal);
      const bounds = preview.bounds;
      if (!bounds || bounds.width < 2 || bounds.height < 2) problems.push(`Frame ${t}: nothing visible was drawn.`);
      if (
        bounds &&
        (bounds.x < -2 ||
          bounds.y < -2 ||
          bounds.x + bounds.width > preview.width + 2 ||
          bounds.y + bounds.height > preview.height + 2)
      )
        problems.push(`Frame ${t}: scene content crosses the canvas edge. Add margins or rescale geometry.`);
      frames.push({
        t,
        image: `data:image/png;base64,${preview.png}`,
        labels: inspection.labels,
        calculations: frame.calculations,
      });
    } catch (error) {
      problems.push(`Frame ${t}: ${error instanceof Error ? error.message : 'render failed'}`);
      break;
    }
  }
  return { problems: [...new Set(problems)], frames };
}
