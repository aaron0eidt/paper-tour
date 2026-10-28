import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020.js';
import {
  SCENE_SCHEMA,
  projectScenePoint,
  sceneObjectGeometry,
  scenePlotBounds,
  sceneProblems,
  sceneMatrixText,
  type SceneItem,
  type SceneObject,
} from '../../shared/scene';

const scene = (): SceneItem => ({
  kind: 'scene',
  title: 'An illustrative transformation',
  objects: [
    { id: 'heading', type: 'text', x: 0.05, y: 0.02, w: 0.9, h: 0.1, text: 'Input, transformation and output' },
    { id: 'group', type: 'rect', x: 0.02, y: 0.15, w: 0.58, h: 0.6, background: true },
    {
      id: 'input',
      type: 'matrix',
      x: 0.05,
      y: 0.2,
      w: 0.2,
      h: 0.25,
      values: [
        [1, 2],
        [3, 4],
      ],
    },
    { id: 'apply', type: 'arrow', x: 0.27, y: 0.32, w: 0.08, h: 0 },
    {
      id: 'output',
      type: 'matrix',
      x: 0.38,
      y: 0.2,
      w: 0.2,
      h: 0.25,
      values: [
        [2, 4],
        [6, 8],
      ],
    },
    { id: 'operation', type: 'math', x: 0.05, y: 0.55, w: 0.5, h: 0.12, text: 'y=2x' },
    {
      id: 'plane',
      type: 'plot',
      x: 0.64,
      y: 0.18,
      w: 0.32,
      h: 0.65,
      background: true,
      plot: {
        kind: 'plot',
        x: [-2, 2],
        y: [-2, 2],
        curves: [{ expression: 'a*x', label: 'Scaled input' }],
        parameter: { from: 0, to: 1 },
      },
    },
    { id: 'direction', type: 'vector', x: 0, y: 0, w: 1, h: 1, plotId: 'plane', color: 'blue' },
  ],
});
const close = (actual: number, expected: number) =>
  assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} ~= ${expected}`);
const invalid = (value: unknown, pattern: RegExp) => assert.match(sceneProblems(value).join(' '), pattern);

test('one scene can combine matrices, math, directed geometry and a safely parameterized plot', () => {
  const item = scene(),
    before = JSON.stringify(item);
  assert.deepEqual(sceneProblems(item), []);
  const validate = new Ajv2020({ strict: false }).compile(SCENE_SCHEMA);
  assert.equal(validate(item), true, JSON.stringify(validate.errors));
  assert.equal(JSON.stringify(item), before, 'validation never rewrites geometry or drops an object');
});

test('canonical tour schema contains the same scene protocol as runtime authoring', () => {
  const schema = JSON.parse(readFileSync(new URL('../../schema/tour.schema.json', import.meta.url), 'utf8'));
  const board = schema.$defs.boardItem.oneOf.find(
    (item: any) => item.properties.kind?.enum?.includes('scene') || item.properties.kind?.const === 'scene',
  );
  assert.deepEqual(board, SCENE_SCHEMA);
  const validate = new Ajv2020({ strict: false }).compile(schema);
  const tour = {
    schema: 'paper-tour/tour@0.1',
    title: 'Scene',
    paper: 'test',
    chapters: [
      {
        id: 'c',
        title: 'C',
        steps: [
          {
            id: 'one',
            say: 'We transform this input into the corresponding output.',
            actions: [
              { type: 'board', item: scene() },
              { type: 'board_focus', part: 7, at_word: 3 },
            ],
          },
        ],
      },
    ],
  };
  assert.equal(validate(tour), true, JSON.stringify(validate.errors));
});

test('invalid identity, dimensions and data are reported without partial acceptance', () => {
  const duplicate = scene();
  duplicate.objects[1].id = duplicate.objects[0].id;
  invalid(duplicate, /repeats ID/);
  const outside = scene();
  outside.objects[0].x = 0.95;
  invalid(outside, /outside the normalized/);
  const negative = scene();
  negative.objects[2].w = -0.1;
  invalid(negative, /positive area/);
  const emptyLine = scene();
  emptyLine.objects[3].w = 0;
  invalid(emptyLine, /nonzero directed length/);
  const ragged = scene();
  ragged.objects[2].values = [[1, 2], [3]];
  invalid(ragged, /rectangular/);
  const infinite = scene();
  infinite.objects[2].values = [[Infinity]];
  invalid(infinite, /finite values/);
  invalid({ ...scene(), objects: [null, ...scene().objects] }, /must be an object/);
});

test('readable foreground objects may not overlap unless geometry is explicitly background', () => {
  const item: SceneItem = {
    kind: 'scene',
    objects: [
      { id: 'container', type: 'rect', x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      { id: 'label', type: 'text', x: 0.2, y: 0.2, w: 0.3, h: 0.15, text: 'Readable label' },
    ],
  };
  invalid(item, /container and label overlap/);
  item.objects[0].background = true;
  assert.deepEqual(sceneProblems(item), []);
  item.objects[1].background = true;
  invalid(item, /background is reserved/);
});

test('connector collision checks the real line while allowing boundary contact', () => {
  const item: SceneItem = {
    kind: 'scene',
    objects: [
      { id: 'label', type: 'text', x: 0.4, y: 0.4, w: 0.2, h: 0.2, text: 'Source' },
      { id: 'line', type: 'arrow', x: 0.1, y: 0.5, w: 0.3, h: 0 },
    ],
  };
  assert.deepEqual(sceneProblems(item), [], 'connection may end exactly on the source boundary');
  item.objects[1].w = 0.8;
  invalid(item, /overlap/);
  item.objects[1] = { id: 'line', type: 'arrow', x: 0.1, y: 0.9, w: 0.8, h: -0.3 };
  assert.deepEqual(sceneProblems(item), [], 'diagonal enclosing rectangle alone does not imply crossing content');
});

test('plot-domain vectors and circles share the exact inner axis transform', () => {
  const item = scene(),
    plane = item.objects.find((object) => object.id === 'plane')!;
  const bounds = scenePlotBounds(plane);
  close(bounds.x, 0.64 + 0.32 * 0.12);
  close(bounds.w, 0.32 * 0.84);
  const origin = projectScenePoint(plane, 0, 0);
  close(origin[0], bounds.x + bounds.w / 2);
  close(origin[1], bounds.y + bounds.h / 2);
  const vector = sceneObjectGeometry(item.objects[7], item.objects);
  const tip = projectScenePoint(plane, 1, 1);
  close(vector.x + vector.w, tip[0]);
  close(vector.y + vector.h, tip[1]);
  assert.ok(vector.h < 0, 'positive mathematical y points upward on the screen');
  const circle: SceneObject = {
    id: 'unit',
    type: 'circle',
    x: -1,
    y: -1,
    w: 2,
    h: 2,
    plotId: 'plane',
    background: true,
  };
  item.objects.push(circle);
  assert.deepEqual(sceneProblems(item), []);
  const geometry = sceneObjectGeometry(circle, item.objects);
  const topLeft = projectScenePoint(plane, -1, 1),
    bottomRight = projectScenePoint(plane, 1, -1);
  close(geometry.x, topLeft[0]);
  close(geometry.y, topLeft[1]);
  close(geometry.x + geometry.w, bottomRight[0]);
  close(geometry.y + geometry.h, bottomRight[1]);
});

test('guessed or invalid plot bindings never silently clip or misalign arrows', () => {
  const unbound = scene();
  unbound.objects[7] = { id: 'direction', type: 'vector', x: 0.7, y: 0.4, w: 0.15, h: -0.1 };
  invalid(unbound, /without plotId/);
  const missing = scene();
  missing.objects[7].plotId = 'missing';
  invalid(missing, /missing or invalid plot/);
  const outside = scene();
  outside.objects[7].w = 3;
  invalid(outside, /outside plot/);
  const wrongType = scene();
  wrongType.objects[2].plotId = 'plane';
  invalid(wrongType, /supported only/);
});

test('scenes expose no executable fields, unsafe math resources or arbitrary plot expressions', () => {
  invalid({ ...scene(), code: 'fetch("https://example.test")' }, /unsupported fields/);
  const html = scene();
  (html.objects[0] as unknown as Record<string, unknown>).html = '<script>alert(1)</script>';
  invalid(html, /unsupported fields/);
  const math = scene();
  math.objects[5].text = String.raw`\href{https://example.test}{click}`;
  invalid(math, /cannot use HTML/);
  const expression = scene();
  expression.objects[6].plot!.curves[0].expression = 'globalThis.fetch(x)';
  invalid(expression, /Unknown variable|Unexpected token/);
});

test('text bounds must fit their readable line count rather than silently clipping', () => {
  const item: SceneItem = {
    kind: 'scene',
    objects: [{ id: 'label', type: 'text', x: 0.1, y: 0.1, w: 0.01, h: 0.01, text: 'Input' }],
  };
  invalid(item, /too small for readable text/);
  item.objects[0] = {
    ...item.objects[0],
    w: 0.32,
    h: 0.1,
    text: 'Input values become output values after the operation',
  };
  invalid(item, /text line/);
  item.objects[0].h = 0.35;
  assert.deepEqual(sceneProblems(item), [], 'a readable wrapped block fits without shrinking its font');
  item.objects[0] = { ...item.objects[0], w: 0.12, h: 0.2, text: 'Input' };
  assert.deepEqual(sceneProblems(item), [], 'short labels can still use compact bounds');
});

test('math reserves readable width and extra height for stacked fractions', () => {
  const item: SceneItem = {
    kind: 'scene',
    objects: [{ id: 'formula', type: 'math', x: 0.1, y: 0.1, w: 0.08, h: 0.1, text: 'a+b+c+d+e=f' }],
  };
  invalid(item, /too small for readable math/);
  item.objects[0].w = 0.4;
  assert.deepEqual(sceneProblems(item), []);
  item.objects[0].text = String.raw`\frac{a}{b}`;
  invalid(item, /too small for readable math/);
  item.objects[0].h = 0.2;
  assert.deepEqual(sceneProblems(item), [], 'fractions remain accepted when there is room to read both rows');
});

test('matrix bounds depend on rows, columns, displayed digits and the optional label', () => {
  const item: SceneItem = {
    kind: 'scene',
    objects: [
      {
        id: 'matrix',
        type: 'matrix',
        x: 0.05,
        y: 0.05,
        w: 0.01,
        h: 0.01,
        values: [
          [1, 2],
          [3, 4],
        ],
      },
    ],
  };
  const unchanged = JSON.stringify(item);
  invalid(item, /too small for a readable 2×2 matrix/);
  assert.equal(JSON.stringify(item), unchanged, 'reject without widening, shrinking values or dropping cells');
  Object.assign(item.objects[0], { w: 0.2, h: 0.3 });
  assert.deepEqual(sceneProblems(item), [], 'compact two-by-two matrix remains usable');
  item.objects[0].values = [
    [123456, 123456],
    [123456, 123456],
  ];
  invalid(item, /too small for a readable/);
  item.objects[0].w = 0.5;
  assert.deepEqual(sceneProblems(item), [], 'larger digits receive wider cells');
  item.objects[0].text = 'This matrix label is far too long to fit inside the authored matrix';
  invalid(item, /matrix label does not fit/);
  item.objects[0].text = 'Output';
  item.objects[0].values = Array.from({ length: 6 }, () => [1, 2, 3, 4, 5, 6]);
  invalid(item, /too small for a readable 6×6 matrix/);
  Object.assign(item.objects[0], { w: 0.7, h: 0.7 });
  assert.deepEqual(sceneProblems(item), [], 'six-by-six matrices fit in a useful larger part of the canvas');
});

test('matrix width estimation uses the same exact or explicitly approximate text as rendering', () => {
  assert.equal(sceneMatrixText(1234), '1234');
  assert.equal(sceneMatrixText(999999), '999999');
  assert.equal(sceneMatrixText(0.1234), '0.1234');
  assert.equal(sceneMatrixText(1.414213562), '≈1.41');
  assert.equal(sceneMatrixText(1e-7), '1e-7');
  assert.equal(sceneMatrixText(1.234e-7), '≈1.23e-7');
});
