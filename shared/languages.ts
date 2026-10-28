/** Explicit learner override; the default remains the detected document language. */
export const RESPONSE_LANGUAGES = {
  'de-DE': 'Deutsch',
  'en-US': 'English',
  'fr-FR': 'Français',
  'es-ES': 'Español',
  'it-IT': 'Italiano',
  'pt-PT': 'Português',
  'nl-NL': 'Nederlands',
  'uk-UA': 'Українська',
  'ru-RU': 'Русский',
  ar: 'العربية',
  'tr-TR': 'Türkçe',
  'zh-CN': '中文',
  'ja-JP': '日本語',
  'ko-KR': '한국어',
} as const;
export const responseLanguage = (value: unknown): value is keyof typeof RESPONSE_LANGUAGES =>
  typeof value === 'string' && Object.hasOwn(RESPONSE_LANGUAGES, value);
