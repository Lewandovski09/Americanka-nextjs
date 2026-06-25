'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './tournaments.module.css';

const TABS = { SCHEDULED: 'scheduled', LIVE: 'live', DONE: 'done' };

export default function TournamentsPage() {
  const { player } = useCurrentPlayer();
  const [tab, setTab] = useState(TABS.SCHEDULED);
  const [tournaments, setTournaments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const supabase = createClient();
      const { data } = await supabase
        .from('tournaments')
        .select(
          `id, name, category, gender, status, location, courts, scheduled_at, winner_player_id,
           tournament_players(player_id, players(full_name, photo_url))`
        )
        .eq('status', tab)
        .order('scheduled_at', { ascending: tab === 'done' ? false : true });
      setTournaments(data || []);
      setLoading(false);
    }
    load();
  }, [tab]);

  return (
    <div className={styles.page}>
      <div className={styles.tabs}>
        <TabBtn active={tab === TABS.SCHEDULED} onClick={() => setTab(TABS.SCHEDULED)}>
          Розклад
        </TabBtn>
        <TabBtn active={tab === TABS.LIVE} onClick={() => setTab(TABS.LIVE)}>
          Активні
        </TabBtn>
        <TabBtn active={tab === TABS.DONE} onClick={() => setTab(TABS.DONE)}>
          Завершені
        </TabBtn>
      </div>

      {player?.is_admin && tab === TABS.SCHEDULED && (
        <Link href="/tournaments/create" className={styles.createBtn}>
          + Створити турнір
        </Link>
      )}

      {loading && <div className={styles.empty}>Завантаження...</div>}

      {!loading && tournaments.length === 0 && <div className={styles.empty}>Немає турнірів</div>}

      {!loading &&
        tournaments.map((t) => (
          <Link key={t.id} href={`/tournaments/${t.id}`} className={styles.card}>
            <div className={styles.cardHeader}>
              <div className={styles.cardName}>{t.name}</div>
              <span className={`${styles.badge} ${t.gender === 'M' ? styles.badgeM : styles.badgeF}`}>
                {t.gender === 'M' ? 'Чоловіки' : 'Жінки'}
              </span>
            </div>
            <div className={styles.cardMeta}>
              {new Date(t.scheduled_at).toLocaleString('uk', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
              {t.location === 'beach13' ? 'Beach 13' : 'Dynamo SC'} · Кат. {t.category}
            </div>
            <div className={styles.avatarRow}>
              {(t.tournament_players || []).map((tp) => (
                <PlayerAvatar key={tp.player_id} player={tp.players} size={28} />
              ))}
            </div>
          </Link>
        ))}
    </div>
  );
}

function TabBtn({ active, onClick, children }) {
  return (
    <button className={`${styles.tabBtn} ${active ? styles.tabBtnOn : ''}`} onClick={onClick}>
      {children}
    </button>
  );
}
