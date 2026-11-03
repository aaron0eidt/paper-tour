import { useEffect, useState } from 'react';
import {
  DEFAULT_SPEECH_PREFERENCES,
  type SpeechPreferences,
  type SpeechProvider,
  type SpeechSettings as Settings,
} from '../../../shared/speech';
import { apiRequest } from '../library/client';
import { settingsChanged } from '../library/useSettings';
import { useSpeechSettings } from './useSpeechSettings';
import { SpeechVoiceControl } from './SpeechVoiceControl';

export const SPEECH_LABELS: Record<SpeechProvider, string> = {
  browser: 'Browser voices',
  openai: 'OpenAI TTS',
  elevenlabs: 'ElevenLabs',
};
export function SpeechProviderSelect({
  value,
  onChange,
  disabled = false,
}: {
  value: SpeechProvider;
  onChange(provider: SpeechProvider): void;
  disabled?: boolean;
}) {
  return (
    <select
      aria-label="Speech provider"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as SpeechProvider)}
    >
      {Object.entries(SPEECH_LABELS).map(([id, label]) => (
        <option key={id} value={id}>
          {label}
        </option>
      ))}
    </select>
  );
}
/** Account settings own credentials; the small reader menu only changes the selected provider. */
export function SpeechSettings() {
  const speech = useSpeechSettings();
  const [draft, setDraft] = useState<SpeechPreferences>(structuredClone(DEFAULT_SPEECH_PREFERENCES));
  const [key, setKey] = useState(''),
    [pending, setPending] = useState(false),
    [error, setError] = useState<string | null>(null),
    [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (speech.data) setDraft(structuredClone(speech.data.preferences));
  }, [speech.data]);
  const provider = draft.provider,
    audioProvider = provider === 'browser' ? null : provider;
  const connection = audioProvider ? draft.connections[audioProvider] : null;
  const status = audioProvider ? speech.data?.providers[audioProvider] : null;
  const setConnection = (update: Partial<SpeechPreferences['connections']['elevenlabs']>) => {
    if (!audioProvider) return;
    setDraft((current) => ({
      ...current,
      connections: { ...current.connections, [audioProvider]: { ...current.connections[audioProvider], ...update } },
    }));
  };
  const run = async (action: () => Promise<unknown>, message: string) => {
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update speech settings.');
    } finally {
      setPending(false);
    }
  };
  const keyAction = (remove: boolean) =>
    run(
      async () => {
        await apiRequest<Settings>(`/api/speech/keys/${provider}`, {
          method: remove ? 'DELETE' : 'PUT',
          ...(remove ? {} : { body: JSON.stringify({ apiKey: key }) }),
        });
        setKey('');
        settingsChanged();
      },
      remove
        ? 'Personal speech key removed.'
        : 'Personal speech key encrypted and saved. Select this provider and use Preview to test speech.',
    );
  const [sample, setSample] = useState<HTMLAudioElement | null>(null);
  useEffect(
    () => () => {
      sample?.pause();
      if (sample?.src) URL.revokeObjectURL(sample.src);
    },
    [sample],
  );
  const preview = () =>
    run(async () => {
      if (!speech.data || provider === 'browser') return;
      if (JSON.stringify(draft) !== JSON.stringify(speech.data.preferences))
        throw new Error('Save speech settings before previewing.');
      const audio = await apiRequest<import('../../../shared/speech').SpeechAudio>('/api/speech/synthesize', {
        method: 'POST',
        body: JSON.stringify({
          text: 'Hello. Hallo. Welcome to Paper Tour.',
          language: 'en-US',
          version: speech.data.version,
        }),
      });
      const bytes = Uint8Array.from(atob(audio.audioBase64), (char) => char.charCodeAt(0));
      const element = new Audio(URL.createObjectURL(new Blob([bytes], { type: audio.mimeType })));
      setSample(element);
      try {
        await element.play();
      } catch {
        throw new Error('Allow audio playback in this browser, then retry Preview.');
      }
    }, 'Preview generated using the selected provider.');
  return (
    <section className="profile-card" id="speech" aria-labelledby="speech-heading">
      <div className="profile-card-heading">
        <h2 id="speech-heading">Speech</h2>
        <p>One voice connection for guided tours, reading aloud and answers. Generated voices are AI voices.</p>
      </div>
      {speech.loading && !speech.data ? (
        <p role="status">Loading speech settings…</p>
      ) : (
        <>
          <label className="profile-field">
            Provider
            <SpeechProviderSelect
              value={provider}
              disabled={pending || !speech.data}
              onChange={(value) => {
                setDraft((current) => ({ ...current, provider: value }));
                setKey('');
                setError(null);
                setNotice(null);
              }}
            />
          </label>
          {provider === 'browser' ? (
            <p className="profile-help">
              Uses this browser’s available voices. Choose a browser voice in the player’s Audio menu.
            </p>
          ) : (
            <>
              <p className="profile-help">{status?.message}</p>
              <label className="profile-field">
                Model
                <select
                  value={connection!.model}
                  disabled={pending}
                  onChange={(event) =>
                    setConnection({
                      model: event.target.value,
                      ...(provider === 'openai' && event.target.value !== 'gpt-4o-mini-tts' ? { voice: 'alloy' } : {}),
                    })
                  }
                >
                  {(provider === 'openai'
                    ? ['gpt-4o-mini-tts', 'tts-1-hd', 'tts-1']
                    : ['eleven_multilingual_v2', 'eleven_flash_v2_5', 'eleven_v3']
                  ).map((model) => (
                    <option key={model}>{model}</option>
                  ))}
                </select>
              </label>
              <SpeechVoiceControl
                provider={provider}
                model={connection!.model}
                value={connection!.voice}
                disabled={pending}
                className="profile-field"
                onChange={(voice) => setConnection({ voice })}
              />
              {provider === 'elevenlabs' && (
                <a className="profile-help" href="https://elevenlabs.io/app" target="_blank" rel="noreferrer">
                  Open ElevenLabs to find your voice ID
                </a>
              )}
              <label className="profile-field">
                Connection
                <select
                  value={connection!.credentialSource}
                  disabled={pending}
                  onChange={(event) => setConnection({ credentialSource: event.target.value as 'app' | 'personal' })}
                >
                  <option value="app">Server key{status?.appKeyAvailable ? ' · configured' : ' · missing'}</option>
                  <option value="personal">
                    Personal key{status?.personalKey.configured ? ` · ${status.personalKey.masked}` : ' · missing'}
                  </option>
                </select>
              </label>
              <label className="profile-field">
                Personal API key
                <input
                  type="password"
                  autoComplete="new-password"
                  value={key}
                  disabled={pending}
                  onChange={(event) => setKey(event.target.value)}
                  placeholder={status?.personalKey.masked ?? 'Enter a speech API key'}
                />
              </label>
              <p className="profile-help">
                Stored encrypted on the server. Saving a key does not synthesize audio. Preview and playback use your
                account’s credits. The next sentence is always prepared during playback. Audio already requested can
                finish and be cached when playback is paused.
              </p>
              <div className="profile-actions">
                <button
                  className="library-button"
                  disabled={pending || key.trim().length < 16}
                  onClick={() => void keyAction(false)}
                >
                  Save encrypted key
                </button>
                {status?.personalKey.configured && (
                  <button className="library-text-button" disabled={pending} onClick={() => void keyAction(true)}>
                    Remove personal key
                  </button>
                )}
              </div>
            </>
          )}
          <div className="profile-actions">
            <button
              className="library-button primary"
              disabled={pending || !speech.data}
              onClick={() => void run(() => speech.update(draft), 'Speech settings saved.')}
            >
              {pending ? 'Working…' : 'Save speech settings'}
            </button>
            {audioProvider && (
              <button className="library-button" disabled={pending || !speech.data} onClick={() => void preview()}>
                Preview voice
              </button>
            )}
          </div>
        </>
      )}
      {(error || speech.error) && (
        <p className="library-error" role="alert">
          {error ?? speech.error}{' '}
          <button className="library-text-button" onClick={speech.refresh}>
            Retry
          </button>
        </p>
      )}
      {notice && (
        <p className="profile-help" role="status">
          {notice}
        </p>
      )}
    </section>
  );
}
