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
  const [showFormatBreakdown, setShowFormatBreakdown] = useState(false);
  const [formatBreakdown, setFormatBreakdown] = useState([]);
  const [notifTitle, setNotifTitle] = useState('');
  const [notifBody, setNotifBody] = useState('');
  const [notifSending, setNotifSending] = useState(false);
  const [notifSent, setNotifSent] = useState(false);
  const [adminSearchLogin, setAdminSearchLogin] = useState('');
  const [adminSearchError, setAdminSearchError] = useState('');
  const [adminSearchResult, setAdminSearchResult] = useState(null);

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
    const { count: matchesPlayed } = await supabase
      .from('matches')
      .select('id', { count: 'exact', head: true })
      .eq('played', true);

    const categoryCountsMale = { D: 0, C: 0, B: 0, A: 0 };
    (m || []).forEach((pl) => {
      if (pl.category && categoryCountsMale[pl.category] !== undefined) categoryCountsMale[pl.category]++;
    });
    const categoryCountsFemale = { D: 0, C: 0, B: 0, A: 0 };
    (f || []).forEach((pl) => {
      if (pl.category && categoryCountsFemale[pl.category] !== undefined) categoryCountsFemale[pl.category]++;
    });

    setStats({
      maleCount: (m || []).length,
      femaleCount: (f || []).length,
      pendingCount: (p || []).length,
      doneCount: doneCount || 0,
      matchesPlayed: matchesPlayed || 0,
      categoryCountsMale,
      categoryCountsFemale,
    });
  }

  async function loadFormatBreakdown() {
    const supabase = createClient();
    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('tournament_formats(display_name)')
      .eq('status', 'done');

    const counts = {};
    (tournaments || []).forEach((t) => {
      const name = t.tournament_formats?.display_name || 'Невідомий формат';
      counts[name] = (counts[name] || 0) + 1;
    });
    setFormatBreakdown(Object.entries(counts).map(([name, count]) => ({ name, count })));
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
    if (adminSearchResult?.id === playerId) handleAdminSearch();
  }

  async function handleAdminSearch() {
    setAdminSearchError('');
    setAdminSearchResult(null);
    if (!adminSearchLogin.trim()) return;

    const supabase = createClient();
    const { data, error } = await supabase
      .from('players')
      .select('*')
      .eq('login', adminSearchLogin.trim().toLowerCase())
      .maybeSingle();

    if (error || !data) {
      setAdminSearchError('Гравця з таким логіном не знайдено');
      return;
    }
    setAdminSearchResult(data);
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
          <button
            className={styles.statBox}
            onClick={() => {
              setShowFormatBreakdown((s) => !s);
              if (!showFormatBreakdown) loadFormatBreakdown();
            }}
          >
            <div className={styles.statValue}>{stats.doneCount}</div>
            <div className={styles.statLabel}>Завершено турнірів</div>
          </button>
          <div className={styles.statBox}>
            <div className={styles.statValue}>{stats.matchesPlayed}</div>
            <div className={styles.statLabel}>Зіграних ігор</div>
          </div>
        </div>
      )}

      {stats && (
        <div className={styles.genderCategoryBlock}>
          <div className={styles.genderCategoryLabel}>Чоловіки за категоріями</div>
          <div className={styles.categoryStatsRow}>
            {CATEGORY_LETTERS.map((cat) => (
              <div key={cat} className={styles.categoryStatBox}>
                <div className={styles.categoryStatLetter}>{cat}</div>
                <div className={styles.categoryStatCount}>{stats.categoryCountsMale[cat]}</div>
              </div>
            ))}
          </div>
          <div className={styles.genderCategoryLabel}>Жінки за категоріями</div>
          <div className={styles.categoryStatsRow}>
            {CATEGORY_LETTERS.map((cat) => (
              <div key={cat} className={styles.categoryStatBox}>
                <div className={styles.categoryStatLetter}>{cat}</div>
                <div className={styles.categoryStatCount}>{stats.categoryCountsFemale[cat]}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className={styles.sectionLabel}>Пошук гравця</div>
      <div className={styles.searchCard}>
        <div className={styles.searchRow}>
          <input
            className={styles.searchInput}
            placeholder="Логін гравця..."
            value={adminSearchLogin}
            onChange={(e) => setAdminSearchLogin(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdminSearch()}
          />
          <button className={styles.searchBtn} onClick={handleAdminSearch}>
            Знайти
          </button>
        </div>
        {adminSearchError && <div className={styles.searchError}>{adminSearchError}</div>}
        {adminSearchResult && (
          <div className={styles.searchResultRow}>
            <PlayerAvatar player={adminSearchResult} size={32} />
            <div className={styles.playerInfo}>
              <div className={styles.playerName}>{adminSearchResult.full_name}</div>
              <div className={styles.playerMeta}>
                @{adminSearchResult.login} · {adminSearchResult.elo ?? '—'} Ело · Кат. {adminSearchResult.category ?? '—'}
              </div>
            </div>
            <button className={styles.editEloBtn} onClick={() => handleEditCategory(adminSearchResult.id)}>
              Змінити категорію
            </button>
          </div>
        )}
      </div>

      {showFormatBreakdown && (
        <div className={styles.quickList}>
          {formatBreakdown.length === 0 && <div className={styles.empty}>Ще немає завершених турнірів</div>}
          {formatBreakdown.map((f) => (
            <div key={f.name} className={styles.quickListRow}>
              <span>{f.name}</span>
              <span className={styles.quickListElo}>{f.count}</span>
            </div>
          ))}
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
