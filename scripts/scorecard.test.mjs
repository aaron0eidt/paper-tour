import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { boardOrigin, boardSignature, render, scoreTour, summarize } from './scorecard.mjs';

// The scorecard reads a tour folder and counts what is in it; run with: node --test scripts/scorecard.test.mjs

const sha = 'a'.repeat(64);
const bars = (values, title = 'BLEU scores') => ({
  kind: 'bars',
  title,
  bars: values.map((value, i) => ({ label: `System ${i + 1}`, value })),
});
const step = (id, say, actions, extra = {}) => ({ id, say, hold_ms: 0, actions, ...extra });

const tour = {
  schema: 'paper-tour/tour@0.1',
  title: 'A tour',
  paper: 'sample',
  doc_sha256: sha,
  doc_type: 'research_paper',
  chapters: [
    {
      id: 'a',
      title: 'First',
      steps: [
        step('s1', 'one two three four five six', [
          { type: 'focus', target: 'p1.s1' },
          { type: 'board', item: bars([28.4, 41.8]) },
          { type: 'highlight', targets: ['p1.s1', 'p9.s9'] },
        ]),
        step('s2', 'one two three four five six seven', [{ type: 'board', item: bars([41.8, 28.4]) }]),
      ],
    },
    {
      id: 'b',
      title: 'Second',
      steps: [
        step(
          's3',
          'one two three four five six',
          [
            {
              type: 'board',
              item: {
                kind: 'heatmap',
                rows: ['a', 'b'],
                cols: ['a', 'b'],
                values: [
                  [1, 2],
                  [3, 4],
                ],
                source: 'illustrative',
              },
            },
          ],
          { checkpoint: { prompt: 'Try it first.', hints: [] } },
        ),
        step('s4', 'one two three four five six seven', [
          {
            type: 'board',
            item: {
              kind: 'scatter',
              x_label: 'a',
              y_label: 'b',
              source: 'document',
              points: [{ label: 'p', x: 7.5, y: 28.4 }],
            },
          },
          { type: 'board', item: { kind: 'formula', latex: 'a+b', terms: [] } },
        ]),
      ],
    },
  ],
};

const doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: sha, num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  blocks: [{ id: 'p1.b1', page: 1, type: 'paragraph', bbox: [0, 0, 1, 1], text: 'The scores were 28.4 and 41.8.' }],
  sentences: [{ id: 'p1.s1' }],
  figures: [{ id: 'fig1', caption: 'Figure 1.', panels: [] }],
  equations: [],
};

function folders(files) {
  const root = mkdtempSync(join(tmpdir(), 'scorecard-'));
  const write = (path, value) => {
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  };
  write(join(root, 'docs', 'sample', 'doc.json'), files.doc ?? doc);
  write(join(root, 'run', 'sample', 'tour.json'), files.tour ?? tour);
  if (files.metadata) write(join(root, 'run', 'sample', 'metadata.json'), files.metadata);
  if (files.events) write(join(root, 'run', 'sample', 'events.json'), files.events);
  return { dir: join(root, 'run', 'sample'), docs: join(root, 'docs'), done: () => rmSync(root, { recursive: true }) };
}

test('counts the tour and checks its boards and IDs against the document', () => {
  const { dir, docs, done } = folders({
    metadata: {
      model: 'muse-spark-1.3',
      modelCalls: 9,
      usage: { promptTokens: 1_000_000, completionTokens: 1_000_000, cachedInputTokens: 0, totalTokens: 2_000_000 },
      degraded: [{ beat: 'x' }],
      boards: { dropped: [] },
    },
    events: [
      { type: 'model.started', at: 10 },
      { type: 'validation.failed', at: 4000 },
      { type: 'beat.guarded', at: 7000 },
      { type: 'tour.direction', at: 12500 },
    ],
  });
  try {
    const score = scoreTour(dir, { docs });
    assert.equal(score.tour, 'sample');
    assert.equal(score.type, 'paper');
    assert.equal(score.steps, 4);
    assert.equal(score.words, 26);
    assert.ok(Math.abs(score.minutes - 10 / 60) < 1e-9);
    assert.equal(score.chapters, 2);
    assert.equal(score.boards, 5);
    assert.deepEqual(score.kinds, ['bars', 'formula', 'heatmap', 'scatter']);
    assert.equal(score.document, 3);
    assert.equal(score.inText, 2, 'the scatter value 7.5 is not printed in the document');
    assert.equal(score.illustrative, 1);
    assert.equal(score.other, 1);
    assert.equal(score.repeated, 1, 'the second bars board shows the same numbers in another order');
    assert.equal(score.checkpoints, 1);
    assert.deepEqual(score.ids, { found: 2, all: 3 });
    assert.equal(score.calls, 9);
    assert.equal(score.tokens, 2_000_000);
    assert.ok(Math.abs(score.cost - 5.5) < 1e-9, 'a million tokens in and out at list price');
    assert.equal(score.degraded, 1);
    assert.equal(score.dropped, 0);
    assert.equal(score.seconds, 12.5);
    assert.equal(score.sentBack, 2);
  } finally {
    done();
  }
});

test('leaves a number empty when the file it comes from is missing', () => {
  const { dir, done } = folders({});
  try {
    const score = scoreTour(dir, { docs: join(dir, 'nowhere') });
    assert.equal(score.steps, 4);
    for (const key of [
      'ids',
      'inText',
      'calls',
      'tokens',
      'cost',
      'degraded',
      'dropped',
      'seconds',
      'sentBack',
      'lines',
    ])
      assert.equal(score[key], null, key);
  } finally {
    done();
  }
});

test('does not trust a doc.json of another version of the document', () => {
  const { dir, docs, done } = folders({ doc: { ...doc, source: { ...doc.source, sha256: 'b'.repeat(64) } } });
  try {
    const score = scoreTour(dir, { docs });
    assert.equal(score.ids, null);
    assert.equal(score.inText, null);
  } finally {
    done();
  }
});

test('reads the exercise lines the code checked', () => {
  const { dir, docs, done } = folders({
    metadata: {
      exercises: [
        { id: 'ex1', solved: true, ok: 2, failed: 0, unknown: 1 },
        { id: 'ex2', ok: 0, failed: 1, unknown: 0 },
      ],
    },
  });
  try {
    assert.deepEqual(scoreTour(dir, { docs }).lines, { ok: 2, all: 4, failed: 1 });
  } finally {
    done();
  }
});

test('a board is illustrative when it says so, document when it prints numbers, and other otherwise', () => {
  assert.equal(boardOrigin(bars([1, 2], 'Illustrative counts')), 'illustrative');
  assert.equal(
    boardOrigin({ kind: 'scene', objects: [{ id: 'a', type: 'text', text: 'An illustrative case' }] }),
    'illustrative',
  );
  assert.equal(boardOrigin(bars([1, 2])), 'document');
  assert.equal(boardOrigin({ kind: 'heatmap', source: 'formula', values: [] }), 'other');
  assert.equal(boardOrigin({ kind: 'timeline', source: 'document', events: [] }), 'document');
  assert.equal(boardOrigin({ kind: 'distribution', source: 'illustrative', dists: [] }), 'illustrative');
  assert.equal(boardOrigin({ kind: 'flow', nodes: [], edges: [] }), 'other');
});

test('two boards with the same data have the same signature, in any order', () => {
  assert.equal(boardSignature(bars([1, 2, 3])), boardSignature(bars([3, 1, 2], 'Another title')));
  assert.notEqual(boardSignature(bars([1, 2, 3])), boardSignature(bars([1, 2, 4])));
  assert.equal(boardSignature({ kind: 'scene', objects: [{ id: 'a', type: 'rect', x: 0, y: 0, w: 1, h: 1 }] }), null);
});

test('boards without a list of numbers are counted but not checked against the text', () => {
  const timeline = { kind: 'timeline', unit: 'day', source: 'document', events: [{ label: 'Notice', position: 0 }] };
  const distribution = {
    kind: 'distribution',
    source: 'document',
    x_label: 'x',
    dists: [{ family: 'normal', label: 'A', mean: 1, sd: 2 }],
  };
  const other = {
    ...tour,
    chapters: [
      {
        id: 'a',
        title: 'A',
        steps: [
          step('s1', 'one two', [
            { type: 'board', item: timeline },
            { type: 'board', item: distribution },
          ]),
        ],
      },
    ],
  };
  const { dir, docs, done } = folders({ tour: other });
  try {
    const score = scoreTour(dir, { docs });
    assert.deepEqual(score.kinds, ['distribution', 'timeline']);
    assert.equal(score.document, 2);
    assert.equal(score.inText, 0);
    assert.notEqual(
      boardSignature(timeline),
      boardSignature({ ...timeline, events: [{ label: 'Notice', position: 14 }] }),
    );
  } finally {
    done();
  }
});

test('the summary adds the counts and joins the kinds', () => {
  const { dir, docs, done } = folders({ metadata: { modelCalls: 4 } });
  try {
    const one = scoreTour(dir, { docs });
    const all = summarize([one, { ...one, kinds: ['plot'], calls: null, steps: 6 }]);
    assert.equal(all.steps, 10);
    assert.equal(all.calls, 4, 'a tour without metadata adds nothing');
    assert.deepEqual(all.kinds, ['bars', 'formula', 'heatmap', 'plot', 'scatter']);
    const text = render([one]);
    assert.match(text, /^tour\s+type\s+steps/);
    assert.match(text, /sample\s+paper\s+4\s+26/);
    assert.match(text, /all 1\s+4\s+26/);
  } finally {
    done();
  }
});
