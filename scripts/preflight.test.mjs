import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, inflateSync } from 'node:zlib';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { DISC, discPng, loadSamParser, localVoices, outputText, render, runPreflight, toneWav } from './preflight.mjs';
import { ANSWERS_SCHEMA, writeAnswers } from './demo-lib.mjs';
import { SHA, answer, demoDir, json, questions, tour, validOk } from './demo-fixtures.mjs';

// The preflight against a fake API, web app and Meta; run with: node --test scripts/preflight.test.mjs

const execute = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('./preflight.mjs', import.meta.url));
const KEY = 'sk-test-SECRET-0123456789';
const API = 'http://api.test:3001';
const WEB = 'http://web.test:5174';
const META = 'https://meta.test/v1';

const refused = () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }));

/** A world where everything works; `handlers` replace parts of it. Every request is kept in `log`. */
function world(handlers = {}) {
  const log = [];
  const all = {
    health: () => json({ status: 'ok' }),
    web: () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }),
    served: (name) => json(tour(name)),
    route: () => json({ error: { code: 'invalid_request' } }, 400),
    spark: () => json({ choices: [{ message: { content: 'ready' }, finish_reason: 'stop' }] }),
    sam: () => json({ output: [{ content: [{ text: 'reply-with-a-mask' }] }] }),
    voice: () => json({ transcript: '', turns: [] }),
    ...handlers,
  };
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    log.push({ url: href, init });
    if (href === `${API}/health`) return all.health(init);
    if (href.startsWith(`${API}/api/demo/`)) return all.route(init);
    if (href === `${WEB}/`) return all.web(init);
    if (href.startsWith(`${WEB}/`)) return all.served(decodeURIComponent(href.split('/')[3]), init);
    if (href === `${META}/chat/completions`) return all.spark(init);
    if (href === `${META}/responses`) return all.sam(init);
    if (href === `${META}/asr/transcribe`) return all.voice(init);
    throw new Error(`unexpected request to ${href}`);
  };
  return { fetchImpl, log };
}

/** Meta's mask parser, replaced by one that reads any reply as a mask of three pixels at the given confidence. */
const fakeParser = (confidence = 0.91, found = true) => ({
  prompts: [],
  buildObjectPrompt(spec) {
    this.prompts.push(spec);
    return '<prompt>';
  },
  parseImageStream: (events) => ({
    finalResult: (async () => {
      for await (const event of events) void event;
      return { records: found ? [{ kind: 'mask', confidence, mask: {} }] : [] };
    })(),
  }),
  recordsOfKind: (records, kind) => records.filter((record) => record.kind === kind),
  decodeMaskToRaster: () => Uint8Array.from([1, 1, 1, 0]),
});

const options = (dir, extra = {}, handlers = {}) => {
  const { fetchImpl, log } = world(handlers);
  return {
    log,
    options: {
      env: { MODEL_API_KEY: KEY, MUSE_BASE_URL: META },
      folders: ['alpha'],
      api: API,
      web: WEB,
      demoDir: dir,
      validate: validOk,
      parser: fakeParser(),
      platform: 'linux',
      fetchImpl,
      ...extra,
    },
  };
};
const named = (result, name) => result.items.find((entry) => entry.name === name);
const everything = (result, secrets = [KEY]) => `${render(result, { secrets })}\n${JSON.stringify(result)}`;

test('with everything up and the answers saved, every item passes', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    writeAnswers(join(dir, 'alpha'), {
      schema: ANSWERS_SCHEMA,
      doc_sha256: SHA,
      answers: questions.map((question) => ({ question, response_language: null, answer: answer() })),
    });
    const { options: run, log } = options(dir);
    const result = await runPreflight(run);
    assert.equal(result.ok, true);
    assert.equal(result.ready, true);
    assert.deepEqual(
      result.items.map((entry) => [entry.name, entry.status]),
      [
        ['key', 'pass'],
        ['api', 'pass'],
        ['web', 'pass'],
        ['demo route', 'pass'],
        ['Muse Spark', 'pass'],
        ['SAM 3.1', 'pass'],
        ['Voice', 'pass'],
        ['demo alpha', 'pass'],
        ['speech', 'note'],
      ],
    );
    assert.match(named(result, 'Muse Spark').detail, /muse-spark-1\.3 answered "ready"/);
    assert.match(named(result, 'SAM 3.1').detail, /outlined a generated disc \(3 pixels, confidence 0\.91\)/);
    assert.match(named(result, 'Voice').detail, /accepted a generated 1 s tone/);
    assert.match(named(result, 'demo alpha').detail, /2 steps, tour validates, served, saved answers 2 of 2/);
    assert.match(render(result), /^PASS {2}key/m);
    assert.match(render(result), /READY\. 8 passed, in /);
    // The key goes to Meta and nowhere else.
    for (const { url, init } of log) {
      const sent = JSON.stringify(init.headers ?? {});
      assert.equal(
        sent.includes(KEY),
        url.startsWith(META),
        `${url} ${sent.includes(KEY) ? 'got' : 'did not get'} the key`,
      );
    }
    assert.equal(everything(result).includes(KEY), false);
  } finally {
    done();
  }
});

test('Spark gets a one-word call with a small reasoning effort, and a model that refuses the field gets none', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    const bodies = [];
    const { options: run } = options(
      dir,
      {},
      {
        spark: (init) => {
          bodies.push(JSON.parse(init.body));
          return bodies.length === 1
            ? json({ error: { message: 'unknown field reasoning_effort' } }, 400)
            : json({ choices: [{ message: { content: 'ready' } }] });
        },
      },
    );
    const result = await runPreflight(run);
    assert.equal(named(result, 'Muse Spark').status, 'pass');
    assert.equal(bodies.length, 2);
    assert.equal(bodies[0].reasoning_effort, 'minimal');
    assert.equal(bodies[0].model, 'muse-spark-1.3');
    assert.equal(bodies[0].messages.length, 1);
    assert.equal('reasoning_effort' in bodies[1], false);
    assert.ok(bodies[1].max_tokens > bodies[0].max_tokens);
  } finally {
    done();
  }
});

test('SAM is asked for the box around a generated disc, Voice for a 16 kHz tone', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    const parser = fakeParser();
    const seen = {};
    const { options: run } = options(
      dir,
      { parser },
      {
        sam: (init) => {
          seen.sam = JSON.parse(init.body);
          return json({ output: [{ content: [{ text: 'x' }] }] });
        },
        voice: (init) => {
          seen.voice = init.body;
          return json({ transcript: '' });
        },
      },
    );
    await runPreflight(run);
    assert.deepEqual(parser.prompts, [
      { size: { width: 256, height: 256 }, objects: [{ id: 0, prompts: [{ box: DISC.box }] }] },
    ]);
    const [message] = seen.sam.input;
    assert.equal(seen.sam.model, 'sam-3.1');
    assert.equal(message.content[0].text, '<prompt>');
    assert.match(message.content[1].image_url, /^data:image\/png;base64,/);
    assert.equal(seen.sam.metadata.mask_encoding, 'one_bit');
    assert.ok(seen.voice instanceof FormData);
    assert.equal(JSON.parse(await seen.voice.get('request').text()).model, 'muse-voice-transcribe-1.0');
    assert.equal(seen.voice.get('audio').size, 44 + 16000 * 2);
  } finally {
    done();
  }
});

test('the SAM prompt the real parser builds is the box format the notes document', async (t) => {
  const parser = await loadSamParser();
  if (!parser) return t.skip('@meta-sam/parser is not installed');
  const { size, box } = DISC;
  assert.equal(
    parser.buildObjectPrompt({ size: { width: size, height: size }, objects: [{ id: 0, prompts: [{ box }] }] }),
    '<0f>0<|box;x1=56;y1=56;x2=199;y2=199;w=256;h=256|>',
  );
});

test('with no key the model checks say why they were not tried, and the run fails on the key and Spark only', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    const { options: run, log } = options(dir, { env: {} });
    const result = await runPreflight(run);
    assert.equal(named(result, 'key').status, 'fail');
    assert.match(named(result, 'key').detail, /no MODEL_API_KEY/);
    assert.match(named(result, 'key').hint, /\.env/);
    assert.equal(named(result, 'Muse Spark').status, 'fail');
    assert.match(named(result, 'Muse Spark').detail, /not tried/);
    assert.equal(named(result, 'SAM 3.1').status, 'warn');
    assert.equal(named(result, 'Voice').status, 'warn');
    assert.equal(result.ok, false);
    assert.equal(log.filter((entry) => entry.url.startsWith(META)).length, 0, 'no call was made without a key');
    assert.match(render(result), /NOT READY: 2 must-have check\(s\) failed: key, Muse Spark\./);
    // A placeholder from .env.example is no key either.
    const placeholder = await runPreflight(options(dir, { env: { MODEL_API_KEY: 'replace-with-key' } }).options);
    assert.match(named(placeholder, 'key').detail, /still a placeholder/);
  } finally {
    done();
  }
});

test('an API that is down fails with the way to start it, and the route is not tried', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    const { options: run } = options(dir, {}, { health: refused });
    const result = await runPreflight(run);
    assert.equal(named(result, 'api').status, 'fail');
    assert.match(named(result, 'api').detail, /connection refused/);
    assert.match(named(result, 'api').hint, /npm run dev/);
    assert.match(named(result, 'demo route').detail, /not tried/);
    assert.equal(result.ok, false);
    const text = render(result);
    assert.match(text, /^FAIL {2}api/m);
    assert.match(text, /-> start it with npm run dev/);
  } finally {
    done();
  }
});

test('a web app that is down, or the demo route turned off, fails', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    let result = await runPreflight(options(dir, {}, { web: refused }).options);
    assert.equal(named(result, 'web').status, 'fail');
    assert.match(named(result, 'web').hint, /dev:demo/);
    assert.equal(
      named(result, 'demo alpha').detail.includes('served'),
      false,
      'nothing is said about being served when the web app is down',
    );
    result = await runPreflight(options(dir, {}, { route: () => json({ error: { code: 'not_found' } }, 404) }).options);
    assert.equal(named(result, 'demo route').status, 'fail');
    assert.match(named(result, 'demo route').hint, /local development/);
  } finally {
    done();
  }
});

test('a rejected key, a busy key and a failing Meta each say so, and never print the key', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    // The reply echoes the key, as a careless provider might; the report must not.
    const echo = (status) => () => json({ error: { message: `Invalid key ${KEY}` } }, status);
    let result = await runPreflight(options(dir, {}, { spark: echo(401) }).options);
    assert.match(named(result, 'Muse Spark').detail, /the key was rejected \(HTTP 401\)/);
    assert.equal(result.ok, false);
    result = await runPreflight(options(dir, {}, { spark: echo(429) }).options);
    assert.match(named(result, 'Muse Spark').detail, /rate limited/);
    result = await runPreflight(options(dir, {}, { spark: echo(503) }).options);
    assert.match(named(result, 'Muse Spark').detail, /Meta's API is failing \(HTTP 503\)/);
    assert.equal(everything(result).includes(KEY), false);
    result = await runPreflight(options(dir, {}, { spark: refused }).options);
    assert.match(named(result, 'Muse Spark').detail, /connection refused/);
    result = await runPreflight(
      options(dir, {}, { spark: () => json({ choices: [{ message: { content: null }, finish_reason: 'length' }] }) })
        .options,
    );
    assert.match(named(result, 'Muse Spark').detail, /without any text/);
  } finally {
    done();
  }
});

test('SAM and Voice are should-haves: they warn, the run still passes, and --strict turns the warning into a failure', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    const handlers = { sam: () => json({ output: [{ content: [{ text: '' }] }] }), voice: () => json({}, 503) };
    let result = await runPreflight(options(dir, {}, handlers).options);
    assert.equal(named(result, 'SAM 3.1').status, 'warn');
    assert.match(named(result, 'SAM 3.1').detail, /found no object/);
    assert.match(named(result, 'SAM 3.1').hint, /keeps the learner's rectangle/);
    assert.equal(named(result, 'Voice').status, 'warn');
    assert.equal(result.ok, true);
    assert.equal(result.ready, false);
    assert.match(render(result), /READY with \d warning\(s\)\./);
    result = await runPreflight(options(dir, { strict: true }, handlers).options);
    assert.equal(result.ok, false);

    result = await runPreflight(options(dir, { parser: fakeParser(0.4) }).options);
    assert.match(named(result, 'SAM 3.1').detail, /confidence 0\.40, below the 0\.6/);
    result = await runPreflight(options(dir, { parser: fakeParser(0.9, false) }).options);
    assert.match(named(result, 'SAM 3.1').detail, /without a mask/);
    result = await runPreflight(options(dir, { parser: null }).options);
    assert.match(named(result, 'SAM 3.1').detail, /parser is missing/);
  } finally {
    done();
  }
});

test('a voice API that refuses a generated tone is skipped with a note, not failed', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    const result = await runPreflight(options(dir, {}, { voice: () => json({ error: 'bad audio' }, 400) }).options);
    assert.equal(named(result, 'Voice').status, 'skip');
    assert.match(named(result, 'Voice').detail, /did not take a generated tone \(HTTP 400\); not tested/);
    assert.equal(result.ok, true);
    assert.match(render(result), /^SKIP {2}Voice/m);
    const heard = await runPreflight(options(dir, {}, { voice: () => json({ transcript: 'hello there' }) }).options);
    assert.match(named(heard, 'Voice').detail, /heard "hello there"/);
  } finally {
    done();
  }
});

test('--skip-models and --offline spend nothing', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    let { options: run, log } = options(dir, { skipModels: true });
    let result = await runPreflight(run);
    assert.deepEqual(
      ['Muse Spark', 'SAM 3.1', 'Voice'].map((name) => named(result, name).status),
      ['skip', 'skip', 'skip'],
    );
    assert.equal(log.filter((entry) => entry.url.startsWith(META)).length, 0);
    assert.equal(result.ok, true);

    // Offline: no key is needed, but a folder without all its saved answers cannot play.
    ({ options: run, log } = options(dir, { offline: true, env: {} }));
    result = await runPreflight(run);
    assert.equal(named(result, 'key').status, 'skip');
    assert.equal(named(result, 'demo alpha').status, 'fail');
    assert.match(
      named(result, 'demo alpha').hint,
      /offline needs every saved answer, so run npm run demo:prepare -- alpha/,
    );
    assert.equal(result.ok, false);
    writeAnswers(join(dir, 'alpha'), {
      schema: ANSWERS_SCHEMA,
      doc_sha256: SHA,
      answers: questions.map((question) => ({ question, answer: answer() })),
    });
    result = await runPreflight(options(dir, { offline: true, env: {} }).options);
    assert.equal(named(result, 'demo alpha').status, 'pass');
    assert.equal(result.ok, true);
  } finally {
    done();
  }
});

test('the saved-answers stand-in is reported as offline mode', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    const result = await runPreflight(
      options(dir, {}, { health: () => json({ status: 'ok', mode: 'saved-answers' }) }).options,
    );
    assert.equal(named(result, 'api').status, 'pass');
    assert.match(named(result, 'api').detail, /OFFLINE MODE/);
  } finally {
    done();
  }
});

test('a folder is checked on disk, by the validator and against what the web app serves', async () => {
  const { dir, done } = demoDir(['alpha', 'beta', 'gamma', 'delta']);
  try {
    rmSync(join(dir, 'beta', 'tour.json'));
    writeFileSync(join(dir, 'gamma', 'paper.pdf'), 'not a pdf');
    const failing = async (folder) =>
      folder.endsWith('delta')
        ? { ran: true, ok: false, errors: ['tour.json $.x: bad'], summary: 'validate: FAILED' }
        : validOk();
    const { options: run } = options(
      dir,
      { folders: ['alpha', 'beta', 'gamma', 'delta'], validate: failing },
      {
        served: (name) => json({ ...tour(name), title: name === 'alpha' ? 'A stale copy' : tour(name).title }),
      },
    );
    const result = await runPreflight(run);
    assert.match(named(result, 'demo alpha').detail, /the web app does not serve this tour/);
    assert.match(named(result, 'demo beta').detail, /tour\.json is missing/);
    assert.match(named(result, 'demo gamma').detail, /not a PDF/);
    assert.match(named(result, 'demo delta').detail, /validate\.py found 1 error\(s\), first: tour\.json \$\.x: bad/);
    assert.deepEqual(
      ['alpha', 'beta', 'gamma', 'delta'].map((name) => named(result, `demo ${name}`).status),
      ['fail', 'fail', 'fail', 'fail'],
    );
    assert.equal(result.ok, false);
    assert.match(
      render(result),
      /NOT READY: 4 must-have check\(s\) failed: demo alpha, demo beta, demo gamma, demo delta\./,
    );
  } finally {
    done();
  }
});

test('a folder with no saved answers is a warning with the command that fixes it', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    const result = await runPreflight(options(dir).options);
    const folder = named(result, 'demo alpha');
    assert.equal(folder.status, 'warn');
    assert.match(folder.detail, /saved answers 0 of 2/);
    assert.match(folder.hint, /npm run demo:prepare -- alpha/);
    assert.equal(result.ok, true);
  } finally {
    done();
  }
});

test('the speech note is always there, and on a Mac it counts the local voices the tours need', async (t) => {
  const { dir, done } = demoDir(['alpha']);
  try {
    const result = await runPreflight(options(dir).options);
    const note = named(result, 'speech');
    assert.equal(note.status, 'note');
    assert.match(note.detail.join('\n'), /browser's speech synthesis/);
    assert.match(note.detail.join('\n'), /http:\/\/web\.test:5174\/\?paper=alpha/);
    assert.match(note.detail.join('\n'), /press Mute for timed captions/);
    if (process.platform !== 'darwin') return t.skip('local voices are only listed on macOS');
    const voices = await localVoices('darwin');
    assert.ok(voices.en > 0);
    assert.equal(await localVoices('linux'), null);
  } finally {
    done();
  }
});

test('the report hides the key wherever it would appear, and paints only when asked to', () => {
  const result = {
    elapsedMs: 1200,
    items: [
      { name: 'key', level: 'must', status: 'fail', detail: `rejected ${KEY}`, hint: `Bearer ${KEY} is wrong` },
      { name: 'note', level: 'should', status: 'note', detail: ['first line', 'second line'] },
    ],
  };
  const plain = render(result, { secrets: [KEY] });
  assert.equal(plain.includes(KEY), false);
  assert.equal(plain.includes('\u001b'), false);
  assert.match(plain, /rejected \[key\]/);
  assert.match(plain, /-> Bearer \[key\] is wrong/);
  assert.match(plain, /second line/);
  assert.match(render(result, { colour: true, secrets: [KEY] }), /\u001b\[31mFAIL\u001b\[0m/);
});

test('the generated PNG is a valid 256 pixel image of a red disc on white', () => {
  const png = discPng();
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = {};
  for (let at = 8; at < png.length; ) {
    const length = png.readUInt32BE(at);
    const type = png.toString('latin1', at + 4, at + 8);
    const data = png.subarray(at + 8, at + 8 + length);
    assert.equal(
      png.readUInt32BE(at + 8 + length),
      crc32(png.subarray(at + 4, at + 8 + length)),
      `${type} has a valid checksum`,
    );
    chunks[type] = data;
    at += 12 + length;
  }
  assert.equal(chunks.IHDR.readUInt32BE(0), 256);
  assert.equal(chunks.IHDR.readUInt32BE(4), 256);
  assert.deepEqual([...chunks.IHDR.subarray(8, 10)], [8, 2], 'eight bits, RGB');
  const raw = inflateSync(chunks.IDAT);
  const row = 256 * 3 + 1;
  assert.equal(raw.length, row * 256);
  const pixel = (x, y) => [...raw.subarray(y * row + 1 + x * 3, y * row + 4 + x * 3)];
  assert.deepEqual(pixel(128, 128), [200, 40, 40]);
  assert.deepEqual(pixel(5, 5), [255, 255, 255]);
  assert.deepEqual(pixel(60, 128), [255, 255, 255], 'just outside the disc');
  assert.ok(
    DISC.box.left < DISC.centre - DISC.radius && DISC.box.right > DISC.centre + DISC.radius,
    'the box encloses the disc',
  );
});

test('the generated WAV is what the reader records: mono PCM16 at 16 kHz, with sound in it', () => {
  const wav = toneWav();
  assert.equal(wav.toString('latin1', 0, 4), 'RIFF');
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
  assert.equal(wav.toString('latin1', 8, 16), 'WAVEfmt ');
  assert.equal(wav.readUInt16LE(20), 1, 'PCM');
  assert.equal(wav.readUInt16LE(22), 1, 'mono');
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), wav.length - 44);
  assert.equal(wav.length, 44 + 32000);
  let peak = 0;
  for (let at = 44; at < wav.length; at += 2) peak = Math.max(peak, Math.abs(wav.readInt16LE(at)));
  assert.ok(peak > 7000 && peak < 8001);
});

test('the output text of a Responses API reply is the first text part', () => {
  assert.equal(outputText({ output: [{ content: [{ type: 'x' }, { text: 'abc' }] }] }), 'abc');
  assert.equal(outputText({ output: [] }), undefined);
  assert.equal(outputText(null), undefined);
});

test('the command line explains itself and refuses a folder name that is a path', async () => {
  const help = await execute(process.execPath, [SCRIPT, '--help']);
  assert.match(help.stderr, /usage: npm run preflight/);
  await assert.rejects(execute(process.execPath, [SCRIPT, '../etc']), (error) => {
    assert.equal(error.code, 2);
    assert.match(error.stderr, /not a demo folder name/);
    return true;
  });
});
