'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { categoryForElo } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import { IconArrowLeft, IconTrophy, IconMedal } from '@/components/Icons';
import styles from './player.module.css';

export default function PlayerProfilePage() {
  const params = useParams();
  const router = useRouter();
  const [player, setPlayer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let active = true;
    async function load() {
      const supabase = createClient();
      const { data } = await supabase.from('players').select('*').eq('login', params.login).maybeSingle();
      if (!active) return;
      if (!data) setNotFound(true);
      else setPlayer(data);
      setLoading(false);
    }
    load();
    return () => {
      active = false;
    };
  }, [params.login]);

  if (loading) {
    return (
      <div className={styles.page}>
        <div className={styles.skeletonHeroHeader}>
          <div className={styles.skeletonHeader}>
            <div className={`skeleton on-dark ${styles.skeletonAvatar}`} />
            <div className={styles.skeletonLines}>
              <div className={`skeleton on-dark ${styles.skeletonLine}`} style={{ width: '50%' }} />
              <div className={`skeleton on-dark ${styles.skeletonLine}`} style={{ width: '35%', marginBottom: 0 }} />
            </div>
          </div>
          <div className={`skeleton on-dark ${styles.skeletonEloLine}`} />
        </div>
      </div>
    );
  }

  if (notFound) {
    return (
      <div className={styles.page}>
        <button className={styles.backBtn} onClick={() => router.back()}>
          <IconArrowLeft size={15} /> Назад
        </button>
        <div className={styles.notFound}>Гравця не знайдено</div>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <button className={styles.backBtn} onClick={() => router.back()}>
        <IconArrowLeft size={15} /> Назад
      </button>

      <div className={`${styles.header} riseIn`}>
        <div className={styles.headerTop}>
          <PlayerAvatar player={player} size={64} />
          <div className={styles.headerInfo}>
            <div className={styles.name}>{player.full_name}</div>
            <div className={styles.cat}>@{player.login}</div>
          </div>
        </div>

        <div className={styles.heroEloRow}>
          <div className={styles.heroEloBlock}>
            <div className={styles.heroEloValue}>{player.elo ?? '—'}</div>
            <div className={styles.heroEloLabel}>РЕЙТИНГ ЕЛО · {categoryForElo(player.elo)?.label}</div>
          </div>
        </div>

        <div className={styles.headerWave} aria-hidden="true">
          <svg viewBox="0 0 600 22" preserveAspectRatio="none">
            <path d="M0,10 C100,22 200,0 300,10 C400,20 500,0 600,10 L600,22 L0,22 Z" fill="var(--bg-light)" />
          </svg>
        </div>
      </div>

      <div className={`${styles.statStrip} riseIn`} style={{ animationDelay: '0.06s' }}>
        <div className={styles.statStripItem}>
          <IconTrophy size={18} color="var(--text2)" />
          <div className={styles.statStripValue}>{player.tournaments_played ?? 0}</div>
          <div className={styles.statStripLabel}>Турнірів</div>
        </div>
        <div className={styles.statStripDivider} />
        <div className={styles.statStripItem}>
          <IconMedal size={18} color="var(--text2)" />
          <div className={styles.statStripValue}>{player.tournaments_won ?? 0}</div>
          <div className={styles.statStripLabel}>Перемог</div>
        </div>
      </div>
    </div>
  );
}
