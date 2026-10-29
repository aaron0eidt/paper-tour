// Fixtures for the demo scripts' tests: a demo folder in a temporary directory with a small document and tour, and
// canned replies. Not a test itself.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const SHA = 'a'.repeat(64);

export const doc = {
  schema: 'paper-tour/doc@0.1',
  source: { file: 'paper.pdf', sha256: SHA, num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 600, height: 800 }],
  sections: [],
  blocks: [{ id: 'p1.b1', page: 1, type: 'paragraph', bbox: [0, 0, 1, 1], sentences: ['p1.s1'] }],
  sentences: [{ id: 'p1.s1', page: 1, block: 'p1.b1', rects: [[0, 0, 1, 1]] }],
  figures: [{ id: 'fig1', page: 1, bbox: [0, 0, 1, 1], panels: [{ id: 'fig1.a', bbox: [0, 0, 1, 1] }] }],
  equations: [],
  exercises: [{ id: 'ex1', page: 1, parts: [{ id: 'ex1.a' }] }],
};

export const questions = ['Why one?', 'How two?'];

export function tour(name, extra = {}) {
  return {
    schema: 'paper-tour/tour@0.1',
    title: `Tour of ${name}`,
    paper: name,
    doc_sha256: SHA,
    doc_type: 'research_paper',
    voices: { host: { lang: 'en-US', rate: 1 } },
    suggested_questions: questions,
    chapters: [
      {
        id: 'a',
        title: 'First',
        steps: [
          { id: 's1', say: 'one two three', actions: [{ type: 'focus', target: 'p1.s1' }] },
          { id: 'takeaway-1', say: 'four five six', actions: [{ type: 'highlight', targets: ['p1.s1'] }] },
        ],
      },
    ],
    ...extra,
  };
}

/** An answer as the API returns it: a verdict, steps that point at doc.json, and two follow-ups. */
export function answer(target = 'p1.s1', extra = {}) {
  return {
    answerable: 'yes',
    language: 'en-US',
    steps: [{ id: 'ask-1', say: 'An answer in one sentence.', actions: [{ type: 'focus', target }] }],
    followups: ['And then?', 'Why not?'],
    ...extra,
  };
}

export const json = (value, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

/**
 * A temporary demo directory with one valid folder per name (paper.pdf, doc.json, tour.json). `done()` removes it.
 * `root` holds `demo/` and a place for scratch files.
 */
export function demoDir(names = ['alpha']) {
  const root = mkdtempSync(join(tmpdir(), 'demo-scripts-'));
  const dir = join(root, 'demo');
  for (const name of names) {
    mkdirSync(join(dir, name), { recursive: true });
    writeFileSync(join(dir, name, 'paper.pdf'), '%PDF-1.4\nnot a real paper\n');
    writeFileSync(join(dir, name, 'doc.json'), JSON.stringify(doc));
    writeFileSync(join(dir, name, 'tour.json'), JSON.stringify(tour(name)));
  }
  return { root, dir, scratch: join(root, 'scratch'), done: () => rmSync(root, { recursive: true, force: true }) };
}

/** A validator that finds nothing wrong, for tests that do not run Python. */
export const validOk = async () => ({ ran: true, ok: true, errors: [], summary: 'validate x: OK, 0 errors' });
