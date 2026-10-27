import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { getSupabase } from './client';

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [recovering, setRecovering] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      setLoading(false);
      return;
    }
    let alive = true;
    let authEventSeen = false;
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, next) => {
      authEventSeen = true;
      if (!alive) return;
      setSession(next);
      setLoading(false);
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
    });
    supabase.auth
      .getSession()
      .then(({ data, error: sessionError }) => {
        if (!alive || authEventSeen) return;
        setSession(data.session);
        setError(sessionError?.message ?? null);
        setLoading(false);
      })
      .catch((cause: unknown) => {
        if (!alive || authEventSeen) return;
        setError(cause instanceof Error ? cause.message : 'Could not restore your session.');
        setLoading(false);
      });
    return () => {
      alive = false;
      subscription.unsubscribe();
    };
  }, []);

  return { session, loading, recovering, finishRecovery: () => setRecovering(false), error };
}
