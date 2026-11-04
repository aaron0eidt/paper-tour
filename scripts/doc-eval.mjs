// Scores tours of any document against a key of what a good tour must do (eval/docs/<slug>.expect.json): the exact
// numbers it should state, checked in code, and the points it must cover and the pitfalls it must avoid, judged by a
// model (one call per tour; the cheap contributor model unless MUSE_MODEL says otherwise).
//   node scripts/doc-eval.mjs [--json] [--no-judge] <tour folder>:<expect.json> ...
// The tour folder holds tour.json (from server/run-tour.ts). The Meta key is read from the root .env.
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const WORDS_PER_SECOND = 2.6;
const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const words = (text) => text.split(/\s+/).filter(Boolean).length;

/** Every value the tour states: its narration, board text and labels, as one lower-case text. */
export function tourText(tour) {
  const parts = [];
  for (const step of tour.chapters.flatMap((c) => c.steps)) {
    parts.push(step.say);
    for (const action of step.actions) if (action.type === 'board') parts.push(JSON.stringify(action.item));
    if (step.checkpoint) parts.push(step.checkpoint.prompt, ...step.checkpoint.hints);
  }
  return parts.join('\n');
}

/** Number words a narration may use instead of digits (English and German, 0-20). */
const SPOKEN = [
  ['zero', 'null'], ['one', 'eins'], ['two', 'zwei'], ['three', 'drei'], ['four', 'vier'], ['five', 'fünf'],
  ['six', 'sechs'], ['seven', 'sieben'], ['eight', 'acht'], ['nine', 'neun'], ['ten', 'zehn'], ['eleven', 'elf'],
  ['twelve', 'zwölf'], ['thirteen', 'dreizehn'], ['fourteen', 'vierzehn'], ['fifteen', 'fünfzehn'],
  ['sixteen', 'sechzehn'], ['seventeen', 'siebzehn'], ['eighteen', 'achtzehn'], ['nineteen', 'neunzehn'],
  ['twenty', 'zwanzig'],
];

/** Whether the tour states the number: as digits (with a point or a decimal comma) or, for 0-20, as a word. */
export function statesNumber(text, n) {
  const digits = [...String(text).matchAll(/-?\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
  if (digits.some((d) => Math.abs(d - n) <= Math.abs(n) * 1e-3 + 1e-9)) return true;
  const lower = String(text).toLowerCase();
  return Number.isInteger(n) && n >= 0 && n <= 20 && SPOKEN[n].some((w) => new RegExp(`\\b${w}\\b`).test(lower));
}

async function judge(tour, expect) {
  const key = (readFileSync(resolve(root, '.env'), 'utf8').match(/^MODEL_API_KEY=(.*)$/m) ?? [])[1]?.trim();
  if (!key) return null;
  const narration = tour.chapters
    .map((c) => `## ${c.title}\n${c.steps.map((s, i) => `${i + 1}. ${s.say}`).join('\n')}`)
    .join('\n');
  const schema = {
    type: 'object',
    additionalProperties: false,
    required: ['points', 'pitfalls'],
    properties: {
      points: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'verdict', 'why'],
          properties: {
            index: { type: 'integer' },
            verdict: { type: 'string', enum: ['covered', 'partly', 'missing'] },
            why: { type: 'string' },
          },
        },
      },
      pitfalls: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['index', 'violated', 'why'],
          properties: { index: { type: 'integer' }, violated: { type: 'boolean' }, why: { type: 'string' } },
        },
      },
    },
  };
  const prompt = [
    'You grade a narrated guided tour of a document against a key. Be strict and literal.',
    'POINTS the tour must make (covered = stated clearly, partly = touched but vague or incomplete, missing):',
    ...expect.must_cover.map((p, i) => `${i}. ${p}`),
    'PITFALLS the tour must avoid (violated = the narration does it):',
    ...(expect.pitfalls ?? []).map((p, i) => `${i}. ${p}`),
    'THE TOUR NARRATION:',
    narration,
    'Answer with one entry per point and per pitfall, by index, each with a one-sentence reason.',
  ].join('\n');
  const response = await fetch('https://api.meta.ai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.MUSE_MODEL ?? 'muse-spark-1.3-contributor',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 8000,
      reasoning_effort: 'medium',
      response_format: { type: 'json_schema', json_schema: { name: 'tour_grade', strict: true, schema } },
    }),
  });
  if (!response.ok) return { error: `HTTP ${response.status}` };
  const body = await response.json();
  try {
    return JSON.parse(body.choices[0].message.content);
  } catch {
    return { error: 'unusable judge response' };
  }
}

export async function scoreDoc(tour, expect, useJudge = true) {
  const steps = tour.chapters.flatMap((c) => c.steps);
  const text = tourText(tour);
  const numbers = (expect.numbers ?? []).map((n, i) => ({
    value: n,
    unit: expect.units?.[i] ?? null,
    stated: statesNumber(text, Number(n)),
  }));
  const boards = steps.flatMap((s) => s.actions.filter((a) => a.type === 'board').map((a) => a.item.kind));
  const pens = steps.flatMap((s) => s.actions.filter((a) => a.type === 'arrow' || a.type === 'circle'));
  const grade = useJudge ? await judge(tour, expect) : null;
  const points = grade?.points ?? [];
  const pitfalls = grade?.pitfalls ?? [];
  return {
    slug: expect.slug,
    kind: expect.kind,
    docType: tour.doc_type,
    title: tour.title,
    steps: steps.length,
    minutes: Number((steps.reduce((n, s) => n + words(s.say), 0) / WORDS_PER_SECOND / 60).toFixed(1)),
    boards: boards.length,
    kinds: [...new Set(boards)],
    pens: pens.length,
    numbersStated: numbers.filter((n) => n.stated).length,
    numbers: numbers.length,
    missingNumbers: numbers.filter((n) => !n.stated).map((n) => `${n.value}${n.unit ? ` ${n.unit}` : ''}`),
    covered: points.filter((p) => p.verdict === 'covered').length,
    partly: points.filter((p) => p.verdict === 'partly').length,
    points: expect.must_cover.length,
    missingPoints: points.filter((p) => p.verdict === 'missing').map((p) => expect.must_cover[p.index]),
    violated: pitfalls.filter((p) => p.violated).map((p) => `${expect.pitfalls[p.index]}: ${p.why}`),
    judge: grade?.error ?? (grade ? 'ok' : 'skipped'),
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => a.trim());
  const json = args.includes('--json');
  const useJudge = !args.includes('--no-judge');
  const scores = [];
  for (const arg of args.filter((a) => !a.startsWith('--'))) {
    const [tourDir, expectPath] = arg.split(':');
    const tour = readJson(resolve(tourDir, 'tour.json'));
    const expect = readJson(resolve(expectPath));
    if (!tour || !expect) {
      scores.push({ slug: expect?.slug ?? tourDir, failed: 'no tour.json (the run failed)' });
      continue;
    }
    scores.push(await scoreDoc(tour, expect, useJudge));
  }
  if (json) console.log(JSON.stringify(scores, null, 1));
  else {
    console.log('| doc | kind → type | steps | min | boards (kinds) | pens | numbers | points (partly) | pitfalls |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const s of scores) {
      if (s.failed) console.log(`| ${s.slug} | FAILED: ${s.failed} |||||||| `);
      else
        console.log(
          `| ${s.slug} | ${s.kind} → ${s.docType} | ${s.steps} | ${s.minutes} | ${s.boards} (${s.kinds.join(', ')}) | ${s.pens} | ${s.numbersStated}/${s.numbers} | ${s.covered}/${s.points} (${s.partly}) | ${s.violated.length ? `VIOLATED ${s.violated.length}` : 'ok'} |`,
        );
    }
    for (const s of scores.filter((s) => !s.failed && (s.missingPoints.length || s.violated.length || s.missingNumbers.length)))
      console.log(
        `\n${s.slug}:\n  missing points: ${s.missingPoints.join(' / ') || '-'}\n  missing numbers: ${s.missingNumbers.join(', ') || '-'}\n  pitfalls: ${s.violated.join(' / ') || '-'}`,
      );
  }
}
