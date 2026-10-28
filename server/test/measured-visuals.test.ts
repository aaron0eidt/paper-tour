import test from 'node:test';
import assert from 'node:assert/strict';
import type { TourImage } from '../src/tour-generator';
import { createMeasuredFigureTargets, parseMeasuredTargets } from '../src/harness/measured-visuals';

const image: TourImage = {
  targetId: 'fig1',
  kind: 'figure',
  page: 1,
  label: 'Diagram',
  dataUrl: 'data:image/png;base64,AA==',
};
const result = { targets: [{ kind: 'component', label: ' Mixer ', region: [0.1, 0.2, 0.4, 0.3] }] };

test('measured target parser distinguishes legitimate empty results from a broken protocol', () => {
  assert.deepEqual(parseMeasuredTargets({ targets: [] }), []);
  for (const bad of [
    null,
    {},
    { targets: null },
    { targets: [null] },
    { targets: [{ ...result.targets[0], region: [0.8, 0, 0.1, 1] }] },
  ])
    assert.throws(() => parseMeasuredTargets(bad), /visual analysis/);
});

test('completed measurements cache by image content, rebind IDs and never expose mutable cached bounds', async () => {
  let calls = 0;
  const measure = createMeasuredFigureTargets(async () => {
    calls++;
    return result;
  }, 1);
  const first = await measure(image);
  first[0].region[0] = 0.99;
  const second = await measure({ ...image, targetId: 'fig2' });
  assert.equal(calls, 1);
  assert.deepEqual(second[0], {
    id: 'measured:fig2:1',
    target: 'fig2',
    kind: 'component',
    label: 'Mixer',
    region: [0.1, 0.2, 0.4, 0.3],
  });
  await measure({ ...image, dataUrl: 'data:image/png;base64,BA==' });
  await measure(image);
  assert.equal(calls, 3, 'bounded cache evicts old image content');
});

test('one aborted question cannot cancel another measurement of the same image', async () => {
  const pending: { finish: (v: unknown) => void; signal?: AbortSignal }[] = [];
  const measure = createMeasuredFigureTargets(
    (_image, signal) =>
      new Promise((finish, fail) => {
        pending.push({ finish, signal });
        signal?.addEventListener('abort', () => fail(signal.reason), { once: true });
      }),
  );
  const a = new AbortController(),
    b = new AbortController();
  const first = measure(image, a.signal);
  const second = measure(image, b.signal);
  a.abort(new Error('Question cancelled'));
  await assert.rejects(first, /Question cancelled/);
  assert.equal(pending[1].signal?.aborted, false);
  pending[1].finish(result);
  assert.equal((await second).length, 1);
  assert.equal((await measure(image)).length, 1, 'successful independent result is cached');
});

test('detector errors are surfaced and not cached as an empty catalog', async () => {
  let calls = 0;
  const measure = createMeasuredFigureTargets(async () => {
    calls++;
    if (calls === 1) throw new Error('OCR timed out');
    return result;
  });
  await assert.rejects(measure(image), /OCR timed out/);
  assert.equal((await measure(image)).length, 1);
  assert.equal(calls, 2);
});
