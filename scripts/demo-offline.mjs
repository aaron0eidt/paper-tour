// A stand-in for the API that answers the demo's questions from saved answers, so the reader works with no model call
// and no Supabase: `npm run demo:prepare` saves demo/<folder>/answers.json, this serves it on the API's own address,
// which the reader's dev server already proxies to. The player needs no change.
//   npm run demo:offline -- [--port 3001] [--forward http://127.0.0.1:3002] [--demo-dir <dir>]
// It answers POST /api/demo/<folder>/ask with the saved answer to the same question (matched as demo-lib.mjs findAnswer
// says). Anything else is refused in plain words so the reader shows a message, and a snap keeps the learner's
// rectangle. With --forward, every request without a saved answer goes on to a live API (start it on another port:
// PORT=3002 npm --prefix server run start), so the suggested questions never wait for a model and others are still live.
// Stop npm run dev's API first: this takes its port. Use `npm run dev:demo` for the reader alone.
import { readdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { DEMO_DIR, DEMO_PAPER, findAnswer, readAnswers } from './demo-lib.mjs';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
/** Questions are small; a recorded question is a WAV of up to a few megabytes, and so is anything relayed. */
const BODY_LIMITS = { ask: 65536, snap: 65536 };
const RELAY_LIMIT = 16 * 1024 * 1024;
/** How long the live API may take to start answering; a stream that has begun is not cut off. */
const UPSTREAM_MS = 100_000;
/** Headers that belong to one connection, not to the request or the answer being passed on. */
const CONNECTION_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'transfer-encoding',
  'content-length',
  'content-encoding',
  'upgrade',
  'te',
  'trailer',
  'proxy-connection',
  'accept-encoding',
]);

const refusal = (code, message) => ({ error: { code, message } });
const decode = (part) => {
  try {
    return decodeURIComponent(part);
  } catch {
    return '';
  }
};

/** A request from this machine addressed to a local name, as the real API requires (server/src/app.ts). */
function fromLocalhost(req) {
  const address = req.socket.remoteAddress ?? '';
  const local = address === '::1' || /^(?:::ffff:)?127\.\d+\.\d+\.\d+$/.test(address);
  return local && LOOPBACK_HOSTS.has((req.headers.host ?? '').toLowerCase().replace(/:\d+$/, ''));
}

async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

/** The folders under `demoDir` with saved answers, as `{ name, answers }`. */
export function savedFolders(demoDir = DEMO_DIR) {
  try {
    return readdirSync(demoDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => ({ name: entry.name, file: readAnswers(join(demoDir, entry.name)) }))
      .filter((entry) => entry.file?.answers.length)
      .map((entry) => ({ name: entry.name, answers: entry.file.answers.length }));
  } catch {
    return [];
  }
}

/**
 * The server, not yet listening. `forward` is the address of a live API for requests without a saved answer;
 * `log(line)` hears about every demo request and what became of it.
 */
export function createOfflineServer({ demoDir = DEMO_DIR, forward, fetchImpl = fetch, log = () => {} } = {}) {
  const send = (res, status, body, type = 'application/json') => {
    res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
    res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
  };
  // Passes a request on to the live API and its answer back as it arrives, so the library's streams (the activity of a
  // tour being written) keep working through it.
  const relay = async (req, res, body, what) => {
    const stop = new AbortController();
    const timer = setTimeout(() => stop.abort(), UPSTREAM_MS);
    res.once('close', () => stop.abort());
    try {
      const headers = Object.fromEntries(Object.entries(req.headers).filter(([name]) => !CONNECTION_HEADERS.has(name)));
      const upstream = await fetchImpl(new URL(req.url, forward), {
        method: req.method,
        headers,
        body: body.length ? body : undefined,
        signal: stop.signal,
      });
      clearTimeout(timer);
      const answer = {};
      upstream.headers.forEach((value, name) => {
        if (!CONNECTION_HEADERS.has(name)) answer[name] = value;
      });
      res.writeHead(upstream.status, answer);
      log(`${what.padEnd(9)} live API answered ${upstream.status}`);
      if (!upstream.body) return res.end();
      Readable.fromWeb(upstream.body)
        .on('error', () => res.destroy())
        .pipe(res);
    } catch {
      clearTimeout(timer);
      if (res.headersSent) return res.destroy();
      send(
        res,
        502,
        refusal('upstream_unavailable', 'The live API did not answer. Pick one of the suggested questions.'),
      );
      log(`${what.padEnd(9)} the live API did not answer`);
    }
  };
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      if (!fromLocalhost(req)) return send(res, 404, refusal('not_found', 'Endpoint not found.'));
      if (req.method === 'GET' && url.pathname === '/health')
        return send(res, 200, { status: 'ok', mode: 'saved-answers', forwarding: Boolean(forward) });
      const match = /^\/api\/demo\/([^/]+)\/(ask|snap|transcribe)$/.exec(url.pathname);
      const body = ['GET', 'HEAD'].includes(req.method)
        ? Buffer.alloc(0)
        : await readBody(req, match ? (BODY_LIMITS[match[2]] ?? RELAY_LIMIT) : RELAY_LIMIT);
      if (!match || req.method !== 'POST' || !DEMO_PAPER.test(decode(match[1]))) {
        if (forward && !match) return relay(req, res, body, 'other');
        return send(res, 404, refusal('not_found', 'Endpoint not found.'));
      }
      const paper = decode(match[1]);
      const action = match[2];
      if (action === 'ask') {
        let request;
        try {
          request = JSON.parse(body.toString('utf8'));
        } catch {
          request = null;
        }
        if (typeof request?.question !== 'string' || !request.question.trim())
          return send(res, 400, refusal('invalid_request', 'The request contains invalid or missing fields.'));
        const saved = findAnswer(readAnswers(join(demoDir, paper)), request);
        if (saved) {
          log(`saved     ${paper}  "${request.question.trim().slice(0, 70)}"`);
          return send(res, 200, saved.answer);
        }
        if (forward) return relay(req, res, body, 'forwarded');
        log(`refused   ${paper}  "${request.question.trim().slice(0, 70)}" has no saved answer`);
        return send(
          res,
          503,
          refusal(
            'offline_no_saved_answer',
            'Offline: only the prepared questions can be answered. Pick one of the suggested questions.',
          ),
        );
      }
      if (forward) return relay(req, res, body, action);
      if (action === 'snap') return send(res, 200, { ok: false, reason: 'unavailable' });
      return send(res, 503, refusal('voice_unavailable', 'Voice input is unavailable offline. Type the question.'));
    } catch (error) {
      if (error?.status === 413) return send(res, 413, refusal('too_large', 'The request is too large.'));
      send(res, 500, refusal('internal_error', 'The request could not be completed.'));
    }
  });
}

async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      options: {
        port: { type: 'string', default: '3001' },
        forward: { type: 'string' },
        'demo-dir': { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    console.error(
      `${error.message}\nusage: npm run demo:offline -- [--port 3001] [--forward <live API url>] [--demo-dir <dir>]`,
    );
    process.exitCode = 2;
    return;
  }
  const { values } = parsed;
  if (values.help) {
    console.error('usage: npm run demo:offline -- [--port 3001] [--forward <live API url>] [--demo-dir <dir>]');
    return;
  }
  const port = Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error(`"${values.port}" is not a port number.`);
    process.exitCode = 2;
    return;
  }
  const demoDir = values['demo-dir'] ? resolve(values['demo-dir']) : DEMO_DIR;
  const server = createOfflineServer({
    demoDir,
    forward: values.forward,
    log: (line) => console.log(`${new Date().toTimeString().slice(0, 8)}  ${line}`),
  });
  server.on('error', (error) => {
    console.error(
      error.code === 'EADDRINUSE'
        ? `Port ${port} is in use. Stop the API there first (this server takes its place), or pick another port with --port.`
        : error.message,
    );
    process.exitCode = 1;
  });
  server.listen(port, '127.0.0.1', () => {
    const folders = savedFolders(demoDir);
    console.log(`Saved-answers API on http://127.0.0.1:${port}, in place of the live API.`);
    if (!folders.length) console.log('No saved answers found: run npm run demo:prepare first.');
    for (const { name, answers } of folders) console.log(`  ${name.padEnd(18)} ${answers} saved answer(s)`);
    console.log(
      values.forward
        ? `Questions without a saved answer, snaps and voice go to ${values.forward}.`
        : 'Questions without a saved answer are refused politely; voice is off and a snap keeps your rectangle.',
    );
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
