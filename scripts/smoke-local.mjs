import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const root = fileURLToPath(new URL('../', import.meta.url));
process.loadEnvFile(resolve(root, '.env'));
const require = createRequire(resolve(root, 'server/package.json'));
const { createClient } = require('@supabase/supabase-js');
const url = process.env.SUPABASE_URL;
assert(
  ['127.0.0.1', 'localhost'].includes(new URL(url).hostname),
  'Smoke test is only allowed against local Supabase.',
);
const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const runId = randomUUID().slice(0, 8);
const accounts = [];
for (const label of ['reader', 'other']) {
  const email = `${label}-${runId}@example.test`,
    password = `Local-test-${randomUUID()}!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const login = await client.auth.signInWithPassword({ email, password });
  if (login.error) throw login.error;
  accounts.push({ email, password, userId: data.user.id, client, token: login.data.session.access_token });
}
const [reader, other] = accounts;
const base = 'http://127.0.0.1:3001/api';
async function request(account, path, options = {}, expected = 200) {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      Authorization: `Bearer ${account.token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `${path}: ${JSON.stringify(body)}`);
  return body;
}
const pdf = await readFile(resolve(root, 'demo/attention/paper.pdf'));
const reservation = await request(
  reader,
  '/documents',
  { method: 'POST', body: JSON.stringify({ filename: 'Attention upload test.pdf', size: pdf.length }) },
  201,
);
const upload = await reader.client.storage
  .from(reservation.bucket)
  .upload(reservation.path, pdf, { contentType: 'application/pdf' });
if (upload.error) throw upload.error;
const queued = await request(reader, `/documents/${reservation.documentId}/complete`, { method: 'POST' });
const duplicate = await request(reader, `/documents/${reservation.documentId}/complete`, { method: 'POST' });
assert.equal(queued.analysisId, duplicate.analysisId);
console.log('PASS authenticated upload and idempotent completion');
let manifest;
for (let attempt = 0; attempt < 90; attempt++) {
  manifest = await request(reader, `/documents/${reservation.documentId}/manifest`);
  if (['ready', 'limited', 'failed'].includes(manifest.analysis?.status)) break;
  await new Promise((done) => setTimeout(done, 500));
}
assert(['ready', 'limited'].includes(manifest.analysis?.status), JSON.stringify(manifest.analysis));
assert.equal(manifest.doc.source.num_pages, 15);
assert.equal(manifest.docAnalysisId, queued.analysisId);
assert(manifest.doc.sentences.length > 200);
const range = await fetch(manifest.pdfUrl, { headers: { Range: 'bytes=0-127' } });
assert.equal(range.status, 206);
assert((await range.text()).startsWith('%PDF'));
console.log('PASS real worker extraction, publication, private signed PDF and range access');
await request(other, `/documents/${reservation.documentId}/manifest`, {}, 404);
await request(other, `/documents/${reservation.documentId}/search?q=attention`, {}, 404);
const hidden = await other.client.storage.from(reservation.bucket).download(reservation.path);
assert(hidden.error, 'Other account must not read the original PDF.');
const { data: directRows, error: rowsError } = await other.client
  .from('documents')
  .select('id')
  .eq('id', reservation.documentId);
if (rowsError) throw rowsError;
assert.equal(directRows.length, 0);
console.log('PASS cross-account API, database and file isolation');
const found = await request(
  reader,
  `/documents/${reservation.documentId}/search?analysisId=${queued.analysisId}&q=attention`,
);
assert(found.hits.length > 0);
const elements = await request(
  reader,
  `/documents/${reservation.documentId}/elements?analysisId=${queued.analysisId}&ids=${encodeURIComponent(found.hits[0].ref.elementId)}`,
);
assert.equal(elements.elements[0].id, found.hits[0].ref.elementId);
const figure = await request(
  reader,
  `/documents/${reservation.documentId}/figures/fig2?analysisId=${queued.analysisId}`,
);
assert(figure.imageUrl && figure.caption && figure.references.length);
const image = await fetch(figure.imageUrl);
assert.equal(image.status, 200);
console.log('PASS indexed search and figure context with actual image');
const state = { page: 4, pageOffset: 0.4, zoom: 1.2, tourId: null, stepId: null };
await request(
  reader,
  `/documents/${reservation.documentId}/reader-state`,
  { method: 'PUT', body: JSON.stringify(state) },
  204,
);
assert.deepEqual((await request(reader, `/documents/${reservation.documentId}/manifest`)).readerState, state);
await request(reader, `/documents/${reservation.documentId}`, {
  method: 'PATCH',
  body: JSON.stringify({ title: 'Attention Is All You Need — upload test' }),
});
console.log('PASS persistent reading position and rename');
const imported = await promisify(execFile)(
  process.execPath,
  ['--import', 'tsx', 'src/import-demo.ts', '--owner', reader.userId],
  { cwd: resolve(root, 'server'), timeout: 60000 },
);
assert(imported.stdout.includes('Imported demo'));
const list = await request(reader, '/documents');
const demo = list.documents.find((document) => document.tourCount > 0);
assert(demo);
const touring = await request(reader, `/documents/${demo.id}/manifest`);
assert.equal(touring.selectedTour.tour.chapters.flatMap((chapter) => chapter.steps).length, 38);
const tourState = {
  page: 4,
  pageOffset: 0.3,
  zoom: 1,
  tourId: touring.selectedTour.id,
  stepId: touring.selectedTour.tour.chapters[1].steps[0].id,
};
await request(reader, `/documents/${demo.id}/reader-state`, { method: 'PUT', body: JSON.stringify(tourState) }, 204);
assert.deepEqual((await request(reader, `/documents/${demo.id}/manifest`)).readerState, tourState);
console.log('PASS pinned import of all 38 original tour steps and saved tour checkpoint');
await request(reader, `/documents/${reservation.documentId}`, { method: 'DELETE' }, 204);
await request(reader, `/documents/${reservation.documentId}/manifest`, {}, 404);
console.log('PASS document deletion immediately revokes API access');
await mkdir(resolve(root, '.data'), { recursive: true });
await writeFile(
  resolve(root, '.data/local-test-account.json'),
  JSON.stringify({ email: reader.email, password: reader.password, documentId: demo.id }, null, 2),
  { mode: 0o600 },
);
await admin.auth.admin.deleteUser(other.userId);
console.log(
  'Local smoke test complete. Test reader account and demo ID saved under .data/local-test-account.json (no credentials printed).',
);
