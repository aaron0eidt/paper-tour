import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareReadingPassage, readingObject } from '../src/reading-speech';
import type { Doc } from '../../shared/paper';

const doc: Doc = {
  schema: 'paper-tour/doc@0.1', source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }], sections: [], sentences: [], figures: [], equations: [],
  blocks: [
    { id: 'definition', page: 1, type: 'paragraph', bbox: [40, 40, 560, 80], text: 'The weights indicate the fraction of tokens assigned to each expert.', sentences: [] },
    { id: 'formula', page: 1, type: 'equation', bbox: [40, 100, 560, 130], text: 'f_i = sum 1 (Token t selects Expert i)', sentences: [] },
  ],
};
const usage = { promptTokens: 10, completionTokens: 10, totalTokens: 20 };

test('footnotes are not reading targets but remain available as source context', async () => {
  const note = 'This result assumes independent samples.';
  const withFootnote: Doc = { ...doc,
    blocks: [...doc.blocks, { id: 'note', page: 1, type: 'footnote', bbox: [40, 720, 560, 740], text: note, sentences: ['note-sentence'] }],
    sentences: [...doc.sentences, { id: 'note-sentence', page: 1, block: 'note', text: note, rects: [[40, 720, 560, 740]] }],
  };
  assert.throws(() => readingObject(withFootnote, 'note'), /Choose a passage/);
  const { paperBlock } = await import('../src/harness/paper-block');
  assert.ok(paperBlock(withFootnote).includes(note));
  const result = await prepareReadingPassage({ doc: withFootnote, targetId: 'definition', language: 'en-US',
    client: { complete: async (messages) => {
      assert.ok(JSON.stringify(messages).includes(note));
      return { value: { supported: true, speech: doc.blocks[0].text }, usage, requestId: null };
    } } });
  assert.equal(result.speech, doc.blocks[0].text);
});

test('reading targets preserve equation geometry and reject unknown source IDs', () => {
  assert.equal(readingObject(doc, 'formula').kind, 'equation');
  assert.equal(readingObject(doc, 'definition').kind, 'prose');
  assert.throws(() => readingObject(doc, 'foreign-block'), /Choose a passage/);
});

test('unreliable or raw formula responses fail explicitly, without reading OCR garbage', async () => {
  for (const value of [{ supported: false, speech: '' }, { supported: true, speech: '\\frac{1}{N} �' }, { supported: true, speech: ' ' }]) {
    await assert.rejects(prepareReadingPassage({ doc, targetId: 'definition', language: 'en-US',
      client: { complete: async () => ({ value, usage, requestId: null }) } }), /reliably prepared/);
  }
  assert.throws(() => readingObject(doc, 'foreign-block'), /Choose a passage/);
});

test('model-cleaned prose must preserve the actual original words, numbers, negation and order', async () => {
  const prose = { ...doc, blocks: [{ ...doc.blocks[0], text: 'The result is not 1.2 times better.' }] };
  const input = { doc: prose, targetId: 'definition', language: 'en-US' };
  const client = (speech: string) => ({ complete: async () => ({ value: { supported: true, speech }, usage, requestId: null }) });
  assert.equal((await prepareReadingPassage({ ...input, client: client('The result is not 1.2 times better.') })).speech, 'The result is not 1.2 times better.');
  for (const speech of ['The result is 1.2 times better.', 'The result is not 12 times better.', 'The result is not 1.2 times better. What next?', 'A much better result.'])
    await assert.rejects(prepareReadingPassage({ ...input, client: client(speech) }), /differs from the original/);
});

test('table targets use the visual agent route and cannot accidentally enter prose cleanup', async () => {
  const tableDoc: Doc = { ...doc, figures: [{ id: 'table1', kind: 'table', number: '1', page: 1,
    bbox: [40, 200, 560, 400], caption: 'Table 1: Method comparison.', panels: [], image: 'table.png', referenced_by: [] }] };
  assert.equal(readingObject(tableDoc, 'table1').kind, 'table');
  await assert.rejects(prepareReadingPassage({ doc: tableDoc, targetId: 'table1', language: 'en-US',
    client: { complete: async () => { throw new Error('Must not run prose cleanup for a table'); } } }), /explanation workflow/);
});

test('a changed prose draft is automatically corrected once before pausing', async () => {
  let calls = 0;
  const result = await prepareReadingPassage({ doc, targetId: 'definition', language: 'en-US',
    client: { complete: async (messages) => {
      calls++;
      if (calls === 2) assert.match(String(messages.at(-1)?.content), /using the ORIGINAL PASSAGE verbatim/);
      return { value: { supported: true, speech: calls === 1 ? 'A rewritten summary.' : doc.blocks[0].text }, usage, requestId: null };
    } } });
  assert.equal(result.speech, doc.blocks[0].text);
  assert.equal(calls, 2);
});

test('tool-generated visual steps retain their exact narration timing when joined into a reading passage', async () => {
  const { readingAnswerPassage, readingExplanationQuestion } = await import('../src/reading-speech');
  const passage = readingAnswerPassage('fig1', { answerable: 'yes', language: 'en-US', followups: ['Ignored question'], steps: [
    { id: 'one', say: 'First two words.', actions: [{ type: 'box', target: 'fig1', at_word: 1 }] },
    { id: 'two', say: 'Then the next concept.', actions: [{ type: 'highlight', targets: ['p1.s1'], at_word: 2 }] },
  ] });
  assert.equal(passage.speech, 'First two words. Then the next concept.');
  assert.ok(passage.actions?.some((a) => a.type === 'highlight' && a.at_word === 5));
  assert.match(readingExplanationQuestion('figure', 'fig1'), /normal PDF annotations, plotting and live visualization tools/);
  assert.match(readingExplanationQuestion('figure', 'fig1'), /Do not ask the learner questions/);
});

test('headings and the following paragraph share one model call and one exact source-text contract', async () => {
  const grouped: Doc = { ...doc, blocks: [
    { ...doc.blocks[0], id: 'h1', type: 'heading', text: 'Experiments' },
    { ...doc.blocks[0], id: 'h2', type: 'heading', text: 'Setups' },
    doc.blocks[0],
  ] };
  let calls = 0;
  const result = await prepareReadingPassage({ doc: grouped, targetId: 'h1', language: 'en-US', client: { complete: async () => {
    calls++; return { value: { supported: true, speech: `Experiments. Setups. ${doc.blocks[0].text}` }, usage, requestId: null };
  } } });
  assert.equal(calls, 1);
  assert.equal(result.speech, `Experiments. Setups. ${doc.blocks[0].text}`);
});

test('a visual explanation integrates its caption and preserves continuity instead of reading the caption twice', async () => {
  const { readingExplanationQuestion, readingContinuity } = await import('../src/reading-speech');
  const withFigure: Doc = { ...doc, blocks: [doc.blocks[0],
    { ...doc.blocks[0], id: 'cap', type: 'caption', text: 'Figure 1: A qualified comparison under fixed conditions.' },
    { ...doc.blocks[0], id: 'after', text: 'Next we study the consequence.' },
  ], figures: [{ id: 'fig1', kind: 'figure', page: 1, number: '1', bbox: [40, 100, 560, 200], caption_block: 'cap',
    caption: 'Figure 1: A qualified comparison under fixed conditions.', image: 'f.png', panels: [], referenced_by: [] }] };
  const context = readingContinuity(withFigure, 'fig1');
  const question = readingExplanationQuestion('figure', 'fig1', withFigure.figures[0].caption, context);
  assert.match(question, /caption will not be read separately/);
  assert.match(question, /definitions, units, scope, qualifications and conclusions/);
  assert.match(question, /A qualified comparison under fixed conditions/);
  assert.match(question, /Next we study the consequence/);
  assert.match(question, /already read/);
});

test('linked caption source survives incomplete figure metadata', async () => {
  const { readingCaption } = await import('../src/reading-speech');
  const input: Doc = { ...doc, blocks: [doc.blocks[0], { ...doc.blocks[0], id: 'linked-caption', type: 'caption', text: 'The update happens after each training step.' }],
    figures: [{ id: 'legacy', kind: 'figure', number: '1', page: 1, bbox: [40, 100, 560, 200],
      caption: '', caption_block: 'linked-caption', image: 'legacy.png', panels: [], referenced_by: [] }] };
  assert.equal(readingCaption(input, 'legacy'), 'The update happens after each training step.');
});

test('formula transitions distinguish the spoken introduction from definitions still to be read', async () => {
  const { readingContinuity, readingExplanationQuestion } = await import('../src/reading-speech');
  const input: Doc = { ...doc, blocks: [
    { ...doc.blocks[0], text: 'For a sequence of length T, the auxiliary loss is defined as:' },
    doc.blocks[1],
    { ...doc.blocks[0], id: 'terms', bbox: [40, 150, 560, 190], text: 'where N is the number of experts and alpha controls the strength of the auxiliary loss.' },
  ] };
  const context = readingContinuity(input, 'formula');
  assert.match(context, /PRECEDING ORIGINAL PROSE \(definition; already read verbatim/);
  assert.match(context, /FOLLOWING ORIGINAL PROSE \(terms; will be read verbatim next/);
  assert.ok(context.includes(input.blocks[0].text));
  assert.ok(context.includes(input.blocks[2].text));
  assert.ok(!context.includes(input.blocks[1].text));
  const question = readingExplanationQuestion('equation', 'formula', undefined, context);
  assert.match(question, /inline continuation/);
  assert.match(question, /Reserve definitions, symbol glossaries/);
  assert.match(question, /Do not remove original text/);
  assert.match(question, /rather than re-highlighting the introductory paragraph/);
});

test('adjacent visual evidence is never presented as a verbatim spoken transcript', async () => {
  const { readingContinuity } = await import('../src/reading-speech');
  const input: Doc = { ...doc, blocks: [doc.blocks[1],
    { ...doc.blocks[1], id: 'next-formula', bbox: [40, 250, 560, 280], text: 'y = x + 1' },
  ] };
  const context = readingContinuity(input, 'next-formula');
  assert.match(context, /PRECEDING VISUAL \(formula, equation; already explained\)/);
  assert.match(context, /Source evidence, not its spoken transcript/);
  assert.match(context, /FOLLOWING: document boundary/);
  assert.equal(readingContinuity(input, 'missing'), '');
});
