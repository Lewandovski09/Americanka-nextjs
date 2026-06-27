'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { categoryForElo } from '@/lib/elo';
import { IconSparkle, IconCheck } from '@/components/Icons';
import styles from './GlobalNotice.module.css';

/**
 * Shows one-time fullscreen notices (registration success, rating
 * approved) on top of WHATEVER page the player happens to be on —
 * this fixes the bug where the notice only appeared on the home
 * page, so a player browsing elsewhere when approval happened
 * would never see it.
 */
export default function GlobalNotice({ player }) {
  const [notice, setNotice] = useState(null);

  useEffect(() => {
    if (!player) return;

    const supabase = createClient();

    async function showNoticeIfNeeded() {
      if (!player.just_registered_notified && player.approval_status === 'pending') {
        setNotice({
          icon: <IconSparkle size={40} color="var(--rust)" />,
          title: 'Акаунт успішно створено!',
          text: 'Очікуйте підтвердження рейтингу адміністратором.',
        });
        await supabase.from('players').update({ just_registered_notified: true }).eq('id', player.id);
      } else if (!player.rating_approved_notified && player.approval_status === 'approved') {
        setNotice({
          icon: <IconCheck size={40} color="var(--accent-green)" />,
          title: 'Рейтинг підтверджено!',
          text: `Стартовий рейтинг Ело: ${player.elo}. Категорія: ${categoryForElo(player.elo)?.label}.`,
        });
        await supabase.from('players').update({ rating_approved_notified: true }).eq('id', player.id);
      }
    }

    showNoticeIfNeeded();
  }, [player]);

  if (!notice) return null;

  return (
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
  );
}
