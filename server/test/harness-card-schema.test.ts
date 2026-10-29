import test from 'node:test';
import assert from 'node:assert/strict';
import type { Doc } from '../../shared/paper';
import { ARCS, cardSchema, cardProblems } from '../src/harness/card';

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
    title: 'A research paper',
    chapter_titles: Object.fromEntries(ARCS.map((arc) => [arc, 'Chapter'])),
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
