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
import styles from './AvpSeasonCard.module.css';

export default function AvpSeasonCard({ playerId, gender }) {
  const [season, setSeason] = useState(null);
  const [total, setTotal] = useState(null); // { points, tournaments_counted }
  const [rank, setRank] = useState(null);
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!playerId) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      const supabase = createClient();

      // The season that covers today, or the most recent one if we are
      // between seasons.
      const today = new Date().toISOString().slice(0, 10);
      const { data: seasons } = await supabase
        .from('avp_seasons')
        .select('id, name, starts_on, ends_on')
        .order('starts_on', { ascending: false });
      const current =
        (seasons || []).find((s) => s.starts_on <= today && s.ends_on >= today) || seasons?.[0] || null;

      if (cancelled) return;
      setSeason(current);
      if (!current) {
        setLoading(false);
        return;
      }

      const [{ data: standings }, { data: breakdown }] = await Promise.all([
        supabase
          .from('avp_standings')
          .select('player_id, points, tournaments_counted')
          .eq('season_id', current.id)
          .order('points', { ascending: false }),
        supabase
          .from('avp_points')
          .select(
            `id, place, points, tier, tournament_id,
             tournaments(category_label, gender),
             tournament_events(name, scheduled_at)`
          )
          .eq('player_id', playerId)
          .eq('season_id', current.id),
      ]);

      const mine = (standings || []).find((s) => s.player_id === playerId) || null;

      // Rank inside the same list the AVP leaderboard shows, i.e. among
      // players of the same gender — otherwise the number here and the
      // number there would disagree.
      let place = null;
      if (mine && gender) {
        const ids = (standings || []).map((s) => s.player_id);
        const { data: profiles } = await supabase.from('players').select('id, gender').in('id', ids);
        const sameGender = new Set(
          (profiles || []).filter((p) => p.gender === gender).map((p) => p.id)
        );
        place = (standings || []).filter((s) => sameGender.has(s.player_id)).findIndex(
          (s) => s.player_id === playerId
        );
        place = place >= 0 ? place + 1 : null;
      }

      if (cancelled) return;
      setTotal(mine);
      setRank(place);
      setRows(
        (breakdown || []).sort(
          (a, b) =>
            b.points - a.points ||
            new Date(b.tournament_events?.scheduled_at || 0) -
              new Date(a.tournament_events?.scheduled_at || 0)
        )
      );
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
      <div className={styles.card}>
        <div className={styles.seasonName}>{season.name}</div>
        <div className={styles.totalRow}>
          <div className={styles.total}>{total?.points ?? 0}</div>
          <div className={styles.totalLabel}>
            очок AVP
            {rank ? ` · ${rank}-е місце` : ''}
          </div>
        </div>
        <div className={styles.sub}>
          {total?.tournaments_counted
            ? `Турнірів у заліку: ${total.tournaments_counted}`
            : 'Ще немає зарахованих турнірів у цьому сезоні'}
        </div>
      </div>

      {rows.map((r) => (
        <Link key={r.id} href={`/tournaments/${r.tournament_id}`} className={styles.row}>
          <div className={styles.rowMain}>
            <div className={styles.rowName}>
              {r.tournament_events?.name || 'Турнір'}
              {r.tournaments?.category_label ? ` · ${r.tournaments.category_label}` : ''}
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
