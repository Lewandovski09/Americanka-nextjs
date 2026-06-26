'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

/**
 * Returns the current authenticated user's full player profile row
 * (from the `players` table, not just the bare Supabase Auth user).
 * Redirects logic is left to the calling page — this hook only
 * fetches data.
 */
export function useCurrentPlayer() {
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    async function load() {
      try {
        const { data: authData, error: authError } = await supabase.auth.getUser();

        if (authError || !authData?.user) {
          if (isMounted) {
            setPlayer(null);
            setLoading(false);
          }
          return;
        }

        const { data: profile, error: profileError } = await supabase
          .from('players')
          .select('*')
          .eq('id', authData.user.id)
          .maybeSingle();

        if (profileError) {
          console.error('[useCurrentPlayer] Failed to load profile:', profileError.message);
        }

        if (isMounted) {
          setPlayer(profile || null);
          setLoading(false);
        }
      } catch (err) {
        // Any unexpected error (network failure, etc.) must still
        // resolve loading — otherwise the page hangs forever on
        // a "Завантаження..." screen, which is exactly the bug we're fixing.
        console.error('[useCurrentPlayer] Unexpected error:', err.message);
        if (isMounted) {
          setPlayer(null);
          setLoading(false);
        }
      }
    }

    load();

    const { data: listener } = supabase.auth.onAuthStateChange(() => load());
    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return { player, loading };
}
