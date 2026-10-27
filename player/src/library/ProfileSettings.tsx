import { useEffect, useState } from 'react';
import type { UserSettings } from '../../../shared/settings';
import { PaperMark } from './AuthForm';
import { apiRequest, signOut } from './client';
import { useSettings, settingsChanged } from './useSettings';
import { useModelCatalog } from './useModelCatalog';
import { selectedApiModel } from './modelChoices';
import { ModelPicker } from '../components/ModelPicker';
import '../profileSettings.css';

export function ProfileSettings({ email }: { email: string }) {
  const profile = useSettings();
  const models = useModelCatalog();
  const [model, setModel] = useState('');
  const [source, setSource] = useState<'app' | 'personal'>('app');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (profile.data) setModel(profile.data.defaultModel); }, [profile.data?.defaultModel]);
  useEffect(() => { if (profile.data) setSource(profile.data.credentialSource); }, [profile.data?.credentialSource]);
  const selected = selectedApiModel(models.catalog, model);

  async function run(action: () => Promise<unknown>, success: string, clearKey = false) {
    setBusy(true); setError(null); setNotice(null);
    try { await action(); settingsChanged(); setNotice(success); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not update settings.'); settingsChanged(); }
    finally { setBusy(false); if (clearKey) setApiKey(''); }
  }
  const update = (body: object) => apiRequest<UserSettings>('/api/settings', { method: 'PATCH', body: JSON.stringify(body) });
  const key = profile.data?.personalKey;
  return <div className="library">
    <header className="library-header"><PaperMark /><a className="library-text-button" href={import.meta.env.BASE_URL}>‹ Back to library</a></header>
    <main className="library-main profile-main">
      <div className="library-heading"><div><p className="profile-eyebrow">YOUR ACCOUNT</p><h1>Profile &amp; Settings</h1><p>{email}</p></div>
        <button className="library-text-button" disabled={busy} onClick={() => void run(signOut, 'Signed out.')}>Sign out</button>
      </div>
      {notice && <p className="library-feedback" role="status">{notice}</p>}
      {(error || profile.error) && <p className="library-feedback library-error" role="alert">{error ?? profile.error} <button className="library-text-button" onClick={profile.refresh}>Retry</button></p>}
      {profile.loading && !profile.data ? <p role="status">Loading your settings…</p> : profile.data && <div className="profile-grid">
        <section className="profile-card" aria-labelledby="connection-heading">
          <div className="profile-card-heading"><span className="profile-step">01</span><div><h2 id="connection-heading">Meta connection</h2><p>Choose whose API access your tours use.</p></div></div>
          <fieldset disabled={busy} className="profile-sources"><legend>API access</legend>
            <label><input type="radio" name="credential-source" value="app" checked={source === 'app'} onChange={() => setSource('app')} /><span><strong>Server API key</strong><small>Uses the API key configured in the server’s .env file{profile.data.appKeyAvailable ? '.' : ' · not configured.'}</small></span></label>
            <label><input type="radio" name="credential-source" value="personal" checked={source === 'personal'} onChange={() => setSource('personal')} /><span><strong>My API key</strong><small>Uses the API key saved in your profile. No fallback to the server API key.</small></span></label>
          </fieldset>
          {source !== profile.data.credentialSource && <button className="library-button primary" disabled={busy} onClick={() => void run(() => update({ credentialSource: source }), 'API connection updated.')}>Use this connection</button>}
          <div className="profile-connection-state"><span className={`profile-dot${key?.configured && key.status === 'valid' ? ' connected' : ''}`} />
            <div><strong>{key?.configured ? `Saved key ${key.masked}` : 'No personal key saved'}</strong><p>{key?.configured ? `Last check: ${key.status === 'valid' ? 'connected' : 'unavailable'}${key.checkedAt ? ` · ${new Date(key.checkedAt).toLocaleString()}` : ''}` : 'Add a key to use your own Meta account.'}</p></div>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); void run(() => apiRequest('/api/settings/meta-key', { method: 'PUT', body: JSON.stringify({ apiKey }) }), 'Key verified, encrypted and connected.', true); }}>
            <label className="profile-field" htmlFor="meta-api-key">{key?.configured ? 'Replace Meta API key' : 'Meta API key'}</label>
            <input id="meta-api-key" className="profile-key-input" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} disabled={busy} placeholder="Enter your Meta API key" />
            <p className="profile-help">Encrypted in Supabase Vault. After saving, only the last four characters are shown. The key is used by the server and never included in paper or tour data.</p>
            <div className="profile-actions"><button className="library-button primary" type="submit" disabled={busy || apiKey.trim().length < 16}>{busy ? 'Working…' : 'Save & connect'}</button>
              <button className="library-button" type="button" disabled={busy || !!apiKey || source !== profile.data.credentialSource || (source === 'personal' ? !key?.configured : !profile.data.appKeyAvailable)} onClick={() => void run(() => apiRequest('/api/settings/test', { method: 'POST' }), 'Connection verified.')}>Test current connection</button>
              {key?.configured && <button className="library-text-button profile-remove" type="button" disabled={busy} onClick={() => { if (window.confirm('Remove your saved Meta key from this app? This does not revoke it at Meta.')) void run(() => apiRequest('/api/settings/meta-key', { method: 'DELETE' }), 'Personal key removed.', true); }}>Remove key</button>}
            </div>
          </form>
          {profile.data.credentialSource === 'personal' && !key?.configured && <p className="profile-help">Your PDFs remain readable. Tour creation waits until you connect a personal key or choose the shared connection.</p>}
        </section>
        <section className="profile-card" aria-labelledby="model-heading">
          <div className="profile-card-heading"><span className="profile-step">02</span><div><h2 id="model-heading">Model &amp; API pricing</h2><p>Your default for new PDFs and new tour versions.</p></div></div>
          <ModelPicker catalog={models.catalog} model={model} onModelChange={setModel} allowTraining={false} onAllowTrainingChange={() => {}} requestTrainingConsent={false} disabled={busy || models.loading} label="Default tour model" />
          {models.error && <p className="library-error" role="alert">{models.error} <button className="library-text-button" onClick={models.refresh}>Retry model list</button></p>}
          <button className="library-button primary" disabled={busy || !selected?.tourCompatible || selected.available === false || model === profile.data.defaultModel} onClick={() => void run(() => update({ defaultModel: model }), 'Default model saved. Existing tours are kept.')}>Save default model</button>
        </section>
      </div>}
    </main>
  </div>;
}
