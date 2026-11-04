import assert from 'node:assert/strict';
import test from 'node:test';
import type { Doc } from '../../shared/paper';
import { tourEngine } from '../src/tour-worker';

// Which engine writes a new tour: the paper agent for research papers when it is enabled, the harness's tutor and arcs
// for every other kind of document.

const page = (n: number, width = 612, height = 792) => ({ n, width, height });
const block = (id: string, text: string, type = 'paragraph', page = 1) => ({
  id,
  page,
  type,
  text,
  bbox: [0, 0, 100, 20],
  sentences: [`${id}.s1`],
});
const doc = (overrides: Partial<Doc>): Doc =>
  ({
    schema: 'paper-tour/doc@0.1',
    source: { file: 'paper.pdf', sha256: 'x', num_pages: 1 },
    pages: [page(1)],
    sections: [],
    blocks: [block('p1.b1', 'Some text about the subject.')],
    sentences: [{ id: 'p1.b1.s1', block: 'p1.b1', page: 1, text: 'Some text about the subject.' }],
    figures: [],
    equations: [],
    ...overrides,
  }) as unknown as Doc;

const paper = doc({
  sections: [{ id: 'sec-abstract', title: 'Abstract', level: 1, page: 1, block: 'p1.b1' }] as Doc['sections'],
  blocks: [block('p1.b1', 'Abstract'), block('p1.b2', 'We show that attention is enough.')] as Doc['blocks'],
});
const sheet = doc({
  exercises: [
    { id: 'ex1', number: '1', page: 1, block: 'p1.b1', blocks: ['p1.b1'], parts: [] },
  ] as unknown as Doc['exercises'],
});
const deck = doc({
  source: { file: 'paper.pdf', sha256: 'x', num_pages: 4, layout: 'slides' } as unknown as Doc['source'],
  pages: [page(1, 960, 540), page(2, 960, 540), page(3, 960, 540), page(4, 960, 540)],
});
const leaflet = doc({});

test('the agent writes research papers when it is enabled', () => {
  assert.equal(tourEngine(paper, true), 'agent');
  assert.equal(tourEngine(paper, false), 'legacy');
});

test('exercise sheets, slides and other documents always go to the harness', () => {
  for (const other of [sheet, deck, leaflet]) {
    assert.equal(tourEngine(other, true), 'legacy');
    assert.equal(tourEngine(other, false), 'legacy');
  }
});

test('a sheet that looks like a paper is still taught as a sheet', () => {
  const both = doc({ ...paper, exercises: sheet.exercises });
  assert.equal(tourEngine(both, true), 'legacy');
});

test('without a document the setting decides', () => {
  assert.equal(tourEngine(null, true), 'agent');
  assert.equal(tourEngine(undefined, false), 'legacy');
});
