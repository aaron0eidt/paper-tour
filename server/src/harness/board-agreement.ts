import type { BoardItem } from '../../../shared/paper';
import { numbersIn, type BoardCheck, type BoardKind } from './board';
import { STOP_WORDS, stem } from './insight';

// Whether a tour step's board shows what its narration says. The narration and the board are written in one call, yet a
// model can still draw one thing while it explains another. The check is conservative, because a false alarm costs a
// good board: only a board with nothing in common with the narration is flagged, on a board of a tour step only, like
// the rules in visual-rules.ts. What the board prints (title, labels, names, the numbers of its data) is compared with
// what the narration says: a paraphrase, one shared word, symbol or number is agreement enough, and so is a board that
// prints the words of the sentences the step points at, which a narration may restate in its own words. A shared
// variable is none (the equations of one document reuse a few letters). The problem is worded as an instruction for the
// repair turn.

/** Lowercase, without accents (ä is a, ß is ss), so that spellings of one word compare equal. */
const fold = (s: string) => s.normalize('NFKD').replace(/\p{M}/gu, '').replace(/ß/g, 'ss').toLocaleLowerCase();
/** Words and numbers, lowercase; letters and digits stay apart ("BLEU4", "α0"). */
const wordsOf = (s: string) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase()
    .match(/\p{L}+|\p{N}+/gu) ?? [];
const STOP = new Set([...STOP_WORDS].map(fold));
/** What two words must share to be one term: the folded word, lightly stemmed. */
const keyOf = (word: string) => stem(fold(word));
/** The words that carry a text's content: no function words, single letters or numbers. */
const content = (s: string) => wordsOf(s).filter((w) => w.length > 1 && !STOP.has(fold(w)) && !/^\d+$/.test(w));

// A board comes from a model and may be unchecked (a failed board is judged too), so its parts are read defensively.
const list = (x: unknown): any[] => (Array.isArray(x) ? x : []);
const str = (x: unknown): string => (typeof x === 'string' ? x : '');

/** Words a board takes from the harness or uses to join its labels; they name no operation or quantity. */
const GENERIC = new Set(
  `illustrative illustrativ illustratif illustrativo ilustrativo illustratief illustration example beispiel exemple
  ejemplo esempio exemplo voorbeeld unchecked ungepruft verifie comprobar verificare verificado gecontroleerd board case
  value score step overview shape against versus vs among within across via per`
    .split(/\s+/)
    .map(keyOf),
);

/** What a board prints, apart from the values of its numbers. */
export interface BoardTerms {
  /** Words that name what the board is about: its title, the labels of its parts and axes, its names. */
  core: string[];
  /** Names of what it compares (bars, rows, points, categories), operations and Greek letters: a hit when said, never a miss. */
  items: string[];
  /** The dimensions of a shapes board: a hit when said, never a miss, and no operation. */
  sizes: string[];
  numbers: string[];
}

const GREEK_NAMES = `alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau
  upsilon phi chi psi omega`.split(/\s+/);
const GREEK = new Set([...GREEK_NAMES, 'varepsilon', 'vartheta', 'varphi']);
/** The Greek letters as characters, lowercase and capital, by name (σ and ς are both sigma). */
const GREEK_LETTER = new Map(
  [...'αβγδεζηθικλμνξοπρστυφχψω'].flatMap((c, i) => {
    const name = GREEK_NAMES[i];
    return [[c, name], [c.toUpperCase(), name], ...(name === 'sigma' ? [['ς', name]] : [])] as [string, string][];
  }),
);

/**
 * What names one operation: its LaTeX command or function name and the words a narration says it with, in the
 * languages of the harness ("root", "Wurzel", "racine"). Words of a group are one term.
 */
const OPERATIONS: string[][] = [
  ['sqrt', 'root', 'wurzel', 'racine', 'raiz', 'radice', 'wortel'],
  ['sum', 'summe', 'somme', 'suma', 'somma', 'som', 'summation'],
  ['prod', 'product', 'produkt', 'produit', 'producto', 'prodotto', 'produto'],
  ['int', 'integral', 'integrale', 'integraal'],
  ['lim', 'limit', 'grenzwert', 'limite', 'limiet'],
  ['max', 'maximum', 'maximal', 'maximale'],
  ['min', 'minimum', 'minimal', 'minimale'],
  ['exp', 'exponential', 'exponentialfunktion', 'exponentiel', 'exponencial'],
  ['log', 'ln', 'logarithm', 'logarithmus', 'logarithme', 'logaritmo'],
  ['sin', 'sine', 'sinus', 'seno'],
  ['cos', 'cosine', 'kosinus', 'cosinus', 'coseno'],
  ['tan', 'tangent', 'tangens', 'tangente'],
  ['det', 'determinant', 'determinante'],
  ['argmax'],
  ['argmin'],
  ['nabla', 'gradient', 'gradiente'],
  ['partial', 'partiell', 'derivative', 'ableitung'],
];
const OPERATION_OF = new Map(
  OPERATIONS.flatMap((group) => group.flatMap((w) => [[fold(w), group] as const, [keyOf(w), group] as const])),
);
const operationOf = (word: string) => OPERATION_OF.get(fold(word)) ?? OPERATION_OF.get(keyOf(word));
/** The spoken forms of the unit abbreviations a board prints ("ms" is said "milliseconds"). */
const UNIT_FORMS = Object.fromEntries(
  Object.entries({
    ms: 'millisecond millisekunde milliseconde',
    cm: 'centimeter centimetre zentimeter centimetro',
    mm: 'millimeter millimetre',
    km: 'kilometer kilometre',
    kg: 'kilogram kilogramm kilogramme',
    mg: 'milligram milligramm',
    ml: 'milliliter millilitre',
    hz: 'hertz',
    khz: 'kilohertz',
    mhz: 'megahertz',
    ghz: 'gigahertz',
    kb: 'kilobyte',
    mb: 'megabyte',
    gb: 'gigabyte',
    tb: 'terabyte',
    eur: 'euro',
    usd: 'dollar',
    gbp: 'pound pfund',
    pct: 'percent prozent',
  }).map(([unit, forms]) => [unit, forms.split(' ')]),
);

const TEXT_COMMAND =
  /\\(?:text|textrm|textit|textbf|textsf|texttt|mathrm|mathit|mathbf|mathsf|mathtt|mathcal|operatorname|mbox)\s*\{([^{}]*)\}/g;

const UNITS = (
  'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen ' +
  'eighteen nineteen'
).split(' ');
const UNITS_DE = (
  'null eins zwei drei vier funf sechs sieben acht neun zehn elf zwolf dreizehn vierzehn funfzehn sechzehn siebzehn ' +
  'achtzehn neunzehn'
).split(' ');
const TENS = 'twenty thirty forty fifty sixty seventy eighty ninety'.split(' ');
const TENS_DE = 'zwanzig dreissig vierzig funfzig sechzig siebzig achtzig neunzig'.split(' ');
/** The denominators a narration says as a word: "a third", "sieben Siebtel". */
const FRACTIONS = Object.entries({
  ...{
    half: 2,
    halves: 2,
    third: 3,
    fourth: 4,
    quarter: 4,
    fifth: 5,
    sixth: 6,
    seventh: 7,
    eighth: 8,
    ninth: 9,
    tenth: 10,
  },
  ...{
    halb: 2,
    halfte: 2,
    drittel: 3,
    viertel: 4,
    funftel: 5,
    sechstel: 6,
    siebtel: 7,
    achtel: 8,
    neuntel: 9,
    zehntel: 10,
  },
});

/** The value of a word that spells a number below a hundred, in English or German: "eight", "neunundzwanzig". */
function wordValue(word = ''): number | undefined {
  const unit = [UNITS.indexOf(word), UNITS_DE.indexOf(word)].find((n) => n >= 0);
  const ten = [TENS.indexOf(word), TENS_DE.indexOf(word)].find((n) => n >= 0);
  // German says the unit first: "neun und zwanzig" is written neunundzwanzig.
  const compound = /^(ein|zwei|drei|vier|funf|sechs|sieben|acht|neun)und(.+)$/.exec(word);
  const tens = compound ? TENS_DE.indexOf(compound[2]) : -1;
  if (unit !== undefined) return unit;
  if (ten !== undefined) return 20 + 10 * ten;
  return compound && tens >= 0
    ? 20 + 10 * tens + UNITS_DE.indexOf(compound[1] === 'ein' ? 'eins' : compound[1])
    : undefined;
}

/** The value of one German word of any size: "neunundzwanzig", "hundertfünf", "zweitausendfünfhundert". */
function germanValue(word: string): number | undefined {
  for (const [part, size] of [
    ['tausend', 1000],
    ['hundert', 100],
  ] as const) {
    const at = word.indexOf(part);
    if (at < 0) continue;
    const head = word.slice(0, at);
    const tail = word.slice(at + part.length).replace(/^und/, '');
    const times = head === '' || head === 'ein' ? 1 : germanValue(head);
    const rest = tail ? germanValue(tail) : 0;
    return times === undefined || rest === undefined ? undefined : times * size + rest;
  }
  return wordValue(word);
}

/** A number below a hundred at `i` and the words it takes: "twenty eight" is 28 in two. */
function below100(words: string[], i: number): [number, number] | undefined {
  const value = wordValue(words[i]);
  if (value === undefined) return undefined;
  const unit = TENS.includes(words[i]) ? wordValue(words[i + 1]) : undefined;
  return unit !== undefined && unit >= 1 && unit <= 9 ? [value + unit, 2] : [value, 1];
}

/** A number below a thousand at `i`: "one hundred and five", "two hundred twenty one", "a hundred". */
function below1000(words: string[], i: number): [number, number] | undefined {
  const head = below100(words, i);
  let [value, used] = head ?? [0, 0];
  if (words[i + used] === 'hundred') {
    value = (head ? value : 1) * 100;
    used++;
    const and = words[i + used] === 'and' ? 1 : 0;
    const more = below100(words, i + used + and);
    if (more) {
      value += more[0];
      used += and + more[1];
    }
  }
  return used ? [value, used] : undefined;
}

/** The number spelled at `i` and the words it takes: "twenty thousand five hundred", "zweihundert". */
function numberAt(words: string[], i: number): [number, number] | undefined {
  const german = germanValue(words[i] ?? '');
  if (german !== undefined && german >= 100) return [german, 1];
  const head = below1000(words, i) ?? (words[i] === 'thousand' ? ([0, 0] as [number, number]) : undefined);
  if (!head) return undefined;
  let [value, used] = head;
  if (words[i + used] === 'thousand') {
    value = (value || 1) * 1000;
    used++;
    const and = words[i + used] === 'and' ? 1 : 0;
    const more = below1000(words, i + used + and);
    if (more) {
      value += more[0];
      used += and + more[1];
    }
  }
  return [value, used];
}

/**
 * The numbers a narration spells, as the digits a board prints: "twenty eight point four" is 28 and 28.4, "zwei Komma
 * fünf" is 2 and 2.5, "neunundzwanzig Siebtel" is 29 and 7, "one hundred and five" is 105, "zweitausend" is 2000.
 * Tokens are folded words.
 */
function spelledNumbers(words: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < words.length;) {
    const fraction = FRACTIONS.find(([word]) => words[i].startsWith(word));
    if (fraction) out.push(String(fraction[1]));
    const number = numberAt(words, i);
    if (!number) {
      i++;
      continue;
    }
    const [value, used] = number;
    i += used;
    out.push(String(value));
    // "point four", "Komma fünf": the digits that follow, one by one; the text does not say where they stop.
    if (words[i] === 'point' || words[i] === 'komma') {
      let digits = '';
      for (let j = i + 1; j < words.length && (wordValue(words[j]) ?? 10) < 10; j++) {
        digits += wordValue(words[j]);
        out.push(`${value}.${digits}`);
      }
    }
  }
  return out.map((n) => numberKey(Number(n)));
}

/** Whether a folded word spells a cardinal number: it is read as one, and names nothing ("one head", "five-hinge"). */
const isCardinal = (word: string) => germanValue(word) !== undefined || ['hundred', 'thousand'].includes(word);

/** A number as a key to compare: 0.50 and 0.5 are one, and a sign does not matter to a listener. */
const numberKey = (n: number) => String(Math.abs(n));
/** A rounded or percentage form of a value is evidence beyond a single digit, which any narration says ("one", "two"). */
const distinctive = (n: string) => n.includes('.') || Number(n) >= 10;

/**
 * A board's value as a narration says it: as printed, rounded ("about 40"), or as a percentage of one ("0.8" is "80
 * percent"). Only the printed value counts when it is as common as a single digit.
 */
function numberForms(value: number): string[] {
  if (!Number.isFinite(value)) return [];
  const rounded = [0, 1, 2].map((d) => Number(value.toFixed(d)));
  if (Math.abs(value) <= 1) rounded.push(...[0, 1].map((d) => Number((value * 100).toFixed(d))));
  return [...new Set([numberKey(value), ...rounded.map(numberKey).filter(distinctive)])];
}

/** The words and numbers a piece of LaTeX prints: \text and function names are words, Greek letters are named. */
function latexTerms(latex: string): Omit<BoardTerms, 'sizes'> {
  const out = { core: [] as string[], items: [] as string[], numbers: [] as string[] };
  let rest = latex.replace(TEXT_COMMAND, (_, text: string) => {
    out.core.push(...content(text).filter((w) => !isCardinal(fold(w))));
    return ' ';
  });
  rest = rest.replace(/\\([a-zA-Z]+)/g, (_, name: string) => {
    if (GREEK.has(name)) out.items.push(name);
    else out.items.push(...(operationOf(name) ?? []));
    return ' ';
  });
  for (const [, digits, run] of rest.matchAll(/(\d+(?:[.,]\d+)?)|(\p{L}+)/gu)) {
    if (digits) out.numbers.push(numberKey(Number(digits.replace(',', '.'))));
    else if ([...run].every((c) => GREEK_LETTER.has(c))) out.items.push(...[...run].map((c) => GREEK_LETTER.get(c)!));
    // Three letters or more are a name (FFN, softmax, head); fewer are variables written side by side.
    else if (run.length >= 3) {
      const operation = operationOf(run);
      if (operation) out.items.push(...operation);
      else out.core.push(run.toLocaleLowerCase());
    }
  }
  return out;
}

/** Everything a board prints that a listener would hear named, by kind. Reads an unchecked board as well. */
export function boardTerms(item: BoardItem): BoardTerms {
  const out: BoardTerms = { core: [], items: [], sizes: [], numbers: [] };
  /** The words of a label; the numbers it prints or spells go to the numbers, since a narration says them either way. */
  const read = (label: unknown) => {
    const text = str(label);
    out.numbers.push(...printedNumbers(text), ...spelledNumbers(wordsOf(text).map(fold)));
    return content(text).filter((w) => !isCardinal(fold(w)));
  };
  const label = (...labels: unknown[]) => out.core.push(...labels.flatMap(read));
  const named = (...labels: unknown[]) => out.items.push(...labels.flatMap(read));
  const values = (...numbers: unknown[]) =>
    out.numbers.push(...numbers.flatMap((n) => (typeof n === 'number' ? numberForms(n) : [])));
  const math = (latex: unknown, into: 'core' | 'sizes' = 'core') => {
    const terms = latexTerms(str(latex));
    out[into].push(...terms.core);
    out.items.push(...terms.items);
    // A dimension of 1 makes a vector: no narration is about it.
    out.numbers.push(...(into === 'sizes' ? terms.numbers.filter((n) => n !== '1') : terms.numbers));
  };
  label(item.title);
  switch (item.kind) {
    case 'formula':
      math(item.latex);
      for (const term of list(item.terms)) {
        math(term?.latex);
        label(term?.label);
      }
      break;
    case 'flow':
      label(...list(item.nodes).map((node) => node?.label));
      break;
    case 'bars':
      label(item.unit);
      named(...list(item.bars).map((bar) => bar?.label));
      values(...list(item.bars).map((bar) => bar?.value));
      break;
    case 'plot':
      label(
        item.x_label,
        item.y_label,
        ...list(item.curves).map((c) => c?.label),
        ...list(item.marks).map((m) => m?.label),
      );
      named(...list(item.points).map((point) => point?.label));
      break;
    case 'scene':
      for (const object of list(item.objects)) {
        if (object?.type === 'math' && object.text) math(object.text);
        else label(object?.text);
      }
      break;
    case 'heatmap':
      label(item.unit);
      named(...list(item.rows), ...list(item.cols));
      values(...list(item.values).flat());
      break;
    case 'scatter':
      label(item.x_label, item.y_label);
      named(...list(item.points).flatMap((p) => [p?.label, p?.series]));
      values(...list(item.points).flatMap((p) => [p?.x, p?.y]));
      break;
    case 'shapes':
      for (const term of list(item.terms)) {
        if (term?.kind === 'matrix') {
          math(term.name);
          for (const dimension of [term.rows, term.cols]) math(dimension, 'sizes');
        } else if (term?.op === 'apply') label(term.label);
      }
      break;
    case 'timeline':
      label(item.anchor?.label, ...list(item.events).map((e) => e?.label), ...list(item.spans).map((s) => s?.label));
      values(
        ...list(item.events).flatMap((e) => [e?.position, e?.offset, e?.at]),
        ...list(item.spans).flatMap((s) => [s?.start, s?.end, s?.length]),
      );
      break;
    case 'distribution':
      label(item.x_label);
      named(...list(item.dists).flatMap((d) => [d?.label, ...list(d?.categories)]));
      values(
        ...list(item.dists).flatMap((d) => [d?.mean, d?.sd, d?.min, d?.max, d?.n, d?.p, d?.rate, ...list(d?.counts)]),
      );
      break;
  }
  return out;
}

/** What the step stands on, besides its narration. */
export interface AgreementContext {
  /** The text it points at (its sentences, a figure's caption): a narration may paraphrase it, and a board may print it. */
  source?: string;
  /** What the repair turn is asked to do, for a call that has no "say" to change; the default is for a tour step. */
  repair?: string;
}

/** What a narration says. */
export interface Spoken {
  words: string[];
  numbers: Set<string>;
}

/**
 * The numbers a text prints, as a listener hears them: "1,024" and German "1.024" are 1024 (and, as decimals, 1.024), and
 * "0,5" is 0.5. A decimal comma is no thousands mark, so "0,5" is not also 5.
 */
function printedNumbers(text: string): string[] {
  const out: number[] = [];
  for (const [token] of text.matchAll(/\d+(?:[.,\u00a0\u202f]\d+)*/g)) {
    const parts = token.split(/[.,\u00a0\u202f]/);
    const grouped = parts.length > 1 && /^[1-9]\d{0,2}$/.test(parts[0]) && parts.slice(1).every((p) => p.length === 3);
    if (grouped) out.push(Number(parts.join('')));
    if (parts.length === 1) out.push(Number(token));
    else if (parts.length === 2) out.push(Number(`${parts[0]}.${parts[1]}`));
    else if (!grouped) out.push(...numbersIn(token));
  }
  return out.map(numberKey);
}

/** The words and numbers of a narration; Greek letters in it are named, and "F F N" read aloud is FFN. */
export function spokenTerms(say: string): Spoken {
  const text = say
    .replace(/\p{Script=Greek}/gu, (c) => ` ${GREEK_LETTER.get(c) ?? ''} `)
    .replace(/%/g, ' percent prozent ')
    .replace(/€/g, ' euro ')
    .replace(/\$/g, ' dollar ')
    .replace(/£/g, ' pound ');
  const all = wordsOf(text).map(fold);
  const words = content(text);
  let run = '';
  for (const word of [...all, '']) {
    if (word.length === 1 && /\p{L}/u.test(word)) run += word;
    else {
      if (run.length > 1) words.push(run);
      run = '';
    }
  }
  const numbers = new Set([...printedNumbers(text), ...spelledNumbers(all)]);
  return { words, numbers };
}

/**
 * Whether two words are one term: equal after stemming, one inside the other when it is a whole word of a compound
 * ("matrix", "Matrixprodukt"), sharing most of their start ("scale", "scaling"; "Eliminiere", "Eliminationsverfahren"),
 * or two names of one operation ("log", "Logarithmus"; "root", "Wurzel").
 */
export function sameTerm(a: string, b: string): boolean {
  const operation = operationOf(a);
  if (operation && operation === operationOf(b)) return true;
  const [x, y] = [keyOf(a), keyOf(b)];
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length < 3) return false;
  if (short.length >= 5 && long.includes(short)) return true;
  if (long.startsWith(short) && long.length <= short.length + 4) return true;
  if (short.length < 4) return false;
  let common = 0;
  while (common < short.length && short[common] === long[common]) common++;
  return common >= Math.max(4, Math.ceil(0.6 * short.length));
}

/** Whether a narration says a word of a board: the word itself, or a unit abbreviation spoken in full. */
const says = (spoken: Spoken, word: string) =>
  [word, ...(UNIT_FORMS[fold(word)] ?? [])].some((form) => spoken.words.some((w) => sameTerm(w, form)));

/** What of a board's own terms a narration says. Items and numbers only count when they are said. */
export interface Agreement {
  said: string[];
  unsaid: string[];
}

/** The board's words the narration says and leaves unsaid, with the items and numbers of the board that it says. */
export function agreement(say: string, item: BoardItem): Agreement {
  const board = boardTerms(item);
  const spoken = spokenTerms(say);
  const hears = (word: string) => says(spoken, word);
  const once = (words: string[]) => [
    ...new Map(words.filter((w) => !GENERIC.has(keyOf(w))).map((w) => [keyOf(w), w])).values(),
  ];
  const core = once(board.core);
  return {
    said: [
      ...core.filter(hears),
      ...once([...board.items, ...board.sizes]).filter(hears),
      ...new Set(board.numbers.filter((n) => spoken.numbers.has(n))),
    ],
    unsaid: core.filter((w) => !hears(w)),
  };
}

/** A narration with fewer content words than this says too little to judge. */
export const MIN_SPOKEN = 8;
/**
 * A board is judged by its own words (title, labels, names); with fewer, a paraphrase would look like a mismatch.
 * Calibrated on the boards of the saved tours of ten documents (papers, a lecture, exercise sheets, contracts, a
 * letter; English and German) and held out on those of the earlier rounds of the same documents: a board the
 * narration fits has a fifth to all of its words said, and a paraphrase that says none of them still shares a symbol,
 * a number or the sentences the step points at. So a board that names this many words, with none of them said (nor
 * one of its numbers, nor two of them in those sentences), has nothing to do with the narration.
 */
export const MIN_BOARD_WORDS = 3;

/** Only text in scripts that separate words can be judged by its words. */
const spaced = (say: string) => {
  const letters = say.match(/\p{L}/gu) ?? [];
  const known = letters.filter((c) => /\p{Script=Latin}|\p{Script=Cyrillic}|\p{Script=Greek}/u.test(c));
  return letters.length > 0 && known.length / letters.length >= 0.9;
};

/** The most words a problem names. */
const NAMED = 4;
const listed = (words: string[]) => `${words.slice(0, NAMED).join(', ')}${words.length > NAMED ? ', ...' : ''}`;
const titled = (item: BoardItem) => (item.title ? `"${item.title}": ` : '');
/** What the repair turn does about a board that does not show the step's point, and the way to a board that does. */
const REPAIR = `Keep this step's point: redraw the board so that it shows it, or leave the board out`;
const SAY_IT = `; if this board already shows the point, say its title, labels or symbols in "say"`;

/** With this many of its words printed in the text a step points at, a board is about that text, which a narration may paraphrase. */
export const MIN_SOURCED = 2;

/**
 * Why the narration is not about the board, as an instruction for the repair turn; empty when it fits or cannot be
 * judged.
 */
export function agreementProblems(say: string, item: BoardItem, context: AgreementContext = {}): string[] {
  if (!spaced(say) || spokenTerms(say).words.length < MIN_SPOKEN) return [];
  const { said, unsaid } = agreement(say, item);
  if (said.length > 0 || unsaid.length < MIN_BOARD_WORDS) return [];
  const printed = spokenTerms(context.source ?? '').words;
  if (unsaid.filter((word) => printed.some((w) => sameTerm(w, word))).length >= MIN_SOURCED) return [];
  return [
    `the narration never speaks of what this board shows (${titled(item)}${listed(unsaid)}), so the board and the narration are two different explanations. ${context.repair ?? `${REPAIR}${SAY_IT}`}`,
  ];
}

/**
 * The board's check, with the problem added when the narration is not about the board. A board that failed its own
 * checks is judged by what the model wrote, so that one repair turn names every fault (`raw` is its unchecked value).
 */
export function agreementCheck(
  check: BoardCheck,
  say: string,
  raw: { kind: BoardKind; value: unknown },
  context: AgreementContext = {},
): BoardCheck {
  const given = raw.value && typeof raw.value === 'object' ? ({ ...raw.value, kind: raw.kind } as BoardItem) : null;
  // No item and no problem is a model that drew nothing.
  const item = check.item ?? (check.problems.length ? given : null);
  const problems = item ? agreementProblems(say, item, context) : [];
  return problems.length ? { item: null, problems: [...check.problems, ...problems] } : check;
}
