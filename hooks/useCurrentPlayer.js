'use client';

import { useCallback, useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

// If a Supabase call hangs (no response at all — not even an
// error), this guarantees we still resolve loading state instead
// of leaving the page stuck on "Завантаження..." forever.
function withTimeout(promise, ms, timeoutValue) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(timeoutValue), ms)),
  ]);
}

/**
 * Returns the current authenticated user's full player profile row
 * (from the `players` table, not just the bare Supabase Auth user).
 * Redirects logic is left to the calling page — this hook only
 * fetches data.
 */
export function useCurrentPlayer() {
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  // Bumped by refresh() to re-run the load below. Pages that change the
  // profile (photo, name, city) call it — router.refresh() cannot help
  // here, this row is fetched on the client.
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((n) => n + 1), []);

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    async function load() {
      try {
        const authResult = await withTimeout(
          supabase.auth.getUser(),
          8000,
          { data: { user: null }, error: { message: 'timeout' } }
        );
        const { data: authData, error: authError } = authResult;

        if (authError || !authData?.user) {
          if (authError?.message === 'timeout') {
            console.error('[useCurrentPlayer] auth.getUser() timed out after 8s');
          }
          if (isMounted) {
            setPlayer(null);
            setLoading(false);
          }
          return;
        }

        const profileResult = await withTimeout(
          supabase.from('users').select('*').eq('id', authData.user.id).maybeSingle(),
          8000,
          { data: null, error: { message: 'timeout' } }
        );
        const { data: profile, error: profileError } = profileResult;

        if (profileError) {
          console.error('[useCurrentPlayer] Failed to load profile:', profileError.message);
        }

        if (isMounted) {
          setPlayer(profile || null);
          setLoading(false);
        }
      } catch (err) {
        console.error('[useCurrentPlayer] Unexpected error:', err.message);
        if (isMounted) {
          setPlayer(null);
          setLoading(false);
        }
      }
    }

    load();

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      load();
    });
    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [reloadKey]);

  return { player, loading, refresh };
}
