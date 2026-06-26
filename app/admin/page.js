'use client';

import { useEffect, useState } from 'react';
import { createClient } from '@/lib/supabase/client';
import { CATEGORY_STARTING_ELO } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './admin.module.css';

const CATEGORY_LETTERS = ['D', 'C', 'B', 'A'];

export default function AdminPage() {
  const [pending, setPending] = useState([]);
  const [males, setMales] = useState([]);
  const [females, setFemales] = useState([]);
  const [selectedCategory, setSelectedCategory] = useState({});
  const [stats, setStats] = useState(null);
  const [showMaleList, setShowMaleList] = useState(false);
  const [showFemaleList, setShowFemaleList] = useState(false);
  const [notifTitle, setNotifTitle] = useState('');
  const [notifBody, setNotifBody] = useState('');
  const [notifSending, setNotifSending] = useState(false);
  const [notifSent, setNotifSent] = useState(false);

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

    const { count: doneCount } = await supabase
      .from('tournaments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'done');
    const { count: liveCount } = await supabase
      .from('tournaments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'live');
    const { count: scheduledCount } = await supabase
      .from('tournaments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'scheduled');
    const { count: matchesPlayed } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('played', true);

    setStats({
      maleCount: (m || []).length,
      femaleCount: (f || []).length,
      pendingCount: (p || []).length,
      doneCount: doneCount || 0,
      liveCount: liveCount || 0,
      scheduledCount: scheduledCount || 0,
      matchesPlayed: matchesPlayed || 0,
    });
  }

  useEffect(() => {
    load();
  }, []);

  async function handleApprove(playerId) {
    const category = selectedCategory[playerId];
    if (!category) {
      alert('Спочатку оберіть категорію рейтингу для цього гравця');
      return;
    }
    const elo = CATEGORY_STARTING_ELO[category];

    await fetch(`/api/admin/players/${playerId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elo, category }),
    });
    load();
  }

  async function handleReject(playerId) {
    if (!confirm('Відхилити та видалити?')) return;
    await fetch(`/api/admin/players/${playerId}/reject`, { method: 'POST' });
    load();
  }

  async function handleEditCategory(playerId) {
    const newCategory = prompt('Нова категорія (D, C, B або A):');
    if (!newCategory || !CATEGORY_LETTERS.includes(newCategory.toUpperCase())) return;
    const elo = CATEGORY_STARTING_ELO[newCategory.toUpperCase()];
    await fetch(`/api/admin/players/${playerId}/edit-elo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elo }),
    });
    load();
  }

  async function handleSendNotification() {
    if (!notifTitle.trim() || !notifBody.trim()) {
      alert("Заповніть заголовок і текст повідомлення");
      return;
    }
    setNotifSending(true);
    const res = await fetch('/api/admin/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: notifTitle, body: notifBody }),
    });
    const data = await res.json();
    setNotifSending(false);

    if (data.success) {
      setNotifTitle('');
      setNotifBody('');
      setNotifSent(true);
      setTimeout(() => setNotifSent(false), 3000);
    } else {
      alert(data.error || 'Не вдалося надіслати повідомлення');
    }
  }

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Адмін-панель</h2>

      {stats && (
        <div className={styles.statsGrid}>
          <button className={styles.statBox} onClick={() => setShowMaleList((s) => !s)}>
            <div className={styles.statValue}>{stats.maleCount}</div>
            <div className={styles.statLabel}>Чоловіків</div>
          </button>
          <button className={styles.statBox} onClick={() => setShowFemaleList((s) => !s)}>
            <div className={styles.statValue}>{stats.femaleCount}</div>
            <div className={styles.statLabel}>Жінок</div>
          </button>
          <div className={styles.statBox}>
            <div className={styles.statValue}>{stats.doneCount}</div>
            <div className={styles.statLabel}>Завершено турнірів</div>
          </div>
          <div className={styles.statBox}>
            <div className={styles.statValue}>{stats.liveCount}</div>
            <div className={styles.statLabel}>Активних турнірів</div>
          </div>
          <div className={styles.statBox}>
            <div className={styles.statValue}>{stats.scheduledCount}</div>
            <div className={styles.statLabel}>Запланованих</div>
          </div>
          <div className={styles.statBox}>
            <div className={styles.statValue}>{stats.matchesPlayed}</div>
            <div className={styles.statLabel}>Зіграних ігор</div>
          </div>
        </div>
      )}

      {showMaleList && (
        <div className={styles.quickList}>
          {males.map((p) => (
            <div key={p.id} className={styles.quickListRow}>
              <PlayerAvatar player={p} size={26} />
              <span>{p.full_name}</span>
              <span className={styles.quickListElo}>{p.elo}</span>
            </div>
          ))}
        </div>
      )}

      {showFemaleList && (
        <div className={styles.quickList}>
          {females.map((p) => (
            <div key={p.id} className={styles.quickListRow}>
              <PlayerAvatar player={p} size={26} />
              <span>{p.full_name}</span>
              <span className={styles.quickListElo}>{p.elo}</span>
            </div>
          ))}
        </div>
      )}

      <div className={styles.sectionLabel}>Надіслати оголошення</div>
      <div className={styles.notifCard}>
        <input
          className={styles.notifInput}
          placeholder="Заголовок"
          value={notifTitle}
          onChange={(e) => setNotifTitle(e.target.value)}
        />
        <textarea
          className={styles.notifTextarea}
          placeholder="Текст повідомлення для всіх учасників..."
          value={notifBody}
          onChange={(e) => setNotifBody(e.target.value)}
          rows={3}
        />
        <button className={styles.notifSendBtn} disabled={notifSending} onClick={handleSendNotification}>
          {notifSending ? 'Надсилання...' : notifSent ? '✓ Надіслано!' : 'Надіслати всім'}
        </button>
      </div>

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
                @{p.login} · {p.gender === 'M' ? 'Чоловік' : 'Жінка'}
              </div>
              {p.requested_category && (
                <div className={styles.requestedBadge}>Запросив категорію: {p.requested_category}</div>
              )}
            </div>
          </div>
          <div className={styles.categoryLabel}>Оберіть категорію рейтингу (обов&apos;язково):</div>
          <div className={styles.categoryRow}>
            {CATEGORY_LETTERS.map((cat) => (
              <button
                key={cat}
                className={`${styles.categoryChip} ${selectedCategory[p.id] === cat ? styles.categoryChipOn : ''}`}
                onClick={() => setSelectedCategory((prev) => ({ ...prev, [p.id]: cat }))}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className={styles.actionRow}>
            <button
              className={styles.approveBtn}
              disabled={!selectedCategory[p.id]}
              onClick={() => handleApprove(p.id)}
            >
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
        <PlayerRow key={p.id} player={p} onEditCategory={() => handleEditCategory(p.id)} />
      ))}

      <div className={styles.sectionLabel}>Гравці · Жінки</div>
      {females.map((p) => (
        <PlayerRow key={p.id} player={p} onEditCategory={() => handleEditCategory(p.id)} />
      ))}
    </div>
  );
}

function PlayerRow({ player, onEditCategory }) {
  return (
    <div className={styles.playerRow}>
      <PlayerAvatar player={player} size={32} />
      <div className={styles.playerInfo}>
        <div className={styles.playerName}>{player.full_name}</div>
        <div className={styles.playerMeta}>
          @{player.login} · {player.elo ?? '—'} Ело · Кат. {player.category ?? '—'}
        </div>
      </div>
      <button className={styles.editEloBtn} onClick={onEditCategory}>
        Змінити категорію
      </button>
    </div>
  );
}
