import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const root = fileURLToPath(new URL('../', import.meta.url));
process.loadEnvFile(resolve(root, '.env'));
assert(
  ['localhost', '127.0.0.1'].includes(new URL(process.env.SUPABASE_URL).hostname),
  'Only local test Supabase is allowed.',
);
assert(
  process.env.MODEL_API_KEY || process.env.MUSE_API_KEY,
  'Set MODEL_API_KEY before running the explicit live-model smoke test.',
);
const require = createRequire(resolve(root, 'server/package.json'));
const { createClient } = require('@supabase/supabase-js');
const account = JSON.parse(await readFile(resolve(root, '.data/local-test-account.json'), 'utf8'));
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const login = await supabase.auth.signInWithPassword({ email: account.email, password: account.password });
if (login.error) throw login.error;
const token = login.data.session.access_token;
const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { headers: { Authorization: `Bearer ${token}` } },
});
const execute = promisify(execFile),
  pdfPath = resolve(root, '.data/muse-smoke.pdf');
await execute(process.env.PYTHON_BIN ?? resolve(root, 'ingest/.venv/bin/python'), [
  '-c',
  `
import pymupdf,sys
pdf=pymupdf.open()
p=pdf.new_page(width=600,height=800)
p.insert_text((55,65),'A Simple Processing Pipeline',fontsize=20)
p.insert_text((55,105),'1. Method',fontsize=14)
p.insert_textbox(pymupdf.Rect(55,130,545,230),'This demonstration describes three stages: input, processing, and output. Figure 1 illustrates the left-to-right flow. The arrows describe order, not measured performance. There are no experimental results.',fontsize=11)
for x,label in [(70,'Input'),(240,'Process'),(410,'Output')]:
 p.draw_rect(pymupdf.Rect(x,290,x+110,350),color=(0.1,0.3,0.7),fill=(0.85,0.92,1))
 p.insert_text((x+22,325),label,fontsize=12)
for x in [180,350]:
 p.draw_line(pymupdf.Point(x,320),pymupdf.Point(x+60,320),color=(0.1,0.3,0.7))
 p.draw_line(pymupdf.Point(x+52,314),pymupdf.Point(x+60,320),color=(0.1,0.3,0.7))
 p.draw_line(pymupdf.Point(x+52,326),pymupdf.Point(x+60,320),color=(0.1,0.3,0.7))
p.insert_text((55,390),'Figure 1: Input, processing and output connected in order.',fontsize=10)
p.insert_text((55,450),'2. Limitations',fontsize=14)
p.insert_textbox(pymupdf.Rect(55,475,545,580),'This is a conceptual illustration. The diagram does not establish accuracy, speed, causality, or a quantitative advantage. It is only a test document for a guided reading application.',fontsize=11)
pdf.set_metadata({'title':'A Simple Processing Pipeline'})
pdf.save(sys.argv[1])
`,
  pdfPath,
]);
async function api(path, options = {}) {
  const response = await fetch(`http://127.0.0.1:3001/api${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json();
  assert(response.ok, `${path}: ${JSON.stringify(body)}`);
  return body;
}
const pdf = await readFile(pdfPath);
const reservation = await api('/documents', {
  method: 'POST',
  body: JSON.stringify({ filename: `Muse visual smoke ${randomUUID().slice(0, 8)}.pdf`, size: pdf.length }),
});
const upload = await client.storage
  .from(reservation.bucket)
  .upload(reservation.path, pdf, { contentType: 'application/pdf' });
if (upload.error) throw upload.error;
await api(`/documents/${reservation.documentId}/complete`, { method: 'POST' });
let manifest,
  last = '';
for (let attempt = 0; attempt < 330; attempt++) {
  manifest = await api(`/documents/${reservation.documentId}/manifest`);
  const generation = manifest.tourGeneration;
  const state = JSON.stringify({
    analysis: manifest.analysis?.status,
    tour: generation?.status,
    stage: generation?.stage,
    images: generation?.imagesDone,
    total: generation?.imagesTotal,
  });
  if (state !== last) {
    console.log(state);
    last = state;
  }
  if (generation && ['ready', 'failed', 'needs_configuration'].includes(generation.status)) break;
  await new Promise((done) => setTimeout(done, 1000));
}
assert.equal(manifest.tourGeneration?.status, 'ready', JSON.stringify(manifest.tourGeneration));
assert(manifest.selectedTour && manifest.selectedTour.analysisId === manifest.docAnalysisId);
assert(manifest.selectedTour.tour.chapters.flatMap((chapter) => chapter.steps).length > 0);
assert.equal(manifest.selectedTour.tour.doc_sha256, manifest.doc.source.sha256);
const second = await api(`/documents/${reservation.documentId}/tours`, { method: 'POST' });
assert.equal(second.generation.tourId, manifest.selectedTour.id);
const fresh = await api(`/documents/${reservation.documentId}/manifest`);
assert.equal(fresh.tours.length, 1);
await writeFile(
  resolve(root, '.data/muse-smoke-result.json'),
  JSON.stringify(
    {
      documentId: reservation.documentId,
      tourId: manifest.selectedTour.id,
      imagesReviewed: manifest.tourGeneration.imagesDone,
    },
    null,
    2,
  ),
);
console.log(
  'PASS new upload automatically produced one persisted Muse tour with visual input, pinned references and idempotent retry.',
);
