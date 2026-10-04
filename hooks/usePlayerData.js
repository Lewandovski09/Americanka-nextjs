'use client';

// Everything a profile page shows about one player, loaded once, in
// parallel, and shared by the own profile (app/profile) and another
// player's page (app/players/[id]) — they used to carry two copies of
// the same four requests and caching.
//
//   tournamentHistory — get_user_tournament_history
//   eloGameLog        — get_user_elo_log
//   gameData          — { games, people } (lib/playerGames, shared cache)
//   headerStats       — Ело rank, AVP place, win streak (lib/playerHeaderStats)
//
// The last result is kept in the tab-wide cache: coming back shows it at
// once, the fresh one replaces it a moment later.

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { getCached, setCached } from '@/lib/clientCache';
import { loadPlayerGamesShared } from '@/lib/playerGames';
import { loadPlayerHeaderStats } from '@/lib/playerHeaderStats';

const EMPTY = { th: [], elog: [], games: { games: [], people: {} }, header: null };

export function usePlayerData(player) {
  const id = player?.id || null;
  const key = id ? `pdata:${id}` : null;
  const [data, setData] = useState(() => (key && getCached(key)) || EMPTY);

  useEffect(() => {
    if (!id) return;
    const hit = getCached(key);
    setData(hit || EMPTY);
    let alive = true;
    const supabase = createClient();
    Promise.all([
      supabase.rpc('get_user_tournament_history', { p_user_id: id }),
      supabase.rpc('get_user_elo_log', { p_user_id: id }),
      loadPlayerGamesShared(supabase, id),
      loadPlayerHeaderStats(supabase, player),
    ]).then(([{ data: th }, { data: elog }, games, header]) => {
      const fresh = { th: th || [], elog: elog || [], games, header };
      setCached(key, fresh);
      setCached(`header:${id}`, header);
      if (alive) setData(fresh);
    });
    return () => {
      alive = false;
    };
    // The player's Ело / gender change the header numbers — reload then.
  }, [id, player?.elo, player?.gender]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    tournamentHistory: data.th,
    eloGameLog: data.elog,
    gameData: data.games,
    headerStats: data.header,
  };
}
