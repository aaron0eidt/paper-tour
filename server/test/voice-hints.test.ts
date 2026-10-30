import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { BBox, Doc } from '../../shared/paper';
import { encodeWav } from '../../shared/voice';
import type { MuseConfig } from '../src/config';
import type { Database } from '../src/db';
import { transcribe } from '../src/muse/transcribe';
import {
  MAX_KEYWORDS,
  cleanHints,
  documentKeywords,
  languageBias,
  voiceHints,
  type VoiceHints,
} from '../src/muse/voice-hints';
import { DocumentService } from '../src/service';
import type { SettingsService } from '../src/settings';
import type { FileStorage } from '../src/storage';

const config: MuseConfig = {
  apiKey: 'synthetic-test-key',
  baseUrl: 'https://api.meta.ai/v1',
  model: 'muse-spark-1.3',
  language: 'en-US',
  timeoutMs: 1000,
};
const audio = encodeWav(new Float32Array(4800).fill(0.1), 48000);
const rect: BBox = [0, 0, 100, 10];

/** A document with a title, authors, headings, paragraphs (a sentence per ". "), captions, equations and references. */
function makeDoc(parts: {
  title?: string;
  authors?: string;
  headings?: string[];
  paragraphs?: string[];
  captions?: string[];
  equations?: string[];
  references?: string[];
}): Doc {
  const doc: Doc = {
    schema: 'paper-tour/doc@0.1',
    source: { file: 'doc.pdf', sha256: 'a'.repeat(64), num_pages: 1, generator: 'test' },
    pages: [{ n: 1, width: 600, height: 800 }],
    sections: [],
    blocks: [],
    sentences: [],
    figures: [],
    equations: [],
  };
  let n = 0;
  const block = (type: Doc['blocks'][number]['type'], text: string, split = false) => {
    const id = `p1.b${++n}`;
    const sentences = (split ? text.split(/(?<=\.) /) : []).map((t, i) => {
      doc.sentences.push({ id: `${id}.s${i + 1}`, page: 1, block: id, text: t, rects: [rect] });
      return `${id}.s${i + 1}`;
    });
    doc.blocks.push({ id, page: 1, type, bbox: [0, 0, 500, 20], text, sentences });
    return id;
  };
  if (parts.title) block('title', parts.title);
  if (parts.authors) block('authors', parts.authors);
  for (const heading of parts.headings ?? []) {
    const id = block('heading', heading);
    doc.sections.push({ id: `sec-${id}`, title: heading, level: 1, page: 1, block: id });
  }
  for (const text of parts.paragraphs ?? []) block('paragraph', text, true);
  for (const text of parts.references ?? []) block('reference', text, true);
  (parts.captions ?? []).forEach((caption, i) =>
    doc.figures.push({
      id: `fig${i + 1}`,
      kind: 'figure',
      number: String(i + 1),
      page: 1,
      bbox: [0, 0, 100, 100],
      caption,
      image: `figures/fig${i + 1}.png`,
      panels: [],
      referenced_by: [],
    }),
  );
  (parts.equations ?? []).forEach((text, i) =>
    doc.equations.push({ id: `eq${i + 1}`, number: String(i + 1), page: 1, bbox: [0, 0, 100, 20], text }),
  );
  return doc;
}

const paper = makeDoc({
  title: 'Sparse Routing for Neural Machine Translation',
  authors: 'Ada Lovelace*\nCharles Babbage†\nUniversity of Somewhere\nada@example.org',
  headings: ['1 Introduction', '2 Mixture of Experts Layers', '3 Results'],
  paragraphs: [
    'Recurrent networks such as the Long Short-Term Memory (LSTM) process tokens one at a time. We use a gate called the router to pick experts.',
    'The router scores every token against d_model features. The size d_model is fixed, and d_k is small. We follow Fourier features for position.',
    'Large gradients make training unstable. Clipping the gradients helps, and gradients stay bounded. The Fourier basis is cheap.',
    'The model reaches 28.4 BLEU. A higher BLEU means better translations, and BLEU is averaged over the test sets.',
  ],
  captions: ['Figure 1: The router sends each token to two experts.'],
  equations: ['y = sum(g_i(x) E_i(x))', 'g(x) = softmax(x W_g)'],
  references: ['Zzyzx Qwerty 2019. Zzyzx systems. Zzyzx proceedings. Zzyzx Qwerty Zzyzx.'],
});
const contract = makeDoc({
  title: 'Mietvertrag über Wohnraum',
  headings: ['§ 1 Mietsache', '§ 2 Kaution und Nebenkosten', '§ 3 Kündigung'],
  paragraphs: [
    'Die Kaution beträgt drei Monatsmieten und ist von dem Mieter auf ein Konto des Vermieters zu zahlen. Die Nebenkosten werden jährlich abgerechnet.',
    'Der Vermieter ist nicht verpflichtet, die Kaution vor dem Ende des Vertrags zurückzuzahlen. Die Kaution wird mit Zinsen zurückgezahlt.',
    'Eine Kündigung muss schriftlich erfolgen und ist an die Hausverwaltung zu richten. Die Hausverwaltung bestätigt die Kündigung innerhalb von zwei Wochen.',
    'Das Mietverhältnis wird auf unbestimmte Zeit geschlossen und kann von beiden Seiten gekündigt werden. Die Kaution ist das Thema dieses Absatzes.',
  ],
});

const lower = (list: string[]) => list.map((k) => k.toLowerCase());

test('a paper’s keywords are its title words, headings, defined terms, symbols, acronyms and author surnames', () => {
  const keywords = documentKeywords(paper);
  const has = (word: string) => assert(lower(keywords).includes(word.toLowerCase()), `${word} in ${keywords}`);
  for (const word of ['Sparse', 'Routing', 'Translation']) has(word);
  has('Mixture of Experts Layers');
  has('Long Short Term Memory');
  has('LSTM');
  has('router');
  has('d model');
  has('BLEU');
  has('Fourier');
  has('gradients');
  has('Lovelace');
  has('Babbage');
  // Words every document has, one-letter symbols, the bibliography, e-mail addresses and institutions name nothing.
  for (const word of ['Introduction', 'Results', 'Zzyzx', 'ada', 'University', 'Somewhere', 'd k'])
    assert(!lower(keywords).includes(word.toLowerCase()), `${word} in ${keywords}`);
});

test('keywords come from the document at hand: another document gives a different list in its own language', () => {
  const keywords = documentKeywords(contract);
  assert.deepEqual(
    ['Mietvertrag', 'Wohnraum', 'Kaution', 'Kündigung', 'Hausverwaltung'].filter((k) => !keywords.includes(k)),
    [],
    keywords.join(', '),
  );
  assert(!lower(keywords).some((k) => ['lstm', 'bleu', 'router', 'fourier'].includes(k)));
  assert(!lower(documentKeywords(paper)).some((k) => ['kaution', 'mietvertrag'].includes(k)));
  assert.deepEqual(documentKeywords(makeDoc({})), []);
});

test('keywords are bounded in number and length, clean and unique', () => {
  const acronyms = Array.from({ length: 120 }, (_, i) => {
    const tag = String.fromCharCode(65 + (i % 26), 65 + (Math.floor(i / 26) % 26), 65 + ((i * 7) % 26));
    return `The ${tag} method beats ${tag} again.`;
  });
  const crowded = makeDoc({
    title: 'A very long title with many many words that goes on and on and on forever and ever',
    paragraphs: acronyms,
  });
  const keywords = documentKeywords(crowded);
  assert.equal(keywords.length, MAX_KEYWORDS);
  assert.equal(new Set(lower(keywords)).size, keywords.length);
  for (const keyword of keywords) {
    assert(keyword.length <= 40 && keyword === keyword.trim() && !/[_@<>\\/]/.test(keyword), keyword);
    assert(/\p{L}{3}/u.test(keyword) || /^\p{Lu}{2,}$/u.test(keyword), keyword);
  }
  assert.equal(documentKeywords(paper, 5).length, 5);
});

test('the recognition language is the document’s, named as the API names it', () => {
  assert.deepEqual(languageBias('de-DE'), ['German']);
  assert.deepEqual(languageBias('en-US'), ['English']);
  assert.deepEqual(languageBias('zh-CN'), ['Mandarin Chinese']);
  assert.deepEqual(languageBias('ar'), ['Arabic']);
  assert.deepEqual(languageBias('pt-PT'), ['Portuguese']);
  // Not among the 25 languages of Muse Voice Transcribe: let the model detect it.
  for (const code of ['uk-UA', 'ru-RU', 'xx', '']) assert.deepEqual(languageBias(code), [], code);
  assert.deepEqual(voiceHints(contract, 'en-US').languageBias, ['German']);
  assert.deepEqual(voiceHints(paper, 'de-DE').languageBias, ['English']);
  // Too little text to tell: the configured language.
  assert.deepEqual(voiceHints(makeDoc({ title: 'Hi' }), 'fr-FR').languageBias, ['French']);
});

test('hints are cleaned before they reach the provider', () => {
  assert.deepEqual(cleanHints(undefined), { keywords: [], languageBias: [] });
  assert.deepEqual(cleanHints('keywords'), { keywords: [], languageBias: [] });
  const cleaned = cleanHints({
    keywords: [
      ' softmax ',
      'softmax',
      'x'.repeat(41),
      7,
      null,
      '',
      'Kaution  und\nZins',
      ...Array(80)
        .fill('a')
        .map((a, i) => `${a}${i}`),
    ],
    languageBias: ['German', 'Klingon', 'English', 'German', 5],
  });
  assert.equal(cleaned.keywords.length, MAX_KEYWORDS);
  assert.deepEqual(cleaned.keywords.slice(0, 2), ['softmax', 'Kaution und Zins']);
  assert.deepEqual(cleaned.languageBias, ['German', 'English']);
});

// ---------------------------------------------------------------- the request

type Seen = { request: Record<string, unknown>; signal?: AbortSignal | null };
async function transport(answer: (call: number, seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fake: typeof fetch = async (_url, init) => {
    const body = init?.body as FormData;
    const call = { request: JSON.parse(await (body.get('request') as Blob).text()), signal: init?.signal };
    seen.push(call);
    return answer(seen.length, call);
  };
  return { fake, seen };
}
const hints: VoiceHints = { keywords: ['Kaution', 'd model'], languageBias: ['German'] };
const base = { model: 'muse-voice-transcribe-1.0', audioEncoding: 'WAV', mode: 'PUSH_TO_TALK' };

test('keywords and the language bias are sent in the request part, and left out when there are none', async () => {
  const { fake, seen } = await transport(() => Response.json({ transcript: 'Was ist die Kaution?' }));
  assert.deepEqual(await transcribe(config, audio, fake, undefined, hints), { transcript: 'Was ist die Kaution?' });
  assert.deepEqual(seen[0].request, { ...base, keywords: ['Kaution', 'd model'], languageBias: ['German'] });
  await transcribe(config, audio, fake, undefined, { keywords: [], languageBias: ['English'] });
  assert.deepEqual(seen[1].request, { ...base, languageBias: ['English'] });
  await transcribe(config, audio, fake, undefined, { keywords: [], languageBias: [] });
  await transcribe(config, audio, fake);
  assert.deepEqual(seen[2].request, base);
  assert.deepEqual(seen[3].request, base);
  assert.equal(seen.length, 4);
});

test('a request the provider refuses with hints is sent again without, so no transcription fails over a hint', async (t) => {
  t.mock.method(console, 'warn', () => {});
  for (const status of [400, 422, 500]) {
    const { fake, seen } = await transport((call) =>
      call === 1
        ? new Response('sensitive-provider-body', { status })
        : Response.json({ transcript: 'Wie hoch ist sie?' }),
    );
    assert.deepEqual(
      await transcribe(config, audio, fake, undefined, hints),
      { transcript: 'Wie hoch ist sie?' },
      `${status}`,
    );
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[0].request, { ...base, keywords: hints.keywords, languageBias: hints.languageBias });
    assert.deepEqual(seen[1].request, base);
  }
  // Without hints there is nothing to leave out: one request, one error.
  const plain = await transport(() => new Response('no', { status: 400 }));
  await assert.rejects(() => transcribe(config, audio, plain.fake), /unavailable/);
  assert.equal(plain.seen.length, 1);
  // When the plain request fails as well, the learner gets the ordinary error and never the provider's words.
  const both = await transport(() => new Response('sensitive-provider-body', { status: 400 }));
  await assert.rejects(
    () => transcribe(config, audio, both.fake, undefined, hints),
    (e: Error) => /unavailable/.test(e.message) && !e.message.includes('sensitive'),
  );
  assert.equal(both.seen.length, 2);
});

test('a key, a rate limit, a lost connection or a cancelled request is not retried without hints', async (t) => {
  t.mock.method(console, 'warn', () => {});
  for (const [status, message] of [
    [401, /not accepted/],
    [403, /not accepted/],
    [429, /unavailable/],
  ] as const) {
    const refused = await transport(() => new Response('', { status }));
    await assert.rejects(() => transcribe(config, audio, refused.fake, undefined, hints), message, `${status}`);
    assert.equal(refused.seen.length, 1, `${status}`);
  }
  let calls = 0;
  const offline: typeof fetch = async () => {
    calls++;
    throw new TypeError('fetch failed');
  };
  await assert.rejects(() => transcribe(config, audio, offline, undefined, hints), /Check your connection/);
  assert.equal(calls, 1);
  const controller = new AbortController();
  const cancelled = await transport(() => {
    controller.abort();
    return new Response('', { status: 400 });
  });
  await assert.rejects(() => transcribe(config, audio, cancelled.fake, controller.signal, hints));
  assert.equal(cancelled.seen.length, 1);
});

// ------------------------------------------------------------------- service

const DOCUMENT = '7694558d-f7e2-4cbd-9355-978ec677b254';
const ANALYSIS = '1c3c4c62-0f45-4a4e-9a35-3d2b0c1d7e11';
function voiceLibrary(options: { doc?: () => Doc | Promise<Doc>; analysisId?: string | null; fake: typeof fetch }) {
  const queries: string[] = [];
  const query = async (text: string, values: unknown[] = []) => {
    queries.push(text);
    if (text.startsWith('select * from documents'))
      return {
        rows:
          values[0] === DOCUMENT && values[1] === 'owner'
            ? [
                {
                  id: DOCUMENT,
                  owner_id: 'owner',
                  current_analysis_id: options.analysisId === undefined ? ANALYSIS : options.analysisId,
                },
              ]
            : [],
      };
    if (text.startsWith('select doc from analyses'))
      return { rows: values[0] === ANALYSIS && values[1] === DOCUMENT ? [{ doc: await options.doc!() }] : [] };
    throw new Error(`Unexpected query: ${text}`);
  };
  const db = { query, pool: { query } } as unknown as Database;
  const muse = {
    base: config,
    resolveMuse: async () => ({ config, source: 'app', version: 'v1' }),
    transport: options.fake,
  } as unknown as SettingsService;
  const service = new DocumentService(
    db,
    {} as FileStorage,
    async () => {},
    26214400,
    'muse-spark-1.3',
    undefined,
    muse,
  );
  return { service, queries: () => queries.filter((q) => q.startsWith('select doc from analyses')).length };
}

test('a library question spoken aloud carries its document’s terms and language, read once per analysis', async () => {
  const { fake, seen } = await transport(() => Response.json({ transcript: 'Wie hoch ist die Kaution?' }));
  const { service, queries } = voiceLibrary({ doc: () => contract, fake });
  assert.equal((await service.transcribe('owner', DOCUMENT, audio)).transcript, 'Wie hoch ist die Kaution?');
  await service.transcribe('owner', DOCUMENT, audio);
  assert.equal(queries(), 1, 'the document is read for its terms once');
  for (const { request } of seen) {
    assert.deepEqual(request.languageBias, ['German']);
    assert((request.keywords as string[]).includes('Kaution'));
    assert((request.keywords as string[]).length <= MAX_KEYWORDS);
  }
  await assert.rejects(() => service.transcribe('stranger', DOCUMENT, audio), /not found|Not found/i);
  assert.equal(seen.length, 2, 'a stranger never reaches the provider');
});

test('a document that cannot be read for hints is transcribed without them', async () => {
  for (const options of [
    { analysisId: null },
    { analysisId: ANALYSIS, doc: () => Promise.reject(new Error('database down')) },
    { analysisId: '00000000-0000-4000-8000-000000000000', doc: () => contract },
  ]) {
    const { fake, seen } = await transport(() => Response.json({ transcript: 'Was bedeutet das?' }));
    const { service } = voiceLibrary({ ...options, fake });
    assert.equal((await service.transcribe('owner', DOCUMENT, audio)).transcript, 'Was bedeutet das?');
    assert.deepEqual(seen[0].request, base);
  }
});

test('a demo paper’s question is transcribed with the demo document’s terms', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paper-tour-voice-'));
  try {
    await mkdir(join(root, 'paper'));
    await writeFile(join(root, 'paper', 'doc.json'), JSON.stringify(paper));
    const { fake, seen } = await transport(() => Response.json({ transcript: 'What is the router?' }));
    const { service } = voiceLibrary({ fake });
    service.demoRoot = root;
    assert.equal((await service.demoTranscribe('paper', audio)).transcript, 'What is the router?');
    assert.deepEqual(seen[0].request.languageBias, ['English']);
    assert((seen[0].request.keywords as string[]).includes('Fourier'));
    await assert.rejects(() => service.demoTranscribe('missing', audio), /not found/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
