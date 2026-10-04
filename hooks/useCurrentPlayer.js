'use client';

import { USER_COLUMNS } from '@/lib/userColumns';
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
// The last loaded profile is kept on the device, so a cold start of the
// app can draw the signed-in UI at once instead of a skeleton; the fresh
// row replaces it a moment later. Wrapped in try/catch: private mode and
// blocked storage simply skip it.
const ME_KEY = 'americanka:me';
function readMe() {
  try {
    const raw = window.localStorage.getItem(ME_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeMe(p) {
  try {
    if (p) window.localStorage.setItem(ME_KEY, JSON.stringify(p));
    else window.localStorage.removeItem(ME_KEY);
  } catch {
    /* ignore */
  }
}

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

    const done = (p) => {
      if (!isMounted) return;
      setPlayer(p);
      setLoading(false);
      writeMe(p);
    };

    async function load() {
      try {
        // getSession() is read from the device — no network. It gives the
        // user id at once, so the profile request starts immediately; the
        // server-verified getUser() runs alongside and wins if the session
        // turns out to be gone.
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionUser = sessionData?.session?.user || null;
        if (!sessionUser) {
          done(null);
          return;
        }

        // The cached row first (same account only), then the fresh one.
        const cachedMe = readMe();
        if (cachedMe && cachedMe.id === sessionUser.id && isMounted) {
          setPlayer(cachedMe);
          setLoading(false);
        }

        const [authResult, profileResult] = await Promise.all([
          withTimeout(supabase.auth.getUser(), 8000, { data: { user: null }, error: { message: 'timeout' } }),
          withTimeout(
            supabase.from('users').select(USER_COLUMNS).eq('id', sessionUser.id).maybeSingle(),
            8000,
            { data: null, error: { message: 'timeout' } }
          ),
        ]);

        const { data: authData, error: authError } = authResult;
        if (authError?.message === 'timeout') {
          console.error('[useCurrentPlayer] auth.getUser() timed out after 8s');
        }
        if (!authError && !authData?.user) {
          done(null); // the session was revoked on the server
          return;
        }

        const { data: profile, error: profileError } = profileResult;
        if (profileError) {
          console.error('[useCurrentPlayer] Failed to load profile:', profileError.message);
          if (isMounted) setLoading(false);
          return;
        }
        done(profile || null);
      } catch (err) {
        console.error('[useCurrentPlayer] Unexpected error:', err.message);
        done(null);
      }
    }

    load();

    // Only a real change of who is signed in needs a reload. The initial
    // event duplicates the load above, and the hourly token refresh does
    // not change the player.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') writeMe(null);
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
