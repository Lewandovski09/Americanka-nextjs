'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { createClient } from '@/lib/supabase/client';
import { categoryForElo } from '@/lib/elo';
import styles from './page.module.css';

export default function HomePage() {
  const router = useRouter();
  const { player, loading } = useCurrentPlayer();
  const [nextTournament, setNextTournament] = useState(null);
  const [announcements, setAnnouncements] = useState([]);
  const [eloExplainerOpen, setEloExplainerOpen] = useState(false);

  // If nobody is logged in, send them straight to the login/register
  // screen — that screen IS the app's front door now.
  useEffect(() => {
    if (!loading && !player) {
      router.replace('/register');
    }
  }, [loading, player, router]);

  useEffect(() => {
    if (!player) return;
    const supabase = createClient();

    async function loadNextTournament() {
      const { data } = await supabase
        .from('tournaments')
        .select('id, name, scheduled_at, location, category, gender')
        .in('status', ['scheduled', 'live'])
        .order('scheduled_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      setNextTournament(data || null);
    }

    async function loadAnnouncements() {
      const { data } = await supabase
        .from('admin_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(5);
      setAnnouncements(data || []);
    }

    loadNextTournament();
    loadAnnouncements();
  }, [player]);

  if (loading || !player) return <div className={styles.loading}>Завантаження...</div>;

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroBrand}>★ AMERICANKA ★</div>
        <div className={styles.heroSub}>ПЛЯЖ 13 · СТАНЦІЯ ФОНТАНА · ОДЕСА</div>
      </div>

      {player.approval_status === 'pending' && (
        <div className={styles.warnMsg}>Акаунт очікує підтвердження рейтингу адміном.</div>
      )}

      {announcements.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Оголошення</div>
          {announcements.map((a) => (
            <div key={a.id} className={styles.announcementCard}>
              <div className={styles.announcementTitle}>📢 {a.title}</div>
              <div className={styles.announcementBody}>{a.body}</div>
              <div className={styles.announcementDate}>
                {new Date(a.created_at).toLocaleDateString('uk', { day: 'numeric', month: 'long' })}
              </div>
            </div>
          ))}
        </>
      )}

      <div className={styles.sectionLabel}>Найближчий турнір</div>
      {nextTournament ? (
        <div className={styles.nextTournamentCard}>
          <div className={styles.nextTournamentName}>{nextTournament.name}</div>
          <div className={styles.nextTournamentMeta}>
            {new Date(nextTournament.scheduled_at).toLocaleString('uk', {
              dateStyle: 'full',
              timeStyle: 'short',
            })}
          </div>
          <div className={styles.nextTournamentMeta}>
            {nextTournament.location === 'beach13' ? 'Beach 13' : 'Dynamo SC'} · Кат. {nextTournament.category} ·{' '}
            {nextTournament.gender === 'M' ? 'Чоловіки' : 'Жінки'}
          </div>
        </div>
      ) : (
        <div className={styles.empty}>Найближчих турнірів немає</div>
      )}

      <div className={styles.statsGrid}>
        <StatBox value={player.elo ?? '—'} label="Рейтинг Ело" />
        <StatBox value={player.elo ? categoryForElo(player.elo)?.label : '—'} label="Категорія" />
        <StatBox value={player.tournaments_played} label="Турнірів" />
        <StatBox
          value={`${player.tournaments_played > 0 ? Math.round((player.tournaments_won / player.tournaments_played) * 100) : 0}%`}
          label="Перемог"
        />
      </div>

      <button className={styles.eloExplainerToggle} onClick={() => setEloExplainerOpen((o) => !o)}>
        <span>Що таке рейтинг Ело і як він рахується?</span>
        <span className={styles.eloExplainerArrow}>{eloExplainerOpen ? '▲' : '▼'}</span>
      </button>

      {eloExplainerOpen && (
        <div className={styles.eloExplainerBody}>
          <p>
            Рейтинг Ело — це система оцінки сили гравця, яка змінюється після кожного турніру залежно від результатів.
          </p>
          <p>
            Якщо ви перемагаєте сильнішого суперника — отримуєте більше очок. Якщо втрачаєте слабшому — втрачаєте
            більше очок. Перемога над рівним за силою суперником дає приблизно <b>+16</b> очок.
          </p>
          <p>
            Категорії за рейтингом: <b>D</b> (новачки, ~950), <b>C</b> (любителі, ~1250), <b>B</b> (досвідчені, ~1550),{' '}
            <b>A</b> (просунуті, ~1850).
          </p>
        </div>
      )}

      <div className={styles.formatsCard}>
        <div className={styles.formatsTitle}>🚀 Старт сезону — Американка</div>
        <div className={styles.formatsText}>
          Зараз стартує класичний формат <b>Американка 2x2</b>. Найближчим часом до рейтингу додадуться нові формати
          турнірів: <b>мікс</b>, <b>чоловічі та жіночі</b>, <b>король корту</b>, <b>випадковий мікс</b> та інші —
          слідкуйте за оголошеннями!
        </div>
      </div>
    </div>
  );
}

function StatBox({ value, label }) {
  return (
    <div className={styles.statBox}>
      <div className={styles.statValue}>{value}</div>
      <div className={styles.statLabel}>{label}</div>
    </div>
  );
}
