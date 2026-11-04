import type { Unit } from './exercise';

// The voice of an exercise part (notes/TUTOR.md, "Flow"): a tutor at a whiteboard does not open every part with "Given ...,
// asked is ...", and does not say "exercise 3, part b" before every move. A weak model copies whatever its examples open
// with, so code holds the narration to it: a spoken field that opens with a templated opening or with a task label, and a
// later part that names its own task or part, are sent back for one repair turn. The checks cover the languages the
// harness reads (language.ts) and are light on purpose: they look at how a narration begins and at labels, never at what
// it explains. Two steps of a part in a row that open with the same word ("Wir ... Wir ...") are sent back too.

const END = String.raw`(?![\p{L}\p{N}])`;
const START = String.raw`^[\s"'“”„«»(\-–—]*`;
/** A lead-in word that does not change what the narration opens with ("So, given ..."). */
const LEAD = String.raw`(?:(?:so|well|okay|ok|now|here|first|also|nun|hier|dann|alors|donc|ici|entonces|aquí|allora|quindi|então|dus|nou)[,\s]+)?`;

/** "Given ...", "We are given ..." and their equivalents; the scripts without spaces need no word end. */
const GIVEN = [
  String.raw`(?:(?:we|you)(?:\s+are|\s+were|\s+have\s+been|['’]re)\s+given|given)${END}`,
  String.raw`(?:gegeben|gesucht\s+(?:ist|sind|wird))${END}`,
  String.raw`(?:(?:étant\s+)?donn(?:é|ée|és|ées)|on\s+nous\s+donne)${END}`,
  String.raw`(?:dad[oa]s?|se\s+nos\s+dan?|nos\s+dan?)${END}`,
  String.raw`(?:dat[oi]|dat[ae](?=\s+(?:una?|un['’]|la|le|l['’]|il|lo|i|gli)${END})|ci\s+(?:viene|vengono)\s+dat[oaie]|ci\s+(?:è|sono)\s+dat[oaie])${END}`,
  String.raw`(?:(?:é|são|nos\s+são)\s+dad[oa]s?|temos\s+dad[oa]s?)${END}`,
  String.raw`gegeven${END}`,
  String.raw`дан[оаы]?${END}`,
  String.raw`已知|给定|給定|题目给出|題目給出|与えられ|주어진|문제에서\s*주어|المعطى|المعطيات`,
].join('|');
const GIVEN_OPENING = new RegExp(`${START}${LEAD}(?:${GIVEN})`, 'iu');

/** The words that name a task of a sheet, and the words that name a part of one. */
const TASK_WORDS = [
  'exercises?|problems?|questions?|tasks?|assignments?',
  'aufgaben?|teilaufgaben?|übung(?:en)?|uebung(?:en)?|frage',
  'exercices?|problèmes?|tâches?',
  'ejercicios?|problemas?|preguntas?|tareas?',
  'esercizi[oa]?|problemi?|domand[ae]|compit[oi]',
  'exercícios?|exercicios?|questões|questão|tarefas?',
  'opgaven?|oefeningen?|oefening|vragen?|taken|taak',
  'задач[аиуе]|задани[ея]|упражнени[ея]|вопрос',
  '习题|练习|问题|問題|演習|문제|연습',
].join('|');
const PART_WORDS =
  'parts?|teil|teilaufgabe|aufgabenteil|parties?|partes?|apartados?|parti?|alíneas?|deel|delen|часть|部分';
/** Spoken numbers of the languages above (but never the articles "ein", "une" or "un", and not the pronoun "one"). */
const NUMBER_WORDS =
  'two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|eins|zwei|drei|vier|fünf|fuenf|sechs|sieben|acht|neun|zehn|elf|zwölf|zwoelf|deux|trois|quatre|cinq|sept|huit|neuf|dix|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|dois|três|sete|oito|dez|twee|drie|vijf|zes|zeven|negen|tien';
const COUNTED = String.raw`\s*(?:\d|(?:${NUMBER_WORDS})${END})`;
const PREPOSITION = String.raw`(?:(?:in|on|for|at|to|with|about|bei|zu|zur|zum|im|dans|pour|en|para|nel|nella|per|em|na|no|bij|voor|в|во)\s+)?(?:(?:the|der|die|das|dem|den|le|la|el|il|lo|los|las|a|o|het|de)\s+|(?:l|nell|dell|all)['’]\s*)?`;

/** A narration that opens with a task or part label: "In exercise 3, ...", "Aufgabe 4.2 b ...", "Part b asks ...". */
const LABEL_OPENING = new RegExp(
  `${START}${LEAD}${PREPOSITION}(?:(?:${TASK_WORDS})${COUNTED}|(?:${TASK_WORDS}|${PART_WORDS})(?![\\p{L}])\\s*\\(?[a-z]\\)?${END}|(?:${PART_WORDS})${COUNTED}|第\\s*(?:\\d+|[一二三四五六七八九十]+)\\s*[题題问問])`,
  'iu',
);

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The task labels of a narration ("exercise 3", "Aufgabe vier"), and the part's own label when it is given ("part b"). */
function labelsIn(say: string, label?: string): string[] {
  const own = label
    ? String.raw`|(?<![\p{L}\p{N}])(?:${PART_WORDS})\s*\(?${escape(label)}\)?${END}|${START}\(?${escape(label)}\)\s`
    : '';
  const pattern = new RegExp(String.raw`(?<![\p{L}\p{N}])(?:${TASK_WORDS})${COUNTED}${own}`, 'giu');
  return [...say.matchAll(pattern)].map((m) => m[0].trim());
}

/** A spoken field of a part: its name for the repair turn, its narration, and whether it also may not open with "Given". */
export interface Spoken {
  name: string;
  say: string;
  /** A field that sets the scene or starts a move: it may not open with "Given ..." either. */
  opens: boolean;
}

/** The word a narration opens with, lower case, without punctuation. */
const openingWord = (say: string) => (say.match(/[\p{L}\p{N}]+/u)?.[0] ?? '').toLocaleLowerCase();

/** The first words of a narration, as the repair turn quotes them. */
const head = (say: string) => `"${say.split(/\s+/).slice(0, 5).join(' ')}"`;

/** Whether a narration opens with a templated opening (`opens`) or with a task or part label. */
export const opensTemplated = (say: string, opens = true) =>
  (opens && GIVEN_OPENING.test(say)) || LABEL_OPENING.test(say);

/**
 * What is wrong with how a part speaks, as instructions for one repair turn; empty when it speaks freely. A part that
 * goes on from an earlier one may not name its task or part at all, and the first part of a task names it once at most.
 */
export function voiceProblems(fields: Spoken[], unit: Pick<Unit, 'part'>, entry: boolean): string[] {
  const problems = fields
    .filter(({ say, opens }) => opensTemplated(say, opens))
    .map(
      ({ name, say }) =>
        `${name} opens with ${head(say)}: no template; start with the situation or the question in your own words`,
    );
  // Steps in a row that open with the same word: the moves of a part do not all begin alike.
  const steps = fields.filter(({ name }) => /^step \d+$/.test(name));
  const same = (a: string, b: string) => openingWord(a).length > 1 && openingWord(a) === openingWord(b);
  const twice = steps.find(({ say }, i) => i > 0 && same(say, steps[i - 1].say));
  if (twice)
    problems.push(
      `${twice.name} and the step before it both open with "${openingWord(twice.say)}": vary how the steps begin`,
    );
  const named = fields.map(({ name, say }) => ({ name, labels: labelsIn(say, unit.part?.label) }));
  const count = named.reduce((n, { labels }) => n + labels.length, 0);
  if (!entry)
    for (const { name, labels } of named)
      if (labels.length)
        problems.push(`${name} names its task or part ("${labels[0]}"): this part goes on from the part before, say no number`);
  if (entry && count > 1)
    problems.push(`${named.find((n) => n.labels.length)!.name} names the task or part again: say the number once at most`);
  return problems;
}
