import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { UserSettings } from '../../../shared/settings';
import { PaperMark } from './AuthForm';
import { apiRequest, signOut } from './client';
import { useSettings, settingsChanged } from './useSettings';
import { useModelCatalog } from './useModelCatalog';
import { selectedApiModel } from './modelChoices';
import { ModelPicker } from '../components/ModelPicker';
import { getThemePreference, setThemePreference, subscribeTheme, THEME_OPTIONS } from '../theme';
import '../profileSettings.css';

export function ProfileSettings({ email }: { email: string }) {
  const profile = useSettings();
  const models = useModelCatalog();
  const [model, setModel] = useState('');
  const [source, setSource] = useState<'app' | 'personal'>('app');
  const [apiKey, setApiKey] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectionHeading = useRef<HTMLHeadingElement>(null);
  const modelHeading = useRef<HTMLHeadingElement>(null);
  const theme = useSyncExternalStore(subscribeTheme, getThemePreference);
  useEffect(() => {
    if (profile.data) setModel(profile.data.defaultModel);
  }, [profile.data?.defaultModel]);
  useEffect(() => {
    if (profile.data) setSource(profile.data.credentialSource);
  }, [profile.data?.credentialSource]);
  const selected = selectedApiModel(models.catalog, model);
  const busy = pending !== null;

  async function run(action: string, execute: () => Promise<unknown>, success: string, clearKey = false) {
    setPending(action);
    setError(null);
    setNotice(null);
    try {
      await execute();
      if (clearKey) setApiKey('');
      settingsChanged();
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not update settings.');
      // A failed verification can update the saved key status; keep that status current without clearing the draft.
      settingsChanged();
    } finally {
      setPending(null);
    }
  }
  const update = (body: object) =>
    apiRequest<UserSettings>('/api/settings', { method: 'PATCH', body: JSON.stringify(body) });
  const data = profile.data;
  const key = data?.personalKey;
  const sourceChanged = !!data && source !== data.credentialSource;
  const connected = data?.credentialSource === 'app' ? data.appKeyAvailable : key?.configured && key.status === 'valid';
  const activeLabel = data?.credentialSource === 'app' ? 'Shared connection' : 'Personal API key';

  return (
    <div className="library">
      <header className="library-header">
        <PaperMark />
        <a className="library-text-button" href={import.meta.env.BASE_URL}>
          ‹ Back to library
        </a>
      </header>
      <main className="library-main profile-main">
        <div className="library-heading">
          <div>
            <h1>Settings</h1>
            <p className="profile-email">{email}</p>
          </div>
          <button
            className="library-text-button"
            disabled={busy}
            onClick={() => void run('signout', signOut, 'Signed out.')}
          >
            Sign out
          </button>
        </div>
        <nav className="profile-nav" aria-label="Settings sections">
          <a href="#appearance">Appearance</a>
          <a href="#connection">Connection</a>
          <a href="#tour-model">Tour model</a>
        </nav>
        {notice && (
          <p className="library-feedback library-notice" role="status">
            {notice}
          </p>
        )}
        {(error || profile.error) && (
          <p className="library-feedback library-error" role="alert">
            {error ?? profile.error}{' '}
            {profile.error && (
              <button className="library-text-button" onClick={profile.refresh}>
                Retry
              </button>
            )}
          </p>
        )}
        <div className="profile-grid">
          <section className="profile-card" id="appearance" aria-labelledby="appearance-heading">
            <div className="profile-card-heading">
              <h2 id="appearance-heading">Appearance</h2>
              <p>Choose how Paper Tour looks on this browser.</p>
            </div>
            <fieldset className="profile-themes">
              <legend className="profile-field">Color theme</legend>
              {THEME_OPTIONS.map(({ id: value, label }) => (
                <label key={value} className={`profile-theme ${theme === value ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="theme"
                    value={value}
                    checked={theme === value}
                    onChange={() => setThemePreference(value)}
                  />
                  <span className={`profile-theme-preview ${value}`} aria-hidden="true">
                    <i />
                    <i />
                    <i />
                  </span>
                  <span>{label}</span>
                </label>
              ))}
            </fieldset>
            <p className="profile-help">Saved automatically. System follows your device’s appearance.</p>
          </section>
          {profile.loading && !data ? (
            <p role="status">Loading your settings…</p>
          ) : (
            data && (
              <>
                <section className="profile-card" id="connection" aria-labelledby="connection-heading" aria-busy={busy}>
                  <div className="profile-card-heading">
                    <h2 id="connection-heading" ref={connectionHeading} tabIndex={-1}>Meta connection</h2>
                    <p>Choose the API access used to create tours and answer questions.</p>
                  </div>
                  <div className="profile-connection-state">
                    <span className={`profile-dot${connected ? ' connected' : ''}`} />
                    <div>
                      <strong>
                        {activeLabel} ·{' '}
                        {connected ? (data.credentialSource === 'app' ? 'Configured' : 'Verified') : 'Needs attention'}
                      </strong>
                      <p>
                        {data.credentialSource === 'app'
                          ? data.appKeyAvailable
                            ? 'The app’s shared API access is configured.'
                            : 'Shared API access is not configured. You can connect a personal key below.'
                          : key?.configured
                            ? `Saved key ${key.masked}${key.checkedAt ? ` · checked ${new Date(key.checkedAt).toLocaleString()}` : ''}`
                            : 'Add a personal key or choose the shared connection.'}
                      </p>
                    </div>
                    <button
                      className="library-button"
                      type="button"
                      disabled={
                        busy ||
                        sourceChanged ||
                        !!apiKey ||
                        (data.credentialSource === 'personal' ? !key?.configured : !data.appKeyAvailable)
                      }
                      onClick={() =>
                        void run(
                          'test',
                          () => apiRequest('/api/settings/test', { method: 'POST' }),
                          'Connection verified.',
                        )
                      }
                    >
                      {pending === 'test' ? 'Testing…' : 'Test connection'}
                    </button>
                  </div>
                  <fieldset disabled={busy} className="profile-sources">
                    <legend>API access</legend>
                    <label className={source === 'app' ? 'selected' : ''}>
                      <input
                        type="radio"
                        name="credential-source"
                        value="app"
                        checked={source === 'app'}
                        onChange={() => setSource('app')}
                      />
                      <span>
                        <strong>Shared connection</strong>
                        <small>Use the app’s API access.{!data.appKeyAvailable && ' Not configured yet.'}</small>
                      </span>
                    </label>
                    <label className={source === 'personal' ? 'selected' : ''}>
                      <input
                        type="radio"
                        name="credential-source"
                        value="personal"
                        checked={source === 'personal'}
                        onChange={() => setSource('personal')}
                      />
                      <span>
                        <strong>Personal API key</strong>
                        <small>Use your own Meta account. Shared access is never used with this option.</small>
                      </span>
                    </label>
                  </fieldset>
                  {sourceChanged && (
                    <div className="profile-unsaved">
                      <span>Connection change not saved</span>
                      <button
                        className="library-button primary"
                        disabled={busy}
                        onClick={() =>
                          void run('source', () => update({ credentialSource: source }), 'API connection updated.')
                        }
                      >
                        {pending === 'source' ? 'Saving…' : 'Save connection'}
                      </button>
                      <button
                        className="library-text-button"
                        disabled={busy}
                        onClick={() => {
                          setSource(data.credentialSource);
                          connectionHeading.current?.focus();
                        }}
                      >
                        Discard
                      </button>
                    </div>
                  )}
                  <details className="profile-key-editor" key={source} open={source === 'personal' || undefined}>
                    <summary>{key?.configured ? 'Manage personal key' : 'Add a personal key'}</summary>
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void run(
                          'key',
                          () =>
                            apiRequest('/api/settings/meta-key', { method: 'PUT', body: JSON.stringify({ apiKey }) }),
                          'Personal key verified and connected.',
                          true,
                        );
                      }}
                    >
                      <label className="profile-field" htmlFor="meta-api-key">
                        {key?.configured ? `Replace key ${key.masked}` : 'Meta API key'}
                      </label>
                      <input
                        id="meta-api-key"
                        className="profile-key-input"
                        type="password"
                        autoComplete="off"
                        spellCheck={false}
                        value={apiKey}
                        onChange={(event) => setApiKey(event.target.value)}
                        disabled={busy}
                        placeholder="Enter your Meta API key"
                        aria-describedby="key-help"
                      />
                      <p className="profile-help" id="key-help">
                        Stored encrypted. Only the last four characters are shown after saving. Saving a key connects
                        your personal account.
                      </p>
                      <div className="profile-actions">
                        <button
                          className="library-button primary"
                          type="submit"
                          disabled={busy || apiKey.trim().length < 16}
                        >
                          {pending === 'key' ? 'Connecting…' : 'Save & connect'}
                        </button>
                        {key?.configured && (
                          <button
                            className="library-text-button profile-remove"
                            type="button"
                            disabled={busy}
                            onClick={() => {
                              if (
                                window.confirm(
                                  'Remove your saved Meta key from this app? This does not revoke it at Meta.',
                                )
                              )
                                void run(
                                  'remove',
                                  () => apiRequest('/api/settings/meta-key', { method: 'DELETE' }),
                                  'Personal key removed.',
                                  true,
                                );
                            }}
                          >
                            Remove key
                          </button>
                        )}
                      </div>
                    </form>
                  </details>
                </section>
                <section className="profile-card" id="tour-model" aria-labelledby="model-heading">
                  <div className="profile-card-heading">
                    <h2 id="model-heading" ref={modelHeading} tabIndex={-1}>Default tour model</h2>
                    <p>Used for new PDFs and new tour versions.</p>
                  </div>
                  <ModelPicker
                    catalog={models.catalog}
                    model={model}
                    onModelChange={setModel}
                    disabled={busy || models.loading}
                    loading={models.loading}
                    label="Tour model"
                  />
                  {models.error && (
                    <p className="library-error" role="alert">
                      {models.error}{' '}
                      <button className="library-text-button" onClick={models.refresh}>
                        Retry model list
                      </button>
                    </p>
                  )}
                  <div className="profile-actions">
                    <button
                      className="library-button primary"
                      disabled={
                        busy || !selected?.tourCompatible || selected.available === false || model === data.defaultModel
                      }
                      onClick={() => void run('model', () => update({ defaultModel: model }), 'Default model saved.')}
                    >
                      {pending === 'model' ? 'Saving…' : 'Save model'}
                    </button>
                    {model !== data.defaultModel && <>
                      <button className="library-button" disabled={busy} onClick={() => {
                        setModel(data.defaultModel);
                        modelHeading.current?.focus();
                      }}>
                        Discard model change
                      </button>
                      <span className="profile-help">Model change not saved</span>
                    </>}
                  </div>
                </section>
              </>
            )
          )}
        </div>
      </main>
    </div>
  );
}
