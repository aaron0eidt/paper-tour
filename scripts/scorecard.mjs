// A scorecard for finished tours: what each one contains and what the code measured while it was written. It reads
// files only and makes no model calls.
//   node scripts/scorecard.mjs [--docs <dir>] [--json] <tour folder>...
// A tour folder holds tour.json. When the tour came from server/run-tour.ts it also holds metadata.json (model calls,
// tokens, degraded steps, dropped boards, checked exercise lines) and events.json (the seconds the run took and the
// drafts the code sent back). The document's doc.json is looked up at <dir>/<folder name> (default demo/), then at
// <dir>/<the tour's paper>, then in the tour folder itself. It is used only when its hash is the one the tour was
// written against, to check that every ID the tour points at exists and that the numbers on bars, scatter and heatmap
// boards are printed in the document's text.
import { existsSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));

// Narration time as the server estimates it (server/src/harness/assemble.ts, tourSeconds) and the default pause.
const WORDS_PER_SECOND = 2.6;
const DEFAULT_HOLD_MS = 300;
// List prices in US dollars per million tokens, as input, cached input and output (server/src/muse/pricing.ts, checked
// 2026-10-27). A model without a price here has no cost.
const SPARK = [1.25, 0.15, 4.25];
const PRICES = {
  'muse-spark-1.3': SPARK,
  'muse-spark-1.2': SPARK,
  'muse-spark-1.1': SPARK,
  'muse-wonder-1.0': [4, 0.2, 20],
};
// Events that mean the code rejected a draft and the step was written again.
const SENT_BACK = new Set(['validation.failed', 'beat.guarded', 'beat.duplicate']);
const TYPES = {
  research_paper: 'paper',
  exercise_sheet: 'sheet',
  lecture: 'lecture',
  contract: 'contract',
  letter: 'letter',
  other: 'other',
};

const readJson = (path) => (existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
const words = (text) => text.split(/\s+/).filter(Boolean).length;
const sum = (list) => list.reduce((total, n) => total + n, 0);
const round = (n) => String(Number(n.toPrecision(6)));
const squash = (s) => s.replace(/\s+/g, '').toLowerCase();

/**
 * What a board shows, as text: its kind and the values, latex, expressions, points or labels that make it that board.
 * Two boards with the same signature are the same picture. This is boardSignature in
 * server/src/harness/assemble.ts, the check that drops repeated boards while a tour is written.
 */
export function boardSignature(item) {
  switch (item.kind) {
    case 'formula':
      return `formula|${squash(item.latex)}`;
    case 'bars':
      return `bars|${item.bars
        .map((b) => b.value)
        .sort((a, b) => a - b)
        .map(round)
        .join(',')}`;
    case 'flow':
      return `flow|${item.nodes
        .map((n) => squash(n.label))
        .sort()
        .join(',')}`;
    case 'plot':
      return `plot|${item.curves
        .map((c) => squash(c.expression))
        .sort()
        .join(',')}`;
    case 'heatmap':
      return `heatmap|${item.rows.join(',')}|${item.cols.join(',')}|${item.values.map((row) => row.map(round).join(',')).join(';')}`;
    case 'scatter':
      return `scatter|${item.points
        .map((p) => `${squash(p.label)}:${round(p.x)}:${round(p.y)}`)
        .sort()
        .join(',')}`;
    case 'shapes':
      return `shapes|${JSON.stringify(item.terms)}`;
    case 'timeline':
      return `timeline|${item.events
        .map((e) => `${squash(e.label)}:${round(e.position ?? 0)}`)
        .sort()
        .join(',')}`;
    case 'distribution':
      return `distribution|${item.dists
        .map((d) => JSON.stringify([d.family, d.mean, d.sd, d.min, d.max, d.n, d.p, d.rate, d.counts]))
        .join('|')}`;
    case 'scene': {
      const content = item.objects.flatMap((o) => [
        ...(o.text ? [`${o.type}:${squash(o.text)}`] : []),
        ...(o.values ? [`${o.type}:${o.values.map((row) => row.map(round).join(',')).join(';')}`] : []),
        ...(o.plot ? o.plot.curves.map((c) => `plot:${squash(c.expression)}`) : []),
      ]);
      return content.length ? `scene|${content.sort().join('|')}` : null;
    }
    default:
      return null;
  }
}

/**
 * Where a board's content comes from. "illustrative" is what the board declares (a source of illustrative, or a title or
 * scene text that says so). "document" is a board that presents the document's own values: bars, and any board with
 * source document. Everything else (an equation, a flow, a function, a drawing, values computed from a formula) is
 * "other".
 */
export function boardOrigin(item) {
  const labels = [item.title, ...(item.objects ?? []).map((o) => o.text)];
  if (item.source === 'illustrative' || labels.some((t) => typeof t === 'string' && /\billustrat/i.test(t)))
    return 'illustrative';
  if (item.kind === 'bars' || item.source === 'document') return 'document';
  return 'other';
}

/** The numbers a bars, scatter or heatmap board shows; null for any other kind, which has no list of numbers to check. */
function boardNumbers(item) {
  if (item.kind === 'bars') return item.bars.map((b) => b.value);
  if (item.kind === 'scatter') return item.points.flatMap((p) => [p.x, p.y]);
  if (item.kind === 'heatmap') return item.values.flat();
  return null;
}

// A number as the text prints it: signs differ (the minus sign is a different character in many PDFs), so only the
// magnitude is compared, and thousands separators are dropped.
const magnitude = (n) => String(Number(Math.abs(n).toPrecision(9)));
/** The magnitudes of every number printed in the document's text and captions. */
function printedNumbers(doc) {
  const text = [...doc.blocks.map((b) => b.text), ...doc.figures.map((f) => f.caption ?? '')].join('\n');
  return new Set((text.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => magnitude(Number(n.replaceAll(',', '')))));
}

/** Every ID a step points at. */
function stepTargets(step) {
  return step.actions.flatMap((a) => [a.target, a.anchor, ...(a.targets ?? [])].filter((id) => typeof id === 'string'));
}

/** Every ID doc.json defines, as the reader resolves them (player/src/resolve.ts). */
function documentIds(doc) {
  const ids = new Set([
    ...doc.blocks.map((b) => b.id),
    ...doc.sentences.map((s) => s.id),
    ...doc.sections.map((s) => s.id),
    ...doc.equations.map((e) => e.id),
    ...doc.pages.map((p) => `page${p.n}`),
  ]);
  for (const figure of doc.figures) {
    ids.add(figure.id);
    for (const panel of figure.panels ?? []) ids.add(panel.id);
  }
  const parts = (items) => {
    for (const part of items) {
      ids.add(part.id);
      parts(part.parts ?? []);
    }
  };
  parts(doc.exercises ?? []);
  return ids;
}

function findDoc(folder, tour, docsDir) {
  const names = [basename(resolve(folder)), tour.paper].filter(Boolean);
  for (const dir of [...names.map((name) => join(docsDir, name)), folder]) {
    const doc = readJson(join(dir, 'doc.json'));
    if (doc) return doc;
  }
  return null;
}

/** What the run's tokens cost at list price, in US dollars; null without usage or a price for the model. */
function listCost(metadata) {
  const price = PRICES[metadata?.model];
  const usage = metadata?.usage;
  if (!price || !usage) return null;
  const cached = usage.cachedInputTokens ?? 0;
  return ((usage.promptTokens - cached) * price[0] + cached * price[1] + usage.completionTokens * price[2]) / 1e6;
}

/** The scores of one tour folder. A field is null when the file it comes from is not there. */
export function scoreTour(folder, { docs = join(root, 'demo') } = {}) {
  const tour = readJson(join(folder, 'tour.json'));
  if (!tour) throw new Error(`${folder}: no tour.json`);
  const metadata = readJson(join(folder, 'metadata.json'));
  const events = readJson(join(folder, 'events.json'));
  const found = findDoc(folder, tour, docs);
  // A doc.json of another version of the document would give false answers, so it is only used when its hash matches.
  const doc = found && found.source.sha256 === tour.doc_sha256 ? found : null;
  const printed = doc && printedNumbers(doc);
  const steps = tour.chapters.flatMap((chapter) => chapter.steps);

  const boards = [];
  const seen = new Set();
  let repeated = 0;
  for (const step of steps) {
    const before = new Set(seen);
    for (const action of step.actions) {
      if (action.type !== 'board') continue;
      const signature = boardSignature(action.item);
      const origin = boardOrigin(action.item);
      boards.push({
        step: step.id,
        kind: action.item.kind,
        origin,
        inText:
          origin === 'document' &&
          !!printed &&
          !!boardNumbers(action.item) &&
          boardNumbers(action.item).every((n) => printed.has(magnitude(n))),
      });
      if (signature && before.has(signature)) repeated++;
      if (signature) seen.add(signature);
    }
  }
  const kinds = [...new Set(boards.map((b) => b.kind))].sort();
  const count = (origin) => boards.filter((b) => b.origin === origin).length;

  const targets = steps.flatMap(stepTargets);
  const known = doc && documentIds(doc);
  const lines = metadata?.exercises
    ? {
        ok: sum(metadata.exercises.map((e) => e.ok)),
        all: sum(metadata.exercises.map((e) => e.ok + e.failed + e.unknown)),
        failed: sum(metadata.exercises.map((e) => e.failed)),
      }
    : null;

  const seconds = sum(
    steps.map((step) => words(step.say) / WORDS_PER_SECOND + (step.hold_ms ?? DEFAULT_HOLD_MS) / 1000),
  );
  return {
    tour: basename(resolve(folder)),
    type: TYPES[tour.doc_type] ?? tour.doc_type ?? '-',
    steps: steps.length,
    words: sum(steps.map((step) => words(step.say))),
    minutes: seconds / 60,
    chapters: tour.chapters.length,
    boards: boards.length,
    kinds,
    document: count('document'),
    inText: printed ? boards.filter((b) => b.inText).length : null,
    illustrative: count('illustrative'),
    other: count('other'),
    repeated,
    checkpoints: steps.filter((step) => step.checkpoint).length,
    ids: known ? { found: targets.filter((id) => known.has(id)).length, all: targets.length } : null,
    lines,
    calls: metadata?.modelCalls ?? null,
    tokens: metadata?.usage?.totalTokens ?? null,
    cost: listCost(metadata),
    degraded: metadata
      ? (metadata.degraded?.length ?? 0) +
        (metadata.fallbackBeats?.length ?? 0) +
        (metadata.omittedDetails?.length ?? 0)
      : null,
    dropped: metadata ? (metadata.boards?.dropped?.length ?? 0) : null,
    seconds: events?.length ? Math.max(...events.map((e) => e.at ?? 0)) / 1000 : null,
    sentBack: events ? events.filter((e) => SENT_BACK.has(e.type)).length : null,
  };
}

/** Totals over several tours: sums, and the kinds used by any of them. Null when no tour has the number. */
export function summarize(scores) {
  const total = (key) => {
    const present = scores.map((s) => s[key]).filter((n) => n !== null);
    return present.length ? sum(present) : null;
  };
  const ids = scores.filter((s) => s.ids);
  const lines = scores.filter((s) => s.lines);
  return {
    tour: `all ${scores.length}`,
    type: '',
    steps: total('steps'),
    words: total('words'),
    minutes: total('minutes'),
    chapters: total('chapters'),
    boards: total('boards'),
    kinds: [...new Set(scores.flatMap((s) => s.kinds))].sort(),
    document: total('document'),
    inText: total('inText'),
    illustrative: total('illustrative'),
    other: total('other'),
    repeated: total('repeated'),
    checkpoints: total('checkpoints'),
    ids: ids.length ? { found: sum(ids.map((s) => s.ids.found)), all: sum(ids.map((s) => s.ids.all)) } : null,
    lines: lines.length
      ? {
          ok: sum(lines.map((s) => s.lines.ok)),
          all: sum(lines.map((s) => s.lines.all)),
          failed: sum(lines.map((s) => s.lines.failed)),
        }
      : null,
    calls: total('calls'),
    tokens: total('tokens'),
    cost: total('cost'),
    degraded: total('degraded'),
    dropped: total('dropped'),
    seconds: total('seconds'),
    sentBack: total('sentBack'),
  };
}

// ------------------------------------------------------------------------------------------------------ output

const dash = '-';
const num = (n, digits = 0) => (n === null ? dash : n.toFixed(digits));
const ratio = (r) => (r ? `${r.found}/${r.all}` : dash);

/** Aligned text columns: the first two left-aligned, the rest right-aligned. */
function table(columns, rows) {
  const cells = rows.map((row) => columns.map(([, get]) => String(get(row))));
  const widths = columns.map(([title], i) => Math.max(title.length, ...cells.map((row) => row[i].length)));
  const line = (values) =>
    values
      .map((value, i) => (i < 2 ? value.padEnd(widths[i]) : value.padStart(widths[i])))
      .join('  ')
      .trimEnd();
  const rule = '-'.repeat(sum(widths) + 2 * (widths.length - 1));
  const body = cells.map(line);
  return [line(columns.map(([title]) => title)), rule, ...body.slice(0, -1), rule, body.at(-1)].join('\n');
}

export function render(scores) {
  const all = summarize(scores);
  const rows = [...scores, all];
  const size = table(
    [
      ['tour', (s) => s.tour],
      ['type', (s) => s.type],
      ['steps', (s) => num(s.steps)],
      ['words', (s) => num(s.words)],
      ['min', (s) => num(s.minutes, 1)],
      ['chap', (s) => num(s.chapters)],
      ['calls', (s) => num(s.calls)],
      ['tok k', (s) => (s.tokens === null ? dash : num(s.tokens / 1000))],
      ['usd', (s) => num(s.cost, 2)],
      ['secs', (s) => num(s.seconds, 1)],
      ['resent', (s) => num(s.sentBack)],
      ['degr', (s) => num(s.degraded)],
      ['ids', (s) => ratio(s.ids)],
      ['lines', (s) => ratio(s.lines && { found: s.lines.ok, all: s.lines.all })],
    ],
    rows,
  );
  const visuals = table(
    [
      ['tour', (s) => s.tour],
      ['type', (s) => s.type],
      ['boards', (s) => num(s.boards)],
      ['kinds', (s) => num(s.kinds.length)],
      ['doc', (s) => num(s.document)],
      ['in text', (s) => num(s.inText)],
      ['illus', (s) => num(s.illustrative)],
      ['other', (s) => num(s.other)],
      ['repeat', (s) => num(s.repeated)],
      ['dropped', (s) => num(s.dropped)],
      ['checkpoints', (s) => num(s.checkpoints)],
    ],
    rows,
  );
  const width = Math.max(...rows.map((r) => r.tour.length));
  const kinds = rows.map((s) => `${s.tour.padEnd(width)}  ${s.kinds.join(' ') || dash}`);
  const mean = (key, digits = 1) => {
    const present = scores.map((s) => s[key]).filter((n) => n !== null);
    return present.length ? (sum(present) / present.length).toFixed(digits) : dash;
  };
  return [
    size,
    '',
    visuals,
    '',
    'board kinds',
    ...kinds,
    '',
    `mean per tour: ${mean('steps')} steps, ${mean('words', 0)} words, ${mean('minutes')} min to play, ` +
      `${mean('calls', 0)} model calls, ${mean('seconds')} s to write`,
    '',
    ...LEGEND,
  ].join('\n');
}

const LEGEND = [
  'min: narration at 2.6 words a second plus each pause, as the server estimates it.',
  'calls, tok k (thousand tokens), usd (at list price), degr (steps that lost a part or fell back) and dropped',
  '(boards removed): metadata.json. secs and resent (drafts the code rejected and had written again): events.json.',
  'ids: IDs the tour points at that exist in doc.json. lines: exercise lines checked ok in code, of all lines.',
  'doc: bars, and boards sourced from the document. in text: of the bars, scatter and heatmap among them, those whose',
  'every number is printed in doc.json.',
  'illus: declared illustrative. other: equations, flows, functions and drawings.',
  'repeat: a board whose data an earlier step already showed. checkpoints: steps where the learner tries first.',
];

function main(argv) {
  const folders = [];
  let docs = join(root, 'demo');
  let json = false;
  let help = false;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--docs') docs = resolve(argv[++i] ?? '');
    else if (argv[i] === '--json') json = true;
    else if (argv[i] === '-h' || argv[i] === '--help') help = true;
    else folders.push(argv[i]);
  }
  if (help || !folders.length) {
    console.error('usage: node scripts/scorecard.mjs [--docs <dir>] [--json] <tour folder>...');
    process.exit(help ? 0 : 2);
  }
  try {
    const scores = folders.map((folder) => scoreTour(folder, { docs }));
    console.log(json ? JSON.stringify([...scores, summarize(scores)], null, 2) : render(scores));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
