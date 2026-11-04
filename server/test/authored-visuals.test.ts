import { sourceReferenceProblems } from '../src/visuals/model-author';
import test from 'node:test';
import assert from 'node:assert/strict';
import { renderProgramFrame, programRuntime } from '../src/visuals/program-runtime';
import { reviewProgram } from '../src/visuals/program-review';
import { inspectProgramSvg, renderProgramFrame as renderWithTheme, PROGRAM_THEME } from '../../shared/programRuntime';
import { programProblems } from '../../shared/program';
import { plotlyFigure, plotlyProblems } from '../../shared/plotly';
import { computePlotlyPython } from '../src/visuals/plotly-compute';
import { authorAndInspectVisual } from '../src/visuals/inspect';
import { mapTourVisuals } from '../../shared/visualArtifacts';
import type { Tour } from '../../shared/paper';
import { attention, backprop, measured } from './fixtures/authored-visuals';

test('isolated scene rendering accepts the active theme without changing computed quantities', async () => {
  const light = { ...PROGRAM_THEME, text: '#202735', panel: '#f0f3f8', blue: '#245bb9' };
  const frame = await renderWithTheme(attention, 1, programRuntime, {}, 100, light);
  const original = await renderProgramFrame(attention, 1);
  assert.deepEqual(frame.calculations, original.calculations);
  assert.ok(frame.svg.includes(light.text));
  assert.notEqual(frame.svg, original.svg);
});

test('attention program computes real softmax and updates its numerical example without mutating its source', async () => {
  const before = JSON.stringify(attention),
    frame = await renderProgramFrame(attention, 1);
  const output = frame.calculations.find((v) => v.label === 'output')?.value as number;
  assert.ok(Math.abs(output - 8.80797077978) < 1e-8);
  const changed = await renderProgramFrame(attention, 1, { score: 0 });
  assert.equal(changed.calculations.find((v) => v.label === 'output')?.value, 5);
  assert.notEqual(changed.svg, frame.svg);
  assert.equal(JSON.stringify(attention), before);
  assert.deepEqual(await renderProgramFrame(attention, 1), frame);
  assert.notEqual((await renderProgramFrame(attention, 0)).svg, frame.svg);
});
test('backprop visual computes both gradient paths and agrees with a finite difference', async () => {
  const frame = await renderProgramFrame(backprop, 1),
    gradient = frame.calculations.find((v) => v.label === 'gradient')?.value as number;
  const h = 1e-5;
  const prediction = async (weight: number) =>
    (await renderProgramFrame(backprop, 1, { weight })).calculations.find((v) => v.label === 'prediction')
      ?.value as number;
  assert.ok(Math.abs(gradient - ((await prediction(0.7 + h)) - (await prediction(0.7 - h))) / (2 * h)) < 1e-7);
  assert.match(frame.svg, /dy\/dw/);
});
test('sandbox has no application globals, network or clock, interrupts loops, and forbids nondeterministic frames', async () => {
  const code = `({svg})=>{if(typeof process!=='undefined'||typeof fetch!=='undefined'||typeof Date!=='undefined')throw Error('leak');return svg.scene(svg.text(30,30,'isolated'));}`;
  await renderProgramFrame({ ...attention, code }, 0);
  await assert.rejects(renderProgramFrame({ ...attention, code: '()=>{while(true){};}' }, 0), /interrupt/i);
  await assert.rejects(
    renderProgramFrame({ ...attention, code: '({svg})=>svg.scene(svg.text(20,20,Math.random()))' }, 0),
    /deterministic/i,
  );
  await assert.rejects(
    renderProgramFrame({ ...attention, code: '()=>new Array(10000000).fill(1).join("")' }, 0),
    /memory|allocation|interrupt/i,
  );
});
test('SVG is inert, valid, bounded and readable, including numeric-only labels', () => {
  for (const bad of [
    '<svg><script>alert(1)</script></svg>',
    '<svg><image href="https://x.test/a"/></svg>',
    '<svg><text onclick="x()">x</text></svg>',
    '<!DOCTYPE svg><svg/>',
    '<svg><foreignObject/></svg>',
  ])
    assert.ok(inspectProgramSvg(bad, programRuntime.parseSvg).problems.length, bad);
  assert.deepEqual(
    inspectProgramSvg(
      '<svg width="600" height="420" viewBox="0 0 600 420"><text x="20" y="20">123</text></svg>',
      programRuntime.parseSvg,
    ).problems,
    [],
  );
  assert.ok(programProblems({ ...attention, parameters: [null] }).length);
});
test('actual five-frame rendering returns usable PNG feedback and repairs reported runtime errors', async () => {
  const result = await reviewProgram(attention);
  assert.deepEqual(result.problems, []);
  assert.equal(result.frames.length, 5);
  assert.match(result.frames[0].image, /^data:image\/png;base64,/);
  let repairs = 0,
    reviews = 0;
  const fixed = await authorAndInspectVisual(
    { ...attention, code: '()=>{throw Error("bad matrix dimension")}' },
    {
      narration: 'Explain scaling',
      evidence: 'equation',
      repair: async (feedback) => {
        repairs++;
        assert.match(feedback.problems.join(' '), /bad matrix dimension/);
        return attention;
      },
      review: async (feedback) => {
        reviews++;
        assert.equal(feedback.frames.length, 5);
        return [];
      },
    },
  );
  assert.equal(fixed, attention);
  assert.equal(repairs, 1);
  assert.equal(reviews, 1);
});
test('measured figure preserves exact coordinates and safe function JSON agrees with bounded Python', async () => {
  assert.deepEqual(plotlyProblems(measured), []);
  assert.deepEqual(plotlyFigure(measured).data[0].y, [26.36, 27.3, 28.4]);
  const item = {
    ...measured,
    functions: [{ trace: 0, expression: 'softmax(x,a)', domain: [-4, 4] as [number, number], samples: 40 }],
    parameter: { name: 'offset', label: 'Other score', value: 2, min: 0, max: 4, step: 0.1 },
  };
  const figure = await computePlotlyPython(item);
  const expected = plotlyFigure(item).data[0].y as number[],
    actual = figure.data[0].y as number[];
  assert.ok(actual.every((v, i) => Math.abs(v - expected[i]) < 1e-12));
  assert.ok(
    plotlyProblems({
      ...measured,
      figure: JSON.stringify({ data: [{ type: 'scatter', text: ['<script>bad</script>'] }] }),
    }).length,
  );
});
test('artifact mapping forks references while original tour remains byte-identical', async () => {
  const tour: Tour = {
    schema: 'paper-tour/tour@0.1',
    paper: 'test',
    title: 'Test',
    chapters: [
      {
        id: 'c1',
        title: 'Concept',
        steps: [{ id: 's1', say: 'Explain', actions: [{ type: 'board', item: attention }] }],
      },
    ],
  };
  const original = JSON.stringify(tour),
    mapped = await mapTourVisuals(tour, async () => ({ id: 'visual-id', revision: 1 }));
  assert.equal(JSON.stringify(tour), original);
  assert.notEqual(mapped, tour);
  assert.equal(mapped.chapters[0].steps[0].actions[0].type, 'board');
  const action = mapped.chapters[0].steps[0].actions[0];
  assert.equal(action.type === 'board' && action.artifact?.revision, 1);
});

test('Plotly rejects resource-loading commands and relayout keys while accepting ordinary data labels', () => {
  const figure = JSON.parse(measured.figure);
  const withLayout = (layout: object) => ({ ...measured, figure: JSON.stringify({ ...figure, layout }) });
  for (const layout of [
    {
      updatemenus: [
        {
          type: 'buttons',
          buttons: [{ method: 'relayout', args: [{ 'images[0].source': '//attacker.example/pixel' }] }],
        },
      ],
    },
    { 'images[0].source': '//attacker.example/pixel' },
    { sliders: [{ steps: [{ method: 'relayout', args: ['images[0].source', '//attacker.example/pixel'] }] }] },
    { annotations: [{ text: '//attacker.example/pixel' }] },
    { title: { text: 'url(https:\\attacker.example/pixel)' } },
    { shapes: [{ source: 'https://attacker.example/pixel' }] },
  ])
    assert.ok(plotlyProblems(withLayout(layout)).length, JSON.stringify(layout));
  assert.deepEqual(plotlyProblems(withLayout({ title: { text: 'Training data: WMT14' } })), []);
  assert.ok(plotlyProblems({ ...measured, figure: JSON.stringify({ ...figure, frames: [] }) }).length);
});

test('document visual references are grounded deterministically before model review', () => {
  assert.deepEqual(sourceReferenceProblems(measured, ['table-results']), []);
  assert.match(sourceReferenceProblems(measured, ['other-table']).join(' '), /Unknown PDF source reference/);
  assert.match(
    sourceReferenceProblems({ ...measured, sourceRefs: [] }, ['table-results']).join(' '),
    /need actual sourceRefs/,
  );
});

test('hostile SVG dimensions are rejected before any raster allocation', () => {
  for (const attrs of [
    'width="1" height="1000000000" viewBox="0 0 1 1000000000"',
    'width="600" height="420" viewBox="0 0 0 420"',
    'width="NaN" height="420" viewBox="0 0 600 420"',
    'width="600" height="420" viewBox="0 0 600 1000000000"',
  ]) {
    const inspection = inspectProgramSvg(
      `<svg ${attrs}><text x="20" y="20">test</text></svg>`,
      programRuntime.parseSvg,
    );
    assert.ok(
      inspection.problems.some((problem) => problem.includes('dimensions')),
      attrs,
    );
    assert.equal(inspection.canvas, undefined);
  }
});

test('named array data errors expose the actual runtime contract for targeted repair', async () => {
  const broken = {
    ...attention,
    code: `({data,math,svg})=>{const values=data.values.values||data.values;const mean=values.map(x=>x/2);math.record('mean',mean);return svg.scene(svg.text(30,40,mean.join(',')));}`,
  };
  await assert.rejects(renderProgramFrame(broken, 0), /use data\[name\] directly.*iterator method/);
  let repairs = 0;
  const repaired = await authorAndInspectVisual(broken, {
    narration: 'Halve the values.',
    evidence: 'Illustrative input.',
    repair: async (feedback) => {
      repairs++;
      assert.match(feedback.problems.join(';'), /use data\[name\] directly/);
      return { ...broken, code: broken.code.replace('data.values.values||data.values', 'data.values') };
    },
  });
  assert.equal(repairs, 1);
  if (repaired.kind !== 'program') throw Error('Expected the repaired program');
  const frame = await renderProgramFrame(repaired, 1);
  assert.deepEqual(frame.calculations, [{ label: 'mean', value: [5, 0] }]);
});

test('rendered visual repairs can improve past three inspections without dropping the visual', async () => {
  let repairs = 0;
  const scene = (n: number) => ({ ...attention, code: `({svg})=>svg.scene(svg.text(30,40,'Revision ${n}'))` });
  const result = await authorAndInspectVisual(scene(0), {
    narration: 'Explain the mechanism.',
    evidence: 'Illustrative.',
    review: async (feedback) => (feedback.attempt < 4 ? ['Move the label clear of the current object.'] : []),
    repair: async () => scene(++repairs),
  });
  assert.equal(repairs, 4);
  assert.match(result.kind === 'program' ? result.code : '', /Revision 4/);
});

test('rendered visual repairs stop an unchanged failed state and respect cancellation', async () => {
  let repairs = 0;
  await assert.rejects(
    authorAndInspectVisual(attention, {
      narration: 'Explain.',
      evidence: 'Illustrative.',
      review: async () => ['A label still overlaps.'],
      repair: async () => {
        repairs++;
        return attention;
      },
    }),
    /same failed rendered state/,
  );
  assert.equal(repairs, 2);
  const stop = new AbortController();
  stop.abort();
  await assert.rejects(
    authorAndInspectVisual(attention, {
      narration: 'Explain.',
      evidence: 'Illustrative.',
      signal: stop.signal,
      repair: async () => {
        throw Error('Must not repair after cancellation');
      },
    }),
    { name: 'AbortError' },
  );
});
