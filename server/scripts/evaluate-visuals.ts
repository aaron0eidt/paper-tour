/** Deterministic, offline renderer/evidence evaluation. Never calls a paid model. */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { reviewProgram } from '../src/visuals/program-review';
import { renderProgramFrame } from '../src/visuals/program-runtime';
import { computePlotlyPython } from '../src/visuals/plotly-compute';
import { attention, backprop, measured } from '../test/fixtures/authored-visuals';
const output = resolve(process.argv[2] ?? '/tmp/paper-tour-live-visuals');
await mkdir(output, { recursive: true });
for (const [name, item] of Object.entries({ attention, backprop })) {
  const review = await reviewProgram(item);
  if (review.problems.length) throw Error(`${name}: ${review.problems.join('; ')}`);
  for (const frame of review.frames)
    await writeFile(resolve(output, `${name}-${frame.t}.png`), Buffer.from(frame.image.split(',')[1], 'base64'));
  await writeFile(resolve(output, `${name}-default.svg`), (await renderProgramFrame(item, 1)).svg);
  const changed = await renderProgramFrame(item, 1, name === 'attention' ? { score: 0 } : { weight: 1.5 });
  await writeFile(resolve(output, `${name}-changed.svg`), changed.svg);
  await writeFile(
    resolve(output, `${name}-evidence.json`),
    JSON.stringify(
      {
        code: item.code,
        parameters: item.parameters,
        frames: review.frames.map(({ image: _, ...frame }) => frame),
        changed: changed.calculations,
      },
      null,
      2,
    ),
  );
}
await writeFile(resolve(output, 'measured-plotly.json'), JSON.stringify(await computePlotlyPython(measured), null, 2));
console.log(
  `Rendered attention/backprop frames, live parameter revisions, calculation traces and measured Plotly JSON: ${output}`,
);
