'use client';

import { createContext, createElement, useCallback, useContext, useEffect, useState } from 'react';
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

const PlayerContext = createContext(null);

/**
 * Loads the signed-in player ONCE for the whole app (mounted in the root
 * layout). Every page used to call the loader itself, so every tap on the
 * bottom nav re-ran auth.getUser() and the profile query — two network
 * round trips and a skeleton before anything could show. Now a page
 * reads the already-loaded row from context and renders at once.
 */
export function PlayerProvider({ children }) {
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

    // Only a real change of who is signed in needs a reload. The initial
    // event duplicates the load above, and the hourly token refresh does
    // not change the player.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') load();
    });
    return () => {
      isMounted = false;
      listener.subscription.unsubscribe();
    };
  }, [reloadKey]);

  return createElement(PlayerContext.Provider, { value: { player, loading, refresh } }, children);
}

/**
 * The current authenticated user's profile row (from `users`, not just
 * the bare Supabase Auth user). Redirect logic is left to the caller.
 */
export function useCurrentPlayer() {
  const ctx = useContext(PlayerContext);
  if (!ctx) throw new Error('useCurrentPlayer must be used inside <PlayerProvider> (app/layout.js)');
  return ctx;
}
