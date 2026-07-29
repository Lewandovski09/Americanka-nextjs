'use client';

// Admin settings page for a RUNNING (or finished) event, [id] = event id.
// It holds what is still safe to change once the event is live (name,
// date, venue), what each category is made of, starting a category that
// has not gone off yet, the judging crew, and deleting the whole event.
//
// Seeding is NOT here: it belongs to the pre-start page
// (/events/settings/[id] → «Посів») and is frozen the moment a category
// generates its bracket. Scores are entered on the category page
// (/tournaments/[id]). Registration and the application queue live on the
// pre-start page too and are gone once the event starts.

import { useState } from 'react';
import Link from 'next/link';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { getFormat } from '@/lib/formats';
import {
  LOCATION_LABEL,
  bracketLabel,
  useEventData,
  useEventPost,
  CategoryTabs,
  StartEventButton,
  DeleteEventButton,
} from '@/app/events/shared';
import JudgesTab from '@/app/events/JudgesTab';
import styles from '@/app/events/event.module.css';

const TABS = { MAIN: 'main', JUDGES: 'judges' };

export default function TournamentSettingsPage({ params }) {
  const { id } = params;
  const { player, loading: playerLoading } = useCurrentPlayer();
  const { event, categories, judges, loading, load } = useEventData(id);
  const { post, busy, error } = useEventPost(load);
  const [activeCatId, setActiveCatId] = useState(null);
  const [tab, setTab] = useState(TABS.MAIN);

  if (loading || playerLoading) return <div className={styles.loading}>Завантаження...</div>;
  if (!player?.is_admin) return <div className={styles.loading}>Тільки для адміністраторів</div>;
  if (!event) return <div className={styles.loading}>Подію не знайдено</div>;

  // A scheduled event is configured on the pre-start settings page.
  if (event.status === 'scheduled') {
    return (
      <div className={styles.page}>
        <h2 className={styles.title}>⚙ {event.name}</h2>
        <div className={styles.meta}>Турнір ще не розпочато.</div>
        <Link href={`/events/settings/${event.id}`} className={styles.openLink}>
          Налаштування та реєстрація →
        </Link>
      </div>
    );
  }

  const format = getFormat(event.format_kind);
  const isPair = format?.registrationType === 'pair' || format?.registrationType === 'mix_pair';
  const activeCat = categories.find((c) => c.id === activeCatId) || categories[0];

  return (
    <div className={styles.page}>
      <h2 className={styles.title}>⚙ {event.name}</h2>
      <div className={styles.meta}>
        {format?.displayName} ·{' '}
        {new Date(event.scheduled_at).toLocaleString('uk', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
        {LOCATION_LABEL[event.location] || event.location}
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tabBtn} ${tab === TABS.MAIN ? styles.tabBtnOn : ''}`}
          onClick={() => setTab(TABS.MAIN)}
        >
          Керування
        </button>
        <button
          className={`${styles.tabBtn} ${tab === TABS.JUDGES ? styles.tabBtnOn : ''}`}
          onClick={() => setTab(TABS.JUDGES)}
        >
          Судді
        </button>
      </div>

      {error && <div className={styles.errMsg}>{error}</div>}

      {tab === TABS.JUDGES ? (
        <JudgesTab event={event} judges={judges} busy={busy} post={post} />
      ) : categories.length === 0 ? (
        <div className={styles.loading}>Категорій немає</div>
      ) : (
        <>
          <CategoryTabs categories={categories} activeId={activeCat.id} onSelect={setActiveCatId} />

          <MainTab
            key={activeCat.id}
            event={event}
            category={activeCat}
            format={format}
            isPair={isPair}
            busy={busy}
            post={post}
          />
          {/* Leagues that have not gone off yet — all of them at once. */}
          <StartEventButton
            event={event}
            categories={categories}
            format={format}
            busy={busy}
            post={post}
          />
        </>
      )}
    </div>
  );
}

// ISO timestamp → value for <input type="datetime-local"> in local time.
function toLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const STATUS_LABEL = { scheduled: 'Не розпочато', live: 'Триває', done: 'Завершено' };

function MainTab({ event, category, format, isPair, busy, post }) {
  const [name, setName] = useState(event.name || '');
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(event.scheduled_at));
  const [location, setLocation] = useState(event.location || 'beach13');
  const [saved, setSaved] = useState(false);

  const members = isPair ? (category.tournament_teams || []).length : (category.tournament_players || []).length;
  const capacity = category.max_participants || format?.fixedParticipants || null;
  const notStarted = category.status === 'scheduled';
  const seeded = isPair
    ? (category.tournament_teams || []).filter((t) => t.slot_index != null).length
    : (category.tournament_players || []).filter((t) => t.slot_index != null).length;

  const dirty =
    name !== (event.name || '') ||
    scheduledAt !== toLocalInput(event.scheduled_at) ||
    location !== (event.location || 'beach13');

  async function saveBasics() {
    const ok = await post(`/api/events/${event.id}/basics`, {
      name,
      location,
      scheduledAt: new Date(scheduledAt).toISOString(),
    });
    if (ok) setSaved(true);
  }

  return (
    <div className={styles.panel}>
      <div className={styles.poolTitle}>Турнір</div>

      <label className={styles.fieldLabel}>Назва</label>
      <input
        className={styles.field}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
          setSaved(false);
        }}
      />

      <label className={styles.fieldLabel}>Дата та час початку</label>
      <input
        className={styles.field}
        type="datetime-local"
        value={scheduledAt}
        onChange={(e) => {
          setScheduledAt(e.target.value);
          setSaved(false);
        }}
      />

      <label className={styles.fieldLabel}>Місце проведення</label>
      <div className={styles.row}>
        {['beach13', 'dynamo_sc'].map((loc) => (
          <button
            key={loc}
            className={`${styles.catTab} ${location === loc ? styles.catTabOn : ''}`}
            onClick={() => {
              setLocation(loc);
              setSaved(false);
            }}
          >
            {LOCATION_LABEL[loc]}
          </button>
        ))}
      </div>

      <div className={styles.hint}>
        Формат, корти, рахунок і перелік категорій зафіксовані після старту турніру.
      </div>

      {saved && !dirty && <div className={styles.seedOk}>✓ Збережено</div>}
      <button className={styles.btnPrimary} disabled={busy || !dirty} onClick={saveBasics}>
        {busy ? 'Збереження…' : 'Зберегти'}
      </button>

      {/* ── The selected category ── */}
      <div className={styles.poolTitle} style={{ marginTop: 22 }}>
        Категорія {category.gender === 'M' ? '♂ ' : category.gender === 'F' ? '♀ ' : ''}
        {category.category_label}
      </div>
      <div className={styles.panelMeta}>
        <span>Статус: {STATUS_LABEL[category.status] || category.status}</span>
        {category.bracket_system && <span>Система: {bracketLabel(category.bracket_system)}</span>}
        <span>
          {isPair ? 'Пар' : 'Учасників'}: {members}
          {capacity ? `/${capacity}` : ''}
        </span>
        <span>
          Посів:{' '}
          {seeded === members && members > 0
            ? 'розставлено'
            : `${seeded}/${members} (решта — за чергою заявок)`}
        </span>
      </div>

      {!notStarted && (
        <Link href={`/tournaments/${category.id}`} className={styles.openLink}>
          Відкрити категорію (рахунок, сітка) →
        </Link>
      )}

      <DeleteEventButton event={event} busy={busy} post={post} />
    </div>
  );
}
