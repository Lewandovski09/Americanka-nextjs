'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CATEGORY_STARTING_ELO } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './admin.module.css';

export default function AdminPage() {
  const [pending, setPending] = useState([]);
  const [males, setMales] = useState([]);
  const [females, setFemales] = useState([]);
  const [eloInputs, setEloInputs] = useState({});

  async function load() {
    const supabase = createClient();

    const { data: p } = await supabase.from('players').select('*').eq('approval_status', 'pending');
    setPending(p || []);

    const { data: m } = await supabase
      .from('players')
      .select('*')
      .eq('gender', 'M')
      .neq('approval_status', 'pending')
      .order('elo', { ascending: false });
    setMales(m || []);

    const { data: f } = await supabase
      .from('players')
      .select('*')
      .eq('gender', 'F')
      .neq('approval_status', 'pending')
      .order('elo', { ascending: false });
    setFemales(f || []);
  }

  useEffect(() => {
    load();
  }, []);

  async function handleApprove(playerId) {
    const category = pending.find((p) => p.id === playerId)?.category || 'C';
    const elo = eloInputs[playerId] || CATEGORY_STARTING_ELO[category];

    await fetch(`/api/admin/players/${playerId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elo: Number(elo), category }),
    });
    load();
  }

  async function handleReject(playerId) {
    if (!confirm('Відхилити та видалити?')) return;
    await fetch(`/api/admin/players/${playerId}/reject`, { method: 'POST' });
    load();
  }

  async function handleEditElo(playerId, currentElo) {
    const newElo = prompt(`Новий Ело (поточний: ${currentElo}):`);
    if (!newElo) return;
    await fetch(`/api/admin/players/${playerId}/edit-elo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elo: Number(newElo) }),
    });
    load();
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Адмін-панель</h2>

      <div className={styles.sectionLabel}>
        Нові реєстрації {pending.length > 0 && <span className={styles.countBadge}>{pending.length}</span>}
      </div>

      {pending.length === 0 && <div className={styles.empty}>Нових заявок немає</div>}

      {pending.map((p) => (
        <div key={p.id} className={styles.pendingCard}>
          <div className={styles.pendingHeader}>
            <PlayerAvatar player={p} size={36} />
            <div>
              <div className={styles.pendingName}>{p.full_name}</div>
              <div className={styles.pendingMeta}>
                @{p.login} · {p.gender === 'M' ? 'Чоловік' : 'Жінка'} · Кат. {p.category}
              </div>
            </div>
          </div>
          <input
            type="number"
            className={styles.eloInput}
            placeholder={`Ело (за замовч. ${CATEGORY_STARTING_ELO[p.category]})`}
            onChange={(e) => setEloInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
          />
          <div className={styles.actionRow}>
            <button className={styles.approveBtn} onClick={() => handleApprove(p.id)}>
              Підтвердити
            </button>
            <button className={styles.rejectBtn} onClick={() => handleReject(p.id)}>
              Відхилити
            </button>
          </div>
        </div>
      ))}

      <div className={styles.sectionLabel}>Гравці · Чоловіки</div>
      {males.map((p) => (
        <PlayerRow key={p.id} player={p} onEditElo={() => handleEditElo(p.id, p.elo)} />
      ))}

      <div className={styles.sectionLabel}>Гравці · Жінки</div>
      {females.map((p) => (
        <PlayerRow key={p.id} player={p} onEditElo={() => handleEditElo(p.id, p.elo)} />
      ))}
    </div>
  );
}

function PlayerRow({ player, onEditElo }) {
  return (
    <div className={styles.playerRow}>
      <PlayerAvatar player={player} size={32} />
      <div className={styles.playerInfo}>
        <div className={styles.playerName}>{player.full_name}</div>
        <div className={styles.playerMeta}>
          @{player.login} · {player.elo ?? '—'} Ело
        </div>
      </div>
      <button className={styles.editEloBtn} onClick={onEditElo}>
        Змінити Ело
      </button>
    </div>
  );
}
