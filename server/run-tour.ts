// Writes a tour for one document with the same generator the worker uses, without the app or Supabase.
// Run from server/ with MODEL_API_KEY in the root .env (each run makes real Meta API calls):
//   node --import tsx run-tour.ts <preset> <out> [folder] [document id] [language]
// The folder holds the PDF and its doc.json (ingest/ingest.py <pdf> --out <folder>); the default is the demo paper.
// Images are prepared as the worker prepares them (ingest/tour_assets.py), into <out>/images.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { config } from './src/config';
import { HarnessTourGenerator } from './src/harness/generator';
import type { TourImage } from './src/tour-generator';
import type { Doc } from '../shared/paper';

const [preset = 'standard', out, folderArg = '../demo/attention', idArg, language] = process.argv.slice(2);
if (!out) throw new Error('usage: scripts-local-run-harness.ts <preset> <out> [folder] [document id] [language]');
const folder = resolve(folderArg);
const doc = JSON.parse(readFileSync(resolve(folder, 'doc.json'), 'utf8')) as Doc;
const pdf = resolve(folder, doc.source.file);
const id = idArg ?? basename(folder);
const python = process.env.PYTHON_BIN ?? resolve('../ingest/.venv/bin/python');
const imagesDir = resolve(out, 'images');
mkdirSync(imagesDir, { recursive: true });
execFileSync(python, ['../ingest/tour_assets.py', pdf, '--doc', resolve(folder, 'doc.json'), '--assets-dir', folder, '--out', imagesDir]);
const manifest = JSON.parse(readFileSync(resolve(imagesDir, 'images.json'), 'utf8')) as {
  images: { target_id: string; kind: TourImage['kind']; page: number; label: string; path: string }[];
};
const images: TourImage[] = manifest.images.map((image) => ({
  targetId: image.target_id,
  kind: image.kind,
  page: image.page,
  label: image.label,
  dataUrl: `data:image/jpeg;base64,${readFileSync(resolve(imagesDir, image.path)).toString('base64')}`,
}));
const events: unknown[] = [];
const started = Date.now();
const muse = { ...config().muse, ...(language ? { language } : {}) };
const generator = new HarnessTourGenerator(muse, preset as 'quick' | 'standard' | 'deep');
const { tour, metadata } = await generator.generate({
  documentId: id,
  analysisId: 'local',
  doc,
  images,
  onEvent: async (type, data) => void events.push({ type, at: Date.now() - started, ...(type === 'model.delta' ? {} : { data }) }),
});
mkdirSync(dirname(resolve(out, 'tour.json')), { recursive: true });
writeFileSync(resolve(out, 'tour.json'), JSON.stringify({ ...tour, paper: id }, null, 2));
writeFileSync(resolve(out, 'events.json'), JSON.stringify(events, null, 1));
writeFileSync(resolve(out, 'metadata.json'), JSON.stringify(metadata, null, 1));
const steps = tour.chapters.flatMap((c) => c.steps).length;
console.log(`${metadata.docType}: done in ${((Date.now() - started) / 1000).toFixed(1)} s, ${steps} steps`);
