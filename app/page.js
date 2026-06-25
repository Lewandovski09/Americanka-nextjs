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
  const [notice, setNotice] = useState(null);
  const [topPlayers, setTopPlayers] = useState([]);

  // If nobody is logged in, send them straight to the login/register
  // screen — that screen IS the app's front door now.
  useEffect(() => {
    if (!loading && !player) {
      router.replace('/register');
    }
  }, [loading, player, router]);

  // Show a one-time fullscreen notice based on flags stored in the
  // database (so it works correctly even across devices/sessions,
  // unlike the old localStorage-flag approach).
  useEffect(() => {
    if (!player) return;

    const supabase = createClient();

    async function showNoticeIfNeeded() {
      if (!player.just_registered_notified && player.approval_status === 'pending') {
        setNotice({
          icon: '🎉',
          title: 'Акаунт успішно створено!',
          text: 'Очікуйте підтвердження рейтингу адміністратором.',
        });
        await supabase.from('players').update({ just_registered_notified: true }).eq('id', player.id);
      } else if (!player.rating_approved_notified && player.approval_status === 'approved') {
        setNotice({
          icon: '✅',
          title: 'Рейтинг підтверджено!',
          text: `Стартовий рейтинг Ело: ${player.elo}. Категорія: ${categoryForElo(player.elo)?.label}.`,
        });
        await supabase.from('players').update({ rating_approved_notified: true }).eq('id', player.id);
      }
    }

    showNoticeIfNeeded();
  }, [player]);

  useEffect(() => {
    if (!player) return;
    const supabase = createClient();

    async function loadTop() {
      const { data } = await supabase
        .from('players')
        .select('id, full_name, elo, category, photo_url, tournaments_played')
        .eq('gender', player.gender)
        .eq('approval_status', 'approved')
        .order('elo', { ascending: false })
        .limit(5);
      setTopPlayers(data || []);
    }

    loadTop();
  }, [player]);

  if (loading || !player) return <div className={styles.loading}>Завантаження...</div>;

  return (
    <div className={styles.page}>
      {notice && (
        <div className={styles.overlay} onClick={() => setNotice(null)}>
          <div className={styles.noticeBox} onClick={(e) => e.stopPropagation()}>
            <div className={styles.noticeIcon}>{notice.icon}</div>
            <div className={styles.noticeTitle}>{notice.title}</div>
            <div className={styles.noticeText}>{notice.text}</div>
            <button className={styles.noticeBtn} onClick={() => setNotice(null)}>
              Зрозуміло
            </button>
          </div>
        </div>
      )}

      <div className={styles.hero}>
        <div className={styles.heroBrand}>★ AMERICANKA ★</div>
        <div className={styles.heroSub}>ПЛЯЖ 13 · СТАНЦІЯ ФОНТАНА · ОДЕСА</div>
        <div className={styles.heroInfo}>
          Американка 2x2 · 8 гравців · 7 раундів · Сума рахунку <b>31</b>
        </div>
      </div>

      {player.approval_status === 'pending' && (
        <div className={styles.warnMsg}>Акаунт очікує підтвердження рейтингу адміном.</div>
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

      <div className={styles.sectionLabel}>Топ {player.gender === 'M' ? 'чоловіки' : 'жінки'}</div>
      <div>
        {topPlayers.map((p, i) => (
          <div key={p.id} className={styles.playerRow}>
            <div className={styles.rank}>{['🥇', '🥈', '🥉'][i] || i + 1}</div>
            <div className={styles.avatar}>{p.photo_url ? <img src={p.photo_url} alt="" /> : p.full_name[0]}</div>
            <div className={styles.playerInfo}>
              <div className={styles.playerName}>{p.full_name}</div>
              <div className={styles.playerMeta}>
                {categoryForElo(p.elo)?.label} · {p.tournaments_played} турн.
              </div>
            </div>
            <div className={styles.playerElo}>{p.elo}</div>
          </div>
        ))}
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
