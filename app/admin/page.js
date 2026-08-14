'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getFormat } from '@/lib/formats';
import { CATEGORY_STARTING_ELO } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './admin.module.css';

const CATEGORY_LETTERS = ['D', 'C', 'B', 'A'];

function matchesPlayerSearch(player, query) {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    (player.first_name || '').toLowerCase().includes(q) ||
    (player.last_name || '').toLowerCase().includes(q) ||
    (player.full_name || '').toLowerCase().includes(q) ||
    (player.login || '').toLowerCase().includes(q)
  );
}

function formatActivityDate(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const datePart = d.toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' });
  const timePart = d.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' });
  return `${datePart}, ${timePart}`;
}

export default function AdminPage() {
  const router = useRouter();
  // Per-player action errors. Approving and rejecting used to ignore the
  // server response entirely, so a refusal (no Telegram linked, foreign
  // key blocking a delete) looked exactly like nothing happening.
  const [actionError, setActionError] = useState({});
  const [busyPlayer, setBusyPlayer] = useState(null);
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
  const [playerSearch, setPlayerSearch] = useState('');
  const [existingAnnouncements, setExistingAnnouncements] = useState([]);
  const [recentActivity, setRecentActivity] = useState([]);
  const [testEventsOpen, setTestEventsOpen] = useState(false);
  const [testEvents, setTestEvents] = useState([]);
  const [testEventId, setTestEventId] = useState('');
  const [testCategories, setTestCategories] = useState([]);
  const [testCategoryId, setTestCategoryId] = useState('');
  const [testCount, setTestCount] = useState(4);
  const [testBusy, setTestBusy] = useState(false);
  const [testResult, setTestResult] = useState(null);

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

    // How many approved players can't actually receive a Telegram
    // broadcast — either never linked, or linked and later blocked the
    // bot (we still count telegram_user_id as "linked" even if the bot
    // is blocked, since we can't tell the difference until we try to
    // send; this is "never linked" specifically).
    const { count: noTelegramCount } = await supabase
      .from('players')
      .select('id', { count: 'exact', head: true })
      .neq('approval_status', 'pending')
      .is('telegram_user_id', null);

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
      noTelegramCount: noTelegramCount || 0,
      categoryCountsMale,
      categoryCountsFemale,
    });

    const { data: notifs } = await supabase
      .from('admin_notifications')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(10);
    setExistingAnnouncements(notifs || []);

    // Recent activity: last few played games, newest first by played_at
    // (not created_at — see app/page.js's win-streak query for why).
    // Names and tournament titles come from follow-up lookups rather
    // than a join, since matches store player ids in plain arrays, not
    // foreign keys PostgREST can embed.
    const { data: recentMatches } = await supabase
      .from('matches')
      .select('id, tournament_id, team_a_players, team_b_players, set1, set2, set3, played_at')
      .eq('played', true)
      .order('played_at', { ascending: false })
      .limit(6);

    const involvedIds = [...new Set((recentMatches || []).flatMap((mt) => [...(mt.team_a_players || []), ...(mt.team_b_players || [])]))];
    const { data: involvedPlayers } = involvedIds.length
      ? await supabase.from('players').select('id, full_name').in('id', involvedIds)
      : { data: [] };
    const nameById = new Map((involvedPlayers || []).map((pl) => [pl.id, pl.full_name]));
    const teamNames = (ids) => (ids || []).map((id) => nameById.get(id) || '?').join(' / ');

    const tournamentIds = [...new Set((recentMatches || []).map((mt) => mt.tournament_id).filter(Boolean))];
    const { data: involvedTournaments } = tournamentIds.length
      ? await supabase.from('tournaments').select('id, name').in('id', tournamentIds)
      : { data: [] };
    const tournamentNameById = new Map((involvedTournaments || []).map((t) => [t.id, t.name]));

    setRecentActivity(
      (recentMatches || []).map((mt) => ({
        id: mt.id,
        playedAt: mt.played_at,
        tournamentName: tournamentNameById.get(mt.tournament_id) || null,
        teamA: teamNames(mt.team_a_players),
        teamB: teamNames(mt.team_b_players),
      }))
    );
  }

  async function loadFormatBreakdown() {
    const supabase = createClient();
    const { data: tournaments } = await supabase
      .from('tournaments')
      .select('tournament_events(format_kind)')
      .eq('status', 'done');

    const counts = {};
    (tournaments || []).forEach((t) => {
      const name = getFormat(t.tournament_events?.format_kind)?.displayName || 'Невідомий формат';
      counts[name] = (counts[name] || 0) + 1;
    });
    setFormatBreakdown(Object.entries(counts).map(([name, count]) => ({ name, count })));
  }

  useEffect(() => {
    load();
  }, []);

  function setPlayerError(playerId, message) {
    setActionError((prev) => ({ ...prev, [playerId]: message }));
  }

  // Every admin action goes through here so a failure is always shown
  // instead of being swallowed.
  async function runPlayerAction(playerId, url, options) {
    setPlayerError(playerId, '');
    setBusyPlayer(playerId);

    try {
      const res = await fetch(url, options);
      const data = await res.json().catch(() => ({}));

      if (!data.success) {
        setPlayerError(playerId, data.error || `Помилка сервера (${res.status})`);
        return false;
      }

      await load();
      return true;
    } catch (err) {
      setPlayerError(playerId, `Немає звʼязку з сервером: ${err.message}`);
      return false;
    } finally {
      setBusyPlayer(null);
    }
  }

  async function handleApprove(playerId) {
    const category = selectedCategory[playerId];
    if (!category) {
      setPlayerError(playerId, 'Спочатку оберіть категорію рейтингу');
      return;
    }

    await runPlayerAction(playerId, `/api/admin/players/${playerId}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elo: CATEGORY_STARTING_ELO[category], category }),
    });
  }

  async function handleReject(playerId, playerName) {
    if (!confirm(`Відхилити заявку і повністю видалити ${playerName}? Це незворотно.`)) return;
    await runPlayerAction(playerId, `/api/admin/players/${playerId}/reject`, { method: 'POST' });
  }

  async function handleEditCategory(playerId) {
    const newCategory = prompt('Нова категорія (D, C, B або A):');
    if (!newCategory || !CATEGORY_LETTERS.includes(newCategory.toUpperCase())) return;
    const elo = CATEGORY_STARTING_ELO[newCategory.toUpperCase()];

    await runPlayerAction(playerId, `/api/admin/players/${playerId}/edit-elo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ elo }),
    });
  }

  function openPlayer(playerId) {
    router.push(`/players/${playerId}`);
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
      // Refresh so the new one shows up in the "already sent" list
      // right away, instead of only after a full page reload.
      const supabase = createClient();
      const { data: notifs } = await supabase
        .from('admin_notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);
      setExistingAnnouncements(notifs || []);
    } else {
      alert(data.error || 'Не вдалося надіслати повідомлення');
    }
  }

  async function deleteAnnouncement(id) {
    setExistingAnnouncements((prev) => prev.filter((a) => a.id !== id));
    const supabase = createClient();
    await supabase.from('admin_notifications').delete().eq('id', id);
  }

  // Testing tool: simulate applications from fake players so the whole
  // registration → distribution flow can be exercised without needing
  // real people to sign up. See fill-test-applications/route.js for
  // why this goes through real applications rather than writing
  // straight into a category.
  async function openTestTools() {
    setTestEventsOpen((o) => !o);
    if (testEvents.length > 0) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('tournament_events')
      .select('id, name, format_kind')
      .in('status', ['scheduled', 'live'])
      .order('created_at', { ascending: false });
    setTestEvents(data || []);
  }

  async function loadTestCategories(eventId) {
    setTestEventId(eventId);
    setTestCategoryId('');
    setTestCategories([]);
    if (!eventId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from('tournaments')
      .select('id, category_label, gender')
      .eq('event_id', eventId)
      .in('status', ['scheduled', 'live']);
    setTestCategories(data || []);
  }

  async function runFillBots() {
    if (!testEventId || !testCategoryId) return;
    setTestBusy(true);
    setTestResult(null);
    try {
      const res = await fetch(`/api/admin/events/${testEventId}/fill-test-applications`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ categoryId: testCategoryId, count: testCount }),
      });
      const data = await res.json();
      setTestResult(data);
    } catch (err) {
      setTestResult({ success: false, errors: [err.message] });
    } finally {
      setTestBusy(false);
    }
  }

  async function runCleanupBots() {
    setTestBusy(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/admin/test-players/cleanup', { method: 'POST' });
      const data = await res.json();
      setTestResult({ ...data, cleanup: true });
    } catch (err) {
      setTestResult({ success: false, errors: [err.message] });
    } finally {
      setTestBusy(false);
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

      {stats && stats.noTelegramCount > 0 && (
        <div className={styles.telegramWarning}>
          {stats.noTelegramCount} {stats.noTelegramCount === 1 ? 'гравець' : 'гравців'} без підключеного
          Telegram — не отримають жодного сповіщення.
        </div>
      )}

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
            <div
              key={p.id}
              className={styles.quickListRow}
              style={{ cursor: 'pointer' }}
              role="link"
              tabIndex={0}
              onClick={() => openPlayer(p.id)}
              onKeyDown={(e) => e.key === 'Enter' && openPlayer(p.id)}
            >
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
            <div
              key={p.id}
              className={styles.quickListRow}
              style={{ cursor: 'pointer' }}
              role="link"
              tabIndex={0}
              onClick={() => openPlayer(p.id)}
              onKeyDown={(e) => e.key === 'Enter' && openPlayer(p.id)}
            >
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
          aria-label="Заголовок оголошення"
          value={notifTitle}
          onChange={(e) => setNotifTitle(e.target.value)}
        />
        <textarea
          className={styles.notifTextarea}
          placeholder="Текст повідомлення для всіх учасників..."
          aria-label="Текст оголошення"
          value={notifBody}
          onChange={(e) => setNotifBody(e.target.value)}
          rows={3}
        />
        <button className={styles.notifSendBtn} disabled={notifSending} onClick={handleSendNotification}>
          {notifSending ? 'Надсилання...' : notifSent ? '✓ Надіслано!' : 'Надіслати всім'}
        </button>
      </div>

      {existingAnnouncements.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Активні оголошення</div>
          <div className={styles.quickList}>
          {existingAnnouncements.map((a) => (
            <div key={a.id} className={styles.announcementRow}>
              <div className={styles.announcementRowText}>
                <div className={styles.announcementRowTitle}>{a.title}</div>
                <div className={styles.announcementRowBody}>{a.body}</div>
              </div>
              <button
                className={styles.announcementRowDelete}
                onClick={() => deleteAnnouncement(a.id)}
                aria-label="Видалити оголошення"
              >
                ✕
              </button>
            </div>
          ))}
          </div>
        </>
      )}

      <button className={styles.sectionToggle} onClick={openTestTools} aria-pressed={testEventsOpen}>
        <span className={styles.sectionLabel} style={{ marginBottom: 0 }}>
          Тестові гравці (для перевірки реєстрації)
        </span>
        <span>{testEventsOpen ? '▲' : '▼'}</span>
      </button>

      {testEventsOpen && (
        <div className={styles.notifCard}>
          <div className={styles.fixDescription}>
            Створює тестових гравців і подає за них справжні заявки на обрану категорію — щоб перевірити весь
            процес реєстрації та розподілу, не чекаючи на реальних людей. Логіни завжди починаються з{' '}
            <code>testbot_</code>, тож їх легко знайти й видалити.
          </div>

          <select
            className={styles.playerSearchInput}
            style={{ marginBottom: 8 }}
            value={testEventId}
            onChange={(e) => loadTestCategories(e.target.value)}
            aria-label="Подія"
          >
            <option value="">Оберіть подію...</option>
            {testEvents.map((ev) => (
              <option key={ev.id} value={ev.id}>
                {ev.name} ({getFormat(ev.format_kind)?.displayName || ev.format_kind})
              </option>
            ))}
          </select>

          {testCategories.length > 0 && (
            <select
              className={styles.playerSearchInput}
              style={{ marginBottom: 8 }}
              value={testCategoryId}
              onChange={(e) => setTestCategoryId(e.target.value)}
              aria-label="Категорія"
            >
              <option value="">Оберіть категорію...</option>
              {testCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.category_label} {c.gender ? `· ${c.gender === 'M' ? 'Чоловіки' : 'Жінки'}` : ''}
                </option>
              ))}
            </select>
          )}

          <input
            type="number"
            min={1}
            max={32}
            className={styles.playerSearchInput}
            style={{ marginBottom: 8 }}
            value={testCount}
            onChange={(e) => setTestCount(e.target.value)}
            aria-label="Кількість тестових гравців"
          />

          <button className={styles.notifSendBtn} disabled={testBusy || !testCategoryId} onClick={runFillBots}>
            {testBusy ? 'Створюємо...' : 'Заповнити тестовими заявками'}
          </button>
          <button className={styles.notifSendBtn} style={{ marginTop: 8, background: '#71717a' }} disabled={testBusy} onClick={runCleanupBots}>
            {testBusy ? 'Видаляємо...' : 'Видалити всіх тестових ботів'}
          </button>

          {testResult && (
            <div className={testResult.success ? styles.fixResultOk : styles.fixResultError}>
              {testResult.cleanup
                ? `Видалено: ${testResult.removed}.`
                : `Створено заявок: ${testResult.created}.`}
              {testResult.errors?.length > 0 && ` Помилки: ${testResult.errors.join('; ')}`}
            </div>
          )}
        </div>
      )}

      {recentActivity.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Остання активність</div>
          <div className={styles.quickList}>
            {recentActivity.map((a) => (
              <div key={a.id} className={styles.activityRow}>
                <div className={styles.activityRowMeta}>
                  {formatActivityDate(a.playedAt)}
                  {a.tournamentName ? ` · ${a.tournamentName}` : ''}
                </div>
                <span className={styles.activityRowTeams}>
                  {a.teamA} <span className={styles.activityRowVs}>—</span> {a.teamB}
                </span>
              </div>
            ))}
          </div>
        </>
      )}

      <div className={styles.sectionLabel}>
        Нові реєстрації {pending.length > 0 && <span className={styles.countBadge}>{pending.length}</span>}
      </div>

      {pending.length === 0 && <div className={styles.empty}>Нових заявок немає</div>}

      {pending.map((p) => (
        <div key={p.id} className={styles.pendingCard}>
          <div
            className={styles.pendingHeader}
            style={{ cursor: 'pointer' }}
            role="link"
            tabIndex={0}
            onClick={() => openPlayer(p.id)}
            onKeyDown={(e) => e.key === 'Enter' && openPlayer(p.id)}
          >
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
                aria-pressed={selectedCategory[p.id] === cat}
              >
                {cat}
              </button>
            ))}
          </div>
          <div className={styles.actionRow}>
            <button
              className={styles.approveBtn}
              disabled={!selectedCategory[p.id] || busyPlayer === p.id}
              onClick={() => handleApprove(p.id)}
            >
              {busyPlayer === p.id ? 'Зачекайте…' : 'Підтвердити'}
            </button>
            <button
              className={styles.rejectBtn}
              disabled={busyPlayer === p.id}
              onClick={() => handleReject(p.id, p.full_name)}
            >
              Відхилити
            </button>
          </div>

          {actionError[p.id] && <div className={styles.actionError}>{actionError[p.id]}</div>}
        </div>
      ))}

      <input
        className={styles.playerSearchInput}
        placeholder="Пошук гравця за іменем, прізвищем або логіном..."
        aria-label="Пошук гравця"
        value={playerSearch}
        onChange={(e) => setPlayerSearch(e.target.value)}
      />

      {playerSearch.trim() && (
        <div className={styles.quickList}>
          {[...males, ...females]
            .filter((p) => matchesPlayerSearch(p, playerSearch))
            .map((p) => (
              <div
                key={p.id}
                className={styles.quickListRow}
                style={{ cursor: 'pointer' }}
                role="link"
                tabIndex={0}
                onClick={() => openPlayer(p.id)}
                onKeyDown={(e) => e.key === 'Enter' && openPlayer(p.id)}
              >
                <PlayerAvatar player={p} size={26} />
                <span>{p.full_name}</span>
                <span className={styles.quickListElo}>{p.elo}</span>
              </div>
            ))}
          {[...males, ...females].filter((p) => matchesPlayerSearch(p, playerSearch)).length === 0 && (
            <div className={styles.empty}>Нікого не знайдено</div>
          )}
        </div>
      )}

      <div className={styles.sectionLabel}>Гравці · Чоловіки</div>
      {males.map((p) => (
        <PlayerRow
          key={p.id}
          player={p}
          error={actionError[p.id]}
          onOpen={() => openPlayer(p.id)}
          onEditCategory={() => handleEditCategory(p.id)}
        />
      ))}

      <div className={styles.sectionLabel}>Гравці · Жінки</div>
      {females.map((p) => (
        <PlayerRow
          key={p.id}
          player={p}
          error={actionError[p.id]}
          onOpen={() => openPlayer(p.id)}
          onEditCategory={() => handleEditCategory(p.id)}
        />
      ))}
    </div>
  );
}

function PlayerRow({ player, error, onOpen, onEditCategory }) {
  return (
    <>
      <div className={styles.playerRow}>
        {/* The row opens the player's page; the button inside must not,
            hence stopPropagation on it. */}
        <div
          className={styles.playerRowMain}
          style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, cursor: 'pointer' }}
          role="link"
          tabIndex={0}
          onClick={onOpen}
          onKeyDown={(e) => e.key === 'Enter' && onOpen()}
        >
          <PlayerAvatar player={player} size={32} />
          <div className={styles.playerInfo}>
            <div className={styles.playerName}>{player.full_name}</div>
            <div className={styles.playerMeta}>
              @{player.login} · {player.elo ?? '—'} Ело · Кат. {player.category ?? '—'}
            </div>
          </div>
        </div>
        <button
          className={styles.editEloBtn}
          onClick={(e) => {
            e.stopPropagation();
            onEditCategory();
          }}
        >
          Змінити категорію
        </button>
      </div>
      {error && <div className={styles.actionError}>{error}</div>}
    </>
  );
}
