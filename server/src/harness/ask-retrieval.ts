import type { BBox, Doc, Step, Tour } from '../../../shared/paper';
import { selectedSourceIds, type RegionSelection } from '../../../shared/selection';
import { GENERIC, functionWords } from './ask-generic';
import type { AskRequest, AskTurn } from './ask-types';
import { tableLines } from '../../../shared/tableTargets';
import { documentLanguage } from './language';
import { proseSentences } from './paper-block';
import { gridOf, tableText, tableViews, viewsFor, type TableView } from './tables';
import { figureTextTargets, type MeasuredTarget } from './visual-grounding';

export interface Passage {
  id: string;
  kind: 'sentence' | 'figure' | 'equation' | 'section';
  page: number;
  /** As the model reads it. */
  text: string;
}
/** Passages for one question and the IDs its cues may point at. */
export interface Retrieval {
  /** The current step's evidence and its neighbours, the figure asked about, and elements the question names. */
  focus: Passage[];
  /** The best BM25 matches that are not in focus, best first. */
  ranked: Passage[];
  sentences: string[];
  /** Figures, tables, their panels and equations. */
  visuals: string[];
  /**
   * The extracted cells of the tables in focus, so an answer can quote and chart their numbers. A table the ingest read
   * into a typed grid also has it as text (with the changes from its base row), and the boards the code builds from it.
   */
  tables: { id: string; lines: string[]; text?: string; views?: TableView[] }[];
  /** Where the camera goes when a step points at nothing. */
  home?: string;
  measured?: MeasuredTarget[];
  /**
   * The learner points at something: a selected region, or the figure or equation on screen. That is what the question is
   * about; `bare` when the question names no topic of its own ("explain", "was heißt das?"), `onStep` when the tour step is
   * about it too (or the question builds on the tour).
   */
  pointing?: { bare: boolean; onStep: boolean };
  /** The narration the question builds on: all of the step's, or what is about the selection (everything when absent). */
  narration?: string;
  /** The earlier exchanges the question builds on (all of them when absent). */
  history?: AskTurn[];
}

const STOP = new Set(
  `a about above after again all also am an and any are as at be because been before being between both but by can
  could did do does doing done during each either for from further had has have having he her here hers him his how i
  if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same
  she should so some such than that the their them then there these they this those through to too under until up
  upon us very was we were what when where whether which while who whom why will with within would you your`.split(
    /\s+/,
  ),
);

/** Rough stem: enough to match plurals and -ing/-ed forms ("keys" and "key", "scaled" and "scale"). */
function stem(word: string): string {
  let w = word;
  if (/(ss|ch|sh|x|z)es$/.test(w) && w.length > 4) w = w.slice(0, -2);
  else if (w.endsWith('ies') && w.length > 4) w = `${w.slice(0, -3)}y`;
  else if (/[^aiosu]s$/.test(w) && w.length > 3) w = w.slice(0, -1);
  const suffix = /(ing|ed|ly)$/.exec(w);
  if (suffix && w.length - suffix[0].length >= 3) w = w.slice(0, -suffix[0].length);
  return w.length > 3 && w.endsWith('e') ? w.slice(0, -1) : w;
}

/** Search terms of a text: lower-case stems without stop words; "d_k" also yields "dk", as PDF text often writes it. */
export function searchTerms(text: string, skip?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const raw of text.toLowerCase().match(/\d+(?:[.,]\d+)*|[\p{L}\p{N}]+(?:_[\p{L}\p{N}]+)*/gu) ?? []) {
    const token = raw.replace(/,(?=\d{3}\b)/g, '');
    const parts = token.includes('_') ? [...token.split('_'), token.replace(/_/g, '')] : [token];
    for (const part of parts)
      if (!STOP.has(part) && !skip?.has(part) && (part.length > 1 || /\d/.test(part)))
        out.push(/\d/.test(part) ? part : stem(part));
  }
  return out;
}

/** BM25 scores of each document (a list of terms) for weighted query terms. */
export function bm25(docs: string[][], query: Map<string, number>, k1 = 1.2, b = 0.75): number[] {
  const avg = docs.reduce((sum, d) => sum + d.length, 0) / Math.max(1, docs.length) || 1;
  const df = new Map<string, number>();
  for (const d of docs) for (const t of new Set(d)) if (query.has(t)) df.set(t, (df.get(t) ?? 0) + 1);
  return docs.map((d) => {
    const tf = new Map<string, number>();
    for (const t of d) if (query.has(t)) tf.set(t, (tf.get(t) ?? 0) + 1);
    let score = 0;
    for (const [t, f] of tf) {
      const idf = Math.log(1 + (docs.length - df.get(t)! + 0.5) / (df.get(t)! + 0.5));
      score += query.get(t)! * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / avg)));
    }
    return score;
  });
}

const figureName = (f: Doc['figures'][number]) => `${f.kind === 'table' ? 'Table' : 'Figure'} ${f.number}`;
/** "Figure 3: caption", whether or not the extracted caption starts with its own "Fig. 3." or "Table III:". */
const captioned = (f: Doc['figures'][number]) =>
  `${figureName(f)}: ${f.caption.replace(/^\s*(?:fig(?:ure)?|tab(?:le)?)\b\.?\s*(?:\d[\w.]*|[ivxlc]+\b)\s*[:.]?\s*/i, '')}`;

/** Everything a question can be matched against, with the text BM25 searches (equations also by their surrounding sentences). */
function corpus(doc: Doc): { passage: Passage; search: string }[] {
  const out: { passage: Passage; search: string }[] = proseSentences(doc).map((s) => ({
    passage: { id: s.id, kind: 'sentence', page: s.page, text: s.text },
    search: s.text,
  }));
  for (const f of doc.figures) {
    const text = captioned(f);
    out.push({ passage: { id: f.id, kind: 'figure', page: f.page, text }, search: text });
  }
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const blocks = doc.blocks;
  for (const e of doc.equations) {
    // Extracted equation text is often garbled; the sentences around it say what it computes.
    const at = blocks.findIndex((b) => b.id === e.block);
    const before = at > 0 ? blocks[at - 1].sentences.at(-1) : undefined;
    const after = at >= 0 && at + 1 < blocks.length ? blocks[at + 1].sentences[0] : undefined;
    const around = [before, after].map((id) => (id ? (sentences.get(id)?.text ?? '') : '')).join(' ');
    const text = `${e.number ? `Equation (${e.number})` : 'Equation'}: ${e.text}`;
    out.push({ passage: { id: e.id, kind: 'equation', page: e.page, text }, search: `${text} ${around}` });
  }
  for (const s of doc.sections) {
    const text = `Section ${s.number ? `${s.number} ` : ''}${s.title}`;
    out.push({ passage: { id: s.id, kind: 'section', page: s.page, text }, search: text });
  }
  return out;
}

/** Elements the question names: "Figure 3", "Abbildung 3", "Table II", "Eq. (2)", "Gleichung 2", "Section 4.1", "Abschnitt 4.1". */
export function namedElements(doc: Doc, question: string): string[] {
  const ids: string[] = [];
  for (const m of question.matchAll(
    /\b(fig(?:ure)?s?|abb(?:ildung(?:en)?)?|tab(?:le)?s?|tabelle[n]?)\.?\s*([0-9]+[a-z]?|[ivxlc]+)\b/gi,
  )) {
    const kind = /^(?:fig|abb)/i.test(m[1]) ? 'figure' : 'table';
    // "Figure 2a" names a panel of Figure 2: the figure brings its panels along.
    const numbers = [m[2], m[2].replace(/(?<=\d)[a-z]$/i, '')].map((n) => n.toLowerCase());
    const f = doc.figures.find((f) => f.kind === kind && numbers.includes(f.number.toLowerCase()));
    if (f) ids.push(f.id);
  }
  for (const m of question.matchAll(/\b(?:eq(?:uation)?s?|gleichung(?:en)?)\.?\s*\(?([0-9]+[a-z]?)\)?/gi)) {
    const e = doc.equations.find((e) => e.number?.toLowerCase() === m[1].toLowerCase());
    if (e) ids.push(e.id);
  }
  for (const m of question.matchAll(/(?:\b(?:sec(?:tion)?s?|abschnitt|kapitel)\.?|§)\s*([0-9]+(?:\.[0-9]+)*)/gi)) {
    const s = doc.sections.find((s) => s.number === m[1]);
    if (s) ids.push(s.id);
  }
  return [...new Set(ids)];
}

const TASK =
  /\b(?:exercises?|tasks?|problems?|questions?|aufgaben?|übung(?:en)?|uebung(?:en)?)\s*([a-z]?\d+(?:\.\d+)*)(?:\s*[.(]?\s*([a-z]|[ivx]+)\s*\)?(?![\p{L}\d]))?/giu;

/** The blocks of an exercise sheet's task or part that the question names: "task 2b", "Aufgabe 1 (a)", "exercise 3.c". */
export function namedExercise(doc: Doc, question: string): string[] {
  const tasks = doc.exercises ?? [];
  const blocks: string[] = [];
  type Part = NonNullable<Doc['exercises']>[number]['parts'][number];
  const find = (parts: Part[], label: string): Part | undefined => {
    for (const part of parts) {
      const found = part.label.toLowerCase() === label ? part : find(part.parts ?? [], label);
      if (found) return found;
    }
    return undefined;
  };
  for (const m of tasks.length ? question.matchAll(TASK) : []) {
    const task = tasks.find((t) => t.number.toLowerCase() === m[1].toLowerCase());
    const part = task && m[2] ? find(task.parts, m[2].toLowerCase()) : undefined;
    if (task) blocks.push(...(part ?? task).blocks);
  }
  return [...new Set(blocks)];
}

/** Every element a tour step points at or moves the camera to. */
function stepTargets(step: Step): string[] {
  return step.actions.flatMap((a) =>
    'targets' in a ? a.targets : 'target' in a ? [a.target] : 'anchor' in a ? [a.anchor] : [],
  );
}

export function findStep(tour: Tour | undefined, stepId: string | undefined): Step | undefined {
  return stepId ? tour?.chapters.flatMap((c) => c.steps).find((s) => s.id === stepId) : undefined;
}

const RANKED = 12;
const TABLE_LINES = 40;
/** Words that point back at the conversation: the question builds on the previous exchange. */
const REFERRING = /\b(?:it|its|this|that|these|those|they|them|their|there|he|she|his|her|es|das|dies|diese[rsmn]?)\b/i;
/** A question that refers to the conversation itself, with or without a topic of its own: "you said …", "deine Antwort". */
const RECALL =
  /\b(?:(?:did |do )?you (?:said|mentioned|meant|say|mean|mention)|your (?:(?:last|previous) )?(?:answer|response)|du hast (?:gesagt|gemeint)|hast du (?:gesagt|gemeint)|(?:deine|deiner) (?:letzte[nr]? )?antwort|meintest du|sagtest du|vorhin)\b/iu;
/** A sentence whose first words refer back to the one before it. */
const ANAPHORIC = /^(?:\S+\s+){0,4}?(?:this|that|these|those|it|its|such|they|thus|hence)\b/i;
/** A question for a number: how many, how long, what size. */
const QUANTITY =
  /\b(?:how (?:many|much|big|large|long|small|fast|often|far|high|low|deep|wide)|what (?:value|size|number|percentage|amount|score)|wie (?:viele?|groß|lange?|hoch|oft|weit))\b/i;
// Short section titles win BM25's length normalisation too easily; they are context, not answers.
const KIND_WEIGHT: Record<Passage['kind'], number> = { sentence: 1, figure: 1, equation: 1, section: 0.6 };
const KIND_CAP: Record<Passage['kind'], number> = { sentence: RANKED, figure: 3, equation: 3, section: 2 };

/** A region with no text in it (a picture, a plot the ingest did not box): the sentences next to it say what it is about. */
function nearby(doc: Doc, selection: RegionSelection, known: (id: string) => string | undefined): string[] {
  const page = doc.pages.find((p) => p.n === selection.page);
  if (!page) return [];
  const [x0, y0, x1, y1] = selection.rect;
  const box = [x0 * page.width, y0 * page.height, x1 * page.width, y1 * page.height];
  const gap = ([a, b, c, d]: BBox) =>
    Math.hypot(Math.max(a - box[2], box[0] - c, 0), Math.max(b - box[3], box[1] - d, 0));
  return doc.sentences
    .filter((s) => s.page === selection.page && known(s.id))
    .map((s) => ({ id: s.id, distance: Math.min(...s.rects.map(gap)) }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 3)
    .map((s) => s.id);
}

// A sentence ends before a capital letter, not after an abbreviation: "Fig. 1 shows", "z. B. die", "Abb. 2" stay whole.
const sentencesOf = (text: string) =>
  text
    .split(/(?<=[.!?…])(?<!\b(?:Fig|Figs|Abb|Eq|Eqs|Nr|Dr|Prof|vs|e\.g|i\.e|z|z\.\s?B|bzw|ca|usw)\.)\s+(?=\p{Lu})/u)
    .filter((s) => s.trim());

/**
 * Retrieval in code: BM25 over prose sentences, captions, equations and section titles for the question (with the
 * previous question and the current narration as weaker context), plus what the learner is looking at. When the learner
 * points at something (a selected region, the figure or equation on screen), that is what the question is about: its
 * own text drives the search, a question without a topic ("explain", "was heißt das?") searches with nothing else, and
 * the narration and earlier exchanges are left out; with a topic of its own the question leads.
 */
export function retrieve(doc: Doc, request: AskRequest, step?: Step): Retrieval {
  const items = corpus(doc);
  const byId = new Map(items.map((item) => [item.passage.id, item.passage]));
  const search = new Map(items.map((item) => [item.passage.id, item.search]));
  const figures = new Map(doc.figures.map((f) => [f.id, f]));
  const panelOf = new Map(doc.figures.flatMap((f) => f.panels.map((p) => [p.id, f.id] as const)));
  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  const sentences = new Map(doc.sentences.map((s) => [s.id, s]));
  const terms = items.map((i) => searchTerms(i.search));
  // A term in a fifth of the passages (and at least eight) says little about what a text is about: the function words
  // that GENERIC does not list.
  const df = new Map<string, number>();
  for (const t of terms) for (const word of new Set(t)) df.set(word, (df.get(word) ?? 0) + 1);
  const common = (t: string) => (df.get(t) ?? 0) > Math.max(8, items.length / 5);

  // In focus: the step's evidence with its neighbours, the figure asked about with its citing sentences, named elements.
  const order = items.filter((i) => i.passage.kind === 'sentence').map((i) => i.passage.id);
  const position = new Map(order.map((id, i) => [id, i]));
  const known = (id: string | undefined) => (id && byId.has(id) ? id : id ? panelOf.get(id) : undefined);
  const focus: string[] = [];
  const add = (id: string | undefined) => {
    const k = known(id);
    if (k && !focus.includes(k)) focus.push(k);
  };
  const inRegion = request.selection ? selectedSourceIds(doc, request.selection) : [];
  const selected = request.selection && !inRegion.length ? nearby(doc, request.selection, known) : inRegion;
  const asked = [known(request.figureId)].find((id) => id && ['figure', 'equation'].includes(byId.get(id)!.kind));
  const pointed = [...selected, ...(asked ? [asked] : [])];
  const pointedFigures = [...new Set(pointed.flatMap((id) => figures.get(known(id) ?? '') ?? []))];
  const pointing = !!request.selection || !!asked;
  const named = namedElements(doc, request.question);
  // A task or part of an exercise sheet the question names: the start of its statement.
  const statement = namedExercise(doc, request.question)
    .flatMap((id) => blocks.get(id)?.sentences ?? [])
    .filter((id) => known(id))
    .slice(0, 4);

  // What the learner points at says: the sentences and labels in the region, an equation with the sentences around it, and
  // for a figure its caption, the labels inside it and the sentences that cite it.
  const said = [
    ...pointed.flatMap((id): string[] => {
      const block = blocks.get(id);
      if (sentences.has(id)) return [sentences.get(id)!.text];
      if (block) return block.sentences.length || block.type === 'header_footer' ? [] : [block.text];
      return byId.get(id)?.kind === 'equation' ? [search.get(id)!] : [];
    }),
    ...pointedFigures.flatMap((f) => [
      search.get(f.id)!,
      ...f.referenced_by.slice(0, 3).map((id) => sentences.get(id)?.text ?? ''),
      ...figureTextTargets(doc, f).map((b) => b.text),
    ]),
  ];
  // The document's own words: its language's function words and the frequent words go; a request word such as "mean" or
  // "point" can be a content word there.
  const skip = functionWords(documentLanguage(doc));
  const subject = new Set(searchTerms(said.join('\n'), skip).filter((t) => !common(t)));
  // Whether a text shares enough of its distinctive words with the subject to be about it.
  const about = (text: string) => {
    const words = new Set(searchTerms(text, skip).filter((t) => !common(t)));
    const shared = [...words].filter((t) => subject.has(t)).length;
    return shared >= 1 && shared * 3 >= words.size;
  };
  // The question names a topic when a word of it is not a generic one: a word the document never uses may be a topic in
  // another language, and it does no harm to the search when it is not.
  const topic = request.question.replace(QUANTITY, ' ');
  const content = searchTerms(topic, GENERIC);
  // "What did you say?" asks about the conversation, whatever it points at.
  const recall = RECALL.test(request.question);
  const bare = pointing && !content.length && !named.length && !statement.length && !recall;
  // Beside a selection a pronoun refers to the selection; only beside the figure the camera shows can "it" build on the
  // last exchange.
  const refers = recall || (!request.selection && REFERRING.test(request.question));
  // The step is about what the learner points at when it points at the same elements.
  const unit = (id: string) => sentences.get(id)?.block ?? panelOf.get(id) ?? id;
  const there = new Set(
    [
      ...pointed,
      ...pointedFigures.flatMap((f) => [
        f.id,
        ...f.panels.map((p) => p.id),
        ...figureTextTargets(doc, f).map((b) => b.id),
      ]),
    ].map(unit),
  );
  // A question that names no topic is about what the learner points at and nothing else: no step, no earlier exchange.
  const onStep = !bare && (!pointing || recall || (!!step && stepTargets(step).some((id) => there.has(unit(id)))));
  const narration = !step || bare ? '' : onStep ? step.say : sentencesOf(step.say).filter(about).join(' ');
  const history = bare ? [] : (request.history ?? []);

  const query = new Map<string, number>();
  const weigh = (list: string[], weight: number) => {
    for (const t of list) query.set(t, Math.max(query.get(t) ?? 0, weight));
  };
  // A follow-up also searches with the exchange it builds on, more so when it refers back to it ("how big is it?").
  // "How long" asks for a number: "long" is not what the question is about.
  const quantity = QUANTITY.test(request.question);
  if (!bare) weigh(searchTerms(topic), 1);
  // With a topic of its own the question leads: the subject only tips the ranking (the weight of about two question terms
  // together, half of that for the figure the camera happens to show), and without one it is all the search has.
  if (pointing) weigh([...subject], bare ? 1 : Math.min(0.5, 2 / subject.size) / (request.selection ? 1 : 2));
  weigh(searchTerms(history.at(-1)?.question ?? ''), refers ? 0.9 : 0.5);
  weigh(searchTerms(history.at(-1)?.answer ?? ''), refers ? 0.4 : 0.25);
  weigh(searchTerms(narration), 0.25);

  for (const id of selected) {
    add(id);
    blocks.get(id)?.sentences.forEach(add);
  }
  const evidence = (onStep && step ? stepTargets(step) : [])
    .flatMap((id) => blocks.get(id)?.sentences.slice(0, 4) ?? [id])
    .filter((id) => known(id));
  for (const id of evidence) {
    const at = position.get(id);
    if (at === undefined) add(id);
    else [order[at - 1], id, order[at + 1]].forEach(add);
  }
  add(asked);
  // A figure the learner points at brings the sentences that cite it.
  for (const f of pointedFigures) f.referenced_by.slice(0, 2).forEach(add);
  named.forEach(add);
  statement.forEach(add);

  const scores = bm25(terms, query);
  // A question for a quantity ("how many heads?") prefers passages that print numbers.
  const weight = (p: Passage) => KIND_WEIGHT[p.kind] * (quantity && /\d/.test(p.text) ? 1.5 : 1);
  const taken = new Map<Passage['kind'], number>();
  const best = items
    .map((item, i) => ({ passage: item.passage, score: scores[i] * weight(item.passage), i }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.i - b.i)
    .filter(({ passage }) => {
      const n = taken.get(passage.kind) ?? 0;
      if (n >= KIND_CAP[passage.kind]) return false;
      taken.set(passage.kind, n + 1);
      return true;
    })
    .slice(0, RANKED)
    .map((r) => r.passage);
  // A sentence that opens by referring back ("To counteract this effect, …") comes with the sentence before it.
  const before = (p: Passage) => {
    const at = p.kind === 'sentence' && ANAPHORIC.test(p.text) ? position.get(p.id) : undefined;
    return at ? [byId.get(order[at - 1])!] : [];
  };
  const ranked = [...new Map(best.flatMap((p) => [...before(p), p]).map((p) => [p.id, p])).values()].filter(
    (p) => !focus.includes(p.id),
  );

  const all = [...focus.map((id) => byId.get(id)!), ...ranked];
  const visuals = all.flatMap((p) =>
    p.kind === 'figure'
      ? [
          p.id,
          ...(figures.get(p.id)?.panels.map((x) => x.id) ?? []),
          ...(figures.get(p.id) ? figureTextTargets(doc, figures.get(p.id)!).map((b) => b.id) : []),
        ]
      : p.kind === 'equation'
        ? [p.id]
        : [],
  );
  const namedVisual = named.find((id) => byId.get(id)?.kind !== 'section');
  const tables = focus
    .flatMap((id): Retrieval['tables'] => {
      const table = figures.get(id);
      if (table?.kind !== 'table') return [];
      const lines = tableLines(doc, table).slice(0, TABLE_LINES);
      if (!gridOf(table)) return [{ id, lines }];
      // The best board of each kind the code can build from the grid: its numbers are cells of the table.
      const views = tableViews(table);
      const ready = (['scatter', 'heatmap', 'bars'] as const).flatMap((kind) =>
        viewsFor(views, kind, request.question).slice(0, 1),
      );
      return [{ id, lines, text: tableText(table), views: ready }];
    })
    .filter((t) => t.lines.length || t.text)
    .slice(0, 2);
  return {
    focus: focus.map((id) => byId.get(id)!),
    ranked,
    sentences: all.filter((p) => p.kind === 'sentence').map((p) => p.id),
    visuals: [...new Set(visuals)],
    tables,
    home:
      selected.map(known).find((id) => id && ['figure', 'equation'].includes(byId.get(id)!.kind)) ??
      selected.map(known).find(Boolean) ??
      asked ??
      namedVisual ??
      statement[0] ??
      known(evidence[0]) ??
      named[0] ??
      ranked[0]?.id,
    ...(pointing ? { pointing: { bare, onStep } } : {}),
    narration,
    history,
  };
}

/**
 * What the model was shown that can print a number, which a board's document values must be printed in: the document
 * block it reads on every call (prose, captions, equations) and the cells of the tables in focus. A number the model read
 * anywhere in the document may be charted; one that is printed nowhere in it is invented.
 */
export function evidenceText(doc: Doc, retrieval: Retrieval): string {
  return [
    ...proseSentences(doc).map((s) => s.text),
    ...doc.figures.map((f) => f.caption),
    ...doc.equations.map((e) => e.text),
    ...[...retrieval.focus, ...retrieval.ranked].map((p) => p.text),
    ...retrieval.tables.flatMap((t) => (t.text ? [...t.lines, t.text] : t.lines)),
  ].join('\n');
}

// ---------------------------------------------------------------- the call
