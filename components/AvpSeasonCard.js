'use client';

// A player's AVP season: the total, where it puts them, and every
// tournament that fed it. The breakdown is the point of the ledger —
// «звідки в мене 400» is answerable, and a result worth nothing is
// listed as such rather than silently missing.
//
// Shown on both the own profile and another player's page, so it takes
// nothing but an id and does its own loading.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { IconChevronDown } from '@/components/Icons';
import { loadClubSeasons, seasonDates } from '@/lib/seasons';
import { getCached, setCached } from '@/lib/clientCache';
import styles from './AvpSeasonCard.module.css';

export default function AvpSeasonCard({ playerId, gender }) {
  // Last-known card for this player first (instant on a repeat visit).
  const cached = playerId ? getCached(`avpcard:${playerId}`) : undefined;
  const [season, setSeason] = useState(cached?.season || null);
  const [total, setTotal] = useState(cached?.total || null); // { points, tournaments_counted }
  const [rank, setRank] = useState(cached?.rank || null);
  const [rows, setRows] = useState(cached?.rows || []);
  const [loading, setLoading] = useState(!cached);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;

    async function load() {
      const supabase = createClient();

      // The current club-wide AVP season — the same one the header card
      // and the AVP tab use (lib/seasons, cached for the tab).
      const { avp: current } = await loadClubSeasons(supabase);

      if (cancelled) return;
      setSeason(current);
      if (!current) {
        setLoading(false);
        return;
      }

      // All three at once: the standings, this player's ledger, and who
      // is of the same gender (the rank is counted among them, exactly
      // like the AVP leaderboard — otherwise the two numbers disagree).
      const [{ data: standings }, { data: breakdown }, { data: sameGender }] = await Promise.all([
        supabase
          .from('avp_standings')
          .select('user_id, points, tournaments_counted')
          .eq('season_id', current.id)
          .order('points', { ascending: false }),
        supabase
          .from('avp_points')
          .select(
            `id, place, points, tier, category_id,
             tournament_categories(category_label, gender),
             tournament_events(name, scheduled_at)`
          )
          .eq('user_id', playerId)
          .eq('season_id', current.id),
        gender ? supabase.from('users').select('id').eq('gender', gender) : Promise.resolve({ data: null }),
      ]);

      const mine = (standings || []).find((s) => s.user_id === playerId) || null;

      let place = null;
      if (mine && sameGender) {
        const ids = new Set(sameGender.map((p) => p.id));
        const idx = (standings || []).filter((s) => ids.has(s.user_id)).findIndex((s) => s.user_id === playerId);
        place = idx >= 0 ? idx + 1 : null;
      }

      const sorted = (breakdown || []).sort(
        (a, b) =>
          b.points - a.points ||
          new Date(b.tournament_events?.scheduled_at || 0) - new Date(a.tournament_events?.scheduled_at || 0)
      );
      setCached(`avpcard:${playerId}`, { season: current, total: mine, rank: place, rows: sorted });
      if (cancelled) return;
      setTotal(mine);
      setRank(place);
      setRows(sorted);
      setLoading(false);
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [playerId, gender]);

  if (loading) return <div className={styles.empty}>Завантаження...</div>;
  if (!season) return <div className={styles.empty}>Сезон ще не створено</div>;

  return (
    <>
      <button className={styles.card} onClick={() => setExpanded((e) => !e)} disabled={rows.length === 0}>
        <div className={styles.seasonName}>
          {season.name} · {seasonDates(season)}
        </div>
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
