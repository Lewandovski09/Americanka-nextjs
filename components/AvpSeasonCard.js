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
      let field = null; // how many of the same gender have points this season
      if (sameGender) {
        const ids = new Set(sameGender.map((p) => p.id));
        const board = (standings || []).filter((s) => ids.has(s.user_id));
        field = board.length;
        const idx = mine ? board.findIndex((s) => s.user_id === playerId) : -1;
        rank = idx >= 0 ? idx + 1 : null;
      }

      const result = { season, total: mine, rank, field, rows: sortRows(breakdown || []) };
      setCached(cacheKey, result);
      if (!cancelled) setData(result);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [playerId, gender, cacheKey]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!data) return <div className={styles.empty}>Завантаження...</div>;
  const { season, total, rank, field, rows } = data;
  if (!season) return <div className={styles.empty}>Сезон ще не створено</div>;
  const allTime = season === 'all';

  return (
    <section className={styles.card}>
      <div className={styles.head}>
        <span className={styles.label}>{allTime ? 'AVP · За весь час' : `AVP · ${season.name}`}</span>
        {!allTime && <span className={styles.dates}>{seasonDates(season)}</span>}
      </div>
      <div className={styles.topRow}>
        <div>
          <span className={styles.total}>{total?.points ?? 0}</span>
          <span className={styles.totalLabel}> очок</span>
        </div>
        {rank ? (
          <div className={styles.rank}>
            {rank}-е місце
            {field ? <span>з {field} {field % 10 === 1 && field % 100 !== 11 ? 'гравця' : 'гравців'}</span> : null}
          </div>
        ) : (
          !allTime && <div className={styles.rankNone}>ще без місця</div>
        )}
      </div>

      {rows.length > 0 ? (
        <button type="button" className={styles.toggle} onClick={() => setExpanded((e) => !e)} aria-expanded={expanded}>
          <span>
            Очки за турніри · {rows.length}
          </span>
          <span className={`${styles.arrow} ${expanded ? styles.arrowOpen : ''}`}>
            <IconChevronDown size={13} />
          </span>
        </button>
      ) : (
        <div className={styles.sub}>
          {allTime ? 'Ще немає зарахованих турнірів' : 'Ще немає зарахованих турнірів у цьому сезоні'}
        </div>
      )}

      {expanded && (
        <div className={styles.list}>
          {rows.map((r) => {
            const when = r.tournament_events?.scheduled_at ? new Date(r.tournament_events.scheduled_at) : null;
            const placeCls = r.place === 1 ? styles.p1 : r.place === 2 ? styles.p2 : r.place === 3 ? styles.p3 : styles.pN;
            return (
              <Link key={r.id} href={`/tournaments/${r.category_id}`} className={styles.row}>
                <span className={styles.d}>
                  <b>{when ? when.getDate() : '—'}</b>
                  {when ? when.toLocaleDateString('uk', { month: 'short', ...(allTime ? { year: '2-digit' } : {}) }) : ''}
                </span>
                <span className={`${styles.place} ${placeCls}`}>{r.place}</span>
                <span className={styles.rowMain}>
                  <span className={styles.rowName}>
                    {r.tournament_events?.name || 'Турнір'}
                    {r.tournament_categories?.category_label ? ` · ${r.tournament_categories.category_label}` : ''}
                  </span>
                  <span className={styles.rowMeta}>
                    рівень AVP {r.tier} · {r.points > 0 ? `${r.place}-е місце` : `за ${r.place}-е місце очок немає`}
                  </span>
                </span>
                <span className={r.points > 0 ? styles.points : styles.pointsZero}>
                  {r.points > 0 ? `+${r.points}` : 0}
                  <small>AVP</small>
                </span>
              </Link>
            );
          })}
          {!allTime && (
            <Link href="/rating" className={styles.all} onClick={() => setCached('rating:tab', 'avp')}>
              Вся таблиця AVP →
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

// Newest tournament first — the list reads like a history.
function sortRows(list) {
  return [...list].sort(
    (a, b) =>
      new Date(b.tournament_events?.scheduled_at || 0) - new Date(a.tournament_events?.scheduled_at || 0) ||
      b.points - a.points
  );
}
