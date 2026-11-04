import { useState } from 'react';
import type { FormEvent } from 'react';
import { getSupabase } from './client';
import { BrandMark } from '../brand/BrandMark';

type Mode = 'login' | 'signup' | 'reset' | 'password';

export function AuthForm({
  recovering = false,
  onRecovered,
}: {
  recovering?: boolean;
  onRecovered(): void;
}) {
  const [mode, setMode] = useState<Mode>(recovering ? 'password' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const currentMode = recovering ? 'password' : mode;
  const title = {
    login: 'Your reading, saved.',
    signup: 'Make room for your papers.',
    reset: 'Reset your password.',
    password: 'Choose a new password.',
  }[currentMode];

  function switchMode(next: Mode) {
    if (busy) return;
    setMode(next);
    setError(null);
    setNotice(null);
    setPassword('');
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const supabase = getSupabase()!;
      const redirectTo = `${location.origin}${location.pathname}`;
      if (currentMode === 'login') {
        const { error: authError } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (authError) throw authError;
      } else if (currentMode === 'signup') {
        const { data, error: authError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: redirectTo },
        });
        if (authError) throw authError;
        if (!data.session) setNotice('Check your email to confirm your account, then sign in.');
      } else if (currentMode === 'reset') {
        const { error: authError } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo });
        if (authError) throw authError;
        setNotice('If an account uses this email, a password reset link is on its way.');
      } else {
        const { error: authError } = await supabase.auth.updateUser({ password });
        if (authError) throw authError;
        onRecovered();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not complete this request. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="library-auth-layout">
      <section className="library-auth-intro">
        <PaperMark />
        <h1>{title}</h1>
        <p>Keep your PDFs, find the passages that matter, and return to your place.</p>
        <div className="library-paper-stack" aria-hidden="true">
          <span />
          <span />
          <span>
            <i />
            <i />
            <i />
            <b />
            <i />
            <i />
          </span>
        </div>
      </section>
      <section className="library-auth-panel" aria-label="Account">
        <div className="library-tabs" role="group" aria-label="Account action" hidden={currentMode === 'password'}>
          <button
            type="button"
            className={currentMode === 'login' ? 'selected' : ''}
            aria-pressed={currentMode === 'login'}
            onClick={() => switchMode('login')}
            disabled={busy}
          >
            Sign in
          </button>
          <button
            type="button"
            className={currentMode === 'signup' ? 'selected' : ''}
            aria-pressed={currentMode === 'signup'}
            onClick={() => switchMode('signup')}
            disabled={busy}
          >
            Create account
          </button>
        </div>
        <form className="library-auth-form" onSubmit={(event) => void submit(event)}>
          <h2>
            {currentMode === 'reset'
              ? 'Get a reset link'
              : currentMode === 'password'
                ? 'Update your password'
                : currentMode === 'signup'
                  ? 'Start your library'
                  : 'Welcome back'}
          </h2>
          {currentMode !== 'password' && (
            <label>
              Email
              <input
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                disabled={busy}
                autoFocus
              />
            </label>
          )}
          {currentMode !== 'reset' && (
            <label>
              Password
              <input
                type="password"
                autoComplete={currentMode === 'login' ? 'current-password' : 'new-password'}
                minLength={currentMode === 'login' ? undefined : 8}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                disabled={busy}
                autoFocus={currentMode === 'password'}
              />
            </label>
          )}
          {error && (
            <p className="library-error" role="alert">
              {error}
            </p>
          )}
          {notice && (
            <p className="library-notice" role="status">
              {notice}
            </p>
          )}
          <button className="library-button primary" disabled={busy}>
            {busy
              ? 'Please wait…'
              : { login: 'Sign in', signup: 'Create account', reset: 'Send reset link', password: 'Save password' }[
                  currentMode
                ]}
          </button>
          {currentMode === 'login' && (
            <button type="button" className="library-text-button" disabled={busy} onClick={() => switchMode('reset')}>
              Forgot password?
            </button>
          )}
          {currentMode === 'reset' && (
            <button type="button" className="library-text-button" disabled={busy} onClick={() => switchMode('login')}>
              Back to sign in
            </button>
          )}
        </form>
        <p className="library-auth-footnote">Your documents are private to your account.</p>
      </section>
    </div>
  );
}

export function PaperMark() {
  return (
    <div className="library-brand">
      <BrandMark size={30} />
      <span>Paper Tour</span>
    </div>
  );
}
