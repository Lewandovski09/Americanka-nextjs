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
  bracketLabel,
  useEventData,
  useEventPost,
  CategoryTabs,
  StartEventButton,
  DeleteEventButton,
  DeleteCategoryButton,
} from '@/app/events/shared';
import JudgesTab from '@/app/events/JudgesTab';
import PaymentsTab from '@/app/events/PaymentsTab';
import PublishScheduleBar from '@/components/PublishScheduleBar';
import ResultsNoticeBar from '@/components/ResultsNoticeBar';
import { useVenues, selectableVenues, venueLabel } from '@/hooks/useVenues';
import AvpTierPicker from '@/components/AvpTierPicker';
import createStyles from '@/app/tournaments/create/create.module.css';
import styles from '@/app/events/event.module.css';
import VenueName from '@/components/VenueName';
import { appAlert } from '@/components/AppDialog';
import { fromKyivInput, toKyivInput, CLUB_TZ } from '@/lib/dates';

const TABS = { MAIN: 'main', JUDGES: 'judges', PAY: 'pay' };

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
        {new Date(event.scheduled_at).toLocaleString('uk', { timeZone: CLUB_TZ, dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
        <VenueName code={event.location} />
      </div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tabBtn} ${tab === TABS.MAIN ? styles.tabBtnOn : ''}`}
          onClick={() => setTab(TABS.MAIN)}
          aria-pressed={tab === TABS.MAIN}
        >
          Керування
        </button>
        <button
          className={`${styles.tabBtn} ${tab === TABS.JUDGES ? styles.tabBtnOn : ''}`}
          onClick={() => setTab(TABS.JUDGES)}
          aria-pressed={tab === TABS.JUDGES}
        >
          Судді
        </button>
        <button
          className={`${styles.tabBtn} ${tab === TABS.PAY ? styles.tabBtnOn : ''}`}
          onClick={() => setTab(TABS.PAY)}
          aria-pressed={tab === TABS.PAY}
        >
          Оплата
        </button>
      </div>

      {error && <div className={styles.errMsg}>{error}</div>}

      {/* The schedule is a draft after «Запустити» until published (071). */}
      {event.status !== 'scheduled' && event.schedule_published_at === null && (
        <PublishScheduleBar eventId={event.id} onPublished={load} americanka={format?.scoring === 'sum31'} />
      )}
      {/* «🏁 Турнір завершено» to Telegram (074) — finished tournaments */}
      <ResultsNoticeBar event={event} onSent={load} />

      {tab === TABS.JUDGES ? (
        <JudgesTab event={event} judges={judges} busy={busy} post={post} />
      ) : tab === TABS.PAY ? (
        <PaymentsTab event={event} categories={categories} isPair={isPair} />
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
          <DeleteCategoryButton
            key={`del-${activeCat.id}`}
            event={event}
            category={activeCat}
            busy={busy}
            post={post}
            onDeleted={() => setActiveCatId(null)}
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

// ISO timestamp → value for <input type="datetime-local"> — Kyiv time (lib/dates).
function toLocalInput(iso) {
  return toKyivInput(iso);
}

const STATUS_LABEL = { scheduled: 'Не розпочато', live: 'Триває', done: 'Завершено' };

function MainTab({ event, category, format, isPair, busy, post }) {
  const [name, setName] = useState(event.name || '');
  const [scheduledAt, setScheduledAt] = useState(toLocalInput(event.scheduled_at));
  const [location, setLocation] = useState(event.location);
  const [avpTier, setAvpTier] = useState(event.avp_tier ?? null);
  // A running event's courts are baked into its matches, so it can only
  // move to a venue that has every one of them (the server checks too).
  const allVenues = useVenues();
  const venues = selectableVenues(allVenues, event.sport_id, event.location).filter((v) =>
    (event.courts || []).every((c) => v.courts.includes(c))
  );
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
    location !== event.location ||
    (avpTier ?? null) !== (event.avp_tier ?? null);

  async function saveBasics() {
    const ok = await post(`/api/events/${event.id}/basics`, {
      name,
      location,
      scheduledAt: fromKyivInput(scheduledAt),
      avpTier,
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
        aria-label="Назва турніру"
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
        aria-label="Дата та час початку"
        onChange={(e) => {
          setScheduledAt(e.target.value);
          setSaved(false);
        }}
      />

      <label className={styles.fieldLabel}>Місце проведення</label>
      <div className={styles.row}>
        {venues.map((v) => (
          <button
            key={v.code}
            className={`${styles.catTab} ${location === v.code ? styles.catTabOn : ''}`}
            aria-pressed={location === v.code}
            onClick={() => {
              setLocation(v.code);
              setSaved(false);
            }}
          >
            {venueLabel(allVenues, v.code)}
          </button>
        ))}
      </div>

      {/* The tier changes nothing about how the event is played, so it
          stays editable after the start — that is what lets an event
          that began before anyone set it still enter the rating. Saving
          repays every category of this event that has already finished. */}
      <label className={styles.fieldLabel}>Рівень AVP</label>
      <AvpTierPicker
        value={avpTier}
        onChange={(t) => {
          setAvpTier(t);
          setSaved(false);
        }}
        styles={createStyles}
      />

      <div className={styles.hint}>
        Формат, корти, рахунок і перелік категорій зафіксовані після старту турніру. Рівень AVP —
        ні: його можна виставити й зараз, очки за вже завершені категорії перерахуються.
      </div>

      {saved && !dirty && <div className={styles.seedOk}>✓ Збережено</div>}
      <button className={styles.btnPrimary} disabled={busy || !dirty} onClick={saveBasics}>
        {busy ? 'Збереження…' : 'Зберегти'}
      </button>

      {/* ── The selected category ── */}
      <div className={styles.poolTitle} style={{ marginTop: 22 }}>
        Категорія {category.gender === 'M' ? 'Ч · ' : category.gender === 'F' ? 'Ж · ' : ''}
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

      {/* Maintenance: rebuild this tournament's places and AVP from its
          games (the same code that runs when a category finishes). Needed
          only after a manual fix in the database. */}
      {event.status === 'done' && (
        <div className={styles.maintBox}>
          <div className={styles.maintTitle}>Обслуговування</div>
          <div className={styles.maintRow}>
            <button
              type="button"
              className={styles.maintBtn}
              disabled={busy}
              onClick={async () => {
                if (await post('/api/admin/placements/recalc', { eventId: event.id })) appAlert('Місця перераховано ✅');
              }}
            >
              Перерахувати місця
            </button>
            <button
              type="button"
              className={styles.maintBtn}
              disabled={busy}
              onClick={async () => {
                if (await post('/api/admin/avp/recalc', { eventId: event.id })) appAlert('AVP перераховано ✅');
              }}
            >
              Перерахувати AVP
            </button>
          </div>
        </div>
      )}

      <DeleteEventButton event={event} busy={busy} post={post} />
    </div>
  );
}
