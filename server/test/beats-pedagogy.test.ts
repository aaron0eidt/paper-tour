import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc } from '../../shared/paper';
import type { PaperCard } from '../src/harness/card';
import { paperPlan, planBeats } from '../src/harness/beats';
import { indexElements } from '../src/elements';

const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'causal.pdf', sha256: 'a'.repeat(64), num_pages: 2, generator: 'test' },
  pages: [
    { n: 1, width: 600, height: 800 },
    { n: 2, width: 600, height: 800 },
  ],
  sections: [],
  blocks: [
    { id: 'b1', page: 1, type: 'paragraph', bbox: [50, 50, 550, 90], text: 'Setup.', sentences: ['s1'] },
    {
      id: 'b2',
      page: 1,
      type: 'paragraph',
      bbox: [50, 120, 550, 180],
      text: 'Mechanism and cause.',
      sentences: ['s2', 's3'],
    },
    { id: 'b3', page: 2, type: 'paragraph', bbox: [50, 50, 550, 90], text: 'Evidence.', sentences: ['s4', 's5'] },
  ],
  sentences: [
    { id: 's1', page: 1, block: 'b1', text: 'A bottleneck motivates a different method.', rects: [[50, 50, 550, 70]] },
    {
      id: 's2',
      page: 1,
      block: 'b2',
      text: 'The method changes the intermediate representation.',
      rects: [[50, 120, 550, 140]],
    },
    {
      id: 's3',
      page: 1,
      block: 'b2',
      text: 'This removes the dependence that caused the bottleneck.',
      rects: [[50, 150, 550, 170]],
    },
    {
      id: 's4',
      page: 2,
      block: 'b3',
      text: 'The baseline scores 60 under the same conditions.',
      rects: [[50, 50, 550, 65]],
    },
    { id: 's5', page: 2, block: 'b3', text: 'The proposed method scores 75.', rects: [[50, 70, 550, 85]] },
  ],
  figures: [
    {
      id: 'fig1',
      kind: 'figure',
      number: '1',
      page: 1,
      bbox: [50, 300, 550, 500],
      caption: 'Mechanism',
      panels: [],
      image: '',
      referenced_by: ['s2'],
    },
    {
      id: 'tab1',
      kind: 'table',
      number: '1',
      page: 2,
      bbox: [50, 200, 550, 400],
      caption: 'Comparison',
      panels: [],
      image: '',
      referenced_by: ['s4', 's5'],
    },
  ],
  equations: [{ id: 'eq1', page: 1, number: '1', bbox: [50, 220, 550, 250], text: 'y=2x' }],
};
const card: PaperCard = {
  plan: 'Explain the bottleneck, mechanism and comparison.',
  title: 'A causal explanation',
  doc_type: 'research_paper',
  chapter_titles: {
    problem: 'Problem',
    idea: 'Idea',
    method: 'Mechanism',
    evidence: 'Evidence',
    limits: 'Limits',
    takeaway: 'Takeaway',
  },
  problem: { text: 'The baseline has a bottleneck.', evidence: ['s1'] },
  key_idea: { text: 'Change the intermediate representation.', evidence: ['s2'] },
  method_steps: [{ text: 'The transformation removes a dependence.', evidence: ['s2'] }],
  key_figures: [
    { id: 'tab1', why: 'Compare matched settings.' },
    { id: 'fig1', why: 'Trace the mechanism.' },
  ],
  key_formulas: [{ id: 'eq1', why: 'Compute the transformation.' }],
  results: [
    { text: 'The baseline scores 60.', evidence: ['s4'] },
    { text: 'The proposed method scores 75.', evidence: ['s5'] },
  ],
  limitations: [],
  takeaway: { text: 'The mechanism addresses the bottleneck under these conditions.', evidence: ['s5'] },
  suggested_questions: ['Which dependence is removed?'],
};

test('deep mechanism coverage includes the causal paragraph without adding unrelated pages or duplicate beats', () => {
  const deep = planBeats(card, doc, 'deep');
  const method = deep.filter((b) => b.kind === 'method');
  assert.equal(method.length, 1, 'depth enriches the mechanism rather than duplicating its summary');
  assert.deepEqual(method[0].evidence, ['s2', 's3']);
  assert.ok(!method[0].evidence.includes('s4'));
  assert.deepEqual(planBeats(card, doc, 'standard').find((b) => b.kind === 'method')!.evidence, ['s2']);
});

test('deep visual details teach a worked mechanism or numerical contrast rather than replaying orientation', () => {
  const beats = planBeats(card, doc, 'deep');
  for (const target of ['fig1', 'tab1', 'eq1']) {
    const pair = beats.filter((b) => b.target === target);
    assert.equal(pair.length, 2);
    assert.notEqual(pair[0].role, pair[1].role);
    assert.equal(pair[1].detail, true);
  }
  const comparison = beats.find((b) => b.target === 'tab1' && b.detail)!;
  assert.match(comparison.role!, /size of the difference/);
  assert.match(comparison.notes!.join(' '), /synchronize each value/);
  for (const result of beats.filter((b) => b.kind === 'result'))
    assert.deepEqual(result.boardEvidence, ['s4', 's5'], 'the writer can see both sides of a comparison');
});

test('teaching steps preserve the original forward PDF order and end with the conclusion', () => {
  const plan = paperPlan(card, doc, 'deep');
  const elements = new Map(indexElements(doc).map((e) => [e.id, e]));
  const pages = plan.beats
    .filter((b) => b.kind !== 'takeaway')
    .map((b) => elements.get(b.target ?? b.evidence[0])!.page);
  assert.deepEqual(
    pages,
    [...pages].sort((a, b) => a - b),
  );
  assert.equal(plan.beats.at(-1)!.kind, 'takeaway');
});
