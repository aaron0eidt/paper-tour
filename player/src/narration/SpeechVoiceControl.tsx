import { useEffect, useState } from 'react';
import type { AudioSpeechProvider, SpeechSettings } from '../../../shared/speech';

const OPENAI_VOICES = ['alloy', 'ash', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer'];
const OPENAI_MINI_VOICES = ['cedar', 'marin', ...OPENAI_VOICES, 'ballad', 'verse'];

/** Shared field for the account form and the compact Audio menu. It never generates audio. */
export function SpeechVoiceControl({
  provider,
  model,
  value,
  onChange,
  disabled,
  className = 'voice-setting',
}: {
  provider: AudioSpeechProvider;
  model: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  className?: string;
}) {
  const voices = model === 'gpt-4o-mini-tts' ? OPENAI_MINI_VOICES : OPENAI_VOICES;
  return (
    <label className={className}>
      <span>{provider === 'elevenlabs' ? 'Voice ID' : 'Voice'}</span>
      {provider === 'elevenlabs' ? (
        <input
          aria-label="ElevenLabs voice ID"
          value={value}
          autoComplete="off"
          spellCheck={false}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <select
          aria-label="Provider voice"
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        >
          {voices.map((voice) => (
            <option key={voice} value={voice}>
              {voice}
            </option>
          ))}
        </select>
      )}
    </label>
  );
}

export function AudioVoiceControl({
  settings,
  pending,
  onSave,
}: {
  settings: SpeechSettings;
  pending: boolean;
  onSave(voice: string): Promise<void>;
}) {
  const provider = settings.preferences.provider;
  const voice = provider === 'browser' ? '' : settings.preferences.connections[provider].voice;
  const [draft, setDraft] = useState(voice);
  useEffect(() => setDraft(voice), [provider, voice]);
  if (provider === 'browser') return null;
  const connection = settings.preferences.connections[provider];
  return (
    <div className="audio-provider-voice">
      <SpeechVoiceControl
        provider={provider}
        model={connection.model}
        value={provider === 'elevenlabs' ? draft : voice}
        disabled={pending}
        onChange={(value) => {
          if (provider === 'elevenlabs') setDraft(value);
          else void onSave(value).catch(() => {});
        }}
      />
      {provider === 'elevenlabs' && (
        <div className="audio-voice-actions">
          <button
            type="button"
            disabled={pending || draft.trim() === voice || !/^[A-Za-z0-9_-]{8,100}$/.test(draft.trim())}
            onClick={() => void onSave(draft.trim()).catch(() => {})}
          >
            {pending ? 'Saving…' : 'Save voice'}
          </button>
          <a href="https://elevenlabs.io/app" target="_blank" rel="noreferrer">
            Open ElevenLabs
          </a>
        </div>
      )}
      {pending && <small role="status">Saving speech settings…</small>}
    </div>
  );
}
