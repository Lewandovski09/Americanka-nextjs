'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    const supabase = createClient();
    let isMounted = true;

    async function load(reason) {
      console.log('[useCurrentPlayer] load() called, reason:', reason);
      try {
        console.log('[useCurrentPlayer] step 1: calling auth.getUser()...');
        const authResult = await withTimeout(
          supabase.auth.getUser(),
          8000,
          { data: { user: null }, error: { message: 'timeout' } }
        );
        console.log('[useCurrentPlayer] step 1 done:', authResult);
        const { data: authData, error: authError } = authResult;

        if (authError || !authData?.user) {
          if (authError?.message === 'timeout') {
            console.error('[useCurrentPlayer] auth.getUser() timed out after 8s');
          }
          console.log('[useCurrentPlayer] no user, setting player=null');
          if (isMounted) {
            setPlayer(null);
            setLoading(false);
          }
          return;
        }

        console.log('[useCurrentPlayer] step 2: fetching player profile for id', authData.user.id);
        const profileResult = await withTimeout(
          supabase.from('players').select('*').eq('id', authData.user.id).maybeSingle(),
          8000,
          { data: null, error: { message: 'timeout' } }
        );
        console.log('[useCurrentPlayer] step 2 done:', profileResult);
        const { data: profile, error: profileError } = profileResult;

        if (profileError) {
          console.error('[useCurrentPlayer] Failed to load profile:', profileError.message);
        }

        console.log('[useCurrentPlayer] setting player and loading=false', profile);
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

    load('initial');

    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      console.log('[useCurrentPlayer] onAuthStateChange fired, event:', event);
      load('authStateChange:' + event);
    });
    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  return { player, loading };
}
