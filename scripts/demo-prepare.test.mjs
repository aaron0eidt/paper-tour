import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { failureSummary, prepare, summary } from './demo-prepare.mjs';
import { findAnswer, readAnswers } from './demo-lib.mjs';
import { answer, demoDir, json, questions, tour, validOk } from './demo-fixtures.mjs';

// demo:prepare against a fake API in temporary folders; run with: node --test scripts/demo-prepare.test.mjs

const execute = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('./demo-prepare.mjs', import.meta.url));
const API = 'http://api.test:3001';

/** A fake API: `ask(call, n)` answers the nth question asked, and every question asked is kept in `calls`. */
function fakeApi(handler) {
  const calls = [];
  let healthChecks = 0;
  const fetchImpl = async (url, init = {}) => {
    const href = String(url);
    if (href === `${API}/health`) {
      healthChecks++;
      return handler.health ? handler.health() : json({ status: 'ok' });
    }
    const [, paper] = /\/api\/demo\/([^/]+)\/ask$/.exec(href);
    const body = { paper, ...JSON.parse(init.body) };
    calls.push(body);
    return (handler.ask ?? (() => json(answer())))(body, calls.length);
  };
  return { fetchImpl, calls, healthChecks: () => healthChecks };
}

const run = (fixture, api, extra = {}) => {
  const lines = [];
  return {
    lines,
    go: () =>
      prepare({
        folders: ['alpha'],
        api: API,
        demoDir: fixture.dir,
        scratch: fixture.scratch,
        validate: validOk,
        sleep: async () => {},
        now: () => new Date('2026-10-29T22:45:00Z'),
        log: (line) => lines.push(line),
        fetchImpl: api.fetchImpl,
        ...extra,
      }),
  };
};

test('each suggested question is asked as the reader asks it on the last step, and the answers are saved', async () => {
  const fixture = demoDir(['alpha']);
  try {
    const api = fakeApi({});
    const { go, lines } = run(fixture, api);
    const result = await go();
    assert.equal(result.ok, true);
    assert.deepEqual(
      api.calls.map((call) => [call.paper, call.question, call.stepId]).sort(),
      questions.map((question) => ['alpha', question, 'takeaway-1']).sort(),
    );
    assert.deepEqual(Object.keys(api.calls[0]).sort(), ['paper', 'question', 'stepId'], 'nothing else is sent');
    const file = readAnswers(join(fixture.dir, 'alpha'));
    assert.equal(file.paper, 'alpha');
    assert.equal(file.title, 'Tour of alpha');
    assert.equal(file.saved_at, '2026-10-29T22:45:00.000Z');
    assert.deepEqual(
      file.answers.map((entry) => entry.question),
      questions,
      'in the order the tour suggests them',
    );
    assert.deepEqual(file.answers[0].answer, answer());
    assert.equal(file.answers[0].step_id, 'takeaway-1');
    assert.equal(file.answers[0].response_language, null);
    assert.ok(findAnswer(file, { question: questions[1].toUpperCase() }));
    assert.deepEqual(
      result.results[0].questions.map((q) => q.status),
      ['saved', 'saved'],
    );
    assert.match(lines.join('\n'), /wrote {3}demo\/alpha\/answers\.json with 2 of 2 answers/);
    assert.match(summary(result), /DONE: 1 folder\(s\), answers 2 saved now, 0 kept, 0 failed\./);
    assert.match(summary(result), /npm run demo:offline/);
  } finally {
    fixture.done();
  }
});

test('answers already saved are kept and cost nothing; --force asks again', async () => {
  const fixture = demoDir(['alpha']);
  try {
    const first = fakeApi({});
    await run(fixture, first).go();
    const second = fakeApi({});
    const again = run(fixture, second);
    const result = await again.go();
    assert.equal(second.calls.length, 0, 'no model call for answers that are already saved');
    assert.equal(second.healthChecks(), 0, 'and the API is not even looked at');
    assert.deepEqual(
      result.results[0].questions.map((q) => q.status),
      ['kept', 'kept'],
    );
    assert.match(summary(result), /0 saved now, 2 kept/);
    assert.equal(readAnswers(join(fixture.dir, 'alpha')).answers.length, 2);

    const forced = fakeApi({});
    await run(fixture, forced, { force: true }).go();
    assert.equal(forced.calls.length, 2);

    // Only the question that is missing is asked.
    const file = readAnswers(join(fixture.dir, 'alpha'));
    file.answers.pop();
    writeFileSync(join(fixture.dir, 'alpha', 'answers.json'), JSON.stringify(file));
    const partial = fakeApi({});
    await run(fixture, partial).go();
    assert.deepEqual(
      partial.calls.map((call) => call.question),
      [questions[1]],
    );
  } finally {
    fixture.done();
  }
});

test('answers saved for another PDF are not trusted', async () => {
  const fixture = demoDir(['alpha']);
  try {
    await run(fixture, fakeApi({})).go();
    const file = readAnswers(join(fixture.dir, 'alpha'));
    writeFileSync(join(fixture.dir, 'alpha', 'answers.json'), JSON.stringify({ ...file, doc_sha256: 'f'.repeat(64) }));
    const api = fakeApi({});
    await run(fixture, api).go();
    assert.equal(api.calls.length, 2);
  } finally {
    fixture.done();
  }
});

test('an answer that says the document cannot answer, or points at nothing, is not saved and fails the run', async () => {
  const fixture = demoDir(['alpha']);
  try {
    const api = fakeApi({
      ask: (call) =>
        call.question === questions[0] ? json(answer('p1.s1', { answerable: 'no' })) : json(answer('p9.s9')),
    });
    const { go, lines } = run(fixture, api);
    const result = await go();
    assert.equal(result.ok, false);
    assert.equal(readAnswers(join(fixture.dir, 'alpha')), null, 'nothing is written when nothing is good');
    const why = result.results[0].questions.map((q) => q.why);
    assert.match(why[0], /cannot answer/);
    assert.match(why[1], /p9\.s9, which doc\.json does not have/);
    assert.match(lines.join('\n'), /FAILED {2}Why one\?: the document says it cannot answer/);
    assert.match(summary(result), /NOT DONE: 1 folder\(s\), answers 0 saved now, 0 kept, 2 failed\./);
  } finally {
    fixture.done();
  }
});

test('one failed question does not lose the others, and the next run asks only for it', async () => {
  const fixture = demoDir(['alpha']);
  try {
    const flaky = fakeApi({
      ask: (call) =>
        call.question === questions[1]
          ? json({ error: { message: 'Questions are not available.' } }, 400)
          : json(answer()),
    });
    const result = await run(fixture, flaky).go();
    assert.equal(result.ok, false);
    assert.equal(flaky.calls.length, 2, 'a request the server calls invalid is not retried');
    assert.match(result.results[0].questions[1].why, /Questions are not available\./);
    assert.deepEqual(
      readAnswers(join(fixture.dir, 'alpha')).answers.map((entry) => entry.question),
      [questions[0]],
    );
    const retry = fakeApi({});
    const fixed = await run(fixture, retry).go();
    assert.equal(fixed.ok, true);
    assert.deepEqual(
      retry.calls.map((call) => call.question),
      [questions[1]],
    );
    assert.equal(readAnswers(join(fixture.dir, 'alpha')).answers.length, 2);
  } finally {
    fixture.done();
  }
});

test('a busy or failing model is asked again after a pause, a question that timed out is not', async () => {
  const fixture = demoDir(['alpha']);
  try {
    const pauses = [];
    const busy = fakeApi({
      ask: (call, n) =>
        call.question === questions[0] && n <= 2
          ? json({ error: { message: 'busy' } }, n === 1 ? 429 : 503)
          : json(answer()),
    });
    const result = await run(fixture, busy, { sleep: async (ms) => void pauses.push(ms), parallel: 1 }).go();
    assert.equal(result.ok, true);
    assert.deepEqual(pauses, [4000, 8000]);
    assert.equal(busy.calls.filter((call) => call.question === questions[0]).length, 3);

    const timedOut = demoDir(['alpha']);
    try {
      let asked = 0;
      const api = fakeApi({
        ask: () => {
          asked++;
          return Promise.reject(new DOMException('timed out', 'TimeoutError'));
        },
      });
      const stuck = await run(timedOut, api, { askMs: 5, parallel: 1 }).go();
      assert.equal(stuck.ok, false);
      assert.equal(asked, 2, 'one try per question');
      assert.match(stuck.results[0].questions[0].why, /no answer within/);
    } finally {
      timedOut.done();
    }
  } finally {
    fixture.done();
  }
});

test('with the API down nothing is asked, and the run says how to start it', async () => {
  const fixture = demoDir(['alpha']);
  try {
    const api = fakeApi({
      health: () => Promise.reject(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } })),
    });
    const { go, lines } = run(fixture, api);
    const result = await go();
    assert.equal(result.ok, false);
    assert.equal(api.calls.length, 0);
    assert.match(
      result.results[0].problems[0],
      /the API at http:\/\/api\.test:3001 does not answer \(connection refused.*start it with npm run dev/,
    );
    assert.match(lines.join('\n'), /FAIL {4}the API at/);
    assert.deepEqual(
      result.results[0].questions.map((q) => q.status),
      ['failed', 'failed'],
    );
    assert.equal(readAnswers(join(fixture.dir, 'alpha')), null);
  } finally {
    fixture.done();
  }
});

test('the saved-answers stand-in is not mistaken for the live API', async () => {
  const fixture = demoDir(['alpha']);
  try {
    const api = fakeApi({ health: () => json({ status: 'ok', mode: 'saved-answers' }) });
    const result = await run(fixture, api).go();
    assert.equal(result.ok, false);
    assert.equal(api.calls.length, 0);
    assert.match(result.results[0].problems[0], /is the saved-answers stand-in; stop it and start the live API/);
  } finally {
    fixture.done();
  }
});

test('a folder that fails its checks is reported and not asked about; the others go on', async () => {
  const fixture = demoDir(['alpha', 'beta']);
  try {
    writeFileSync(
      join(fixture.dir, 'alpha', 'tour.json'),
      JSON.stringify(tour('alpha', { doc_sha256: 'b'.repeat(64) })),
    );
    const api = fakeApi({});
    const result = await run(fixture, api, { folders: ['alpha', 'beta', 'missing'] }).go();
    assert.equal(result.ok, false);
    assert.deepEqual(
      result.results.map((r) => [r.name, r.ok]),
      [
        ['alpha', false],
        ['beta', true],
        ['missing', false],
      ],
    );
    assert.ok(api.calls.every((call) => call.paper === 'beta'));
    assert.match(result.results[0].problems[0], /different PDF/);
    assert.match(result.results[2].problems[0], /demo\/missing does not exist/);
    assert.match(summary(result), /Folders that failed their checks: alpha, missing\./);
  } finally {
    fixture.done();
  }
});

test('--no-ask only checks, and a tour with no suggested questions has nothing to prepare', async () => {
  const fixture = demoDir(['alpha', 'beta']);
  try {
    writeFileSync(join(fixture.dir, 'beta', 'tour.json'), JSON.stringify(tour('beta', { suggested_questions: [] })));
    const none = fakeApi({});
    const checked = await run(fixture, none, { ask: false, folders: ['alpha', 'beta'] }).go();
    assert.equal(checked.ok, true);
    assert.equal(none.calls.length, 0);
    assert.equal(none.healthChecks(), 0);
    assert.match(summary(checked, { ask: false }), /answers not asked for/);
    const quiet = run(fixture, none, { folders: ['beta'] });
    await quiet.go();
    assert.match(quiet.lines.join('\n'), /suggests no questions/);
    assert.equal(existsSync(join(fixture.dir, 'beta', 'answers.json')), false);
  } finally {
    fixture.done();
  }
});

test('--regenerate swaps in a new tour only after it validates, and keeps the old one', async () => {
  const fixture = demoDir(['alpha']);
  try {
    const seen = [];
    const generate = async ({ name, preset, language, folder, out }) => {
      seen.push({ name, preset, language, folder, out });
      writeFileSync(
        join(out, 'tour.json'),
        JSON.stringify(tour(name, { title: 'A new tour', suggested_questions: ['A new question?'] })),
      );
      return 'research_paper: done in 1.0 s, 2 steps';
    };
    const api = fakeApi({});
    const { go, lines } = run(fixture, api, { regenerate: true, generate, preset: 'quick', language: 'de-DE' });
    const result = await go();
    assert.equal(result.ok, true);
    assert.equal(result.results[0].regenerated, true);
    assert.equal(seen.length, 1);
    assert.deepEqual(
      [seen[0].name, seen[0].preset, seen[0].language, seen[0].folder],
      ['alpha', 'quick', 'de-DE', realpathSync(join(fixture.dir, 'alpha'))],
    );
    assert.equal(JSON.parse(readFileSync(join(fixture.dir, 'alpha', 'tour.json'), 'utf8')).title, 'A new tour');
    const previous = readdirSync(join(fixture.scratch, 'alpha', 'previous'));
    assert.deepEqual(previous, ['tour-20261029T2245.json']);
    assert.equal(
      JSON.parse(readFileSync(join(fixture.scratch, 'alpha', 'previous', previous[0]), 'utf8')).title,
      'Tour of alpha',
    );
    assert.deepEqual(
      api.calls.map((call) => call.question),
      ['A new question?'],
      'the new tour has its own questions',
    );
    assert.match(lines.join('\n'), /new tour in place; the old one is .*previous.tour-20261029T2245\.json/);
  } finally {
    fixture.done();
  }
});

test('a regenerated tour that does not validate, or no tour at all, leaves the old tour alone', async () => {
  const fixture = demoDir(['alpha']);
  try {
    const before = readFileSync(join(fixture.dir, 'alpha', 'tour.json'), 'utf8');
    const wrongPdf = async ({ name, out }) =>
      writeFileSync(join(out, 'tour.json'), JSON.stringify(tour(name, { doc_sha256: 'b'.repeat(64) })));
    let result = await run(fixture, fakeApi({}), { regenerate: true, generate: wrongPdf }).go();
    assert.equal(result.ok, false);
    assert.match(result.results[0].problems[0], /the new tour is not used: tour\.json was written for a different PDF/);
    assert.equal(readFileSync(join(fixture.dir, 'alpha', 'tour.json'), 'utf8'), before);

    result = await run(fixture, fakeApi({}), { regenerate: true, generate: async () => 'nothing written' }).go();
    assert.match(result.results[0].problems[0], /finished without writing a tour\.json/);

    const key = 'sk-test-SECRET-0123456789';
    const lines = [];
    result = await prepare({
      folders: ['alpha'],
      api: API,
      demoDir: fixture.dir,
      scratch: fixture.scratch,
      validate: validOk,
      regenerate: true,
      generate: async () => {
        throw new Error(`run-tour.ts failed: 401 for Bearer ${key}`);
      },
      redact: (text) => text.replace(key, '[key]'),
      log: (line) => lines.push(line),
      fetchImpl: fakeApi({}).fetchImpl,
    });
    assert.equal(result.ok, false);
    assert.equal(lines.join('\n').includes(key), false);
    assert.match(result.results[0].problems[0], /run-tour\.ts failed: 401/);
    assert.equal(readFileSync(join(fixture.dir, 'alpha', 'tour.json'), 'utf8'), before);
  } finally {
    fixture.done();
  }
});

test('a folder can be regenerated before it has any tour', async () => {
  const fixture = demoDir(['alpha']);
  try {
    const generate = async ({ name, out }) => writeFileSync(join(out, 'tour.json'), JSON.stringify(tour(name)));
    rmSync(join(fixture.dir, 'alpha', 'tour.json'));
    const { go, lines } = run(fixture, fakeApi({}), { regenerate: true, generate, ask: false });
    const result = await go();
    assert.equal(result.ok, true);
    assert.equal(existsSync(join(fixture.dir, 'alpha', 'tour.json')), true);
    assert.ok(lines.includes('  new tour in place'), 'and nothing is said about an old tour');
    assert.equal(existsSync(join(fixture.scratch, 'alpha', 'previous')), false, 'there was nothing to keep');
  } finally {
    fixture.done();
  }
});

test('a folder made of links is generated from the folder the links point to, under its own name', async () => {
  const fixture = demoDir(['alpha']);
  try {
    // As demo/attention-short is: the PDF and doc.json are links to another folder, and tour.json is its own.
    const linked = join(fixture.dir, 'linked');
    mkdirSync(linked);
    for (const file of ['paper.pdf', 'doc.json']) symlinkSync(join('..', 'alpha', file), join(linked, file));
    writeFileSync(join(linked, 'tour.json'), JSON.stringify(tour('linked')));
    const seen = [];
    const generate = async ({ name, folder, out }) => {
      seen.push(folder);
      writeFileSync(join(out, 'tour.json'), JSON.stringify(tour(name, { title: 'Regenerated' })));
    };
    const result = await run(fixture, fakeApi({}), {
      folders: ['linked'],
      regenerate: true,
      generate,
      ask: false,
    }).go();
    assert.equal(result.ok, true, result.results[0].problems.join('; '));
    assert.deepEqual(
      seen,
      [realpathSync(join(fixture.dir, 'alpha'))],
      'the generator is given the real folder, not links',
    );
    assert.equal(JSON.parse(readFileSync(join(linked, 'tour.json'), 'utf8')).paper, 'linked');
    assert.equal(JSON.parse(readFileSync(join(linked, 'tour.json'), 'utf8')).title, 'Regenerated');
  } finally {
    fixture.done();
  }
});

test('a failed generator run is explained by the line that says why, not by the end of a stack trace', () => {
  const python = '{"code": "invalid_asset_path", "message": "Input and output roots must not be symbolic links."}';
  const stack = [
    'node:internal/errors:998',
    '  const err = new Error(message);',
    '              ^',
    '',
    `Error: Command failed: python x`,
    python,
    '    at genericNodeError (node:internal/errors:998:15)',
    '',
    'Node.js v25.8.1',
  ];
  assert.match(failureSummary(stack.join('\n'), 'fallback'), /^Error: Command failed: python x/);
  assert.match(
    failureSummary([python, 'node:internal/errors:998', 'Node.js v25.8.1'].join('\n'), 'fallback'),
    /symbolic links/,
  );
  assert.equal(failureSummary('\n  \n', 'fallback'), 'fallback');
  assert.equal(failureSummary(undefined, 'fallback'), 'fallback');
  assert.equal(failureSummary('first line\nsecond', 'x'), 'first line');
  assert.equal(failureSummary(`Error: ${'x'.repeat(500)}`, 'x').length, 300);
});

test('the command line explains itself and refuses bad options', async () => {
  const help = await execute(process.execPath, [SCRIPT, '--help']);
  assert.match(help.stderr, /usage: npm run demo:prepare/);
  await assert.rejects(execute(process.execPath, [SCRIPT, '--preset', 'huge']), (error) => {
    assert.equal(error.code, 2);
    assert.match(error.stderr, /--preset is one of quick, standard, deep/);
    return true;
  });
  await assert.rejects(execute(process.execPath, [SCRIPT, '--parallel', '5']), (error) => error.code === 2);
  await assert.rejects(
    execute(process.execPath, [SCRIPT, 'a/b']),
    (error) => error.code === 2 && /not a demo folder name/.test(error.stderr),
  );
  // Writing a tour spends money, so it needs a key; the environment overrides the .env file, even with an empty value.
  await assert.rejects(
    execute(process.execPath, [SCRIPT, '--regenerate', 'attention-short'], {
      env: { ...process.env, MODEL_API_KEY: '', MUSE_API_KEY: '' },
    }),
    (error) => error.code === 2 && /needs MODEL_API_KEY/.test(error.stderr),
  );
});
