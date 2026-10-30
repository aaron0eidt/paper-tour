import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { request as httpRequest, createServer } from 'node:http';
import { createServer as createSocketServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { createOfflineServer, savedFolders } from './demo-offline.mjs';
import { ANSWERS_SCHEMA, writeAnswers } from './demo-lib.mjs';
import { SHA, answer, demoDir, questions } from './demo-fixtures.mjs';

// The saved-answers server, over real HTTP on a free port; run with: node --test scripts/demo-offline.test.mjs

const execute = promisify(execFile);
const SCRIPT = fileURLToPath(new URL('./demo-offline.mjs', import.meta.url));

const listen = (server) =>
  new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
const close = (server) => new Promise((resolve) => server.close(resolve));
const post = (url, body, headers = { 'Content-Type': 'application/json' }) =>
  fetch(url, {
    method: 'POST',
    headers,
    body: typeof body === 'string' || body instanceof Uint8Array ? body : JSON.stringify(body),
  });

function save(dir, name = 'alpha', language = null) {
  writeAnswers(join(dir, name), {
    schema: ANSWERS_SCHEMA,
    paper: name,
    doc_sha256: SHA,
    answers: questions.map((question) => ({
      question,
      response_language: language,
      answer: answer('p1.s1', { steps: [{ id: 'ask-1', say: `Saved: ${question}`, actions: [] }] }),
    })),
  });
}

/** Starts the server on a free port over a fresh demo directory; `stop()` closes everything. */
async function start({ names = ['alpha'], saved = true, forward } = {}) {
  const fixture = demoDir(names);
  if (saved) for (const name of names) save(fixture.dir, name);
  const lines = [];
  const server = createOfflineServer({ demoDir: fixture.dir, forward, log: (line) => lines.push(line) });
  const url = await listen(server);
  return {
    url,
    lines,
    dir: fixture.dir,
    stop: async () => {
      await close(server);
      fixture.done();
    },
  };
}

/** A live API that records what reaches it. */
async function liveApi(status = 200) {
  const seen = [];
  const server = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      seen.push({
        method: req.method,
        url: req.url,
        type: req.headers['content-type'],
        length: body.length,
        host: req.headers.host,
      });
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ from: 'live', length: body.length }));
    });
  });
  const url = await listen(server);
  return { url, seen, stop: () => close(server) };
}

test('the stand-in says it is up, and which mode it is in', async () => {
  const offline = await start();
  try {
    const response = await fetch(`${offline.url}/health`);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: 'ok', mode: 'saved-answers', forwarding: false });
  } finally {
    await offline.stop();
  }
});

test('a saved question is answered with the saved answer, however the reader spells it', async () => {
  const offline = await start();
  try {
    const response = await post(`${offline.url}/api/demo/alpha/ask`, {
      question: `  ${questions[0].toUpperCase()}  `,
      stepId: 'takeaway-1',
      figureId: 'fig1',
      history: [{ question: 'earlier', answer: 'an answer' }],
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /application\/json/);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.answerable, 'yes');
    assert.equal(body.steps[0].say, `Saved: ${questions[0]}`);
    assert.match(offline.lines.join('\n'), /saved {5}alpha {2}"WHY ONE\?"/);
  } finally {
    await offline.stop();
  }
});

test('anything else is refused in plain words the reader can show', async () => {
  const offline = await start();
  try {
    const url = `${offline.url}/api/demo/alpha/ask`;
    let response = await post(url, { question: 'What is a banana?' });
    assert.equal(response.status, 503);
    const refusal = await response.json();
    assert.equal(refusal.error.code, 'offline_no_saved_answer');
    assert.match(refusal.error.message, /only the prepared questions can be answered/);
    assert.match(offline.lines.join('\n'), /refused {3}alpha {2}"What is a banana\?" has no saved answer/);
    // A saved answer is for the plain question: not for a region, not in another language.
    assert.equal(
      (await post(url, { question: questions[0], selection: { page: 1, rect: [0, 0, 0.5, 0.5] } })).status,
      503,
    );
    assert.equal((await post(url, { question: questions[0], responseLanguage: 'de' })).status, 503);
    // A document without saved answers has none to give.
    response = await post(`${offline.url}/api/demo/beta/ask`, { question: questions[0] });
    assert.equal(response.status, 503);
  } finally {
    await offline.stop();
  }
});

test('a request with no question gets the same 400 the live API gives, which is how the preflight finds the route', async () => {
  const offline = await start();
  try {
    const url = `${offline.url}/api/demo/alpha/ask`;
    for (const body of ['{}', 'not json', '{"question":"   "}', '{"question":4}']) {
      const response = await post(url, body);
      assert.equal(response.status, 400, body);
      assert.equal((await response.json()).error.code, 'invalid_request');
    }
  } finally {
    await offline.stop();
  }
});

test("with no live API a snap keeps the learner's rectangle and voice says it is off", async () => {
  const offline = await start();
  try {
    let response = await post(`${offline.url}/api/demo/alpha/snap`, { page: 1, box: [0, 0, 10, 10] });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: false, reason: 'unavailable' });
    response = await post(`${offline.url}/api/demo/alpha/transcribe`, new Uint8Array(100), {
      'Content-Type': 'audio/wav',
    });
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.error.code, 'voice_unavailable');
    assert.match(body.error.message, /Type the question/);
  } finally {
    await offline.stop();
  }
});

test('unknown paths, other methods and names that climb out of demo/ are not found', async () => {
  const offline = await start();
  try {
    assert.equal((await fetch(`${offline.url}/api/settings`)).status, 404);
    assert.equal((await fetch(`${offline.url}/api/demo/alpha/ask`)).status, 404, 'a GET is not a question');
    assert.equal((await post(`${offline.url}/api/demo/..%2Fsecret/ask`, { question: 'x' })).status, 404);
    assert.equal(
      (await post(`${offline.url}/api/demo/%E0%A4%A/ask`, { question: 'x' })).status,
      404,
      'a broken escape',
    );
    assert.equal((await post(`${offline.url}/api/demo/alpha/ask`, new Uint8Array(70_000))).status, 413);
  } finally {
    await offline.stop();
  }
});

test('answers saved while it runs are served at once, without a restart', async () => {
  const offline = await start({ saved: false });
  try {
    const url = `${offline.url}/api/demo/alpha/ask`;
    assert.equal((await post(url, { question: questions[0] })).status, 503);
    save(offline.dir);
    assert.equal((await post(url, { question: questions[0] })).status, 200);
  } finally {
    await offline.stop();
  }
});

test('only this machine, addressed by a local name, is answered', async () => {
  const offline = await start();
  try {
    const { port } = new URL(offline.url);
    const status = await new Promise((resolve, reject) => {
      const req = httpRequest(
        { host: '127.0.0.1', port, path: '/health', headers: { host: 'demo.example.com' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      );
      req.on('error', reject);
      req.end();
    });
    assert.equal(status, 404, 'a rebound host name is turned away, as the real API does');
  } finally {
    await offline.stop();
  }
});

test('with --forward the saved questions never reach the live API, and every other request does', async () => {
  const live = await liveApi();
  const offline = await start({ forward: live.url });
  try {
    assert.deepEqual(await (await fetch(`${offline.url}/health`)).json(), {
      status: 'ok',
      mode: 'saved-answers',
      forwarding: true,
    });
    const saved = await post(`${offline.url}/api/demo/alpha/ask`, { question: questions[1] });
    assert.equal((await saved.json()).steps[0].say, `Saved: ${questions[1]}`);
    assert.equal(live.seen.length, 0, 'a saved question costs no model call');

    const newQuestion = { question: 'A new question?' };
    const drag = { page: 1, box: [1, 2, 3, 4] };
    const asked = await post(`${offline.url}/api/demo/alpha/ask`, newQuestion);
    assert.deepEqual(await asked.json(), {
      from: 'live',
      length: JSON.stringify(newQuestion).length,
    });
    await post(`${offline.url}/api/demo/alpha/snap`, drag);
    await post(`${offline.url}/api/demo/alpha/transcribe`, new Uint8Array(5000), { 'Content-Type': 'audio/wav' });
    assert.equal((await fetch(`${offline.url}/api/models`)).status, 200);
    assert.deepEqual(
      live.seen.map((entry) => [entry.method, entry.url, entry.type, entry.length]),
      [
        ['POST', '/api/demo/alpha/ask', 'application/json', JSON.stringify(newQuestion).length],
        ['POST', '/api/demo/alpha/snap', 'application/json', JSON.stringify(drag).length],
        ['POST', '/api/demo/alpha/transcribe', 'audio/wav', 5000],
        ['GET', '/api/models', undefined, 0],
      ],
    );
    assert.ok(
      live.seen.every((entry) => /^127\.0\.0\.1:\d+$/.test(entry.host)),
      'the live API sees a local host name',
    );
  } finally {
    await offline.stop();
    await live.stop();
  }
});

test("the live API's refusals are relayed as they are, and a live API that is down gets a plain 502", async () => {
  const busy = await liveApi(429);
  const offline = await start({ forward: busy.url });
  try {
    const response = await post(`${offline.url}/api/demo/alpha/ask`, { question: 'A new question?' });
    assert.equal(response.status, 429);
  } finally {
    await offline.stop();
    await busy.stop();
  }
  const gone = await liveApi();
  await gone.stop();
  const orphan = await start({ forward: gone.url });
  try {
    const response = await post(`${orphan.url}/api/demo/alpha/ask`, { question: 'A new question?' });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).error.code, 'upstream_unavailable');
    assert.equal(
      (await post(`${orphan.url}/api/demo/alpha/ask`, { question: questions[0] })).status,
      200,
      'saved answers still play',
    );
    assert.match(orphan.lines.join('\n'), /the live API did not answer/);
  } finally {
    await orphan.stop();
  }
});

test('the relay passes on every method with its headers and body, and streams an answer as it arrives', async () => {
  const seen = [];
  const live = createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      seen.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: Buffer.concat(chunks).toString(),
      });
      if (req.url === '/api/stream') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' });
        res.write('data: first\n\n');
        setTimeout(() => res.end('data: last\n\n'), 300);
      } else {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{}');
      }
    });
  });
  const liveUrl = await listen(live);
  const offline = await start({ forward: liveUrl });
  try {
    const patched = await fetch(`${offline.url}/api/settings`, {
      method: 'PATCH',
      headers: { Authorization: 'Bearer token-123', 'Content-Type': 'application/json' },
      body: '{"language":"de"}',
    });
    assert.equal(patched.status, 200);
    assert.deepEqual(seen[0], {
      method: 'PATCH',
      url: '/api/settings',
      auth: 'Bearer token-123',
      body: '{"language":"de"}',
    });

    const started = Date.now();
    const stream = await fetch(`${offline.url}/api/stream`);
    assert.equal(stream.headers.get('x-vercel-ai-ui-message-stream'), 'v1');
    assert.match(stream.headers.get('content-type'), /text\/event-stream/);
    const reader = stream.body.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    assert.equal(first, 'data: first\n\n');
    assert.ok(Date.now() - started < 250, 'the first part arrives before the live API has finished');
    let rest = '';
    for (let part = await reader.read(); !part.done; part = await reader.read())
      rest += new TextDecoder().decode(part.value);
    assert.equal(rest, 'data: last\n\n');
  } finally {
    await offline.stop();
    await close(live);
  }
});

test('the folders with saved answers are listed', () => {
  const fixture = demoDir(['alpha', 'beta', 'gamma']);
  try {
    save(fixture.dir, 'alpha');
    save(fixture.dir, 'gamma');
    assert.deepEqual(savedFolders(fixture.dir), [
      { name: 'alpha', answers: 2 },
      { name: 'gamma', answers: 2 },
    ]);
    assert.deepEqual(savedFolders(join(fixture.dir, 'nowhere')), []);
  } finally {
    fixture.done();
  }
});

test('the command takes its port, tells what it serves, and says when the port is taken', async () => {
  const fixture = demoDir(['alpha']);
  const free = await new Promise((resolve) => {
    const probe = createSocketServer().listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
  save(fixture.dir);
  const child = spawn(process.execPath, [SCRIPT, '--port', String(free), '--demo-dir', fixture.dir]);
  try {
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    for (let waited = 0; !out.includes('saved answer') && waited < 5000; waited += 50)
      await new Promise((r) => setTimeout(r, 50));
    assert.match(out, new RegExp(`Saved-answers API on http://127\\.0\\.0\\.1:${free}`));
    assert.match(out, /alpha {14}2 saved answer\(s\)/);
    assert.equal((await fetch(`http://127.0.0.1:${free}/health`)).status, 200);
    // A second one on the same port stops with a message instead of a stack trace.
    await assert.rejects(
      execute(process.execPath, [SCRIPT, '--port', String(free), '--demo-dir', fixture.dir]),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, new RegExp(`Port ${free} is in use`));
        return true;
      },
    );
    await assert.rejects(
      execute(process.execPath, [SCRIPT, '--port', 'abc']),
      (error) => error.code === 2 && /not a port number/.test(error.stderr),
    );
  } finally {
    child.kill();
    fixture.done();
  }
});
