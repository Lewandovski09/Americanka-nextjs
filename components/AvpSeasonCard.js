'use client';

// A player's AVP: the total, where it puts them, and every tournament
// that fed it. The breakdown is the point of the ledger — «звідки в мене
// 400» is answerable, and a result worth nothing is listed as such rather
// than silently missing.
//
// `scope` picks what is shown:
//   • a season row  → that season (rank among the same gender);
//   • 'all'         → every season added together (no rank — there is no
//                     all-time leaderboard);
//   • undefined     → the current club season.
// Shown on both the own profile and another player's page, so it takes
// nothing but an id and does its own loading.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { IconChevronDown } from '@/components/Icons';
import { loadClubSeasons, seasonDates } from '@/lib/seasons';
import { getCached, setCached } from '@/lib/clientCache';
import styles from './AvpSeasonCard.module.css';

export default function AvpSeasonCard({ playerId, gender, scope }) {
  const scopeKey = scope === 'all' ? 'all' : scope?.id || 'current';
  const cacheKey = playerId ? `avpcard:${playerId}:${scopeKey}` : null;
  const cached = cacheKey ? getCached(cacheKey) : undefined;

  const [data, setData] = useState(cached || null); // { season, total, rank, rows }
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;
    const hit = getCached(cacheKey);
    setData(hit || null);
    setExpanded(false);

    async function load() {
      const supabase = createClient();
      const breakdownSelect = `id, place, points, tier, category_id, season_id,
         tournament_categories(category_label, gender),
         tournament_events(name, scheduled_at)`;

      if (scope === 'all') {
        const { data: rows } = await supabase.from('avp_points').select(breakdownSelect).eq('user_id', playerId);
        const list = sortRows(rows || []);
        const result = {
          season: 'all',
          total: { points: list.reduce((s, r) => s + (r.points || 0), 0), tournaments_counted: list.length },
          rank: null,
          rows: list,
        };
        setCached(cacheKey, result);
        if (!cancelled) setData(result);
        return;
      }

      const season = scope || (await loadClubSeasons(supabase)).avp;
      if (!season) {
        if (!cancelled) setData({ season: null, total: null, rank: null, rows: [] });
        return;
      }

      // All three at once: the standings, this player's ledger, and who
      // is of the same gender (the rank is counted among them, exactly
      // like the AVP leaderboard — otherwise the two numbers disagree).
      const [{ data: standings }, { data: breakdown }, { data: sameGender }] = await Promise.all([
        supabase
          .from('avp_standings')
          .select('user_id, points, tournaments_counted')
          .eq('season_id', season.id)
          .order('points', { ascending: false }),
        supabase.from('avp_points').select(breakdownSelect).eq('user_id', playerId).eq('season_id', season.id),
        gender ? supabase.from('users').select('id').eq('gender', gender) : Promise.resolve({ data: null }),
      ]);

      const mine = (standings || []).find((s) => s.user_id === playerId) || null;
      let rank = null;
      if (mine && sameGender) {
        const ids = new Set(sameGender.map((p) => p.id));
        const idx = (standings || []).filter((s) => ids.has(s.user_id)).findIndex((s) => s.user_id === playerId);
        rank = idx >= 0 ? idx + 1 : null;
      }

      const result = { season, total: mine, rank, rows: sortRows(breakdown || []) };
      setCached(cacheKey, result);
      if (!cancelled) setData(result);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [playerId, gender, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className={styles.empty}>Завантаження...</div>;
  const { season, total, rank, rows } = data;
  if (!season) return <div className={styles.empty}>Сезон ще не створено</div>;
  const allTime = season === 'all';

  return (
    <>
      <button className={styles.card} onClick={() => setExpanded((e) => !e)} disabled={rows.length === 0}>
        <div className={styles.seasonName}>{allTime ? 'За весь час' : `${season.name} · ${seasonDates(season)}`}</div>
        <div className={styles.totalRow}>
          <div className={styles.total}>{total?.points ?? 0}</div>
          <div className={styles.totalLabel}>
            очок AVP
            {rank ? ` · ${rank}-е місце` : ''}
          </div>
          {rows.length > 0 && (
            <span className={`${styles.arrow} ${expanded ? styles.arrowOpen : ''}`}>
              <IconChevronDown size={13} />
            </span>
          )}
        </div>
        <div className={styles.sub}>
          {total?.tournaments_counted
            ? `Турнірів у заліку: ${total.tournaments_counted}`
            : allTime
            ? 'Ще немає зарахованих турнірів'
            : 'Ще немає зарахованих турнірів у цьому сезоні'}
        </div>
      </button>

      {expanded &&
        rows.map((r) => (
          <Link key={r.id} href={`/tournaments/${r.category_id}`} className={styles.row}>
            <div className={styles.rowMain}>
              <div className={styles.rowName}>
                {r.tournament_events?.name || 'Турнір'}
                {r.tournament_categories?.category_label ? ` · ${r.tournament_categories.category_label}` : ''}
              </div>
              <div className={styles.rowMeta}>
                {r.tournament_events?.scheduled_at
                  ? new Date(r.tournament_events.scheduled_at).toLocaleDateString('uk', {
                      day: 'numeric',
                      month: 'short',
                      ...(allTime ? { year: 'numeric' } : {}),
                    })
                  : '—'}{' '}
                · AVP {r.tier} · {r.place}-є місце
              </div>
            </div>
            <div className={r.points > 0 ? styles.points : styles.pointsZero}>+{r.points}</div>
          </Link>
        ))}
    </>
  );
}

function sortRows(list) {
  return [...list].sort(
    (a, b) =>
      b.points - a.points ||
      new Date(b.tournament_events?.scheduled_at || 0) - new Date(a.tournament_events?.scheduled_at || 0)
  );
}
