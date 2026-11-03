import { useEffect, useState } from 'react';
import type { AudioSpeechProvider, SpeechSettings } from '../../../shared/speech';
import { SiriVoiceControl } from './SiriSetup';
import { ChoicePicker } from '../components/ChoicePicker';
import { openaiVoiceChoices } from './voiceChoices';

/** Shared field for the account form and the compact Audio menu. It never generates audio. */
export function SpeechVoiceControl({
  provider,
  model,
  value,
  onChange,
  disabled,
  className = 'voice-setting',
  local = false,
  compact = false,
  order = [],
}: {
  provider: AudioSpeechProvider;
  model: string;
  value: string;
  onChange(value: string): void;
  disabled?: boolean;
  className?: string;
  local?: boolean;
  compact?: boolean;
  order?: readonly string[];
}) {
  if (provider === 'siri') return <SiriVoiceControl value={value} onChange={onChange} disabled={disabled} local={local} className={className} compact={compact} order={order} />;
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
        <ChoicePicker label="Provider voice" value={value} disabled={disabled} onChange={onChange}
          options={openaiVoiceChoices(model, order)} />
      )}
    </label>
  );
}

export function AudioVoiceControl({
  settings,
  pending,
  onSave,
  local = false,
}: {
  settings: SpeechSettings;
  pending: boolean;
  onSave(voice: string): Promise<void>;
  local?: boolean;
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
        local={local}
        compact
        order={settings.preferences.voiceOrder?.[provider]}
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
