'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { categoryForElo, SKILL_CATEGORIES } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './rating.module.css';

export default function RatingPage() {
  const { player } = useCurrentPlayer();
  const [gender, setGender] = useState('M');
  const [category, setCategory] = useState('all');
  const [players, setPlayers] = useState([]);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      let query = supabase
        .from('players')
        .select('id, full_name, elo, photo_url, tournaments_played')
        .eq('gender', gender)
        .eq('approval_status', 'approved')
        .order('elo', { ascending: false });

      if (category !== 'all') {
        const catDef = SKILL_CATEGORIES.find((c) => c.id === category);
        query = query.gte('elo', catDef.range[0]).lt('elo', catDef.range[1]);
      }

      const { data } = await query;
      setPlayers(data || []);
    }
    load();
  }, [gender, category]);

  return (
    <div className={styles.page}>
      <div className={styles.row}>
        <button className={`${styles.genderBtn} ${gender === 'M' ? styles.genderBtnOn : ''}`} onClick={() => setGender('M')}>
          Чоловіки
        </button>
        <button className={`${styles.genderBtn} ${gender === 'F' ? styles.genderBtnOn : ''}`} onClick={() => setGender('F')}>
          Жінки
        </button>
      </div>

      <div className={styles.chipsRow}>
        <button className={`${styles.chip} ${category === 'all' ? styles.chipOn : ''}`} onClick={() => setCategory('all')}>
          Всі
        </button>
        {['A', 'B', 'C', 'D'].map((c) => (
          <button key={c} className={`${styles.chip} ${category === c ? styles.chipOn : ''}`} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </div>

      <div className={styles.genderLabel} style={{ color: gender === 'M' ? '#1e40af' : '#9d174d' }}>
        {gender === 'M' ? 'Чоловіки' : 'Жінки'}
      </div>

      {players.length === 0 && <div className={styles.empty}>Немає гравців</div>}

      {players.map((p, i) => (
        <div key={p.id} className={`${styles.playerRow} ${p.id === player?.id ? styles.meRow : ''}`}>
          <div className={styles.rank}>{['🥇', '🥈', '🥉'][i] || i + 1}</div>
          <PlayerAvatar player={p} size={36} />
          <div className={styles.playerInfo}>
            <div className={styles.playerName}>{p.full_name}</div>
            <div className={styles.playerMeta}>{p.tournaments_played} турн.</div>
          </div>
          <div className={styles.playerEloBox}>
            <div className={styles.playerElo}>{p.elo}</div>
            <div className={styles.playerCat}>{categoryForElo(p.elo)?.label}</div>
          </div>
        </div>
      ))}

      <div className={styles.sectionLabel}>Шкала рівнів</div>
      <div className={styles.scaleCard}>
        {SKILL_CATEGORIES.map((c) => (
          <div key={c.id} className={styles.scaleRow}>
            <div className={styles.scaleHeader}>
              <span>{c.id}</span>
              <span>
                {c.range[0]}–{c.range[1]}
              </span>
            </div>
            <div className={styles.scaleBar}>
              <div
                className={styles.scaleFill}
                style={{ width: `${Math.round(((c.range[1] - 800) / (2200 - 800)) * 100)}%`, background: c.color }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
