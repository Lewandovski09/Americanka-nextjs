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

    async function load() {
      const { data: authData } = await supabase.auth.getUser();
      if (!authData?.user) {
        setPlayer(null);
        setLoading(false);
        return;
      }

      const { data: profile } = await supabase
        .from('players')
        .select('*')
        .eq('id', authData.user.id)
        .single();

      setPlayer(profile);
      setLoading(false);
    }

    load();

    const { data: listener } = supabase.auth.onAuthStateChange(() => load());
    return () => listener.subscription.unsubscribe();
  }, []);

  return { player, loading };
}
