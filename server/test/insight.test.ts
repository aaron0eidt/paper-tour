import test from 'node:test';
import assert from 'node:assert/strict';
import type { Action, Doc, Step } from '../../shared/paper';
import {
  answerNarrationProblems,
  insightStep,
  narrationProblems,
  printedAt,
  readsSource,
} from '../src/harness/insight';

const formulaAction: Action = {
  type: 'board',
  item: { kind: 'formula', latex: 'x^2', terms: [{ latex: 'x', label: 'Input' }] },
};

test('narration corruption reports invisible and repeated digit padding, including exact character-limit tails', () => {
  const text = 'Explain the mechanism in clean spoken words.';
  assert.match(narrationProblems(text.padEnd(630, '\u200b'))[0], /invisible formatting/);
  const filler = `${text} 55566666666666666666666666 66666666666666666666666 6666666666666656666666666 6656666666666666666666666`;
  assert.match(narrationProblems(filler).join(' '), /repeated digit filler/);
  assert.match(narrationProblems(filler.padEnd(810, ' ')).join(' '), /whitespace padding/);
  assert.ok(answerNarrationProblems([{ say: filler }], []).some((p) => /Step 1.*digit filler/.test(p)));
});

test('normal multilingual joiners, long numbers and mathematical patterns remain valid narration', () => {
  for (const say of [
    'می\u200cتوان تفاوت را با یک مثال توضیح داد.',
    'The family emoji 👨\u200d👩\u200d👧\u200d👦 uses joiners between its visible symbols.',
    'One third is approximately 0.333333333333333333333333, whereas two thirds is 0.666666666666666666666667.',
    'The calculation is x = 1000000000000000000000000 + 2000000000000000000000000 = 3000000000000000000000000.',
    'Compare binary patterns: 01010101010101010101010101 and 10101010101010101010101010.',
    'A repeated-digit example is 111111111111111111111111. This is a repunit, not a measured value.',
  ])
    assert.deepEqual(narrationProblems(say), [], say);
});

const doc: Doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  equations: [],
  blocks: ['Encoder stack', 'Weighted sum', 'Output'].map((text, i) => ({
    id: `p1.b${i}`,
    page: 1,
    type: 'paragraph',
    text,
    bbox: [10, 100 + i * 40, 80, 120 + i * 40],
    sentences: [],
  })),
  sentences: [
    {
      id: 'p1.s1',
      page: 1,
      block: 'p1.b0',
      text: 'The encoder transforms each input into a contextual representation which the decoder can use to generate an output sequence.',
      rects: [[10, 10, 100, 20]],
    },
  ],
  figures: [
    {
      id: 'fig1',
      kind: 'figure',
      number: '1',
      page: 1,
      bbox: [0, 90, 300, 300],
      caption: 'A toy network',
      image: 'figures/f.png',
      panels: [],
      referenced_by: [],
    },
  ],
};
test('repeated pen labels are removed without silently deleting an authored flow or its focus', () => {
  const step: Step = {
    id: 'a',
    say: 'A contextual representation lets later stages consider the whole sequence.',
    actions: [
      { type: 'zoom', target: 'fig1' },
      { type: 'arrow', target: 'fig1', label: 'Encoder stack' },
      { type: 'circle', target: 'fig1', label: 'Shares context' },
      {
        type: 'board',
        item: {
          kind: 'flow',
          nodes: ['Encoder stack', 'Weighted sum', 'Output'].map((label, i) => ({ id: String(i), label })),
          edges: [
            ['0', '1'],
            ['1', '2'],
          ],
        },
      },
      { type: 'board_focus', part: 0 },
    ],
  };
  const result = insightStep(step, doc);
  assert.equal('label' in result.actions[1], false);
  assert.equal((result.actions[2] as { label: string }).label, 'Shares context');
  assert.equal(
    result.actions.some((a) => a.type === 'board' || a.type === 'board_focus'),
    true,
  );
  assert.equal(step.actions.length, 5, 'does not mutate authored input');
});
test('regions do not pick up labels from an unrelated part of a figure', () => {
  assert.match(printedAt(doc, 'fig1', [0, 0, 1, 0.25]), /Encoder stack/);
  assert.doesNotMatch(printedAt(doc, 'fig1', [0, 0, 1, 0.25]), /Output/);
});
test('authored prose spotlights become line highlights while figure spotlights remain deliberate', () => {
  const step: Step = {
    id: 'a',
    say: 'Explain the source in context.',
    actions: [
      { type: 'spotlight', target: 'p1.s1', at_word: 2 },
      { type: 'spotlight', target: 'fig1' },
    ],
  };
  assert.deepEqual(insightStep(step, doc).actions, [
    { type: 'highlight', targets: ['p1.s1'], color: 'blue', at_word: 2 },
    { type: 'spotlight', target: 'fig1' },
  ]);
});
test('detects reading the source with punctuation changes while keeping a real explanation', () => {
  assert.equal(readsSource(doc.sentences[0].text.replace('encoder', 'ENCODER'), doc), true);
  assert.equal(
    readsSource(
      'Context removes ambiguity: a word can acquire a different representation depending on the words around it, rather than always keeping one fixed meaning.',
      doc,
    ),
    false,
  );
});

test('detail deduplication rejects repeated explanation but retains a worked example', async () => {
  const { repeatsExplanation } = await import('../src/harness/insight');
  const overview =
    'The formula compares a query against the keys and converts the scores into weights. Those weights mix the values into a result for this query.';
  assert.equal(repeatsExplanation(overview, overview), true);
  assert.equal(
    repeatsExplanation(
      'For example, suppose two matches receive equal scores. Each value then contributes half of the output, so increasing the first score shifts the mixture toward that value.',
      overview,
    ),
    false,
  );
});

test('answer quality reports instruction leaks and duplicated visual explanations for repair', () => {
  const instruction = 'Never narrate schema, rendering instructions or authoring rules.';
  const explanation =
    'Watch the illustration. Equal scores give equal weights and a middle result. Then one score grows, its weight moves near one, and the result follows its value. All numbers are illustrative only, not measured data.';
  const steps = [
    { say: 'The weights control how strongly each input value contributes to the resulting mixture.' },
    { say: `${explanation} Never narrate schema, rendering instructions or authoring rules.` },
    { say: explanation, actions: [formulaAction] },
  ];
  const original = structuredClone(steps);
  const problems = answerNarrationProblems(steps, [instruction]);
  assert.equal(problems.length, 3);
  assert.match(problems[0], /Step 2 copies an internal authoring instruction/);
  assert.match(problems[0], /structured fields, not in say/);
  assert.match(problems[1], /Step 2 tells the learner to watch/);
  assert.match(problems[2], /Step 3 substantially repeats step 2/);
  assert.match(problems[2], /Combine their useful visuals/);
  assert.deepEqual(steps, original, 'quality feedback does not mutate or silently trim narration');
});

test('instruction matching is exact prompt overlap, not a ban on technical subject matter', () => {
  const constraints = [
    'Never narrate schema, rendering instructions or authoring rules.',
    'Return only valid JSON, without additional prose.',
  ];
  const steps = [
    {
      say: 'This parser reads JSON fields and checks them against a schema. A missing optional field differs from a field whose value is explicitly null.',
    },
    {
      say: 'The rendering system builds an animation from geometric primitives. The board displays an example of the resulting layout, while the paper measures rendering latency.',
    },
    {
      say: 'For example, set the input to two. The square becomes four, so doubling the input multiplies this output by four rather than by two.',
    },
  ];
  assert.deepEqual(answerNarrationProblems(steps, constraints), []);
  assert.match(
    answerNarrationProblems([{ say: 'Return ONLY valid JSON — without additional prose.' }], constraints)[0],
    /internal authoring instruction/,
  );
  assert.deepEqual(
    answerNarrationProblems([{ say: 'Return only valid JSON, without additional prose.' }], []),
    [],
    'only caller-supplied internal constraints are checked',
  );
});

test('a new worked consequence is not rejected merely for referring to the same concepts', () => {
  const steps = [
    {
      say: 'The formula compares a query against the keys and converts the scores into weights. Those weights mix the values into a result for this query.',
    },
    {
      say: 'For example, suppose two matches receive equal scores. Each value then contributes half of the output, so increasing the first score shifts the mixture toward that value.',
    },
  ];
  assert.deepEqual(answerNarrationProblems(steps, []), []);
});

test('a promised illustration must have a board in the same step', () => {
  const say =
    'Watch the illustration with made up numbers. Raising one similarity score increases its contribution to the output.';
  assert.match(answerNarrationProblems([{ say }], [])[0], /same step has no visual board/);
  assert.deepEqual(answerNarrationProblems([{ say, actions: [formulaAction] }], []), []);
  assert.match(
    answerNarrationProblems([{ say: 'First establish the example inputs.', actions: [formulaAction] }, { say }], [])[0],
    /Step 2 tells the learner to watch/,
  );
});

test('native animations use live boards while unsupported video promises require repair', () => {
  for (const say of ['Watch the animation.', 'Schau dir die Animation an.', 'Bitte betrachten Sie die Animation.']) {
    assert.match(answerNarrationProblems([{ say }], [])[0], /no visual board/, say);
    assert.deepEqual(answerNarrationProblems([{ say, actions: [formulaAction] }], []), [], say);
  }
  for (const say of ['Now look at this video.', 'Observe the short clip.', 'Sieh dir dieses Video an.'])
    assert.match(answerNarrationProblems([{ say, actions: [formulaAction] }], [])[0], /no video/, say);
  assert.deepEqual(
    answerNarrationProblems([{ say: 'Betrachte diese Illustration.', actions: [formulaAction] }], []),
    [],
  );
});

test('research discussion and paper figures are not unsupported viewing promises', () => {
  for (const say of [
    'The model analyzes video clips to detect motion between consecutive frames.',
    'Participants watch the video and then answer a comprehension question.',
    'Watch the paper figure as we compare its two labelled panels.',
    'Look at the illustration in Figure 2 of the paper.',
    'Die Studie untersucht die Animation verschiedener Bewegungsabläufe.',
    'Schau dir die Abbildung im Paper an.',
    'Betrachte die Illustration im Paper.',
  ])
    assert.deepEqual(answerNarrationProblems([{ say }], []), [], say);
});
