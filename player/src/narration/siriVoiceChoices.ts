import type { SiriVoice } from '../../../shared/speech';
import type { ChoiceOption } from '../components/ChoicePicker';
import { rankVoiceChoices } from './voiceChoices';

const languages = new Intl.DisplayNames(['en'], { type: 'language' });
const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Premium is Apple's catalog tier, not a subjective listening score. */
export function siriVoiceQuality(voice: SiriVoice) {
  if (voice.generation === 'expressive') return {
    badge: 'Siri · Expressive',
    detail: 'New generation',
    description: 'New Siri generation with expressive delivery. Word highlighting uses estimated timing.',
  };
  const premium = /(?:^|[.:])premium(?:[.:]|$)/i.test(voice.id);
  return {
    badge: premium ? 'Siri · Premium' : 'Siri · Classic',
    detail: 'Classic generation',
    description: `${premium ? 'Apple Premium voice' : 'Classic Siri voice'}. Word highlighting follows native speech timing.`,
  };
}

/** Human-readable labels preserve Apple's voice IDs and distinguish the two voice generations. */
export function siriVoiceChoices(voices: readonly SiriVoice[], order: readonly string[] = []): ChoiceOption[] {
  const named = voices.map((voice) => {
    let language = voice.language, region = '', languageCode = voice.language;
    try {
      const locale = new Intl.Locale(voice.language);
      languageCode = locale.language;
      language = languages.of(locale.language) ?? locale.language;
      region = locale.region ? regions.of(locale.region) ?? locale.region : '';
    } catch { /* Unknown language tags remain searchable as supplied by Apple. */ }
    const code = /^[a-z]{2,3}-[a-z]{2}-(\w+)$/i.exec(voice.name);
    const name = code ? `Voice ${code[1].toUpperCase()}` : voice.name.charAt(0).toLocaleUpperCase() + voice.name.slice(1);
    const quality = siriVoiceQuality(voice);
    const languagePriority = languageCode === 'en' ? 0 : languageCode === 'de' ? 1 : 2;
    return { voice, region, languagePriority, option: {
      value: voice.id,
      label: name,
      badge: quality.badge,
      detail: [region, quality.detail, voice.installed ? 'Installed' : 'Download needed'].filter(Boolean).join(' · '),
      group: language,
      groupCode: languageCode.toUpperCase(),
      searchText: `${voice.name} ${voice.language} ${language} ${region} ${voice.generation}`,
    } satisfies ChoiceOption };
  });
  named.sort((a, b) => a.languagePriority - b.languagePriority || collator.compare(a.option.group, b.option.group) || Number(b.voice.installed) - Number(a.voice.installed) ||
    collator.compare(a.region, b.region) || collator.compare(a.option.label, b.option.label) ||
    Number(b.voice.generation === 'expressive') - Number(a.voice.generation === 'expressive'));
  return rankVoiceChoices([{ value: 'auto', label: 'Automatic', detail: 'Match the document language' }, ...named.map((item) => item.option)], order);
}
