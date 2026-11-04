import type { Action, BBox, Doc, Region, Step } from '../../../shared/paper';

const words = (s: string) =>
  s
    .normalize('NFKC')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
const normalized = (s: string) => words(s).join(' ');

/**
 * The most spoken words an overview step runs to; longer explanations lose the learner (TUTOR-RESEARCH 4.8, item 15).
 * The direction task, the response schema and the length repair all take it from here (direct.ts sayWords): a detail
 * step (a worked case), a claim's move or a slide brings its own range and is held to that.
 */
export const STEP_MAX_WORDS = 60;

/** Words and phrases as they stand alone: not inside another word, nor after an apostrophe (l'illustration). */
const phrases = (...sources: string[]) =>
  new RegExp(`(?<![\\p{L}\\p{N}'])(?:${sources.join('|')})(?![\\p{L}\\p{N}])`, 'giu');

/**
 * Narration about the tour's own pictures instead of the subject, in English, German, French, Spanish and Italian. The
 * nouns are the tour's visuals (illustration, diagram, chart); a figure or table is the paper's own subject and stays
 * unflagged. The board has its own list (BOARD_TALK), since a step without a board may mean a board of directors.
 */
const VISUAL_TALK = phrases(
  // English
  String.raw`(?:the|this|that|our|these|those|the following|the above|the animated)\s+(?:illustration|diagram|chart|animation|visuali[sz]ation|sketch|graphic)s?\s+(?:shows?|illustrates?|depicts?|demonstrates?)`,
  String.raw`as\s+(?:shown|seen|displayed|illustrated|depicted)\s+(?:on|in|by)\s+the\s+(?:illustration|diagram|chart|animation|picture|visuali[sz]ation)`,
  String.raw`as\s+(?:you|we)\s+can\s+see`,
  String.raw`this\s+(?:illustrative|illustrated)\s+(?:example|case|scenario)`,
  String.raw`in\s+this\s+step,?\s+(?:we|you|i|let(?:'s|\s+us))`,
  String.raw`let(?:'s|\s+us)\s+(?:now\s+|next\s+|first\s+|briefly\s+)?(?:take\s+a\s+|have\s+a\s+)?look\s+at`,
  // German
  String.raw`(?:die|diese|das|dieses|der|dieser|unsere?)\s+(?:illustration|diagramm|grafik|skizze|animation|schaubild|visualisierung)\s+(?:zeigt|zeigen|veranschaulicht|illustriert)`,
  // "wie sie sehen" alone may be "how they see", so the formal form (FORMAL) needs a capital and the others a verb.
  String.raw`wie\s+(?:ihr\s+seht|du\s+siehst|man\s+(?:hier\s+)?sieht)`,
  String.raw`wie\s+(?:hier\s+|oben\s+|unten\s+)?(?:im\s+diagramm|in\s+der\s+illustration)\s+zu\s+sehen`,
  String.raw`in\s+diesem\s+schritt,?\s+(?:\p{L}+\s+)?(?:wir|du|ihr)`,
  String.raw`(?:schauen|sehen)\s+wir\s+uns|werfen\s+wir\s+einen\s+blick`,
  String.raw`dies\p{L}*\s+illustrativ\p{L}*\s+(?:beispiel|fall|szenario)`,
  // French
  String.raw`(?:l'|la\s+|le\s+|cette\s+|ce\s+|notre\s+)(?:illustration|schéma|diagramme|graphique|animation|visualisation)\s+(?:montre|montrent|illustre|représente)`,
  String.raw`comme\s+(?:vous\s+(?:pouvez\s+(?:le\s+)?voir|le\s+voyez|voyez)|on\s+(?:peut\s+(?:le\s+)?voir|le\s+voit|voit)|tu\s+(?:peux\s+(?:le\s+)?voir|le\s+vois|vois))`,
  String.raw`dans\s+cette\s+étape,?\s+(?:nous|on|je|\p{L}+ons)`,
  String.raw`regardons|jetons\s+un\s+(?:coup\s+d'œil|œil|oeil)`,
  String.raw`(?:cet\s+exemple|ce\s+cas)\s+illustratif`,
  // Spanish
  String.raw`(?:la|esta|el|este|nuestra|nuestro)\s+(?:ilustración|diagrama|gráfico|gráfica|animación|esquema|visualización)\s+(?:muestra|ilustra|representa)`,
  String.raw`como\s+(?:(?:puedes|puede|pueden|podemos|se\s+puede)\s+ver|ves|vemos|se\s+ve)`,
  String.raw`en\s+este\s+paso,?\s+(?:vamos|veremos|\p{L}+mos)`,
  String.raw`veamos|echemos\s+un\s+vistazo|miremos`,
  String.raw`(?:este|ese)\s+(?:ejemplo|caso)\s+ilustrativo`,
  // Italian
  String.raw`(?:l'|la\s+|il\s+|lo\s+|questa\s+|questo\s+|nostra\s+|nostro\s+)(?:illustrazione|diagramma|grafico|animazione|schema|visualizzazione)\s+(?:mostra|illustra|rappresenta)`,
  String.raw`come\s+(?:(?:puoi|potete|possiamo)\s+vedere|si\s+(?:può\s+vedere|vede))`,
  String.raw`in\s+questo\s+(?:passaggio|passo),?\s+(?:noi|\p{L}+iamo)`,
  String.raw`guardiamo|diamo\s+un'occhiata`,
  String.raw`questo\s+(?:esempio|caso)\s+illustrativo`,
);

/**
 * Talk about the step's own board. Only a step that draws a board is held to it: in one without, "the board shows strong
 * support for the merger" is about a board of directors, and a blackboard is a blackboard.
 */
const BOARD_TALK = phrases(
  String.raw`(?:the|this|that|our|these|those|the following|the above|the animated)\s+boards?\s+(?:shows?|illustrates?|depicts?|demonstrates?)`,
  String.raw`as\s+(?:shown|seen|displayed|illustrated|depicted)\s+(?:on|in|by)\s+the\s+board`,
  String.raw`(?:die|diese|das|dieses|der|dieser|unsere?)\s+tafel\s+(?:zeigt|zeigen|veranschaulicht|illustriert)`,
  String.raw`wie\s+(?:hier\s+|oben\s+|unten\s+)?auf\s+der\s+tafel\s+zu\s+sehen`,
  String.raw`(?:la|esta|nuestra)\s+pizarra\s+(?:muestra|ilustra|representa)`,
  String.raw`(?:la|questa|nostra)\s+lavagna\s+(?:mostra|illustra|rappresenta)`,
);

/**
 * The formal German "Sie", which only a capital tells from "sie" (they, it): "wie sie sehen lernen" and "in diesem
 * Schritt werden sie addiert" are subject matter. Case-sensitive, so it has its own list.
 */
const FORMAL = new RegExp(
  `(?<![\\p{L}\\p{N}'])(?:${[
    String.raw`[Ww]ie\s+Sie\s+(?:(?:hier|dort)\s+sehen(?:\s+k(?:ö|oe)nnen)?|sehen\s+k(?:ö|oe)nnen)`,
    String.raw`[Ii]n\s+diesem\s+Schritt,?\s+(?:\p{L}+\s+)?Sie`,
  ].join('|')})(?![\\p{L}\\p{N}])`,
  'gu',
);

/**
 * Condescending fillers: they claim the point is easy and put the learner who finds it hard on display. "clearly" and
 * "simply" are also ordinary words ("clearly defined", "simply connected"), so they have their own tests below. "Easy"
 * stands only where it says the point is plain to see ("es fácil que" means "it is likely that"), and an idiom of its own
 * stays out: a change of course, as a matter of course, a claim manifestly unfounded ("offensichtlich unbegründet").
 */
const FILLERS = phrases(
  String.raw`obviously|trivially|(?<!\b(?:change|matter|reversal)\s+)of\s+course|(?:it(?:'s|\s+is)|is|are)\s+easy\s+to\s+see|it(?:'s|\s+is)\s+(?:obvious|trivial)\s+(?:that|to)`,
  String.raw`offensichtlich(?!\s+un\p{L}+)|einfach\s+nur|trivialerweise|natürlich\s+ist|selbstverständlich`,
  String.raw`évidemment|bien\s+sûr|il\s+est\s+(?:facile\s+de\s+voir|(?:évident|trivial)\s+(?:de\s+voir|que))|trivialement|tout\s+simplement`,
  String.raw`obviamente|por\s+supuesto|es\s+(?:fácil\s+ver|(?:obvio|trivial)\s+(?:ver|que))|trivialmente|simplemente(?!\s+conex[oa])`,
  String.raw`ovviamente|è\s+(?:facile\s+vedere|(?:ovvio|banale)\s+(?:vedere|che))|banalmente|semplicemente(?!\s+conness[oa])`,
);

/** What turns a filler into its opposite: "not obviously tight", "nicht offensichtlich", "no es simplemente", "non è ovvio". */
const NEGATED =
  /(?<![\p{L}\p{N}'])(?:not|never|nicht|nie|pas|(?:no|non)(?:\s+(?:es|son|está|están|fue|è|sono|era|erano))?)\s+$|n't\s+$/iu;

/** A sentence-opening "Clearly, ..." or a parenthetical ", clearly, ..."; the manner "explained clearly" stays. */
const CLEARLY = /^clearly(?:\s*,|\s+(?:the|this|that|it|we|you|there|these|those)(?![\p{L}\p{N}]))|,\s*clearly\s*,/iu;

/** Terms in which "simply" is part of the subject: simply connected, simply supported, simply typed. */
const SIMPLY_TERM =
  /^[\s-]+(?:connected|supported|typed|laced|transitive|ordered|periodic|reducible)(?![\p{L}\p{N}])/iu;

/** "Simply" as a filler: an adverb before a verb, not the term, a contrast ("not simply a lookup") or a name. */
function simplyFiller(text: string): string | null {
  for (const match of text.matchAll(/(?<![\p{L}\p{N}])simply(?![\p{L}\p{N}])/giu)) {
    const before = text.slice(0, match.index),
      after = text.slice(match.index + match[0].length);
    if (SIMPLY_TERM.test(after) || /(?:not|than|but|never|n't)\s+$/iu.test(before)) continue;
    // A name: capitalised in mid-sentence, after a title, or at the start of a sentence before another capitalised word.
    const opens = /(?:^|[.!?:]\s+)$/u.test(before) && !/\b(?:dr|prof|mr|mrs|ms)\.\s+$/iu.test(before);
    const capital = match[0][0] !== match[0][0].toLocaleLowerCase();
    if (capital && (!opens || /^\s+\p{Lu}/u.test(after))) continue;
    return match[0].toLocaleLowerCase();
  }
  return null;
}

/**
 * Empty comprehension checks, which test nobody: the learner asks when something is unclear. Each is tied to its question
 * mark, since the same words state a fact ("ist alles klar geregelt", "lässt noch Fragen offen", "si tiene alguna
 * pregunta, contacte", "il contratto rende tutto chiaro").
 */
const CHECKS = phrases(
  String.raw`do\s+you\s+(?:all\s+)?(?:understand|get\s+(?:it|this|that)|follow\s+(?:me|so\s+far))|have\s+you\s+understood|does\s+(?:that|this|it)\s+make\s+sense|(?:is|was)\s+(?:that|this|it)\s+(?:all\s+)?clear\s*\?|any\s+questions\s*\?`,
  String.raw`alles\s+klar\s*[?!]|verstanden\s*\?|ist\s+(?:das|dies)\s+klar\s*\?|noch\s+fragen\s*\?|gibt\s+es\s+(?:noch\s+)?fragen\s*\?|irgendwelche\s+fragen\s*\?`,
  String.raw`c'est\s+clair\s*\?|est-ce\s+(?:que\s+c'est\s+)?clair|(?:avez-vous|as-tu)\s+(?:bien\s+)?compris|vous\s+(?:me\s+)?suivez\s*\?|(?:avez-vous|y\s+a-t-il)\s+des\s+questions|des\s+questions\s*\?`,
  String.raw`(?:está|queda)\s+claro\s*\?|entendido\s*\?|alguna\s+pregunta\s*\?|hay\s+(?:alguna\s+)?preguntas?\s*\?|(?:me\s+(?:entienden|siguen)|lo\s+entiendes)\s*\?`,
  String.raw`è\s+chiaro\s*\?|tutto\s+chiaro\s*\?|capito\s*\?|avete\s+capito\s*\?|ci\s+sono\s+domande\s*\?|domande\s*\?`,
);

/** A sentence that opens with "Any questions" and asks it is the check, also when it goes on ("Any questions about the fee?"). */
const OPENING_CHECK = /^(?:are\s+there\s+)?any\s+questions(?![\p{L}\p{N}])[^.!?]*\?$/iu;

/** The distinct phrases a pattern finds, as the repair feedback quotes them. */
function found(text: string, pattern: RegExp): string[] {
  return [...new Set([...text.matchAll(pattern)].map((m) => m[0].toLocaleLowerCase().replace(/\s+/g, ' ').trim()))];
}
const quoted = (list: string[]) =>
  list
    .slice(0, 3)
    .map((phrase) => `"${phrase}"`)
    .join(', ');

/** The fillers a text uses, not those it denies ("not obviously tight"): the distinct phrases, as the feedback quotes them. */
function fillersIn(text: string): string[] {
  const phrasesFound = new Set<string>();
  for (const match of text.matchAll(FILLERS))
    if (!NEGATED.test(text.slice(0, match.index)))
      phrasesFound.add(match[0].toLocaleLowerCase().replace(/\s+/g, ' ').trim());
  return [...phrasesFound];
}

/**
 * The tour-style problems of a narration, as repair feedback: its own pictures, condescending fillers and empty
 * comprehension checks. They are style points, asked to be fixed once and never a reason to refuse a step or an answer
 * (see styleProblems' callers). `board` is whether the step draws a board: only then is "the board shows" tour talk.
 */
export function styleProblems(say: string, board = true): string[] {
  const text = say.normalize('NFKC').replace(/[‘’ʼ`´]/g, "'");
  const problems: string[] = [];
  const visuals = [
    ...new Set([...found(text, VISUAL_TALK), ...(board ? found(text, BOARD_TALK) : []), ...found(text, FORMAL)]),
  ];
  if (visuals.length)
    problems.push(
      `Narration talks about the tour's own pictures (${quoted(visuals)}). Speak about the subject itself and let the marks and the board show it; never announce or describe a visual.`,
    );
  const fillers = fillersIn(text);
  const sentences = text.split(/(?<=[.!?])\s+/);
  if (sentences.some((sentence) => CLEARLY.test(sentence.trim()))) fillers.push('clearly');
  const simply = simplyFiller(text);
  if (simply) fillers.push(simply);
  if (fillers.length)
    problems.push(
      `Narration uses a condescending filler (${quoted(fillers)}). Drop it and state the point; nobody is put on display.`,
    );
  const checks = found(text, CHECKS);
  if (!checks.some((check) => check.startsWith('any questions')) && sentences.some((s) => OPENING_CHECK.test(s.trim())))
    checks.push('any questions');
  if (checks.length)
    problems.push(
      `Narration asks an empty comprehension check (${quoted(checks)}). Drop it and say the point; the learner asks when something is unclear.`,
    );
  return problems;
}

/**
 * Detect decoder padding without banning multilingual joiners, actual numbers, or mathematical notation. Return repair
 * feedback; never silently trim say. Only these corruption checks refuse a narration. The tour-style points
 * (styleProblems) are asked for once, apart from this, and the length is the direction's own repair (direct.ts
 * lengthProblems): a style point or a long step must not fail a tour or an answer that is otherwise usable.
 */
export function narrationProblems(say: string): string[] {
  const problems: string[] = [];
  if (/\p{Cf}{8,}/u.test(say))
    problems.push(
      'Narration contains a long run of invisible formatting characters. Rewrite clean spoken prose without padding; normal language-specific joiners are allowed.',
    );
  if (/\s{64,}/u.test(say))
    problems.push(
      'Narration contains a long whitespace padding run. Return the complete explanation with ordinary spacing; do not fill the character limit.',
    );
  // Observed constrained-decoding failure: a complete sentence followed by many
  // long near-constant integers. Decimal expansions, equations and patterned
  // binary examples do not meet this combined suffix/repetition condition.
  const suffix = /[.!?。！？]\s+([\d\s]{80,})\s*$/u.exec(say)?.[1];
  if (suffix) {
    const runs = suffix.match(/\d{12,}/g) ?? [];
    const repetitive = runs.filter((run) => {
      const frequency = new Map<string, number>();
      for (const digit of run) frequency.set(digit, (frequency.get(digit) ?? 0) + 1);
      return /(\d)\1{7,}/u.test(run) && Math.max(...frequency.values()) / run.length >= 0.75;
    });
    if (repetitive.length >= 3 && repetitive.reduce((n, run) => n + run.length, 0) >= 60)
      problems.push(
        'Narration ends in repeated digit filler after its explanation. Rewrite the explanation without padding; keep only meaningful numerical values with their interpretation.',
      );
  }
  return problems;
}

/** Near-verbatim detail steps add length without teaching another idea. */
export function repeatsExplanation(detail: string, overview: string): boolean {
  const a = words(detail),
    b = words(overview);
  if (Math.min(a.length, b.length) < 12) return normalized(detail) === normalized(overview);
  const grams = (w: string[], n: number) => w.slice(0, 1 - n).map((_, i) => w.slice(i, i + n).join(' '));
  const overlap = (n: number) => {
    const left = grams(a, n),
      right = new Set(grams(b, n));
    return left.filter((g) => right.has(g)).length / Math.max(1, left.length);
  };
  return overlap(3) >= 0.45 || overlap(2) >= 0.65;
}

/** Find copied wording from known internal constraints, not generic words such
 * as "JSON" or "animation" that may be legitimate subject matter. Callers must
 * supply only non-spoken authoring instructions, never source text, examples,
 * or desired narration from the rest of the prompt.
 */
function copiedAuthoringPhrase(say: string, instructions: readonly string[]): string | null {
  const spoken = ` ${normalized(say)} `;
  for (const instruction of instructions) {
    const tokens = words(instruction);
    // Short commands only match in full. Longer constraints can be copied with
    // a changed introductory clause, so look for an exact eight-word phrase.
    if (tokens.length < 5) continue;
    const size = Math.min(8, tokens.length);
    for (let i = 0; i <= tokens.length - size; i++) {
      const phrase = tokens.slice(i, i + size).join(' ');
      if (spoken.includes(` ${phrase} `)) return phrase;
    }
  }
  return null;
}

/** Only direct viewer instructions promise a visual here. Ordinary discussion
 * of video models or a figure in the paper is not a rendering requirement. */
function promisedVisual(say: string): 'video' | 'illustration' | null {
  const noun = '(animation|illustration|video|clip|veranschaulichung)';
  const english = new RegExp(
    `(?:^|[.!?]\\s+)(?:(?:now|next|please|then)\\s+)?(?:watch|look at|observe)\\s+(?:the|this|our)\\s+(?:(?:short|following|animated)\\s+)?${noun}\\b`,
    'giu',
  );
  const german = new RegExp(
    `(?:^|[.!?]\\s+)(?:(?:jetzt|nun|bitte)\\s+)?(?:(?:schau|schaue|sieh|betrachte|beobachte)(?:\\s+dir)?|(?:sehen|schauen|betrachten|beobachten)\\s+sie(?:\\s+sich)?)\\s+(?:die|diese|das|dieses|den|diesen)\\s+(?:(?:kurze[n]?|folgende[n]?)\\s+)?${noun}\\b`,
    'giu',
  );
  const nouns = [...say.matchAll(english), ...say.matchAll(german)]
    .filter((match) => {
      const illustration = ['illustration', 'veranschaulichung'].includes(match[1].toLocaleLowerCase());
      const after = say.slice((match.index ?? 0) + match[0].length);
      const sourceFigure =
        /^\s+(?:(?:in|from)\s+(?:(?:the|this)\s+)?(?:paper|document|article|figure|fig\b)|im\s+(?:paper|dokument|artikel)|in\s+(?:der|dieser)\s+abbildung)\b/iu.test(
          after,
        );
      return !(illustration && sourceFigure);
    })
    .map((match) => match[1].toLocaleLowerCase());
  if (nouns.some((value) => ['video', 'clip'].includes(value))) return 'video';
  return nouns.length ? 'illustration' : null;
}

/**
 * The tour-style points of an answer's steps (styleProblems), as repair feedback, from step `from` (0-based) on: the
 * steps before it were spoken already. Apart from answerNarrationProblems: a style point is asked for once and the
 * answer is accepted whatever the reply, so it never holds back a streamed step.
 */
export function answerStyleProblems(
  steps: readonly { say: string; actions?: readonly Action[] }[],
  from = 0,
): string[] {
  return steps.flatMap((step, index) =>
    index < from
      ? []
      : styleProblems(
          step.say,
          (step.actions ?? []).some((action) => action.type === 'board'),
        ).map((problem) => `Step ${index + 1}: ${problem}`),
  );
}

/** Actionable repair feedback; never silently delete or rewrite the narration.
 * Keep native visuals alongside the explanation that needs them; do not repeat
 * an explanation just to introduce a separate visual step. An answer step has no
 * word count here: the answer already cuts a step at 100 words. Only what makes a
 * step unusable is here; its style is answerStyleProblems.
 */
export function answerNarrationProblems(
  steps: readonly { say: string; actions?: readonly Action[] }[],
  authoringInstructions: readonly string[],
): string[] {
  const problems: string[] = [];
  steps.forEach((step, index) => {
    problems.push(...narrationProblems(step.say).map((problem) => `Step ${index + 1}: ${problem}`));
    const copied = copiedAuthoringPhrase(step.say, authoringInstructions);
    if (copied)
      problems.push(
        `Step ${index + 1} copies an internal authoring instruction ("${copied}"). Rewrite its narration for the learner; keep schema and rendering decisions in the structured fields, not in say.`,
      );
    const promised = promisedVisual(step.say);
    const provided = promised === 'illustration' && (step.actions ?? []).some((action) => action.type === 'board');
    if (promised && !provided)
      problems.push(
        `Step ${index + 1} tells the learner to watch ${promised === 'video' ? 'a video/clip' : 'an illustration'}, but this same step has no ${promised === 'video' ? 'video (this reader uses native visual boards)' : 'visual board'}. Use a native visual in this step, or remove the unsupported viewing promise and explain the idea directly. A visual in a different step does not satisfy this promise.`,
      );
    if (!words(step.say).length) return;
    const earlier = steps
      .slice(0, index)
      .findIndex((previous) => words(previous.say).length > 0 && repeatsExplanation(step.say, previous.say));
    if (earlier >= 0)
      problems.push(
        `Step ${index + 1} substantially repeats step ${earlier + 1}. Combine their useful visuals with one explanation, or give the later step a genuinely new worked example or consequence; do not narrate the same explanation twice.`,
      );
  });
  return problems;
}

/** Extracted labels inside the graphic, plus its caption. No OCR or document-specific vocabulary. */
export function printedAt(doc: Doc, target: string, region?: Region): string {
  const figure = doc.figures.find((f) => f.id === target || f.panels.some((p) => p.id === target));
  if (!figure) return '';
  const panel = figure.panels.find((p) => p.id === target);
  const box = panel?.bbox ?? figure.bbox;
  const [x0, y0, x1, y1] = box;
  const area: BBox = region
    ? [x0 + region[0] * (x1 - x0), y0 + region[1] * (y1 - y0), x0 + region[2] * (x1 - x0), y0 + region[3] * (y1 - y0)]
    : box;
  const inside = (b: BBox) =>
    (b[0] + b[2]) / 2 >= area[0] &&
    (b[0] + b[2]) / 2 <= area[2] &&
    (b[1] + b[3]) / 2 >= area[1] &&
    (b[1] + b[3]) / 2 <= area[3];
  return [
    figure.caption,
    panel?.label ?? '',
    ...doc.blocks.filter((b) => b.page === figure.page && inside(b.bbox)).map((b) => b.text),
  ].join('\n');
}

export function repeatsPrinted(label: string, printed: string): boolean {
  const a = normalized(label),
    b = normalized(printed);
  if (!a || !b) return false;
  return ` ${b} `.includes(` ${a} `);
}

/** Function words of the document languages (see language.ts), which every text uses and which say nothing. */
export const STOP_WORDS = new Set(
  `a about above after again all also am an and any are as at be because been before being below between both but by
  can could did do does doing down during each few for from further had has have having he her here hers him his how i
  if in into is it its itself just me more most my no nor not now of off on once only or other our out over own same she
  should so some such than that the their them then there these they this those through to too under until up very was
  we were what when where which while who whom why will with would you your
  der die das den dem des ein eine einer einem und oder ist sind wird werden für mit auf von zu im nicht auch sich als
  bei diese dieses kann müssen sie wir es er aber wie noch nur durch nach aus um
  le la les un une des et ou est sont pour avec sur du de dans pas aussi cette ce qui que il elle ils
  el los las una y o es son para con en del también este esta se por
  il lo gli e sono per con su di non anche questo questa che si
  os as um uma são em do da também
  het de een en of zijn voor met op van naar niet ook deze dit worden`.split(/\s+/),
);
/** Light stemming: a plural or verb ending s goes, so "keys" and "key" match. */
export const stem = (word: string) =>
  word.length > 4 && word.endsWith('ies')
    ? `${word.slice(0, -3)}y`
    : word.length > 3 && word.endsWith('s') && !/(?:ss|us|is)$/.test(word)
      ? word.slice(0, -1)
      : word;
/** The words that carry a text's content: lowercased, without function words and single characters, lightly stemmed. */
const contentWords = (text: string) =>
  words(text)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w))
    .map(stem);

/** Fewer content words than this say too little to judge. */
const MIN_CONTENT_WORDS = 12;
/**
 * A step that mostly restates the sentences it highlights. The share is how many of the narration's content words the
 * highlighted text also uses. Calibrated on the 28 steps with highlighted sentences in three real tours of one paper
 * (one standard and two deep runs). The seven steps at 0.50 to 0.81 reword their sentences nearly word for word. The
 * six between 0.44 and 0.49 are mixed: a reworded claim plus a comparison or a consequence. The fifteen below 0.44
 * explain (a cause, how it works, what it means), down to 0.09. Half flags the clear restatements and leaves the mixed
 * steps alone.
 */
export const RESTATEMENT_SHARE = 0.5;

/** How much of the narration is already in the highlighted sentences, from 0 to 1; 0 when there is too little to judge. */
export function restatedShare(say: string, highlighted: readonly string[]): number {
  const spoken = contentWords(say);
  if (spoken.length < MIN_CONTENT_WORDS) return 0;
  const source = new Set(highlighted.flatMap(contentWords));
  return spoken.filter((word) => source.has(word)).length / spoken.length;
}

/** The learner can read the highlighted sentences, so narration that mostly repeats them adds nothing; repaired once. */
export function restatesHighlights(say: string, highlighted: readonly string[]): boolean {
  return restatedShare(say, highlighted) >= RESTATEMENT_SHARE;
}

/** The repair turn for a step that restates what it highlights. */
export const RESTATEMENT_REPAIR =
  'This mostly restates the highlighted sentences, which the learner can read. Lead with the point, then explain why it holds or how it works, in your own words.';

/** A long almost-verbatim reading of the source is repaired once, like an invalid board. */
export function readsSource(say: string, doc: Doc): boolean {
  const spoken = words(say);
  if (spoken.length < 16) return false;
  const source = new Set(
    doc.sentences.flatMap((s) => {
      const w = words(s.text);
      return w.slice(0, -3).map((_, i) => w.slice(i, i + 4).join(' '));
    }),
  );
  const copied = spoken.slice(0, -3).filter((_, i) => source.has(spoken.slice(i, i + 4).join(' '))).length;
  return copied / (spoken.length - 3) >= 0.8;
}

/** The most highlights one step shows. More compete with each other and with the narration. */
export const MAX_HIGHLIGHTS = 3;
/** The most pen marks (arrow, circle) one step draws. */
export const MAX_PEN_MARKS = 2;

/**
 * The sentences a box or a spotlight already points at in the step: its own target, or every sentence of the block it
 * outlines when it names no region (a region marks only part of the block).
 */
function outlined(actions: readonly Action[], doc: Doc): Set<string> {
  const covered = new Set<string>();
  for (const action of actions) {
    if (action.type !== 'box' && action.type !== 'spotlight') continue;
    if (doc.sentences.some((s) => s.id === action.target)) covered.add(action.target);
    else if (!action.region)
      for (const id of doc.blocks.find((b) => b.id === action.target)?.sentences ?? []) covered.add(id);
  }
  return covered;
}

/**
 * Marks that help understanding instead of cluttering it. A highlight names a sentence once, and not one that a box or
 * spotlight in the step already points at; a step keeps at most MAX_HIGHLIGHTS highlights and MAX_PEN_MARKS pen marks.
 * The marks whose words come first stay.
 */
function declutter(actions: Action[], doc: Doc): Action[] {
  const covered = outlined(actions, doc);
  const order = actions.map((_, i) => i).sort((a, b) => (actions[a].at_word ?? 0) - (actions[b].at_word ?? 0) || a - b);
  const remove = new Set<number>();
  const narrowed = new Map<number, string[]>();
  const named = new Set<string>();
  let highlights = 0,
    pens = 0;
  for (const i of order) {
    const action = actions[i];
    if (action.type === 'highlight') {
      const fresh = [...new Set(action.targets)].filter((id) => !named.has(id) && !covered.has(id));
      if (!fresh.length || highlights >= MAX_HIGHLIGHTS) remove.add(i);
      else {
        highlights++;
        for (const id of fresh) named.add(id);
        if (fresh.length !== action.targets.length) narrowed.set(i, fresh);
      }
    } else if (action.type === 'arrow' || action.type === 'circle') {
      if (pens >= MAX_PEN_MARKS) remove.add(i);
      else pens++;
    }
  }
  if (!remove.size && !narrowed.size) return actions;
  return actions.flatMap((action, i): Action[] => {
    if (remove.has(i)) return [];
    const targets = narrowed.get(i);
    return targets && action.type === 'highlight' ? [{ ...action, targets }] : [action];
  });
}

/** Shared final guard for authored tours and Q&A: a mark can stay useful without repeating its printed name. */
export function insightStep(step: Step, doc: Doc): Step {
  const actions = step.actions.flatMap((a): Action[] => {
    if (a.type === 'spotlight') {
      const sentence = doc.sentences.find((s) => s.id === a.target);
      const block = doc.blocks.find((b) => b.id === a.target);
      const targets = sentence ? [sentence.id] : (block?.sentences ?? []);
      if (targets.length)
        return [
          { type: 'highlight', targets, color: 'blue', ...(a.at_word !== undefined ? { at_word: a.at_word } : {}) },
        ];
    }
    if (
      (a.type === 'arrow' || a.type === 'circle' || a.type === 'box') &&
      a.label &&
      repeatsPrinted(a.label, printedAt(doc, a.target, a.region))
    ) {
      const { label: _label, ...mark } = a;
      return [mark];
    }
    return [a];
  });
  return { ...step, actions: declutter(actions, doc) };
}
