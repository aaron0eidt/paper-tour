import test from 'node:test';
import assert from 'node:assert/strict';
import { beatStep, findAnchor } from '../src/harness/assemble';
import { beatBrief, beatTargets, type Direction } from '../src/harness/direct';
import type { Doc } from '../../shared/paper';

const doc: Doc = {
  schema: 'paper-tour/doc@0.1', source: { file: 'paper.pdf', sha256: '0'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }], sections: [], equations: [], figures: [],
  blocks: [{ id: 'block', page: 1, bbox: [40, 400, 560, 650], type: 'paragraph', text: 'Premise. Consequence.', sentences: ['premise', 'consequence'] }],
  sentences: [
    { id: 'premise', page: 1, block: 'block', text: 'First the premise.', rects: [[40, 400, 560, 420]] },
    { id: 'consequence', page: 1, block: 'block', text: 'Then the consequence.', rects: [[40, 600, 560, 620]] },
  ],
};
const beat = { id: 'idea-1', kind: 'idea' as const, arc: 'idea', point: 'A useful mechanism.', evidence: ['consequence', 'premise'] };
const targets = beatTargets(beat, doc);

test('prose evidence is supplied in reading order rather than relevance ranking', () => {
  const brief = beatBrief(beat, doc, targets);
  assert.ok(brief.indexOf('[premise]') < brief.indexOf('[consequence]'));
});

test('initial prose focus follows the first spoken cue and keeps the anchors synchronized', () => {
  const direction: Direction = { plan: '', say: 'First consider the premise. It explains why the consequence holds.', cues: [
    { action: 'highlight', target: 'consequence', anchor: 'the consequence holds', label: '' },
    { action: 'highlight', target: 'premise', anchor: 'consider the premise', label: '' },
  ] };
  const step = beatStep(beat, targets, direction, doc);
  assert.deepEqual(step.actions[0], { type: 'focus', target: 'premise' });
  for (const cue of direction.cues) {
    const action = step.actions.find((a) => a.type === 'highlight' && a.targets.includes(cue.target));
    assert.equal(action?.at_word ?? 0, findAnchor(direction.say, cue.anchor));
  }
});

test('unknown anchors cannot move the camera and deliberate visual zooms stay intact', () => {
  const direction: Direction = { plan: '', say: 'The consequence follows from this premise.', cues: [
    { action: 'highlight', target: 'premise', anchor: 'not actually spoken', label: '' },
  ] };
  assert.deepEqual(beatStep(beat, targets, direction, doc).actions[0], { type: 'focus', target: 'consequence' });
  assert.deepEqual(beatStep({ ...beat, target: 'eq1' }, targets, direction, doc).actions[0], { type: 'zoom', target: 'eq1' });
});
