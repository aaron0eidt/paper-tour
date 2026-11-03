import type { ChoiceOption } from '../components/ChoicePicker';
import type { SiriSetupStatus, SpeechProvider } from '../../../shared/speech';
import { voiceId } from './voices';

const languages = new Intl.DisplayNames(['en'], { type: 'language' });
const regions = new Intl.DisplayNames(['en'], { type: 'region' });
const collator = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** The download poll is newer than the account settings snapshot after the first install. */
export function voiceProviderReady(
  provider: SpeechProvider,
  configured: boolean,
  siri: Pick<SiriSetupStatus, 'cliReady' | 'installed'> | null,
) {
  if (provider === 'browser') return true;
  return provider === 'siri' && siri ? siri.cliReady && siri.installed > 0 : configured;
}

export function voiceLocale(tag: string) {
  let language = tag,
    region = '',
    code = tag;
  try {
    const locale = new Intl.Locale(tag.replaceAll('_', '-'));
    code = locale.language;
    language = languages.of(code) ?? code;
    region = locale.region ? (regions.of(locale.region) ?? locale.region) : '';
  } catch {
    /* Preserve unknown tags as supplied by the voice catalog. */
  }
  return { language, region, code: code.toUpperCase(), priority: code === 'en' ? 0 : code === 'de' ? 1 : 2 };
}

/** Keep language groups and Automatic in place; favorites lead only their own group. */
export function rankVoiceChoices<T extends string>(
  options: readonly ChoiceOption<T>[],
  order: readonly string[] = [],
): ChoiceOption<T>[] {
  const groups = new Map<string | undefined, number>();
  const rank = new Map(order.map((id, index) => [id, index]));
  const rows = options.map((option, index) => {
    if (!groups.has(option.group)) groups.set(option.group, groups.size);
    return { option, index, group: groups.get(option.group)! };
  });
  return rows
    .sort(
      (a, b) =>
        a.group - b.group ||
        (rank.get(a.option.value) ?? Infinity) - (rank.get(b.option.value) ?? Infinity) ||
        a.index - b.index,
    )
    .map((row) => row.option);
}

const OPENAI_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
export function openaiVoiceChoices(model: string, order: readonly string[] = []): ChoiceOption[] {
  const voices = model === 'gpt-4o-mini-tts' ? ['cedar', 'marin', ...OPENAI_VOICES, 'ballad', 'verse'] : OPENAI_VOICES;
  return rankVoiceChoices(
    voices.map((voice) => ({ value: voice, label: voice.charAt(0).toUpperCase() + voice.slice(1), badge: 'OpenAI' })),
    order,
  );
}

export function browserVoiceChoices(
  voices: readonly SpeechSynthesisVoice[],
  order: readonly string[] = [],
): ChoiceOption[] {
  const rows = voices.map((voice) => ({ voice, locale: voiceLocale(voice.lang) }));
  rows.sort(
    (a, b) =>
      a.locale.priority - b.locale.priority ||
      collator.compare(a.locale.language, b.locale.language) ||
      collator.compare(a.locale.region, b.locale.region) ||
      collator.compare(a.voice.name, b.voice.name),
  );
  return rankVoiceChoices(
    rows.map(({ voice, locale }) => ({
      value: voiceId(voice),
      label: voice.name,
      badge: 'Browser',
      group: locale.language,
      groupCode: locale.code,
      detail: [locale.region, voice.localService ? 'On device' : 'Online'].filter(Boolean).join(' · '),
      searchText: voice.lang,
    })),
    order,
  );
}

export function moveFavorite(order: readonly string[], id: string, direction: -1 | 1, groupIds: readonly string[]) {
  const peers = order.filter((value) => groupIds.includes(value));
  const at = peers.indexOf(id),
    other = peers[at + direction];
  if (at < 0 || !other) return [...order];
  const next = [...order],
    from = next.indexOf(id),
    to = next.indexOf(other);
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
