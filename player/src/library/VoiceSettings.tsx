import { useEffect, useState } from 'react';
import type { SpeechProvider } from '../../../shared/speech';
import type { ChoiceOption } from '../components/ChoicePicker';
import { ChoicePicker } from '../components/ChoicePicker';
import { PauseIcon, PlayIcon } from '../components/icons';
import { useSpeechSettings } from '../narration/useSpeechSettings';
import { useSiriSetup } from '../narration/SiriSetup';
import { SpeechProviderSelect, SPEECH_LABELS } from '../narration/SpeechSettings';
import { siriVoiceChoices } from '../narration/siriVoiceChoices';
import { browserVoiceChoices, moveFavorite, openaiVoiceChoices, voiceProviderReady } from '../narration/voiceChoices';
import { useBrowserVoices } from '../narration/useBrowserVoices';
import { useVoicePreview } from '../narration/useVoicePreview';
import { voiceId } from '../narration/voices';
import { PaperMark } from './AuthForm';
import { BackLink } from '../ui/navigation';
import '../profileSettings.css';
import './voiceSettingsPage.css';

const SAMPLES = {
  en: 'A good explanation connects the details to the bigger picture. Take your time, follow the argument, and listen for what matters most.',
  de: 'Eine gute Erklärung verbindet die Details mit dem großen Ganzen. Nimm dir Zeit, folge dem Gedanken und achte darauf, was wirklich wichtig ist.',
};

function Arrow({ down = false }: { down?: boolean }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
    >
      <path d={down ? 'm5 8 5 5 5-5' : 'm5 12 5-5 5 5'} />
    </svg>
  );
}
function FavoriteIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="m10 2 2.5 5.1 5.6.8-4 4 .9 5.6-5-2.6-5 2.6.9-5.6-4-4 5.6-.8Z" />
    </svg>
  );
}

export function VoiceSettings() {
  const speech = useSpeechSettings();
  const browser = useBrowserVoices();
  const [provider, setProvider] = useState<SpeechProvider>('siri');
  const siri = useSiriSetup(false, provider === 'siri');
  const preview = useVoicePreview();
  const [query, setQuery] = useState(''),
    [language, setLanguage] = useState('all');
  const [availability, setAvailability] = useState('all'),
    [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sampleLanguage, setSampleLanguage] = useState<'en' | 'de'>('en');
  const [sample, setSample] = useState(SAMPLES.en);
  const [pending, setPending] = useState(false),
    [notice, setNotice] = useState(''),
    [error, setError] = useState('');
  const data = speech.data,
    preferences = data?.preferences;
  const order = preferences?.voiceOrder?.[provider] ?? [];
  const selected = provider === 'browser' ? browser.selectedVoiceId : preferences?.connections[provider].voice;
  const voices: ChoiceOption[] =
    provider === 'siri'
      ? siriVoiceChoices(siri.data?.voices ?? [], order).filter((option) => option.value !== 'auto')
      : provider === 'browser'
        ? browserVoiceChoices(browser.voices, order)
        : provider === 'openai'
          ? openaiVoiceChoices(preferences?.connections.openai.model ?? 'gpt-4o-mini-tts', order)
          : preferences
            ? [
                {
                  value: preferences.connections.elevenlabs.voice,
                  label: 'Saved ElevenLabs voice',
                  badge: 'ElevenLabs',
                  detail: preferences.connections.elevenlabs.voice,
                },
              ]
            : [];
  const ready = (id: string) => provider !== 'siri' || !!siri.data?.voices.find((voice) => voice.id === id)?.installed;
  const configured = voiceProviderReady(
    provider,
    provider !== 'browser' && !!data?.providers[provider].configured,
    siri.data,
  );
  const shown = voices.filter(
    (voice) =>
      (!favoritesOnly || order.includes(voice.value)) &&
      (language === 'all' || voice.group === language) &&
      (availability === 'all' || ready(voice.value) === (availability === 'ready')) &&
      [voice.label, voice.badge, voice.detail, voice.group, voice.searchText]
        .join(' ')
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const playable = shown.filter((voice) => ready(voice.value));
  const groups = [...new Set(shown.map((voice) => voice.group ?? 'Voices'))];
  const languages = [...new Set(voices.map((voice) => voice.group).filter((value): value is string => !!value))];
  const activeChoice = voices.find((voice) => voice.value === preview.current?.voice);

  useEffect(() => {
    document.title = 'Voices · Settings · Paper Tour';
  }, []);
  const changeProvider = (next: SpeechProvider) => {
    preview.stop();
    setProvider(next);
    setQuery('');
    setLanguage('all');
    setAvailability('all');
    setFavoritesOnly(false);
    setError('');
    setNotice('');
  };
  const run = async (action: () => Promise<unknown>, message: string) => {
    setPending(true);
    setNotice('');
    setError('');
    try {
      await action();
      setNotice(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update this voice. Retry.');
    } finally {
      setPending(false);
    }
  };
  const rank = (next: string[]) =>
    void run(
      () => speech.rankVoices(provider, next),
      'Voice order saved. Favorites lead the selection within each language.',
    );
  const useVoice = (id: string) =>
    void run(async () => {
      if (!preferences) return;
      preview.stop();
      if (provider === 'browser') browser.setSelectedVoiceId(id);
      await speech.update({
        ...preferences,
        provider,
        ...(provider !== 'browser'
          ? {
              connections: {
                ...preferences.connections,
                [provider]: { ...preferences.connections[provider], voice: id },
              },
            }
          : {}),
      });
    }, 'Voice selected for tours, reading aloud and answers.');
  const play = (rows: ChoiceOption[]) => {
    if (!data || !sample.trim()) return;
    void preview.play(
      rows.map((row) => ({
        value: row.value,
        label: `${row.label}${row.badge ? ` · ${row.badge}` : ''}`,
        language:
          provider === 'siri'
            ? siri.data?.voices.find((voice) => voice.id === row.value)?.language
            : provider === 'browser'
              ? browser.voices.find((voice) => voiceId(voice) === row.value)?.lang
              : sampleLanguage === 'de'
                ? 'de-DE'
                : 'en-US',
      })),
      provider,
      sample.trim(),
      sampleLanguage === 'de' ? 'de-DE' : 'en-US',
      data.version,
      browser.voices,
    );
  };

  return (
    <div className="library">
      <header className="library-header">
        <PaperMark />
        <BackLink href={`${import.meta.env.BASE_URL}?settings=profile`} label="Back to settings" />
      </header>
      <main className="library-main voices-main">
        <div className="library-heading">
          <div>
            <h1>Voices</h1>
            <p className="profile-help">Compare the same passage, find your favorites and put them first.</p>
          </div>
        </div>
        <nav className="profile-nav" aria-label="Settings pages">
          <a href={`${import.meta.env.BASE_URL}?settings=profile`}>General</a>
          <a href={`${import.meta.env.BASE_URL}?settings=voices`} aria-current="page">
            Voices
          </a>
        </nav>
        <div className="voices-provider">
          <label className="voice-setting">
            <span>Speech provider</span>
            <SpeechProviderSelect value={provider} onChange={changeProvider} />
          </label>
          <p className="profile-help">
            {provider === 'siri'
              ? 'Siri voices run on this Mac. Preview installed voices or download more below.'
              : provider === 'browser'
                ? 'Voices available in this browser. Downloads are managed by your browser or macOS.'
                : `${SPEECH_LABELS[provider]} previews use your configured connection and its credits.`}
          </p>
        </div>
        {(speech.error || error || (provider === 'siri' && siri.error)) && (
          <p className="library-feedback library-error" role="alert">
            {error || speech.error || siri.error}{' '}
            <button
              className="library-text-button"
              onClick={() => {
                speech.refresh();
                siri.refresh();
              }}
            >
              Retry
            </button>
          </p>
        )}
        <div className="voices-layout">
          <aside className="voice-sample" aria-labelledby="voice-sample-heading">
            <div className="voice-sample-heading">
              <h2 id="voice-sample-heading">Preview passage</h2>
              <div className="voice-sample-languages" aria-label="Sample language">
                {(['en', 'de'] as const).map((code) => (
                  <button
                    key={code}
                    type="button"
                    aria-pressed={sampleLanguage === code}
                    onClick={() => {
                      preview.stop();
                      setSampleLanguage(code);
                      setSample(SAMPLES[code]);
                    }}
                  >
                    {code.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
            <label htmlFor="voice-sample-text" className="voice-sample-label">
              Every preview uses this text.
            </label>
            <textarea
              id="voice-sample-text"
              value={sample}
              maxLength={600}
              rows={6}
              onChange={(event) => {
                preview.stop();
                setSample(event.target.value);
              }}
            />
            <div className="voice-sample-actions">
              <span>{sample.length} / 600</span>
              <button
                className="library-text-button"
                onClick={() => {
                  preview.stop();
                  setSample(SAMPLES[sampleLanguage]);
                }}
              >
                Reset text
              </button>
            </div>
            <button
              className="library-button primary voice-compare"
              disabled={!preview.current && (!data || !playable.length || !sample.trim() || !configured)}
              onClick={() => (preview.current ? preview.stop() : play(playable))}
            >
              {preview.current ? (
                <>
                  <PauseIcon />
                  Stop comparison
                </>
              ) : (
                <>
                  <PlayIcon />
                  Play shown voices ({playable.length})
                </>
              )}
            </button>
            <div className="voice-preview-status" role="status" aria-live="polite">
              {preview.current ? (
                <>
                  <strong>
                    {preview.current.phase === 'preparing' ? 'Preparing' : 'Playing'} {preview.current.index} /{' '}
                    {preview.current.total}
                  </strong>
                  <span>{preview.current.label}</span>
                </>
              ) : (
                preview.notice || 'Use Preview on a voice to hear it individually.'
              )}
            </div>
            {preview.error && (
              <p className="library-error" role="alert">
                {preview.error}
              </p>
            )}
            {!configured && data && (
              <p className="profile-help">
                {provider === 'siri'
                  ? 'Download a voice to start listening.'
                  : 'Configure this provider to preview its voices.'}{' '}
                <a href={`${import.meta.env.BASE_URL}?settings=profile#speech`}>Speech settings</a>
              </p>
            )}
            {activeChoice && <p className="profile-help">{activeChoice.detail}</p>}
            <p className="voice-rank-help">
              Favorite voices appear first in the selection. Use the arrows to rank favorites within each language.
              English comes first, then German.
            </p>
            {notice && (
              <p className="voices-notice" role="status">
                {notice}
              </p>
            )}
          </aside>
          <section className="voice-catalog" aria-labelledby="voice-catalog-heading">
            <div className="voice-catalog-heading">
              <h2 id="voice-catalog-heading">
                Voice library <span>{voices.length}</span>
              </h2>
              <button
                className="library-text-button"
                onClick={() => {
                  if (provider === 'siri') siri.refresh();
                  else speech.refresh();
                }}
              >
                Refresh voices
              </button>
            </div>
            <div className="voice-catalog-filters">
              <input
                aria-label="Find a voice"
                type="search"
                placeholder="Name, language or country…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {languages.length > 0 && (
                <ChoicePicker
                  label="Voice language"
                  value={language}
                  onChange={setLanguage}
                  options={[
                    { value: 'all', label: 'All languages' },
                    ...languages.map((group) => ({ value: group, label: group })),
                  ]}
                />
              )}
              {provider === 'siri' && (
                <ChoicePicker
                  label="Voice availability"
                  value={availability}
                  onChange={setAvailability}
                  options={[
                    { value: 'all', label: 'All voices' },
                    { value: 'ready', label: 'Installed' },
                    { value: 'missing', label: 'Not downloaded' },
                  ]}
                />
              )}
            </div>
            <div className="voice-catalog-tools">
              <button
                type="button"
                className="library-text-button"
                aria-pressed={favoritesOnly}
                onClick={() => setFavoritesOnly(!favoritesOnly)}
              >
                {favoritesOnly
                  ? 'Show all voices'
                  : `Favorites (${order.filter((id) => voices.some((voice) => voice.value === id)).length})`}
              </button>
              {!!order.length && (
                <button className="library-text-button" disabled={pending} onClick={() => rank([])}>
                  Reset ranking
                </button>
              )}
              <span>{shown.length} shown</span>
            </div>
            {provider === 'siri' && (
              <div className="voice-download-status">
                <span role="status">{siri.data?.message ?? 'Loading Siri voices…'}</span>
                {siri.data?.total ? (
                  <small>
                    {siri.data.installed} / {siri.data.total} installed
                  </small>
                ) : null}
                {siri.data?.canInstall && (
                  <button
                    className="library-text-button"
                    disabled={siri.pending}
                    onClick={() => void siri.action(siri.data?.running ? 'pause' : 'start')}
                  >
                    {siri.data.running ? 'Pause downloads' : 'Download missing voices'}
                  </button>
                )}
              </div>
            )}
            {(speech.loading && !data) || (provider === 'siri' && !siri.data) ? (
              <p className="voice-catalog-empty" role="status">
                Loading the voice library…
              </p>
            ) : !shown.length ? (
              <div className="voice-catalog-empty">
                <p>
                  {voices.length
                    ? 'No voices match these filters.'
                    : provider === 'browser'
                      ? browser.loading
                        ? 'Waiting for browser voices…'
                        : 'This browser has not made any voices available.'
                      : 'No voices are available yet.'}
                </p>
                {!!voices.length && (
                  <button
                    className="library-text-button"
                    onClick={() => {
                      setQuery('');
                      setLanguage('all');
                      setAvailability('all');
                      setFavoritesOnly(false);
                    }}
                  >
                    Clear filters
                  </button>
                )}
              </div>
            ) : (
              groups.map((group) => (
                <section className="voice-language-group" key={group} aria-label={group}>
                  <h3>
                    {group} <span>{shown.filter((voice) => (voice.group ?? 'Voices') === group).length}</span>
                  </h3>
                  <ul>
                    {shown
                      .filter((voice) => (voice.group ?? 'Voices') === group)
                      .map((voice) => {
                        const favorites = order.filter((id) =>
                          voices.some((item) => item.value === id && item.group === voice.group),
                        );
                        const position = favorites.indexOf(voice.value),
                          favorite = position >= 0,
                          installed = ready(voice.value);
                        const playing = preview.current?.voice === voice.value;
                        const using = preferences?.provider === provider && selected === voice.value;
                        const name = `${voice.label}${voice.badge ? ` (${voice.badge})` : ''}`;
                        const downloading =
                          provider === 'siri' &&
                          siri.data?.running &&
                          siri.data.currentVoice ===
                            (() => {
                              const raw = siri.data.voices.find((v) => v.id === voice.value);
                              return raw ? `${raw.name} (${raw.language})` : '';
                            })();
                        return (
                          <li key={voice.value} className={`voice-library-row${playing ? ' previewing' : ''}`}>
                            <div className="voice-library-name">
                              <div>
                                <strong>{voice.label}</strong>
                                {voice.badge && <span className="choice-badge">{voice.badge}</span>}
                                {using && <span className="voice-selected">Selected</span>}
                              </div>
                              <small>{voice.detail}</small>
                            </div>
                            <div className="voice-library-ranking">
                              <button
                                className={`voice-icon-button${favorite ? ' is-favorite' : ''}`}
                                aria-label={`${favorite ? 'Remove' : 'Add'} ${name} ${favorite ? 'from' : 'to'} favorites`}
                                aria-pressed={favorite}
                                disabled={pending || !data}
                                onClick={() =>
                                  rank(favorite ? order.filter((id) => id !== voice.value) : [...order, voice.value])
                                }
                              >
                                <FavoriteIcon filled={favorite} />
                              </button>
                              {favorite && (
                                <>
                                  <span className="voice-rank-number">{position + 1}</span>
                                  <button
                                    className="voice-icon-button"
                                    aria-label={`Move ${name} up`}
                                    disabled={pending || position === 0}
                                    onClick={() =>
                                      rank(
                                        moveFavorite(
                                          order,
                                          voice.value,
                                          -1,
                                          voices.filter((item) => item.group === voice.group).map((item) => item.value),
                                        ),
                                      )
                                    }
                                  >
                                    <Arrow />
                                  </button>
                                  <button
                                    className="voice-icon-button"
                                    aria-label={`Move ${name} down`}
                                    disabled={pending || position === favorites.length - 1}
                                    onClick={() =>
                                      rank(
                                        moveFavorite(
                                          order,
                                          voice.value,
                                          1,
                                          voices.filter((item) => item.group === voice.group).map((item) => item.value),
                                        ),
                                      )
                                    }
                                  >
                                    <Arrow down />
                                  </button>
                                </>
                              )}
                            </div>
                            <div className="voice-library-actions">
                              <button
                                className="library-button voice-preview-button"
                                aria-label={`${playing ? 'Stop preview of' : 'Preview'} ${name}`}
                                disabled={!playing && (!installed || !configured || !data || !sample.trim())}
                                onClick={() => (playing ? preview.stop() : play([voice]))}
                              >
                                {playing ? <PauseIcon /> : <PlayIcon />}
                                {playing ? 'Stop' : 'Preview'}
                              </button>
                              {installed ? (
                                <button
                                  className="library-button"
                                  disabled={pending || !data || using}
                                  onClick={() => useVoice(voice.value)}
                                >
                                  {using ? 'In use' : 'Use'}
                                </button>
                              ) : (
                                <button
                                  className="library-button"
                                  disabled={siri.pending || !siri.data?.canInstall || downloading}
                                  onClick={() => void siri.action('start', voice.value)}
                                >
                                  {downloading ? 'Downloading…' : 'Download'}
                                </button>
                              )}
                            </div>
                          </li>
                        );
                      })}
                  </ul>
                </section>
              ))
            )}
            {provider === 'elevenlabs' && (
              <p className="voice-catalog-empty">
                This is the voice ID saved in your account.{' '}
                <a href={`${import.meta.env.BASE_URL}?settings=profile#speech`}>Change your ElevenLabs voice ID</a>.
              </p>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
