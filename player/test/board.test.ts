// Board tests: item checks, flow layout and geometry, term wrapping, bars and easing. Run with
// `npm test` (esbuild bundles this file for Node, no test framework needed).

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import katex from '../src/tex';
import { FormulaBoard, formulaModel, workingModel } from '../src/components/FormulaBoard';
import {
  BOARD_INK,
  BOARD_PALETTE,
  WORKING_SHOWN,
  barClip,
  barFrameSource,
  boardFrameColors,
  continuesWorking,
  continuousBoardFrame,
  interpolateBars,
  plotCursor,
  sourceTag,
  barPath,
  barsLayout,
  barStandsOut,
  barsUnit,
  checkBoardItem,
  cubicBezier,
  decimalsOf,
  fitText,
  FLOW_FONT,
  FLOW_MIN_SCALE,
  FLOW_SMALL_SCALE,
  flowGeometry,
  flowLayout,
  formatValue,
  termColor,
  workingLines,
  twoLineWidth,
  wrapLabel,
  wrapTerms,
} from '../src/board';
import type { BarsItem, FlowItem, FormulaItem } from '../src/board';
import {
  HEATMAP_TIMING,
  cellLook,
  contrast,
  gridLayout,
  heatmapDomain,
  heatmapAlt,
  heatmapEnd,
  heatmapInk,
  heatmapLegend,
  heatmapLevel,
  heatmapModel,
  heatmapPlaces,
  heatmapRamp,
  heatmapRgb,
  heatmapText,
  labelBlock,
  linkLook,
  linksLayout,
  luminance,
  morphProgress,
  rowMorph,
  rowShown,
} from '../src/heatmap';
import type { HeatmapItem } from '../../shared/heatmap';
import type { BoardItem } from '../src/types';
import type { SceneItem } from '../../shared/scene';
import { sceneMatrixText } from '../../shared/scene';
import { interpolateScene, projectSceneObject, sceneArrow, sceneInk, sceneNumber, sceneObjects, sceneTransitionAllowed } from '../src/sceneBoard';

const results: string[] = [];
let failures = 0;
function test(name: string, fn: () => void) {
  try {
    fn();
    results.push(`  ok    ${name}`);
  } catch (error) {
    failures++;
    results.push(`  FAIL  ${name}\n        ${(error as Error).message}`);
  }
}
function eq(actual: unknown, expected: unknown, what = 'value') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${what}: expected ${e}, got ${a}`);
}
function ok(condition: boolean, what: string) {
  if (!condition) throw new Error(what);
}

const warnings: string[] = [];
const warn = (message: string) => void warnings.push(message);
// About 7px a character, like a 13px label.
const measure = (text: string) => text.length * 7;
// The flow labels as drawn: 15px Inter 500 is about 8.3px a character.
const measureFlow = (text: string) => text.length * 8.3;
// The parse check the board uses, with KaTeX itself.
const parses = (latex: string) => {
  try {
    katex.renderToString(latex, {
      displayMode: true,
      throwOnError: true,
      strict: 'ignore',
      trust: (context) => context.command === '\\htmlClass',
    });
    return true;
  } catch {
    return false;
  }
};
const chain = (n: number): FlowItem => ({
  kind: 'flow',
  nodes: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, label: `Step ${i}` })),
  edges: Array.from({ length: n - 1 }, (_, i): [string, string] => [`n${i}`, `n${i + 1}`]),
});
const bleu: BarsItem = {
  kind: 'bars',
  unit: 'BLEU',
  higher_is_better: true,
  bars: [
    { label: 'Transformer (big)', value: 28.4 },
    { label: 'Transformer (base)', value: 27.3 },
    { label: 'ConvS2S', value: 25.16 },
  ],
};

// ------------------------------------------------------------------- checks

test('a formula keeps the terms that are part of it, with valid colours only', () => {
  const item = checkBoardItem(
    {
      kind: 'formula',
      title: 'Sum',
      latex: 'a + b',
      terms: [
        { latex: 'a', label: 'first', color: 'blue' },
        { latex: 'c', label: 'not in the formula' },
        { latex: 'b', label: 'second', color: 'purple' },
        'junk',
      ],
    },
    'step "s"',
    warn,
  );
  eq(item, {
    kind: 'formula',
    title: 'Sum',
    latex: 'a + b',
    terms: [
      { latex: 'a', label: 'first', color: 'blue' },
      { latex: 'b', label: 'second' },
    ],
  });
});

test('items that cannot be drawn are skipped with a warning', () => {
  warnings.length = 0;
  eq(checkBoardItem({ kind: 'formula', latex: '  ', terms: [] }, 'step "s"', warn), null, 'empty formula');
  eq(checkBoardItem({ kind: 'flow', nodes: [{ id: 'a', label: 'A' }], edges: [] }, 'step "s"', warn), null, 'one box');
  const oneBar = { kind: 'bars', bars: [{ label: 'x', value: 1 }, { label: 'y', value: Number.NaN }] };
  eq(checkBoardItem(oneBar, 'step "s"', warn), null, 'one number');
  eq(checkBoardItem({ kind: 'video' }, 'step "s"', warn), null, 'unknown kind');
  eq(checkBoardItem(null, 'step "s"', warn), null, 'missing');
  eq(warnings.length, 5, 'warnings');
  ok(warnings[3].includes('"video"') && warnings[3].includes('step "s"'), 'names the kind and the step');
});

test('a flow drops boxes without labels, edges to unknown boxes and self-loops', () => {
  const item = checkBoardItem(
    {
      kind: 'flow',
      nodes: [{ id: 'a', label: 'A', color: 'green' }, { id: 'b', label: 'B' }, { id: 'c', label: ' ' }],
      edges: [['a', 'b'], ['a', 'a'], ['b', 'c'], ['a'], 'x'],
    },
    'here',
    warn,
  );
  eq(item, { kind: 'flow', nodes: [{ id: 'a', label: 'A', color: 'green' }, { id: 'b', label: 'B' }], edges: [['a', 'b']] });
});

test('bars keep their unit and direction and drop values that are not numbers', () => {
  const item = checkBoardItem(
    { kind: 'bars', unit: '%', higher_is_better: false, bars: [{ label: 'a', value: 2 }, { label: 'b', value: '3' }, { label: 'c', value: 1 }] },
    'here',
    warn,
  );
  eq(item, { kind: 'bars', unit: '%', higher_is_better: false, bars: [{ label: 'a', value: 2 }, { label: 'c', value: 1 }] });
});

test('term colours: their own, else the palette in order, cycling past its end', () => {
  eq(termColor({ latex: 'x', label: 'x', color: 'pink' }, 0), 'pink');
  eq([0, 1, 5].map((i) => termColor({ latex: 'x', label: 'x' }, i)), ['blue', 'orange', 'blue']);
  eq(BOARD_PALETTE.every((c) => BOARD_INK[c] === `var(--canvas-${c})`), true, 'theme ink for every semantic colour');
});

// ------------------------------------------------------------------- flows

test('flow columns: one right of the furthest predecessor, rows in listed order', () => {
  eq(flowLayout(chain(3)), [[0, 0], [1, 0], [2, 0]], 'chain');
  const branch: FlowItem = { kind: 'flow', nodes: chain(3).nodes, edges: [['n0', 'n1'], ['n0', 'n2']] };
  eq(flowLayout(branch), [[0, 0], [1, 0], [1, 1]], 'branch');
  const cycle: FlowItem = { kind: 'flow', nodes: chain(2).nodes, edges: [['n0', 'n1'], ['n1', 'n0']] };
  eq(flowLayout(cycle), [[0, 0], [1, 0]], 'the cycle is cut');
});

test('a flow runs down a tall board and across a wide one', () => {
  const tall = flowGeometry(chain(6), { width: 380, height: 700 }, measure);
  eq([tall.vertical, tall.scale], [true, 1], 'tall');
  ok(tall.nodes.every((n, i) => i === 0 || (n.y > tall.nodes[i - 1].y && n.x === tall.nodes[0].x)), 'stacked');
  const wide = flowGeometry(chain(4), { width: 900, height: 220 }, measure);
  eq([wide.vertical, wide.scale], [false, 1], 'wide');
  ok(wide.nodes.every((n, i) => i === 0 || n.x > wide.nodes[i - 1].x), 'in a row');
  for (const g of [tall, wide]) {
    ok(g.nodes.every((n) => n.x >= 0 && n.y >= 0 && n.x + n.w <= g.width && n.y + n.h <= g.height), 'inside');
    ok(g.edges.length === g.nodes.length - 1 && g.edges.every((e) => e.d.startsWith('M') && e.head.includes('L')), 'edges');
  }
});

test('a flow that does not fit is scaled down, never up, and never below readable', () => {
  // A fork, which cannot wind into rows like a chain: its two boxes side by side need 260px.
  const fork: FlowItem = { kind: 'flow', nodes: chain(4).nodes, edges: [['n0', 'n1'], ['n1', 'n2'], ['n1', 'n3']] };
  const g = flowGeometry(fork, { width: 250, height: 300 }, measure);
  eq(g.scale, 1, 'a small board spends less on air, so the fork fits');
  const tight = flowGeometry(fork, { width: 400, height: 100 }, measure);
  ok(tight.scale < 1 && tight.scale >= FLOW_SMALL_SCALE, `scale ${tight.scale}`);
  ok(tight.width * tight.scale <= 400.01 && tight.height * tight.scale <= 100.01, 'fits');
  const roomy = flowGeometry(fork, { width: 400, height: 300 }, measure);
  eq(roomy.scale, 1, 'a roomier board fits it too');
  eq(flowGeometry(chain(10), { width: 400, height: 400 }, measure).scale, FLOW_MIN_SCALE, 'scrolls instead');
  eq(flowGeometry(chain(2), { width: 1000, height: 1000 }, measure).scale, 1, 'never up');
});

test('a small board shrinks the flow to fit before it scrolls', () => {
  // A phone or a short strip under the stage: scrolling there would hide boxes, so the 14px floor gives way to FLOW_SMALL_SCALE.
  const fork: FlowItem = { kind: 'flow', nodes: chain(4).nodes, edges: [['n0', 'n1'], ['n1', 'n2'], ['n1', 'n3']] };
  for (const box of [{ width: 200, height: 220 }, { width: 240, height: 150 }, { width: 180, height: 600 }]) {
    const g = flowGeometry(fork, box, measure);
    ok(g.scale >= FLOW_SMALL_SCALE && g.scale < FLOW_MIN_SCALE, `${box.width}x${box.height}: scale ${g.scale}`);
    ok(g.width * g.scale <= box.width + 0.01 && g.height * g.scale <= box.height + 0.01, `${box.width}x${box.height}: fits`);
  }
  eq(flowGeometry(chain(10), { width: 200, height: 200 }, measure).scale, FLOW_SMALL_SCALE, 'only a flow past even that scrolls');
  // A board with room keeps the floor.
  ok(flowGeometry(fork, { width: 400, height: 260 }, measure).scale >= FLOW_MIN_SCALE, 'roomy boards keep labels near 15px');
});

test('no word of a label is cut at the sizes a board really has, with the labels measured as drawn', () => {
  const training: FlowItem = {
    kind: 'flow',
    nodes: ['Training batch', 'Model', 'Cross-entropy loss', 'Gradients', 'Predictions'].map((label, i) => ({ id: `n${i}`, label })),
    edges: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n3'], ['n3', 'n1'], ['n1', 'n4']],
  };
  const paths: FlowItem = {
    kind: 'flow',
    nodes: ['Random item', 'Machine A branch', 'Machine B branch', 'Defective paths', 'Add contributions', 'Band-limited signal'].map((label, i) => ({ id: `n${i}`, label })),
    edges: [['n0', 'n1'], ['n0', 'n2'], ['n1', 'n3'], ['n2', 'n3'], ['n3', 'n4'], ['n4', 'n5']],
  };
  const words = (item: FlowItem) => item.nodes.flatMap((n) => n.label.split(/\s+/));
  // A desktop side board, a narrow one, a tablet strip, a phone, and a wide one.
  for (const box of [{ width: 389, height: 529 }, { width: 328, height: 529 }, { width: 231, height: 437 }, { width: 732, height: 253 }, { width: 339, height: 600 }, { width: 1000, height: 340 }]) {
    for (const item of [training, paths]) {
      const g = flowGeometry(item, box, measureFlow);
      const label = `${item.nodes.length} boxes in ${box.width}x${box.height}`;
      ok(g.nodes.every((n) => n.lines.every((l) => !l.endsWith('…'))), `${label}: ${g.nodes.flatMap((n) => n.lines).filter((l) => l.endsWith('…')).join(', ')} cut`);
      ok(words(item).every((w) => g.nodes.some((n) => n.lines.some((l) => l.includes(w)))), `${label}: every word shown`);
      ok(g.nodes.every((n) => n.lines.every((l) => measureFlow(l) <= n.w - 24 + 0.01)), `${label}: every line inside its box`);
      ok(g.scale >= FLOW_SMALL_SCALE, `${label}: scale ${g.scale}`);
    }
  }
  // The box is never narrower than its widest word, even in a room that is: the layout scales to fit instead.
  const g = flowGeometry(training, { width: 328, height: 529 }, measureFlow);
  ok(g.nodes[0].w >= measureFlow('Cross-entropy') + 24, `box ${g.nodes[0].w}px holds the word`);
  ok(g.scale < 1 && g.scale >= FLOW_SMALL_SCALE && g.width * g.scale <= 328.01, `scaled to fit: ${g.scale}`);
});

test('a chain too long for a short, wide board winds into rows instead of shrinking', () => {
  const g = flowGeometry(chain(6), { width: 480, height: 200 }, measure);
  eq(g.scale, 1, 'no shrinking');
  const rows = [...new Set(g.nodes.map((n) => n.y))];
  eq(rows.length, 2, 'two rows');
  const [top, bottom] = [g.nodes.slice(0, 3), g.nodes.slice(3)];
  ok(top.every((n, i) => i === 0 || n.x > top[i - 1].x), 'the first row runs left to right');
  ok(bottom.every((n, i) => i === 0 || n.x < bottom[i - 1].x), 'the second runs back');
  eq(bottom[0].x, top[2].x, 'the turn goes straight down');
  ok(g.nodes.every((n) => n.x >= 0 && n.y >= 0 && n.x + n.w <= g.width && n.y + n.h <= g.height), 'inside');
  ok(g.width <= 480 && g.height <= 200, 'fits');
  // Its arrows: along the first row, down at the turn, and back along the second.
  const heads = g.edges.map((e) => e.head.match(/-?\d+(\.\d+)?/g)!.map(Number));
  const dir = (h: number[]) => (h[2] > h[0] && h[2] > h[4] ? 'right' : h[2] < h[0] && h[2] < h[4] ? 'left' : 'down');
  eq(heads.map(dir), ['right', 'right', 'down', 'left', 'left']);
  // A board that fits the chain either way keeps it straight, and so does a branching flow.
  eq(flowGeometry(chain(6), { width: 380, height: 700 }, measure).nodes.every((n, _, all) => n.x === all[0].x), true);
  const edges = [['n0', 'n1'], ['n0', 'n2'], ['n1', 'n3'], ['n3', 'n4'], ['n4', 'n5']] as [string, string][];
  const branch: FlowItem = { kind: 'flow', nodes: chain(6).nodes, edges };
  ok(new Set(flowGeometry(branch, { width: 480, height: 200 }, measure).nodes.map((n) => n.y)).size !== 2, 'not wound');
});

test('a short, wide board of phone width winds the chain and draws it inside the board', () => {
  const g = flowGeometry(chain(6), { width: 390, height: 200 }, measure);
  eq([...new Set(g.nodes.map((n) => n.y))].length, 2, 'two rows');
  ok(g.scale >= FLOW_SMALL_SCALE && g.scale * FLOW_FONT >= 10.5, `labels at ${g.scale * FLOW_FONT}px`);
  ok(g.width * g.scale <= 390.01 && g.height * g.scale <= 200.01, `drawn ${g.width * g.scale}x${g.height * g.scale}, inside the board`);
});

test('on a phone-sized board the flow trades air for label size', () => {
  const diamond: FlowItem = {
    kind: 'flow',
    nodes: ['all positions', 'attend pos1', 'attend pos2', 'together once'].map((label, i) => ({ id: `n${i}`, label })),
    edges: [['n0', 'n1'], ['n0', 'n2'], ['n1', 'n3'], ['n2', 'n3']],
  };
  const g = flowGeometry(diamond, { width: 339, height: 150 }, measureFlow);
  ok(g.width * g.scale <= 339.01 && g.height * g.scale <= 150.01, `drawn ${g.width * g.scale}x${g.height * g.scale}, inside the board`);
  ok(g.scale * FLOW_FONT >= 12.5, `labels at ${g.scale * FLOW_FONT}px`);
  ok(g.nodes.every((n) => n.lines.every((l) => !l.endsWith('…'))), 'nothing cut');
  const roomy = flowGeometry(diamond, { width: 600, height: 400 }, measureFlow);
  ok(roomy.nodes[0].w > g.nodes[0].w, 'a board with room keeps the wider boxes');
});

test('a back edge loops beside the boxes instead of through them', () => {
  const item: FlowItem = { kind: 'flow', nodes: chain(3).nodes, edges: [['n0', 'n1'], ['n1', 'n2'], ['n2', 'n0']] };
  const g = flowGeometry(item, { width: 380, height: 600 }, measure);
  const back = g.edges[2];
  const xs = trace(back.d).map(([x]) => x);
  ok(Math.max(...xs) > g.nodes[0].x + g.nodes[0].w + 10, 'loops to the right');
  ok(Math.max(...xs) <= g.width, 'within the drawing');
});

/** Points along a path of M, C and L commands. */
function trace(d: string): [number, number][] {
  const n = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const pts: [number, number][] = [];
  let [x, y] = [n[0], n[1]];
  let i = 2;
  for (const c of d.replace(/[^MCL]/g, '').slice(1)) {
    if (c === 'L') {
      pts.push([(x = n[i]), (y = n[i + 1])]);
      i += 2;
      continue;
    }
    for (let s = 0; s <= 20; s++) {
      const t = s / 20;
      const u = 1 - t;
      const b = [u * u * u, 3 * u * u * t, 3 * u * t * t, t * t * t];
      const at = (p0: number, k: number) => b[0] * p0 + b[1] * n[i + k] + b[2] * n[i + k + 2] + b[3] * n[i + k + 4];
      pts.push([at(x, 0), at(y, 1)]);
    }
    [x, y] = [n[i + 4], n[i + 5]];
    i += 6;
  }
  return pts;
}

test('a loop back passes outside every box on its way, also in a wider rank', () => {
  // A training loop: the model feeds the loss and the predictions side by side, and the
  // gradients loop back to the model past both.
  const item: FlowItem = {
    kind: 'flow',
    nodes: ['data', 'model', 'loss', 'grad', 'pred'].map((id) => ({ id, label: id })),
    edges: [['data', 'model'], ['model', 'loss'], ['loss', 'grad'], ['grad', 'model'], ['model', 'pred']],
  };
  for (const box of [{ width: 380, height: 640 }, { width: 900, height: 240 }]) {
    const g = flowGeometry(item, box, measure);
    const back = trace(g.edges[3].d).slice(3, -3); // its middle, clear of the ends at its boxes
    const hits = g.nodes.filter((n) => back.some(([x, y]) => x > n.x && x < n.x + n.w && y > n.y && y < n.y + n.h));
    eq(hits.length, 0, `${g.vertical ? 'down' : 'across'}: boxes crossed`);
    ok(back.every(([x, y]) => x <= g.width && y <= g.height), 'within the drawing');
  }
  // Listed against the flow, two boxes share a rank: the arrow goes straight across.
  const twin: FlowItem = { kind: 'flow', nodes: chain(2).nodes, edges: [['n1', 'n0']] };
  const g = flowGeometry(twin, { width: 380, height: 640 }, measure);
  ok(/^M[\d. ]+L[\d. ]+$/.test(g.edges[0].d), `straight: ${g.edges[0].d}`);
});

test('labels wrap by words and end in an ellipsis when they run out of lines', () => {
  eq(wrapLabel('Linear + softmax', 200, measure), ['Linear + softmax']);
  eq(wrapLabel('Multi-head attention block', 100, measure), ['Multi-head', 'attention', 'block']);
  const long = wrapLabel('one two three four five six seven', 40, measure, 2);
  eq(long.length, 2, 'two lines');
  ok(long[1].endsWith('…') && measure(long[1]) <= 40, `ellipsis: ${long[1]}`);
  // A cut label keeps as much as fits with its ellipsis: 'Transform…' is exactly 70px here.
  eq([fitText('ByteNet', 100, measure), fitText('Transformer (big)', 70, measure)], ['ByteNet', 'Transform…']);
  eq(fitText('Transformer (big)', 69, measure), 'Transfor…', 'one pixel less, one letter less');
});

test('a label wraps to two lines before anything is cut', () => {
  // 154px on one line; the box is made as wide as two lines of it need, so nothing ends in an ellipsis.
  eq(twoLineWidth('Compare required ratio', measure), 100, 'Compare / required ratio');
  eq(twoLineWidth('Random item', measure), 42, 'two short words: the longer one');
  eq(twoLineWidth('Convert', measure), 49, 'one word: its own width');
  const item: FlowItem = {
    kind: 'flow',
    nodes: [{ id: 'a', label: 'Convert to moles' }, { id: 'b', label: 'Compare required ratio' }, { id: 'c', label: 'Find limiting reactant' }],
    edges: [['a', 'b'], ['b', 'c']],
  };
  for (const box of [{ width: 392, height: 640 }, { width: 1000, height: 340 }, { width: 300, height: 640 }]) {
    const g = flowGeometry(item, box, measure);
    ok(g.nodes.every((n) => n.lines.length <= 2), `two lines at most in ${box.width}x${box.height}`);
    ok(g.nodes.every((n) => n.lines.every((l) => !l.endsWith('…'))), 'nothing cut');
    ok(g.nodes.every((n) => n.lines.every((l) => measure(l) <= n.w)), 'every line inside its box');
    const padY = box.width < 360 || box.height < 240 ? 22 : 28;
    ok(g.nodes.every((n) => n.h === n.lines.length * 20 + padY), 'the box is as tall as its lines');
  }
  // A label that fits on one line at the widest box stays on one line: the box grows to hold it.
  const column = flowGeometry(item, { width: 392, height: 640 }, measure);
  eq(column.nodes.map((n) => n.lines.length), [1, 1, 1], 'one line each down a side board');
  ok(column.nodes[0].w >= 190, `the box holds the longest label: ${column.nodes[0].w}px`);
  // Side by side two boxes have half the room: the longest label wraps, the others still need one line only if they fit.
  const pair: FlowItem = { kind: 'flow', nodes: item.nodes, edges: [['a', 'c'], ['b', 'c']] };
  const narrow = flowGeometry(pair, { width: 330, height: 640 }, measure);
  ok(narrow.nodes[1].lines.length === 2 && narrow.nodes.every((n) => n.lines.length <= 2), 'two lines where one does not fit');
  ok(narrow.nodes.every((n) => n.x >= 0 && n.x + n.w <= narrow.width), 'inside');
});

test('a flow uses its board: readable boxes, a drawing that fills it, labels near their size', () => {
  const diamond: FlowItem = {
    kind: 'flow',
    nodes: ['Random item', 'Machine A branch', 'Machine B branch', 'Defective paths', 'Add contributions'].map((label, i) => ({ id: `n${i}`, label })),
    edges: [['n0', 'n1'], ['n0', 'n2'], ['n1', 'n3'], ['n2', 'n3'], ['n3', 'n4']],
  };
  for (const box of [{ width: 392, height: 640 }, { width: 440, height: 560 }, { width: 680, height: 800 }, { width: 1000, height: 340 }, { width: 900, height: 300 }]) {
    for (const item of [chain(4), chain(5), diamond]) {
      const g = flowGeometry(item, box, measure);
      const label = `${item.nodes.length} boxes in ${box.width}x${box.height}`;
      ok(g.scale * FLOW_FONT >= 13.9, `${label}: labels at ${g.scale * FLOW_FONT}px`);
      ok(g.nodes.every((n) => n.w >= 112 && n.h >= 48), `${label}: boxes of a readable size`);
      ok(g.nodes.every((n) => n.w === g.nodes[0].w), `${label}: one width`);
      // The drawing fills a good part of the board along its long side and is not a sliver across the short one.
      const [drawnW, drawnH] = [g.width * g.scale, g.height * g.scale];
      ok(drawnW <= box.width + 0.01 && drawnH <= box.height + 0.01, `${label}: inside the board`);
      ok(Math.max(drawnW / box.width, drawnH / box.height) >= 0.6, `${label}: fills ${Math.round(Math.max(drawnW / box.width, drawnH / box.height) * 100)}% of the board`);
      // Down a tall board, the width is used too; a wide one is a row, which is the shape of the board.
      if (box.height > box.width) ok(drawnW / box.width >= 0.3, `${label}: not a thin strip`);
    }
  }
  // Roomy boards grow the gaps between ranks (the arrows) instead of the boxes without limit.
  const roomy = flowGeometry(chain(3), { width: 1400, height: 1400 }, measure);
  ok(roomy.nodes[0].w <= 220, 'boxes stop growing');
  const gapOf = (g: ReturnType<typeof flowGeometry>) => g.nodes[1].y - (g.nodes[0].y + g.nodes[0].h);
  ok(gapOf(roomy) >= 44, `arrows have room: ${gapOf(roomy)}px between ranks`);
});

test('every edge has a visible arrowhead that touches its target and ends the line', () => {
  const item: FlowItem = { kind: 'flow', nodes: chain(4).nodes, edges: [['n0', 'n1'], ['n0', 'n2'], ['n1', 'n3'], ['n2', 'n3']] };
  for (const box of [{ width: 392, height: 640 }, { width: 1000, height: 340 }]) {
    const g = flowGeometry(item, box, measure);
    for (const e of g.edges) {
      ok(e.head.endsWith('Z'), 'a filled triangle');
      const [bx1, by1, tx, ty, bx2, by2] = e.head.match(/-?\d+(\.\d+)?/g)!.map(Number);
      ok(Math.hypot(bx1 - bx2, by1 - by2) >= 9, `the head is ${Math.hypot(bx1 - bx2, by1 - by2)}px across`);
      const target = g.nodes[e.to];
      const touches = (tx >= target.x - 3 && tx <= target.x + target.w + 3) && (ty >= target.y - 3 && ty <= target.y + target.h + 3);
      ok(touches, 'its tip is at the target box');
      const end = trace(e.d).at(-1)!;
      ok(Math.hypot(end[0] - (bx1 + bx2) / 2, end[1] - (by1 + by2) / 2) <= 2, 'the line ends at the base of the head');
    }
  }
});

// ----------------------------------------------------------------- formulas

const wrap = (latex: string, ...terms: string[]) =>
  wrapTerms(
    latex,
    terms.map((t) => ({ latex: t, label: t })),
    parses,
  );
const cls = (i: number, body: string) => `\\htmlClass{pt-term pt-term-${i}}{${body}}`;

test('each term wraps its first occurrence, and the result renders', () => {
  const out = wrap('\\frac{QK^{T}}{\\sqrt{d_k}}', 'QK^{T}', '\\sqrt{d_k}');
  eq(out.latex, `\\frac{${cls(0, 'QK^{T}')}}{${cls(1, '\\sqrt{d_k}')}}`);
  eq(out.placed, [true, true]);
  ok(parses(out.latex), 'renders');
});

test('a term takes a free occurrence before one inside an earlier term', () => {
  const out = wrap('f(Q, K, V) = g(Q)V', 'Q, K, V', 'V');
  eq(out.latex, `f(${cls(0, 'Q, K, V')}) = g(Q)${cls(1, 'V')}`);
});

test('a term nests inside an earlier one when it has no free occurrence', () => {
  const out = wrap('\\sqrt{d_k}', '\\sqrt{d_k}', 'd_k');
  eq(out.latex, cls(0, `\\sqrt{${cls(1, 'd_k')}}`));
  ok(parses(out.latex), 'renders');
});

test('occurrences inside a command name are not terms', () => {
  eq(wrap('\\alpha + a', 'a').latex, `\\alpha + ${cls(0, 'a')}`);
  eq(wrap('\\alpha', 'a').placed, [false], 'no occurrence between tokens');
});

test('a wrap that crosses a term or breaks the formula is left out', () => {
  eq(wrap('abc', 'ab', 'bc').placed, [true, false], 'crossing');
  const split = wrap('\\left(x\\right)', '\\left(x');
  eq([split.latex, split.placed], ['\\left(x\\right)', [false]], 'unbalanced');
});

// ------------------------------------------------------------- chemistry

const REACTION = '\\ce{2H2 + O2 -> 2H2O}';
/** The formula board as the server renders it; its fitting runs in layout effects, which only a browser runs (React warns). */
const draw = (item: FormulaItem) => {
  const error = console.error;
  console.error = (message?: unknown, ...rest: unknown[]) => String(message).includes('useLayoutEffect') || error(message, ...rest);
  try {
    return renderToStaticMarkup(createElement(FormulaBoard, { item, focus: null }));
  } finally {
    console.error = error;
  }
};

test('chemistry renders where mathematics does: \\ce and \\pu are typeset, not shown as source', () => {
  const html = formulaModel({ kind: 'formula', latex: REACTION, terms: [{ latex: REACTION, label: 'the reaction' }] }).html;
  ok(!!html && html.includes('katex-display'), 'a \\ce formula renders to KaTeX HTML');
  ok(!!html && html.includes('pt-term-0'), 'the whole group takes its term colour');
  ok(parses('M(\\ce{H2O}) = 18.02\\,\\mathrm{g/mol}') && parses('\\pu{1.5 mol}'), 'inline \\ce and \\pu parse');
  const markup = draw({ kind: 'formula', latex: REACTION, terms: [] });
  ok(markup.includes('katex-display') && !markup.includes('formula-source'), 'the board shows the typeset line, not the source fallback');
  const broken = draw({ kind: 'formula', latex: '\\ce{2H2 + ', terms: [] });
  ok(broken.includes('formula-source') && broken.includes('\\ce{2H2 +'), 'what does not parse is still shown as source');
});

test('a term wraps a whole \\ce group, never a piece inside one (it would lose its subscripts)', () => {
  const inside = wrap('\\ce{2H2 + O2 -> 2H2O}', '2H2O');
  eq([inside.latex, inside.placed], ['\\ce{2H2 + O2 -> 2H2O}', [false]], 'inside the group');
  const group = wrap('M(\\ce{H2O}) = 18.02', '\\ce{H2O}');
  eq(group.latex, `M(${cls(0, '\\ce{H2O}')}) = 18.02`);
  ok(parses(group.latex), 'renders');
  const around = wrap('M(\\ce{Fe^{3+}}) = 55.85', 'M(\\ce{Fe^{3+}})', '55.85');
  eq(around.placed, [true, true]);
  eq(wrap('\\ce{H2O} + \\ce{H2O}', 'H2O').placed, [false], 'not even where it is the whole group');
  eq(wrap('n(\\ce{H2O}) = H2O', 'H2O').placed, [true], 'but a copy outside a group is a term');
});

// ----------------------------------------------------------------- working

const line = (n: number, extra: object = {}) => ({ latex: `x_{${n}} = ${n}`, ...extra });
const solution = (lines: number, extra: Partial<FormulaItem> = {}): FormulaItem => ({
  kind: 'formula',
  title: 'Solve for x',
  latex: 'x = 9',
  terms: [{ latex: 'x', label: 'the unknown' }, { latex: '9', label: 'the answer' }],
  before: Array.from({ length: lines }, (_, i) => line(i + 1, { title: `step ${i + 1}` })),
  ...extra,
});
const lineCount = (markup: string) => markup.split('class="formula-line"').length - 1;
const checks = (markup: string) => markup.split('aria-label="checked"').length - 1;

test('the working keeps what the schema allows, oldest first, and drops lines that cannot be drawn', () => {
  const kept = checkBoardItem(
    {
      kind: 'formula',
      latex: 'x = 9',
      terms: [],
      verified: true,
      before: [
        { latex: 'x + 1 = 10', title: 'start', verified: true },
        { latex: ' ' },
        { latex: 'x = 10 - 1', title: 'n'.repeat(81), verified: 'yes' },
        { latex: 'y'.repeat(401) },
        'junk',
      ],
    },
    'step "s"',
    warn,
  );
  eq(kept, {
    kind: 'formula',
    latex: 'x = 9',
    terms: [],
    before: [{ latex: 'x + 1 = 10', title: 'start', verified: true }, { latex: 'x = 10 - 1' }],
    verified: true,
  });
  const many = checkBoardItem(solution(12), 'step "s"', warn);
  ok(many?.kind === 'formula' && many.before?.length === 8, 'at most eight lines');
  if (many?.kind === 'formula') eq(many.before?.[0].latex, 'x_{5} = 5', 'the newest eight');
  const plain = checkBoardItem({ kind: 'formula', latex: 'a + b', terms: [], verified: false, before: [] }, 'step "s"', warn);
  eq(plain, { kind: 'formula', latex: 'a + b', terms: [] }, 'nothing is added when there is no working');
});

test('the board shows the newest five earlier lines, oldest first', () => {
  eq(workingLines(solution(0)), []);
  eq(workingLines({ ...solution(0), before: undefined }), []);
  eq(workingLines(solution(3)).map((l) => l.latex), ['x_{1} = 1', 'x_{2} = 2', 'x_{3} = 3']);
  eq(workingLines(solution(8)).map((l) => l.title), ['step 4', 'step 5', 'step 6', 'step 7', 'step 8']);
  eq(WORKING_SHOWN, 5);
});

test('a board continues the working when its earlier lines end with the formula that was on the board', () => {
  const first: BoardItem = { kind: 'formula', latex: 'x + 1 = 10', terms: [] };
  const second: BoardItem = { kind: 'formula', latex: 'x = 10 - 1', terms: [], before: [{ latex: 'x + 1 =  10' }] };
  ok(continuesWorking(first, second), 'the next line, whitespace aside');
  const third: BoardItem = { kind: 'formula', latex: 'x = 9', terms: [], before: [{ latex: 'x + 1 = 10' }, { latex: 'x = 10 - 1' }] };
  ok(continuesWorking(second, third), 'and the one after it');
  ok(!continuesWorking(first, third), 'not a board two lines on');
  ok(!continuesWorking(third, second), 'not backwards (a seek)');
  ok(!continuesWorking(first, { kind: 'formula', latex: 'x = 9', terms: [] }), 'not without earlier lines');
  ok(!continuesWorking(null, second) && !continuesWorking(undefined, second), 'not on an empty board');
  ok(!continuesWorking(bleu, second) && !continuesWorking(first, bleu), 'only between formulas');
});

test('the working is drawn above the current line: small, still, without term colours or a legend', () => {
  const markup = draw(solution(3));
  eq(lineCount(markup), 3, 'three earlier lines');
  ok(markup.indexOf('formula-working') < markup.indexOf('formula-current'), 'above the current line');
  const [working, current] = markup.split('<div class="formula-current">');
  ok(working.includes('katex-display') && !working.includes('pt-term'), 'typeset, with no term colours');
  ok(current.includes('pt-term-0') && current.includes('pt-term-1'), 'the current line keeps its terms');
  eq(markup.split('class="formula-legend"').length - 1, 1, 'one legend, the current line\'s');
  ok(current.indexOf('the unknown') > 0 && !working.includes('the unknown'), 'whose labels are not in the working');
  const order = [1, 2, 3].map((n) => working.indexOf(`step ${n}<`));
  ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), 'each line has its title as a note, oldest first');
  eq(checks(markup), 0, 'no check mark when nothing was verified');
});

test('at most five earlier lines are shown, the newest', () => {
  const markup = draw(solution(8));
  eq(lineCount(markup), 5);
  ok(!markup.includes('step 3<') && markup.includes('step 4<') && markup.includes('step 8<'), 'the oldest three are left out');
  eq(workingModel(solution(8)).length, 5);
  ok(workingModel(solution(2)).every((l) => l.html?.includes('katex')), 'each is typeset');
  eq(workingModel({ ...solution(1), before: [{ latex: '\\frac{' }] })[0].html, null, 'a line that does not parse is shown as source');
});

test('a check mark is drawn only for lines code verified, with an accessible name', () => {
  const none = draw(solution(2));
  eq(checks(none), 0);
  const now = draw(solution(2, { verified: true }));
  eq(checks(now), 1, 'the current line');
  ok(now.includes('role="img" aria-label="checked"'), 'named "checked"');
  ok(now.indexOf('formula-check') > now.indexOf('formula-current'), 'beside the current line');
  const before = solution(3, { before: [line(1, { verified: true }), line(2), line(3, { verified: true })] });
  const earlier = draw(before);
  eq(checks(earlier), 2, 'two earlier lines, not the unverified one or the current line');
  eq(checks(draw({ ...before, verified: true })), 3);
  const alone = draw({ ...solution(0), before: undefined, verified: true });
  eq(checks(alone), 1, 'a first line has its mark too');
  ok(!alone.includes('formula-working'), 'and no working');
});

test('a chemistry working renders its lines with mhchem', () => {
  const item: FormulaItem = {
    kind: 'formula',
    latex: 'n(\\ce{H2O}) = \\frac{36.0}{18.0}\\,\\mathrm{mol}',
    terms: [{ latex: 'n(\\ce{H2O})', label: 'amount of water' }],
    before: [{ latex: REACTION, title: 'balanced equation', verified: true }, { latex: 'M(\\ce{H2O}) = 18.02\\,\\mathrm{g/mol}' }],
  };
  const models = workingModel(item);
  ok(models.every((m) => m.html !== null && m.html.includes('katex')), 'both lines are typeset');
  const markup = draw(item);
  ok(!markup.includes('formula-source'), 'no line falls back to its source');
  eq(checks(markup), 1);
});

// --------------------------------------------------------------------- bars

// A tour shows a few chosen rows: marking the largest as the best can contradict the document (a stronger row left out).
test('size never singles a bar out; the bar the narration is on does', () => {
  eq(bleu.bars.map((_, i) => barStandsOut(null, i)), [true, true, true], 'alike before any focus, largest included');
  eq(bleu.bars.map((_, i) => barStandsOut(2, i)), [false, false, true], 'the focused bar, though the smallest');
});

test('the unit chip says which way is better, in the notation papers use', () => {
  eq(barsUnit(bleu), { text: 'BLEU ↑', label: 'BLEU, higher is better' });
  eq(barsUnit({ ...bleu, unit: 'PPL', higher_is_better: false }), { text: 'PPL ↓', label: 'PPL, lower is better' });
  eq(barsUnit({ ...bleu, higher_is_better: undefined }), { text: 'BLEU', label: 'BLEU' }, 'no direction, no arrow');
  eq(barsUnit({ ...bleu, unit: '%' }), { text: '% ↑', label: '%, higher is better' }, 'percent beside its arrow');
  eq(barsUnit({ ...bleu, unit: '%', higher_is_better: undefined }), null, 'percent alone is on every value already');
  eq(barsUnit({ ...bleu, unit: undefined }), { text: 'higher is better', label: 'higher is better' }, 'no unit');
  eq(barsUnit({ ...bleu, unit: undefined, higher_is_better: undefined }), null, 'nothing to say');
});

test('values print with the places they were reported with', () => {
  eq([28.4, 25.16, 24, 1.234567, 1e-7].map(decimalsOf), [1, 2, 0, 4, 4]);
  eq(formatValue(25.16, 2), '25.16');
  eq(formatValue(1234.5, 1), '1,234.5');
  eq(formatValue(-0, 1), '0.0', 'no negative zero');
  eq(formatValue(-0.0001, 1), '-1e-4', 'tiny nonzero values remain visible');
  eq(formatValue(1.23456e-7, 4), '1.23e-7', 'scientific labels keep useful precision');
  eq([0.7310585786, 0.2689414214].map(value => formatValue(value, decimalsOf(value))), ['0.731', '0.269'], 'calculated examples do not expose long floating point tails');
  eq(formatValue(0.1234, decimalsOf(0.1234)), '0.1234', 'short reported paper precision is retained');
  eq(formatValue(12.5, 1, '%'), '12.5%');
  eq(formatValue(12.5, 1, 'BLEU'), '12.5', 'other units are shown once, not per value');
  eq(formatValue(2.3e19, decimalsOf(2.3e19)), '2.3×10¹⁹', 'a count of operations is a power of ten, not twenty digits');
  eq(formatValue(-4e15, 0), '-4×10¹⁵');
  eq(formatValue(123456789012, 0), '123,456,789,012', 'billions keep their digits');
  eq(formatValue(1.2345e20, decimalsOf(1.2345e20)), '1.2345×10²⁰', 'a power of ten keeps the digits it was reported with');
  eq(formatValue(2e19, decimalsOf(2e19)), '2×10¹⁹');
  eq(formatValue(9.6e18, decimalsOf(9.6e18)), '9.6×10¹⁸');
  eq(formatValue(1.23456e21, decimalsOf(1.23456e21)), '1.2346×10²¹', 'at most 4 places, as a decimal prints');
  eq(formatValue(1.23456789e21, decimalsOf(1.23456789e21)), '1.235×10²¹', 'a long tail needs only 3');
  eq(formatValue(9.99996e20, decimalsOf(9.99996e20)), '1.0000×10²¹', 'a mantissa that rounds up to 10 moves the exponent');
  eq(formatValue(9.99999e19, 0, undefined, 9.99999e19), '1.0000×10²⁰');
  eq(formatValue(9.99996e20 * 0.5, 0, undefined, 9.99996e20), '0.5000×10²¹', 'and so does every step on the way there');
});

test('a count up to a power of ten keeps that form all the way, counting its mantissa', () => {
  const shown = [0.01, 0.1, 0.4, 0.7, 1].map((progress) => formatValue(2.3e19 * progress, 0, undefined, 2.3e19));
  eq(shown, ['0', '0.2×10¹⁹', '0.9×10¹⁹', '1.6×10¹⁹', '2.3×10¹⁹']);
  eq(formatValue(0, 0, undefined, 2.3e19), '0', 'nothing yet is 0');
  eq(formatValue(-2.3e19 * 0.4, 0, undefined, -2.3e19), '-0.9×10¹⁹');
  eq(formatValue(5e14 * 0.5, 0, undefined, 5e14), '250,000,000,000,000', 'under a thousand trillion it counts in digits');
});

test('bars share a zero line; labels go above them on a narrow board', () => {
  const labels = bleu.bars.map((b) => measure(b.label));
  const values = [40, 32, 36];
  const narrow = barsLayout(bleu, 340, labels, values);
  const wide = barsLayout(bleu, 800, labels, values);
  eq([narrow.labelsAbove, wide.labelsAbove], [true, false]);
  for (const l of [narrow, wide]) {
    ok(l.rows.every((r) => r.x0 === l.zeroX && r.x1 > r.x0), 'from the zero line');
    const spare = l.width - (l.rows[0].x1 + 8 + values[0]);
    ok(spare >= 1 && spare <= 3, `the longest bar leaves room for its value, and a little more (${spare})`);
    ok(l.rows[1].x1 < l.rows[0].x1 && l.rows[2].x1 < l.rows[1].x1, 'ordered by value');
  }
});

test('a bar has a rounded tip away from zero and a square base on it', () => {
  eq(barPath(0, 100, 10, true), 'M0 10H96A4 4 0 0 1 100 14V18A4 4 0 0 1 96 22H0Z', 'tip on the right');
  eq(barPath(20, 100, 10, false), 'M100 10H24A4 4 0 0 0 20 14V18A4 4 0 0 0 24 22H100Z', 'tip on the left');
  ok(barPath(0, 3, 0, true).includes('A1.5 1.5'), 'a short bar rounds less');
  eq(barPath(5, 5, 0, true), '', 'no length, no bar');
  eq(barClip(0.25, true), 'inset(0 75.00% 0 0 round 0 4px 4px 0)');
  eq(barClip(2, false), 'inset(0 0 0 0.00% round 4px 0 0 4px)', 'clamped');
});

test('on a short board the rows close up, but never tighter than they can be read', () => {
  const labels = bleu.bars.map((b) => measure(b.label));
  const values = [40, 32, 36];
  for (const width of [340, 800]) {
    const roomy = barsLayout(bleu, width, labels, values);
    const short = barsLayout(bleu, width, labels, values, roomy.height - 12);
    const tiny = barsLayout(bleu, width, labels, values, 40);
    ok(short.height <= roomy.height - 12 + 0.01, `${width}: fits the shorter board (${short.height})`);
    const pitch = (l: typeof roomy) => l.rows[1].y - l.rows[0].y;
    ok(pitch(tiny) >= (roomy.labelsAbove ? 40 : 26) && pitch(tiny) < pitch(short), `${width}: a floor on the pitch`);
    eq(barsLayout(bleu, width, labels, values, 2000).height, roomy.height, `${width}: never looser than roomy`);
  }
});

test('negative bars grow left of zero with their values before the tip', () => {
  const item: BarsItem = { kind: 'bars', bars: [{ label: 'gain', value: 2 }, { label: 'loss', value: -1 }] };
  const l = barsLayout(item, 600, [30, 30], [20, 24]);
  const [gain, loss] = l.rows;
  eq([gain.x0, loss.x1], [l.zeroX, l.zeroX], 'both start at zero');
  eq([loss.valueAnchor, gain.valueAnchor], ['end', 'start']);
  ok(loss.x0 < l.zeroX && loss.valueX < loss.x0, 'left of zero');
});

test('only forward frames of the same quantities and units morph their values', () => {
  const previous = { key: '3:1', item: bleu };
  const next: BarsItem = { ...bleu, bars: bleu.bars.map(bar => ({ ...bar, value: bar.value / 2 })) };
  eq(barFrameSource(previous, { key: '3:5', item: next }), bleu, 'same spoken step preserves the numerical source');
  eq(barFrameSource(previous, { key: '4:1', item: next }), null, 'another step starts independently');
  eq(barFrameSource(previous, { key: '3:0', item: next }), null, 'backward seek does not interpolate from a future value');
  eq(barFrameSource(previous, { key: '3:5', item: { ...next, unit: 'probability' } }), null, 'different units never share a scale');
  eq(barFrameSource({ ...previous, item: { ...bleu, unit: undefined } }, { key: '3:5', item: { ...next, unit: undefined } }), null, 'missing units cannot establish equivalent quantities');
  eq(barFrameSource(previous, { key: '3:5', item: { ...next, bars: [...next.bars].reverse() } }), null, 'different quantity order is not silently reinterpreted');
});

test('worked formula and flow frames retain semantic objects without replaying the whole board', () => {
  const formula: BoardItem = { kind: 'formula', latex: 'x + 1 = y', terms: [{ latex: 'x', label: 'Input' }, { latex: 'y', label: 'Output' }] };
  const numeric: BoardItem = { kind: 'formula', latex: '2 + 1 = 3', terms: [{ latex: '3', label: 'Output' }, { latex: '2', label: 'Input' }] };
  const previous = { key: '2:0', item: formula }, next = { key: '2:4', item: numeric };
  ok(continuousBoardFrame(previous, next), 'substitution continues the same explanation');
  const colored = boardFrameColors(previous, next);
  ok(colored.kind === 'formula', 'still a formula');
  if (colored.kind === 'formula') eq(colored.terms.map(term => term.color), ['orange', 'blue'], 'the role keeps its colour after term reordering');
  eq(numeric.terms.map(term => term.color), [undefined, undefined], 'authored input is not mutated');
  const explicit = boardFrameColors(previous, { ...next, item: { ...numeric, terms: [{ latex: '3', label: 'Output', color: 'green' }] } });
  if (explicit.kind === 'formula') eq(explicit.terms[0].color, 'green', 'authored colour remains authoritative');
  eq(continuousBoardFrame(next, previous), false, 'backward seek is not an object transformation');
  eq(continuousBoardFrame(previous, { ...next, key: '3:0' }), false, 'new step does not inherit presentation state');
  const flow: FlowItem = { kind: 'flow', nodes: [{ id: 'input', label: 'Input x', color: 'blue' }, { id: 'output', label: 'Result', color: 'green' }], edges: [['input', 'output']] };
  const updated: FlowItem = { ...flow, nodes: [{ id: 'input', label: 'Input 2' }, { id: 'output', label: 'Result 3' }] };
  ok(continuousBoardFrame({ ...previous, item: flow }, { ...next, item: updated }), 'stable process IDs update in place');
  const flowColors = boardFrameColors({ ...previous, item: flow }, { ...next, item: updated });
  if (flowColors.kind === 'flow') eq(flowColors.nodes.map(node => node.color), ['blue', 'green']);
  eq(continuousBoardFrame({ ...previous, item: flow }, { ...next, item: { ...updated, edges: [['output', 'input']] } }), false, 'changed process order is a different diagram');
});

test('numerical frames interpolate from the previous value, including negative values', () => {
  const from: BarsItem = { kind: 'bars', unit: 'units', bars: [{ label: 'A', value: 10 }, { label: 'B', value: -2 }] };
  const to: BarsItem = { ...from, bars: [{ label: 'A', value: 4 }, { label: 'B', value: 2 }] };
  eq(interpolateBars(from, to, 0).bars.map(bar => bar.value), [10, -2], 'never restart from zero');
  eq(interpolateBars(from, to, 0.5).bars.map(bar => bar.value), [7, 0], 'intermediate state is an actual numerical interpolation');
  eq(interpolateBars(from, to, 1).bars.map(bar => bar.value), [4, 2], 'final authored values remain exact');
  const domain = [-2, 10, 4, 2];
  const before = barsLayout(from, 600, [20, 20], [40, 40], 200, domain);
  const after = barsLayout(to, 600, [20, 20], [40, 40], 200, domain);
  eq(before.zeroX, after.zeroX, 'axis does not jump as values cross zero');
  ok(Math.abs((after.rows[0].x1 - after.zeroX) / (before.rows[0].x1 - before.zeroX) - 0.4) < 0.001, '4 remains forty percent of10 on the shared scale');
});

test('plot cursor follows narrated progress and changes only one independent variable', () => {
  const item = { kind: 'plot' as const, x: [-2, 6] as [number, number], y: [0, 36] as [number, number], curves: [{ expression: 'x*x', label: 'Output' }] };
  eq([0, 0.5, 1].map(progress => plotCursor(item, progress)), [{ x: -2, a: 1 }, { x: 2, a: 1 }, { x: 6, a: 1 }]);
  const parameter = { ...item, parameter: { from: 1, to: 5 } };
  eq([0, 0.5, 1].map(progress => plotCursor(parameter, progress)), [{ x: 2, a: 1 }, { x: 2, a: 3 }, { x: 2, a: 5 }], 'parameter sweep holds the input fixed');
  eq(plotCursor(item, -2), plotCursor(item, 0), 'clamped start');
  eq(plotCursor(item, 4), plotCursor(item, 1), 'clamped end');
});

test('native scene objects keep identity, coordinates, and actual numeric values between states', () => {
  const start: SceneItem = { kind: 'scene', objects: [
    { id: 'matrix', type: 'matrix', x: .1, y: .2, w: .2, h: .3, color: 'blue', values: [[1, 2], [3, 4]] },
    { id: 'vector', type: 'vector', x: .5, y: .5, w: .2, h: -.2, color: 'orange' },
  ] };
  const end: SceneItem = { kind: 'scene', objects: [
    { ...start.objects[1], w: -.2, h: .3 },
    { ...start.objects[0], x: .5, values: [[3, 6], [7, 8]] },
  ] };
  const before = JSON.stringify(start);
  const middle = interpolateScene(sceneObjects(start), end, .5);
  eq(middle.find(object => object.id === 'matrix')?.values, [[2, 4], [5, 6]], 'numbers change with the same matrix object');
  ok(Math.abs(middle.find(object => object.id === 'matrix')!.x - .3) < 1e-10, 'geometry transforms rather than remounts');
  eq(middle.find(object => object.id === 'vector')?.w, 0, 'the same vector rotates through its intermediate direction');
  eq(interpolateScene(sceneObjects(start), end, 1).map(object => object.values), end.objects.map(object => object.values), 'target values stay exact after animation');
  eq(JSON.stringify(start), before, 'source states remain immutable');
  eq(sceneInk({ ...start.objects[0], color: undefined }), sceneInk({ ...end.objects[1], color: undefined }), 'default semantic ink follows ID, not array order');
  const arriving: SceneItem = { kind: 'scene', objects: [{ id: 'result', type: 'text', x: .2, y: .2, w: .5, h: .2, text: 'Result' }] };
  const fading = interpolateScene(sceneObjects(start), arriving, .25);
  eq(fading.map(object => object.opacity), [.25, .75, .75], 'added and removed objects have distinct identities');
  eq(sceneNumber(.7310585786), '0.731', 'matrix labels avoid raw floating point tails');
  eq([1234,999999,.1234].map(sceneMatrixText), ['1234','999999','0.1234'], 'final reported values stay exact');
  eq(sceneMatrixText(.7310585786), '≈0.731', 'any rounded matrix value is explicitly approximate');
});

test('scene vectors use signed endpoints and share the plotted data coordinate system', () => {
  const item: SceneItem = { kind: 'scene', objects: [
    { id: 'plane', type: 'plot', x: .1, y: .2, w: .8, h: .6, background: true,
      plot: { kind: 'plot', x: [-2, 2], y: [-3, 3], curves: [{ expression: 'x', label: 'f' }] } },
    { id: 'vector', type: 'vector', plotId: 'plane', x: 0, y: 0, w: 2, h: 3 },
    { id: 'point', type: 'circle', plotId: 'plane', x: -.5, y: -1, w: 1, h: 2 },
  ] };
  const vector = projectSceneObject(item.objects[1], item.objects);
  ok(Math.abs(vector.x - .532) < 1e-9 && Math.abs(vector.y - .464) < 1e-9, 'origin maps to the exact inner axes, including plot margins');
  ok(Math.abs(vector.x + vector.w - .868) < 1e-9 && Math.abs(vector.y + vector.h - .224) < 1e-9, 'positive data y points upward to the plotted endpoint');
  const circle = projectSceneObject(item.objects[2], item.objects);
  ok(circle.w > 0 && circle.h > 0 && circle.y < vector.y, 'bound circle uses screen bounds despite inverted y');
  const arrow = sceneArrow({ x: .5, y: .5, w: -.3, h: -.2 });
  ok(arrow.line.startsWith('M300,200L120,120'), 'negative deltas remain negative, not an unsigned bounding box');
  eq(sceneArrow({ x: .5, y: .5, w: 0, h: 0 }), { line: '', head: '' }, 'a zero vector has no fabricated direction');
  const changed: SceneItem = { kind: 'scene', objects: [
    { ...item.objects[0], plot: { ...item.objects[0].plot!, x: [0, 1], y: [0, 1] } },
    { ...item.objects[1], w: .5, h: .5 },
    { ...item.objects[2], x: .1, y: .1, w: .1, h: .1 },
  ] };
  eq(sceneTransitionAllowed(item.objects, changed), false, 'changing coordinate domains is not treated as a numeric transform');
  eq(interpolateScene(sceneObjects(item), changed, .5), sceneObjects(changed), 'domain changes show the exact valid target state, never an out-of-domain intermediate vector');
  const rebound: SceneItem = { kind: 'scene', objects: item.objects.map(object => object.id === 'vector' ? { ...object, plotId: undefined, x: .2, y: .2, w: .1, h: .1 } : object) };
  eq(sceneTransitionAllowed(item.objects, rebound), false, 'data-space and canvas-space values are never mixed');
});

// ----------------------------------------------------- heatmap, scatter, shapes

const sensors: HeatmapItem = {
  kind: 'heatmap',
  rows: ['soil', 'air', 'water', 'light'],
  cols: ['soil', 'air', 'water', 'light'],
  values: [
    [1, 0.62, 0.35, -0.1],
    [0.62, 1, 0.48, 0.05],
    [0.35, 0.48, 1, 0.3],
    [-0.1, 0.05, 0.3, 1],
  ],
  source: 'illustrative',
};
const scores = (mask?: 'upper'): HeatmapItem => ({
  kind: 'heatmap',
  rows: ['a', 'b', 'c'],
  cols: ['x', 'y', 'z'],
  values: [
    [2, 1, 0],
    [0, 3, 1],
    [1, 1, 4],
  ],
  source: 'illustrative',
  normalize: 'rows',
  ...(mask ? { mask } : {}),
});

test('a heatmap, scatter or shapes item is checked with the shared rules and kept in its clean form', () => {
  warnings.length = 0;
  const formula = checkBoardItem(
    { kind: 'heatmap', rows: ['a', 'b'], cols: ['x', 'y', 'z'], expression: ' x * a ', source: 'formula', extra: 1 },
    'step "s"',
    warn,
  );
  eq(formula, { kind: 'heatmap', rows: ['a', 'b'], cols: ['x', 'y', 'z'], values: [[1, 2, 3], [2, 4, 6]], expression: 'x * a', source: 'formula' }, 'values computed');
  const scatter = checkBoardItem(
    { kind: 'scatter', x_label: 'cost ($)', y_label: 'yield (%)', source: 'document', points: [{ label: 'A', x: 1, y: 2 }, { label: 'B', x: 3, y: 5 }, { label: 'C', x: 6, y: 7 }] },
    'step "s"',
    warn,
  );
  eq((scatter as { points: unknown[] }).points.length, 3, 'scatter points');
  const shapes = checkBoardItem(
    {
      kind: 'shapes',
      terms: [
        { kind: 'matrix', name: 'A', rows: 'm', cols: 'k' },
        { kind: 'op', op: 'times' },
        { kind: 'matrix', name: 'B', rows: 'k', cols: 'n' },
        { kind: 'op', op: 'equals' },
        { kind: 'matrix', name: 'C', rows: 'm', cols: 'n' },
      ],
    },
    'step "s"',
    warn,
  );
  eq((shapes as { terms: unknown[] }).terms.length, 5, 'shapes terms');
  eq(warnings.length, 0, 'no warnings');
});

test('invalid heatmap, scatter and shapes items are skipped with the reason', () => {
  warnings.length = 0;
  const ragged = { kind: 'heatmap', rows: ['a', 'b'], cols: ['x', 'y'], values: [[1, 2], [3]], source: 'illustrative' };
  eq(checkBoardItem(ragged, 'step "s"', warn), null, 'ragged grid');
  const lone = { kind: 'scatter', x_label: 'x', y_label: 'y', source: 'illustrative', points: [{ label: 'A', x: 1, y: 2 }] };
  eq(checkBoardItem(lone, 'step "s"', warn), null, 'one point');
  const clash = {
    kind: 'shapes',
    terms: [
      { kind: 'matrix', name: 'A', rows: 'm', cols: 'k' },
      { kind: 'op', op: 'times' },
      { kind: 'matrix', name: 'B', rows: 'j', cols: 'n' },
    ],
  };
  eq(checkBoardItem(clash, 'step "s"', warn), null, 'dimensions that do not agree');
  eq(warnings.length, 3, 'one warning each');
  ok(warnings[0].includes('row 2') && warnings[0].includes('step "s"'), 'says where the grid is ragged');
  ok(warnings[1].includes('points'), 'names the points');
  ok(warnings[2].includes('times'), 'names the operator');
});

test('the source tag marks invented and computed values, never the paper\'s', () => {
  eq(sourceTag(sensors)?.text, 'illustrative', 'illustrative');
  eq(sourceTag({ ...sensors, source: 'formula' })?.text, 'from the formula', 'formula');
  eq(sourceTag({ ...sensors, source: 'document' }), null, 'document');
  eq(sourceTag(bleu), null, 'bars have none');
});

test('the colour scale rises in lightness, stays readable under its text, and runs warm below zero', () => {
  const levels = Array.from({ length: 101 }, (_, i) => i / 100);
  const lights = levels.map((t) => luminance(heatmapRgb(t, false)));
  ok(lights.every((v, i) => i === 0 || v >= lights[i - 1]), 'sequential lightness rises');
  const warm = levels.map((t) => luminance(heatmapRgb(-t, true)));
  ok(warm.every((v, i) => i === 0 || v >= warm[i - 1]), 'negative side rises too');
  eq(heatmapRgb(0, true), heatmapRgb(0, false), 'both sides start at the same neutral');
  const [r, , b] = heatmapRgb(-0.75, true);
  const [r2, , b2] = heatmapRgb(0.75, true);
  ok(r > b && b2 > r2, 'negative is warm, positive is cool');
  for (const diverging of [false, true])
    for (const t of levels.map((v) => (diverging ? 2 * v - 1 : v))) {
      const fill = heatmapRgb(t, diverging);
      ok(contrast(luminance(fill), luminance(heatmapInk(fill))) >= 4, `text on level ${t} reads at 4:1 or better`);
    }
  ok(heatmapRamp(false).startsWith('linear-gradient(90deg, rgb(24 29 43) 0%') && heatmapRamp(true).includes('50%'), 'legend gradient');
});

test('the domain anchors weights at zero, spreads a narrow band, centres signed values and skips masked cells', () => {
  eq(heatmapDomain([[0.1, 0.5], [0.9, 0.3]], false), [0, 0.9], 'low values start at zero');
  eq(heatmapDomain([[0.8, 0.85], [0.9, 0.95]], false), [0.8, 0.95], 'a narrow band spreads');
  eq(heatmapDomain([[-2, 1], [0.5, 0]], true), [-2, 2], 'symmetric around zero');
  eq(heatmapDomain([[1, 99], [3, 4]], false, 'upper'), [0, 4], 'masked cells do not count');
  eq(heatmapDomain([[5, 5], [5, 5]], false), [5, 6], 'a flat grid still has a span');
  eq(heatmapLevel(1, [0, 4], false), 0.25, 'sequential level');
  eq(heatmapLevel(-1, [-2, 2], true), -0.5, 'diverging level');
  eq(heatmapLevel(9, [0, 4], false), 1, 'clamped');
});

test('cell text keeps few places, never prints a small value as zero and carries the unit', () => {
  eq(heatmapPlaces([[1, 2], [3, 4]]), 0, 'integers');
  eq(heatmapPlaces([[0.123456, 2]]), 2, 'at most two places');
  eq(heatmapPlaces([[1, 99.5], [3, 4]], 'upper'), 0, 'masked cells are not measured');
  eq(heatmapText(0.5, 2), '0.50', 'fixed places');
  eq(heatmapText(0.001, 2), '~0', 'small but not zero');
  eq(heatmapText(0, 2), '0.00', 'zero is zero');
  eq(heatmapText(-0.004, 2, '%'), '~0%', 'small with a unit');
  eq(heatmapText(12.5, 1, '%'), '12.5%', 'percent');
  eq(heatmapText(-0.35, 2), '-0.35', 'negative');
  eq(heatmapLegend(heatmapModel(scores()).raw), { low: '0', high: '4' }, 'legend trims places');
  eq(heatmapLegend(heatmapModel(sensors).raw), { low: '-0.1', high: '1' }, 'a sequential scale starts at the lowest signed value');
  eq(heatmapLegend(heatmapModel({ ...sensors, scale: 'diverging' }).raw), { low: '-1', high: '1' }, 'diverging legend');
  eq(heatmapLegend(heatmapModel(scores()).raw, 'score'), { low: '0', high: '4 score' }, 'unit follows the high end');
  eq(heatmapLegend(heatmapModel(scores()).raw, '%'), { low: '0%', high: '4%' }, 'percent stays on both');
});

test('normalizing turns scores into weights: colour and text move from the first state to the second', () => {
  const model = heatmapModel(scores());
  ok(model.weights !== null, 'weights exist');
  for (const row of model.weights!.values) ok(Math.abs(row.reduce((a, b) => a + b, 0) - 1) < 1e-9, 'a row sums to one');
  const before = cellLook(model, 1, 1, 0);
  const after = cellLook(model, 1, 1, 1);
  eq([before.rawOpacity, before.weightOpacity], [1, 0], 'scores show first');
  eq([after.rawOpacity, after.weightOpacity], [0, 1], 'weights show last');
  eq(before.rawText, '3', 'raw text');
  eq(after.weightText, '0.84', 'weight text');
  ok(before.fill !== after.fill, 'the colour moves');
  const mid = cellLook(model, 1, 1, 0.5);
  eq([mid.rawOpacity, mid.weightOpacity], [0, 0], 'the numbers pass the midpoint blank, never as meaningless in-between values');
  eq(cellLook(heatmapModel(sensors), 0, 1, 1).weightOpacity, 0, 'no weights without normalize');
});

test('masked cells weigh zero and do not set the scale', () => {
  const model = heatmapModel(scores('upper'));
  eq(model.weights!.values[0], [1, 0, 0], 'the first row sees only itself');
  ok(Math.abs(model.weights!.values[2].reduce((a, b) => a + b, 0) - 1) < 1e-9, 'the last row still sums to one');
  eq(model.raw.domain[1], 4, 'raw domain ignores the masked 1 and 0 above the diagonal');
  eq(heatmapAlt(scores('upper')).includes('a: x 1.00'), true, 'the alt text has the weights');
  ok(!heatmapAlt(scores('upper')).includes('a: x 1.00, y'), 'and leaves masked cells out');
});

test('links weigh by value, follow the scores into the weights and run warm for negative scores', () => {
  const model = heatmapModel(scores());
  const first = linkLook(model, 0, 0, 0);
  const last = linkLook(model, 0, 0, 1);
  // Score 2 of a 0-4 span; its weight is 0.665 of a span that ends at the grid's largest weight, 0.910.
  ok(first.strength === 0.5 && Math.abs(last.strength - 0.731) < 0.005, 'strength follows scores, then weights');
  eq(linkLook(model, 0, 2, 0).strength, 0, 'the lowest score has no strength');
  const signed = heatmapModel({ ...sensors, scale: 'diverging' });
  eq(linkLook(signed, 0, 3, 0), { strength: 0.1, negative: true }, 'a negative score is drawn by size, in the warm colour');
  eq(linkLook(signed, 0, 1, 0).negative, false, 'a positive one is not');
});

test('the build: rows arrive in order, the morph waits for the grid, and the end is at the last row', () => {
  const { first, every, pause } = HEATMAP_TIMING;
  eq(rowShown(0, 0), 0, 'nothing at the start');
  ok(rowShown(first + 300, 0) > rowShown(first + 300, 3), 'earlier rows are further along');
  eq(rowShown(heatmapEnd(4, false), 3), 1, 'all rows in at the end');
  const gridDone = first + 3 * every + HEATMAP_TIMING.fade;
  eq(heatmapEnd(4, false), gridDone, 'no morph: the grid is the end');
  eq(rowMorph(gridDone + pause - 1, 0, 4), 0, 'the morph has not started');
  ok(rowMorph(gridDone + pause + 300, 0, 4) > rowMorph(gridDone + pause + 300, 3, 4), 'rows turn one after another');
  eq(rowMorph(heatmapEnd(4, true), 3, 4), 1, 'the last row has turned at the end');
  ok(heatmapEnd(4, true) > gridDone + pause && heatmapEnd(4, true) - gridDone - pause < 1100, 'about a second of morph');
  eq([morphProgress(0, 4), morphProgress(heatmapEnd(4, true), 4)], [0, 1], 'overall progress spans 0 to 1');
});

test('labels stay on one line, then wrap to two, then turn to read upward', () => {
  eq(labelBlock(['ab', 'cde'], 40, measure).mode, 'flat', 'short labels');
  const wrapped = labelBlock(['red wine', 'dry'], 40, measure);
  eq([wrapped.mode, wrapped.lines], ['wrap', [['red', 'wine'], ['dry']]], 'words wrap');
  const turned = labelBlock(['fermentation', 'dry'], 40, measure);
  eq(turned.mode, 'rotated', 'a word that cannot fit turns');
  ok(turned.height <= 92 + 4, 'a turned label is cut to a bounded height');
  const long = labelBlock(['a very long label indeed that goes on', 'b'], 20, measure);
  ok(long.lines[0][0].endsWith('…') && measure(long.lines[0][0]) <= 92, 'a very long label ends in an ellipsis');
});

test('a grid fills the width up to 64px cells, keeps its cells from turning into strips, and fits the height', () => {
  const wide = gridLayout(sensors, { width: 600, height: 400 }, measure, 28);
  ok(wide.cw <= 64 && wide.ch <= wide.cw, 'cells are at most 64px and never taller than wide');
  ok(wide.width <= 600 && wide.height <= 400, 'fits a roomy board');
  ok(wide.values, 'values print on big cells');
  const short = gridLayout(sensors, { width: 600, height: 150 }, measure, 28);
  ok(short.cw <= (150 - short.cols.height) / sensors.rows.length / 0.62 + 1, 'cells narrow to keep their shape on a short board');
  const tight = gridLayout(sensors, { width: 300, height: 70 }, measure, 28);
  ok(tight.ch >= 14 && tight.height > 70, 'a grid that cannot fit keeps readable cells and scrolls');
  ok(!tight.values || tight.cw >= 28 + 8, 'values print only where they fit');
  const narrow = gridLayout(sensors, { width: 160, height: 400 }, measure, 28);
  ok(!narrow.values && narrow.width <= 160, 'small cells print no values');
  const sums = gridLayout(scores(), { width: 400, height: 300 }, measure, 28);
  ok(sums.sumX !== null && sums.sumX >= sums.x0 + 3 * sums.cw, 'a normalized grid reserves a column for the sums');
  eq(gridLayout(sensors, { width: 400, height: 300 }, measure, 28).sumX, null, 'and others do not');
});

test('long column labels turn instead of overlapping', () => {
  const item: HeatmapItem = { ...sensors, cols: ['temperature', 'humidity', 'pressure', 'luminosity'] };
  const layout = gridLayout(item, { width: 280, height: 300 }, measure, 28);
  eq(layout.cols.mode, 'rotated', 'rotated');
  ok(layout.y0 > 60, 'the header makes room for them');
});

test('links: curves join each row to its columns, skip masked cells and stay inside the board', () => {
  const layout = linksLayout(scores('upper'), { width: 360, height: 320 }, measure, 28);
  eq(layout.curves.map((row) => row.map(Boolean)), [[true, false, false], [true, true, false], [true, true, true]], 'masked cells have no curve');
  ok(layout.curves[2][0].startsWith(`M${layout.bottomX[2]} ${layout.bottomY} `), 'a curve starts at its row dot');
  ok(layout.curves[2][0].endsWith(`${layout.topX[0]} ${layout.topY}`), 'and ends at its column dot');
  ok(layout.topX.every((x) => x > 0 && x < 360) && layout.bottomX.every((x) => x > 0 && x < 360), 'tokens are inside');
  ok(layout.bottomY - layout.topY >= 84 && layout.height <= 320, 'room for curves, within the board');
  ok(layout.valueY !== null, 'values fit under the column tokens');
  eq(linksLayout(scores(), { width: 120, height: 320 }, measure, 28).valueY, null, 'narrow slots print no values');
  const uneven = linksLayout({ ...scores(), rows: ['a', 'b', 'c', 'd'], values: [...scores().values, [1, 2, 3]] }, { width: 360, height: 320 }, measure, 28);
  ok(uneven.bottomX.length === 4 && uneven.topX.length === 3, 'rows and columns spread on their own');
});

// ------------------------------------------------------------------- easing

test('cubic-bezier matches CSS: linear, ease and the board ease-out', () => {
  const linear = cubicBezier(0, 0, 1, 1);
  eq([0, 0.25, 0.5, 1].map((t) => Math.round(linear(t) * 1000) / 1000), [0, 0.25, 0.5, 1], 'linear');
  ok(Math.abs(cubicBezier(0.25, 0.1, 0.25, 1)(0.5) - 0.8024) < 0.001, 'ease at the midpoint');
  const out = cubicBezier(0.22, 1, 0.36, 1);
  const samples = Array.from({ length: 21 }, (_, i) => out(i / 20));
  ok(samples.every((v, i) => i === 0 || v >= samples[i - 1]), 'monotonic');
  ok(samples[0] === 0 && samples[20] === 1 && samples[10] > 0.85, 'quick to start, soft to land');
});

test('a timeline and a distribution are checked and resolved with the shared code, so a saved tour cannot disagree with the server', () => {
  warnings.length = 0;
  const lease = {
    kind: 'timeline',
    unit: 'month',
    source: 'illustrative',
    anchor: { label: 'Start' },
    events: [
      { label: 'Notice allowed', after: 'Start', offset: 3 },
      { label: 'Earliest exit', after: 'Notice allowed', offset: 3 },
    ],
    spans: [{ label: 'Notice runs', from: 'Notice allowed', to: 'Earliest exit', role: 'notice' }],
  };
  const timeline = checkBoardItem(lease, 'step "s"', warn);
  ok(timeline?.kind === 'timeline', 'a valid timeline is kept');
  eq(timeline?.kind === 'timeline' && timeline.events.map((e) => e.position), [91.3125, 182.625], 'positions are computed, not taken from the file');
  eq(checkBoardItem({ ...lease, events: [{ label: 'A', after: 'B', offset: 1 }, { label: 'B', after: 'A', offset: 1 }] }, 'step "s"', warn), null, 'a cycle is skipped');
  ok(warnings.at(-1)!.includes('each measured from another'), warnings.at(-1) ?? '');
  const bell = {
    kind: 'distribution',
    x_label: 'reaction time (ms)',
    source: 'illustrative',
    dists: [
      { family: 'normal', label: 'Before', mean: 250, sd: 30 },
      { family: 'normal', label: 'After', mean: 230, sd: 20 },
    ],
    region: { from: 300 },
  };
  const distribution = checkBoardItem(bell, 'step "s"', warn);
  ok(distribution?.kind === 'distribution' && distribution.region!.probabilities.length === 2, 'the region\'s chances are computed');
  eq(checkBoardItem({ ...bell, dists: [bell.dists[0], { family: 'binomial', label: 'x', n: 5, p: 0.5 }] }, 'step "s"', warn), null, 'discrete and continuous cannot share an axis');
  eq(sourceTag(timeline!)?.text, 'illustrative');
  eq(sourceTag(distribution!)?.text, 'illustrative');
  eq(sourceTag({ ...bell, source: 'document' } as never), null, 'a document\'s own numbers carry no tag');
});

test('a plot keeps its marks and points, and one whose mark cannot be found is skipped', () => {
  warnings.length = 0;
  const plot = {
    kind: 'plot',
    x: [0, 20],
    y: [0, 400],
    curves: [{ expression: 'x*x', label: 'n^2' }, { expression: '10*x', label: '10n' }],
    marks: [{ type: 'crossing', curve: 1, other: 2, nth: 2 }],
    points: [{ x: 5, y: 25 }],
  };
  const kept = checkBoardItem(plot, 'step "s"', warn);
  ok(kept?.kind === 'plot' && kept.marks?.length === 1 && kept.points?.length === 1, 'marks and points are kept');
  eq(checkBoardItem({ ...plot, marks: [{ type: 'root', curve: 1, nth: 4 }] }, 'step "s"', warn), null);
  ok(warnings.at(-1)!.includes('has only'), warnings.at(-1) ?? '');
});

console.log(results.join('\n'));
if (failures) throw new Error(`${failures} test(s) failed`);
console.log(`\nall ${results.length} board tests passed`);
