'use client';

// Admin settings page for a NOT yet started event. Two tabs:
//   «Розподіл» — distribute applications into leagues, park over-capacity
//   players in the reserve, close/open registration, start the categories.
//   «Налаштування» — the creation form again (minus the format choice) to
//   tweak the secondary settings. Once the event goes live, management
//   moves to /tournaments/settings/[eventId].

import { useState } from 'react';
import Link from 'next/link';
import { useCurrentPlayer } from '@/hooks/useCurrentPlayer';
import { getFormat } from '@/lib/formats';
import {
  LOCATION_LABEL,
  useEventData,
  useEventPost,
  CategoryTabs,
  CategoryPanel,
  DeleteEventButton,
} from '../../shared';
import EventConfigForm from './EventConfigForm';
import styles from '../../event.module.css';

const TABS = { QUEUE: 'queue', CONFIG: 'config' };

export default function EventSettingsPage({ params }) {
  const { id } = params;
  const { player, loading: playerLoading } = useCurrentPlayer();
  const { event, categories, applications, loading, load } = useEventData(id);
  const { post, busy, error } = useEventPost(load);
  const [activeCatId, setActiveCatId] = useState(null);
  const [tab, setTab] = useState(TABS.QUEUE);

  if (loading || playerLoading) return <div className={styles.loading}>Завантаження...</div>;
  if (!player?.is_admin) return <div className={styles.loading}>Тільки для адміністраторів</div>;
  if (!event) return <div className={styles.loading}>Подію не знайдено</div>;

  // Live/finished events are managed on the tournament settings page.
  if (event.status !== 'scheduled') {
    return (
      <div className={styles.page}>
        <h2 className={styles.title}>⚙ {event.name}</h2>
        <div className={styles.meta}>Турнір вже розпочато.</div>
        <Link href={`/tournaments/settings/${event.id}`} className={styles.openLink}>
          Керування турніром →
        </Link>
      </div>
    );
  }

  const format = getFormat(event.format_kind);
  const activeCat = categories.find((c) => c.id === activeCatId) || categories[0];
  const isPair = format?.registrationType === 'pair' || format?.registrationType === 'mix_pair';
  const regClosed = event.registration_open === false;

  const pending = applications.filter((a) => a.status === 'pending');
  const reserve = applications.filter((a) => a.status === 'reserve');

  // Free slots per league — drives the queue dropdown and the reserve
  // hint (over-capacity applicants go to the reserve, not the roster).
  const catStats = categories.map((c) => {
    const filled = isPair ? (c.tournament_teams || []).length : (c.tournament_players || []).length;
    const capacity = c.max_participants || format?.fixedParticipants || null;
    return {
      id: c.id,
      gender: c.gender,
      label: c.category_label,
      capacity,
      filled,
      free: capacity != null ? Math.max(0, capacity - filled) : null,
    };
  });

  return (
    <div className={styles.page}>
      <div className={styles.titleRow}>
        <h2 className={styles.title}>⚙ {event.name}</h2>
        <Link href={`/events/register/${event.id}`} className={styles.manageLink} title="Сторінка реєстрації">
          →
        </Link>
      </div>
      <div className={styles.meta}>
        {format?.displayName} ·{' '}
        {new Date(event.scheduled_at).toLocaleString('uk', { dateStyle: 'medium', timeStyle: 'short' })} ·{' '}
        {LOCATION_LABEL[event.location] || event.location}
      </div>
      <div className={styles.meta}>{regClosed ? '🔒 Реєстрацію закрито' : '🟢 Реєстрація відкрита'}</div>

      <div className={styles.tabs}>
        <button
          className={`${styles.tabBtn} ${tab === TABS.QUEUE ? styles.tabBtnOn : ''}`}
          onClick={() => setTab(TABS.QUEUE)}
        >
          Розподіл
        </button>
        <button
          className={`${styles.tabBtn} ${tab === TABS.CONFIG ? styles.tabBtnOn : ''}`}
          onClick={() => setTab(TABS.CONFIG)}
        >
          Налаштування
        </button>
      </div>

      {error && <div className={styles.errMsg}>{error}</div>}

      {tab === TABS.CONFIG ? (
        <EventConfigForm
          event={event}
          categories={categories}
          format={format}
          isPair={isPair}
          busy={busy}
          post={post}
        />
      ) : (
        <>
          <div className={styles.row}>
            <button
              className={styles.btnGhost}
              disabled={busy}
              onClick={() => post(`/api/events/${event.id}/registration`, { open: regClosed })}
            >
              {regClosed ? 'Відкрити реєстрацію' : 'Закрити реєстрацію'}
            </button>
            <button
              className={styles.btnGhost}
              disabled={busy}
              title="Подати заявки за всіх тестових гравців (test1…test48)"
              onClick={() => post(`/api/events/${event.id}/seed-test`)}
            >
              🤖 Тест-заявки
            </button>
          </div>

          {/* Applications queue (pending + reserve) */}
          <AdminQueue
            pending={pending}
            reserve={reserve}
            catStats={catStats}
            busy={busy}
            onAssign={(appId, categoryId, asReserve) =>
              post(`/api/admin/applications/${appId}/assign`, { categoryId, asReserve })
            }
            onReject={(appId) => post(`/api/admin/applications/${appId}/reject`)}
          />

          {categories.length === 0 && <div className={styles.loading}>Категорій немає</div>}

          {categories.length > 0 && (
            <>
              <CategoryTabs categories={categories} activeId={activeCat.id} onSelect={setActiveCatId} />
              <CategoryPanel
                category={activeCat}
                format={format}
                isAdmin
                allCategories={categories}
                busy={busy}
                onStart={() => post(`/api/tournaments/${activeCat.id}/start`)}
                onMove={(ref, targetId, asReserve) =>
                  post('/api/admin/members/move', {
                    fromCategoryId: activeCat.id,
                    targetCategoryId: targetId,
                    asReserve: !!asReserve,
                    ...ref,
                  })
                }
                onRemove={(ref) => post('/api/admin/members/remove', { categoryId: activeCat.id, ...ref })}
              />
            </>
          )}
        </>
      )}

      <DeleteEventButton event={event} busy={busy} post={post} />
    </div>
  );
}

// Unified admin queue of everyone who applied. Shows the requested
// league so the admin can distribute by hand. Over-capacity applicants
// can be parked in a league's reserve and promoted later. Reserve rows
// can be moved into the roster once a slot frees up.
function AdminQueue({ pending, reserve, catStats, busy, onAssign, onReject }) {
  const [choice, setChoice] = useState({});

  function catOption(cs) {
    const g = cs.gender === 'M' ? 'Ч · ' : cs.gender === 'F' ? 'Ж · ' : '';
    const free = cs.free == null ? '' : ` (${cs.free} вільно)`;
    return `${g}${cs.label}${free}`;
  }

  function Row({ a, reserved }) {
    const target = choice[a.id] || '';
    const targetStat = catStats.find((c) => c.id === target);
    const full = targetStat && targetStat.free === 0;
    const reservedCat = reserved ? catStats.find((c) => c.id === a.assigned_tournament_id) : null;
    const pref = [
      a.requested_category && `хоче ${a.requested_category}`,
      reserved && `резерв${reservedCat ? ` ${reservedCat.label}` : ''}`,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <div className={styles.appRow}>
        <div className={styles.appName}>
          {a.applicant?.full_name || a.player_id.slice(0, 8)}
          {a.partner?.full_name && ` + ${a.partner.full_name.split(' ')[0]}`}
          {a.seeking_partner && ' (шукає напарника)'}
          {pref && <div className={styles.appPref}>{pref}</div>}
        </div>
        <div className={styles.row}>
          <select
            className={styles.select}
            value={target}
            onChange={(e) => setChoice((p) => ({ ...p, [a.id]: e.target.value }))}
          >
            <option value="">Ліга…</option>
            {catStats.map((cs) => (
              <option key={cs.id} value={cs.id}>
                {catOption(cs)}
              </option>
            ))}
          </select>
          <button
            className={styles.btnGhost}
            disabled={busy || !target || full}
            onClick={() => onAssign(a.id, target, false)}
            title={full ? 'Немає вільних місць — у резерв' : ''}
          >
            {reserved ? 'У склад' : 'Розподілити'}
          </button>
          {!reserved && (
            <button
              className={styles.btnGhost}
              disabled={busy || !target}
              onClick={() => onAssign(a.id, target, true)}
            >
              У резерв
            </button>
          )}
          <button className={styles.btnGhost} disabled={busy} onClick={() => onReject(a.id)}>
            ✕
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.poolBox}>
      <div className={styles.poolTitle}>Черга заявок ({pending.length})</div>
      {pending.length === 0 && <div className={styles.empty}>Немає нерозподілених заявок</div>}
      {pending.map((a) => (
        <Row key={a.id} a={a} reserved={false} />
      ))}

      {reserve.length > 0 && (
        <>
          <div className={styles.poolTitle} style={{ marginTop: 16 }}>
            Резерв ({reserve.length})
          </div>
          {reserve.map((a) => (
            <Row key={a.id} a={a} reserved />
          ))}
        </>
      )}
    </div>
  );
}
