import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc, DocBlock, DocSentence } from '../../shared/paper';
import type { TeachingConcept, TeachingPlan, TeachingPreferences } from '../../shared/teachingPlan';
import { teachingTourPlan } from '../src/harness/teaching-plan';
import { paperPlan } from '../src/harness/beats';
import { card, doc } from './plan-fixture';

const preferences: TeachingPreferences = {
  structure: 'paper',
  depth: 'standard',
  audience: 'general',
  instructions: '',
};
const concept = (id: string, evidence: string[]): TeachingConcept => ({
  id,
  title: id,
  summary: `The paper explains ${id}.`,
  role: 'mechanism',
  evidence,
  prerequisites: [],
  importance: 'high',
  importanceReason: 'Explains the method.',
  difficulty: 'medium',
  difficultyReason: 'Requires following the computation.',
  confidence: 'high',
  objective: `Understand ${id}.`,
  misconception: '',
  visual: 'source',
  visualBenefit: '',
  visibleChange: '',
});

function floatingSources(): Doc {
  const blocks: DocBlock[] = [];
  const sentences: DocSentence[] = [];
  const section = (id: string, title: string) => {
    const heading = `${id}.heading`;
    blocks.push({
      id: heading,
      page: 1,
      type: 'heading',
      bbox: [0, 0, 200, 20],
      text: title,
      section: id,
      sentences: [],
    });
    return { id, title, level: 1, page: 1, block: heading };
  };
  const prose = (id: string, sectionId?: string, right = false) => {
    const bbox: [number, number, number, number] = right ? [310, 20, 580, 80] : [20, 500, 290, 560];
    blocks.push({ id: `${id}.block`, page: 1, type: 'paragraph', bbox, text: id, section: sectionId, sentences: [id] });
    sentences.push({ id, block: `${id}.block`, page: 1, text: id, rects: [bbox] });
  };
  const caption = (id: string, sectionId: string) => {
    blocks.push({
      id,
      page: 1,
      type: 'caption',
      bbox: [20, 100, 580, 130],
      text: id,
      section: sectionId,
      sentences: [`${id}.sentence`],
    });
    sentences.push({ id: `${id}.sentence`, block: id, page: 1, text: id, rects: [[20, 100, 580, 130]] });
  };
  const sections = [section('intro', 'Introduction')];
  prose('intro.s1', 'intro');
  caption('results-float.caption', 'intro'); // Printed before its logical Results section.
  sections.push(section('methods', 'Model construction'));
  prose('methods.left', 'methods'); // Ingestion reads the left column before the top of the right column.
  prose('methods.right', 'methods', true);
  blocks.push({
    id: 'formula.block',
    page: 1,
    type: 'equation',
    bbox: [20, 200, 580, 240],
    text: 'z = f(x)',
    section: 'methods',
    sentences: [],
  });
  sections.push(section('scaling', 'Scaling behavior'));
  prose('scaling.s1'); // Missing block.section still resolves through the actual heading's reading rank.
  sections.push(section('results', 'Experimental results'));
  prose('results.s1', 'intro'); // A stale ingestion label must not override its actual preceding Results heading.
  caption('results-late.caption', 'results');
  return {
    ...structuredClone(doc),
    blocks,
    sentences,
    sections,
    equations: [
      { id: 'formula', number: '1', page: 1, block: 'formula.block', bbox: [20, 200, 580, 240], text: 'z = f(x)' },
    ],
    figures: [
      {
        ...doc.figures[0],
        id: 'results-float',
        kind: 'table',
        caption_block: 'results-float.caption',
        referenced_by: ['results.s1'],
      },
      { ...doc.figures[0], id: 'results-late', caption_block: 'results-late.caption', referenced_by: ['results.s1'] },
    ],
  };
}

test('floating visual sources use their supporting prose section, then primary physical reading order', () => {
  const source = floatingSources();
  const concepts = [
    concept('results-late', ['results-late', 'results.s1']),
    concept('scaling', ['formula', 'scaling.s1']),
    concept('method-right', ['methods.right']),
    concept('results-first', ['results-float', 'results-float.caption.sentence', 'results.s1']),
    concept('method-left', ['methods.left']),
    concept('opening', ['intro.s1']),
  ];
  const plan: TeachingPlan = {
    version: 'teaching-plan@1',
    question: 'What changes?',
    audienceAssumption: '',
    concepts,
    sections: [],
  };
  const result = teachingTourPlan(plan, source, preferences, card, paperPlan(card, source, 'standard'));
  assert.deepEqual(
    result.chapters.map((chapter) => chapter.title),
    ['Introduction', 'Model construction', 'Scaling behavior', 'Experimental results', 'What to remember'],
  );
  assert.deepEqual(
    result.beats.map((beat) => beat.id),
    [
      'teach-opening',
      'teach-method-left',
      'teach-method-right',
      'teach-scaling',
      'teach-results-first',
      'teach-results-late',
      'takeaway-1',
    ],
  );
  assert.equal(result.beats.length, concepts.length + 1, 'all concepts survive semantic grouping');
  assert.equal(result.beats[3].target, 'formula', 'semantic grouping preserves the original visual target');
  assert.equal(result.beats[3].kind, 'formula');
  assert.equal(result.beats[4].target, 'results-float');
  assert.equal(result.beats[5].target, 'results-late');
  assert.equal(result.beats[4].arc, result.beats[5].arc, 'early and late floats share the actual Results chapter');
});

test('a visual without supporting prose retains its own source section', () => {
  const source = floatingSources();
  const plan: TeachingPlan = {
    version: 'teaching-plan@1',
    question: 'What changes?',
    audienceAssumption: '',
    sections: [],
    concepts: [concept('caption-only', ['results-float'])],
  };
  const result = teachingTourPlan(plan, source, preferences, card, paperPlan(card, source, 'standard'));
  assert.equal(result.chapters[0].title, 'Introduction');
  assert.equal(result.beats[0].target, 'results-float');
});
