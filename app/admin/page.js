'use client';

import Link from 'next/link';

import { USER_COLUMNS } from '@/lib/userColumns';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { getFormat } from '@/lib/formats';
import { CATEGORY_STARTING_ELO } from '@/lib/elo';
import PlayerAvatar from '@/components/PlayerAvatar';
import styles from './admin.module.css';
import SeasonAdminPanel from '@/components/SeasonAdminPanel';
import TelegramWebhookPanel from '@/components/TelegramWebhookPanel';
import ThumbsPanel from '@/components/ThumbsPanel';
import { appConfirm, appAlert } from '@/components/AppDialog';
import { getCached, setCached } from '@/lib/clientCache';
import { scoreLabel, teamAWon } from '@/lib/formats/sets';
import { registrationLabel, registrationState } from '@/lib/registrationWindow';

const CATEGORY_LETTERS = ['D', 'C', 'B', 'A'];

// The panel's four parts. «Огляд» — everything to keep an eye on at a
// glance; the rest are the tools, grouped by what they're about.
const TABS = [
  { id: 'overview', label: 'Огляд' },
  { id: 'players', label: 'Гравці' },
  { id: 'events', label: 'Турніри' },
  { id: 'service', label: 'Сервіс' },
];

const WEEKS = 8;
const DAY = 24 * 3600 * 1000;

const fullName = (u) => [u?.full_name, u?.last_name && !String(u.full_name || '').includes(u.last_name) ? u.last_name : null].filter(Boolean).join(' ') || 'Без імені';

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
  const [tab, setTabState] = useState(() => getCached('admin:tab') || 'overview');
  const setTab = (t) => {
    setTabState(t);
    setCached('admin:tab', t);
    window.scrollTo(0, 0);
  };
  // Tournaments that are coming or being played, with their open applications.
  const [events, setEvents] = useState([]);
  // Played games per week, the last WEEKS weeks (oldest first).
  const [weekly, setWeekly] = useState([]);
  const [editingCategory, setEditingCategory] = useState(null); // player id

  async function load() {
    const supabase = createClient();

    // Six independent reads — all at once (they used to go one by one).
    // How many approved players can't actually receive a Telegram
    // broadcast — either never linked, or linked and later blocked the
    // bot. telegram_linked_at is cleared when the bot is blocked, so this
    // counts both (the Telegram id itself is server-only, migration 058).
    const [{ data: p }, { data: m }, { data: f }, { count: doneCount }, { count: matchesPlayed }, { data: noTg }] =
      await Promise.all([
        supabase.from('users').select(USER_COLUMNS).eq('approval_status', 'pending'),
        supabase.from('users').select(USER_COLUMNS).eq('gender', 'M').neq('approval_status', 'pending').order('elo', { ascending: false }),
        supabase.from('users').select(USER_COLUMNS).eq('gender', 'F').neq('approval_status', 'pending').order('elo', { ascending: false }),
        supabase.from('tournament_categories').select('id', { count: 'exact', head: true }).eq('status', 'done'),
        supabase.from('tournament_matches').select('id', { count: 'exact', head: true }).eq('played', true),
        // who exactly — the warning below lists them
        supabase
          .from('users')
          .select('id, full_name, last_name, gender, approval_status')
          .neq('approval_status', 'pending')
          .is('telegram_linked_at', null)
          .order('full_name', { ascending: true }),
      ]);
    setPending(p || []);
    setMales(m || []);
    setFemales(f || []);

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
      noTelegramCount: (noTg || []).length,
      noTelegram: noTg || [],
      categoryCountsMale,
      categoryCountsFemale,
    });

    const since = new Date(Date.now() - WEEKS * 7 * DAY).toISOString();
    const [{ data: notifs }, { data: evs }, { data: apps }, { data: weekMatches }] = await Promise.all([
      supabase.from('admin_notifications').select('*').order('created_at', { ascending: false }).limit(10),
      supabase
        .from('tournament_events')
        .select(
          'id, name, format_kind, status, scheduled_at, location, registration_open, registration_opens_at, entry_fee, tournament_categories(id, status, category_label, gender, max_participants)'
        )
        .in('status', ['scheduled', 'live'])
        .order('scheduled_at', { ascending: true }),
      supabase.from('tournament_applications').select('event_id, status').in('status', ['pending', 'assigned', 'reserve']),
      supabase.from('tournament_matches').select('played_at').eq('played', true).gte('played_at', since).limit(5000),
    ]);
    setExistingAnnouncements(notifs || []);

    const appsBy = new Map();
    (apps || []).forEach((a) => {
      const v = appsBy.get(a.event_id) || { pending: 0, placed: 0 };
      if (a.status === 'pending') v.pending++;
      else v.placed++;
      appsBy.set(a.event_id, v);
    });
    setEvents((evs || []).map((e) => ({ ...e, apps: appsBy.get(e.id) || { pending: 0, placed: 0 } })));

    const now = Date.now();
    const buckets = Array.from({ length: WEEKS }, (_, i) => ({ start: now - (WEEKS - i) * 7 * DAY, count: 0 }));
    (weekMatches || []).forEach((m) => {
      const t = new Date(m.played_at).getTime();
      const i = Math.floor((t - (now - WEEKS * 7 * DAY)) / (7 * DAY));
      if (i >= 0 && i < WEEKS) buckets[i].count++;
    });
    setWeekly(buckets);

    // Recent activity: last few played games, newest first by played_at
    // (not created_at — see app/page.js's win-streak query for why).
    // Names and tournament titles come from follow-up lookups rather
    // than a join, since matches store player ids in plain arrays, not
    // foreign keys PostgREST can embed.
    const { data: recentMatches } = await supabase
      .from('tournament_matches')
      .select('id, category_id, team_a_players, team_b_players, set1, set2, set3, played_at')
      .eq('played', true)
      .order('played_at', { ascending: false })
      .limit(8);

    const involvedIds = [...new Set((recentMatches || []).flatMap((mt) => [...(mt.team_a_players || []), ...(mt.team_b_players || [])]))];
    const { data: involvedPlayers } = involvedIds.length
      ? await supabase.from('users').select('id, full_name').in('id', involvedIds)
      : { data: [] };
    const nameById = new Map((involvedPlayers || []).map((pl) => [pl.id, pl.full_name]));
    const teamNames = (ids) => (ids || []).map((id) => nameById.get(id) || '?').join(' / ');

    const tournamentIds = [...new Set((recentMatches || []).map((mt) => mt.category_id).filter(Boolean))];
    const { data: involvedTournaments } = tournamentIds.length
      ? await supabase.from('tournament_categories').select('id, name').in('id', tournamentIds)
      : { data: [] };
    const tournamentNameById = new Map((involvedTournaments || []).map((t) => [t.id, t.name]));

    setRecentActivity(
      (recentMatches || []).map((mt) => ({
        id: mt.id,
        playedAt: mt.played_at,
        tournamentName: tournamentNameById.get(mt.category_id) || null,
        teamA: teamNames(mt.team_a_players),
        teamB: teamNames(mt.team_b_players),
        score: scoreLabel(mt),
        aWon: mt.set1 ? teamAWon(mt) : null,
      }))
    );
  }

  async function loadFormatBreakdown() {
    const supabase = createClient();
    const { data: tournaments } = await supabase
      .from('tournament_categories')
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

  useEffect(() => {
    if (tab === 'events' && formatBreakdown.length === 0) loadFormatBreakdown();
    if (tab === 'service' && testEvents.length === 0 && testEventsOpen) openTestTools();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

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

      load(); // fresh lists in the background — the button is free at once
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
    if (!(await appConfirm(`Відхилити заявку і повністю видалити ${playerName}? Це незворотно.`, { okText: 'Відхилити', danger: true }))) return;
    await runPlayerAction(playerId, `/api/admin/players/${playerId}/reject`, { method: 'POST' });
  }

  // From the D / C / B / A chips of a player row (was a browser prompt).
  async function handleEditCategory(playerId, newCategory) {
    if (!newCategory || !CATEGORY_LETTERS.includes(newCategory)) return;
    setEditingCategory(null);
    const elo = CATEGORY_STARTING_ELO[newCategory];

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
      appAlert("Заповніть заголовок і текст повідомлення");
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
      // Telegram to everyone — in the background, the page doesn't wait.
      if (data.notification?.id) {
        fetch(`/api/admin/notifications/${data.notification.id}/broadcast`, { method: 'POST', keepalive: true }).catch(() => {});
      }
      setNotifTitle('');
      setNotifBody('');
      if (data.channel === 'failed') appAlert('Оголошення надіслано в бот, але в канал не вдалося — перевірте, що бот є адміністратором каналу.');
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
      appAlert(data.error || 'Не вдалося надіслати повідомлення');
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
      .from('tournament_categories')
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

  const live = events.filter((e) => e.status === 'live');
  const upcoming = events.filter((e) => e.status === 'scheduled');
  const pendingApps = events.reduce((n, e) => n + (e.apps?.pending || 0), 0);
  const gamesWeek = weekly.length ? weekly[weekly.length - 1].count : 0;
  const weekMax = Math.max(1, ...weekly.map((w) => w.count));
  const newPlayers30 = [...males, ...females].filter((p) => p.created_at && Date.now() - new Date(p.created_at).getTime() < 30 * DAY).length;
  const attention = [
    pending.length > 0 && {
      key: 'reg',
      tone: 'red',
      text: `${pending.length} ${pending.length === 1 ? 'нова реєстрація чекає' : 'нових реєстрацій чекають'} підтвердження`,
      action: () => setTab('players'),
      cta: 'Розглянути',
    },
    ...events
      .filter((e) => e.apps?.pending > 0)
      .map((e) => ({
        key: `apps-${e.id}`,
        tone: 'amber',
        text: `${e.name}: ${e.apps.pending} ${e.apps.pending === 1 ? 'заявка' : 'заявок'} не розподілено`,
        href: `/events/settings/${e.id}`,
        cta: 'Розподілити',
      })),
    ...live.map((e) => ({
      key: `live-${e.id}`,
      tone: 'green',
      text: `${e.name} — триває зараз`,
      href: `/tournaments/settings/${e.id}`,
      cta: 'Керувати',
    })),
  ].filter(Boolean);

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>Адмін-панель</h2>

      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={`${styles.tabBtn} ${tab === t.id ? styles.tabBtnOn : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'players' && pending.length > 0 && <span className={styles.tabBadge}>{pending.length}</span>}
            {t.id === 'events' && pendingApps > 0 && <span className={styles.tabBadge}>{pendingApps}</span>}
          </button>
        ))}
      </div>

      {/* ───────────────────────── Огляд ───────────────────────── */}
      {tab === 'overview' && (
        <>
          {stats && (
            <div className={styles.kpiGrid}>
              <button className={styles.kpi} onClick={() => setTab('players')}>
                <div className={styles.kpiValue}>{stats.maleCount + stats.femaleCount}</div>
                <div className={styles.kpiLabel}>Гравців</div>
                <div className={styles.kpiSub}>
                  Ч {stats.maleCount} · Ж {stats.femaleCount}
                  {newPlayers30 > 0 ? ` · +${newPlayers30} за 30 дн` : ''}
                </div>
              </button>
              <button className={`${styles.kpi} ${pending.length ? styles.kpiAlert : ''}`} onClick={() => setTab('players')}>
                <div className={styles.kpiValue}>{pending.length}</div>
                <div className={styles.kpiLabel}>Нові реєстрації</div>
                <div className={styles.kpiSub}>{pending.length ? 'чекають підтвердження' : 'усе розглянуто'}</div>
              </button>
              <button className={styles.kpi} onClick={() => setTab('events')}>
                <div className={styles.kpiValue}>{events.length}</div>
                <div className={styles.kpiLabel}>Активні турніри</div>
                <div className={styles.kpiSub}>
                  {live.length} триває · {upcoming.length} попереду
                </div>
              </button>
              <button className={styles.kpi} onClick={() => setTab('events')}>
                <div className={styles.kpiValue}>{stats.doneCount}</div>
                <div className={styles.kpiLabel}>Завершено категорій</div>
                <div className={styles.kpiSub}>за весь час</div>
              </button>
              <div className={styles.kpi}>
                <div className={styles.kpiValue}>{gamesWeek}</div>
                <div className={styles.kpiLabel}>Ігор за тиждень</div>
                <div className={styles.kpiSub}>усього {stats.matchesPlayed}</div>
              </div>
              <div className={`${styles.kpi} ${stats.noTelegramCount ? styles.kpiWarn : ''}`}>
                <div className={styles.kpiValue}>{stats.noTelegramCount}</div>
                <div className={styles.kpiLabel}>Без Telegram</div>
                <div className={styles.kpiSub}>{stats.noTelegramCount ? 'не бачать застосунок' : 'усі підключені'}</div>
              </div>
            </div>
          )}

          {attention.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Потребує уваги</div>
              <div className={styles.card}>
                {attention.map((a) => (
                  <div key={a.key} className={styles.attnRow}>
                    <span className={`${styles.attnDot} ${styles[`dot_${a.tone}`]}`} />
                    <span className={styles.attnText}>{a.text}</span>
                    {a.href ? (
                      <Link href={a.href} className={styles.attnBtn}>
                        {a.cta}
                      </Link>
                    ) : (
                      <button className={styles.attnBtn} onClick={a.action}>
                        {a.cta}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}

          {stats && stats.noTelegramCount > 0 && (
            <div className={styles.telegramWarning}>
              Без підключеного Telegram (бачать лише екран «Підтвердіть Telegram»):
              <div className={styles.telegramWarningList}>
                {stats.noTelegram.map((u) => (
                  <Link key={u.id} href={`/players/${u.id}`} className={styles.telegramWarningName}>
                    {fullName(u)}
                    {u.approval_status === 'rejected' ? ' (відхилений)' : ''}
                  </Link>
                ))}
              </div>
            </div>
          )}

          <div className={styles.sectionLabel}>Ігри по тижнях</div>
          <div className={styles.card}>
            <div className={styles.chart} role="img" aria-label={`Зіграні ігри за останні ${WEEKS} тижнів`}>
              {weekly.map((w, i) => (
                <div key={i} className={styles.chartCol}>
                  <div className={styles.chartValue}>{w.count || ''}</div>
                  <div className={styles.chartBarWrap}>
                    <div
                      className={`${styles.chartBar} ${i === weekly.length - 1 ? styles.chartBarNow : ''}`}
                      style={{ height: `${Math.max(w.count ? 6 : 2, (w.count / weekMax) * 100)}%` }}
                    />
                  </div>
                  <div className={styles.chartLabel}>
                    {new Date(w.start + 7 * DAY - 1).toLocaleDateString('uk-UA', { day: 'numeric', month: 'numeric' })}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <EventList title="Найближчі турніри" events={events.slice(0, 4)} />

          {recentActivity.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Останні ігри</div>
              <div className={styles.card}>
                {recentActivity.map((a) => (
                  <div key={a.id} className={styles.gameRow}>
                    <div className={styles.gameMeta}>
                      {formatActivityDate(a.playedAt)}
                      {a.tournamentName ? ` · ${a.tournamentName}` : ''}
                    </div>
                    <div className={styles.gameLine}>
                      <span className={`${styles.gameTeam} ${a.aWon === true ? styles.gameWin : ''}`}>{a.teamA}</span>
                      <span className={styles.gameScore}>{a.score || '—'}</span>
                      <span className={`${styles.gameTeam} ${styles.gameTeamRight} ${a.aWon === false ? styles.gameWin : ''}`}>{a.teamB}</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {stats && (
            <>
              <div className={styles.sectionLabel}>Топ-5 за Ело</div>
              <div className={styles.topGrid}>
                {[
                  ['Чоловіки', males],
                  ['Жінки', females],
                ].map(([label, list]) => (
                  <div key={label} className={styles.card}>
                    <div className={styles.topTitle}>{label}</div>
                    {list.slice(0, 5).map((p, i) => (
                      <Link key={p.id} href={`/players/${p.id}`} className={styles.topRow}>
                        <span className={styles.topPlace}>{i + 1}</span>
                        <PlayerAvatar player={p} size={24} />
                        <span className={styles.topName}>{p.full_name}</span>
                        <span className={styles.topElo}>{p.elo}</span>
                      </Link>
                    ))}
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      )}

      {/* ───────────────────────── Гравці ───────────────────────── */}
      {tab === 'players' && (
        <>
          <div className={styles.sectionLabel} style={{ marginTop: 4 }}>
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
                <button className={styles.rejectBtn} disabled={busyPlayer === p.id} onClick={() => handleReject(p.id, p.full_name)}>
                  Відхилити
                </button>
              </div>
              {actionError[p.id] && <div className={styles.actionError}>{actionError[p.id]}</div>}
            </div>
          ))}

          {stats && (
            <>
              <div className={styles.sectionLabel}>За категоріями</div>
              <div className={styles.card}>
                <div className={styles.catTable}>
                  <span />
                  {CATEGORY_LETTERS.map((c) => (
                    <span key={c} className={styles.catHead}>
                      {c}
                    </span>
                  ))}
                  <span className={styles.catRowLabel}>Чоловіки</span>
                  {CATEGORY_LETTERS.map((c) => (
                    <span key={c} className={styles.catCell}>
                      {stats.categoryCountsMale[c]}
                    </span>
                  ))}
                  <span className={styles.catRowLabel}>Жінки</span>
                  {CATEGORY_LETTERS.map((c) => (
                    <span key={c} className={styles.catCell}>
                      {stats.categoryCountsFemale[c]}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}

          <div className={styles.sectionLabel}>Пошук</div>
          <input
            className={styles.playerSearchInput}
            placeholder="Ім’я, прізвище або логін…"
            aria-label="Пошук гравця"
            value={playerSearch}
            onChange={(e) => setPlayerSearch(e.target.value)}
          />

          {[
            ['Чоловіки', males],
            ['Жінки', females],
          ].map(([label, list]) => {
            const shown = list.filter((p) => matchesPlayerSearch(p, playerSearch));
            return (
              <div key={label}>
                <div className={styles.sectionLabel}>
                  {label} · {shown.length}
                </div>
                {shown.length === 0 && <div className={styles.empty}>Нікого не знайдено</div>}
                {shown.map((p) => (
                  <PlayerRow
                    key={p.id}
                    player={p}
                    error={actionError[p.id]}
                    busy={busyPlayer === p.id}
                    editing={editingCategory === p.id}
                    onOpen={() => openPlayer(p.id)}
                    onToggleEdit={() => setEditingCategory((id) => (id === p.id ? null : p.id))}
                    onPickCategory={(c) => handleEditCategory(p.id, c)}
                  />
                ))}
              </div>
            );
          })}
        </>
      )}

      {/* ───────────────────────── Турніри ───────────────────────── */}
      {tab === 'events' && (
        <>
          <div className={styles.quickActions}>
            <Link href="/tournaments/create" className={styles.primaryLink}>
              + Створити турнір
            </Link>
            <Link href="/tournaments" className={styles.ghostLink}>
              Усі турніри →
            </Link>
          </div>

          <EventList title={`Тривають · ${live.length}`} events={live} empty="Зараз нічого не грається" />
          <EventList title={`Попереду · ${upcoming.length}`} events={upcoming} empty="Немає запланованих турнірів" />

          <div className={styles.sectionLabel}>Завершені категорії за форматом</div>
          <div className={styles.card}>
            {formatBreakdown.length === 0 && <div className={styles.empty}>Ще немає завершених турнірів</div>}
            {formatBreakdown.map((f) => (
              <div key={f.name} className={styles.formatRow}>
                <span>{f.name}</span>
                <span className={styles.formatCount}>{f.count}</span>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ───────────────────────── Сервіс ───────────────────────── */}
      {tab === 'service' && (
        <>
          <div className={styles.sectionLabel} style={{ marginTop: 4 }}>
            Надіслати оголошення
          </div>
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
              placeholder="Текст — піде в Telegram-канал і кожному гравцю в бот..."
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
                    <button className={styles.announcementRowDelete} onClick={() => deleteAnnouncement(a.id)} aria-label="Видалити оголошення">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* AVP and Ело run independent seasons — each closed and started on its own. */}
          <SeasonAdminPanel styles={styles} kind="avp" />
          <SeasonAdminPanel styles={styles} kind="elo" />
          <TelegramWebhookPanel styles={styles} />
          <ThumbsPanel styles={styles} />

          <button className={styles.sectionToggle} onClick={openTestTools} aria-pressed={testEventsOpen}>
            <span className={styles.sectionLabel} style={{ marginBottom: 0 }}>
              Тестові гравці (для перевірки реєстрації)
            </span>
            <span>{testEventsOpen ? '▲' : '▼'}</span>
          </button>

          {testEventsOpen && (
            <div className={styles.notifCard}>
              <div className={styles.fixDescription}>
                Створює тестових гравців і подає за них справжні заявки на обрану категорію — щоб перевірити весь процес
                реєстрації та розподілу, не чекаючи на реальних людей. Логіни завжди починаються з <code>testbot_</code>,
                тож їх легко знайти й видалити.
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
                  {testResult.cleanup ? `Видалено: ${testResult.removed}.` : `Створено заявок: ${testResult.created}.`}
                  {testResult.errors?.length > 0 && ` Помилки: ${testResult.errors.join('; ')}`}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// The coming / running tournaments: date, registration state, applications
// and a ⚙ to their settings.
function EventList({ title, events, empty }) {
  return (
    <>
      <div className={styles.sectionLabel}>{title}</div>
      {events.length === 0 ? (
        <div className={styles.empty}>{empty || 'Немає активних турнірів'}</div>
      ) : (
        <div className={styles.card}>
          {events.map((e) => {
            const isLive = e.status === 'live';
            const state = isLive ? 'live' : registrationState(e);
            const cats = (e.tournament_categories || []).filter((c) => c.status !== 'cancelled');
            return (
              <div key={e.id} className={styles.eventRow}>
                <div className={styles.eventMain}>
                  <Link href={isLive ? `/tournaments/${cats[0]?.id || ''}` : `/events/register/${e.id}`} className={styles.eventName}>
                    {e.name}
                  </Link>
                  <div className={styles.eventMeta}>
                    {new Date(e.scheduled_at).toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {' · '}
                    {getFormat(e.format_kind)?.displayName || e.format_kind}
                    {' · '}
                    {cats.length} {cats.length === 1 ? 'категорія' : 'категорії'}
                  </div>
                  <div className={styles.eventTags}>
                    <span className={`${styles.stateChip} ${styles[`state_${state}`]}`}>
                      {isLive ? 'Триває' : registrationLabel(e)}
                    </span>
                    {e.apps?.pending > 0 && <span className={`${styles.stateChip} ${styles.state_wait}`}>{e.apps.pending} нерозподілено</span>}
                    <span className={styles.stateChip}>{e.apps?.placed || 0} у складі</span>
                  </div>
                </div>
                <Link
                  href={isLive ? `/tournaments/settings/${e.id}` : `/events/settings/${e.id}`}
                  className={styles.gear}
                  title="Налаштування"
                  aria-label={`Налаштування: ${e.name}`}
                >
                  ⚙
                </Link>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

function PlayerRow({ player, error, busy, editing, onOpen, onToggleEdit, onPickCategory }) {
  return (
    <>
      <div className={styles.playerRow}>
        {/* The row opens the player's page; the button inside must not,
            hence stopPropagation on it. */}
        <div
          className={styles.playerRowMain}
          style={{ display: 'flex', alignItems: 'center', gap: 10, flex: 1, cursor: 'pointer', minWidth: 0 }}
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
              {!player.telegram_linked_at ? ' · без Telegram' : ''}
            </div>
          </div>
        </div>
        <button
          className={styles.editEloBtn}
          disabled={busy}
          aria-expanded={editing}
          onClick={(e) => {
            e.stopPropagation();
            onToggleEdit();
          }}
        >
          {busy ? '…' : editing ? 'Скасувати' : 'Категорія'}
        </button>
      </div>
      {editing && (
        <div className={styles.catPicker}>
          <span className={styles.catPickerLabel}>Нова категорія (Ело стане стартовим для неї):</span>
          <div className={styles.categoryRow}>
            {CATEGORY_LETTERS.map((c) => (
              <button
                key={c}
                className={`${styles.categoryChip} ${player.category === c ? styles.categoryChipOn : ''}`}
                onClick={() => onPickCategory(c)}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
      )}
      {error && <div className={styles.actionError}>{error}</div>}
    </>
  );
}
