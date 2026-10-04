'use client';

// «Герої місяця» — under «Дивитись усі турніри» on the home page (variant 3
// of the mock-ups, the FIFA «Team of the Week» / Strava weekly leaderboard,
// but over the last 30 days). A podium of the three players who gained the
// most Ело, and a strip of the month's club facts: a hot streak, tournament
// wins, new players, games played.

import { pluralUk as plural } from '@/lib/pluralize';
import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { teamAWon } from '@/lib/formats/sets';
import PlayerAvatar from '@/components/PlayerAvatar';
import { getCached, setCached, memoize } from '@/lib/clientCache';
import styles from './HeroesOfMonth.module.css';

const DAYS = 30;
const KEY = 'home:heroes';

// PostgREST returns at most 1000 rows per request.
async function fetchAll(makeQuery) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await makeQuery().range(from, from + 999);
    if (error || !data) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const shortName = (p) => {
  const last = p?.last_name?.trim();
  if (!last) return p?.full_name || '—';
  const first = (p.full_name || '').replace(last, '').trim().split(/\s+/)[0];
  return first ? `${last} ${first[0]}.` : last;
};


async function loadHeroes(supabase) {
  // Counted in the database (migration 059) — a few rows instead of a
  // month of games and Ело changes; the old way is the fallback.
  const rpc = await supabase.rpc('heroes_month', { p_days: DAYS });
  if (!rpc.error && rpc.data) {
    const h = rpc.data;
    const ids = [...new Set([...(h.podium || []).map((r) => r.id), h.streak?.id, h.champ?.id].filter(Boolean))];
    const { data: people } = ids.length
      ? await supabase.from('users').select('id, full_name, last_name, photo_url').in('id', ids)
      : { data: [] };
    const by = new Map((people || []).map((p) => [p.id, p]));
    return {
      podium: (h.podium || []).map((r) => ({ player: by.get(r.id) || { id: r.id }, gain: r.gain })),
      streak: h.streak ? { player: by.get(h.streak.id), n: h.streak.n } : null,
      champ: h.champ && h.champ.n > 1 ? { player: by.get(h.champ.id), n: h.champ.n } : null,
      newPlayers: h.newPlayers || 0,
      games: h.games || 0,
    };
  }

  const since = new Date(Date.now() - DAYS * 24 * 60 * 60 * 1000).toISOString();

  const [elo, matches, { data: doneCats }, { count: newPlayers }] = await Promise.all([
    fetchAll(() =>
      supabase.from('elo_history').select('user_id, delta').eq('reason', 'tournament_result').gte('created_at', since)
    ),
    fetchAll(() =>
      supabase
        .from('tournament_matches')
        .select('team_a_players, team_b_players, set1, set2, set3, played_at')
        .eq('played', true)
        .gte('played_at', since)
        .order('played_at', { ascending: false })
    ),
    supabase.from('tournament_categories').select('id').eq('status', 'done').gte('finished_at', since),
    supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('approval_status', 'approved')
      .gte('created_at', since),
  ]);

  // Podium: most Ело gained in the period.
  const gain = new Map();
  elo.forEach((r) => gain.set(r.user_id, (gain.get(r.user_id) || 0) + r.delta));
  const top = [...gain.entries()]
    .filter(([, g]) => g > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // Hottest current streak among this month's games (newest first).
  const results = new Map();
  matches.forEach((m) => {
    const aWon = teamAWon(m);
    (m.team_a_players || []).forEach((id) => results.set(id, [...(results.get(id) || []), aWon]));
    (m.team_b_players || []).forEach((id) => results.set(id, [...(results.get(id) || []), !aWon]));
  });
  let streak = null;
  for (const [id, list] of results) {
    let n = 0;
    for (const won of list) {
      if (!won) break;
      n++;
    }
    if (n >= 3 && (!streak || n > streak.n)) streak = { id, n };
  }

  // Tournament wins this month.
  const catIds = (doneCats || []).map((c) => c.id);
  const { data: firsts } = catIds.length
    ? await supabase.from('tournament_placements').select('user_id').eq('place', 1).in('category_id', catIds)
    : { data: [] };
  const winsBy = new Map();
  (firsts || []).forEach((r) => winsBy.set(r.user_id, (winsBy.get(r.user_id) || 0) + 1));
  const champ = [...winsBy.entries()].sort((a, b) => b[1] - a[1])[0] || null;

  const ids = [...new Set([...top.map(([id]) => id), streak?.id, champ?.[0]].filter(Boolean))];
  const { data: people } = ids.length
    ? await supabase.from('users').select('id, full_name, last_name, photo_url').in('id', ids)
    : { data: [] };
  const byId = new Map((people || []).map((p) => [p.id, p]));

  return {
    podium: top.map(([id, g]) => ({ player: byId.get(id) || { id }, gain: g })),
    streak: streak ? { player: byId.get(streak.id), n: streak.n } : null,
    champ: champ && champ[1] > 1 ? { player: byId.get(champ[0]), n: champ[1] } : null,
    newPlayers: newPlayers || 0,
    games: matches.length,
  };
}

export default function HeroesOfMonth() {
  const [data, setData] = useState(() => getCached(KEY) || null);

  useEffect(() => {
    let alive = true;
    // Fresh at most every 10 minutes: the month's podium hardly moves,
    // and this used to scan 30 days of games on every visit to the home.
    memoize('home:heroes:fresh', 10 * 60 * 1000, () => loadHeroes(createClient())).then((d) => {
      setCached(KEY, d);
      if (alive) setData(d);
    });
    return () => {
      alive = false;
    };
  }, []);

  if (!data || data.podium.length === 0) return null;

  // On the podium: 2nd — 1st — 3rd.
  const [first, second, third] = data.podium;
  const order = [
    second && { ...second, place: 2 },
    first && { ...first, place: 1 },
    third && { ...third, place: 3 },
  ].filter(Boolean);

  const facts = [
    data.streak && `🔥 ${shortName(data.streak.player)} — ${data.streak.n} ${plural(data.streak.n, 'перемога', 'перемоги', 'перемог')} поспіль`,
    data.champ && `🏆 ${shortName(data.champ.player)} — ${data.champ.n} ${plural(data.champ.n, 'турнір', 'турніри', 'турнірів')} виграно`,
    data.games > 0 && `🏐 ${data.games} ${plural(data.games, 'гра', 'гри', 'ігор')} за місяць`,
    data.newPlayers > 0 && `🆕 ${data.newPlayers} ${plural(data.newPlayers, 'новий гравець', 'нових гравці', 'нових гравців')}`,
  ].filter(Boolean);

  return (
    <div className={`${styles.card} riseIn`}>
      <span className={styles.shine} aria-hidden="true" />
      <div className={styles.head}>
        <span className={styles.label}>Герої місяця</span>
        <span className={styles.chip}>Ело за 30 днів</span>
      </div>

      <div className={styles.podium}>
        {order.map((r) => (
          <a
            key={r.player.id}
            href={`/players/${r.player.id}`}
            className={`${styles.col} ${r.place === 1 ? styles.colFirst : ''}`}
          >
            <span className={`${styles.av} ${r.place === 1 ? styles.avFirst : ''}`}>
              <PlayerAvatar player={r.player} size={r.place === 1 ? 52 : 44} />
            </span>
            <span className={styles.name}>{shortName(r.player)}</span>
            <span
              className={`${styles.block} ${r.place === 1 ? styles.gold : r.place === 2 ? styles.silver : styles.bronze}`}
            >
              <span className={styles.place}>{r.place}</span>
              <span className={styles.gain}>+{r.gain}</span>
            </span>
          </a>
        ))}
      </div>

      {facts.length > 0 && (
        <div className={styles.ticker}>
          {facts.map((f) => (
            <span key={f} className={styles.fact}>
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
