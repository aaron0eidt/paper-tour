/** Private fixed-function raster subprocess. No application environment or authored JS is loaded here. */
import { Resvg } from '@resvg/resvg-js';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { inspectProgramSvg, programRasterSize } from '../../../shared/programRuntime';
let input = '';
for await (const chunk of process.stdin) {
  input += String(chunk);
  if (input.length > 1300000) throw Error('SVG exceeds raster input budget');
}
const { svg } = JSON.parse(input) as { svg: string };
const inspection = inspectProgramSvg(svg, (source) => {
  if (XMLValidator.validate(source) !== true) throw Error('Invalid SVG');
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    preserveOrder: true,
    parseTagValue: false,
    processEntities: true,
  }).parse(source);
});
if (inspection.problems.length || !inspection.canvas) throw Error(inspection.problems.join('; '));
const size = programRasterSize(inspection.canvas);
const renderer = new Resvg(svg, {
  fitTo: { mode: inspection.canvas.width >= inspection.canvas.height ? 'width' : 'height', value: 900 },
  background: '#10131b',
  font: { defaultFontFamily: 'Arial' },
});
const image = renderer.render();
if (image.width > size.width || image.height > size.height || image.width * image.height > 810000)
  throw Error('Unexpected raster surface size');
console.log(
  JSON.stringify({
    png: image.asPng().toString('base64'),
    bounds: renderer.getBBox(),
    width: renderer.width,
    height: renderer.height,
  }),
);
