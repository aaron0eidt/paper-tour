import type { Doc } from '../../../shared/paper';
import { documentLanguage } from '../harness/language';

/**
 * What Muse Voice Transcribe accepts besides the audio (https://dev.meta.ai/docs/speech-to-text): `keywords`, terms the
 * model might mishear, and `languageBias`, language names from its 25 supported ones. The docs state no limits for
 * either, so the list stays modest and the request falls back to none when the provider rejects it
 * (ai/transcription.ts).
 */
export interface VoiceHints {
  keywords: string[];
  languageBias: string[];
}
export const MAX_KEYWORDS = 40;
const MAX_KEYWORD_CHARS = 40;

/** Language names as the API spells them, by primary language subtag; Ukrainian and Russian are not among them. */
const LANGUAGE_NAMES: Record<string, string> = {
  ar: 'Arabic',
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  nl: 'Dutch',
  pt: 'Portuguese',
  tr: 'Turkish',
  zh: 'Mandarin Chinese',
};
/** The language to expect, from a code such as de-DE; empty when the recogniser has no such language. */
export function languageBias(code: string): string[] {
  const name = LANGUAGE_NAMES[code.split(/[-_]/)[0].toLowerCase()];
  return name ? [name] : [];
}

/** A request body's hints as the API takes them: strings only, trimmed, bounded in number and length, no duplicates. */
export function cleanHints(value: unknown): VoiceHints {
  const list = (raw: unknown, max: number, size: number) => {
    const seen = new Set<string>();
    for (const item of Array.isArray(raw) ? raw : []) {
      const text = typeof item === 'string' ? item.replace(/\s+/g, ' ').trim() : '';
      if (text && text.length <= size) seen.add(text);
      if (seen.size >= max) break;
    }
    return [...seen];
  };
  const record = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
  const languages = list(record.languageBias, 4, 32).filter((name) => Object.values(LANGUAGE_NAMES).includes(name));
  return { keywords: list(record.keywords, MAX_KEYWORDS, MAX_KEYWORD_CHARS), languageBias: languages };
}

/** Words that name nothing: function words of the languages a tour is written in, and the furniture of documents. */
const COMMON = new Set(
  `a about after all also am an and any are as at be because been before being between both but by can could did do does
  each for from had has have he her his how i if in into is it its just may might more most must my new no not now of
  on one only or other our out over she should so some such than that the their them then there these they this those
  to too up us was we were what when where which while who why will with would yet you your need needs work works
  der die das den dem des ein eine einer einem einen eines und oder ist sind wird werden für mit auf von zu im nicht
  auch sich als bei diese dieser diesem diesen dieses kann können muss müssen soll sollen sie wir ihr ihre ihrer ihren
  ihnen welche welcher welchem welchen nach über unter nur noch wenn dass dann wie was wer wo hat haben sein wurde
  jede jeder jedes keine keinen man mehr sehr le la les un une des et ou est sont pour avec sur du de dans pas cette
  ce qui que el los las y es son para con en del no se por il lo gli di che per su sono non het een of zijn voor
  met op van naar niet figure fig table section sec equation eq appendix chapter algorithm theorem lemma proof
  example exercise abstract introduction conclusion conclusions results discussion references acknowledgments
  acknowledgements background overview abbildung tabelle kapitel gleichung aufgabe einleitung zusammenfassung
  ergebnisse fazit literatur figura tabla sección tableau`.split(/\s+/),
);
/** Words around a person's name that make it an institution instead. */
const INSTITUTION =
  /\b(?:universit\w*|universidad|institut\w*|school|department|dept|laborator\w*|research|college|cent(?:er|re)|faculty|fakult\w*|inc|ltd|gmbh|corp\w*|company)\b/i;

const WORD = /\p{L}[\p{L}\p{N}]*(?:[-'’_]\p{L}[\p{L}\p{N}]*)*/gu;
/** Text the learner might speak about: not the bibliography, running heads or the extracted insides of figures. */
const SPOKEN_ABOUT = new Set(['paragraph', 'heading', 'caption', 'footnote', 'title', 'authors', 'other']);

/** A term as the recogniser should hear it: "d_model" is spoken "d model". Empty when it would not help to bias. */
function cleanKeyword(raw: string): string {
  const text = raw
    .normalize('NFC')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’.,;:!?()[\]{}*†‡∗]+|[\s"'“”‘’.,;:!?()[\]{}*†‡∗]+$/g, '');
  if (text.length > MAX_KEYWORD_CHARS || /[@<>\\/]|\p{C}/u.test(text)) return '';
  // Single letters and numbers are heard clearly or not at all; a keyword needs a word or an acronym.
  return /\p{L}{3}/u.test(text) || /^\p{Lu}{2,}\d*$/u.test(text) ? text : '';
}

const common = (word: string) => COMMON.has(word.toLowerCase());
const words = (text: string) => text.match(WORD) ?? [];
/** A heading without its number; one set in capitals ("MATERIALS AND METHODS") is written as a title, as it is spoken. */
function headingText(title: string): string {
  const text = title.replace(/^\s*(?:§\s*)?(?:\d+(?:\.\d+)*|[IVXLC]+)[.)]?\s+/, '').trim();
  return /\p{Ll}/u.test(text)
    ? text
    : text.toLowerCase().replace(/(^|[\s-])(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase());
}

/** "Long Short-Term Memory (LSTM)": the words before an acronym in brackets whose initials spell it. */
function expansions(text: string): { phrase: string; acronym: string }[] {
  const out: { phrase: string; acronym: string }[] = [];
  for (const match of text.matchAll(/\(\s*(\p{Lu}{2,7}\d?)s?\s*\)/gu)) {
    const acronym = match[1];
    const letters = acronym.replace(/\d/g, '');
    const before = words(text.slice(Math.max(0, match.index - 120), match.index).replace(/[-–]/g, ' '));
    const phrase = before.slice(-letters.length);
    if (
      letters.length >= 2 &&
      phrase.length === letters.length &&
      phrase.every((word, i) => word[0].toLowerCase() === letters[i].toLowerCase())
    )
      out.push({ phrase: phrase.join(' '), acronym });
  }
  return out;
}

/** "called the encoder", "genannt Gradient": up to three words after a naming verb, cut at the first function word. */
function namedTerms(text: string): string[] {
  const out: string[] = [];
  const cue =
    /\b(?:called|termed|known as|referred to as|denoted|genannt|bezeichnet(?: als)?|heißt|appelée?s?|llamad[oa]s?)\s+(?:the\s+|a\s+|an\s+|by\s+|als\s+)?["“'‘]?(\p{L}[\p{L}\p{N}-]*(?:\s+\p{L}[\p{L}\p{N}-]*){0,2})/giu;
  for (const match of text.matchAll(cue)) {
    const term: string[] = [];
    for (const word of match[1].split(/\s+/)) {
      if (common(word)) break;
      term.push(word);
    }
    if (term.length) out.push(term.join(' '));
  }
  return out;
}

/** A name set apart on a line of the author block: two to four capitalised words, no institution. */
function surnames(text: string): string[] {
  const out: string[] = [];
  for (const piece of text.split(/[\n,;&]|\band\b|\bund\b/)) {
    const name = words(piece.replace(/[\d@*†‡∗]/g, ' '));
    if (name.length >= 2 && name.length <= 4 && name.every((w) => /^\p{Lu}/u.test(w)) && !INSTITUTION.test(piece))
      out.push(name[name.length - 1]);
  }
  return out.slice(0, 8);
}

/** Something a speaker pronounces and a recogniser cannot guess: an acronym, a camel-case name, a symbol with a subscript. */
const symbolLike = (word: string) =>
  (/^\p{Lu}{2,5}s?$/u.test(word) && !/^[IVXLC]+$/.test(word)) ||
  /\p{Ll}\p{Lu}/u.test(word) ||
  /\p{L}\d|\d\p{L}|\p{L}_\p{L}/u.test(word);

/**
 * Up to `limit` terms of a document that a speech recogniser could mishear, best first: the title, defined terms and
 * abbreviations, section headings, author surnames, then names, acronyms and symbols that recur in the text, and last
 * the long words it uses often. Pure counting over the document, so any document gets its own list.
 */
export function documentKeywords(doc: Doc, limit = MAX_KEYWORDS): string[] {
  const found = new Map<string, { text: string; score: number }>();
  const add = (raw: string, score: number) => {
    const text = cleanKeyword(raw);
    if (!text) return;
    const key = text.toLowerCase();
    const known = found.get(key);
    found.set(key, { text: known?.text ?? text, score: (known?.score ?? 0) + score });
  };
  const phrase = (text: string, score: number, wordScore: number) => {
    const parts = words(text);
    if (parts.length > 1 && parts.length <= 5) add(parts.join(' '), score);
    for (const word of new Set(parts)) if (word.length >= 4 && !common(word)) add(word, wordScore);
  };

  const blocks = new Map(doc.blocks.map((b) => [b.id, b]));
  const titles = [doc.source.title ?? '', ...doc.blocks.filter((b) => b.type === 'title').map((b) => b.text)];
  for (const title of titles.slice(0, 3)) phrase(title.replace(/\s+/g, ' ').trim(), 100, 60);
  const headings = new Set([
    ...doc.sections.map((s) => headingText(s.title)),
    ...doc.blocks.filter((b) => b.type === 'heading').map((b) => headingText(b.text.replace(/\s+/g, ' '))),
  ]);
  for (const heading of headings) if (heading) phrase(heading, 50, 30);
  const authors = doc.blocks.find((b) => b.type === 'authors');
  for (const name of authors ? surnames(authors.text) : []) add(name, 40);

  const prose = doc.sentences
    .filter((s) => SPOKEN_ABOUT.has(blocks.get(s.block)?.type ?? ''))
    .map((s) => s.text)
    .concat(doc.figures.map((f) => f.caption));
  const counts = new Map<string, number>();
  const proper = new Map<string, number>();
  const count = (map: Map<string, number>, word: string) => map.set(word, (map.get(word) ?? 0) + 1);
  for (const text of prose) {
    for (const { phrase: long, acronym } of expansions(text)) {
      add(long, 70);
      add(acronym, 20);
    }
    for (const term of namedTerms(text)) add(term, 60);
    words(text).forEach((word, i) => {
      if (i > 0 && /^\p{Lu}\p{Ll}{3,}$/u.test(word)) count(proper, word);
      else if (symbolLike(word)) count(counts, word);
      else if (word.length >= 7) count(counts, word.toLowerCase());
    });
  }
  // Symbols are also written in the display equations; spoken words are not.
  for (const equation of doc.equations)
    for (const word of words(equation.text)) if (symbolLike(word)) count(counts, word);
  for (const [word, n] of counts) {
    if (common(word)) continue;
    if (symbolLike(word)) n >= 2 && add(word, 20 + 3 * Math.min(n, 10));
    else if (n >= 3) add(word, Math.min(n, 20));
  }
  for (const [word, n] of proper) if (n >= 2 && !common(word)) add(word, 10 + Math.min(n, 20));

  return [...found.values()]
    .sort((a, b) => b.score - a.score || a.text.localeCompare(b.text))
    .slice(0, limit)
    .map((k) => k.text);
}

/** The hints for a question about this document: its terms, and the language it is written in. */
export function voiceHints(doc: Doc, fallbackLanguage: string): VoiceHints {
  return {
    keywords: documentKeywords(doc),
    languageBias: languageBias(documentLanguage(doc, fallbackLanguage)),
  };
}
