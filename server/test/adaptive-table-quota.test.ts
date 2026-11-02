import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc, DocFigure } from '../../shared/paper';
import { LEGACY_BOARD_KINDS } from '../src/harness/board';
import type { Beat } from '../src/harness/beats';
import type { Unit } from '../src/harness/exercise';
import { tableViews } from '../src/harness/tables';
import {
  allocateFrames,
  cleanOpeningPlan,
  cleanVisualPlan,
  exampleKinds,
  openingPlanTask,
  visualPlanTask,
  withTableBoard,
  type VisualPlan,
} from '../src/harness/visual-plan';
import { doc as base } from './plan-fixture';

const table: DocFigure = {
  id: 'tab-results',
  kind: 'table',
  number: '1',
  page: 2,
  bbox: [0, 160, 400, 300],
  caption: 'Measured irrigation savings and pumping cost',
  image: 'figures/table.png',
  panels: [],
  referenced_by: [],
  grid: {
    confidence: 'high',
    method: 'spans',
    label_header: 'Method',
    columns: [
      { name: 'Water saved (%)', kind: 'number', better: 'up' },
      { name: 'Cost (EUR)', kind: 'number', better: 'down' },
    ],
    rows: [
      {
        label: 'Fixed schedule',
        cells: [
          { text: '0', value: 0 },
          { text: '480', value: 480 },
        ],
      },
      {
        label: 'Timer',
        cells: [
          { text: '12.5', value: 12.5 },
          { text: '430', value: 430 },
        ],
      },
      {
        label: 'Probes',
        cells: [
          { text: '31.4', value: 31.4 },
          { text: '392.5', value: 392.5 },
        ],
      },
    ],
  },
};
const doc: Doc = { ...base, figures: [...base.figures, table] };
const mechanisms: Beat[] = Array.from({ length: 5 }, (_, i) => ({
  id: `method-${i}`,
  kind: 'method',
  arc: 'method',
  point: `A distinct relationship ${i}`,
  evidence: ['p1.s3'],
}));
const result: Beat = {
  id: 'result-table',
  kind: 'figure',
  arc: 'results',
  point: 'Compare the measured trade-off',
  target: table.id,
  evidence: [],
};
const beats = [...mechanisms, result];
const fullPlan = (flexible: boolean): VisualPlan =>
  new Map(
    beats.map((beat) => [
      beat.id,
      {
        visual: beat === result ? 'none' : 'scatter',
        idea: beat.point,
        data: '',
        ...(flexible ? { flexible: true } : {}),
      },
    ]),
  );

test('adaptive measured-table visuals ignore kind/share quotas and preserve every existing useful board', () => {
  const original = fullPlan(true),
    before = JSON.stringify([...original]);
  const { plan, adjusted } = withTableBoard(original, beats, doc);
  assert.equal(plan.get(result.id)?.visual, tableViews(table)[0].kind);
  assert.equal(plan.get(result.id)?.table, table.id);
  assert.ok(plan.get(result.id)?.flexible, 'table insertion retains the adaptive frame policy');
  for (const beat of mechanisms)
    assert.deepEqual(plan.get(beat.id), original.get(beat.id), 'no earlier visual is sacrificed to make room');
  assert.equal([...plan.values()].filter((entry) => entry.visual !== 'none').length, beats.length);
  assert.equal(adjusted.length, 1, 'only the measured table assignment changes');
  assert.equal(adjusted[0].beat, result.id);
  assert.equal(JSON.stringify([...original]), before, 'the input plan stays immutable');
});

test('explicit adaptive options work for unmarked plans and retain unrestricted example frames', () => {
  const { plan } = withTableBoard(fullPlan(false), beats, doc, new Set(), { adaptive: true });
  assert.equal(plan.get(result.id)?.table, table.id);
  assert.ok([...plan.values()].every((entry) => entry.flexible));
  const allocated = allocateFrames(plan, beats);
  assert.deepEqual(exampleKinds(allocated.get(result.id)), LEGACY_BOARD_KINDS);
  assert.deepEqual(
    exampleKinds({ ...plan.get(result.id)!, frames: ['bars'] }),
    LEGACY_BOARD_KINDS,
    'stale legacy frame allotments cannot restrict an adaptive entry',
  );
});

test('adaptive table planning adds nothing without measured data and does not displace an already settled result', () => {
  const original = fullPlan(true);
  const noTable = withTableBoard(original, beats, base);
  assert.deepEqual([...noTable.plan], [...original]);
  assert.deepEqual(noTable.adjusted, []);
  const settled = withTableBoard(original, beats, doc, new Set([result.id]));
  assert.equal(settled.plan.get(result.id)?.visual, 'none');
  assert.deepEqual(settled.adjusted, []);
  const drawn = fullPlan(true);
  drawn.set(result.id, { visual: 'bars', idea: 'Read the actual savings', data: '', flexible: true });
  const kept = withTableBoard(drawn, beats, doc);
  assert.equal(kept.plan.get(result.id)?.visual, 'bars');
  assert.equal(kept.plan.get(result.id)?.table, table.id);
  assert.deepEqual(kept.adjusted, [], 'a grounded comparison does not need extra content to meet a quota');
});

test('adaptive sheet planning permits useful repeated kinds across parts without imposing visual counts', () => {
  const unit = { task: { id: 'one-task' } } as Unit;
  const parts = mechanisms.slice(0, 3).map((beat) => ({ ...beat, unit }));
  const value = {
    beats: parts.map((beat) => ({
      beat: beat.id,
      visual: 'plot',
      idea: beat.point,
      data: 'Different illustrative inputs.',
    })),
  };
  const checked = cleanVisualPlan(value, parts, { adaptive: true, sheet: true });
  assert.deepEqual(checked.adjusted, []);
  assert.ok([...checked.plan!.values()].every((entry) => entry.visual === 'plot' && entry.flexible));
  const task = visualPlanTask('en-US', { adaptive: true, sheet: true });
  assert.match(task, /no per-kind quota/);
  assert.doesNotMatch(task, /At most one visual per task|about half|each kind once/);
});

test('adaptive opening visuals use learning value and unrestricted native example frames', () => {
  const opening = mechanisms[0];
  const value = {
    beats: [{ beat: opening.id, visual: 'formula', idea: 'Reveal the computation', data: 'Illustrative inputs.' }],
  };
  const adaptive = cleanOpeningPlan(value, opening, { adaptive: true });
  assert.ok(adaptive.visual?.flexible);
  assert.deepEqual(exampleKinds(adaptive.visual!), LEGACY_BOARD_KINDS);
  const task = openingPlanTask('en-US', { adaptive: true });
  assert.match(task, /no per-kind quota/);
  assert.doesNotMatch(task, /half of all|at most once|must be simple/);
  assert.deepEqual(
    cleanOpeningPlan(value, opening).visual?.frames,
    ['formula'],
    'legacy opening contracts remain unchanged',
  );
});
