// Progressive playback, measured against the running local app: upload a PDF through the API the library uses, let the
// worker write its tour, and poll the partial endpoint the reader polls. It prints when the upload finished, when each
// stage began, when the first partial tour arrived (and how many steps it held), how the partials grew, and when the
// finished tour arrived; then it checks the properties the reader relies on. It makes real model calls (one tour).
//   node scripts/e2e-progressive.mjs [--pdf <file>] [--keep] [--poll-ms 400] [--timeout-s 420] [--json]
// Needs `npm run supabase:start`, `npm run db:migrate` and `npm run dev` (web 5174, API 3001, worker; restart it after
// server changes, it does not reload) and MODEL_API_KEY in the root .env or a key saved in the account's settings.
// The account is the one in .data/local-test-account.json (the smoke scripts write it); without one this creates a test
// account in the local Supabase and saves its credentials there (gitignored, mode 0600). Nothing secret is printed.
// The document is deleted afterwards unless --keep is given; the reader is at http://localhost:5174/?document=<id>, which
// is printed as soon as the document exists, so it can be opened in a browser while the tour is being written.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const ACCOUNT_FILE = resolve(root, '.data/local-test-account.json');
const RUNNING = ['queued', 'generating'];

// ---------------------------------------------------------------------------------------------------- pure parts

export function parseArgs(argv) {
  const options = { pdf: resolve(root, 'demo/attention/paper.pdf'), keep: false, json: false, pollMs: 400, timeoutS: 420 };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--keep') options.keep = true;
    else if (flag === '--json') options.json = true;
    else if (flag === '--pdf') options.pdf = resolve(argv[++i] ?? '');
    else if (flag === '--poll-ms') options.pollMs = Number(argv[++i]);
    else if (flag === '--timeout-s') options.timeoutS = Number(argv[++i]);
    else throw new Error(`Unknown option ${flag}.`);
  }
  if (!(options.pollMs >= 100) || !(options.timeoutS >= 30)) throw new Error('Use --poll-ms 100 or more and --timeout-s 30 or more.');
  return options;
}

export const stepsOf = (tour) => (tour?.chapters ?? []).flatMap((chapter) => chapter.steps);
const chapterOf = (tour) => (tour?.chapters ?? []).flatMap((chapter) => chapter.steps.map(() => chapter.id));

/** The tour's steps by chapter, as ids only: enough to see how a tour grew without keeping the document's words. */
export const shapeOf = (tour) => (tour?.chapters ?? []).map((chapter) => [chapter.id, chapter.steps.map((step) => step.id)]);

/** The first steps of `after` are exactly `before`: what a growing tour must do for playback to continue in place. */
export function appendOnly(before, after) {
  const a = stepsOf(before);
  const b = stepsOf(after);
  const chapters = [chapterOf(before), chapterOf(after)];
  return a.length <= b.length && a.every((step, i) => step.id === b[i].id && step.say === b[i].say && chapters[0][i] === chapters[1][i]);
}

/**
 * How the finished tour relates to the last partial one the reader held: does it begin with the same steps in the same
 * chapters (the reader then swaps one for the other without the learner noticing; its engine refuses to grow a tour
 * otherwise), and which steps differ in id, chapter or narration.
 */
export function compareFinished(partial, finished) {
  const a = stepsOf(partial);
  const b = stepsOf(finished);
  const chapters = [chapterOf(partial), chapterOf(finished)];
  const differing = [];
  for (let i = 0; i < a.length; i++) {
    if (!b[i]) differing.push({ index: i, id: a[i].id, why: 'missing in the finished tour' });
    else if (a[i].id !== b[i].id) differing.push({ index: i, id: a[i].id, why: `the finished tour has ${b[i].id} there` });
    else if (chapters[0][i] !== chapters[1][i]) differing.push({ index: i, id: a[i].id, why: `in chapter ${chapters[1][i]}, not ${chapters[0][i]}` });
    else if (a[i].say !== b[i].say) differing.push({ index: i, id: a[i].id, why: 'narration differs' });
  }
  return { held: a.length, finished: b.length, prefix: differing.length === 0, differing };
}

const seconds = (ms) => (ms / 1000).toFixed(1);

/** Where the time went, from the marks the run recorded (milliseconds since the upload finished; null if it never happened). */
export function summarize(marks) {
  const at = (name) => marks.find((m) => m.name === name)?.ms ?? null;
  const partials = marks.filter((m) => m.name === 'partial');
  const first = partials[0] ?? null;
  const last = partials.at(-1) ?? null;
  const finished = at('generation finished');
  const gap = (from, to) => (from !== null && to !== null ? to - from : null);
  const writing = at('stage writing');
  return {
    analysisReady: at('analysis ready'),
    generationQueued: at('tour queued'),
    stageWriting: writing,
    firstPartial: first?.ms ?? null,
    firstPartialSteps: first?.ready ?? null,
    firstPartialPlanned: first?.planned ?? null,
    lastPartial: last?.ms ?? null,
    lastPartialSteps: last?.ready ?? null,
    partials: partials.length,
    finished,
    finishedSteps: marks.find((m) => m.name === 'generation finished')?.steps ?? null,
    // How long the learner would have waited for the finished tour, and how much of that a first step saves.
    headStart: gap(first?.ms ?? null, finished),
    headStartShare: first && finished ? (finished - first.ms) / finished : null,
    firstPartialAfterWriting: gap(writing, first?.ms ?? null),
  };
}

export function formatTimeline(marks) {
  const lines = ['  seconds after the upload finished'];
  for (const m of marks) {
    const detail = m.name === 'partial' ? `partial tour: ${m.ready} of ${m.planned} steps (${(m.bytes / 1024).toFixed(0)} kB)` : m.name + (m.note ? `: ${m.note}` : '');
    lines.push(`  ${seconds(m.ms).padStart(7)} s  ${detail}`);
  }
  return lines.join('\n');
}

// ------------------------------------------------------------------------------------------------- the real run

async function main(argv) {
  const options = parseArgs(argv);
  process.loadEnvFile(resolve(root, '.env'));
  const require = createRequire(resolve(root, 'server/package.json'));
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(['127.0.0.1', 'localhost'].includes(new URL(url).hostname), 'This test only runs against the local Supabase.');
  const api = process.env.E2E_API ?? 'http://127.0.0.1:3001/api';
  assert(['127.0.0.1', 'localhost'].includes(new URL(api).hostname), 'This test only runs against a local API.');
  const web = process.env.E2E_WEB ?? 'http://localhost:5174';
  const plain = { auth: { persistSession: false, autoRefreshToken: false } };
  const admin = createClient(url, service, plain);

  let saved = {};
  try {
    saved = JSON.parse(await readFile(ACCOUNT_FILE, 'utf8'));
  } catch {
    /* no account yet */
  }
  const client = createClient(url, service, plain);
  let login = saved.email && saved.password ? await client.auth.signInWithPassword({ email: saved.email, password: saved.password }) : null;
  if (!login || login.error) {
    const email = `e2e-${randomUUID().slice(0, 8)}@example.test`;
    const password = `Local-test-${randomUUID()}!`;
    const { error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) throw error;
    await mkdir(resolve(root, '.data'), { recursive: true });
    await writeFile(ACCOUNT_FILE, JSON.stringify({ ...saved, email, password }, null, 2), { mode: 0o600 });
    login = await client.auth.signInWithPassword({ email, password });
    if (login.error) throw login.error;
    console.log('Created a local test account; its credentials are in .data/local-test-account.json.');
  }
  const token = login.data.session.access_token;

  // The API restarts whenever a server file it imports changes (npm run dev watches them), so a refused connection is
  // asked again for half a minute before it counts.
  let unreachable = 0;
  async function request(path, init = {}) {
    const started = performance.now();
    let response;
    for (let attempt = 0; !response; attempt++) {
      try {
        response = await fetch(api + path, {
          ...init,
          headers: { Authorization: `Bearer ${token}`, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        });
      } catch (error) {
        if (attempt >= 60) throw error;
        unreachable++;
        await new Promise((done) => setTimeout(done, 500));
      }
    }
    const text = await response.text();
    const body = text ? JSON.parse(text) : null;
    if (!response.ok) throw new Error(`${path}: ${response.status} ${JSON.stringify(body)}`);
    return { body, bytes: text.length, ms: performance.now() - started };
  }

  const pdf = await readFile(options.pdf);
  const profile = (await request('/settings')).body;
  const model = profile.defaultModel;
  const reserved = performance.now();
  const reservation = (
    await request('/documents', {
      method: 'POST',
      body: JSON.stringify({ filename: basename(options.pdf), size: pdf.length, model, allowTraining: model.endsWith('-contributor') }),
    })
  ).body;
  const documentId = reservation.documentId;
  console.log(`Document ${documentId}\nReader   ${web}/?document=${documentId}\nModel    ${model}\nFile     ${basename(options.pdf)} (${(pdf.length / 1024 / 1024).toFixed(1)} MB)`);
  const upload = await client.storage.from(reservation.bucket).upload(reservation.path, pdf, { contentType: 'application/pdf' });
  if (upload.error) throw upload.error;
  const t0 = performance.now();
  const marks = [{ name: 'reservation made', ms: reserved - t0 }, { name: 'upload finished', ms: 0 }];
  const mark = (name, extra = {}) => marks.push({ name, ms: performance.now() - t0, ...extra });
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok: !!ok, detail });
  // PUT /reader-state as the reader does; the status it answers (the reader shows an error for anything else).
  const save = async (place) => {
    try {
      const response = await fetch(`${api}/documents/${documentId}/reader-state`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 1, pageOffset: 0, zoom: null, ...place }),
      });
      return response.status;
    } catch {
      return 'no answer';
    }
  };

  let outcome = 'timeout';
  let failure = null;
  const partials = [];
  const report = {};
  let held = null;
  const countsOnly = { held: 0, small: 0 };
  let tourId = null;
  let polls = 0;
  let manifest = null;
  try {
    await request(`/documents/${documentId}/complete`, { method: 'POST' });
    mark('completion accepted');
    let generation = null;
    let stage = '';
    let status = '';
    let analysis = '';
    const deadline = t0 + options.timeoutS * 1000;
    while (performance.now() < deadline) {
      polls++;
      if (!generation) {
        manifest = (await request(`/documents/${documentId}/manifest`)).body;
        if (manifest.analysis?.status !== analysis) {
          analysis = manifest.analysis?.status ?? '';
          if (['ready', 'limited'].includes(analysis)) mark('analysis ready', { note: `${manifest.doc?.source?.num_pages ?? '?'} pages, ${analysis}` });
          else if (analysis === 'failed') throw new Error(`The analysis failed: ${manifest.analysis?.error ?? 'no reason given'}`);
        }
        generation = manifest.tourGeneration ?? null;
        if (generation) mark('tour queued', { note: generation.status });
      }
      if (generation) {
        const query = held ? `?after=${held.ready}&attempt=${held.attempt}` : '';
        const { body: view, bytes, ms } = await request(`/documents/${documentId}/generations/${generation.id}/partial${query}`);
        // A poll that holds the latest partial must get the counts only, whatever the tour weighs.
        if (held && view.attempt === held.attempt && view.ready === held.ready) {
          countsOnly.held++;
          if (view.tour === null) countsOnly.small++;
        }
        if (view.status !== status) {
          status = view.status;
          if (status === 'generating') mark('tour generating');
          stage = '';
        }
        if (status === 'generating' && view.stage !== stage) {
          stage = view.stage;
          mark(`stage ${stage}`);
        }
        if (view.tour && (!held || view.attempt !== held.attempt || view.ready > held.ready)) {
          const steps = stepsOf(view.tour).length;
          if (held && view.attempt === held.attempt) check(`partial ${view.ready} only appends to partial ${held.ready}`, appendOnly(held.tour, view.tour));
          else if (held) mark('a new attempt began', { note: 'the reader replaces its partial tour' });
          held = { attempt: view.attempt, ready: view.ready, planned: view.planned, tour: view.tour };
          partials.push({ ready: view.ready, planned: view.planned, steps, bytes, requestMs: Math.round(ms), shape: shapeOf(view.tour) });
          mark('partial', { ready: view.ready, planned: view.planned, bytes, steps });
          // The reader saves where the learner is as the steps play; the tour has no saved id yet.
          if (partials.length === 1) {
            const answered = await save({ tourId: null, stepId: stepsOf(view.tour)[0].id });
            check('the reader can save its place in a tour that is still being written', answered === 204, `answered ${answered}`);
          }
        }
        if (!RUNNING.includes(view.status)) {
          tourId = view.tourId;
          if (view.status === 'ready') {
            mark('generation finished', { steps: undefined });
            check('the partial is gone once the tour is finished', view.tour === null && view.ready === 0 && view.planned === 0);
            outcome = 'ready';
          } else {
            outcome = view.status;
            failure = `${view.status}${view.stage ? ` at ${view.stage}` : ''}`;
          }
          break;
        }
      }
      await new Promise((done) => setTimeout(done, options.pollMs));
    }

    if (outcome === 'ready') {
      manifest = (await request(`/documents/${documentId}/manifest`)).body;
      const finished = manifest.selectedTour;
      mark('finished tour served by the manifest', { note: `${stepsOf(finished?.tour).length} steps` });
      const doneMark = marks.find((m) => m.name === 'generation finished');
      doneMark.steps = stepsOf(finished?.tour).length;
      check('the manifest serves the finished tour', finished && finished.id === tourId);
      check('a partial tour arrived before the finished one', partials.length > 0 && marks.find((m) => m.name === 'partial').ms < doneMark.ms);
      check(
        'polls that held the latest partial got counts only',
        countsOnly.held > 0 && countsOnly.small === countsOnly.held,
        `${countsOnly.small} of ${countsOnly.held}`,
      );
      if (finished) {
        report.finalShape = shapeOf(finished.tour);
        const first = stepsOf(finished.tour)[0];
        const answered = await save({ tourId: finished.id, stepId: first.id });
        const state = (await request(`/documents/${documentId}/manifest`)).body.readerState;
        check('the place carries over to the finished tour', answered === 204 && state?.tourId === finished.id && state?.stepId === first.id, `answered ${answered}`);
      }
      if (held && finished) {
        const relation = compareFinished(held.tour, finished.tour);
        check('the finished tour begins with the last partial tour', relation.prefix, relation.differing.slice(0, 3).map((d) => `step ${d.index + 1} (${d.id}): ${d.why}`).join('; '));
        check('the finished tour has at least as many steps', relation.finished >= relation.held, `${relation.held} held, ${relation.finished} finished`);
      }
    } else if (outcome === 'timeout') failure = `no result after ${options.timeoutS} s`;
  } finally {
    if (!options.keep) await request(`/documents/${documentId}`, { method: 'DELETE' }).catch(() => undefined);
  }

  const summary = summarize(marks);
  Object.assign(report, { documentId: options.keep ? documentId : null, file: basename(options.pdf), model, outcome, failure, polls, unreachable, pollMs: options.pollMs, marks, summary, partials, checks });
  await mkdir(resolve(root, '.data'), { recursive: true });
  const out = resolve(root, `.data/e2e-progressive-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await writeFile(out, JSON.stringify(report, null, 2), { mode: 0o600 });
  if (options.json) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`\n${formatTimeline(marks)}\n`);
    if (summary.firstPartial !== null)
      console.log(
        `First step playable ${seconds(summary.firstPartial)} s after the upload finished (${summary.firstPartialSteps} of ${summary.firstPartialPlanned} steps; the reader polls every 1.5 s, so it shows it up to 1.5 s later),\n` +
          (summary.finished !== null
            ? `finished tour at ${seconds(summary.finished)} s: ${seconds(summary.headStart)} s earlier (${Math.round(summary.headStartShare * 100)} % of the wait), ${summary.partials} partial tours on the way.`
            : 'the tour did not finish.'),
      );
    else console.log(summary.finished !== null ? `No partial tour arrived; the finished tour came at ${seconds(summary.finished)} s.` : 'No partial and no finished tour.');
    if (unreachable) console.log(`The API refused ${unreachable} requests while it restarted; they were asked again.`);
    for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? ` (${c.detail})` : ''}`);
    console.log(`\nSaved ${out.replace(root, '')}`);
  }
  if (outcome !== 'ready') {
    console.error(`The tour did not finish: ${failure}.`);
    process.exitCode = 1;
  } else if (checks.some((c) => !c.ok)) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
