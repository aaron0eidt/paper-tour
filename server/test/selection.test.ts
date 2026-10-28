import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Doc } from '../../shared/paper';
import { selectedSourceIds, validateSelection } from '../../shared/selection';
import { selectionImages } from '../src/selection-image';
import type { FileStorage } from '../src/storage';
import { ROOT } from '../src/config';

const doc: Doc = {
  schema: 'paper-tour/doc@0.1', source: { file: 'select.pdf', sha256: '0'.repeat(64), num_pages: 1, generator: 'test' },
  pages: [{ n: 1, width: 400, height: 600 }], sections: [], equations: [],
  blocks: [{ id: 'b1', type: 'paragraph', page: 1, bbox: [200, 300, 400, 600], text: 'Selected.', sentences: ['s1'] }],
  sentences: [{ id: 's1', page: 1, block: 'b1', text: 'Selected.', rects: [[200, 300, 300, 320]] }],
  figures: [{ id: 'fig1', kind: 'figure', page: 1, number: '1', bbox: [0, 0, 100, 100], caption: '', image: '', panels: [], referenced_by: [] }],
};
const selection = { page: 1, rect: [0.5, 0.5, 1, 1] as [number, number, number, number] };
const storageFor = (pdf: Buffer): FileStorage => ({
  download: async () => pdf, info: async () => null, upload: async () => undefined,
  sign: async () => '', remove: async () => undefined, list: async () => [],
});

test('selection rejects invalid pages, nonfinite/out-of-page and empty rectangles', () => {
  for (const raw of [null, {}, { ...selection, page: 0 }, { ...selection, page: 2 }, { ...selection, page: 1.5 },
    { page: 1, rect: [0, 0, 1.1, 1] }, { page: 1, rect: [0, 0, NaN, 1] },
    { page: 1, rect: [0.5, 0, 0.5, 1] }, { page: 1, rect: [1, 0, 0, 1] }])
    assert.throws(() => validateSelection(raw, doc), { name: 'SelectionError' });
  assert.deepEqual(validateSelection(selection, doc), selection);
  assert.deepEqual(selectedSourceIds(doc, selection), ['s1', 'b1']);
  assert.deepEqual(selectedSourceIds(doc, { page: 1, rect: [0, 0, 0.25, 0.16] }), ['fig1']);
});

test('selection images reject a mismatched original and invalid selections before rendering', async () => {
  await assert.rejects(selectionImages(storageFor(Buffer.from('different')), 'source.pdf', doc, selection), { status: 409, code: 'source_mismatch' });
  await assert.rejects(selectionImages(storageFor(Buffer.from('different')), 'source.pdf', doc, { ...selection, page: 2 }), { status: 400, code: 'invalid_selection' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(selectionImages(storageFor(Buffer.alloc(0)), 'source.pdf', doc, selection, controller.signal), { name: 'AbortError' });
});

const python = process.env.PYTHON_BIN ?? resolve(ROOT, 'ingest/.venv/bin/python');
test('selection images supply original full-page context and a distinct real PDF crop', { skip: !existsSync(python) }, async () => {
  const { stdout } = await promisify(execFile)(python, ['-I', '-c',
    'import pymupdf,base64; d=pymupdf.open(); p=d.new_page(width=400,height=600); p.draw_rect(pymupdf.Rect(200,300,400,600),color=(1,0,0),fill=(1,0,0)); print(base64.b64encode(d.tobytes()).decode())'], { timeout: 10_000 });
  const pdf = Buffer.from(stdout.trim(), 'base64');
  const analyzed = { ...doc, source: { ...doc.source, sha256: createHash('sha256').update(pdf).digest('hex') } };
  const images = await selectionImages(storageFor(pdf), 'source.pdf', analyzed, selection);
  assert.deepEqual(images.map(i => i.targetId), ['page1', 'selection-page1']);
  assert.ok(images.every(i => i.page === 1 && i.dataUrl.startsWith('data:image/jpeg;base64,')));
  assert.notEqual(images[0].dataUrl, images[1].dataUrl);
  assert.match(images[1].label, /use existing document IDs/);
});
