import type { Doc } from '../../../shared/paper';

const LANGUAGES: Record<string, string> = {
  'de-DE':
    'der die das den dem des ein eine einer einem und oder ist sind wird werden für mit auf von zu im nicht auch sich als bei diese dieses einer kann müssen sie wir',
  'en-US': 'the a an and or is are be been will for with on of to in not also this that these which can must we it',
  'fr-FR': 'le la les un une des et ou est sont pour avec sur du de dans pas aussi cette ce qui que il',
  'es-ES': 'el la los las un una y o es son para con en de del no también este esta que se por',
  'it-IT': 'il lo la gli un una e o sono per con su di del non anche questo questa che si',
  'pt-PT': 'o a os as um uma e ou são para com em do da não também este esta que por',
  'nl-NL': 'het de een en of is zijn voor met op van naar niet ook deze dit wordt worden',
};

/** Dominant prose language, excluding bibliography, equations and figure labels; low evidence keeps the configured fallback. */
export function documentLanguage(doc: Doc, fallback = 'en-US'): string {
  const blocks = doc.blocks.filter((b) => ['paragraph', 'heading', 'title'].includes(b.type));
  const text = (blocks.map((b) => b.text).join(' ') || doc.sentences.map((s) => s.text).join(' '))
    .slice(0, 40000)
    .toLowerCase();
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length < 30) return fallback;
  const count = (pattern: RegExp) => (text.match(pattern) ?? []).length;
  if (count(/[\u4e00-\u9fff]/g) > letters.length * 0.3) return 'zh-CN';
  if (count(/[\u3040-\u30ff]/g) > letters.length * 0.1) return 'ja-JP';
  if (count(/[\uac00-\ud7af]/g) > letters.length * 0.3) return 'ko-KR';
  if (count(/[\u0600-\u06ff]/g) > letters.length * 0.3) return 'ar';
  if (count(/[\u0400-\u04ff]/g) > letters.length * 0.3) return /[іїєґ]/.test(text) ? 'uk-UA' : 'ru-RU';
  const tokens = text.match(/\p{L}+/gu) ?? [];
  const ranked = Object.entries(LANGUAGES)
    .map(([language, list]) => {
      const known = new Set(list.split(' '));
      return { language, score: tokens.filter((w) => known.has(w)).length };
    })
    .sort((a, b) => b.score - a.score);
  return ranked[0].score >= 3 && ranked[0].score > ranked[1].score * 1.15 ? ranked[0].language : fallback;
}
