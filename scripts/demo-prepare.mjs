// Gets the demo folders ready, once, before the demo: checks their documents, validates every tour, and saves an answer
// to each suggested question next to the tour (demo/<folder>/answers.json) so the demo can play them without a model.
//   npm run demo:prepare -- [folder ...] [--regenerate] [--preset standard] [--language de-DE]
//                           [--no-ask] [--force] [--api <url>] [--parallel 2]
// Without folders it takes the demo set. For each folder it
//   1. checks paper.pdf, doc.json and tour.json and runs ingest/validate.py on them;
//   2. with --regenerate, writes a new tour with server/run-tour.ts first (real Meta calls, about 1 to 2 minutes and
//      $0.3 to $0.8 a folder). The new tour goes live only when it validates; the old one is kept in
//      .data/demo-prepare/<folder>/previous/, the run's metadata.json and events.json stay in .data/demo-prepare/<folder>/run/;
//   3. asks each suggested question through the running API's demo route, as the reader would on the tour's last step
//      (a live Muse Spark call, about a cent), checks the answer and saves it. This also fills the API's own answer
//      store for half an hour. Answers already saved are kept unless --force; --no-ask skips this step.
// Saved answers play without a model through `npm run demo:offline` (scripts/demo-offline.mjs). Exits non-zero when a
// folder fails its checks or a question gets no usable answer.
import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import {
  ANSWERS_SCHEMA,
  DEMO_DIR,
  ROOT,
  answerProblems,
  call,
  checkFolder,
  docIds,
  findAnswer,
  folderList,
  loadEnv,
  localAddresses,
  museSettings,
  readAnswers,
  redactor,
  runValidator,
  seconds,
  writeAnswers,
} from './demo-lib.mjs';

const execute = promisify(execFile);

/** The server gives up on a question after 75 seconds; the wait here is a little longer. */
const ASK_MS = 90_000;
/** A busy or failing model is asked again after these pauses, as many times as there are pauses. */
const RETRY_WAITS = [4000, 8000];
const RETRYABLE = new Set([429, 502, 503, 504]);
const PRESETS = ['quick', 'standard', 'deep'];

const sleepFor = (ms) => new Promise((done) => setTimeout(done, ms));

/** Runs `work` over `items`, `width` at a time; the results come back in order. */
async function inPool(items, width, work) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(width, items.length) }, async () => {
      while (next < items.length) {
        const mine = next++;
        results[mine] = await work(items[mine]);
      }
    }),
  );
  return results;
}

/** The line of a failed run that says why: a JSON message or an Error, else the first line; never a stack frame. */
export function failureSummary(stderr, fallback) {
  const lines = `${stderr ?? ''}`
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const why = lines.find((line) => /"message"|^(?:\w+)?Error\b/.test(line)) ?? lines[0];
  return (why ?? fallback).slice(0, 300);
}

/**
 * The folder the generator reads. A folder made of links to another one (attention-short) is read from that one:
 * ingest/tour_assets.py refuses a PDF or doc.json that is itself a link.
 */
function sourceFolder(dir) {
  const real = dirname(realpathSync(join(dir, 'doc.json')));
  return existsSync(join(real, 'paper.pdf')) ? real : dir;
}

/** Writes a tour with the same generator the worker uses (server/run-tour.ts); throws with the reason on failure. */
export async function generateTour({ name, preset, language, folder, out }) {
  const args = ['--import', 'tsx', 'run-tour.ts', preset, out, folder, name, ...(language ? [language] : [])];
  try {
    const { stdout } = await execute(process.execPath, args, {
      cwd: join(ROOT, 'server'),
      timeout: 15 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return stdout.trim().split('\n').at(-1);
  } catch (error) {
    throw new Error(`run-tour.ts failed: ${failureSummary(error.stderr, error.message)}`);
  }
}

/**
 * Writes a new tour for a folder into the scratch area, checks it as if it were in place, and only then swaps it in.
 * Returns `{ problems, previous }`: what stopped it, or none, and where the tour it replaced was kept, if there was one.
 */
async function regenerate(name, check, { scratch, preset, language, validate, generate, stamp }) {
  const run = join(scratch, name, 'run');
  const staged = join(scratch, name, 'staged');
  rmSync(run, { recursive: true, force: true });
  mkdirSync(run, { recursive: true });
  await generate({ name, preset, language, folder: sourceFolder(check.dir), out: run });
  if (!existsSync(join(run, 'tour.json'))) return { problems: ['the generator finished without writing a tour.json'] };
  // The candidate sits in a folder of the same name, beside links to the real document, so validate.py judges it whole.
  const candidate = join(staged, name);
  rmSync(staged, { recursive: true, force: true });
  mkdirSync(candidate, { recursive: true });
  for (const file of ['paper.pdf', 'doc.json', 'figures'])
    if (existsSync(join(check.dir, file))) symlinkSync(realpathSync(join(check.dir, file)), join(candidate, file));
  copyFileSync(join(run, 'tour.json'), join(candidate, 'tour.json'));
  const verdict = await checkFolder(name, { demoDir: staged, validate });
  if (verdict.problems.length)
    return { problems: verdict.problems.map((problem) => `the new tour is not used: ${problem}`) };
  let previous;
  if (existsSync(join(check.dir, 'tour.json'))) {
    previous = join(scratch, name, 'previous', `tour-${stamp}.json`);
    mkdirSync(join(scratch, name, 'previous'), { recursive: true });
    copyFileSync(join(check.dir, 'tour.json'), previous);
  }
  copyFileSync(join(run, 'tour.json'), join(check.dir, 'tour.json'));
  return { problems: [], previous };
}

/**
 * Prepares each folder in turn and returns `{ ok, results }`, one result per folder with its problems and the fate of
 * each suggested question (`saved`, `kept` or `failed`). `log(line)` reports progress as it happens.
 */
export async function prepare(options) {
  const {
    folders,
    api,
    demoDir = DEMO_DIR,
    scratch = join(ROOT, '.data', 'demo-prepare'),
    ask = true,
    force = false,
    regenerate: fresh = false,
    preset = 'standard',
    language,
    parallel = 2,
    askMs = ASK_MS,
    retryWaits = RETRY_WAITS,
    fetchImpl = fetch,
    validate,
    generate = generateTour,
    sleep = sleepFor,
    now = () => new Date(),
    log = () => {},
    redact = (text) => text,
  } = options;
  const stamp = now().toISOString().replace(/[-:]/g, '').slice(0, 13);
  // The live API, looked at once and only if some question needs asking. The saved-answers stand-in would only hand back
  // what is already saved, so it must not be mistaken for it.
  let apiState;
  const liveApi = () =>
    (apiState ??= call(fetchImpl, `${api}/health`, {}, 3000).then((res) => {
      if (res.error)
        return { ok: false, reason: `the API at ${api} does not answer (${res.error}); start it with npm run dev` };
      if (res.json?.mode === 'saved-answers')
        return { ok: false, reason: `the API at ${api} is the saved-answers stand-in; stop it and start the live API` };
      return res.status === 200 ? { ok: true } : { ok: false, reason: `the API at ${api} answered HTTP ${res.status}` };
    }));

  async function askOne(name, question, stepId, ids) {
    for (let attempt = 0; ; attempt++) {
      const res = await call(
        fetchImpl,
        `${api}/api/demo/${encodeURIComponent(name)}/ask`,
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, stepId }) },
        askMs,
      );
      if (res.ok) {
        const problems = answerProblems(res.json, ids);
        return problems.length
          ? { question, status: 'failed', why: problems.slice(0, 2).join('; ') }
          : { question, status: 'saved', seconds: res.ms / 1000, answer: res.json };
      }
      const why = res.json?.error?.message ?? res.error ?? `HTTP ${res.status}`;
      // A cut connection or a busy model is tried again; a question that took the whole wait is not.
      const transient = res.error ? !res.error.startsWith('no answer within') : RETRYABLE.has(res.status);
      if (attempt < retryWaits.length && transient) {
        await sleep(retryWaits[attempt]);
        continue;
      }
      return { question, status: 'failed', why: redact(why) };
    }
  }

  const results = [];
  for (const name of folders) {
    log(`== ${name}`);
    const result = { name, ok: true, problems: [], regenerated: false, questions: [] };
    results.push(result);
    const stop = (problems) => {
      result.ok = false;
      result.problems.push(...problems);
      for (const problem of problems) log(`  FAIL    ${redact(problem)}`);
      return result;
    };
    let check = await checkFolder(name, { demoDir, validate, needTour: !fresh });
    if (check.problems.length) {
      stop(check.problems);
      continue;
    }
    if (fresh) {
      log(`  writing a new ${preset} tour with the Meta models, this takes a minute or two ...`);
      let previous;
      try {
        const outcome = await regenerate(name, check, { scratch, preset, language, validate, generate, stamp });
        if (outcome.problems.length) {
          stop(outcome.problems);
          continue;
        }
        previous = outcome.previous;
      } catch (error) {
        stop([redact(error.message)]);
        continue;
      }
      result.regenerated = true;
      check = await checkFolder(name, { demoDir, validate });
      if (check.problems.length) {
        stop(check.problems);
        continue;
      }
      log(`  new tour in place${previous ? `; the old one is ${previous}` : ''}`);
    }
    const { facts } = check;
    log(
      `  tour    ${facts.steps} steps in ${facts.chapters} chapters, ${facts.validated ? 'validates' : 'not run through validate.py'}`,
    );
    for (const warning of check.warnings) log(`  WARN    ${warning}`);
    if (!ask) continue;
    if (!facts.questions.length) {
      log('  the tour suggests no questions, so there is nothing to prepare');
      continue;
    }
    const known = force || !check.facts.docSha ? null : readAnswers(check.dir);
    const usable = known && (!known.doc_sha256 || known.doc_sha256 === facts.docSha) ? known : null;
    const kept = new Map(facts.questions.map((q) => [q, findAnswer(usable, { question: q })]));
    const todo = facts.questions.filter((q) => !kept.get(q));
    const ids = docIds(check.doc);
    const live = todo.length ? await liveApi() : { ok: true };
    const asked = new Map();
    if (todo.length && !live.ok) stop([live.reason]);
    else
      await inPool(todo, parallel, async (question) => {
        const outcome = await askOne(name, question, facts.lastStepId, ids);
        asked.set(question, outcome);
        const short = question.length > 64 ? `${question.slice(0, 63)}...` : question;
        log(
          outcome.status === 'saved'
            ? `  saved   ${short} (${seconds(outcome.seconds * 1000)}, ${outcome.answer.steps.length} steps)`
            : `  FAILED  ${short}: ${outcome.why}`,
        );
      });
    const entries = [];
    for (const question of facts.questions) {
      const outcome = asked.get(question);
      if (kept.get(question)) {
        entries.push(kept.get(question));
        result.questions.push({ question, status: 'kept' });
        log(`  kept    ${question.length > 64 ? `${question.slice(0, 63)}...` : question} (already saved)`);
      } else if (outcome?.status === 'saved') {
        entries.push({
          question,
          step_id: facts.lastStepId,
          response_language: null,
          saved_at: now().toISOString(),
          seconds: Math.round(outcome.seconds * 10) / 10,
          answer: outcome.answer,
        });
        result.questions.push({ question, status: 'saved', seconds: outcome.seconds });
      } else {
        result.ok = false;
        result.questions.push({ question, status: 'failed', why: outcome?.why ?? live.reason });
      }
    }
    if (entries.length) {
      writeAnswers(check.dir, {
        schema: ANSWERS_SCHEMA,
        paper: name,
        doc_sha256: facts.docSha ?? null,
        title: facts.title,
        saved_at: now().toISOString(),
        answers: entries,
      });
      log(`  wrote   demo/${name}/answers.json with ${entries.length} of ${facts.questions.length} answers`);
    }
  }
  return { ok: results.every((result) => result.ok), results };
}

/** The closing lines: what was done and what is left. */
export function summary({ ok, results }, { ask = true } = {}) {
  const count = (status) => results.flatMap((r) => r.questions).filter((q) => q.status === status).length;
  const failedFolders = results.filter((r) => r.problems.length).map((r) => r.name);
  const lines = [
    '',
    `${ok ? 'DONE' : 'NOT DONE'}: ${results.length} folder(s)` +
      (ask
        ? `, answers ${count('saved')} saved now, ${count('kept')} kept, ${count('failed')} failed.`
        : ', answers not asked for.'),
  ];
  if (failedFolders.length) lines.push(`Folders that failed their checks: ${failedFolders.join(', ')}.`);
  if (ok && ask)
    lines.push('Saved answers play with no model call through npm run demo:offline (notes/DEMO-RUNBOOK.md).');
  return lines.join('\n');
}

async function main(argv) {
  const usage =
    'usage: npm run demo:prepare -- [folder ...] [--regenerate] [--preset quick|standard|deep] [--language de-DE]\n' +
    '                               [--no-ask] [--force] [--api <url>] [--parallel 2]';
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        regenerate: { type: 'boolean' },
        preset: { type: 'string', default: 'standard' },
        language: { type: 'string' },
        'no-ask': { type: 'boolean' },
        force: { type: 'boolean' },
        api: { type: 'string' },
        parallel: { type: 'string', default: '2' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    console.error(`${error.message}\n${usage}`);
    process.exitCode = 2;
    return;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.error(usage);
    return;
  }
  const parallel = Number(values.parallel);
  if (!PRESETS.includes(values.preset) || !Number.isInteger(parallel) || parallel < 1 || parallel > 2) {
    console.error(
      `--preset is one of ${PRESETS.join(', ')} and --parallel is 1 or 2 (the API allows two questions at a time).\n${usage}`,
    );
    process.exitCode = 2;
    return;
  }
  let folders;
  try {
    folders = folderList(positionals);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
    return;
  }
  const { env } = loadEnv();
  const settings = museSettings(env);
  if (values.regenerate && !settings.key) {
    console.error('--regenerate makes Meta calls and needs MODEL_API_KEY in the root .env.');
    process.exitCode = 2;
    return;
  }
  const local = localAddresses(env);
  const result = await prepare({
    folders,
    api: (values.api ?? local.api).replace(/\/+$/, ''),
    ask: !values['no-ask'],
    force: values.force,
    regenerate: values.regenerate,
    preset: values.preset,
    language: values.language,
    parallel,
    validate: (dir) => runValidator(dir, { python: local.python }),
    log: (line) => console.log(line),
    redact: redactor(settings.key),
  });
  console.log(summary(result, { ask: !values['no-ask'] }));
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
