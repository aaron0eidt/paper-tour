import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc, Tour } from '../../shared/paper';
import { clipsTableRow, isTableTarget, tableTextBlocks } from '../../shared/tableTargets';
import { beatTargets, cleanDirection, beatBrief, directionSchema, directOptions } from '../src/harness/direct';
import { beatStep } from '../src/harness/assemble';
import { Resolver, prepareTour } from '../../player/src/resolve';
import type { Beat } from '../src/harness/beats';
const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'rows.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  sentences: [],
  equations: [],
  blocks: [
    { id: 'p1.b1', type: 'table_text', page: 1, bbox: [100, 200, 500, 220], text: 'Baseline 4.9 25.8', sentences: [] },
    { id: 'p1.b2', type: 'table_text', page: 1, bbox: [100, 240, 500, 260], text: 'Variant 5.2 24.9', sentences: [] },
  ],
  figures: [
    {
      id: 'tab1',
      kind: 'table',
      number: '1',
      page: 1,
      bbox: [90, 180, 510, 280],
      caption: 'Variants',
      image: 'table.png',
      panels: [],
      referenced_by: [],
    },
  ],
};
const beat: Beat = {
  id: 'table',
  kind: 'figure',
  arc: 'evidence',
  point: 'Compare variants',
  evidence: [],
  target: 'tab1',
};
test('table direction uses complete grounded text blocks and rejects invented subdivisions', () => {
  const targets = beatTargets(beat, doc);
  assert.deepEqual(targets.tableCells, ['p1.b1', 'p1.b2']);
  assert.match(beatBrief(beat, doc, targets), /\[p1.b1\] Baseline 4.9/);
  const raw = {
    plan: 'Compare rows',
    say: 'The baseline has lower perplexity than the variant in this comparison.',
    cues: [{ action: 'box', target: 'p1.b1', region: 'whole', label: '', anchor: 'baseline' }],
  };
  const direction = cleanDirection(raw, beat, targets)!;
  assert.deepEqual(direction.visualProblems, []);
  const step = beatStep(beat, targets, direction, doc, new Set());
  assert.ok(step.actions.some((a) => a.type === 'box' && a.target === 'p1.b1' && !a.region));
  const invented = cleanDirection({ ...raw, cues: [{ ...raw.cues[0], region: 'bottom-half' }] }, beat, targets)!;
  assert.ok(invented.visualProblems?.length);
  assert.throws(() => beatStep(beat, targets, invented, doc, new Set()), /fine geometry requires/);
});
test('table source marks stay boxes while the separate board can focus its parts', () => {
  const targets = beatTargets(beat, doc);
  assert.deepEqual(directionSchema(beat, targets).properties.cues.items.properties.action.enum, ['box', 'board_focus']);
  assert.deepEqual(directOptions(beat, 'research_paper', targets).actions, ['box', 'board_focus']);
  assert.match(beatBrief(beat, doc, targets), /one extracted block can contain several rows/);
  for (const action of ['arrow', 'circle']) {
    const direction = cleanDirection(
      {
        plan: 'Compare rows',
        say: 'The baseline has lower perplexity than the variant in this comparison.',
        cues: [{ action, target: 'p1.b1', region: 'bottom-half', label: 'Best value', anchor: 'baseline' }],
      },
      beat,
      targets,
    )!;
    assert.ok(direction.visualProblems?.some((p) => p.includes('fine geometry requires')));
    assert.throws(() => beatStep(beat, targets, direction, doc, new Set()), /fine geometry requires/);
  }
});
test('legacy table arrows and circles become unlabelled outlines, even for merged rows or nested figures', () => {
  const merged = structuredClone(doc);
  merged.blocks[0].text = 'Baseline 27.3 38.1\nLarger model 28.4 41.8';
  merged.blocks[0].bbox = [100, 200, 500, 235];
  merged.figures.push({ ...merged.figures[0], id: 'fig1', kind: 'figure', bbox: [100, 200, 500, 235] });
  assert.equal(isTableTarget(merged, 'fig1'), true);
  assert.equal(isTableTarget(merged, 'page1'), false);
  const tour = {
    chapters: [
      {
        id: 'c',
        title: 'Rows',
        steps: [
          {
            id: 's',
            say: 'Compare the larger model result with the baseline.',
            actions: [
              {
                type: 'arrow',
                target: 'p1.b1',
                from: 'left',
                label: '28.4',
                region: [0.5, 0, 1, 0.5],
                color: 'blue',
                at_word: 3,
              },
              { type: 'circle', target: 'fig1', label: 'Best score', persist: true },
            ],
          },
        ],
      },
    ],
  } as Tour;
  const prepared = prepareTour(tour, new Resolver(merged, merged.pages));
  assert.deepEqual(prepared.tour.chapters[0].steps[0].actions, [
    { type: 'box', target: 'p1.b1', color: 'blue', at_word: 3 },
    { type: 'box', target: 'fig1', persist: true },
  ]);
  assert.deepEqual(prepared.problems, []);
});
test('legacy row clipping is detected without guessing intended row semantics', () => {
  assert.equal(tableTextBlocks(doc, doc.figures[0]).length, 2);
  assert.equal(clipsTableRow(doc, 'tab1', [0, 0.15, 1, 0.7]), true); // bottom crosses variant
  assert.equal(clipsTableRow(doc, 'tab1', [0, 0.15, 1, 0.45]), false); // complete baseline
  const tour = {
    chapters: [
      {
        id: 'c',
        title: 'Rows',
        steps: [
          {
            id: 's',
            say: 'Compare baseline performance.',
            actions: [{ type: 'box', target: 'tab1', region: [0, 0.15, 1, 0.7], label: 'Baseline' }],
          },
        ],
      },
    ],
  } as Tour;
  const prepared = prepareTour(tour, new Resolver(doc, doc.pages));
  assert.deepEqual(prepared.tour.chapters[0].steps[0].actions[0], { type: 'box', target: 'tab1' });
  assert.ok(prepared.problems.some((p) => p.message.includes('table annotations')));
  const many = structuredClone(tour);
  many.chapters[0].steps[0].actions.push(...many.chapters[0].steps[0].actions);
  assert.equal(prepareTour(many, new Resolver(doc, doc.pages)).problems.length, 1);
});
