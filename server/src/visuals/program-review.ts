import { Resvg } from '@resvg/resvg-js';
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
      const renderer = new Resvg(frame.svg, {
        fitTo: { mode: 'width', value: 900 },
        background: '#10131b',
        font: { defaultFontFamily: 'Arial' },
      });
      const bounds = renderer.getBBox();
      if (!bounds || bounds.width < 2 || bounds.height < 2) problems.push(`Frame ${t}: nothing visible was drawn.`);
      if (
        bounds &&
        (bounds.x < -2 ||
          bounds.y < -2 ||
          bounds.x + bounds.width > renderer.width + 2 ||
          bounds.y + bounds.height > renderer.height + 2)
      )
        problems.push(`Frame ${t}: scene content crosses the canvas edge. Add margins or rescale geometry.`);
      const png = renderer.render().asPng();
      frames.push({
        t,
        image: `data:image/png;base64,${png.toString('base64')}`,
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
