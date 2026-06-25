'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { categoryForElo, expectedScore } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './profile.module.css';

export default function ProfilePage() {
  const router = useRouter();
  const { player, loading } = useCurrentPlayer();
  const [history, setHistory] = useState([]);
  const [partners, setPartners] = useState([]);
  const [opponentElo, setOpponentElo] = useState(1200);

  useEffect(() => {
    if (!player) return;
    async function load() {
      const supabase = createClient();

      const { data: h } = await supabase
        .from('elo_history')
        .select('*, tournaments(name)')
        .eq('player_id', player.id)
        .order('created_at', { ascending: false });
      setHistory(h || []);

      const { data: p } = await supabase
        .from('partner_stats')
        .select('*, partner:players!partner_stats_partner_id_fkey(full_name, photo_url)')
        .eq('player_id', player.id)
        .order('games_together', { ascending: false })
        .limit(4);
      setPartners(p || []);
    }
    load();
  }, [player]);

  async function handlePhotoChange(e) {
    const file = e.target.files[0];
    if (!file || !player) return;
    const supabase = createClient();
    const ext = file.name.split('.').pop();
    const path = `${player.id}.${ext}`;
    await supabase.storage.from('player-photos').upload(path, file, { upsert: true });
    const { data: urlData } = supabase.storage.from('player-photos').getPublicUrl(path);
    await supabase.from('players').update({ photo_url: urlData.publicUrl }).eq('id', player.id);
    router.refresh();
  }

  async function handleLogout() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.push('/login');
  }

  if (loading) return <div className={styles.loading}>Завантаження...</div>;
  if (!player) return <div className={styles.loading}>Будь ласка, увійдіть в акаунт</div>;

  const e = expectedScore(player.elo || 1200, opponentElo);
  const winGain = Math.round(32 * (1 - e));
  const lossDelta = Math.round(32 * (0 - e));
  const gainThisYear = history.reduce((sum, h) => sum + h.delta, 0);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <div className={styles.avatarWrap}>
          <PlayerAvatar player={player} size={56} />
          <label className={styles.photoEditBtn}>
            ✎
            <input type="file" accept="image/*" hidden onChange={handlePhotoChange} />
          </label>
        </div>
        <div className={styles.headerInfo}>
          <div className={styles.name}>{player.full_name}</div>
          <div className={styles.cat}>
            {player.approval_status === 'pending'
              ? 'Очікує підтвердження'
              : `${categoryForElo(player.elo)?.label} · ${player.elo} Ело`}
          </div>
        </div>
        <button className={styles.logoutBtn} onClick={handleLogout}>
          Вийти
        </button>
      </div>

      {player.is_admin ? (
        <AdminStats />
      ) : (
        <>
          <div className={styles.statsGrid}>
            <StatBox value={player.elo ?? '—'} label="Рейтинг Ело" />
            <StatBox value={player.tournaments_played} label="Турнірів" />
            <StatBox value={player.tournaments_won} label="Перемог" />
            <StatBox value={gainThisYear >= 0 ? `+${gainThisYear}` : gainThisYear} label="Ело за рік" />
          </div>

          <div className={styles.sectionLabel}>Калькулятор Ело</div>
          <div className={styles.card}>
            <div className={styles.sliderLabel}>
              Ело суперника: <b>{opponentElo}</b>
            </div>
            <input
              type="range"
              min={800}
              max={2000}
              step={10}
              value={opponentElo}
              onChange={(e) => setOpponentElo(Number(e.target.value))}
              className={styles.slider}
            />
            <div className={styles.calcGrid}>
              <CalcBox value={`${Math.round(e * 100)}%`} label="шанс" color="#0d2347" />
              <CalcBox value={`+${winGain}`} label="перемога" color="#065f46" />
              <CalcBox value={lossDelta} label="поразка" color="#9b1c1c" />
            </div>
          </div>

          <div className={styles.sectionLabel}>Партнери</div>
          <div className={styles.card}>
            {partners.length === 0 && <div className={styles.empty}>Дані після турнірів</div>}
            {partners.map((p) => (
              <div key={p.partner_id} className={styles.partnerRow}>
                <PlayerAvatar player={p.partner} size={28} />
                <div className={styles.partnerName}>{p.partner.full_name}</div>
                <div className={styles.partnerMeta}>{p.games_together} разом</div>
              </div>
            ))}
          </div>

          <div className={styles.sectionLabel}>Історія</div>
          {history.length === 0 && <div className={styles.empty}>Ще немає турнірів</div>}
          {history.map((h) => (
            <div key={h.id} className={styles.historyCard}>
              <div>
                <div className={styles.historyName}>{h.tournaments?.name || 'Турнір'}</div>
                <div className={styles.historyPlace}>
                  {['🥇', '🥈', '🥉'][h.placement - 1] || ''} {h.placement}-є місце
                </div>
              </div>
              <div className={h.delta >= 0 ? styles.positive : styles.negative}>
                {h.delta >= 0 ? '+' : ''}
                {h.delta} Ело
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}

function AdminStats() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    async function load() {
      const supabase = createClient();
      const { data: males } = await supabase
        .from('players')
        .select('id, full_name, elo')
        .eq('gender', 'M')
        .eq('approval_status', 'approved')
        .order('elo', { ascending: false })
        .limit(3);
      const { data: females } = await supabase
        .from('players')
        .select('id, full_name, elo')
        .eq('gender', 'F')
        .eq('approval_status', 'approved')
        .order('elo', { ascending: false })
        .limit(3);
      const { count: maleCount } = await supabase
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('gender', 'M')
        .eq('approval_status', 'approved');
      const { count: femaleCount } = await supabase
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('gender', 'F')
        .eq('approval_status', 'approved');
      const { count: pendingCount } = await supabase
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('approval_status', 'pending');
      const { count: doneCount } = await supabase
        .from('tournaments')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'done');

      setStats({ males, females, maleCount, femaleCount, pendingCount, doneCount });
    }
    load();
  }, []);

  if (!stats) return <div className={styles.loading}>Завантаження...</div>;

  return (
    <div>
      <div className={styles.statsGrid}>
        <StatBox value={stats.maleCount} label="Чоловіків" />
        <StatBox value={stats.femaleCount} label="Жінок" />
        <StatBox value={stats.doneCount} label="Турнірів" />
        <StatBox value={stats.pendingCount} label="Очікують" />
      </div>
      <div className={styles.sectionLabel}>Топ Ело · Чоловіки</div>
      {stats.males.map((p) => (
        <div key={p.id} className={styles.partnerRow}>
          <div className={styles.partnerName}>{p.full_name}</div>
          <div className={styles.partnerMeta}>{p.elo} Ело</div>
        </div>
      ))}
      <div className={styles.sectionLabel}>Топ Ело · Жінки</div>
      {stats.females.map((p) => (
        <div key={p.id} className={styles.partnerRow}>
          <div className={styles.partnerName}>{p.full_name}</div>
          <div className={styles.partnerMeta}>{p.elo} Ело</div>
        </div>
      ))}
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

function CalcBox({ value, label, color }) {
  return (
    <div className={styles.calcBox}>
      <div className={styles.calcValue} style={{ color }}>
        {value}
      </div>
      <div className={styles.calcLabel}>{label}</div>
    </div>
  );
}
