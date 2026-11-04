// Scores exercise-sheet tours against answer keys (notes/TUTOR.md, "Evaluation"). It reads files only and makes no
// model calls.
//   node scripts/sheet-eval.mjs [--json] <tour folder>:<sheet folder>:<answers.json> ...
// The tour folder holds tour.json (and metadata.json when it came from server/run-tour.ts), the sheet folder the
// sheet's doc.json, and answers.json is the sheet's key (eval/sheets/<slug>.answers.json). For every taught part it
// compares the numbers of the tour's answer with the key's, and it counts what a tutor's tour should have: background,
// checkpoints, pictures, verified lines.
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORDS_PER_SECOND = 2.6;
// A number of the answer matches the key's within this relative difference, since tutors round.
const TOLERANCE = 0.02;

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const words = (text) => text.split(/\s+/).filter(Boolean).length;

/** The numbers a LaTeX or spoken answer states: "x = 3", "1.98\,\mathrm{mol}", "2.3 \times 10^{-3}", "0,25". */
export function numbers(text) {
  const ratio = (_, a, b) => String(Number(a) / Number(b));
  const source = String(text)
    .replace(/(\d)(?:,|\{,\})(\d)/g, '$1.$2')
    .replace(/\s*\\(?:times|cdot)\s*10\^\{?\s*(-?\d+)\s*\}?/g, 'e$1')
    .replace(/\\[dt]?frac\{(-?\d+(?:\.\d+)?)\}\{(-?\d+(?:\.\d+)?)\}/g, ratio)
    .replace(/\\[dt]?frac\s*(\d)\s*(\d)/g, ratio)
    .replace(/(?<![\w.])(-?\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)(?![\w.])/g, ratio);
  return [...source.matchAll(/-?\d+(?:\.\d+)?(?:\s*e-?\d+)?/g)].map((m) => Number(m[0].replace(/\s+/g, '')));
}

const near = (a, b) => (b === 0 ? Math.abs(a) < 1e-9 : Math.abs(a - b) / Math.abs(b) <= TOLERANCE);
/** The same value, also in another SI prefix of the key's unit (720 µJ for 0.72 mJ), when the key has a unit. */
const close = (a, b, unit) => near(a, b) || (Boolean(unit) && [1e3, 1e6, 1e-3, 1e-6].some((f) => near(a, b * f)));

/**
 * How the answer's numbers compare with the key's: "right" when all appear (within the tolerance), "partial" when
 * some do, "wrong" when none do; null when the key has none. In a chemical equation a coefficient 1 is not written.
 */
export function matches(answer, key) {
  const equation = /->|→|\\rightarrow|\\to\b|<=>/.test(String(key.answer));
  const wanted = (key.numeric ?? []).filter((n) => !(equation && n === 1));
  if (!wanted.length) return null;
  const said = numbers(answer);
  const found = wanted.filter((n) => said.some((m) => close(m, n, key.unit))).length;
  return found === wanted.length ? 'right' : found ? 'partial' : 'wrong';
}

/** The task number a key's heading names: "Problem 2" → "2", "Aufgabe 1.3" → "1.3", "H2" → "H2". */
const taskNumber = (heading) => /(?:^|\s)([A-Z]?\d+(?:\.\d+)*)\b/.exec(String(heading))?.[1] ?? String(heading);

/** The doc's unit (a part, or a task without parts) for a key item, or null. */
function unitOf(doc, item) {
  const task = (doc.exercises ?? []).find((t) => t.number === taskNumber(item.task));
  if (!task) return null;
  if (!item.part) return task.parts.length ? null : task.id;
  const part = task.parts.find((p) => p.label === String(item.part).replace(/[().\s]/g, ''));
  return part?.id ?? null;
}

/** The steps of one unit, in tour order. */
const unitSteps = (tour, id) =>
  tour.chapters.flatMap((c) => c.steps).filter((s) => s.id === `${id}-task` || s.id.startsWith(`${id}-`));

/** The tour's final answer for a unit: the answer step's boards and narration, else the last step's. */
function answerOf(steps) {
  const last = steps.find((s) => s.id.endsWith('-answer')) ?? steps.at(-1);
  if (!last) return '';
  const boards = last.actions.filter((a) => a.type === 'board' && a.item.kind === 'formula').map((a) => a.item.latex);
  return [...boards, last.say].join(' ');
}

const formulaBoards = (steps) =>
  steps.flatMap((s) => s.actions.filter((a) => a.type === 'board' && a.item.kind === 'formula').map((a) => a.item));

export function scoreSheet(tour, doc, key, metadata = null) {
  const all = tour.chapters.flatMap((c) => c.steps);
  const units = (doc.exercises ?? []).flatMap((t) => (t.parts.length ? t.parts.map((p) => p.id) : [t.id]));
  const taught = units.filter((id) => unitSteps(tour, id).some((s) => !s.id.endsWith('-task') || s.actions.length > 2));
  const items = key.items.map((item) => {
    const id = unitOf(doc, item);
    const steps = id ? unitSteps(tour, id) : [];
    const answer = answerOf(steps);
    return {
      task: item.task,
      part: item.part,
      unit: id,
      steps: steps.length,
      background: steps.some((s) => s.id.endsWith('-background')),
      checkpoint: steps.some((s) => s.checkpoint),
      answer: answer.slice(0, 160),
      key: item.answer,
      correct: steps.length > 1 ? matches(answer, item) : null,
    };
  });
  const boards = all.flatMap((s) => s.actions.filter((a) => a.type === 'board').map((a) => a.item));
  const lines = formulaBoards(all);
  const scored = items.filter((i) => i.correct !== null);
  return {
    title: tour.title,
    docType: tour.doc_type,
    preset: tour.preset,
    steps: all.length,
    minutes: Number((all.reduce((n, s) => n + words(s.say), 0) / WORDS_PER_SECOND / 60).toFixed(1)),
    parts: units.length,
    keyed: items.length,
    mapped: items.filter((i) => i.unit).length,
    taught: taught.length,
    background: all.filter((s) => s.id.endsWith('-background')).length,
    checkpoints: all.filter((s) => s.checkpoint).length,
    pictures: [...new Set(boards.filter((b) => b.kind !== 'formula').map((b) => b.kind))],
    pictureCount: boards.filter((b) => b.kind !== 'formula').length,
    lines: lines.length,
    verified: lines.filter((l) => l.verified).length,
    working: lines.filter((l) => l.before?.length).length,
    correct: scored.filter((i) => i.correct === 'right').length,
    partial: scored.filter((i) => i.correct === 'partial').length,
    scored: scored.length,
    // The verifier's verdicts on the solution lines as run-tour.ts recorded them (older tours carry no ✓ on boards).
    checks: ['ok', 'failed', 'unknown'].map((status) =>
      (metadata?.exercises ?? []).reduce((n, unit) => n + (unit[status] ?? 0), 0),
    ),
    items,
  };
}

function table(score) {
  const head = `## ${score.title} (${score.docType}, ${score.preset})`;
  const summary = [
    `${score.steps} steps, about ${score.minutes} min of narration`,
    `parts taught ${score.taught}/${score.parts} (key ${score.mapped}/${score.keyed} mapped)`,
    `answers right ${score.correct}/${score.scored} (partial ${score.partial})`,
    `background ${score.background}, checkpoints ${score.checkpoints}`,
    `pictures ${score.pictureCount} (${score.pictures.join(', ') || 'none'})`,
    `formula lines ${score.lines}, verified ${score.verified}, with working above ${score.working}`,
    `checker ok ${score.checks[0]}, failed ${score.checks[1]}, unknown ${score.checks[2]}`,
  ].join(' · ');
  const rows = score.items.map(
    (i) =>
      `| ${i.task}${i.part ? ` ${i.part})` : ''} | ${i.steps} | ${i.background ? 'yes' : ''} | ${i.steps <= 1 ? 'not taught' : (i.correct ?? '?')} | ${i.answer.replace(/\|/g, '/').slice(0, 90)} | ${String(i.key).replace(/\|/g, '/').slice(0, 60)} |`,
  );
  return [
    head,
    summary,
    '',
    '| part | steps | background | answer | tour says | key |',
    '|---|---|---|---|---|---|',
    ...rows,
  ].join('\n');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2).filter((a) => a.trim());
  const json = args.includes('--json');
  const scores = args
    .filter((a) => a !== '--json')
    .map((arg) => {
      const [tourDir, sheetDir, keyPath] = arg.split(':');
      const tour = readJson(resolve(tourDir, 'tour.json'));
      const doc = readJson(resolve(sheetDir, 'doc.json'));
      const key = readJson(resolve(keyPath));
      if (!tour || !doc || !key) throw new Error(`missing tour, doc or key for ${arg}`);
      return scoreSheet(tour, doc, key, readJson(resolve(tourDir, 'metadata.json')));
    });
  if (json) console.log(JSON.stringify(scores, null, 1));
  else {
    console.log(scores.map(table).join('\n\n'));
    const total = (key) => scores.reduce((n, s) => n + s[key], 0);
    console.log(
      `\nAll sheets: parts taught ${total('taught')}/${total('parts')}, answers right ${total('correct')}/${total('scored')} (partial ${total('partial')}), steps ${total('steps')}, background ${total('background')}, pictures ${total('pictureCount')}, verified lines ${total('verified')}/${total('lines')}, checker ok ${scores.reduce((n, s) => n + s.checks[0], 0)} of ${scores.reduce((n, s) => n + s.checks[0] + s.checks[1] + s.checks[2], 0)}`,
    );
  }
}
