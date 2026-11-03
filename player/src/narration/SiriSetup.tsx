import { useCallback, useEffect, useState } from 'react';
import type { SiriSetupStatus } from '../../../shared/speech';
import { apiRequest } from '../library/client';
import { localSpeechRequest } from './localSpeech';
import { ChoicePicker } from '../components/ChoicePicker';
import { siriVoiceChoices, siriVoiceQuality } from './siriVoiceChoices';

export function useSiriSetup(local = false, enabled = true) {
  const [data, setData] = useState<SiriSetupStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((n) => n + 1), []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const result = local ? await localSpeechRequest<SiriSetupStatus>(`/siri${revision ? '?refresh=1' : ''}`, { signal: controller.signal }) :
          await apiRequest<SiriSetupStatus>(`/api/speech/siri${revision ? '?refresh=1' : ''}`, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setData(result); setError(null);
        if (result.running) timer = setTimeout(poll, 2000);
      } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : 'Could not check Siri.'); }
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [local, revision, enabled]);
  const action = async (action: 'start' | 'pause', voiceId?: string) => {
    setPending(true); setError(null);
    try {
      const options = { method: 'POST', body: JSON.stringify({ action, ...(voiceId ? { voiceId } : {}) }) };
      const result = local ? await localSpeechRequest<SiriSetupStatus>('/siri/setup', options) :
        await apiRequest<SiriSetupStatus>('/api/speech/siri/setup', options);
      setData(result); refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update Siri setup.'); }
    finally { setPending(false); }
  };
  return { data, error, pending, refresh, action };
}

/** Shared by account Settings and the reader; download state always comes from the Mac. */
export function SiriVoiceControl({ value, onChange, disabled, local = false, className = 'voice-setting', compact = false, order = [] }: {
  value: string; onChange(voice: string): void; disabled?: boolean; local?: boolean; className?: string; compact?: boolean; order?: readonly string[];
}) {
  const siri = useSiriSetup(local);
  const state = siri.data;
  const chosen = state?.voices.find((v) => v.id === value);
  const options = siriVoiceChoices(state?.voices ?? [], order);
  if (value !== 'auto' && !options.some((option) => option.value === value))
    options.splice(1, 0, { value, label: 'Saved voice', detail: 'Not in the current voice catalog' });
  const management = <div className="siri-management-body">
    <p className="profile-help siri-message" role="status">{state?.message ?? (siri.error ? 'Siri status is unavailable.' : 'Checking Siri voices…')}</p>
    {!!state?.total && <div className="siri-progress">
      <span>{state.installed} / {state.total} voices installed</span>
      <progress aria-label="Installed Siri voices" value={state.installed} max={state.total} />
    </div>}
    {state?.supported && <p className="profile-help">Runs on this Mac without an API key. Expressive voices use estimated word timing; legacy voices provide native word timing.</p>}
    <div className="siri-actions">
      {state?.canInstall && (state.running ? <button type="button" disabled={siri.pending} onClick={() => void siri.action('pause')}>Pause downloads</button> :
        state.phase !== 'ready' && <button type="button" disabled={siri.pending} onClick={() => void siri.action('start')}>
          {state.cliReady ? 'Download all missing voices' : 'Set up Siri and all voices'}
        </button>)}
      {state?.canInstall && chosen && !chosen.installed && <button type="button" disabled={siri.pending} onClick={() => void siri.action('start', chosen.id)}>Download this voice</button>}
      <button type="button" disabled={siri.pending} onClick={siri.refresh}>Refresh voices</button>
    </div>
    {state?.failures.length ? <details className="siri-failures"><summary>{state.failures.length} downloads need attention</summary>
      <ul>{state.failures.map((failure) => <li key={failure.id}>{failure.name}: {failure.message}</li>)}</ul>
    </details> : null}
    {siri.error && <p className="library-error" role="alert">{siri.error}</p>}
  </div>;
  return <div className={`siri-setup${compact ? ' compact' : ''}`}>
    <label className={className}>
      <span>Voice</span>
      <ChoicePicker label="Siri voice" value={value} options={options} searchable disabled={disabled || !state?.supported} onChange={onChange} />
    </label>
    {(chosen || value === 'auto') && <p className="siri-voice-quality">{chosen ? siriVoiceQuality(chosen).description : 'Siri chooses an installed voice for the document language.'}</p>}
    {compact ? <details className="siri-management">
      <summary><span>Voice downloads</span><small>{state?.total ? `${state.installed} / ${state.total} installed` : 'Checking…'}</small></summary>
      {management}
    </details> : management}
  </div>;
}
