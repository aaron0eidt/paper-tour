import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCS, cardProblems, cardSchema } from '../src/harness/card';
import { card, doc } from './plan-fixture';

test('repeated greetings or status headings require a model repair before a paper card is accepted', () => {
  const schema = cardSchema(doc, doc.sentences.map((sentence) => sentence.id), false);
  assert.deepEqual(cardProblems(card, schema), []);
  for (const title of ['hello', 'hello world', 'Now the answer is ready.']) {
    const output = { ...card, chapter_titles: Object.fromEntries(ARCS.map((arc) => [arc, title])) };
    assert.match(cardProblems(output, schema).join(' '), /content-specific headings/);
  }
});
