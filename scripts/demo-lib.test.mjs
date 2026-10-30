import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEMO_SET,
  answerCoverage,
  answerProblems,
  call,
  checkFolder,
  docIds,
  failureReason,
  findAnswer,
  folderList,
  fold,
  loadEnv,
  localAddresses,
  museSettings,
  readAnswers,
  redactor,
  runValidator,
  writeAnswers,
  ANSWERS_SCHEMA,
} from './demo-lib.mjs';
import { SHA, answer, demoDir, doc, json, questions, tour, validOk } from './demo-fixtures.mjs';

// The helpers the three demo scripts share; run with: node --test scripts/demo-lib.test.mjs

test('the environment is the .env file under the process environment, and the key comes from either name', () => {
  const root = mkdtempSync(join(tmpdir(), 'env-'));
  try {
    assert.equal(loadEnv(root, {}).found, false);
    writeFileSync(
      join(root, '.env'),
      'MODEL_API_KEY=from-file-123456\nMUSE_BASE_URL="https://example.test/v1/"\nPORT=3009\n',
    );
    const { found, env } = loadEnv(root, { PORT: '3010', EMPTY: undefined });
    assert.equal(found, true);
    assert.equal(env.PORT, '3010', 'the process environment wins, as in server/src/config.ts');
    assert.equal(env.MODEL_API_KEY, 'from-file-123456');
    const settings = museSettings(env);
    assert.equal(settings.key, 'from-file-123456');
    assert.equal(settings.keyName, 'MODEL_API_KEY');
    assert.equal(settings.baseUrl, 'https://example.test/v1', 'no trailing slash');
    assert.equal(settings.model, 'muse-spark-1.3');
    assert.equal(museSettings({ MUSE_API_KEY: ' alt-key-123456 ' }).keyName, 'MUSE_API_KEY');
    assert.equal(museSettings({ MODEL_API_KEY: '  ' }).key, '');
    assert.equal(museSettings({}).baseUrl, 'https://api.meta.ai/v1');
  } finally {
    rmSync(root, { recursive: true });
  }
});

test('local addresses follow HOST and PORT, with the loopback address for a wildcard host', () => {
  assert.equal(localAddresses({}).api, 'http://127.0.0.1:3001');
  assert.equal(localAddresses({ HOST: '0.0.0.0', PORT: '3005' }).api, 'http://127.0.0.1:3005');
  assert.equal(localAddresses({ HOST: 'localhost' }).api, 'http://localhost:3001');
  assert.equal(localAddresses({ PYTHON_BIN: '/x/python' }).python, '/x/python');
});

test('the redactor hides the key and any bearer token, but not short words', () => {
  const hide = redactor('sk-live-abcdef123456', 'ab', undefined, '');
  assert.equal(hide('key sk-live-abcdef123456 was sent'), 'key [key] was sent');
  assert.equal(hide('Authorization: Bearer abc.def-ghi=='), 'Authorization: Bearer [key]');
  assert.equal(hide('abc'), 'abc', 'a two-letter "secret" would mangle ordinary text, so it is not hidden');
  assert.equal(hide(undefined), '');
});

test('folders come from names, comma lists and demo/ paths, default to the demo set and refuse odd names', () => {
  assert.deepEqual(folderList([]), DEMO_SET);
  assert.deepEqual(folderList(['eval-fish,eval-slides', 'demo/eval-fish/', './demo/attention-short']), [
    'eval-fish',
    'eval-slides',
    'attention-short',
  ]);
  assert.throws(() => folderList(['../secret']), /not a demo folder name/);
  assert.throws(() => folderList(['a/b']), /not a demo folder name/);
});

test('failures are described in words an operator can act on', () => {
  assert.match(
    failureReason(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } }), 3000),
    /refused/,
  );
  assert.match(
    failureReason(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }), 3000),
    /no network/,
  );
  assert.match(failureReason(new DOMException('timed out', 'TimeoutError'), 20_000), /no answer within 20 s/);
  assert.equal(failureReason(new Error('odd')), 'odd');
});

test('a request never throws: a refusal, a timeout and a bad body all come back as data', async () => {
  const refused = await call(
    async () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })),
    'http://x',
  );
  assert.equal(refused.status, 0);
  assert.match(refused.error, /refused/);
  const slow = await call(
    (url, init) => new Promise((_, reject) => {
      // Match a real socket's lifetime while the request waits for its timeout signal.
      const keepAlive = setInterval(() => {}, 60_000);
      const stop = () => {
        clearInterval(keepAlive);
        reject(init.signal.reason);
      };
      if (init.signal.aborted) stop();
      else init.signal.addEventListener('abort', stop, { once: true });
    }),
    'http://x',
    {},
    20,
  );
  assert.match(slow.error, /no answer within/);
  const text = await call(async () => new Response('<html>', { status: 502 }), 'http://x');
  assert.equal(text.status, 502);
  assert.equal(text.ok, false);
  assert.equal(text.json, undefined);
  assert.equal((await call(async () => json({ a: 1 }), 'http://x')).json.a, 1);
});

test('a good folder passes and reports what the demo needs to know', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    const check = await checkFolder('alpha', { demoDir: dir, validate: validOk });
    assert.deepEqual(check.problems, []);
    assert.equal(check.facts.steps, 2);
    assert.equal(check.facts.lastStepId, 'takeaway-1');
    assert.deepEqual(check.facts.questions, questions);
    assert.equal(check.facts.language, 'en-US');
    assert.equal(check.facts.validated, true);
    assert.equal(check.facts.docSha, SHA);
    assert.ok(check.facts.pdfBytes > 0);
  } finally {
    done();
  }
});

test('each missing or broken file is named with its fix', async () => {
  const { dir, done } = demoDir(['alpha', 'beta', 'gamma', 'delta']);
  try {
    // A PDF that is a dangling link, as in a folder whose paper was never downloaded.
    rmSync(join(dir, 'alpha', 'paper.pdf'));
    symlinkSync('../nowhere/paper.pdf', join(dir, 'alpha', 'paper.pdf'));
    let check = await checkFolder('alpha', { demoDir: dir, validate: validOk });
    assert.match(check.problems.join('\n'), /paper\.pdf is a broken link to \.\.\/nowhere\/paper\.pdf/);

    writeFileSync(join(dir, 'beta', 'paper.pdf'), 'hello');
    check = await checkFolder('beta', { demoDir: dir, validate: validOk });
    assert.match(check.problems.join('\n'), /not a PDF/);

    rmSync(join(dir, 'gamma', 'doc.json'));
    check = await checkFolder('gamma', { demoDir: dir, validate: validOk });
    assert.match(
      check.problems.join('\n'),
      /doc\.json is missing; run ingest\/\.venv\/bin\/python ingest\/ingest\.py demo\/gamma\/paper\.pdf/,
    );

    rmSync(join(dir, 'delta', 'tour.json'));
    check = await checkFolder('delta', { demoDir: dir, validate: validOk });
    assert.match(check.problems.join('\n'), /tour\.json is missing; npm run demo:prepare -- --regenerate delta/);
    assert.deepEqual((await checkFolder('delta', { demoDir: dir, validate: validOk, needTour: false })).problems, []);

    check = await checkFolder('nope', { demoDir: dir });
    assert.match(check.problems.join('\n'), /demo\/nope does not exist/);
  } finally {
    done();
  }
});

test('a tour for another PDF, a tour with no narration and invalid JSON are caught before the validator runs', async () => {
  const { dir, done } = demoDir(['alpha', 'beta', 'gamma']);
  try {
    writeFileSync(join(dir, 'alpha', 'tour.json'), JSON.stringify(tour('alpha', { doc_sha256: 'b'.repeat(64) })));
    let check = await checkFolder('alpha', {
      demoDir: dir,
      validate: async () => assert.fail('the validator should not run'),
    });
    assert.match(check.problems.join('\n'), /written for a different PDF/);

    const empty = tour('beta');
    empty.chapters[0].steps[0].say = '  ';
    writeFileSync(join(dir, 'beta', 'tour.json'), JSON.stringify(empty));
    check = await checkFolder('beta', { demoDir: dir, validate: validOk });
    assert.match(check.problems.join('\n'), /1 step\(s\) of tour\.json have no narration \(first: s1\)/);

    writeFileSync(join(dir, 'gamma', 'doc.json'), '{ not json');
    check = await checkFolder('gamma', { demoDir: dir, validate: validOk });
    assert.match(check.problems.join('\n'), /doc\.json is not valid JSON/);
  } finally {
    done();
  }
});

test('what validate.py finds is a problem, and a validator that cannot run is only a warning', async () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    const failing = async () => ({
      ran: true,
      ok: false,
      errors: ['tour.json $.chapters[0]: unknown step'],
      summary: 'validate: FAILED',
    });
    let check = await checkFolder('alpha', { demoDir: dir, validate: failing });
    assert.match(
      check.problems.join('\n'),
      /validate\.py found 1 error\(s\), first: tour\.json \$\.chapters\[0\]: unknown step/,
    );
    check = await checkFolder('alpha', {
      demoDir: dir,
      validate: async () => ({ ran: false, reason: 'Python not found at /x' }),
    });
    assert.deepEqual(check.problems, []);
    assert.match(check.warnings.join('\n'), /did not run \(Python not found at \/x\)/);
  } finally {
    done();
  }
});

test('the real validator reports a missing interpreter and a crash instead of throwing', async () => {
  const missing = await runValidator('/tmp', { python: '/no/such/python' });
  assert.deepEqual(missing, { ran: false, reason: 'Python not found at /no/such/python' });
  // Node reading validate.py as JavaScript fails with a syntax error and no report: a crash, not "errors found".
  const crashed = await runValidator('/tmp', { python: process.execPath });
  assert.equal(crashed.ran, false);
  assert.match(crashed.reason, /validate\.py did not finish/);
});

test('answers are playable only with a verdict, steps, narration and targets that exist', () => {
  const ids = docIds(doc);
  assert.deepEqual(answerProblems(answer(), ids), []);
  assert.deepEqual(answerProblems(answer('fig1.a'), ids), [], 'a panel is a target');
  assert.deepEqual(answerProblems(answer('ex1.a'), ids), [], 'so is an exercise part');
  assert.deepEqual(answerProblems(answer('page1'), ids), [], 'and a page');
  assert.match(answerProblems(answer('p9.s9'), ids)[0], /p9\.s9, which doc\.json does not have/);
  assert.match(answerProblems(answer('page2'), ids)[0], /page2/);
  assert.match(answerProblems(answer('p1.s1', { answerable: 'no' }), ids)[0], /cannot answer/);
  assert.match(answerProblems(answer('p1.s1', { answerable: undefined }), ids)[0], /no verdict/);
  assert.match(answerProblems(answer('p1.s1', { steps: [] }), ids)[0], /no steps/);
  assert.match(
    answerProblems({ answerable: 'yes', steps: [{ id: 'x', say: ' ', actions: [] }] }, ids)[0],
    /no id or narration/,
  );
  assert.match(answerProblems(null, ids)[0], /not an answer/);
  const several = answer();
  several.steps[0].actions = [
    { type: 'highlight', targets: ['p1.s1', 'p5.s5'] },
    { type: 'note', anchor: 'p6.s6', text: 't' },
    { type: 'clear' },
  ];
  assert.equal(answerProblems(several, ids).length, 2);
});

test('saved answers are found by question, language and the absence of a region, and nothing else', () => {
  const file = {
    schema: ANSWERS_SCHEMA,
    answers: [
      { question: 'Why divide by the square root?', answer: answer() },
      { question: 'Warum?', response_language: 'de', answer: answer('p1.s1', { language: 'de' }) },
    ],
  };
  const hit = (request) => findAnswer(file, request);
  assert.ok(hit({ question: 'why  DIVIDE by the square root?' }), 'case and spacing do not matter');
  assert.ok(
    hit({
      question: 'Why divide by the square root?',
      stepId: 'other',
      figureId: 'fig1',
      history: [{ question: 'a', answer: 'b' }],
    }),
  );
  assert.equal(
    hit({ question: 'Why divide by the square root?', selection: { page: 1, rect: [0, 0, 1, 1] } }),
    null,
    'a region is a different question',
  );
  assert.equal(
    hit({ question: 'Why divide by the square root?', responseLanguage: 'de' }),
    null,
    'never an answer in the wrong language',
  );
  assert.ok(hit({ question: 'Warum?', responseLanguage: 'de' }));
  assert.equal(hit({ question: 'Warum?' }), null);
  assert.equal(hit({ question: 'Something else' }), null);
  assert.equal(findAnswer(null, { question: 'x' }), null);
  assert.equal(fold('Ä  b'), fold('ä b'));
});

test('saved answers are written whole, read back, and counted against the tour', () => {
  const { dir, done } = demoDir(['alpha']);
  try {
    const folder = join(dir, 'alpha');
    assert.equal(readAnswers(folder), null);
    const file = {
      schema: ANSWERS_SCHEMA,
      paper: 'alpha',
      doc_sha256: SHA,
      answers: [{ question: questions[0], response_language: null, answer: answer() }],
    };
    writeAnswers(folder, file);
    assert.deepEqual(readAnswers(folder), file);
    assert.deepEqual(
      readdirSync(folder).filter((name) => name.includes('.tmp')),
      [],
      'no half-written file is left behind',
    );
    const t = tour('alpha');
    assert.deepEqual(answerCoverage(readAnswers(folder), t, SHA), { saved: 1, total: 2, missing: [questions[1]] });
    assert.equal(
      answerCoverage(readAnswers(folder), t, 'c'.repeat(64)).saved,
      0,
      'answers saved for another PDF do not count',
    );
    assert.equal(answerCoverage(null, t, SHA).saved, 0);
    writeFileSync(join(folder, 'answers.json'), 'not json');
    assert.equal(readAnswers(folder), null, 'a damaged file is no file');
    writeFileSync(join(folder, 'answers.json'), JSON.stringify({ schema: 'something else', answers: [] }));
    assert.equal(readAnswers(folder), null);
  } finally {
    done();
  }
});

test('the demo set is four valid folder names', () => {
  assert.equal(DEMO_SET.length, 4);
  assert.deepEqual(folderList(DEMO_SET), DEMO_SET);
});
