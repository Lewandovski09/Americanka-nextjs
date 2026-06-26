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
  const [readIds, setReadIds] = useState(new Set());
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
      const { data: notifs } = await supabase
        .from('admin_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      const { data: reads } = await supabase
        .from('notification_reads')
        .select('notification_id')
        .eq('player_id', player.id);

      setReadIds(new Set((reads || []).map((r) => r.notification_id)));
      setAnnouncements(notifs || []);
    }

    loadNextTournament();
    loadAnnouncements();
  }, [player]);

  async function dismissAnnouncement(notificationId) {
    setReadIds((prev) => new Set([...prev, notificationId]));
    const supabase = createClient();
    await supabase
      .from('notification_reads')
      .upsert({ player_id: player.id, notification_id: notificationId });
  }

  if (loading || !player) return <div className={styles.loading}>Завантаження...</div>;

  const visibleAnnouncements = announcements.filter((a) => !readIds.has(a.id));

  return (
    <div className={styles.page}>
      <div className={styles.hero}>
        <div className={styles.heroBrand}>★ AMERICANKA ★</div>
        <div className={styles.heroSub}>ПЛЯЖ 13 · СТАНЦІЯ ФОНТАНА · ОДЕСА</div>
      </div>

      {player.approval_status === 'pending' && (
        <div className={styles.warnMsg}>Акаунт очікує підтвердження рейтингу адміном.</div>
      )}

      {visibleAnnouncements.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Оголошення</div>
          {visibleAnnouncements.map((a) => (
            <div key={a.id} className={styles.announcementCard}>
              <button className={styles.announcementClose} onClick={() => dismissAnnouncement(a.id)}>
                ✕
              </button>
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
      </div>

      <button className={styles.eloExplainerToggle} onClick={() => setEloExplainerOpen((o) => !o)}>
        <span>Що таке рейтинг Ело і як він рахується?</span>
        <span className={styles.eloExplainerArrow}>{eloExplainerOpen ? '▲' : '▼'}</span>
      </button>

      {eloExplainerOpen && (
        <div className={styles.eloExplainerBody}>
          <p>
            <b>Рейтинг Ело</b> — це числова оцінка сили гравця (від 800 до 2000+), яка автоматично змінюється після
            кожного зіграного матчу залежно від результату та сили суперника.
          </p>
          <p>
            <b>Як рахується:</b> перед матчем система оцінює ймовірність вашої перемоги, виходячи з різниці рейтингів
            команд. Якщо ваш рейтинг нижчий за суперника, а ви перемагаєте — ви отримуєте <b>більше</b> очок, бо це
            несподіваний результат. Якщо перемагає очікуваний фаворит — він отримує менше очок, а слабший суперник
            втрачає менше.
          </p>
          <p>
            Перемога над рівним за силою суперником дає приблизно <b>+16</b> очок, поразка — приблизно <b>-16</b>{' '}
            очок. Перемога над набагато сильнішим суперником може дати <b>+25–30</b> очок, а поразка від набагато
            слабшого забере стільки ж.
          </p>
          <p>
            Рейтинг впливає на вашу категорію: <b>D</b> — новачки (800–1100, старт ~950), <b>C</b> — любителі
            (1100–1400, старт ~1250), <b>B</b> — досвідчені (1400–1700, старт ~1550), <b>A</b> — просунуті (1700+,
            старт ~1850). Адмін призначає початкову категорію при підтвердженні реєстрації, а далі рейтинг росте або
            падає залежно від ваших результатів у турнірах.
          </p>
        </div>
      )}

      <div className={styles.formatsCard}>
        <div className={styles.formatsTitle}>🚀 Старт сезону — AMERICANKA</div>
        <div className={styles.formatsText}>
          Зараз стартує класичний формат <b>AMERICANKA 2x2</b>. Найближчим часом до рейтингу додадуться нові формати
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
