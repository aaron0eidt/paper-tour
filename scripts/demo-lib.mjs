// Shared by preflight.mjs, demo-prepare.mjs and demo-offline.mjs: the demo folders and how they are checked, the file of
// saved answers, and the small environment and HTTP helpers the three use. It prints nothing and never returns the Meta
// key: callers show text only after it went through redactor().
import { execFile } from 'node:child_process';
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readSync,
  readlinkSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv, promisify } from 'node:util';

const execute = promisify(execFile);

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEMO_DIR = join(ROOT, 'demo');
/** The documents the live demo plays, in the order it plays them (notes/DEMO-RUNBOOK.md). */
export const DEMO_SET = ['attention-short', 'eval-fish', 'eval-slides', 'eval-sheet-de'];
/** The folder names the API accepts (server/src/harness/ask-assets.ts, DEMO_PAPER). */
export const DEMO_PAPER = /^(?!.*\.\.)\w[\w.-]{0,79}$/;
export const WEB_URL = 'http://localhost:5174';

// ------------------------------------------------------------------------------------------------ environment

/**
 * The root .env overlaid with the process environment, which wins, as server/src/config.ts loads it. `found` says
 * whether the file exists.
 */
export function loadEnv(root = ROOT, processEnv = process.env) {
  const path = join(root, '.env');
  const found = existsSync(path);
  const file = found ? parseEnv(readFileSync(path, 'utf8')) : {};
  const live = Object.fromEntries(Object.entries(processEnv).filter(([, value]) => value !== undefined));
  return { found, env: { ...file, ...live } };
}

/** The Meta connection the server would use: the key (MODEL_API_KEY, else MUSE_API_KEY), the address and the model. */
export function museSettings(env) {
  const key = (env.MODEL_API_KEY ?? '').trim() || (env.MUSE_API_KEY ?? '').trim();
  return {
    key,
    keyName: (env.MODEL_API_KEY ?? '').trim()
      ? 'MODEL_API_KEY'
      : (env.MUSE_API_KEY ?? '').trim()
        ? 'MUSE_API_KEY'
        : null,
    baseUrl: (env.MUSE_BASE_URL ?? 'https://api.meta.ai/v1').trim().replace(/\/+$/, ''),
    model: (env.MUSE_MODEL ?? 'muse-spark-1.3').trim(),
  };
}

/** Where the API listens (HOST and PORT of the server, loopback by default) and where Python lives. */
export function localAddresses(env) {
  const host = ['', '0.0.0.0', '::', '[::]'].includes((env.HOST ?? '').trim()) ? '127.0.0.1' : env.HOST.trim();
  return {
    api: `http://${host}:${Number(env.PORT) || 3001}`,
    python: env.PYTHON_BIN || join(ROOT, 'ingest', '.venv', 'bin', 'python'),
  };
}

/** A function that hides the key, and anything shaped like a bearer token, in text that is about to be shown. */
export function redactor(...secrets) {
  const hidden = secrets.filter((secret) => typeof secret === 'string' && secret.length >= 6);
  return (text) =>
    hidden
      .reduce((out, secret) => out.split(secret).join('[key]'), String(text ?? ''))
      .replace(/Bearer\s+[\w.~+/=-]+/gi, 'Bearer [key]');
}

// ------------------------------------------------------------------------------------------------ requests

/** Why a request failed, in words an operator can act on. */
export function failureReason(error, timeoutMs) {
  if (error?.name === 'TimeoutError' || error?.name === 'AbortError')
    return `no answer within ${Math.round(timeoutMs / 1000)} s`;
  const code = error?.cause?.code ?? error?.code;
  if (code === 'ECONNREFUSED') return 'connection refused, nothing is listening there';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'the host name did not resolve, so there is no network';
  if (code === 'ECONNRESET' || code === 'UND_ERR_SOCKET') return 'the connection was cut';
  return String(error?.cause?.message ?? error?.message ?? error);
}

/**
 * One request that gives up after `timeoutMs`. Never throws: a network failure is `{ status: 0, error }`, otherwise
 * `{ status, ok, text, json, ms }` with `json` set when the body parses.
 */
export async function call(fetchImpl, url, init = {}, timeoutMs = 5000) {
  const started = performance.now();
  try {
    const response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    const text = await response.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { status: response.status, ok: response.ok, text, json, ms: performance.now() - started };
  } catch (error) {
    return { status: 0, ok: false, error: failureReason(error, timeoutMs), ms: performance.now() - started };
  }
}

export const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;
export const megabytes = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ------------------------------------------------------------------------------------------------ folders

/**
 * The demo folders named on the command line: names or comma lists, `demo/name/` accepted, the demo set when none.
 * Throws on a name the API would not accept.
 */
export function folderList(args) {
  const names = args
    .flatMap((arg) => arg.split(','))
    .map((arg) =>
      arg
        .trim()
        .replace(/\/+$/, '')
        .replace(/^(?:\.\/)?demo\//, ''),
    )
    .filter(Boolean);
  for (const name of names)
    if (!DEMO_PAPER.test(name)) throw new Error(`"${name}" is not a demo folder name (see the folders under demo/).`);
  return names.length ? [...new Set(names)] : [...DEMO_SET];
}

function readJson(path, label, bad) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    bad(`${label} is not valid JSON (${error.message})`);
    return null;
  }
}

function pdfFacts(file) {
  let size;
  try {
    size = statSync(file).size;
  } catch {
    try {
      return { missing: `a broken link to ${readlinkSync(file)}` };
    } catch {
      return { missing: 'missing' };
    }
  }
  if (!size) return { missing: 'empty' };
  const header = Buffer.alloc(5);
  const fd = openSync(file, 'r');
  try {
    readSync(fd, header, 0, 5, 0);
  } finally {
    closeSync(fd);
  }
  return header.toString('latin1') === '%PDF-' ? { size } : { missing: 'not a PDF (it does not start with %PDF-)' };
}

/** The tour's steps in order. */
export const tourSteps = (tour) => (tour?.chapters ?? []).flatMap((chapter) => chapter?.steps ?? []);

/**
 * What is wrong with one demo folder: paper.pdf, doc.json and tour.json must exist and read, the tour must belong to
 * this doc.json, and ingest/validate.py (injected as `validate`; none skips it) must accept both against the schemas
 * and check every ID. `needTour: false` leaves a missing tour.json alone, for a folder about to get one.
 * Returns `{ name, dir, problems, warnings, facts, doc, tour }`; a problem names its fix.
 */
export async function checkFolder(name, { demoDir = DEMO_DIR, validate, needTour = true } = {}) {
  const dir = join(demoDir, name);
  const result = { name, dir, problems: [], warnings: [], facts: {}, doc: null, tour: null };
  const bad = (text, fix) => result.problems.push(fix ? `${text}; ${fix}` : text);
  if (!existsSync(dir)) {
    bad(`demo/${name} does not exist`, 'check the name against ls demo');
    return result;
  }
  const pdf = pdfFacts(join(dir, 'paper.pdf'));
  if (pdf.missing) bad(`paper.pdf is ${pdf.missing}`, 'put the PDF there (README quick start)');
  else result.facts.pdfBytes = pdf.size;

  const doc = readJson(join(dir, 'doc.json'), 'doc.json', bad);
  if (doc === undefined)
    bad('doc.json is missing', `run ingest/.venv/bin/python ingest/ingest.py demo/${name}/paper.pdf`);
  else if (doc && doc.schema !== 'paper-tour/doc@0.1') bad('doc.json is not a paper-tour/doc@0.1 file');
  else result.doc = doc;
  const docSha = result.doc?.source?.sha256;
  result.facts.docSha = docSha;

  const tour = readJson(join(dir, 'tour.json'), 'tour.json', bad);
  if (tour === undefined) {
    if (needTour) bad('tour.json is missing', `npm run demo:prepare -- --regenerate ${name}`);
  } else if (tour) {
    if (tour.schema !== 'paper-tour/tour@0.1') bad('tour.json is not a paper-tour/tour@0.1 file');
    else {
      result.tour = tour;
      const steps = tourSteps(tour);
      if (!steps.length) bad('tour.json has no steps');
      const empty = steps.filter((step) => typeof step?.say !== 'string' || !step.say.trim());
      if (empty.length) bad(`${empty.length} step(s) of tour.json have no narration (first: ${empty[0]?.id})`);
      if (docSha && tour.doc_sha256 && tour.doc_sha256 !== docSha)
        bad('tour.json was written for a different PDF than doc.json describes', 'regenerate the tour');
      Object.assign(result.facts, {
        title: tour.title,
        docType: tour.doc_type,
        language: tour.voices?.host?.lang,
        chapters: tour.chapters.length,
        steps: steps.length,
        lastStepId: steps.at(-1)?.id,
        questions: (tour.suggested_questions ?? []).filter((q) => typeof q === 'string' && q.trim()),
      });
    }
  }
  // The full validator only on files that read, since it would only repeat what is already said.
  if (!result.problems.length && result.doc && validate) {
    const report = await validate(dir);
    if (!report.ran) result.warnings.push(`the full validation did not run (${report.reason})`);
    else {
      result.facts.validated = report.ok;
      if (!report.ok)
        bad(
          `validate.py found ${report.errors.length} error(s), first: ${report.errors[0] ?? report.summary}`,
          `ingest/.venv/bin/python ingest/validate.py demo/${name}`,
        );
    }
  }
  return result;
}

/**
 * Runs ingest/validate.py on a folder: schemas for doc.json and tour.json, then every ID the tour points at, the
 * hash of the PDF and the order of the words. `ran: false` says why it could not run; its errors are the lines it
 * prints as `error`.
 */
export async function runValidator(dir, { python = localAddresses({}).python, timeoutMs = 60_000 } = {}) {
  const parse = (stdout) => {
    const lines = stdout.split('\n');
    const errors = lines.filter((line) => line.startsWith('error')).map((line) => line.replace(/^error\s+/, ''));
    const summary = lines.find((line) => line.startsWith('validate ')) ?? '';
    return { ran: true, ok: !errors.length && /: OK,/.test(summary), errors, summary };
  };
  try {
    const { stdout } = await execute(python, [join(ROOT, 'ingest', 'validate.py'), dir], {
      timeout: timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
    });
    return parse(stdout);
  } catch (error) {
    if (error.code === 'ENOENT') return { ran: false, reason: `Python not found at ${python}` };
    // Exit code 1 with a report is "errors found"; without one the validator itself crashed.
    if (typeof error.stdout === 'string' && /^validate /m.test(error.stdout)) return parse(error.stdout);
    const last = String(error.stderr ?? '')
      .trim()
      .split('\n')
      .at(-1);
    return { ran: false, reason: `validate.py did not finish: ${last || error.message}` };
  }
}

// ------------------------------------------------------------------------------------------------ IDs in answers

/** Every ID doc.json defines that a step may point at: blocks, sentences, sections, figures, panels, equations, tasks. */
export function docIds(doc) {
  const ids = new Set();
  for (const list of [doc.blocks, doc.sentences, doc.sections, doc.figures, doc.equations])
    for (const item of list ?? []) if (item?.id) ids.add(item.id);
  for (const figure of doc.figures ?? []) for (const panel of figure.panels ?? []) if (panel?.id) ids.add(panel.id);
  const walk = (task) => {
    if (task?.id) ids.add(task.id);
    for (const part of task?.parts ?? []) walk(part);
  };
  for (const task of doc.exercises ?? []) walk(task);
  for (const page of doc.pages ?? []) ids.add(`page${page.n}`);
  return ids;
}

/** The IDs a step's actions point at. */
export function targetsOf(step) {
  return (step?.actions ?? []).flatMap((action) => [
    ...(typeof action?.target === 'string' ? [action.target] : []),
    ...(typeof action?.anchor === 'string' ? [action.anchor] : []),
    ...(Array.isArray(action?.targets) ? action.targets.filter((t) => typeof t === 'string') : []),
  ]);
}

/**
 * What stops an answer from being played from a file: the document could not answer, there is nothing to play, or a
 * step is empty or points at an ID that doc.json does not have. The server checks the same before it replies; this is
 * the check on what is about to be saved.
 */
export function answerProblems(answer, ids) {
  const problems = [];
  if (!answer || typeof answer !== 'object') return ['the reply is not an answer'];
  if (answer.answerable === 'no') problems.push('the document says it cannot answer this');
  else if (answer.answerable !== 'yes' && answer.answerable !== 'partly') problems.push('the reply has no verdict');
  if (!Array.isArray(answer.steps) || !answer.steps.length) problems.push('the answer has no steps');
  for (const step of Array.isArray(answer.steps) ? answer.steps : []) {
    if (typeof step?.id !== 'string' || typeof step?.say !== 'string' || !step.say.trim())
      problems.push(`step ${step?.id ?? '?'} has no id or narration`);
    if (!Array.isArray(step?.actions)) problems.push(`step ${step?.id ?? '?'} has no actions list`);
    else
      for (const target of targetsOf(step))
        if (!ids.has(target)) problems.push(`step ${step.id} points at ${target}, which doc.json does not have`);
  }
  return problems;
}

// ------------------------------------------------------------------------------------------------ saved answers

export const ANSWERS_SCHEMA = 'paper-tour/answers@0.1';
export const answersPath = (dir) => join(dir, 'answers.json');

/** Questions are the same up to case, spacing and Unicode composition (server/src/ask-cache.ts). */
export const fold = (text) => String(text).normalize('NFKC').replace(/\s+/g, ' ').trim().toUpperCase().toLowerCase();

/** The saved answers of a folder: the file, or null when there is none or it cannot be read. */
export function readAnswers(dir) {
  try {
    const file = JSON.parse(readFileSync(answersPath(dir), 'utf8'));
    return file?.schema === ANSWERS_SCHEMA && Array.isArray(file.answers) ? file : null;
  } catch {
    return null;
  }
}

/** Writes the file whole or not at all, so a demo server reading it never sees half of it. */
export function writeAnswers(dir, file) {
  const path = answersPath(dir);
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`);
  renameSync(temporary, path);
}

/**
 * The saved answer to a request the reader sends, or null. A saved answer stands for the plain question: it is not
 * used when the learner selected a region, and it is used only in the language it was saved in (the reader's default
 * is none, so a chosen answer language never gets an answer in another one). The step the learner is on, the figure in
 * view and the earlier conversation are ignored, as a suggested question stands on its own.
 */
export function findAnswer(file, request) {
  if (!file || typeof request?.question !== 'string' || request.selection) return null;
  const language = request.responseLanguage || null;
  const wanted = fold(request.question);
  return (
    file.answers.find((entry) => fold(entry.question) === wanted && (entry.response_language ?? null) === language) ??
    null
  );
}

/** Which of the tour's suggested questions have a saved answer for this document, and how many there are. */
export function answerCoverage(file, tour, docSha) {
  const questions = (tour?.suggested_questions ?? []).filter((q) => typeof q === 'string' && q.trim());
  const usable = file && (!docSha || !file.doc_sha256 || file.doc_sha256 === docSha) ? file : null;
  const saved = questions.filter((q) => findAnswer(usable, { question: q }));
  return { saved: saved.length, total: questions.length, missing: questions.filter((q) => !saved.includes(q)) };
}
