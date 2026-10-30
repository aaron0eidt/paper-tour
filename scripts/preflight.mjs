// A check to run before a demo, in under 30 seconds: one PASS, WARN, FAIL, SKIP or NOTE line per item, and a non-zero
// exit when a must-have item fails. The key is checked for and never printed.
//   npm run preflight -- [folder ...] [--offline] [--skip-models] [--strict] [--json] [--api <url>] [--web <url>]
// Items: the Meta key; the API and the web app answer; the demo ask route is on; Muse Spark, SAM 3.1 and Muse Voice
// Transcribe each answer one tiny call (well under a cent in all); every demo folder has paper.pdf, doc.json and tour.json
// that validate, are served by the web app and have saved answers; and a note on the browser's speech.
// The folders default to the demo set. --offline rehearses a venue without network: no key and no model calls, and
// every folder must then have its saved answers. --strict makes warnings fail too.
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { deflateSync } from 'node:zlib';
import {
  DEMO_DIR,
  ROOT,
  WEB_URL,
  answerCoverage,
  call,
  checkFolder,
  folderList,
  loadEnv,
  localAddresses,
  megabytes,
  museSettings,
  readAnswers,
  redactor,
  runValidator,
  seconds,
} from './demo-lib.mjs';

const execute = promisify(execFile);

/** How long each kind of request may take; the slowest check bounds the whole run. */
const LOCAL_MS = 3000;
const MODEL_MS = 20_000;
/** A model that answers a one-word call slower than this will make tours and answers drag. */
const SLOW_MS = 6000;

// ------------------------------------------------------------------------------------------------ probes

const CRC_TABLE = Int32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
const crc32 = (bytes) => {
  let c = -1;
  for (const byte of bytes) c = CRC_TABLE[(c ^ byte) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};
function pngChunk(type, data) {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 'latin1');
  data.copy(out, 8);
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
  return out;
}

/** The disc SAM is asked for: a red disc of radius 60 on white, in a square image, and the box drawn around it. */
export const DISC = { size: 256, centre: 128, radius: 60, box: { left: 56, top: 56, right: 200, bottom: 200 } };

/** A PNG of that disc: an object SAM 3.1 has no doubt about, made here so that no file has to be shipped. */
export function discPng({ size, centre, radius } = DISC) {
  const row = size * 3 + 1;
  const raw = Buffer.alloc(row * size, 255);
  for (let y = 0; y < size; y++) {
    raw[y * row] = 0;
    for (let x = 0; x < size; x++)
      if (Math.hypot(x - centre, y - centre) < radius) raw.set([200, 40, 40], y * row + 1 + x * 3);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/** A mono PCM16 WAV at 16 kHz, the format the reader records and Muse Voice Transcribe takes (shared/voice.ts). */
export function toneWav(lengthSeconds = 1, hz = 440, rate = 16000) {
  const count = Math.round(lengthSeconds * rate);
  const wav = Buffer.alloc(44 + count * 2);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(wav.length - 8, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(rate, 24);
  wav.writeUInt32LE(rate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(count * 2, 40);
  for (let i = 0; i < count; i++)
    wav.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * hz * i) / rate)), 44 + i * 2);
  return wav;
}

/** The output text of a Responses API reply (server/src/ai/sam.ts, outputText). */
export function outputText(payload) {
  for (const item of Array.isArray(payload?.output) ? payload.output : [])
    for (const part of Array.isArray(item?.content) ? item.content : [])
      if (typeof part?.text === 'string') return part.text;
  return undefined;
}

/** Meta's mask parser, which the server already depends on; null when it is not installed. */
export async function loadSamParser(root = ROOT) {
  try {
    const require = createRequire(join(root, 'server', 'package.json'));
    return await import(pathToFileURL(require.resolve('@meta-sam/parser')).href);
  } catch {
    return null;
  }
}

/** The mask a SAM reply carries: its confidence and how many pixels are on; null when the reply holds no mask. */
async function decodeMask(parser, text) {
  async function* events() {
    const lane = { item_id: 'sam', output_index: 0, content_index: 0 };
    yield { type: 'response.output_text.delta', delta: text, ...lane };
    yield { type: 'response.output_text.done', text, ...lane };
    yield { type: 'response.completed' };
  }
  const { records } = await parser.parseImageStream(events()).finalResult;
  const [mask] = parser.recordsOfKind(records, 'mask');
  if (!mask) return null;
  return {
    confidence: mask.confidence,
    pixels: parser.decodeMaskToRaster(mask.mask).reduce((total, on) => total + on, 0),
  };
}

// ------------------------------------------------------------------------------------------------ items

/** One line of the report. A should-have that fails is a warning; only a must-have makes the run fail. */
function item(name, level, status, detail, hint) {
  return { name, level, status, detail, ...(hint ? { hint } : {}) };
}
const fails = (name, level, detail, hint) => item(name, level, level === 'must' ? 'fail' : 'warn', detail, hint);

/** Why a model call did not work, from its response. */
function whyNot(res, keyHint) {
  if (res.error) return { detail: res.error, hint: 'check the network, then run again' };
  if (res.status === 401 || res.status === 403)
    return { detail: `the key was rejected (HTTP ${res.status})`, hint: keyHint };
  if (res.status === 429)
    return { detail: 'rate limited (HTTP 429)', hint: 'wait a minute and run again; a busy key makes tours slow' };
  if (res.status >= 500) return { detail: `Meta's API is failing (HTTP ${res.status})`, hint: 'run again in a minute' };
  return { detail: `HTTP ${res.status}` };
}

const KEY_HINT = 'set MODEL_API_KEY in the root .env (copy .env.example) and restart the API';
const PLACEHOLDER = /^(?:replace|your|change|xxx|<)/i;

function checkKey(settings, { envFile, offline }) {
  if (offline) return item('key', 'must', 'skip', 'not needed offline: saved answers play without a model');
  if (!settings.key)
    return fails(
      'key',
      'must',
      envFile
        ? 'no MODEL_API_KEY in .env or the environment'
        : 'no .env in the project root and no key in the environment',
      KEY_HINT,
    );
  if (PLACEHOLDER.test(settings.key))
    return fails('key', 'must', `${settings.keyName} is still a placeholder`, KEY_HINT);
  return item('key', 'must', 'pass', `${settings.keyName} is set (value not shown)`);
}

async function checkApi(url, fetchImpl) {
  const res = await call(fetchImpl, `${url}/health`, {}, LOCAL_MS);
  const start =
    'start it with npm run dev (the library needs Supabase: npm run supabase:start), or npm run demo:offline';
  if (res.error) return fails('api', 'must', `${url}: ${res.error}`, start);
  if (res.status !== 200 || res.json?.status !== 'ok')
    return fails('api', 'must', `${url}/health answered HTTP ${res.status}`, start);
  const mode =
    res.json.mode === 'saved-answers' ? ', OFFLINE MODE: only saved answers and (if forwarding) a live API' : '';
  return item('api', 'must', 'pass', `${url} answered in ${Math.round(res.ms)} ms${mode}`);
}

async function checkWeb(url, fetchImpl) {
  const res = await call(fetchImpl, `${url}/`, {}, LOCAL_MS);
  const start = 'start it with npm run dev, or npm run dev:demo for the reader alone';
  if (res.error) return fails('web', 'must', `${url}: ${res.error}`, start);
  if (res.status !== 200) return fails('web', 'must', `${url} answered HTTP ${res.status}`, start);
  return item('web', 'must', 'pass', `${url} answered in ${Math.round(res.ms)} ms`);
}

/** The ask route for demo papers, found by a request with an empty body: 400 means it is there, 404 that it is off. */
async function checkDemoRoute(api, folder, fetchImpl) {
  const url = `${api}/api/demo/${encodeURIComponent(folder)}/ask`;
  const res = await call(
    fetchImpl,
    url,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' },
    LOCAL_MS,
  );
  if (res.error) return fails('demo route', 'must', res.error, 'start the API first');
  if (res.status === 400)
    return item('demo route', 'must', 'pass', 'POST /api/demo/<folder>/ask is on (checked with an empty request)');
  if (res.status === 404)
    return fails(
      'demo route',
      'must',
      'POST /api/demo/<folder>/ask answered 404',
      'the route exists only in local development: NODE_ENV must not be production and HOST must be a loopback address',
    );
  return fails('demo route', 'must', `POST /api/demo/<folder>/ask answered HTTP ${res.status}`, 'restart the API');
}

async function checkSpark(settings, fetchImpl) {
  const send = (body) =>
    call(
      fetchImpl,
      `${settings.baseUrl}/chat/completions`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.key}` },
        body: JSON.stringify({
          model: settings.model,
          messages: [{ role: 'user', content: 'Reply with one word: ready' }],
          ...body,
        }),
      },
      MODEL_MS,
    );
  // A small reasoning effort keeps the one word from being spent on thinking; a model that refuses the field gets none.
  let res = await send({ max_tokens: 160, reasoning_effort: 'minimal' });
  if (res.status === 400) res = await send({ max_tokens: 600 });
  const name = 'Muse Spark';
  if (!res.ok) {
    const why = whyNot(res, KEY_HINT);
    return fails(name, 'must', `${settings.model}: ${why.detail}`, why.hint);
  }
  const word = res.json?.choices?.[0]?.message?.content;
  if (typeof word !== 'string' || !word.trim())
    return fails(
      name,
      'must',
      `${settings.model} answered without any text`,
      'run again; if it repeats, try another MUSE_MODEL',
    );
  const text = `${settings.model} answered "${word.trim().slice(0, 20)}" in ${seconds(res.ms)}`;
  return res.ms > SLOW_MS
    ? item(name, 'must', 'warn', `${text}, which is slow`, 'expect slow tours and answers; lean on the saved answers')
    : item(name, 'must', 'pass', text);
}

async function checkSam(settings, fetchImpl, parser) {
  const { size, box } = DISC;
  const prompt = parser
    ? parser.buildObjectPrompt({ size: { width: size, height: size }, objects: [{ id: 0, prompts: [{ box }] }] })
    : `<0f>0<|box;x1=${box.left};y1=${box.top};x2=${box.right - 1};y2=${box.bottom - 1};w=${size};h=${size}|>`;
  const res = await call(
    fetchImpl,
    `${settings.baseUrl}/responses`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.key}` },
      body: JSON.stringify({
        model: 'sam-3.1',
        input: [
          {
            type: 'message',
            role: 'user',
            content: [
              { type: 'input_text', text: prompt },
              { type: 'input_image', image_url: `data:image/png;base64,${discPng().toString('base64')}` },
            ],
          },
        ],
        stream: false,
        metadata: { include_confidence: 'true', mask_encoding: 'one_bit' },
      }),
    },
    MODEL_MS,
  );
  const name = 'SAM 3.1';
  const hint = "the reader keeps the learner's rectangle when a snap fails, so the demo still works without it";
  if (!res.ok) {
    const why = whyNot(res, KEY_HINT);
    return fails(name, 'should', why.detail, why.hint ?? hint);
  }
  const text = outputText(res.json);
  if (!text?.trim()) return fails(name, 'should', 'answered but found no object in a generated disc', hint);
  if (!parser)
    return item(
      name,
      'should',
      'pass',
      `answered in ${seconds(res.ms)} (the mask was not decoded: @meta-sam/parser is missing)`,
    );
  let mask;
  try {
    mask = await decodeMask(parser, text);
  } catch {
    return fails(name, 'should', 'answered with a reply that is not a readable mask', hint);
  }
  if (!mask) return fails(name, 'should', 'answered without a mask for a generated disc', hint);
  if (mask.confidence !== undefined && mask.confidence < 0.6)
    return fails(
      name,
      'should',
      `found the disc with confidence ${mask.confidence.toFixed(2)}, below the 0.6 the reader trusts`,
      hint,
    );
  const sure = mask.confidence === undefined ? '' : `, confidence ${mask.confidence.toFixed(2)}`;
  return item(name, 'should', 'pass', `outlined a generated disc (${mask.pixels} pixels${sure}) in ${seconds(res.ms)}`);
}

async function checkVoice(settings, fetchImpl) {
  const body = new FormData();
  body.append(
    'request',
    new Blob([JSON.stringify({ model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' })], {
      type: 'application/json',
    }),
  );
  body.append('audio', new Blob([toneWav()], { type: 'audio/wav' }), 'question.wav');
  const res = await call(
    fetchImpl,
    `${settings.baseUrl}/asr/transcribe`,
    {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${settings.key}`, Accept: 'application/json' },
      body,
    },
    MODEL_MS,
  );
  const name = 'Voice';
  const hint = 'typing a question always works; hold the mic button once before the demo to hear it for real';
  if (res.ok && typeof res.json?.transcript === 'string') {
    const heard = res.json.transcript.trim();
    return item(
      name,
      'should',
      'pass',
      `Muse Voice Transcribe accepted a generated 1 s tone in ${seconds(res.ms)}${heard ? ` and heard "${heard.slice(0, 30)}"` : ' (no words, as expected)'}`,
    );
  }
  if (res.ok) return fails(name, 'should', 'answered without a transcript field', hint);
  // The API refusing a generated tone says nothing about real speech, so that case is skipped with a note.
  if ([400, 415, 422].includes(res.status))
    return item(name, 'should', 'skip', `the API did not take a generated tone (HTTP ${res.status}); not tested`, hint);
  const why = whyNot(res, KEY_HINT);
  return fails(name, 'should', why.detail, why.hint ?? hint);
}

/** The local macOS voices by language (say -v ?), or null where there is no way to list them. */
export async function localVoices(platform = process.platform) {
  if (platform !== 'darwin') return null;
  try {
    const { stdout } = await execute('say', ['-v', '?'], { timeout: LOCAL_MS });
    const counts = {};
    for (const line of stdout.split('\n')) {
      const language = /\s([a-z]{2,3})[_-][A-Za-z0-9]+\s+#/.exec(line)?.[1];
      if (language) counts[language] = (counts[language] ?? 0) + 1;
    }
    return counts;
  } catch {
    return null;
  }
}

async function checkFolderItem(name, context) {
  const { demoDir, validate, web, webUp, fetchImpl, offline } = context;
  const check = await checkFolder(name, { demoDir, validate });
  const problems = [...check.problems];
  if (!problems.length && webUp) {
    const res = await call(fetchImpl, `${web}/${encodeURIComponent(name)}/tour.json`, {}, LOCAL_MS);
    if (res.status !== 200 || res.json?.title !== check.tour.title)
      problems.push(
        `the web app does not serve this tour (${res.error ?? `HTTP ${res.status}`}); it serves demo/ only in development, so use npm run dev`,
      );
  }
  const label = `demo ${name}`;
  if (problems.length) return { check, item: item(label, 'must', 'fail', problems.join('; ')) };
  const coverage = answerCoverage(readAnswers(check.dir), check.tour, check.facts.docSha);
  const facts = [
    `paper.pdf ${megabytes(check.facts.pdfBytes)}`,
    `${check.facts.steps} steps`,
    check.facts.validated ? 'tour validates' : 'validator not run',
    webUp ? 'served' : null,
    coverage.total ? `saved answers ${coverage.saved} of ${coverage.total}` : 'no suggested questions',
  ].filter(Boolean);
  if (coverage.saved < coverage.total) {
    const fix = `npm run demo:prepare -- ${name}`;
    return {
      check,
      item: offline
        ? item(label, 'must', 'fail', facts.join(', '), `offline needs every saved answer, so run ${fix}`)
        : item(
            label,
            'must',
            'warn',
            facts.join(', '),
            `run ${fix} so that a failed model call has saved answers to fall back on`,
          ),
    };
  }
  return {
    check,
    item: item(label, 'must', check.warnings.length ? 'warn' : 'pass', [...facts, ...check.warnings].join(', ')),
  };
}

function speechItem({ web, first, checks, voices }) {
  const lines = [
    "Narration is the browser's speech synthesis, which this script cannot hear (Meta's API has no text-to-speech).",
    `Open ${web}/?paper=${first} in the demo browser, click Start tour and listen.`,
    'Chrome prefers its Google voices, which need the network. Offline, pick a local voice under Audio settings,',
    'or press Mute for timed captions.',
  ];
  const needed = [...new Set(checks.map((c) => c.check.facts.language?.split('-')[0]).filter(Boolean))];
  if (!voices) return item('speech', 'should', 'note', lines);
  const missing = needed.filter((language) => !voices[language]);
  if (missing.length)
    return item(
      'speech',
      'should',
      'warn',
      [...lines, `This Mac lists no local voice for: ${missing.join(', ')}.`],
      'System Settings > Accessibility > Spoken Content > System Voice > Manage Voices',
    );
  return item('speech', 'should', 'note', [
    ...lines,
    `Local voices on this Mac: ${needed.map((language) => `${language} ${voices[language]}`).join(', ') || 'none needed'}.`,
  ]);
}

// ------------------------------------------------------------------------------------------------ the run

/**
 * Runs every check at once and returns `{ items, ok, ready, elapsedMs }`. `ok` is false when a must-have failed (or,
 * with `strict`, anything warned); `ready` when nothing failed or warned.
 */
export async function runPreflight(options) {
  const {
    env,
    envFile = true,
    folders = [],
    root = ROOT,
    demoDir = DEMO_DIR,
    offline = false,
    skipModels = false,
    strict = false,
    fetchImpl = fetch,
    validate,
    parser,
    platform = process.platform,
  } = options;
  const started = performance.now();
  const settings = museSettings(env);
  const local = localAddresses(env);
  const api = (options.api ?? local.api).replace(/\/+$/, '');
  const web = (options.web ?? WEB_URL).replace(/\/+$/, '');
  const run = validate ?? ((dir) => runValidator(dir, { python: local.python }));
  const keyItem = checkKey(settings, { envFile, offline });
  const keyOk = keyItem.status === 'pass';
  const models = !offline && !skipModels;
  const modelItem = async (name, level, probe) => {
    if (!models)
      return item(name, level, 'skip', offline ? 'offline: no model is called' : 'skipped on request (--skip-models)');
    if (!keyOk) return fails(name, level, 'not tried: there is no usable key', KEY_HINT);
    return probe();
  };
  const sam = parser === undefined ? await loadSamParser(root) : parser;
  // The API and the web app first: the demo route and the served tours depend on them, and everything else runs beside.
  const [apiItem, webItem] = await Promise.all([checkApi(api, fetchImpl), checkWeb(web, fetchImpl)]);
  const [route, spark, samItem, voice, voices, checked] = await Promise.all([
    apiItem.status === 'pass'
      ? checkDemoRoute(api, folders[0] ?? 'attention-short', fetchImpl)
      : item('demo route', 'must', 'fail', 'not tried: the API does not answer', 'start the API first'),
    modelItem('Muse Spark', 'must', () => checkSpark(settings, fetchImpl)),
    modelItem('SAM 3.1', 'should', () => checkSam(settings, fetchImpl, sam)),
    modelItem('Voice', 'should', () => checkVoice(settings, fetchImpl)),
    localVoices(platform),
    Promise.all(
      folders.map((name) =>
        checkFolderItem(name, { demoDir, validate: run, web, webUp: webItem.status === 'pass', fetchImpl, offline }),
      ),
    ),
  ]);
  const items = [
    keyItem,
    apiItem,
    webItem,
    route,
    spark,
    samItem,
    voice,
    ...checked.map((entry) => entry.item),
    speechItem({ web, first: folders[0] ?? 'attention-short', checks: checked, voices }),
  ];
  const failed = items.filter((entry) => entry.status === 'fail');
  const warned = items.filter((entry) => entry.status === 'warn');
  return {
    items,
    ok: !failed.length && !(strict && warned.length),
    ready: !failed.length && !warned.length,
    elapsedMs: performance.now() - started,
  };
}

// ------------------------------------------------------------------------------------------------ output

const LABELS = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', skip: 'SKIP', note: 'NOTE' };
const COLOURS = { pass: 32, warn: 33, fail: 31, skip: 2, note: 2 };

/** The report as text: a line per item, its fix underneath, and a verdict. */
export function render(result, { colour = false, secrets = [] } = {}) {
  const hide = redactor(...secrets);
  const paint = (status, text) => (colour ? `\u001b[${COLOURS[status]}m${text}\u001b[0m` : text);
  const width = Math.max(...result.items.map((entry) => entry.name.length));
  const lines = [];
  for (const entry of result.items) {
    const [first, ...rest] = [entry.detail].flat();
    lines.push(`${paint(entry.status, LABELS[entry.status])}  ${entry.name.padEnd(width)}  ${hide(first)}`);
    for (const more of rest) lines.push(`      ${' '.repeat(width)}  ${hide(more)}`);
    if (entry.hint && (entry.status === 'fail' || entry.status === 'warn'))
      lines.push(`      ${' '.repeat(width)}  -> ${hide(entry.hint)}`);
  }
  const count = (status) => result.items.filter((entry) => entry.status === status).length;
  const failed = result.items.filter((entry) => entry.status === 'fail').map((entry) => entry.name);
  const verdict = failed.length
    ? paint('fail', `NOT READY: ${failed.length} must-have check(s) failed: ${failed.join(', ')}.`)
    : count('warn')
      ? paint('warn', `READY with ${count('warn')} warning(s).`)
      : paint('pass', 'READY.');
  const skipped = count('skip') ? `, ${count('skip')} skipped` : '';
  return [...lines, '', `${verdict} ${count('pass')} passed${skipped}, in ${seconds(result.elapsedMs)}.`].join('\n');
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        api: { type: 'string' },
        web: { type: 'string' },
        offline: { type: 'boolean' },
        'skip-models': { type: 'boolean' },
        strict: { type: 'boolean' },
        json: { type: 'boolean' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    console.error(
      `${error.message}\nusage: npm run preflight -- [folder ...] [--offline] [--skip-models] [--strict] [--json]`,
    );
    process.exitCode = 2;
    return;
  }
  const { values, positionals } = parsed;
  if (values.help) {
    console.error(
      'usage: npm run preflight -- [folder ...] [--offline] [--skip-models] [--strict] [--json] [--api <url>] [--web <url>]',
    );
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
  const { found, env } = loadEnv();
  const result = await runPreflight({
    env,
    envFile: found,
    folders,
    api: values.api,
    web: values.web,
    offline: values.offline,
    skipModels: values['skip-models'],
    strict: values.strict,
  });
  const secrets = [museSettings(env).key];
  if (values.json) {
    const hide = redactor(...secrets);
    console.log(
      hide(
        JSON.stringify(
          { ok: result.ok, ready: result.ready, items: result.items, elapsedMs: Math.round(result.elapsedMs) },
          null,
          2,
        ),
      ),
    );
  } else console.log(render(result, { colour: process.stdout.isTTY && !process.env.NO_COLOR, secrets }));
  process.exitCode = result.ok ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
