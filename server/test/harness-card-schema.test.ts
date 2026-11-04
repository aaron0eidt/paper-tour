import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc } from '../../shared/paper';
import { ARCS, SUBJECTS, cardSchema, cardProblems, cleanCard, fallbackCard } from '../src/harness/card';
import { cardTask } from '../src/harness/prompts';

test('long-paper evidence enums are shared without losing allowed source IDs', () => {
  const ids = Array.from({ length: 900 }, (_, i) => `p${i + 1}.s1`);
  const schema = cardSchema({ figures: [], equations: [] } as unknown as Doc, ids);
  let count = 0;
  const visit = (node: unknown) => {
    if (!node || typeof node !== 'object') return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.enum)) count += record.enum.length;
    Object.values(record).forEach(visit);
  };
  visit(schema);
  assert.ok(count < 3000, 'provider enum budget includes repeated properties');
  assert.deepEqual(schema.$defs?.evidenceId.enum, ids, 'late-paper evidence remains available');
  const claim = { text: 'A supported claim.', evidence: [ids[899]] };
  const card = {
    plan: 'Summarize evidence.',
    doc_type: 'research_paper',
    subject: 'computer_science',
    title: 'A research paper',
    chapter_titles: Object.fromEntries(ARCS.map((arc) => [arc, `The ${arc}`])),
    problem: claim,
    key_idea: claim,
    method_steps: [claim],
    key_figures: [],
    key_formulas: [],
    results: [claim],
    limitations: [],
    takeaway: claim,
    suggested_questions: ['What changes?', 'How does it work?', 'What are the limits?'],
  };
  assert.deepEqual(cardProblems(card, schema), []);
  assert.ok(cardProblems({ ...card, problem: { ...claim, evidence: ['invented-source'] } }, schema).length);
});

test('the card names the document’s subject: required in the call’s schema, from a fixed list, other when unknown', () => {
  const doc = {
    figures: [],
    equations: [],
    sentences: [],
    blocks: [],
    source: {},
    pages: [],
    sections: [],
  } as unknown as Doc;
  const claim = { text: 'A supported claim.', evidence: ['p1.s1'] };
  const answer = {
    plan: 'p',
    doc_type: 'exercise_sheet',
    subject: 'chemistry',
    title: 'A problem set',
    chapter_titles: Object.fromEntries(ARCS.map((arc) => [arc, `The ${arc}`])),
    problem: claim,
    key_idea: claim,
    method_steps: [claim],
    key_figures: [],
    key_formulas: [],
    results: [],
    limitations: [],
    takeaway: claim,
    suggested_questions: ['What changes?', 'How does it work?', 'What are the limits?'],
  };
  const strict = cardSchema(doc, ['p1.s1']) as { required: string[]; properties: Record<string, any> };
  assert.ok(strict.required.includes('subject'));
  assert.deepEqual(strict.properties.subject.enum, [...SUBJECTS]);
  assert.deepEqual(cardProblems(answer, strict), []);
  assert.ok(cardProblems({ ...answer, subject: 'astrology' }, strict).length);
  const { subject: _omitted, ...without } = answer;
  assert.ok(cardProblems(without, strict).length);
  assert.deepEqual(SUBJECTS, [
    'mathematics',
    'statistics',
    'physics',
    'chemistry',
    'biology',
    'computer_science',
    'economics',
    'engineering',
    'medicine',
    'language',
    'humanities',
    'law',
    'other',
  ]);
  // The code check lets a card without one through; cleanCard and the fallback card then say "other".
  const loose = cardSchema(doc, ['p1.s1'], false);
  assert.deepEqual(cardProblems(without, loose), []);
  assert.equal(fallbackCard(doc).subject, 'other');
  const card = { ...fallbackCard(doc), subject: 'chemistry' as const };
  assert.equal(cleanCard(card, doc).subject, 'chemistry');
  assert.equal(cleanCard({ ...card, subject: 'astrology' as never }, doc).subject, 'other');
  assert.equal(cleanCard({ ...card, subject: undefined }, doc).subject, 'other');
});

test('the card prompt explains the subject field and lists its values', () => {
  const task = cardTask('en-US');
  assert.match(task, /name the field the document belongs to \("subject"\): one of mathematics, statistics, physics/i);
  for (const subject of SUBJECTS) assert.ok(task.includes(subject), subject);
  assert.match(task, /other when none fits/);
});
