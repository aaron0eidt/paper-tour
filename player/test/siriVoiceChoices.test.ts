import { siriVoiceChoices, siriVoiceQuality } from '../src/narration/siriVoiceChoices';
import type { SiriVoice } from '../../shared/speech';
import { moveFavorite, openaiVoiceChoices, rankVoiceChoices, voiceProviderReady } from '../src/narration/voiceChoices';

function assert(value: unknown, message = 'Assertion failed'): asserts value { if (!value) throw new Error(message); }
function equal(actual: unknown, expected: unknown, message?: string) { assert(actual === expected, message ?? `Expected ${String(expected)}, got ${String(actual)}`); }
function deepEqual(actual: unknown, expected: unknown, message?: string) { equal(JSON.stringify(actual), JSON.stringify(expected), message); }
function match(value: string, pattern: RegExp, message?: string) { assert(pattern.test(value), message); }

const voice = (id: string, name: string, language: string, installed: boolean, generation: SiriVoice['generation'] = 'legacy'): SiriVoice =>
  ({ id, name, language, installed, generation });
const options = siriVoiceChoices([
  voice('german', 'Helena', 'de-DE', true),
  voice('arthur-classic', 'Arthur', 'en-GB', false),
  voice('coded', 'en-US-F', 'en-US', false, 'expressive'),
  voice('arthur-new', 'arthur', 'en-GB', true, 'expressive'),
  voice('irish', 'Tara', 'en-IE', true),
  voice('arabic', 'Example', 'ar-SA', true),
  voice('french', 'Example', 'fr-FR', true),
]);
equal(options[0].value, 'auto', 'automatic language matching stays first');
deepEqual(options.slice(1).map((option) => option.group), ['English', 'English', 'English', 'English', 'German', 'Arabic', 'French'], 'English leads, German follows, then other languages sort alphabetically');
equal(options.find((option) => option.value === 'german')?.groupCode, 'DE');
const english = options.filter((option) => option.group === 'English');
assert(english.slice(0, 2).every((option) => option.detail?.endsWith('Installed')), 'ready voices lead their language group');
equal(options.find((option) => option.value === 'arthur-new')?.label, 'Arthur');
equal(options.find((option) => option.value === 'arthur-new')?.badge, 'Siri · Expressive');
equal(options.find((option) => option.value === 'arthur-classic')?.badge, 'Siri · Classic', 'same-named generations stay distinguishable');
equal(options.find((option) => option.value === 'coded')?.label, 'Voice F', 'unnamed Apple voices keep a neutral identifier');
match(options.find((option) => option.value === 'coded')!.detail!, /United States.*Download needed/);
match(options.find((option) => option.value === 'german')!.searchText!, /de-DE German Germany/, 'search supports language codes and readable names');
deepEqual(siriVoiceChoices([]).map((option) => option.value), ['auto']);
equal(siriVoiceChoices([voice('unknown', 'Example', 'not_a_locale', true)])[1].value, 'unknown', 'unknown language tags do not remove saved voices');
const premium = voice('en-US:natural:male:Aaron:premium:5030', 'Aaron', 'en-US', true);
equal(siriVoiceChoices([premium])[1].badge, 'Siri · Premium', 'premium labels come from the actual Apple asset tier');
equal(siriVoiceQuality(voice('com.apple.speech.synthesis.voice.custom.siri.helena.premium', 'Helena', 'de-DE', true)).badge, 'Siri · Premium', 'native Apple bundle IDs expose the same Premium tier');
equal(siriVoiceQuality(voice('some-premium-sounding-name', 'Example', 'en-US', true)).badge, 'Siri · Classic', 'a voice name alone does not establish its quality tier');
match(siriVoiceQuality(premium).description, /native speech timing/);
match(siriVoiceQuality(voice('fmvoice', 'Aaron', 'en-US', true, 'expressive')).description, /estimated timing/);
equal(siriVoiceQuality(voice('unknown-quality', 'Aaron', 'en-US', true)).badge, 'Siri · Classic', 'unknown quality is not promoted to Premium');
console.log('ok Siri voices group by language, prioritize installed voices, and identify Siri generation and catalog quality');

const ranked = siriVoiceChoices([
  voice('de', 'Helena', 'de-DE', true), voice('a', 'Aaron', 'en-US', true), voice('z', 'Zoe', 'en-US', false),
], ['de', 'z']);
deepEqual(ranked.map((option) => option.value), ['auto', 'z', 'a', 'de'], 'favorites lead within a language without moving German before English or Automatic');
deepEqual(rankVoiceChoices([{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }], ['missing', 'b']).map((option) => option.value), ['b', 'a'], 'missing saved favorites do not hide new voices');
const order = ['english-a', 'german', 'english-b'];
deepEqual(moveFavorite(order, 'english-b', -1, ['english-a', 'english-b']), ['english-b', 'german', 'english-a'], 'arrows move between favorites of the same language');
deepEqual(moveFavorite(order, 'english-a', -1, ['english-a', 'english-b']), order, 'moving above the first favorite is a no-op');
deepEqual(order, ['english-a', 'german', 'english-b'], 'moving favorites does not mutate the source preferences');
equal(openaiVoiceChoices('gpt-4o-mini-tts', ['marin'])[0].value, 'marin');
assert(!openaiVoiceChoices('tts-1', ['marin']).some((option) => option.value === 'marin'), 'saved favorites cannot enable unsupported model voices');
console.log('ok personal voice ranking preserves language groups, missing voices, Automatic and model compatibility');
equal(voiceProviderReady('siri', false, { cliReady: false, installed: 0 }), false);
equal(voiceProviderReady('siri', false, { cliReady: true, installed: 1 }), true, 'the first completed download unlocks preview without a settings reload');
equal(voiceProviderReady('siri', true, { cliReady: true, installed: 0 }), false, 'a stale ready settings snapshot does not override the live catalog');
equal(voiceProviderReady('siri', true, null), true, 'the saved status is a fallback while the live catalog loads');
equal(voiceProviderReady('openai', false, { cliReady: true, installed: 1 }), false, 'local Siri readiness cannot unlock an unconfigured cloud provider');
console.log('ok voice preview availability follows live download readiness');
